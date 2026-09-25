import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Alert, AuditLog, Bot, BotRun } from "@/lib/bot";
import {
  backendDelete,
  backendFetch,
  backendPost,
  backendPut,
} from "@/lib/backend-client";

function asString(v: unknown): string {
  return v == null ? "" : String(v);
}

function coerceBot(b: Bot): Bot {
  return {
    ...b,
    cronExpr: b.cronExpr ?? null,
    config: b.config ?? {},
    lastRunAt: b.lastRunAt ? asString(b.lastRunAt) : null,
    nextRunAt: b.nextRunAt ? asString(b.nextRunAt) : null,
  };
}

function coerceRun(r: BotRun): BotRun {
  return {
    ...r,
    startedAt: asString(r.startedAt),
    finishedAt: r.finishedAt ? asString(r.finishedAt) : null,
    input: r.input ?? {},
    output: r.output ?? null,
  };
}

// ---- BOTS ----

export const listBots = createServerFn({ method: "GET" }).handler(async () => {
  const rows = await backendFetch<Bot[]>("/api/bots");
  return rows.map(coerceBot);
});

export const getBot = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.number() }))
  .handler(async ({ data }) => {
    const bot = await backendFetch<Bot>(`/api/bots/${data.id}`);
    return coerceBot(bot);
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
    const bot = await backendPost<Bot>("/api/bots", {
      code: data.code,
      name: data.name,
      description: data.description ?? "",
      type: data.type,
      status: data.status,
      cronExpr: data.cronExpr ?? null,
      config: data.config ?? {},
    });
    return coerceBot(bot);
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
    const bot = await backendPut<Bot>(`/api/bots/${data.id}`, {
      name: data.name,
      description: data.description,
      type: data.type,
      status: data.status,
      cronExpr: data.cronExpr,
      config: data.config,
    });
    return coerceBot(bot);
  });

export const deleteBot = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.number() }))
  .handler(async ({ data }) => {
    return backendDelete<{ ok: boolean }>(`/api/bots/${data.id}`);
  });

export const triggerBot = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.number(), input: z.record(z.string(), z.any()).optional() }))
  .handler(async ({ data }) => {
    const run = await backendPost<BotRun>("/api/bots/trigger", {
      id: data.id,
      input: data.input ?? {},
    });
    return coerceRun(run);
  });

// ---- RUNS ----

export const listBotRuns = createServerFn({ method: "GET" })
  .validator(z.object({ botId: z.number().optional(), limit: z.number().min(1).max(100).optional() }).optional())
  .handler(async ({ data }) => {
    const qs = new URLSearchParams({ limit: String(data?.limit ?? 20) });
    if (data?.botId) qs.set("botId", String(data.botId));
    const rows = await backendFetch<BotRun[]>(`/api/runs?${qs.toString()}`);
    return rows.map(coerceRun);
  });

export const getBotStats = createServerFn({ method: "GET" }).handler(async () => {
  return backendFetch<{
    bots: { total: number; active: number; paused: number; error: number };
    runs: { total: number; success: number; failed: number; running: number };
    alerts: { total: number; unack: number; critical: number };
  }>("/api/bot-stats");
});

// ---- ALERTS ----

export const listAlerts = createServerFn({ method: "GET" })
  .validator(z.object({ acknowledged: z.boolean().optional(), severity: z.enum(["info", "warn", "critical"]).optional(), limit: z.number().min(1).max(100).optional() }).optional())
  .handler(async ({ data }) => {
    const qs = new URLSearchParams({ limit: String(data?.limit ?? 20) });
    if (data?.severity) qs.set("severity", data.severity);
    if (data?.acknowledged !== undefined) qs.set("acknowledged", String(data.acknowledged));
    return backendFetch<Alert[]>(`/api/alerts?${qs.toString()}`);
  });

export const acknowledgeAlert = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.number() }))
  .handler(async ({ data }) => {
    return backendPost<Alert>("/api/alerts/acknowledge", { id: data.id });
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
    return backendPost<Alert>("/api/alerts", {
      severity: data.severity,
      title: data.title,
      message: data.message ?? "",
      botId: data.botId ?? null,
      itemId: data.itemId ?? null,
    });
  });

// ---- AUDIT ----

export const listAuditLogs = createServerFn({ method: "GET" })
  .validator(z.object({ limit: z.number().min(1).max(100).optional() }).optional())
  .handler(async ({ data }) => {
    const rows = await backendFetch<AuditLog[]>(`/api/audit?limit=${data?.limit ?? 20}`);
    return rows.map((r) => ({
      ...r,
      payload: r.payload ?? {},
      createdAt: asString(r.createdAt),
    }));
  });