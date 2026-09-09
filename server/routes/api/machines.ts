import { defineHandler } from "nitro";
import { getSql } from "../../../src/lib/db";

export default defineHandler(async () => {
  const sql = await getSql();
  const { ensureSeed } = await import("../../../src/lib/plant-server");
  await ensureSeed(sql);
  const machines = await sql<{ id: number; code: string; name: string; line: string }>`select * from machines order by code`;
  const totals = await sql<{ machine_id: number; consumed30: number; distinct_items: number }>`select machine_id, coalesce(sum(case when kind='issue' and created_at >= now() - interval '30 days' then -qty else 0 end),0)::int as consumed30, count(distinct case when kind='issue' then item_id end)::int as distinct_items from movements where machine_id is not null group by machine_id`;
  const breakdown = await sql<{ machine_id: number; item_name: string; item_code: string; uom: string; qty: number }>`select mv.machine_id, i.name as item_name, i.code as item_code, i.uom, coalesce(sum(case when mv.kind='issue' then -mv.qty else 0 end),0)::int as qty from movements mv join items i on i.id = mv.item_id where mv.machine_id is not null group by mv.machine_id, i.name, i.code, i.uom having coalesce(sum(case when mv.kind='issue' then -mv.qty else 0 end),0) > 0 order by qty desc`;
  const totMap = new Map(totals.map((t) => [t.machine_id, t]));
  const byMc = new Map<number, { itemName: string; itemCode: string; qty: number; uom: string }[]>();
  for (const b of breakdown) {
    const list = byMc.get(b.machine_id) ?? [];
    list.push({ itemName: b.item_name, itemCode: b.item_code, qty: b.qty, uom: b.uom });
    byMc.set(b.machine_id, list);
  }
  return machines.map((m) => {
    const t = totMap.get(m.id);
    const rows = byMc.get(m.id) ?? [];
    return {
      id: m.id,
      code: m.code,
      name: m.name,
      line: m.line,
      consumed30: t?.consumed30 ?? 0,
      distinctItems: t?.distinct_items ?? 0,
      topItem: rows[0]?.itemName ?? null,
      rows,
    };
  });
});
