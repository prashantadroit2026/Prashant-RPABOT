import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";

export const Route = createFileRoute("/api/alerts/acknowledge")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => null)) as { id?: number } | null;
        if (!body || typeof body.id !== "number") return Response.json({ error: "id required" }, { status: 400 });
        const sql = await getSql();
        const [row] = await sql.query(`update alerts set acknowledged=true where id=$1 returning id, severity, title, message, bot_id, (select code from bots where id=alerts.bot_id) as bot_code, item_id, (select name from items where id=alerts.item_id) as item_name, (select code from items where id=alerts.item_id) as item_code, acknowledged, created_at::text as created_at`, [body.id]);
        if (!row) return Response.json({ error: "Alert not found" }, { status: 404 });
        return Response.json(row as unknown as Record<string, unknown>);
      },
    },
  },
});
