import { createFileRoute } from "@tanstack/react-router";
import { backendFetch, backendPost } from "@/lib/backend-client";

export const Route = createFileRoute("/api/slips/")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const url = new URL(request.url);
          const status = url.searchParams.get("status");
          const qs = new URLSearchParams();
          if (status) qs.set("status", status);
          const data = await backendFetch(`/api/slips${qs.toString() ? `?${qs.toString()}` : ""}`);
          return Response.json(data);
        } catch (e) {
          return Response.json({ error: (e as Error).message }, { status: 503 });
        }
      },
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
        if (!body || typeof body.itemId !== "number" || typeof body.machineId !== "number" || typeof body.qty !== "number") {
          return Response.json({ error: "itemId, machineId, qty are required" }, { status: 400 });
        }
        const qty = Number(body.qty);
        if (!Number.isInteger(qty) || qty < 1) return Response.json({ error: "qty must be positive integer" }, { status: 400 });
        if (!body.hodConfirmed) return Response.json({ error: "HOD authorisation required" }, { status: 400 });
        try {
          const slip = await backendPost("/api/slips", {
            itemId: body.itemId,
            machineId: body.machineId,
            qty,
            department: String(body.department ?? "Production"),
            station: String(body.station ?? ""),
            hodTitle: String(body.hodTitle ?? "Production HOD"),
            slipDate: typeof body.slipDate === "string" ? body.slipDate : undefined,
          });
          return Response.json(slip, { status: 201 });
        } catch (e) {
          const err = e as { status?: number; message?: string };
          return Response.json({ error: err.message ?? String(err) }, { status: err.status ?? 400 });
        }
      },
    },
  },
});