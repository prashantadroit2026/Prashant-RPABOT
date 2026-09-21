import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        return Response.json({
          ok: true,
          service: "procurement-hub",
          version: "1.0.0",
          timestamp: new Date().toISOString(),
          database: process.env.DATABASE_URL ? "neon" : "pglite",
        });
      },
    },
  },
});
