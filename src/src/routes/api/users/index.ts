import { createFileRoute } from "@tanstack/react-router";
import { backendFetch, backendPost } from "@/lib/backend-client";

export const Route = createFileRoute("/api/users/")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const data = await backendFetch("/api/users");
          return Response.json(data);
        } catch (e) {
          return Response.json({ error: (e as Error).message }, { status: 503 });
        }
      },
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
        if (!body || typeof body.userId !== "string" || typeof body.password !== "string") {
          return Response.json({ error: "userId and password are required" }, { status: 400 });
        }
        try {
          const user = await backendPost("/api/users", {
            userId: String(body.userId).trim().toLowerCase(),
            name: String(body.name ?? ""),
            role: String(body.role ?? "shopfloor"),
            department: String(body.department ?? ""),
            password: String(body.password),
          });
          return Response.json(user);
        } catch (e) {
          const err = e as { status?: number; message?: string };
          return Response.json({ error: err.message ?? String(err) }, { status: err.status ?? 400 });
        }
      },
    },
  },
});