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
  const sql = await getSql();
  const { ensureSeed } = await import("../../../src/lib/plant-server");
  await ensureSeed(sql);
  const method = event.req.method?.toUpperCase() ?? "GET";

  if (method === "GET") {
    const url = new URL(event.req.url ?? "http://localhost/api/slips", "http://localhost");
    const status = url.searchParams.get("status");
    let rows: Record<string, unknown>[];
    if (status) {
      rows = await sql.query(`${SLIP_SELECT} where s.status = $1 order by s.created_at desc`, [status]);
    } else {
      rows = await sql.query(`${SLIP_SELECT} order by s.created_at desc`);
    }
    return rows.map(mapSlip);
  }

  if (method === "POST") {
    const body = await event.req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body.itemId !== "number" || typeof body.machineId !== "number" || typeof body.qty !== "number") {
      return new Response(JSON.stringify({ error: "itemId, machineId, qty are required" }), { status: 400, headers: { "content-type": "application/json" } });
    }
    const qty = Number(body.qty);
    if (!Number.isInteger(qty) || qty < 1) return new Response(JSON.stringify({ error: "qty must be positive integer" }), { status: 400, headers: { "content-type": "application/json" } });
    if (!body.hodConfirmed) return new Response(JSON.stringify({ error: "HOD authorisation required" }), { status: 400, headers: { "content-type": "application/json" } });
    const [item] = await sql<{ id: number; qty: number; reorder_level: number }>`select * from items where id = ${body.itemId}`;
    const [machine] = await sql<{ id: number }>`select * from machines where id = ${body.machineId}`;
    if (!item || !machine) return new Response(JSON.stringify({ error: "Unknown item or machine" }), { status: 400, headers: { "content-type": "application/json" } });
    const [{ n }] = await sql<{ n: number }>`select count(*)::int as n from slips`;
    const now = new Date();
    const token = `SLIP-${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}-${String(n + 1).padStart(4, "0")}`;
    const slipDate = typeof body.slipDate === "string" ? body.slipDate : new Date().toISOString().slice(0, 10);
    const [ins] = await sql<{ token: string }>`insert into slips (token, item_id, machine_id, qty, department, station, hod_title, hod_confirmed, slip_date, status) values (${token}, ${item.id}, ${machine.id}, ${qty}, ${String(body.department ?? "Production")}, ${String(body.station ?? "")}, ${String(body.hodTitle ?? "Production HOD")}, true, ${slipDate}::date, 'pending') returning token`;
    const [row] = await sql.query(`${SLIP_SELECT} where s.token = $1`, [ins.token]);
    return mapSlip(row as Record<string, unknown>);
  }

  return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { "content-type": "application/json" } });
});
