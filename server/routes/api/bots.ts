import { defineHandler } from "nitro";
import { getSql } from "../../../src/lib/db";

function mapBot(r: Record<string, unknown>) {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    type: r.type,
    status: r.status,
    cronExpr: r.cron_expr,
    config: r.config ?? {},
    lastRunAt: r.last_run_at ? String(r.last_run_at) : null,
    nextRunAt: r.next_run_at ? String(r.next_run_at) : null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

export default defineHandler(async (event) => {
  const sql = await getSql();
  const method = event.req.method?.toUpperCase() ?? "GET";
  if (method === "GET") {
    const url = new URL(event.req.url ?? "http://localhost/api/bots", "http://localhost");
    const status = url.searchParams.get("status");
    const type = url.searchParams.get("type");
    if (status && type) {
      const rows = await sql.query(`select * from bots where status=$1 and type=$2 order by created_at`, [status, type]);
      return (rows as Record<string, unknown>[]).map(mapBot);
    }
    if (status) {
      const rows = await sql.query(`select * from bots where status=$1 order by created_at`, [status]);
      return (rows as Record<string, unknown>[]).map(mapBot);
    }
    if (type) {
      const rows = await sql.query(`select * from bots where type=$1 order by created_at`, [type]);
      return (rows as Record<string, unknown>[]).map(mapBot);
    }
    const rows = await sql`select * from bots order by created_at`;
    return (rows as unknown as Record<string, unknown>[]).map(mapBot);
  }
  if (method === "POST") {
    const body = await event.req.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body.code !== "string" || typeof body.name !== "string") {
      return new Response(JSON.stringify({ error: "code and name are required" }), { status: 400, headers: { "content-type": "application/json" } });
    }
    const code = String(body.code).toUpperCase().trim();
    if (!/^[A-Z0-9-]+$/.test(code)) return new Response(JSON.stringify({ error: "Code must be UPPER-CODE (A-Z, 0-9, -)" }), { status: 400, headers: { "content-type": "application/json" } });
    const name = String(body.name).trim();
    if (name.length < 2) return new Response(JSON.stringify({ error: "name too short" }), { status: 400, headers: { "content-type": "application/json" } });
    const type = String(body.type ?? "generic");
    const status = String(body.status ?? "draft");
    const cronExpr = body.cronExpr != null ? String(body.cronExpr) : null;
    const config = body.config && typeof body.config === "object" ? body.config : {};
    try {
      const [row] = await sql.query(`insert into bots (code, name, description, type, status, cron_expr, config) values ($1,$2,$3,$4,$5,$6,$7::jsonb) returning *`, [code, name, String(body.description ?? ""), type, status, cronExpr, JSON.stringify(config)]);
      return mapBot(row as Record<string, unknown>);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("duplicate") || msg.includes("unique")) return new Response(JSON.stringify({ error: `Bot code ${code} already exists` }), { status: 409, headers: { "content-type": "application/json" } });
      throw e;
    }
  }
  return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { "content-type": "application/json" } });
});
