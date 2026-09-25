import { createFileRoute } from "@tanstack/react-router";
import { backendFetch } from "@/lib/backend-client";

export const Route = createFileRoute("/api/runs")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const botId = url.searchParams.get("botId");
          const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 20)));
          const qs = new URLSearchParams({ limit: String(limit) });
          if (botId) qs.set("botId", String(botId));
          const data = await backendFetch(`/api/runs?${qs.toString()}`);
          return Response.json(data);
        } catch (e) {
          return Response.json({ error: (e as Error).message }, { status: 503 });
        }
      },
    },
  },
});