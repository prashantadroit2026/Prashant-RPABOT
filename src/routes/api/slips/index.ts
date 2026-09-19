import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { ensureSeed } from "@/lib/plant-server";

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

export const Route = createFileRoute("/api/slips/")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const sql = await getSql();
        await ensureSeed(sql);
        const url = new URL(request.url);
        const status = url.searchParams.get("status");
        let rows: Record<string, unknown>[];
        if (status) {
          rows = await sql.query(`${SLIP_SELECT} where s.status = $1 order by s.created_at desc`, [status]);
        } else {
          rows = await sql.query(`${SLIP_SELECT} order by s.created_at desc`);
        }
        return Response.json(rows.map(mapSlip));
      },
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
        if (!body || typeof body.itemId !== "number" || typeof body.machineId !== "number" || typeof body.qty !== "number") {
          return Response.json({ error: "itemId, machineId, qty are required" }, { status: 400 });
        }
        const qty = Number(body.qty);
        if (!Number.isInteger(qty) || qty < 1) return Response.json({ error: "qty must be positive integer" }, { status: 400 });
        if (!body.hodConfirmed) return Response.json({ error: "HOD authorisation required" }, { status: 400 });
        const sql = await getSql();
        const [item] = await sql<{ id: number }>`select * from items where id = ${body.itemId}`;
        const [machine] = await sql<{ id: number }>`select * from machines where id = ${body.machineId}`;
        if (!item || !machine) return Response.json({ error: "Unknown item or machine" }, { status: 400 });
        const [{ n }] = await sql<{ n: number }>`select count(*)::int as n from slips`;
        const now = new Date();
        const token = `SLIP-${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}-${String(n + 1).padStart(4, "0")}`;
        const slipDate = typeof body.slipDate === "string" ? body.slipDate : new Date().toISOString().slice(0, 10);
        const [ins] = await sql<{ token: string }>`insert into slips (token, item_id, machine_id, qty, department, station, hod_title, hod_confirmed, slip_date, status) values (${token}, ${item.id}, ${machine.id}, ${qty}, ${String(body.department ?? "Production")}, ${String(body.station ?? "")}, ${String(body.hodTitle ?? "Production HOD")}, true, ${slipDate}::date, 'pending') returning token`;
        const [row] = await sql.query(`${SLIP_SELECT} where s.token = $1`, [ins.token]);
        return Response.json(mapSlip(row as Record<string, unknown>));
      },
    },
  },
});
