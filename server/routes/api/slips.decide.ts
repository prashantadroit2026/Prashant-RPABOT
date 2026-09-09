import { defineHandler } from "nitro";
import { getSql } from "../../../src/lib/db";

const SLIP_SELECT = `
  select
    s.id, s.token, s.item_id, i.name as item_name, i.code as item_code, i.uom,
    s.machine_id, m.name as machine_name, m.code as machine_code,
    s.qty, s.issued_qty, s.department, s.station, s.hod_title, s.hod_confirmed,
    s.slip_date::text as slip_date, s.status, s.note,
    s.created_at::text as created_at, s.decided_at::text as decided_at,
    i.qty as on_hand, i.reorder_level
  from slips s
  join items i on i.id = s.item_id
  left join machines m on m.id = s.machine_id
`;

function mapSlip(r: Record<string, unknown>) {
  return {
    id: r.id,
    token: r.token,
    itemId: r.item_id,
    itemName: r.item_name,
    itemCode: r.item_code,
    uom: r.uom,
    machineId: r.machine_id,
    machineName: r.machine_name,
    machineCode: r.machine_code,
    qty: r.qty,
    issuedQty: r.issued_qty,
    department: r.department,
    station: r.station,
    hodTitle: r.hod_title,
    hodConfirmed: r.hod_confirmed,
    slipDate: r.slip_date,
    status: r.status,
    note: r.note,
    createdAt: String(r.created_at),
    decidedAt: r.decided_at ? String(r.decided_at) : null,
    onHand: r.on_hand,
    reorderLevel: r.reorder_level,
  };
}

export default defineHandler(async (event) => {
  if ((event.req.method ?? "GET").toUpperCase() !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: { "content-type": "application/json" } });
  }
  const body = await event.req.json().catch(() => null) as { id?: number; mode?: string } | null;
  if (!body || typeof body.id !== "number" || !["stock", "split", "pr"].includes(String(body.mode))) {
    return new Response(JSON.stringify({ error: "id (number) and mode (stock|split|pr) required" }), { status: 400, headers: { "content-type": "application/json" } });
  }
  const sql = await getSql();
  const [slip] = await sql.query<Record<string, unknown>>(`${SLIP_SELECT} where s.id = $1`, [body.id]);
  if (!slip) return new Response(JSON.stringify({ error: "Slip not found" }), { status: 404, headers: { "content-type": "application/json" } });
  if (slip.status !== "pending") return new Response(JSON.stringify({ error: "This slip has already been actioned" }), { status: 400, headers: { "content-type": "application/json" } });
  const mode = body.mode as "stock" | "split" | "pr";
  if (mode === "pr") {
    await sql`update slips set status='pr_open', decided_at=now(), note='Raised PR — nothing issued from rack' where id = ${slip.id}`;
    const [out] = await sql.query<Record<string, unknown>>(`${SLIP_SELECT} where s.id = $1`, [slip.id]);
    return mapSlip(out);
  }
  const want = mode === "stock" ? (slip.qty as number) : Math.min(slip.qty as number, slip.on_hand as number);
  if (want <= 0) return new Response(JSON.stringify({ error: "No stock to issue" }), { status: 400, headers: { "content-type": "application/json" } });
  if (mode === "stock" && (slip.on_hand as number) < (slip.qty as number)) return new Response(JSON.stringify({ error: "Not enough on the rack for a full issue. Use split or raise PR." }), { status: 400, headers: { "content-type": "application/json" } });
  const taken = await sql<{ id: number }>`update items set qty = qty - ${want} where id = ${slip.item_id} and qty >= ${want} returning id`;
  if (!taken[0]) return new Response(JSON.stringify({ error: "Stock moved while deciding — refresh and try again" }), { status: 409, headers: { "content-type": "application/json" } });
  await sql`insert into movements (item_id, machine_id, slip_id, qty, kind) values (${slip.item_id}, ${slip.machine_id}, ${slip.id}, ${-want}, 'issue')`;
  const remaining = (slip.qty as number) - want;
  const status = remaining > 0 ? "partial" : "issued";
  const note = remaining > 0 ? `Issued ${want} from stock. PR open for ${remaining}.` : `Issued ${want} from stock. No PR.`;
  await sql`update slips set issued_qty=${want}, status=${status}, decided_at=now(), note=${note} where id=${slip.id}`;
  const [out] = await sql.query<Record<string, unknown>>(`${SLIP_SELECT} where s.id = $1`, [slip.id]);
  return mapSlip(out);
});
