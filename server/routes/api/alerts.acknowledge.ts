import { defineHandler } from "nitro";
import { getSql } from "../../../src/lib/db";

export default defineHandler(async (event) => {
  if ((event.req.method ?? "GET").toUpperCase() !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: { "content-type": "application/json" } });
  }
  const body = await event.req.json().catch(() => null) as { id?: number } | null;
  if (!body || typeof body.id !== "number") return new Response(JSON.stringify({ error: "id required" }), { status: 400, headers: { "content-type": "application/json" } });
  const sql = await getSql();
  const [row] = await sql.query(`update alerts set acknowledged=true where id=$1 returning id, severity, title, message, bot_id, (select code from bots where id=alerts.bot_id) as bot_code, item_id, (select name from items where id=alerts.item_id) as item_name, (select code from items where id=alerts.item_id) as item_code, acknowledged, created_at::text as created_at`, [body.id]);
  if (!row) return new Response(JSON.stringify({ error: "Alert not found" }), { status: 404, headers: { "content-type": "application/json" } });
  return row as unknown as Record<string, unknown>;
});
