import { createFileRoute } from "@tanstack/react-router";
import { backendBaseUrl } from "@/lib/backend-client";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const backendUrl = backendBaseUrl();
        let backend: Record<string, unknown> | null = null;
        let backendError: string | null = null;
        try {
          const res = await fetch(`${backendUrl}/api/health`, {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(5000),
          });
          if (res.ok) {
            backend = (await res.json()) as Record<string, unknown>;
          } else {
            backendError = `HTTP ${res.status}`;
          }
        } catch (e) {
          backendError = e instanceof Error ? e.message : String(e);
        }
        return Response.json({
          ok: true,
          service: "procurement-hub",
          version: "1.0.0",
          timestamp: new Date().toISOString(),
          database: "google-sheets",
          backendUrl,
          backend: backend ?? null,
          backendError,
        });
      },
    },
  },
});