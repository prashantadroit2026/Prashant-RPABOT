import { createFileRoute } from "@tanstack/react-router";
import { backendPost } from "@/lib/backend-client";

export const Route = createFileRoute("/api/users/login")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
        if (!body || typeof body.userId !== "string" || typeof body.password !== "string") {
          return Response.json({ error: "userId and password are required" }, { status: 400 });
        }
        try {
          const user = await backendPost("/api/users/login", {
            userId: String(body.userId),
            password: String(body.password),
          });
          return Response.json(user);
        } catch (e) {
          const err = e as { status?: number; message?: string };
          return Response.json({ error: err.message ?? String(err) }, { status: err.status ?? 401 });
        }
      },
    },
  },
});