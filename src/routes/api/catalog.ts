import { createFileRoute } from "@tanstack/react-router";
import { backendFetch } from "@/lib/backend-client";

export const Route = createFileRoute("/api/catalog")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const data = await backendFetch("/api/catalog");
          return Response.json(data);
        } catch (e) {
          return Response.json({ error: (e as Error).message }, { status: 503 });
        }
      },
    },
  },
});