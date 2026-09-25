import { createFileRoute } from "@tanstack/react-router";
import { backendFetch, backendPost } from "@/lib/backend-client";

export const Route = createFileRoute("/api/alerts/")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const qs = new URLSearchParams();
          const severity = url.searchParams.get("severity");
          const ack = url.searchParams.get("acknowledged");
          const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 20)));
          if (severity) qs.set("severity", severity);
          if (ack !== null) qs.set("acknowledged", String(ack === "true"));
          qs.set("limit", String(limit));
          const data = await backendFetch(`/api/alerts?${qs.toString()}`);
          return Response.json(data);
        } catch (e) {
          return Response.json({ error: (e as Error).message }, { status: 503 });
        }
      },
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
        if (!body || typeof body.title !== "string") return Response.json({ error: "title required" }, { status: 400 });
        const severity = String(body.severity ?? "info");
        if (!["info", "warn", "critical"].includes(severity)) return Response.json({ error: "severity must be info|warn|critical" }, { status: 400 });
        try {
          const alert = await backendPost("/api/alerts", {
            severity,
            title: String(body.title),
            message: String(body.message ?? ""),
            botId: body.botId != null ? Number(body.botId) : null,
            itemId: body.itemId != null ? Number(body.itemId) : null,
          });
          return Response.json(alert);
        } catch (e) {
          const err = e as { status?: number; message?: string };
          return Response.json({ error: err.message ?? String(err) }, { status: err.status ?? 400 });
        }
      },
    },
  },
});