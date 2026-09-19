import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell, EmptyHint } from "@/components/app-shell";
import { StockVerdictBanner } from "@/components/stock-verdict";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DEPARTMENTS, HOD_BY_DEPT, ITEM_CATEGORIES, UNIT_OF_MEASURES, stockStatus, verdictFor } from "@/lib/plant";
import { getCatalog, listSlips, raiseSlipGroup, requestNewItem, type SlipGroup } from "@/lib/plant-server";
import { fmtDate, todayISO } from "@/lib/utils";

import { RequireRole } from "@/components/role-guard";

export const Route = createFileRoute("/")({
  component: () => (
    <RequireRole>
      <RaiseSlipPage />
    </RequireRole>
  ),
});

type LineItem = { id: number; itemId: string; quantity: string; description: string };

let lineSeq = 1;

function RaiseSlipPage() {
  const qc = useQueryClient();
  const catalog = useQuery({ queryKey: ["catalog"], queryFn: () => getCatalog() });
  const slips = useQuery({ queryKey: ["slips"], queryFn: () => listSlips() });

  const items = catalog.data?.items ?? [];
  const machines = catalog.data?.machines ?? [];

  // Group-level fields
  const [date, setDate] = useState(todayISO);
  const [department, setDepartment] = useState<(typeof DEPARTMENTS)[number]>("Production");
  const [machineCode, setMachineCode] = useState("");
  const [cell, setCell] = useState("");
  const [hodConfirmed, setHodConfirmed] = useState(false);

  // Multi-item lines
  const [lines, setLines] = useState<LineItem[]>([
    { id: 1, itemId: "", quantity: "1", description: "" },
  ]);

  // Request-a-new-item form (bottom of page)
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState<string>(ITEM_CATEGORIES[0]);
  const [newUom, setNewUom] = useState<string>("Pcs");
  const [newQty, setNewQty] = useState("1");
  const [newDesc, setNewDesc] = useState("");

  const hodTitle = HOD_BY_DEPT[department];

  function addLine() {
    lineSeq += 1;
    setLines((prev) => [...prev, { id: lineSeq, itemId: "", quantity: "1", description: "" }]);
  }

  function removeLine(id: number) {
    setLines((prev) => prev.filter((l) => l.id !== id));
  }

  function updateLine(id: number, field: keyof Omit<LineItem, "id">, value: string) {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, [field]: value } : l)));
  }

  // Live stock preview for line items
  const previewItem = useMemo(() => {
    // Show preview for first filled-in item
    const first = lines.find((l) => l.itemId);
    if (!first) return null;
    return items.find((i) => i.id === Number(first.itemId)) ?? null;
  }, [lines, items]);

  const previewQty = useMemo(() => {
    const first = lines.find((l) => l.itemId);
    return Number(first?.quantity) || 0;
  }, [lines]);

  const verdict = previewItem ? verdictFor(previewQty, previewItem.qty) : null;
  const st = previewItem ? stockStatus(previewItem.qty, previewItem.reorderLevel) : null;

  const raise = useMutation({
    mutationFn: () =>
      raiseSlipGroup({
        data: {
          date,
          department,
          machine: machineCode.trim() || (machines[0]?.code ?? "CNC-01"),
          cell: cell.trim(),
          hodSignatureConfirmed: hodConfirmed,
          items: lines
            .filter((l) => l.itemId)
            .map((l) => {
              const item = items.find((i) => i.id === Number(l.itemId));
              const description = l.description.trim();
              return {
                itemId: item?.code ?? l.itemId,
                quantity: Math.max(1, Number(l.quantity) || 1),
                description: description || undefined,
              };
            }),
        },
      }),
    onSuccess: (group: SlipGroup) => {
      const n = group.slips.length;
      toast.success(`${group.groupToken} · ${n} slip${n !== 1 ? "s" : ""} sent to store`);
      setHodConfirmed(false);
      setLines([{ id: 1, itemId: "", quantity: "1", description: "" }]);
      setCell("");
      void qc.invalidateQueries();
    },
    onError: (err) => toast.error(err.message),
  });

  const recentSlips = useMemo(() => (slips.data ?? []).slice(0, 6), [slips.data]);

  const newItemReq = useMutation({
    mutationFn: () =>
      requestNewItem({
        data: {
          name: newName,
          category: newCategory,
          uom: newUom,
          quantity: Math.max(1, Number(newQty) || 1),
          description: newDesc.trim() || undefined,
          date,
          department,
          machine: machineCode.trim() || (machines[0]?.code ?? "CNC-01"),
          cell: cell.trim(),
          hodSignatureConfirmed: hodConfirmed,
        },
      }),
    onSuccess: (res) => {
      toast.success(
        res.created
          ? `${res.slip.itemName} added to catalog · ${res.slip.token} sent to store`
          : `${res.slip.token} sent to store`,
      );
      setNewName("");
      setNewDesc("");
      setNewQty("1");
      setNewUom("Pcs");
      setNewCategory(ITEM_CATEGORIES[0]);
      setHodConfirmed(false);
      void qc.invalidateQueries();
    },
    onError: (err) => toast.error(err.message),
  });

  function submitNewItem() {
    if (!newName.trim()) {
      toast.error("Item name is required.");
      return;
    }
    if (!machineCode.trim()) {
      toast.error("Machine is required.");
      return;
    }
    if (!hodConfirmed) {
      toast.error("HOD authorisation is required — same as the slip above.");
      return;
    }
    newItemReq.mutate();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const filledLines = lines.filter((l) => l.itemId);
    if (filledLines.length === 0) {
      toast.error("Add at least one item.");
      return;
    }
    const bad = filledLines.find((l) => Number(l.quantity) < 1);
    if (bad) {
      toast.error("Quantity must be at least 1 for each item.");
      return;
    }
    if (!machineCode.trim()) {
      toast.error("Machine is required.");
      return;
    }
    if (!hodConfirmed) {
      toast.error("HOD authorisation is required — same as signing the paper slip.");
      return;
    }
    raise.mutate();
  }

  return (
    <AppShell>
      <div className="mb-6" />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <form onSubmit={submit}>
          <Card className="relative overflow-hidden rounded-xl p-0">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-line bg-surface px-5 py-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                  Stores requisition
                </p>
                <p className="text-sm font-semibold">Internal indent slip</p>
              </div>
              <span className="font-mono text-xs text-muted">Date {fmtDate(date)}</span>
            </div>

            {/* Common fields */}
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <div>
                <Label htmlFor="date">Date</Label>
                <Input
                  id="date"
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>

              <div>
                <Label htmlFor="dept">Department</Label>
                <Select
                  id="dept"
                  value={department}
                  onChange={(e) => setDepartment(e.target.value as (typeof DEPARTMENTS)[number])}
                >
                  {DEPARTMENTS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <Label htmlFor="machine">Machine (code)</Label>
                <Select
                  id="machine"
                  required
                  value={machineCode}
                  onChange={(e) => setMachineCode(e.target.value)}
                >
                  <option value="">Select machine</option>
                  {machines.map((m) => (
                    <option key={m.id} value={m.code}>
                      {m.code} · {m.name}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <Label htmlFor="cell">Cell / station</Label>
                <Input
                  id="cell"
                  placeholder="Lathe cell, Press bay…"
                  value={cell}
                  onChange={(e) => setCell(e.target.value)}
                />
              </div>
            </div>

            {/* Multi-item lines */}
            <div className="border-t border-line px-5 pb-1 pt-4">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                  Items requested
                </p>
                <Button type="button" variant="outline" size="sm" onClick={addLine}>
                  + Add item
                </Button>
              </div>

              <div className="space-y-2">
                {lines.map((line, idx) => {
                  const selectedItem = items.find((i) => i.id === Number(line.itemId));
                  return (
                    <div key={line.id} className="rounded-lg border border-line bg-surface/60 p-3">
                      <div className="flex items-end gap-2">
                        <div className="flex-1">
                          {idx === 0 && <Label htmlFor={`item-${line.id}`}>Item</Label>}
                          <Select
                            id={`item-${line.id}`}
                            value={line.itemId}
                            onChange={(e) => updateLine(line.id, "itemId", e.target.value)}
                          >
                            <option value="">Select item</option>
                            {items.map((i) => (
                              <option key={i.id} value={i.id}>
                                {i.name} · {i.code}
                              </option>
                            ))}
                          </Select>
                          {selectedItem && (
                            <p className="mt-0.5 font-mono text-xs text-muted">
                              {selectedItem.qty} {selectedItem.uom} on hand · reorder {selectedItem.reorderLevel}
                            </p>
                          )}
                        </div>
                        <div className="w-24">
                          {idx === 0 && <Label htmlFor={`qty-${line.id}`}>Qty</Label>}
                          <Input
                            id={`qty-${line.id}`}
                            type="number"
                            min={1}
                            step={1}
                            value={line.quantity}
                            onChange={(e) => updateLine(line.id, "quantity", e.target.value)}
                          />
                        </div>
                        {lines.length > 1 && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="mb-0.5 text-muted hover:text-danger"
                            onClick={() => removeLine(line.id)}
                            aria-label="Remove item row"
                          >
                            ✕
                          </Button>
                        )}
                      </div>
                      <div className="mt-2">
                        {idx === 0 && <Label htmlFor={`desc-${line.id}`}>Description</Label>}
                        <Input
                          id={`desc-${line.id}`}
                          placeholder="What it's needed for (optional)"
                          maxLength={300}
                          value={line.description}
                          onChange={(e) => updateLine(line.id, "description", e.target.value)}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* HOD signature */}
            <div className="mx-5 my-4 rounded-lg bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                    HOD signature
                  </p>
                  <p className="mt-1 text-sm font-semibold">{hodTitle}</p>
                  <p className="text-xs text-muted">
                    Digital stand-in for the signature block on the paper slip.
                  </p>
                </div>
                {hodConfirmed && <Badge tone="ok">Authorised</Badge>}
              </div>
              <label className="mt-3 flex min-h-11 cursor-pointer items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 size-4 accent-brass"
                  checked={hodConfirmed}
                  onChange={(e) => setHodConfirmed(e.target.checked)}
                />
                <span>
                  I confirm this indent is authorised by {hodTitle} for {department}.
                </span>
              </label>
            </div>

            <div className="flex justify-end gap-2 border-t border-line px-5 py-4">
              <Button type="submit" variant="brass" disabled={raise.isPending}>
                {raise.isPending ? "Sending…" : `Send ${lines.filter((l) => l.itemId).length || ""} slip${lines.filter((l) => l.itemId).length !== 1 ? "s" : ""} to store`}
              </Button>
            </div>
          </Card>
        </form>

        {/* Right column */}
        <div className="flex flex-col gap-4">
          <Card>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">
              Live stock check
            </p>
            {!previewItem ? (
              <p className="mt-3 text-sm text-muted">
                Pick an item above. Current rack quantity and store verdict appear here — no manual
                stock walk.
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                <div className="flex items-end justify-between">
                  <div>
                    <div className="text-sm font-semibold">{previewItem.name}</div>
                    <div className="font-mono text-xs text-muted">{previewItem.code}</div>
                  </div>
                  <Badge tone={st === "in" ? "ok" : st === "low" ? "wait" : "stop"}>
                    {st === "in" ? "In stock" : st === "low" ? "Below reorder" : "Out"}
                  </Badge>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Stat n={previewItem.qty} l={`On hand (${previewItem.uom})`} />
                  <Stat n={previewItem.reorderLevel} l="Reorder" />
                  <Stat n={previewQty} l="This slip" />
                </div>
                {verdict && <StockVerdictBanner verdict={verdict} compact />}
              </div>
            )}
          </Card>

          <Card>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">
              Recent slips
            </p>
            {slips.isPending ? (
              <p className="mt-3 text-sm text-muted">Loading…</p>
            ) : recentSlips.length === 0 ? (
              <EmptyHint>No slips yet.</EmptyHint>
            ) : (
              <ul className="mt-3 divide-y divide-line">
                {recentSlips.map((s) => (
                  <li key={s.id} className="flex items-start justify-between gap-2 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{s.itemName}</div>
                      <div className="font-mono text-xs text-muted">
                        {s.token} · {s.qty} {s.uom} · {s.machineCode ?? "—"}
                      </div>
                    </div>
                    <SlipBadge status={s.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {/* Request a new item */}
      <Card className="mt-6">
        <div className="border-b border-line bg-surface px-5 py-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">
            Don't see it in the catalog?
          </p>
          <p className="text-sm font-semibold">Request a new item</p>
        </div>
        <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-5">
          <div className="sm:col-span-2">
            <Label htmlFor="newName">Item name</Label>
            <Input
              id="newName"
              placeholder="e.g. Hydraulic seal kit 12 mm"
              maxLength={80}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="newCat">Category</Label>
            <Select
              id="newCat"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
            >
              {ITEM_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="newUom">Unit of measure</Label>
            <Select id="newUom" value={newUom} onChange={(e) => setNewUom(e.target.value)}>
              {UNIT_OF_MEASURES.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="newQty">Quantity</Label>
            <Input
              id="newQty"
              type="number"
              min={1}
              step={1}
              value={newQty}
              onChange={(e) => setNewQty(e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="newDesc">Reason / specification</Label>
            <Input
              id="newDesc"
              placeholder="What it's needed for (optional)"
              maxLength={300}
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-end justify-end gap-2 sm:col-span-3">
            <p className="mr-2 text-xs text-muted">
              Raises a pending slip and adds the item to the catalog — sign-off, machine and
              station come from the slip above.
            </p>
            <Button
              type="button"
              variant="brass"
              className="whitespace-nowrap"
              disabled={newItemReq.isPending}
              onClick={submitNewItem}
            >
              {newItemReq.isPending ? "Sending…" : "+ Request a new item"}
            </Button>
          </div>
        </div>
      </Card>
    </AppShell>
  );
}

function Stat({ n, l }: { n: number; l: string }) {
  return (
    <div className="rounded-md bg-surface px-2 py-2">
      <div className="font-mono text-lg font-semibold tabular-nums">{n}</div>
      <div className="text-[11px] text-muted">{l}</div>
    </div>
  );
}

function SlipBadge({ status }: { status: string }) {
  if (status === "issued" || status === "received") return <Badge tone="ok">{status}</Badge>;
  if (status === "partial" || status === "pr_open")
    return <Badge tone="wait">{status.replaceAll("_", " ")}</Badge>;
  if (status === "rejected") return <Badge tone="stop">rejected</Badge>;
  return <Badge tone="brass">pending</Badge>;
}
