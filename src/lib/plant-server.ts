import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql, type Sql } from "@/lib/db";
import {
  type InventoryRow,
  type Item,
  type Machine,
  type MachineStat,
  type RefillRow,
  type Slip,
  type SlipStatus,
  type WeekPoint,
  stockStatus,
} from "@/lib/plant";

type ItemRow = {
  id: number;
  code: string;
  name: string;
  uom: string;
  reorder_level: number;
  qty: number;
  category: string;
  unit_price: string | number;
};

type MachineRow = {
  id: number;
  code: string;
  name: string;
  line: string;
};

type SlipRow = {
  id: number;
  token: string;
  item_id: number;
  item_name: string;
  item_code: string;
  uom: string;
  machine_id: number | null;
  machine_name: string | null;
  machine_code: string | null;
  qty: number;
  issued_qty: number;
  department: string;
  station: string;
  hod_title: string;
  hod_confirmed: boolean;
  slip_date: string;
  status: SlipStatus;
  note: string;
  description: string;
  created_at: string;
  decided_at: string | null;
  on_hand: number;
  reorder_level: number;
};

let seedLock: Promise<void> | null = null;

export async function ensureSeed(sql: Sql): Promise<void> {
  if (seedLock) return seedLock;
  seedLock = (async () => {
    const [{ n }] = await sql<{ n: number }>`select count(*)::int as n from items`;
    if (n > 0) return;

    const catalog: Array<[string, string, string, number, number, string, number]> = [
      ["HYD-040", "Hydraulic Oil ISO 68", "Ltr", 20, 4, "Lubricants & Fluids", 185.0],
      ["CUT-118", "Carbide Cutting Insert", "Pcs", 12, 0, "Cutting Tools", 240.5],
      ["GLV-NIT", "Nitrile Safety Gloves", "Pair", 40, 126, "Safety & PPE", 60.0],
      ["BRG-6205", "Bearing 6205-2RS", "Pcs", 10, 8, "Bearings", 325.0],
      ["BLT-B52", "V-Belt B-52", "Pcs", 6, 2, "Transmission", 420.75],
      ["CLN-CON", "Coolant Concentrate", "Ltr", 25, 48, "Lubricants & Fluids", 310.0],
      ["FLT-C10", "Compressor Filter C10", "Pcs", 4, 0, "Filters", 890.0],
      ["WLD-6013", "Welding Electrode 6013", "Kg", 30, 210, "Welding", 145.25],
      ["PNE-8MM", "Pneumatic Fitting 8mm", "Pcs", 16, 18, "Pneumatics", 54.0],
      ["GRS-NL2", "Grease NLGI-2", "Kg", 8, 3, "Lubricants & Fluids", 260.5],
    ];
    for (const [code, name, uom, reorder, qty, category, price] of catalog) {
      await sql`
        insert into items (code, name, uom, reorder_level, qty, category, unit_price)
        values (${code}, ${name}, ${uom}, ${reorder}, ${qty}, ${category}, ${price})
      `;
    }

    const plant: Array<[string, string, string]> = [
      ["CNC-01", "CNC Lathe 01", "Machine shop"],
      ["CNC-02", "CNC Mill 02", "Machine shop"],
      ["PRS-04", "Hydraulic Press 04", "Press bay"],
      ["CNV-A", "Conveyor Line A", "Assembly"],
      ["WLD-2", "Welding Bay 2", "Fabrication"],
      ["CMP-R", "Compressor Room", "Utilities"],
    ];
    for (const [code, name, line] of plant) {
      await sql`insert into machines (code, name, line) values (${code}, ${name}, ${line})`;
    }

    const items = await sql<ItemRow>`select * from items`;
    const machines = await sql<MachineRow>`select * from machines`;
    const byCode = (code: string) => items.find((i) => i.code === code)!;
    const byMc = (code: string) => machines.find((m) => m.code === code)!;

    type Hist = { item: string; machine: string; qty: number; daysAgo: number; kind: "issue" | "receive" };
    const history: Hist[] = [
      { item: "CUT-118", machine: "CNC-01", qty: -6, daysAgo: 58, kind: "issue" },
      { item: "CUT-118", machine: "CNC-01", qty: 24, daysAgo: 55, kind: "receive" },
      { item: "CUT-118", machine: "CNC-01", qty: -8, daysAgo: 41, kind: "issue" },
      { item: "CUT-118", machine: "CNC-02", qty: -5, daysAgo: 33, kind: "issue" },
      { item: "CUT-118", machine: "CNC-01", qty: -7, daysAgo: 18, kind: "issue" },
      { item: "CUT-118", machine: "CNC-02", qty: -4, daysAgo: 9, kind: "issue" },
      { item: "HYD-040", machine: "PRS-04", qty: 40, daysAgo: 52, kind: "receive" },
      { item: "HYD-040", machine: "PRS-04", qty: -8, daysAgo: 47, kind: "issue" },
      { item: "HYD-040", machine: "PRS-04", qty: -10, daysAgo: 29, kind: "issue" },
      { item: "HYD-040", machine: "PRS-04", qty: -6, daysAgo: 12, kind: "issue" },
      { item: "HYD-040", machine: "CMP-R", qty: -4, daysAgo: 6, kind: "issue" },
      { item: "GLV-NIT", machine: "WLD-2", qty: 80, daysAgo: 44, kind: "receive" },
      { item: "GLV-NIT", machine: "WLD-2", qty: -20, daysAgo: 38, kind: "issue" },
      { item: "GLV-NIT", machine: "CNV-A", qty: -16, daysAgo: 21, kind: "issue" },
      { item: "GLV-NIT", machine: "CNC-01", qty: -12, daysAgo: 8, kind: "issue" },
      { item: "BRG-6205", machine: "CNV-A", qty: 20, daysAgo: 49, kind: "receive" },
      { item: "BRG-6205", machine: "CNV-A", qty: -6, daysAgo: 36, kind: "issue" },
      { item: "BRG-6205", machine: "CNC-02", qty: -4, daysAgo: 14, kind: "issue" },
      { item: "BLT-B52", machine: "CNV-A", qty: 10, daysAgo: 40, kind: "receive" },
      { item: "BLT-B52", machine: "CNV-A", qty: -4, daysAgo: 27, kind: "issue" },
      { item: "BLT-B52", machine: "CNV-A", qty: -3, daysAgo: 11, kind: "issue" },
      { item: "CLN-CON", machine: "CNC-01", qty: 60, daysAgo: 50, kind: "receive" },
      { item: "CLN-CON", machine: "CNC-01", qty: -12, daysAgo: 31, kind: "issue" },
      { item: "CLN-CON", machine: "CNC-02", qty: -10, daysAgo: 16, kind: "issue" },
      { item: "FLT-C10", machine: "CMP-R", qty: 8, daysAgo: 46, kind: "receive" },
      { item: "FLT-C10", machine: "CMP-R", qty: -2, daysAgo: 28, kind: "issue" },
      { item: "FLT-C10", machine: "CMP-R", qty: -2, daysAgo: 7, kind: "issue" },
      { item: "WLD-6013", machine: "WLD-2", qty: 100, daysAgo: 53, kind: "receive" },
      { item: "WLD-6013", machine: "WLD-2", qty: -25, daysAgo: 34, kind: "issue" },
      { item: "WLD-6013", machine: "WLD-2", qty: -18, daysAgo: 13, kind: "issue" },
      { item: "PNE-8MM", machine: "CNC-02", qty: 30, daysAgo: 42, kind: "receive" },
      { item: "PNE-8MM", machine: "CNC-02", qty: -8, daysAgo: 22, kind: "issue" },
      { item: "GRS-NL2", machine: "PRS-04", qty: 12, daysAgo: 39, kind: "receive" },
      { item: "GRS-NL2", machine: "PRS-04", qty: -4, daysAgo: 19, kind: "issue" },
      { item: "GRS-NL2", machine: "CNV-A", qty: -3, daysAgo: 5, kind: "issue" },
    ];

    for (const h of history) {
      const item = byCode(h.item);
      const mc = byMc(h.machine);
      await sql`
        insert into movements (item_id, machine_id, qty, kind, created_at)
        values (
          ${item.id},
          ${mc.id},
          ${h.qty},
          ${h.kind},
          now() - (${h.daysAgo}::int * interval '1 day')
        )
      `;
    }

    async function insertSlip(opts: {
      token: string;
      item: string;
      machine: string;
      qty: number;
      dept: string;
      station: string;
      hod: string;
      daysAgo: number;
      status?: SlipStatus;
      issued?: number;
      note?: string;
    }) {
      const item = byCode(opts.item);
      const mc = byMc(opts.machine);
      const status = opts.status ?? "pending";
      const issued = opts.issued ?? 0;
      await sql`
        insert into slips (
          token, item_id, machine_id, qty, issued_qty, department, station,
          hod_title, hod_confirmed, slip_date, status, note, created_at, decided_at
        ) values (
          ${opts.token},
          ${item.id},
          ${mc.id},
          ${opts.qty},
          ${issued},
          ${opts.dept},
          ${opts.station},
          ${opts.hod},
          true,
          (current_date - ${opts.daysAgo}::int),
          ${status},
          ${opts.note ?? ""},
          now() - (${opts.daysAgo}::int * interval '1 day'),
          null
        )
      `;
      if (status !== "pending") {
        await sql`
          update slips
          set decided_at = created_at + interval '3 hours'
          where token = ${opts.token}
        `;
      }
    }

    await insertSlip({
      token: "SLIP-2609-0001",
      item: "CUT-118",
      machine: "CNC-01",
      qty: 6,
      dept: "Production",
      station: "Lathe cell",
      hod: "Production HOD",
      daysAgo: 0,
    });
    await insertSlip({
      token: "SLIP-2609-0002",
      item: "HYD-040",
      machine: "PRS-04",
      qty: 10,
      dept: "Maintenance",
      station: "Press bay",
      hod: "Maintenance HOD",
      daysAgo: 0,
    });
    await insertSlip({
      token: "SLIP-2609-0003",
      item: "GLV-NIT",
      machine: "WLD-2",
      qty: 20,
      dept: "Production",
      station: "Fabrication",
      hod: "Production HOD",
      daysAgo: 0,
    });
    await insertSlip({
      token: "SLIP-2609-0004",
      item: "BRG-6205",
      machine: "CNV-A",
      qty: 12,
      dept: "Maintenance",
      station: "Assembly",
      hod: "Maintenance HOD",
      daysAgo: 1,
    });
    await insertSlip({
      token: "SLIP-2609-0005",
      item: "FLT-C10",
      machine: "CMP-R",
      qty: 2,
      dept: "Maintenance",
      station: "Utilities",
      hod: "Maintenance HOD",
      daysAgo: 1,
    });
    await insertSlip({
      token: "SLIP-2609-0006",
      item: "WLD-6013",
      machine: "WLD-2",
      qty: 15,
      dept: "Production",
      station: "Fabrication",
      hod: "Production HOD",
      daysAgo: 2,
      status: "issued",
      issued: 15,
    });
  })().catch((err) => {
    seedLock = null;
    throw err;
  });
  return seedLock;
}

function mapItem(r: ItemRow): Item {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    uom: r.uom,
    reorderLevel: r.reorder_level,
    qty: r.qty,
    category: r.category,
    unitPrice: Number(r.unit_price) || 0,
  };
}

function mapMachine(r: MachineRow): Machine {
  return { id: r.id, code: r.code, name: r.name, line: r.line };
}

function mapSlip(r: SlipRow): Slip {
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

const SLIP_SELECT = `
  select
    s.id, s.token, s.item_id, i.name as item_name, i.code as item_code, i.uom,
    s.machine_id, m.name as machine_name, m.code as machine_code,
    s.qty, s.issued_qty, s.department, s.station, s.hod_title, s.hod_confirmed,
    s.slip_date::text as slip_date, s.status, s.note, s.description,
    s.created_at::text as created_at, s.decided_at::text as decided_at,
    i.qty as on_hand, i.reorder_level
  from slips s
  join items i on i.id = s.item_id
  left join machines m on m.id = s.machine_id
`;

export const getCatalog = createServerFn({ method: "GET" }).handler(async () => {
  const sql = await getSql();
  await ensureSeed(sql);
  const items = await sql<ItemRow>`select * from items order by name`;
  const machines = await sql<MachineRow>`select * from machines order by code`;
  return { items: items.map(mapItem), machines: machines.map(mapMachine) };
});

export const listSlips = createServerFn({ method: "GET" }).handler(async () => {
  const sql = await getSql();
  await ensureSeed(sql);
  const rows = await sql.query<SlipRow>(`${SLIP_SELECT} order by s.created_at desc`);
  return rows.map(mapSlip);
});

export const getItemHint = createServerFn({ method: "POST" })
  .validator(
    z.object({
      itemId: z.number(),
      machineId: z.number().nullable(),
    }),
  )
  .handler(async ({ data }) => {
    const sql = await getSql();
    await ensureSeed(sql);
    const [item] = await sql<ItemRow>`select * from items where id = ${data.itemId}`;
    if (!item) return null;
    const last = await sql<{
      qty: number;
      created_at: string;
      machine_name: string | null;
      kind: string;
    }>`
      select mv.qty, mv.created_at::text as created_at, m.name as machine_name, mv.kind
      from movements mv
      left join machines m on m.id = mv.machine_id
      where mv.item_id = ${data.itemId} and mv.kind = 'issue'
      order by mv.created_at desc
      limit 3
    `;
    const machineLast = data.machineId
      ? await sql<{ qty: number; created_at: string }>`
          select qty, created_at::text as created_at
          from movements
          where item_id = ${data.itemId} and machine_id = ${data.machineId} and kind = 'issue'
          order by created_at desc
          limit 1
        `
      : [];
    return {
      item: mapItem(item),
      lastIssues: last.map((r) => ({
        qty: Math.abs(r.qty),
        at: r.created_at,
        machineName: r.machine_name,
      })),
      lastOnThisMachine: machineLast[0]
        ? { qty: Math.abs(machineLast[0].qty), at: machineLast[0].created_at }
        : null,
    };
  });

export const raiseSlip = createServerFn({ method: "POST" })
  .validator(
    z.object({
      itemId: z.number(),
      machineId: z.number(),
      qty: z.number().int().positive(),
      department: z.string().min(1),
      station: z.string().max(80),
      hodTitle: z.string().min(1),
      hodConfirmed: z.boolean(),
      slipDate: z.string().min(8),
    }),
  )
  .handler(async ({ data }) => {
    if (!data.hodConfirmed) {
      throw new Error("HOD authorisation is required — same as signing the paper slip.");
    }
    const sql = await getSql();
    await ensureSeed(sql);
    const [item] = await sql<ItemRow>`select * from items where id = ${data.itemId}`;
    const [machine] = await sql<MachineRow>`select * from machines where id = ${data.machineId}`;
    if (!item || !machine) throw new Error("Unknown item or machine.");
    const [{ n }] = await sql<{ n: number }>`select count(*)::int as n from slips`;
    const now = new Date();
    const token = `SLIP-${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}-${String(n + 1).padStart(4, "0")}`;
    const [ins] = await sql<{ token: string }>`
      insert into slips (
        token, item_id, machine_id, qty, department, station,
        hod_title, hod_confirmed, slip_date, status
      ) values (
        ${token}, ${item.id}, ${machine.id}, ${data.qty}, ${data.department},
        ${data.station}, ${data.hodTitle}, true, ${data.slipDate}::date, 'pending'
      ) returning token
    `;
    const [row] = await sql.query<SlipRow>(`${SLIP_SELECT} where s.token = $1`, [ins.token]);
    return mapSlip(row);
  });

export const decideSlip = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.number(),
      mode: z.enum(["stock", "split", "pr", "reject"]),
    }),
  )
  .handler(async ({ data }) => {
    const sql = await getSql();
    await ensureSeed(sql);
    const [slip] = await sql.query<SlipRow>(`${SLIP_SELECT} where s.id = $1`, [data.id]);
    if (!slip) throw new Error("Slip not found.");
    if (slip.status !== "pending") throw new Error("This slip has already been actioned.");

    if (data.mode === "reject") {
      await sql`
        update slips
        set status = 'rejected', decided_at = now(), note = 'Rejected at store desk — not fulfilled'
        where id = ${slip.id}
      `;
      const [out] = await sql.query<SlipRow>(`${SLIP_SELECT} where s.id = $1`, [slip.id]);
      return mapSlip(out);
    }

    if (data.mode === "pr") {
      await sql`
        update slips
        set status = 'pr_open', decided_at = now(), note = 'Raised PR — nothing issued from rack'
        where id = ${slip.id}
      `;
      const [out] = await sql.query<SlipRow>(`${SLIP_SELECT} where s.id = $1`, [slip.id]);
      return mapSlip(out);
    }

    const want = data.mode === "stock" ? slip.qty : Math.min(slip.qty, slip.on_hand);
    if (want <= 0) throw new Error("No stock to issue.");
    if (data.mode === "stock" && slip.on_hand < slip.qty) {
      throw new Error("Not enough on the rack for a full issue. Use split or raise PR.");
    }

    const taken = await sql<{ id: number; qty: number }>`
      update items
      set qty = qty - ${want}
      where id = ${slip.item_id} and qty >= ${want}
      returning id, qty
    `;
    if (!taken[0]) throw new Error("Stock moved while deciding — refresh and try again.");

    await sql`
      insert into movements (item_id, machine_id, slip_id, qty, kind)
      values (${slip.item_id}, ${slip.machine_id}, ${slip.id}, ${-want}, 'issue')
    `;

    const remaining = slip.qty - want;
    const status: SlipStatus = remaining > 0 ? "partial" : "issued";
    const note =
      remaining > 0
        ? `Issued ${want} from stock. PR open for ${remaining}.`
        : `Issued ${want} from stock. No PR.`;
    await sql`
      update slips
      set issued_qty = ${want}, status = ${status}, decided_at = now(), note = ${note}
      where id = ${slip.id}
    `;
    const [out] = await sql.query<SlipRow>(`${SLIP_SELECT} where s.id = $1`, [slip.id]);
    return mapSlip(out);
  });

export const receiveSlip = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.number() }))
  .handler(async ({ data }) => {
    const sql = await getSql();
    await ensureSeed(sql);
    const [slip] = await sql.query<SlipRow>(`${SLIP_SELECT} where s.id = $1`, [data.id]);
    if (!slip) throw new Error("Slip not found.");
    if (slip.status !== "pr_open" && slip.status !== "partial") {
      throw new Error("Only open PRs can be marked received.");
    }
    const inbound = slip.qty - slip.issued_qty;
    if (inbound <= 0) throw new Error("Nothing left to receive.");
    await sql`update items set qty = qty + ${inbound} where id = ${slip.item_id}`;
    await sql`
      insert into movements (item_id, machine_id, slip_id, qty, kind)
      values (${slip.item_id}, ${slip.machine_id}, ${slip.id}, ${inbound}, 'receive')
    `;
    await sql`
      update slips
      set status = 'received', decided_at = now(),
          note = ${`Received ${inbound} against PR. Rack updated.`}
      where id = ${slip.id}
    `;
    const [out] = await sql.query<SlipRow>(`${SLIP_SELECT} where s.id = $1`, [slip.id]);
    return mapSlip(out);
  });

export const getInventory = createServerFn({ method: "GET" }).handler(async () => {
  const sql = await getSql();
  await ensureSeed(sql);
  const items = await sql<ItemRow>`select * from items order by name`;
  const aggs = await sql<{
    item_id: number;
    consumed30: number;
    received30: number;
  }>`
    select
      item_id,
      coalesce(sum(case when kind = 'issue' and created_at >= now() - interval '30 days' then -qty else 0 end), 0)::int as consumed30,
      coalesce(sum(case when kind = 'receive' and created_at >= now() - interval '30 days' then qty else 0 end), 0)::int as received30
    from movements
    group by item_id
  `;
  const weekly = await sql<{ item_id: number; week: string; consumed: number }>`
    select
      item_id,
      to_char(date_trunc('week', created_at), 'YYYY-MM-DD') as week,
      coalesce(sum(case when kind = 'issue' then -qty else 0 end), 0)::int as consumed
    from movements
    where created_at >= now() - interval '56 days'
    group by item_id, date_trunc('week', created_at)
    order by week
  `;
  const aggMap = new Map(aggs.map((a) => [a.item_id, a]));
  const weekMap = new Map<number, number[]>();
  const weeks = lastNWeeks(8);
  for (const w of weekly) {
    const arr = weekMap.get(w.item_id) ?? weeks.map(() => 0);
    const idx = weeks.indexOf(w.week);
    if (idx >= 0) arr[idx] = w.consumed;
    weekMap.set(w.item_id, arr);
  }
  const rows: InventoryRow[] = items.map((it) => {
    const a = aggMap.get(it.id);
    const consumed30 = a?.consumed30 ?? 0;
    const received30 = a?.received30 ?? 0;
    const daily = consumed30 / 30;
    return {
      ...mapItem(it),
      status: stockStatus(it.qty, it.reorder_level),
      consumed30,
      received30,
      daysCover: daily > 0 ? Math.round((it.qty / daily) * 10) / 10 : null,
      weekly: weekMap.get(it.id) ?? weeks.map(() => 0),
    };
  });
  return rows;
});

export const getMachineStats = createServerFn({ method: "GET" }).handler(async () => {
  const sql = await getSql();
  await ensureSeed(sql);
  const machines = await sql<MachineRow>`select * from machines order by code`;
  const totals = await sql<{
    machine_id: number;
    consumed30: number;
    distinct_items: number;
  }>`
    select
      machine_id,
      coalesce(sum(case when kind = 'issue' and created_at >= now() - interval '30 days' then -qty else 0 end), 0)::int as consumed30,
      count(distinct case when kind = 'issue' then item_id end)::int as distinct_items
    from movements
    where machine_id is not null
    group by machine_id
  `;
  const breakdown = await sql<{
    machine_id: number;
    item_name: string;
    item_code: string;
    uom: string;
    qty: number;
  }>`
    select
      mv.machine_id,
      i.name as item_name,
      i.code as item_code,
      i.uom,
      coalesce(sum(case when mv.kind = 'issue' then -mv.qty else 0 end), 0)::int as qty
    from movements mv
    join items i on i.id = mv.item_id
    where mv.machine_id is not null
    group by mv.machine_id, i.name, i.code, i.uom
    having coalesce(sum(case when mv.kind = 'issue' then -mv.qty else 0 end), 0) > 0
    order by qty desc
  `;
  const totMap = new Map(totals.map((t) => [t.machine_id, t]));
  const byMc = new Map<number, MachineStat["rows"]>();
  for (const b of breakdown) {
    const list = byMc.get(b.machine_id) ?? [];
    list.push({ itemName: b.item_name, itemCode: b.item_code, qty: b.qty, uom: b.uom });
    byMc.set(b.machine_id, list);
  }
  const stats: MachineStat[] = machines.map((m) => {
    const t = totMap.get(m.id);
    const rows = byMc.get(m.id) ?? [];
    return {
      ...mapMachine(m),
      consumed30: t?.consumed30 ?? 0,
      distinctItems: t?.distinct_items ?? 0,
      topItem: rows[0]?.itemName ?? null,
      rows,
    };
  });
  return stats;
});

export const getRefillDashboard = createServerFn({ method: "GET" }).handler(async () => {
  const sql = await getSql();
  await ensureSeed(sql);
  const items = await sql<ItemRow>`select * from items order by name`;
  const aggs = await sql<{
    item_id: number;
    consumed30: number;
    received30: number;
    receipts: number;
  }>`
    select
      item_id,
      coalesce(sum(case when kind = 'issue' and created_at >= now() - interval '30 days' then -qty else 0 end), 0)::int as consumed30,
      coalesce(sum(case when kind = 'receive' and created_at >= now() - interval '30 days' then qty else 0 end), 0)::int as received30,
      coalesce(sum(case when kind = 'receive' and created_at >= now() - interval '30 days' then 1 else 0 end), 0)::int as receipts
    from movements
    group by item_id
  `;
  const weekly = await sql<{
    week: string;
    consumed: number;
    received: number;
  }>`
    select
      to_char(date_trunc('week', created_at), 'YYYY-MM-DD') as week,
      coalesce(sum(case when kind = 'issue' then -qty else 0 end), 0)::int as consumed,
      coalesce(sum(case when kind = 'receive' then qty else 0 end), 0)::int as received
    from movements
    where created_at >= now() - interval '56 days'
    group by date_trunc('week', created_at)
    order by week
  `;
  const perItemWeek = await sql<{ item_id: number; week: string; consumed: number }>`
    select
      item_id,
      to_char(date_trunc('week', created_at), 'YYYY-MM-DD') as week,
      coalesce(sum(case when kind = 'issue' then -qty else 0 end), 0)::int as consumed
    from movements
    where created_at >= now() - interval '56 days'
    group by item_id, date_trunc('week', created_at)
  `;
  const weeks = lastNWeeks(8);
  const aggMap = new Map(aggs.map((a) => [a.item_id, a]));
  const weekMap = new Map<number, number[]>();
  for (const w of perItemWeek) {
    const arr = weekMap.get(w.item_id) ?? weeks.map(() => 0);
    const idx = weeks.indexOf(w.week);
    if (idx >= 0) arr[idx] = w.consumed;
    weekMap.set(w.item_id, arr);
  }
  const rows: RefillRow[] = items.map((it) => {
    const a = aggMap.get(it.id);
    const consumed30 = a?.consumed30 ?? 0;
    const received30 = a?.received30 ?? 0;
    const daily = consumed30 / 30;
    return {
      itemId: it.id,
      name: it.name,
      code: it.code,
      uom: it.uom,
      qty: it.qty,
      reorderLevel: it.reorder_level,
      consumed30,
      received30,
      receipts: a?.receipts ?? 0,
      daysCover: daily > 0 ? Math.round((it.qty / daily) * 10) / 10 : null,
      weekly: weekMap.get(it.id) ?? weeks.map(() => 0),
    };
  });
  const series: WeekPoint[] = weeks.map((week) => {
    const hit = weekly.find((w) => w.week === week);
    return { week, consumed: hit?.consumed ?? 0, received: hit?.received ?? 0 };
  });
  return { rows, series };
});

function lastNWeeks(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  // Monday of this week
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d);
    x.setDate(d.getDate() - i * 7);
    const y = x.getFullYear();
    const m = String(x.getMonth() + 1).padStart(2, "0");
    const dd = String(x.getDate()).padStart(2, "0");
    out.push(`${y}-${m}-${dd}`);
  }
  return out;
}


// ---------------------------------------------------------------------------
// Multi-item indent (slip group)
// ---------------------------------------------------------------------------

export type SlipGroupItem = { itemCode: string; quantity: number };

export type SlipGroup = {
  id: number;
  groupToken: string;
  department: string;
  machineCode: string;
  station: string;
  hodConfirmed: boolean;
  slipDate: string;
  createdAt: string;
  slips: Slip[];
};

export const raiseSlipGroup = createServerFn({ method: "POST" })
  .validator(
    z.object({
      date: z.string().min(1),
      department: z.string().min(1),
      machine: z.string().min(1),
      cell: z.string().default(""),
      hodSignatureConfirmed: z.boolean(),
items: z
        .array(
          z.object({
            itemId: z.string().min(1),
            quantity: z.number().int().positive(),
            description: z.string().max(300).optional(),
          }),
        )
        .min(1),
    }),
  )
  .handler(async ({ data }) => {
    if (!data.hodSignatureConfirmed) {
      throw new Error("HOD authorisation is required — same as signing the paper slip.");
    }
    const sql = await getSql();
    await ensureSeed(sql);

    // Resolve machine by code or name
    const [machine] = await sql.query<MachineRow>(
      "select * from machines where lower(code) = lower($1) or lower(name) ilike $2 limit 1",
      [data.machine, `%${data.machine}%`],
    );
    if (!machine) throw new Error(`Machine not found: ${data.machine}`);

    // Parse date from DD-MM-YYYY or YYYY-MM-DD
    let slipDate = data.date;
    if (/^\d{2}-\d{2}-\d{4}$/.test(slipDate)) {
      const [dd, mm, yyyy] = slipDate.split("-");
      slipDate = `${yyyy}-${mm}-${dd}`;
    }

    // Create the group
    const [{ grpCount }] = await sql<{ grpCount: number }>`select count(*)::int as "grpCount" from slip_groups`;
    const now = new Date();
    const groupToken = `GRP-${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}-${String(grpCount + 1).padStart(4, "0")}`;
    const [grp] = await sql<{ id: number; group_token: string }>`
      insert into slip_groups (group_token, department, machine_code, station, hod_confirmed, slip_date)
      values (${groupToken}, ${data.department}, ${machine.code}, ${data.cell}, true, ${slipDate}::date)
      returning id, group_token
    `;

    const hodTitle = `${data.department} HOD`;
    const createdSlips: Slip[] = [];

    for (const line of data.items) {
      const [item] = await sql.query<ItemRow>(
        "select * from items where lower(code) = lower($1) or lower(name) ilike $2 limit 1",
        [line.itemId, `%${line.itemId}%`],
      );
      if (!item) throw new Error(`Item not found: ${line.itemId}`);

      const [{ n }] = await sql<{ n: number }>`select count(*)::int as n from slips`;
      const token = `SLIP-${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}-${String(n + 1).padStart(4, "0")}`;

await sql`
        insert into slips (
          token, item_id, machine_id, qty, department, station,
          hod_title, hod_confirmed, slip_date, status, slip_group_id, description
        ) values (
          ${token}, ${item.id}, ${machine.id}, ${line.quantity},
          ${data.department}, ${data.cell}, ${hodTitle}, true,
          ${slipDate}::date, 'pending', ${grp.id}, ${line.description ?? ""}
        )
      `;
      const [row] = await sql.query<SlipRow>(`${SLIP_SELECT} where s.token = $1`, [token]);
      createdSlips.push(mapSlip(row));
    }

    return {
      id: grp.id,
      groupToken: grp.group_token,
      department: data.department,
      machineCode: machine.code,
      station: data.cell,
      hodConfirmed: true,
      slipDate,
      createdAt: now.toISOString(),
      slips: createdSlips,
    } satisfies SlipGroup;
  });

export const requestNewItem = createServerFn({ method: "POST" })
  .validator(
    z.object({
      name: z.string().trim().min(2).max(80),
      category: z.string().min(1),
      uom: z.string().min(1),
      quantity: z.number().int().min(1).max(99999),
      description: z.string().max(300).optional(),
      date: z.string().min(1),
      department: z.string().min(1),
      machine: z.string().min(1),
      cell: z.string().default(""),
      hodSignatureConfirmed: z.boolean(),
    }),
  )
  .handler(async ({ data }) => {
    if (!data.hodSignatureConfirmed) {
      throw new Error("HOD authorisation is required — same as signing the paper slip.");
    }
    const sql = await getSql();
    await ensureSeed(sql);

    // Reuse an existing item with the same name, else create a new catalog entry.
    const [existing] = await sql.query<ItemRow>(
      "select * from items where lower(name) = lower($1)",
      [data.name.trim()],
    );
    let item = existing;
    const created = !existing;
    if (created) {
      const [{ n }] = await sql<{ n: number }>`select count(*)::int as n from items`;
      const code = `NEW-${String(n + 1).padStart(4, "0")}`;
      const [ins] = await sql<{ id: number }>`
        insert into items (code, name, uom, category, unit_price, qty, reorder_level)
        values (${code}, ${data.name.trim()}, ${data.uom}, ${data.category}, 0, 0, 1)
        returning id
      `;
      const [row] = await sql.query<ItemRow>("select * from items where id = $1", [ins.id]);
      item = row;
    }

    // Resolve machine by code or name
    const [machine] = await sql.query<MachineRow>(
      "select * from machines where lower(code) = lower($1) or lower(name) ilike $2 limit 1",
      [data.machine, `%${data.machine}%`],
    );
    if (!machine) throw new Error(`Machine not found: ${data.machine}`);

    // Parse date from DD-MM-YYYY or YYYY-MM-DD
    let slipDate = data.date;
    if (/^\d{2}-\d{2}-\d{4}$/.test(slipDate)) {
      const [dd, mm, yyyy] = slipDate.split("-");
      slipDate = `${yyyy}-${mm}-${dd}`;
    }

    const [{ grpCount }] = await sql<{ grpCount: number }>`select count(*)::int as "grpCount" from slip_groups`;
    const now = new Date();
    const groupToken = `GRP-${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}-${String(grpCount + 1).padStart(4, "0")}`;
    const [grp] = await sql<{ id: number; group_token: string }>`
      insert into slip_groups (group_token, department, machine_code, station, hod_confirmed, slip_date)
      values (${groupToken}, ${data.department}, ${machine.code}, ${data.cell}, true, ${slipDate}::date)
      returning id, group_token
    `;

    const [{ n }] = await sql<{ n: number }>`select count(*)::int as n from slips`;
    const slipToken = `SLIP-${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, "0")}-${String(n + 1).padStart(4, "0")}`;
    const note = created ? `New item requested — added to catalog as ${item.code}` : "Existing item — new request";
    await sql`
      insert into slips (
        token, item_id, machine_id, qty, department, station,
        hod_title, hod_confirmed, slip_date, status, slip_group_id, description, note
      ) values (
        ${slipToken}, ${item.id}, ${machine.id}, ${data.quantity},
        ${data.department}, ${data.cell}, ${data.department + " HOD"}, true,
        ${slipDate}::date, 'pending', ${grp.id}, ${data.description ?? ""}, ${note}
      )
    `;
    const [row] = await sql.query<SlipRow>(`${SLIP_SELECT} where s.token = $1`, [slipToken]);

    return {
      groupToken,
      created,
      slip: mapSlip(row),
    };
  });

export const listSlipGroups = createServerFn({ method: "GET" }).handler(async () => {
  const sql = await getSql();
  await ensureSeed(sql);

  const groups = await sql<{
    id: number;
    group_token: string;
    department: string;
    machine_code: string;
    station: string;
    hod_confirmed: boolean;
    slip_date: string;
    created_at: string;
  }>`select * from slip_groups order by created_at desc`;

  const allSlips = await sql.query<SlipRow & { slip_group_id: number }>(
    `${SLIP_SELECT} join slip_groups sg on sg.id = s.slip_group_id order by s.created_at desc`,
  );
  const slipsByGroup = new Map<number, Slip[]>();
  for (const row of allSlips) {
    const gid = row.slip_group_id;
    const list = slipsByGroup.get(gid) ?? [];
    list.push(mapSlip(row));
    slipsByGroup.set(gid, list);
  }

return groups.map((g) => ({
    id: g.id,
    groupToken: g.group_token,
    department: g.department,
    machineCode: g.machine_code,
    station: g.station,
    hodConfirmed: g.hod_confirmed,
    slipDate: g.slip_date,
    createdAt: String(g.created_at),
    slips: slipsByGroup.get(g.id) ?? [],
  } satisfies SlipGroup));
});

// ---------------------------------------------------------------------------
// Detailed requests feed for the Management/Requests view
// ---------------------------------------------------------------------------

export type RequestLine = {
  id: number;
  token: string;
  groupId: number | null;
  groupToken: string | null;
  status: SlipStatus;
  slipDate: string;
  department: string;
  cellStation: string;
  machineCode: string | null;
  machineName: string | null;
  hodConfirmed: boolean;
  hodTitle: string;
  decidedAt: string | null;
  note: string;
  description: string;
  itemId: number;
  itemCode: string;
  itemName: string;
  category: string;
  uom: string;
  currentStock: number;
  requestedQty: number;
  issuedQty: number;
  consumptionRate: number;
  unitPrice: number;
  totalCost: number;
  lastOrderedDate: string | null;
  lastOrderedQty: number | null;
  reorderLevel: number;
};

type RequestRow = {
  id: number;
  token: string;
  slip_group_id: number | null;
  group_token: string | null;
  status: string;
  slip_date: string;
  department: string;
  station: string;
  machine_code: string | null;
  machine_name: string | null;
  hod_confirmed: boolean;
  hod_title: string;
  decided_at: string | null;
  note: string;
  description: string;
  item_id: number;
  item_code: string;
  item_name: string;
  category: string;
  uom: string;
  current_stock: number;
  requested_qty: number;
  issued_qty: number;
  unit_price: string | number;
  reorder_level: number;
};

export const listRequests = createServerFn({ method: "GET" }).handler(async () => {
  const sql = await getSql();
  await ensureSeed(sql);

  const rows = await sql.query<RequestRow>(`
    select
      s.id, s.token, s.slip_group_id, sg.group_token,
      s.status, s.slip_date::text as slip_date, s.department, s.station,
      m.code as machine_code, m.name as machine_name,
      s.hod_confirmed, s.hod_title, s.decided_at::text as decided_at, s.note, s.description,
      s.item_id, i.code as item_code, i.name as item_name,
      i.category, i.uom, i.qty as current_stock,
      s.qty as requested_qty, s.issued_qty, i.unit_price, i.reorder_level
    from slips s
    join items i on i.id = s.item_id
    left join machines m on m.id = s.machine_id
    left join slip_groups sg on sg.id = s.slip_group_id
    order by s.created_at desc
  `);

  const consumed = await sql<{ item_id: number; consumed30: number }>`
    select
      item_id,
      coalesce(sum(case when kind = 'issue' then -qty else 0 end), 0)::int as consumed30
    from movements
    where created_at >= now() - interval '30 days'
    group by item_id
  `;
  const consumedMap = new Map(consumed.map((c) => [c.item_id, c.consumed30]));

  const lastReceived = await sql<{
    item_id: number;
    qty: number;
    created_at: string;
  }>`
    select distinct on (item_id) item_id, qty, created_at::text as created_at
    from movements
    where kind = 'receive'
    order by item_id, created_at desc
  `;
  const lastReceivedMap = new Map(
    lastReceived.map((r) => [r.item_id, { qty: Math.abs(r.qty), at: r.created_at }]),
  );

  return rows.map((r) => {
    const unitPrice = Number(r.unit_price) || 0;
    const last = lastReceivedMap.get(r.item_id) ?? null;
    return {
      id: r.id,
      token: r.token,
      groupId: r.slip_group_id,
      groupToken: r.group_token,
      status: r.status as SlipStatus,
      slipDate: r.slip_date,
      department: r.department,
      cellStation: r.station,
      machineCode: r.machine_code,
      machineName: r.machine_name,
      hodConfirmed: r.hod_confirmed,
      hodTitle: r.hod_title,
      decidedAt: r.decided_at,
      note: r.note,
      description: r.description,
      itemId: r.item_id,
      itemCode: r.item_code,
      itemName: r.item_name,
      category: r.category,
      uom: r.uom,
      currentStock: r.current_stock,
      requestedQty: r.requested_qty,
      issuedQty: r.issued_qty,
      consumptionRate: consumedMap.get(r.item_id) ?? 0,
      unitPrice,
      totalCost: Math.round(unitPrice * r.requested_qty * 100) / 100,
      lastOrderedDate: last?.at ?? null,
      lastOrderedQty: last?.qty ?? null,
      reorderLevel: r.reorder_level,
    } satisfies RequestLine;
  });
});
