export type Role = "shopfloor" | "store" | "management";

export type Item = {
  id: number;
  code: string;
  name: string;
  uom: string;
  reorderLevel: number;
  qty: number;
};

export type Machine = {
  id: number;
  code: string;
  name: string;
  line: string;
};

export type SlipStatus = "pending" | "issued" | "partial" | "pr_open" | "received";

export type Slip = {
  id: number;
  token: string;
  itemId: number;
  itemName: string;
  itemCode: string;
  uom: string;
  machineId: number | null;
  machineName: string | null;
  machineCode: string | null;
  qty: number;
  issuedQty: number;
  department: string;
  station: string;
  hodTitle: string;
  hodConfirmed: boolean;
  slipDate: string;
  status: SlipStatus;
  note: string;
  createdAt: string;
  decidedAt: string | null;
  onHand: number;
  reorderLevel: number;
};

export type VerdictCode = "stock" | "split" | "pr";

export type StockVerdict = {
  code: VerdictCode;
  label: string;
  detail: string;
  canIssue: number;
  prQty: number;
};

export const DEPARTMENTS = [
  "Production",
  "Maintenance",
  "Quality",
  "Warehouse",
  "Tool Room",
] as const;

export const HOD_BY_DEPT: Record<string, string> = {
  Production: "Production HOD",
  Maintenance: "Maintenance HOD",
  Quality: "Quality HOD",
  Warehouse: "Warehouse HOD",
  "Tool Room": "Tool Room HOD",
};

export function stockStatus(qty: number, reorder: number): "in" | "low" | "out" {
  if (qty <= 0) return "out";
  if (qty <= reorder) return "low";
  return "in";
}

export function verdictFor(requestQty: number, onHand: number): StockVerdict {
  const need = Math.max(0, Math.floor(requestQty));
  const have = Math.max(0, Math.floor(onHand));
  if (have <= 0) {
    return {
      code: "pr",
      label: "Raise PR",
      detail: "Nothing on the rack. Store must raise a purchase requisition.",
      canIssue: 0,
      prQty: need,
    };
  }
  if (have >= need) {
    return {
      code: "stock",
      label: "Issue from stock",
      detail: `${have} on hand covers the ${need} requested. No PR needed.`,
      canIssue: need,
      prQty: 0,
    };
  }
  const gap = need - have;
  return {
    code: "split",
    label: "Issue available, PR the rest",
    detail: `Only ${have} on hand. Issue ${have} now and raise PR for ${gap}.`,
    canIssue: have,
    prQty: gap,
  };
}

export function statusLabel(s: SlipStatus): string {
  if (s === "issued") return "Issued from stock";
  if (s === "partial") return "Partial + PR";
  if (s === "pr_open") return "PR open";
  if (s === "received") return "Received";
  return "Pending store";
}

export type InventoryRow = Item & {
  status: "in" | "low" | "out";
  consumed30: number;
  received30: number;
  daysCover: number | null;
  weekly: number[];
};

export type MachineStat = Machine & {
  consumed30: number;
  distinctItems: number;
  topItem: string | null;
  rows: { itemName: string; itemCode: string; qty: number; uom: string }[];
};

export type WeekPoint = { week: string; consumed: number; received: number };

export type RefillRow = {
  itemId: number;
  name: string;
  code: string;
  uom: string;
  qty: number;
  reorderLevel: number;
  consumed30: number;
  received30: number;
  receipts: number;
  daysCover: number | null;
  weekly: number[];
};
