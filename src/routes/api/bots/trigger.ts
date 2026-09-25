import { createFileRoute } from "@tanstack/react-router";
import { backendPost } from "@/lib/backend-client";

export const Route = createFileRoute("/api/bots/trigger")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => null)) as { id?: number; input?: Record<string, unknown> } | null;
        if (!body || typeof body.id !== "number") return Response.json({ error: "id required" }, { status: 400 });
        try {
          const run = await backendPost("/api/bots/trigger", { id: body.id, input: body.input ?? {} });
          return Response.json(run);
        } catch (e) {
          const err = e as { status?: number; message?: string };
          return Response.json({ error: err.message ?? String(err) }, { status: err.status ?? 400 });
        }
      },
    },
  },
});