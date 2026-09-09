import { defineHandler } from "nitro";
import { getSql } from "../../../src/lib/db";

export default defineHandler(async (event) => {
  if ((event.req.method ?? "GET").toUpperCase() !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers: { "content-type": "application/json" } });
  }
  const body = await event.req.json().catch(() => null) as { id?: number; input?: Record<string, unknown> } | null;
  if (!body || typeof body.id !== "number") return new Response(JSON.stringify({ error: "id required" }), { status: 400, headers: { "content-type": "application/json" } });
  const sql = await getSql();
  const [bot] = await sql`select * from bots where id = ${body.id}`;
  if (!bot) return new Response(JSON.stringify({ error: "Bot not found" }), { status: 404, headers: { "content-type": "application/json" } });
  if ((bot as Record<string, unknown>).status === "paused") return new Response(JSON.stringify({ error: "Bot is paused — resume before triggering" }), { status: 400, headers: { "content-type": "application/json" } });
  const botCode = String((bot as Record<string, unknown>).code ?? "");
  const isRpa = botCode === "BOT-TCS-PRPO" || botCode === "BOT-TCS-PR-PO";
  if (isRpa) {
    const input = (body.input ?? {}) as Record<string, unknown>;
    const itemCode = String(input.itemCode ?? input.item_code ?? "PCPWB60132");
    const qty = Number(input.qty ?? 10);
    const hasCreds = Boolean(process.env.TCS_USERNAME && process.env.TCS_PASSWORD);
    const started = new Date();
    let rpaResult: { ok: boolean; exitCode: number | null; durationMs: number; stdout: string; stderr: string; prNumber?: string | null } | null = null;
    if (!hasCreds) {
      rpaResult = { ok: false, exitCode: null, durationMs: 120, stdout: "", stderr: "TCS_USERNAME / TCS_PASSWORD not set. Set them in Bot/.env and retry.", prNumber: null };
    } else {
      try {
        const { runRpaBot } = await import("../../../src/lib/rpa-runner");
        rpaResult = await runRpaBot({ itemCode, qty, poType: String(input.poType ?? "Domestic"), currency: String(input.currency ?? "INR"), timeoutMs: 150_000 });
      } catch (e) {
        rpaResult = { ok: false, exitCode: null, durationMs: Date.now() - started.getTime(), stdout: "", stderr: String(e) };
      }
    }
    const finished = new Date(started.getTime() + (rpaResult?.durationMs ?? 0));
    const status = rpaResult?.ok ? "success" : "failed";
    const output = rpaResult?.ok ? { prNumber: rpaResult.prNumber ?? null, itemCode, qty, stdoutSnippet: (rpaResult.stdout || "").slice(-2000) } : { itemCode, qty, stdoutSnippet: (rpaResult?.stdout || "").slice(-2000) };
    const error = rpaResult?.ok ? null : String(rpaResult?.stderr || "RPA failed").slice(0, 2000);
    const [run] = await sql.query(
      `insert into bot_runs (bot_id, status, trigger, started_at, finished_at, duration_ms, input, output, error) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9) returning id, bot_id, (select code from bots where id=bot_runs.bot_id) as bot_code, (select name from bots where id=bot_runs.bot_id) as bot_name, status, trigger, started_at::text as started_at, finished_at::text as finished_at, duration_ms, input, output, error, created_at::text as created_at`,
      [bot.id, status, "manual", started.toISOString(), finished.toISOString(), rpaResult?.durationMs ?? 0, JSON.stringify(body.input ?? {}), JSON.stringify(output), error],
    );
    await sql`update bots set last_run_at = ${finished.toISOString()}::timestamptz, updated_at = now() where id = ${(bot as Record<string, unknown>).id as number}`;
    if (status === "success" && rpaResult?.prNumber) {
      try { await sql`insert into alerts (severity, title, message, bot_id) values ('info', ${`PR ${rpaResult.prNumber} created`}, ${`TCS bot created PR ${rpaResult.prNumber} for ${itemCode} x${qty}`}, ${bot.id})`; } catch { /* ignore */ }
    } else if (status === "failed") {
      try { await sql`insert into alerts (severity, title, message, bot_id) values ('warn', ${`TCS bot failed for ${itemCode}`}, ${String(error).slice(0, 400)}, ${bot.id})`; } catch { /* ignore */ }
    }
    return run as unknown as Record<string, unknown>;
  }
  const started = new Date();
  const duration = 800 + Math.floor(Math.random() * 900);
  const finished = new Date(started.getTime() + duration);
  const isFail = Math.random() < 0.08;
  const [run] = await sql.query(
    `insert into bot_runs (bot_id, status, trigger, started_at, finished_at, duration_ms, input, output, error) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9) returning id, bot_id, (select code from bots where id=bot_runs.bot_id) as bot_code, (select name from bots where id=bot_runs.bot_id) as bot_name, status, trigger, started_at::text as started_at, finished_at::text as finished_at, duration_ms, input, output, error, created_at::text as created_at`,
    [bot.id, isFail ? "failed" : "success", "manual", started.toISOString(), finished.toISOString(), duration, JSON.stringify(body.input ?? {}), JSON.stringify(isFail ? {} : { processed: 1, note: "manual trigger ok" }), isFail ? "simulated failure" : null],
  );
  await sql`update bots set last_run_at = ${finished.toISOString()}::timestamptz, updated_at = now() where id = ${(bot as Record<string, unknown>).id as number}`;
  return run as unknown as Record<string, unknown>;
});
