import { createFileRoute } from "@tanstack/react-router";
import { backendPost } from "@/lib/backend-client";

export const Route = createFileRoute("/api/alerts/acknowledge")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => null)) as { id?: number } | null;
        if (!body || typeof body.id !== "number") return Response.json({ error: "id required" }, { status: 400 });
        try {
          const alert = await backendPost("/api/alerts/acknowledge", { id: body.id });
          return Response.json(alert);
        } catch (e) {
          const err = e as { status?: number; message?: string };
          return Response.json({ error: err.message ?? String(err) }, { status: err.status ?? 404 });
        }
      },
    },
  },
});