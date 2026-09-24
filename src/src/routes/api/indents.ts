import { createFileRoute } from "@tanstack/react-router";
import { backendFetch, backendPost } from "@/lib/backend-client";

/**
 * GET  /api/indents          — list all slip groups with their slips
 * POST /api/indents          — submit a multi-item indent (see body shape below)
 *
 * POST body: { date, department, machine, cell, hodSignatureConfirmed, items: [{itemId, quantity, description?}] }
 * Returns: SlipGroup
 */
export const Route = createFileRoute("/api/indents")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const data = await backendFetch("/api/indents");
          return Response.json(data);
        } catch (err) {
          return Response.json({ error: (err as Error).message }, { status: 503 });
        }
      },
      POST: async ({ request }) => {
        const body = await request.json().catch(() => null);
        if (!body) return Response.json({ error: "Invalid JSON" }, { status: 400 });
        try {
          const data = body as {
            date?: string;
            department?: string;
            machine?: string;
            cell?: string;
            hodSignatureConfirmed?: boolean;
            items?: { itemId?: string; quantity?: number; description?: string }[];
          };
          if (!data.date || !data.department || !data.machine) {
            return Response.json({ error: "date, department, machine are required" }, { status: 400 });
          }
          if (!data.hodSignatureConfirmed) {
            return Response.json({ error: "HOD authorisation is required" }, { status: 400 });
          }
          if (!Array.isArray(data.items) || data.items.length === 0) {
            return Response.json({ error: "items array is required" }, { status: 400 });
          }
          const group = await backendPost("/api/indents", {
            date: data.date,
            department: data.department,
            machine: data.machine,
            cell: data.cell ?? "",
            hodSignatureConfirmed: true,
            items: data.items.map((line) => ({
              itemId: String(line.itemId ?? ""),
              quantity: Number(line.quantity ?? 0),
              description: line.description ?? "",
            })),
          });
          return Response.json(group, { status: 201 });
        } catch (err) {
          const e = err as { status?: number; message?: string };
          return Response.json({ error: e.message ?? String(err) }, { status: e.status ?? 400 });
        }
      },
    },
  },
});