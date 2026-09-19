import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { ensureSeed } from "@/lib/plant-server";

const SLIP_SELECT_INNER = `
  select
    s.id, s.token, s.item_id, i.name as item_name, i.code as item_code, i.uom,
    s.machine_id, m.name as machine_name, m.code as machine_code,
    s.qty, s.issued_qty, s.department, s.station, s.hod_title, s.hod_confirmed,
s.slip_date::text as slip_date, s.status, s.note,
    s.created_at::text as created_at, s.decided_at::text as decided_at,
    i.qty as on_hand, i.reorder_level, s.slip_group_id, s.description
  from slips s
  join items i on i.id = s.item_id
  left join machines m on m.id = s.machine_id
`;

function mapSlipRow(r: Record<string, unknown>) {
  return {
    id: r.id, token: r.token, itemId: r.item_id, itemName: r.item_name,
    itemCode: r.item_code, uom: r.uom, machineId: r.machine_id,
    machineName: r.machine_name, machineCode: r.machine_code,
    qty: r.qty, issuedQty: r.issued_qty, department: r.department,
    station: r.station, hodTitle: r.hod_title, hodConfirmed: r.hod_confirmed,
slipDate: r.slip_date, status: r.status, note: r.note,
    createdAt: String(r.created_at), decidedAt: r.decided_at ? String(r.decided_at) : null,
    onHand: r.on_hand, reorderLevel: r.reorder_level, description: r.description,
  };
}

/**
 * GET  /api/indents          — list all slip groups with their slips
 * POST /api/indents          — submit a multi-item indent (see body shape below)
 *
 * POST body: { date, department, machine, cell, hodSignatureConfirmed, items: [{itemId, quantity}] }
 * Returns: SlipGroup
 */
export const Route = createFileRoute("/api/indents")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const sql = await getSql();
          await ensureSeed(sql);
          const groups = await sql.query<Record<string, unknown>>(
            "select * from slip_groups order by created_at desc",
          );
          const slips = await sql.query<Record<string, unknown>>(
            `${SLIP_SELECT_INNER} where s.slip_group_id is not null order by s.created_at desc`,
          );
          const byGroup = new Map<number, ReturnType<typeof mapSlipRow>[]>();
          for (const row of slips) {
            const gid = row.slip_group_id as number;
            const list = byGroup.get(gid) ?? [];
            list.push(mapSlipRow(row));
            byGroup.set(gid, list);
          }
          return Response.json(
            groups.map((g) => ({
              id: g.id,
              groupToken: g.group_token,
              department: g.department,
              machineCode: g.machine_code,
              station: g.station,
              hodConfirmed: g.hod_confirmed,
              slipDate: g.slip_date,
              createdAt: String(g.created_at),
              slips: byGroup.get(g.id as number) ?? [],
            })),
          );
        } catch (err) {
          return Response.json({ error: (err as Error).message }, { status: 500 });
        }
      },
      POST: async ({ request }) => {
        const body = await request.json().catch(() => null);
        if (!body) return Response.json({ error: "Invalid JSON" }, { status: 400 });

        try {
          const sql = await getSql();
          await ensureSeed(sql);

          const data = body as {
            date?: string;
            department?: string;
            machine?: string;
            cell?: string;
            hodSignatureConfirmed?: boolean;
            items?: { itemId?: string; quantity?: number; description?: string }[];
          };

          if (!data.date || !data.department || !data.machine) {
            return Response.json({ error: "date, department, machine are required" }, { status: 400 });
          }
          if (!data.hodSignatureConfirmed) {
            return Response.json({ error: "HOD authorisation is required" }, { status: 400 });
          }
          if (!Array.isArray(data.items) || data.items.length === 0) {
            return Response.json({ error: "items array is required" }, { status: 400 });
          }

          // Parse date DD-MM-YYYY or YYYY-MM-DD
          let slipDate = data.date;
          if (/^\d{2}-\d{2}-\d{4}$/.test(slipDate)) {
            const [dd, mm, yyyy] = slipDate.split("-");
            slipDate = `${yyyy}-${mm}-${dd}`;
          }

          // Resolve machine by code or name
          const [machine] = await sql.query<{ id: number; code: string; name: string; line: string }>(
            "select * from machines where lower(code) = lower($1) or lower(name) ilike $2 limit 1",
            [data.machine, `%${data.machine}%`],
          );
          if (!machine) return Response.json({ error: `Machine not found: ${data.machine}` }, { status: 400 });

          // Create slip_groups row
          const [{ grpCount }] = await sql<{ grpCount: number }>`select count(*)::int as "grpCount" from slip_groups`;
          const now = new Date();
          const groupToken = `GRP-${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}-${String(grpCount + 1).padStart(4, "0")}`;
          const [grp] = await sql<{ id: number; group_token: string }>`
            insert into slip_groups (group_token, department, machine_code, station, hod_confirmed, slip_date)
            values (${groupToken}, ${data.department}, ${machine.code}, ${data.cell ?? ""}, true, ${slipDate}::date)
            returning id, group_token
          `;

          const hodTitle = `${data.department} HOD`;
          const createdSlips: unknown[] = [];

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

          for (const line of data.items) {
            if (!line.itemId || !line.quantity || line.quantity < 1) {
              return Response.json({ error: "Each item needs itemId and quantity >= 1" }, { status: 400 });
            }
            const [item] = await sql.query<{ id: number; code: string; name: string; uom: string }>(
              "select * from items where lower(code) = lower($1) or lower(name) ilike $2 limit 1",
              [line.itemId, `%${line.itemId}%`],
            );
            if (!item) return Response.json({ error: `Item not found: ${line.itemId}` }, { status: 400 });

            const [{ n }] = await sql<{ n: number }>`select count(*)::int as n from slips`;
            const token = `SLIP-${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}-${String(n + 1).padStart(4, "0")}`;

await sql`
              insert into slips (
                token, item_id, machine_id, qty, department, station,
                hod_title, hod_confirmed, slip_date, status, slip_group_id, description
              ) values (
                ${token}, ${item.id}, ${machine.id}, ${line.quantity},
                ${data.department!}, ${data.cell ?? ""}, ${hodTitle}, true,
                ${slipDate}::date, 'pending', ${grp.id}, ${line.description ?? ""}
              )
            `;
            const [row] = await sql.query(`${SLIP_SELECT} where s.token = $1`, [token]);
            const r = row as Record<string, unknown>;
            createdSlips.push({
              id: r.id, token: r.token, itemId: r.item_id, itemName: r.item_name,
              itemCode: r.item_code, uom: r.uom, machineId: r.machine_id,
              machineName: r.machine_name, machineCode: r.machine_code,
              qty: r.qty, issuedQty: r.issued_qty, department: r.department,
              station: r.station, hodTitle: r.hod_title, hodConfirmed: r.hod_confirmed,
slipDate: r.slip_date, status: r.status, note: r.note,
              createdAt: String(r.created_at), decidedAt: r.decided_at ? String(r.decided_at) : null,
              onHand: r.on_hand, reorderLevel: r.reorder_level, description: r.description,
            });
          }

          return Response.json({
            id: grp.id,
            groupToken: grp.group_token,
            department: data.department,
            machineCode: machine.code,
            station: data.cell ?? "",
            hodConfirmed: true,
            slipDate,
            createdAt: now.toISOString(),
            slips: createdSlips,
          });
        } catch (err) {
          return Response.json({ error: (err as Error).message }, { status: 400 });
        }
      },
    },
  },
});
