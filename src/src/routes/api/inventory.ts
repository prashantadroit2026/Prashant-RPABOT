import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { ensureSeed } from "@/lib/plant-server";
import { stockStatus } from "@/lib/plant";

export const Route = createFileRoute("/api/inventory")({
  server: {
    handlers: {
      GET: async () => {
        const sql = await getSql();
        await ensureSeed(sql);
        const items = await sql<{ id: number; code: string; name: string; uom: string; reorder_level: number; qty: number }>`select * from items order by name`;
        const aggs = await sql<{ item_id: number; consumed30: number; received30: number }>`select item_id, coalesce(sum(case when kind='issue' and created_at >= now() - interval '30 days' then -qty else 0 end),0)::int as consumed30, coalesce(sum(case when kind='receive' and created_at >= now() - interval '30 days' then qty else 0 end),0)::int as received30 from movements group by item_id`;
        const weekly = await sql<{ item_id: number; week: string; consumed: number }>`select item_id, to_char(date_trunc('week', created_at), 'YYYY-MM-DD') as week, coalesce(sum(case when kind='issue' then -qty else 0 end),0)::int as consumed from movements where created_at >= now() - interval '56 days' group by item_id, date_trunc('week', created_at) order by week`;
        const aggMap = new Map(aggs.map((a) => [a.item_id, a]));
        const weekMap = new Map<number, number[]>();
        const weeks = lastNWeeks(8);
        for (const w of weekly) {
          const arr = weekMap.get(w.item_id) ?? weeks.map(() => 0);
          const idx = weeks.indexOf(w.week);
          if (idx >= 0) arr[idx] = w.consumed;
          weekMap.set(w.item_id, arr);
        }
        const rows = items.map((it) => {
          const a = aggMap.get(it.id);
          const consumed30 = a?.consumed30 ?? 0;
          const received30 = a?.received30 ?? 0;
          const daily = consumed30 / 30;
          return {
            id: it.id,
            code: it.code,
            name: it.name,
            uom: it.uom,
            reorderLevel: it.reorder_level,
            qty: it.qty,
            status: stockStatus(it.qty, it.reorder_level),
            consumed30,
            received30,
            daysCover: daily > 0 ? Math.round((it.qty / daily) * 10) / 10 : null,
            weekly: weekMap.get(it.id) ?? weeks.map(() => 0),
          };
        });
        return Response.json(rows);
      },
    },
  },
});

function lastNWeeks(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d);
    x.setDate(d.getDate() - i * 7);
    out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`);
  }
  return out;
}
