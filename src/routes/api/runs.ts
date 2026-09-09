import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";

function mapRun(r: Record<string, unknown>) {
  return {
    id: r.id,
    botId: r.bot_id,
    botCode: r.bot_code,
    botName: r.bot_name,
    status: r.status,
    trigger: r.trigger,
    startedAt: String(r.started_at),
    finishedAt: r.finished_at ? String(r.finished_at) : null,
    durationMs: r.duration_ms,
    input: r.input ?? {},
    output: r.output ?? null,
    error: r.error,
    createdAt: String(r.created_at),
  };
}

export const Route = createFileRoute("/api/runs")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const sql = await getSql();
        const url = new URL(request.url);
        const botId = url.searchParams.get("botId");
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 20)));
        if (botId) {
          const rows = await sql.query(`select r.id, r.bot_id, b.code as bot_code, b.name as bot_name, r.status, r.trigger, r.started_at::text as started_at, r.finished_at::text as finished_at, r.duration_ms, r.input, r.output, r.error, r.created_at::text as created_at from bot_runs r join bots b on b.id = r.bot_id where r.bot_id = $1 order by r.started_at desc limit $2`, [Number(botId), limit]);
          return Response.json((rows as Record<string, unknown>[]).map(mapRun));
        }
        const rows = await sql.query(`select r.id, r.bot_id, b.code as bot_code, b.name as bot_name, r.status, r.trigger, r.started_at::text as started_at, r.finished_at::text as finished_at, r.duration_ms, r.input, r.output, r.error, r.created_at::text as created_at from bot_runs r join bots b on b.id = r.bot_id order by r.started_at desc limit $1`, [limit]);
        return Response.json((rows as Record<string, unknown>[]).map(mapRun));
      },
    },
  },
});
