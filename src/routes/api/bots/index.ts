import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";

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

export const Route = createFileRoute("/api/bots/")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const sql = await getSql();
        const url = new URL(request.url);
        const status = url.searchParams.get("status");
        const type = url.searchParams.get("type");
        if (status && type) {
          const rows = await sql.query(`select * from bots where status=$1 and type=$2 order by created_at`, [status, type]);
          return Response.json((rows as Record<string, unknown>[]).map(mapBot));
        }
        if (status) {
          const rows = await sql.query(`select * from bots where status=$1 order by created_at`, [status]);
          return Response.json((rows as Record<string, unknown>[]).map(mapBot));
        }
        if (type) {
          const rows = await sql.query(`select * from bots where type=$1 order by created_at`, [type]);
          return Response.json((rows as Record<string, unknown>[]).map(mapBot));
        }
        const rows = await sql`select * from bots order by created_at`;
        return Response.json((rows as unknown as Record<string, unknown>[]).map(mapBot));
      },
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
        if (!body || typeof body.code !== "string" || typeof body.name !== "string") {
          return Response.json({ error: "code and name are required" }, { status: 400 });
        }
        const code = String(body.code).toUpperCase().trim();
        if (!/^[A-Z0-9-]+$/.test(code)) return Response.json({ error: "Code must be UPPER-CODE (A-Z, 0-9, -)" }, { status: 400 });
        const name = String(body.name).trim();
        if (name.length < 2) return Response.json({ error: "name too short" }, { status: 400 });
        const type = String(body.type ?? "generic");
        const status = String(body.status ?? "draft");
        const cronExpr = body.cronExpr != null ? String(body.cronExpr) : null;
        const config = body.config && typeof body.config === "object" ? body.config : {};
        const sql = await getSql();
        try {
          const [row] = await sql.query(`insert into bots (code, name, description, type, status, cron_expr, config) values ($1,$2,$3,$4,$5,$6,$7::jsonb) returning *`, [code, name, String(body.description ?? ""), type, status, cronExpr, JSON.stringify(config)]);
          return Response.json(mapBot(row as Record<string, unknown>));
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("duplicate") || msg.includes("unique")) return Response.json({ error: `Bot code ${code} already exists` }, { status: 409 });
          throw e;
        }
      },
    },
  },
});
