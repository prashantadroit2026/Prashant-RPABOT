import { createFileRoute } from "@tanstack/react-router";
import { backendFetch, backendPost } from "@/lib/backend-client";

export const Route = createFileRoute("/api/bots/")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const data = await backendFetch("/api/bots");
          return Response.json(data);
        } catch (e) {
          return Response.json({ error: (e as Error).message }, { status: 503 });
        }
      },
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
        if (!body || typeof body.code !== "string" || typeof body.name !== "string") {
          return Response.json({ error: "code and name are required" }, { status: 400 });
        }
        const code = String(body.code).toUpperCase().trim();
        if (!/^[A-Z0-9-]+$/.test(code)) return Response.json({ error: "Code must be UPPER-CODE (A-Z, 0-9, -)" }, { status: 400 });
        if ((body.name as string).trim().length < 2) return Response.json({ error: "name too short" }, { status: 400 });
        try {
          const bot = await backendPost("/api/bots", {
            code,
            name: String(body.name).trim(),
            description: String(body.description ?? ""),
            type: String(body.type ?? "generic"),
            status: String(body.status ?? "draft"),
            cronExpr: body.cronExpr != null ? String(body.cronExpr) : null,
            config: body.config && typeof body.config === "object" ? body.config : {},
          });
          return Response.json(bot);
        } catch (e) {
          const err = e as { status?: number; message?: string };
          return Response.json({ error: err.message ?? String(err) }, { status: err.status ?? 400 });
        }
      },
    },
  },
});