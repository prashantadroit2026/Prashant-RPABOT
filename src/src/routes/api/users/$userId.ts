import { createFileRoute } from "@tanstack/react-router";
import { backendDelete, backendPut } from "@/lib/backend-client";

export const Route = createFileRoute("/api/users/$userId")({
  server: {
    handlers: {
      PUT: async ({ request, params }) => {
        const { userId } = params;
        if (!/^\d+$/.test(userId)) {
          return Response.json({ error: "route /api/users/:id requires a numeric id" }, { status: 400 });
        }
        const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
        if (!body) {
          return Response.json({ error: "bad body" }, { status: 400 });
        }
        try {
          const user = await backendPut(`/api/users/${userId}`, body);
          return Response.json(user);
        } catch (e) {
          const err = e as { status?: number; message?: string };
          return Response.json({ error: err.message ?? String(err) }, { status: err.status ?? 400 });
        }
      },
      DELETE: async ({ params }) => {
        const { userId } = params;
        if (!/^\d+$/.test(userId)) {
          return Response.json({ error: "route /api/users/:id requires a numeric id" }, { status: 400 });
        }
        try {
          const result = await backendDelete(`/api/users/${userId}`);
          return Response.json(result);
        } catch (e) {
          const err = e as { status?: number; message?: string };
          return Response.json({ error: err.message ?? String(err) }, { status: err.status ?? 400 });
        }
      },
    },
  },
});