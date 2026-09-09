import { defineHandler } from "nitro";

export default defineHandler(() => {
  const spec = {
    openapi: "3.0.3",
    info: {
      title: "Procurement Hub — Bot Dashboard API",
      version: "1.0.0",
      description: "Plant store (items, slips, inventory) + Bot Dashboard (bots, runs, alerts). All endpoints are JSON. Auth is disabled in this deployment (VITE_AUTH_ENABLED=false) — rows are unowned. Enable auth to scope by user_id.",
    },
    servers: [{ url: "/", description: "Current origin" }],
    tags: [
      { name: "health", description: "Service health" },
      { name: "catalog", description: "Item & machine master" },
      { name: "inventory", description: "Rack, consumption, days-of-cover" },
      { name: "machines", description: "Per-machine consumption" },
      { name: "refill", description: "Refill dashboard" },
      { name: "slips", description: "Digital requisition slips" },
      { name: "bots", description: "RPA bots" },
      { name: "runs", description: "Bot execution history" },
      { name: "alerts", description: "System alerts" },
    ],
    paths: {
      "/api/health": {
        get: {
          tags: ["health"],
          summary: "Health check",
          responses: { "200": { description: "OK", content: { "application/json": { example: { ok: true, service: "procurement-hub", version: "1.0.0" } } } } },
        },
      },
      "/api/catalog": {
        get: {
          tags: ["catalog"],
          summary: "List items & machines",
          responses: { "200": { description: "Catalog" } },
        },
      },
      "/api/inventory": {
        get: {
          tags: ["inventory"],
          summary: "Inventory with 30d consumption",
          responses: { "200": { description: "Rows" } },
        },
      },
      "/api/machines": {
        get: {
          tags: ["machines"],
          summary: "Machine stats",
          responses: { "200": { description: "Stats" } },
        },
      },
      "/api/refill": {
        get: {
          tags: ["refill"],
          summary: "Refill dashboard",
          responses: { "200": { description: "Rows + weekly series" } },
        },
      },
      "/api/slips": {
        get: {
          tags: ["slips"],
          summary: "List slips",
          parameters: [{ name: "status", in: "query", schema: { type: "string", enum: ["pending", "issued", "partial", "pr_open", "received"] } }],
          responses: { "200": { description: "Slips" } },
        },
        post: {
          tags: ["slips"],
          summary: "Raise a slip",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                example: {
                  itemId: 1,
                  machineId: 2,
                  qty: 5,
                  department: "Production",
                  station: "Lathe cell",
                  hodTitle: "Production HOD",
                  hodConfirmed: true,
                  slipDate: "2026-09-08",
                },
              },
            },
          },
          responses: { "200": { description: "Created slip" }, "400": { description: "Validation error" } },
        },
      },
      "/api/slips/decide": {
        post: {
          tags: ["slips"],
          summary: "Decide a pending slip",
          requestBody: {
            required: true,
            content: {
              "application/json": { example: { id: 1, mode: "stock" } },
            },
          },
          responses: { "200": { description: "Updated slip" } },
        },
      },
      "/api/slips/receive": {
        post: {
          tags: ["slips"],
          summary: "Mark PR received",
          requestBody: { required: true, content: { "application/json": { example: { id: 1 } } } },
          responses: { "200": { description: "Received" } },
        },
      },
      "/api/bots": {
        get: {
          tags: ["bots"],
          summary: "List bots",
          parameters: [
            { name: "status", in: "query", schema: { type: "string", enum: ["active", "paused", "error", "draft"] } },
            { name: "type", in: "query", schema: { type: "string", enum: ["inventory", "slip", "reorder", "report", "generic"] } },
          ],
          responses: { "200": { description: "Bots" } },
        },
        post: {
          tags: ["bots"],
          summary: "Create bot",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                example: { code: "BOT-TEST", name: "Test Bot", type: "generic", status: "draft", cronExpr: "*/5 * * * *" },
              },
            },
          },
          responses: { "200": { description: "Created" } },
        },
      },
      "/api/bots/trigger": {
        post: {
          tags: ["bots"],
          summary: "Trigger a bot run",
          requestBody: { required: true, content: { "application/json": { example: { id: 1, input: {} } } } },
          responses: { "200": { description: "Run" } },
        },
      },
      "/api/runs": {
        get: {
          tags: ["runs"],
          summary: "List runs",
          parameters: [
            { name: "botId", in: "query", schema: { type: "integer" } },
            { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
          ],
          responses: { "200": { description: "Runs" } },
        },
      },
      "/api/alerts": {
        get: {
          tags: ["alerts"],
          summary: "List alerts",
          parameters: [
            { name: "severity", in: "query", schema: { type: "string", enum: ["info", "warn", "critical"] } },
            { name: "acknowledged", in: "query", schema: { type: "boolean" } },
          ],
          responses: { "200": { description: "Alerts" } },
        },
        post: {
          tags: ["alerts"],
          summary: "Create alert",
          requestBody: { required: true, content: { "application/json": { example: { severity: "warn", title: "Low stock", message: "..." } } } },
          responses: { "200": { description: "Alert" } },
        },
      },
      "/api/alerts/acknowledge": {
        post: {
          tags: ["alerts"],
          summary: "Acknowledge alert",
          requestBody: { required: true, content: { "application/json": { example: { id: 1 } } } },
          responses: { "200": { description: "Updated alert" } },
        },
      },
    },
  };
  return new Response(JSON.stringify(spec), { headers: { "content-type": "application/json", "cache-control": "no-cache" } });
});
