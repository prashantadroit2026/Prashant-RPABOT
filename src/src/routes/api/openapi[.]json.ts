import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/openapi.json")({
  server: {
    handlers: {
      GET: async () => {
        const spec = {
          openapi: "3.0.3",
          info: {
            title: "Procurement Hub — Bot Dashboard API",
            version: "1.0.0",
            description: "Plant store (items, slips, inventory) + Bot Dashboard (bots, runs, alerts). JSON, no auth in this deployment. See /system for ER & live explorer.",
          },
          servers: [{ url: "/", description: "Current origin" }],
          tags: [
            { name: "health" },
            { name: "catalog" },
            { name: "inventory" },
            { name: "machines" },
            { name: "refill" },
            { name: "slips" },
            { name: "bots" },
            { name: "runs" },
            { name: "alerts" },
          ],
          paths: {
            "/api/health": { get: { tags: ["health"], summary: "Health", responses: { "200": { description: "ok" } } } },
            "/api/catalog": { get: { tags: ["catalog"], summary: "Items & machines" } },
            "/api/inventory": { get: { tags: ["inventory"], summary: "Inventory rows" } },
            "/api/machines": { get: { tags: ["machines"], summary: "Machine stats" } },
            "/api/refill": { get: { tags: ["refill"], summary: "Refill dashboard" } },
            "/api/slips": {
              get: { tags: ["slips"], summary: "List slips", parameters: [{ name: "status", in: "query", schema: { type: "string" } }] },
              post: { tags: ["slips"], summary: "Raise slip" },
            },
            "/api/slips/decide": { post: { tags: ["slips"], summary: "Decide slip" } },
            "/api/slips/receive": { post: { tags: ["slips"], summary: "Mark received" } },
            "/api/bots": {
              get: { tags: ["bots"], summary: "List bots" },
              post: { tags: ["bots"], summary: "Create bot" },
            },
            "/api/bots/trigger": { post: { tags: ["bots"], summary: "Trigger bot" } },
            "/api/runs": { get: { tags: ["runs"], summary: "List runs" } },
            "/api/alerts": {
              get: { tags: ["alerts"], summary: "List alerts" },
              post: { tags: ["alerts"], summary: "Create alert" },
            },
            "/api/alerts/acknowledge": { post: { tags: ["alerts"], summary: "Ack" } },
          },
        };
        return Response.json(spec);
      },
    },
  },
});
