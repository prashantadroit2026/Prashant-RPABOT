import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";

function mapAlert(r: Record<string, unknown>) {
  return {
    id: r.id,
    severity: r.severity,
    title: r.title,
    message: r.message,
    botId: r.bot_id,
    botCode: r.bot_code,
    itemId: r.item_id,
    itemName: r.item_name,
    itemCode: r.item_code,
    acknowledged: r.acknowledged,
    createdAt: String(r.created_at),
  };
}

export const Route = createFileRoute("/api/alerts/")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const sql = await getSql();
        const { ensureSeed } = await import("@/lib/plant-server");
        await ensureSeed(sql);
        // auto-seed alerts if empty (migration 0003 ran before items were seeded)
        const [{ c }] = await sql<{ c: number }>`select count(*)::int as c from alerts`;
        if (c === 0) {
          await sql`insert into alerts (severity, title, message, item_id, acknowledged)
            select
              case when i.qty = 0 then 'critical' when i.qty <= i.reorder_level then 'warn' else 'info' end,
              case when i.qty = 0 then 'Out of stock: ' || i.name when i.qty <= i.reorder_level then 'Low stock: ' || i.name else 'Stock OK: ' || i.name end,
              'Qty ' || i.qty || ' ' || i.uom || ' vs reorder ' || i.reorder_level || '. Days cover computed from 30d consumption.',
              i.id,
              false
            from items i where i.qty <= i.reorder_level`;
        }
        const url = new URL(request.url);
        const severity = url.searchParams.get("severity");
        const ack = url.searchParams.get("acknowledged");
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 20)));
        if (severity && ack !== null) {
          const rows = await sql.query(`select a.id, a.severity, a.title, a.message, a.bot_id, b.code as bot_code, a.item_id, i.name as item_name, i.code as item_code, a.acknowledged, a.created_at::text as created_at from alerts a left join bots b on b.id=a.bot_id left join items i on i.id=a.item_id where a.severity=$1 and a.acknowledged=$2 order by a.created_at desc limit $3`, [severity, ack === "true", limit]);
          return Response.json((rows as Record<string, unknown>[]).map(mapAlert));
        }
        if (severity) {
          const rows = await sql.query(`select a.id, a.severity, a.title, a.message, a.bot_id, b.code as bot_code, a.item_id, i.name as item_name, i.code as item_code, a.acknowledged, a.created_at::text as created_at from alerts a left join bots b on b.id=a.bot_id left join items i on i.id=a.item_id where a.severity=$1 order by a.created_at desc limit $2`, [severity, limit]);
          return Response.json((rows as Record<string, unknown>[]).map(mapAlert));
        }
        if (ack !== null) {
          const rows = await sql.query(`select a.id, a.severity, a.title, a.message, a.bot_id, b.code as bot_code, a.item_id, i.name as item_name, i.code as item_code, a.acknowledged, a.created_at::text as created_at from alerts a left join bots b on b.id=a.bot_id left join items i on i.id=a.item_id where a.acknowledged=$1 order by a.created_at desc limit $2`, [ack === "true", limit]);
          return Response.json((rows as Record<string, unknown>[]).map(mapAlert));
        }
        const rows = await sql.query(`select a.id, a.severity, a.title, a.message, a.bot_id, b.code as bot_code, a.item_id, i.name as item_name, i.code as item_code, a.acknowledged, a.created_at::text as created_at from alerts a left join bots b on b.id=a.bot_id left join items i on i.id=a.item_id order by a.created_at desc limit $1`, [limit]);
        return Response.json((rows as Record<string, unknown>[]).map(mapAlert));
      },
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
        if (!body || typeof body.title !== "string") return Response.json({ error: "title required" }, { status: 400 });
        const severity = String(body.severity ?? "info");
        if (!["info", "warn", "critical"].includes(severity)) return Response.json({ error: "severity must be info|warn|critical" }, { status: 400 });
        const sql = await getSql();
        const [row] = await sql.query(`insert into alerts (severity, title, message, bot_id, item_id) values ($1,$2,$3,$4,$5) returning id, severity, title, message, bot_id, (select code from bots where id=alerts.bot_id) as bot_code, item_id, (select name from items where id=alerts.item_id) as item_name, (select code from items where id=alerts.item_id) as item_code, acknowledged, created_at::text as created_at`, [severity, String(body.title), String(body.message ?? ""), body.botId != null ? Number(body.botId) : null, body.itemId != null ? Number(body.itemId) : null]);
        return Response.json(mapAlert(row as Record<string, unknown>));
      },
    },
  },
});
