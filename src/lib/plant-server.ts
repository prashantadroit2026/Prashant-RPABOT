import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  type InventoryRow,
  type Item,
  type Machine,
  type MachineStat,
  type RefillRow,
  type Slip,
  type SlipStatus,
  type WeekPoint,
} from "@/lib/plant";
import {
  backendFetch,
  backendPost,
  type BackendError,
} from "@/lib/backend-client";

function asString(v: unknown): string {
  return v == null ? "" : String(v);
}

function coerceSlip(s: Slip): Slip {
  return {
    ...s,
    note: s.note ?? "",
    description: s.description ?? "",
    createdAt: asString(s.createdAt),
    machineId: s.machineId ?? null,
    machineName: s.machineName ?? null,
    machineCode: s.machineCode ?? null,
    decidedAt: s.decidedAt ? asString(s.decidedAt) : null,
    onHand: Number(s.onHand) || 0,
    reorderLevel: Number(s.reorderLevel) || 0,
  };
}

/**
 * All read/write paths go to the Python + Google Sheets backend.
 * When it is down the UI surfaces the offline/error state via the thrown
 * BackendError instead of failing silently on a demo database.
 */
export async function ensureSeed(_sql?: unknown): Promise<void> {
  // no-op: seeding lives in the backend startup, not here.
}

export const getCatalog = createServerFn({ method: "GET" }).handler(async () => {
  const { items, machines } = await backendFetch<{ items: Item[]; machines: Machine[] }>("/api/catalog");
  return {
    items: items.map((i) => ({ ...i, unitPrice: Number(i.unitPrice) || 0 })),
    machines: machines.map((m) => ({ id: m.id, code: m.code, name: m.name, line: m.line ?? "" })),
  };
});

export const listSlips = createServerFn({ method: "GET" }).handler(async () => {
  const rows = await backendFetch<Slip[]>("/api/slips");
  return rows.map(coerceSlip);
});

type ItemHint = {
  item: Item | null;
  lastIssues: { qty: number; at: string; machineName: string | null }[];
  lastOnThisMachine: { qty: number; at: string } | null;
};

export const getItemHint = createServerFn({ method: "POST" })
  .validator(
    z.object({
      itemId: z.number(),
      machineId: z.number().nullable(),
    }),
  )
  .handler(async ({ data }) => {
    const qs = new URLSearchParams({ itemId: String(data.itemId) });
    if (data.machineId) qs.set("machineId", String(data.machineId));
    const hint = await backendFetch<ItemHint>(`/api/item-hint?${qs.toString()}`);
    if (!hint.item) return null;
    return hint;
  });

export const raiseSlip = createServerFn({ method: "POST" })
  .validator(
    z.object({
      itemId: z.number(),
      machineId: z.number(),
      qty: z.number().int().positive(),
      department: z.string().min(1),
      station: z.string().max(80),
      hodTitle: z.string().min(1),
      hodConfirmed: z.boolean(),
      slipDate: z.string().min(8),
    }),
  )
  .handler(async ({ data }) => {
    if (!data.hodConfirmed) {
      throw new Error("HOD authorisation is required — same as signing the paper slip.");
    }
    const slip = await backendPost<Slip>("/api/slips", {
      itemId: data.itemId,
      machineId: data.machineId,
      qty: data.qty,
      department: data.department,
      station: data.station,
      hodTitle: data.hodTitle,
      hodConfirmed: data.hodConfirmed,
      slipDate: data.slipDate,
    });
    return coerceSlip(slip);
  });

export const decideSlip = createServerFn({ method: "POST" })
  .validator(
    z.object({
      id: z.number(),
      mode: z.enum(["stock", "split", "pr", "reject"]),
    }),
  )
  .handler(async ({ data }) => {
    const slip = await backendPost<Slip>("/api/slips/decide", {
      id: data.id,
      mode: data.mode,
    });
    return coerceSlip(slip);
  });

export const receiveSlip = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.number() }))
  .handler(async ({ data }) => {
    const slip = await backendPost<Slip>("/api/slips/receive", { id: data.id });
    return coerceSlip(slip);
  });

export const getInventory = createServerFn({ method: "GET" }).handler(async () => {
  const rows = await backendFetch<InventoryRow[]>("/api/inventory");
  return rows.map((r) => ({ ...r, unitPrice: Number(r.unitPrice) || 0 }));
});

export const getMachineStats = createServerFn({ method: "GET" }).handler(async () => {
  return backendFetch<MachineStat[]>("/api/machines");
});

export const getRefillDashboard = createServerFn({ method: "GET" }).handler(async () => {
  return backendFetch<{ rows: RefillRow[]; series: WeekPoint[] }>("/api/refill");
});

// ---------------------------------------------------------------------------
// Multi-item indent (slip group)
// ---------------------------------------------------------------------------

export type SlipGroupItem = { itemCode: string; quantity: number };

export type SlipGroup = {
  id: number;
  groupToken: string;
  department: string;
  machineCode: string;
  station: string;
  hodConfirmed: boolean;
  slipDate: string;
  createdAt: string;
  slips: Slip[];
};

function coerceGroup(g: SlipGroup): SlipGroup {
  return {
    ...g,
    groupToken: asString(g.groupToken),
    machineCode: asString(g.machineCode),
    station: asString(g.station),
    slipDate: asString(g.slipDate),
    createdAt: asString(g.createdAt),
    slips: (g.slips ?? []).map(coerceSlip),
  };
}

export const raiseSlipGroup = createServerFn({ method: "POST" })
  .validator(
    z.object({
      date: z.string().min(1),
      department: z.string().min(1),
      machine: z.string().min(1),
      cell: z.string().default(""),
      hodSignatureConfirmed: z.boolean(),
      items: z
        .array(
          z.object({
            itemId: z.string().min(1),
            quantity: z.number().int().positive(),
            description: z.string().max(300).optional(),
          }),
        )
        .min(1),
    }),
  )
  .handler(async ({ data }) => {
    if (!data.hodSignatureConfirmed) {
      throw new Error("HOD authorisation is required — same as signing the paper slip.");
    }
    const group = await backendPost<SlipGroup>("/api/indents", {
      date: data.date,
      department: data.department,
      machine: data.machine,
      cell: data.cell,
      hodSignatureConfirmed: data.hodSignatureConfirmed,
      items: data.items.map((it) => ({
        itemId: it.itemId,
        quantity: it.quantity,
        description: it.description ?? "",
      })),
    });
    return coerceGroup(group);
  });

export const requestNewItem = createServerFn({ method: "POST" })
  .validator(
    z.object({
      name: z.string().trim().min(2).max(80),
      category: z.string().min(1),
      uom: z.string().min(1),
      quantity: z.number().int().min(1).max(99999),
      description: z.string().max(300).optional(),
      date: z.string().min(1),
      department: z.string().min(1),
      machine: z.string().min(1),
      cell: z.string().default(""),
      hodSignatureConfirmed: z.boolean(),
    }),
  )
  .handler(async ({ data }) => {
    if (!data.hodSignatureConfirmed) {
      throw new Error("HOD authorisation is required — same as signing the paper slip.");
    }
    const result = await backendPost<{
      groupToken: string;
      created: boolean;
      slip: Slip;
    }>("/api/new-item-request", {
      name: data.name.trim(),
      category: data.category,
      uom: data.uom,
      quantity: data.quantity,
      description: data.description ?? "",
      date: data.date,
      department: data.department,
      machine: data.machine,
      cell: data.cell,
      hodSignatureConfirmed: data.hodSignatureConfirmed,
    });
    return { ...result, slip: coerceSlip(result.slip) };
  });

export const listSlipGroups = createServerFn({ method: "GET" }).handler(async () => {
  const groups = await backendFetch<SlipGroup[]>("/api/indents");
  return groups.map(coerceGroup);
});

// ---------------------------------------------------------------------------
// Detailed requests feed for the Management/Requests view
// ---------------------------------------------------------------------------

export type RequestLine = {
  id: number;
  token: string;
  groupId: number | null;
  groupToken: string | null;
  status: SlipStatus;
  slipDate: string;
  department: string;
  cellStation: string;
  machineCode: string | null;
  machineName: string | null;
  hodConfirmed: boolean;
  hodTitle: string;
  decidedAt: string | null;
  note: string;
  description: string;
  itemId: number;
  itemCode: string;
  itemName: string;
  category: string;
  uom: string;
  currentStock: number;
  requestedQty: number;
  issuedQty: number;
  consumptionRate: number;
  unitPrice: number;
  totalCost: number;
  lastOrderedDate: string | null;
  lastOrderedQty: number | null;
  reorderLevel: number;
};

export const listRequests = createServerFn({ method: "GET" }).handler(async () => {
  const rows = await backendFetch<RequestLine[]>("/api/requests");
  return rows.map((r) => ({
    ...r,
    note: r.note ?? "",
    description: r.description ?? "",
    unitPrice: Number(r.unitPrice) || 0,
    totalCost: Number(r.totalCost) || 0,
  }));
});

export type { BackendError };