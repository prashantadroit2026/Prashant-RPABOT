import { createFileRoute } from "@tanstack/react-router";
import { backendPost } from "@/lib/backend-client";

export const Route = createFileRoute("/api/slips/decide")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => null)) as { id?: number; mode?: string } | null;
        if (!body || typeof body.id !== "number" || !["stock", "split", "pr", "reject"].includes(String(body.mode))) {
          return Response.json({ error: "id (number) and mode (stock|split|pr|reject) required" }, { status: 400 });
        }
        try {
          const slip = await backendPost("/api/slips/decide", { id: body.id, mode: body.mode });
          return Response.json(slip);
        } catch (e) {
          const err = e as { status?: number; message?: string };
          return Response.json({ error: err.message ?? String(err) }, { status: err.status ?? 400 });
        }
      },
    },
  },
});