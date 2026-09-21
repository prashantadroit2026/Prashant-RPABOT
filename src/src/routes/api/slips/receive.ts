import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";

const SLIP_SELECT = `
  select
    s.id, s.token, s.item_id, i.name as item_name, i.code as item_code, i.uom,
    s.machine_id, m.name as machine_name, m.code as machine_code,
    s.qty, s.issued_qty, s.department, s.station, s.hod_title, s.hod_confirmed,
    s.slip_date::text as slip_date, s.status, s.note,
    s.created_at::text as created_at, s.decided_at::text as decided_at,
    i.qty as on_hand, i.reorder_level, s.description
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
    description: r.description,
    createdAt: String(r.created_at),
    decidedAt: r.decided_at ? String(r.decided_at) : null,
    onHand: r.on_hand,
    reorderLevel: r.reorder_level,
  };
}

export const Route = createFileRoute("/api/slips/receive")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => null)) as { id?: number } | null;
        if (!body || typeof body.id !== "number") return Response.json({ error: "id required" }, { status: 400 });
        const sql = await getSql();
        const [slip] = await sql.query<Record<string, unknown>>(`${SLIP_SELECT} where s.id = $1`, [body.id]);
        if (!slip) return Response.json({ error: "Slip not found" }, { status: 404 });
        if (slip.status !== "pr_open" && slip.status !== "partial") return Response.json({ error: "Only open PRs can be marked received" }, { status: 400 });
        const inbound = (slip.qty as number) - (slip.issued_qty as number);
        if (inbound <= 0) return Response.json({ error: "Nothing left to receive" }, { status: 400 });
        await sql`update items set qty = qty + ${inbound} where id = ${slip.item_id}`;
        await sql`insert into movements (item_id, machine_id, slip_id, qty, kind) values (${slip.item_id}, ${slip.machine_id}, ${slip.id}, ${inbound}, 'receive')`;
        await sql`update slips set status='received', decided_at=now(), note=${`Received ${inbound} against PR. Rack updated.`} where id=${slip.id}`;
        const [out] = await sql.query<Record<string, unknown>>(`${SLIP_SELECT} where s.id = $1`, [slip.id]);
        return Response.json(mapSlip(out));
      },
    },
  },
});
