import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql, type Sql } from "@/lib/db";
import type { Alert, AuditLog, Bot, BotRun } from "@/lib/bot";

type BotRow = {
  id: number;
  code: string;
  name: string;
  description: string;
  type: string;
  status: string;
  cron_expr: string | null;
  config: unknown;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
};

type BotRunRow = {
  id: number;
  bot_id: number;
  bot_code: string | null;
  bot_name: string | null;
  status: string;
  trigger: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  input: unknown;
  output: unknown | null;
  error: string | null;
  created_at: string;
};

type AlertRow = {
  id: number;
  severity: string;
  title: string;
  message: string;
  bot_id: number | null;
  bot_code: string | null;
  item_id: number | null;
  item_name: string | null;
  item_code: string | null;
  acknowledged: boolean;
  created_at: string;
};

type AuditRow = {
  id: number;
  actor: string;
  action: string;
  entity_type: string;
  entity_id: string;
  payload: unknown;
  created_at: string;
};

function mapBot(r: BotRow): Bot {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    type: r.type as Bot["type"],
    status: r.status as Bot["status"],
    cronExpr: r.cron_expr,
    config: (r.config as Record<string, any>) ?? {},
    lastRunAt: r.last_run_at ? String(r.last_run_at) : null,
    nextRunAt: r.next_run_at ? String(r.next_run_at) : null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function mapRun(r: BotRunRow): BotRun {
  return {
    id: r.id,
    botId: r.bot_id,
    botCode: r.bot_code,
    botName: r.bot_name,
    status: r.status as BotRun["status"],
    trigger: r.trigger as BotRun["trigger"],
    startedAt: String(r.started_at),
    finishedAt: r.finished_at ? String(r.finished_at) : null,
    durationMs: r.duration_ms,
    input: (r.input as Record<string, any>) ?? {},
    output: (r.output as Record<string, any>) ?? null,
    error: r.error,
    createdAt: String(r.created_at),
  };
}

function mapAlert(r: AlertRow): Alert {
  return {
    id: r.id,
    severity: r.severity as Alert["severity"],
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

function mapAudit(r: AuditRow): AuditLog {
  return {
    id: r.id,
    actor: r.actor,
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    payload: (r.payload as Record<string, any>) ?? {},
    createdAt: String(r.created_at),
  };
}

async function logAudit(sql: Sql, actor: string, action: string, entityType: string, entityId: string, payload: unknown = {}) {
  await sql`insert into audit_logs (actor, action, entity_type, entity_id, payload) values (${actor}, ${action}, ${entityType}, ${entityId}, ${JSON.stringify(payload)}::jsonb)`;
}

// ---- BOTS ----

export const listBots = createServerFn({ method: "GET" }).handler(async () => {
  const sql = await getSql();
  const rows = await sql<BotRow>`select * from bots order by created_at`;
  return rows.map(mapBot);
});

export const getBot = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.number() }))
  .handler(async ({ data }) => {
    const sql = await getSql();
    const [row] = await sql<BotRow>`select * from bots where id = ${data.id}`;
    if (!row) throw new Error("Bot not found");
    return mapBot(row);
  });

export const createBot = createServerFn({ method: "POST" })
  .validator(
    z.object({
      code: z.string().min(2).max(30).regex(/^[A-Z0-9-]+$/, "Code must be UPPER-CODE"),
      name: z.string().min(2).max(80),
      description: z.string().max(500).optional().default(""),
      type: z.enum(["inventory", "slip", "reorder", "report", "generic"]).default("generic"),
      status: z.enum(["active", "paused", "error", "draft"]).default("draft"),
      cronExpr: z.string().max(100).nullable().optional(),
      config: z.record(z.string(), z.any()).optional().default({}),
    }),
  )
  .handler(async ({ data }) => {
    const sql = await getSql();
    try {
      const [row] = await sql<BotRow>`
        insert into bots (code, name, description, type, status, cron_expr, config)
        values (${data.code}, ${data.name}, ${data.description ?? ""}, ${data.type}, ${data.status}, ${data.cronExpr ?? null}, ${JSON.stringify(data.config ?? {})}::jsonb)
        returning *
      `;
      await logAudit(sql, "system", "bot.create", "bot", String(row.id), data);
      return mapBot(row);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("duplicate") || msg.includes("unique")) throw new Error(`Bot code ${data.code} already exists`);
      throw e;
    }
  });

export const updateBot = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.number(),
      name: z.string().min(2).max(80).optional(),
      description: z.string().max(500).optional(),
      type: z.enum(["inventory", "slip", "reorder", "report", "generic"]).optional(),
      status: z.enum(["active", "paused", "error", "draft"]).optional(),
      cronExpr: z.string().max(100).nullable().optional(),
      config: z.record(z.string(), z.any()).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const sql = await getSql();
    const [existing] = await sql<BotRow>`select * from bots where id = ${data.id}`;
    if (!existing) throw new Error("Bot not found");
    const [row] = await sql<BotRow>`
      update bots set
        name = coalesce(${data.name ?? null}, name),
        description = coalesce(${data.description ?? null}, description),
        type = coalesce(${data.type ?? null}, type),
        status = coalesce(${data.status ?? null}, status),
        cron_expr = case when ${data.cronExpr !== undefined ? 1 : 0}::int = 1 then ${data.cronExpr ?? null} else cron_expr end,
        config = case when ${data.config !== undefined ? 1 : 0}::int = 1 then ${JSON.stringify(data.config ?? {})}::jsonb else config end,
        updated_at = now()
      where id = ${data.id}
      returning *
    `;
    await logAudit(sql, "system", "bot.update", "bot", String(data.id), data);
    return mapBot(row);
  });

export const deleteBot = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.number() }))
  .handler(async ({ data }) => {
    const sql = await getSql();
    const [row] = await sql<BotRow>`delete from bots where id = ${data.id} returning *`;
    if (!row) throw new Error("Bot not found");
    await logAudit(sql, "system", "bot.delete", "bot", String(data.id), {});
    return { ok: true };
  });

export const triggerBot = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.number(), input: z.record(z.string(), z.any()).optional() }))
  .handler(async ({ data }) => {
    const sql = await getSql();
    const [bot] = await sql<BotRow>`select * from bots where id = ${data.id}`;
    if (!bot) throw new Error("Bot not found");
    if (bot.status === "paused") throw new Error("Bot is paused — resume before triggering");

    const isRpa = (bot as BotRow).code === "BOT-TCS-PRPO" || (bot as BotRow).code === "BOT-TCS-PR-PO";
    if (isRpa) {
      // Real RPA execution — spawn Python bot
      const input = (data.input ?? {}) as Record<string, unknown>;
      const itemCode = String(input.itemCode ?? input.item_code ?? input.code ?? "PCPWB60132");
      const qty = Number(input.qty ?? 10);
      const poType = String(input.poType ?? input.po_type ?? "Domestic");
      const currency = String(input.currency ?? "INR");

      // Quick check: credentials must exist
      const hasCreds = Boolean(process.env.TCS_USERNAME && process.env.TCS_PASSWORD);
      const started = new Date();
      let rpaResult: { ok: boolean; exitCode: number | null; durationMs: number; stdout: string; stderr: string; prNumber?: string | null } | null = null;

      if (!hasCreds) {
        // No creds → record a helpful failure (still creates a run so the UI shows it)
        rpaResult = {
          ok: false,
          exitCode: null,
          durationMs: 120,
          stdout: "",
          stderr: "TCS_USERNAME / TCS_PASSWORD not set. Set them in Bot/.env or env and retry. Example: TCS_USERNAME=... TCS_PASSWORD=... HEADLESS=true",
          prNumber: null,
        };
      } else {
        try {
          const { runRpaBot } = await import("@/lib/rpa-runner");
          rpaResult = await runRpaBot({ itemCode, qty, poType, currency, timeoutMs: 150_000 });
        } catch (e) {
          rpaResult = {
            ok: false,
            exitCode: null,
            durationMs: Date.now() - started.getTime(),
            stdout: "",
            stderr: `runner error: ${String(e)}`,
          };
        }
      }

      const finished = new Date(started.getTime() + (rpaResult?.durationMs ?? 0));
      const status = rpaResult?.ok ? "success" : "failed";
      const output = rpaResult?.ok
        ? { prNumber: rpaResult.prNumber ?? null, itemCode, qty, poType, currency, stdoutSnippet: (rpaResult.stdout || "").slice(-2000) }
        : { itemCode, qty, stdoutSnippet: (rpaResult?.stdout || "").slice(-2000) };
      const error = rpaResult?.ok ? null : (rpaResult?.stderr || "RPA failed").slice(0, 2000);

      const [run] = await sql<BotRunRow>`
        insert into bot_runs (bot_id, status, trigger, started_at, finished_at, duration_ms, input, output, error)
        values (${bot.id}, ${status}, 'manual', ${started.toISOString()}::timestamptz, ${finished.toISOString()}::timestamptz, ${rpaResult?.durationMs ?? 0}, ${JSON.stringify(data.input ?? {})}::jsonb, ${JSON.stringify(output)}::jsonb, ${error})
        returning id, bot_id, (select code from bots where id = bot_runs.bot_id) as bot_code, (select name from bots where id = bot_runs.bot_id) as bot_name, status, trigger, started_at::text as started_at, finished_at::text as finished_at, duration_ms, input, output, error, created_at::text as created_at
      `;
      await sql`update bots set last_run_at = ${finished.toISOString()}::timestamptz, updated_at = now() where id = ${bot.id}`;
      await logAudit(sql, "system", "bot.run", "bot", String(bot.id), { runId: run.id, trigger: "manual", rpa: true, ok: status === "success" });

      // Also create an alert on success so it shows on /system
      if (status === "success" && rpaResult?.prNumber) {
        try {
          await sql`insert into alerts (severity, title, message, bot_id) values ('info', ${`PR ${rpaResult.prNumber} created`}, ${`TCS bot created PR ${rpaResult.prNumber} for ${itemCode} x${qty} (${poType}/${currency})`}, ${bot.id})`;
        } catch { /* ignore */ }
      } else if (status === "failed") {
        try {
          await sql`insert into alerts (severity, title, message, bot_id) values ('warn', ${`TCS bot failed for ${itemCode}`}, ${String(error).slice(0, 400)}, ${bot.id})`;
        } catch { /* ignore */ }
      }

      const [full] = await sql.query<BotRunRow>(`select r.id, r.bot_id, b.code as bot_code, b.name as bot_name, r.status, r.trigger, r.started_at::text as started_at, r.finished_at::text as finished_at, r.duration_ms, r.input, r.output, r.error, r.created_at::text as created_at from bot_runs r join bots b on b.id = r.bot_id where r.id = $1`, [run.id]);
      return mapRun(full);
    }

    // Simulated bots (inventory/slip/etc.) — keep fast demo
    const started = new Date();
    const duration = 800 + Math.floor(Math.random() * 900);
    const finished = new Date(started.getTime() + duration);
    const isFail = Math.random() < 0.08;
    const [run] = await sql<BotRunRow>`
      insert into bot_runs (bot_id, status, trigger, started_at, finished_at, duration_ms, input, output, error)
      values (${bot.id}, ${isFail ? "failed" : "success"}, 'manual', ${started.toISOString()}::timestamptz, ${finished.toISOString()}::timestamptz, ${duration}, ${JSON.stringify(data.input ?? {})}::jsonb, ${JSON.stringify(isFail ? {} : { processed: 1, note: "manual trigger ok" })}::jsonb, ${isFail ? "simulated failure" : null})
      returning id, bot_id, (select code from bots where id = bot_runs.bot_id) as bot_code, (select name from bots where id = bot_runs.bot_id) as bot_name, status, trigger, started_at::text as started_at, finished_at::text as finished_at, duration_ms, input, output, error, created_at::text as created_at
    `;
    await sql`update bots set last_run_at = ${finished.toISOString()}::timestamptz, updated_at = now() where id = ${bot.id}`;
    await logAudit(sql, "system", "bot.run", "bot", String(bot.id), { runId: run.id, trigger: "manual" });
    const [full] = await sql.query<BotRunRow>(`select r.id, r.bot_id, b.code as bot_code, b.name as bot_name, r.status, r.trigger, r.started_at::text as started_at, r.finished_at::text as finished_at, r.duration_ms, r.input, r.output, r.error, r.created_at::text as created_at from bot_runs r join bots b on b.id = r.bot_id where r.id = $1`, [run.id]);
    return mapRun(full);
  });

// ---- RUNS ----

export const listBotRuns = createServerFn({ method: "GET" })
  .validator(z.object({ botId: z.number().optional(), limit: z.number().min(1).max(100).optional() }).optional())
  .handler(async ({ data }) => {
    const sql = await getSql();
    const limit = data?.limit ?? 20;
    if (data?.botId) {
      const rows = await sql.query<BotRunRow>(
        `select r.id, r.bot_id, b.code as bot_code, b.name as bot_name, r.status, r.trigger, r.started_at::text as started_at, r.finished_at::text as finished_at, r.duration_ms, r.input, r.output, r.error, r.created_at::text as created_at from bot_runs r join bots b on b.id = r.bot_id where r.bot_id = $1 order by r.started_at desc limit $2`,
        [data.botId, limit],
      );
      return rows.map(mapRun);
    }
    const rows = await sql.query<BotRunRow>(
      `select r.id, r.bot_id, b.code as bot_code, b.name as bot_name, r.status, r.trigger, r.started_at::text as started_at, r.finished_at::text as finished_at, r.duration_ms, r.input, r.output, r.error, r.created_at::text as created_at from bot_runs r join bots b on b.id = r.bot_id order by r.started_at desc limit $1`,
      [limit],
    );
    return rows.map(mapRun);
  });

export const getBotStats = createServerFn({ method: "GET" }).handler(async () => {
  const sql = await getSql();
  const [tot] = await sql<{ total: number; active: number; paused: number; error: number }>`
    select count(*)::int as total, count(*) filter (where status='active')::int as active, count(*) filter (where status='paused')::int as paused, count(*) filter (where status='error')::int as error from bots
  `;
  const [runs] = await sql<{ total: number; success: number; failed: number; running: number }>`
    select count(*)::int as total, count(*) filter (where status='success')::int as success, count(*) filter (where status='failed')::int as failed, count(*) filter (where status='running')::int as running from bot_runs where started_at >= now() - interval '24 hours'
  `;
  const [alerts] = await sql<{ total: number; unack: number; critical: number }>`
    select count(*)::int as total, count(*) filter (where acknowledged=false)::int as unack, count(*) filter (where severity='critical' and acknowledged=false)::int as critical from alerts
  `;
  return { bots: tot, runs, alerts };
});

// ---- ALERTS ----

export const listAlerts = createServerFn({ method: "GET" })
  .validator(z.object({ acknowledged: z.boolean().optional(), severity: z.enum(["info", "warn", "critical"]).optional(), limit: z.number().min(1).max(100).optional() }).optional())
  .handler(async ({ data }) => {
    const sql = await getSql();
    let rows: AlertRow[];
    const limit = data?.limit ?? 20;
    if (data?.severity && data?.acknowledged !== undefined) {
      rows = await sql.query<AlertRow>(
        `select a.id, a.severity, a.title, a.message, a.bot_id, b.code as bot_code, a.item_id, i.name as item_name, i.code as item_code, a.acknowledged, a.created_at::text as created_at from alerts a left join bots b on b.id = a.bot_id left join items i on i.id = a.item_id where a.severity=$1 and a.acknowledged=$2 order by a.created_at desc limit $3`,
        [data.severity, data.acknowledged, limit],
      );
    } else if (data?.severity) {
      rows = await sql.query<AlertRow>(
        `select a.id, a.severity, a.title, a.message, a.bot_id, b.code as bot_code, a.item_id, i.name as item_name, i.code as item_code, a.acknowledged, a.created_at::text as created_at from alerts a left join bots b on b.id = a.bot_id left join items i on i.id = a.item_id where a.severity=$1 order by a.created_at desc limit $2`,
        [data.severity, limit],
      );
    } else if (data?.acknowledged !== undefined) {
      rows = await sql.query<AlertRow>(
        `select a.id, a.severity, a.title, a.message, a.bot_id, b.code as bot_code, a.item_id, i.name as item_name, i.code as item_code, a.acknowledged, a.created_at::text as created_at from alerts a left join bots b on b.id = a.bot_id left join items i on i.id = a.item_id where a.acknowledged=$1 order by a.created_at desc limit $2`,
        [data.acknowledged, limit],
      );
    } else {
      rows = await sql.query<AlertRow>(
        `select a.id, a.severity, a.title, a.message, a.bot_id, b.code as bot_code, a.item_id, i.name as item_name, i.code as item_code, a.acknowledged, a.created_at::text as created_at from alerts a left join bots b on b.id = a.bot_id left join items i on i.id = a.item_id order by a.created_at desc limit $1`,
        [limit],
      );
    }
    return rows.map(mapAlert);
  });

export const acknowledgeAlert = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.number() }))
  .handler(async ({ data }) => {
    const sql = await getSql();
    const [row] = await sql.query<AlertRow>(
      `update alerts set acknowledged=true where id=$1 returning id, severity, title, message, bot_id, (select code from bots where id=alerts.bot_id) as bot_code, item_id, (select name from items where id=alerts.item_id) as item_name, (select code from items where id=alerts.item_id) as item_code, acknowledged, created_at::text as created_at`,
      [data.id],
    );
    if (!row) throw new Error("Alert not found");
    await logAudit(sql, "system", "alert.ack", "alert", String(data.id), {});
    return mapAlert(row);
  });

export const createAlert = createServerFn({ method: "POST" })
  .validator(
    z.object({
      severity: z.enum(["info", "warn", "critical"]),
      title: z.string().min(2).max(120),
      message: z.string().max(1000).optional().default(""),
      botId: z.number().nullable().optional(),
      itemId: z.number().nullable().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const sql = await getSql();
    const [row] = await sql.query<AlertRow>(
      `insert into alerts (severity, title, message, bot_id, item_id) values ($1,$2,$3,$4,$5) returning id, severity, title, message, bot_id, (select code from bots where id=alerts.bot_id) as bot_code, item_id, (select name from items where id=alerts.item_id) as item_name, (select code from items where id=alerts.item_id) as item_code, acknowledged, created_at::text as created_at`,
      [data.severity, data.title, data.message ?? "", data.botId ?? null, data.itemId ?? null],
    );
    return mapAlert(row);
  });

// ---- AUDIT ----

export const listAuditLogs = createServerFn({ method: "GET" })
  .validator(z.object({ limit: z.number().min(1).max(100).optional() }).optional())
  .handler(async ({ data }) => {
    const sql = await getSql();
    const rows = await sql.query<AuditRow>(`select id, actor, action, entity_type, entity_id, payload, created_at::text as created_at from audit_logs order by created_at desc limit $1`, [data?.limit ?? 20]);
    return rows.map(mapAudit);
  });
