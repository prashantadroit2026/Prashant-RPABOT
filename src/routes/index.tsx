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
import { DEPARTMENTS, HOD_BY_DEPT, stockStatus, verdictFor } from "@/lib/plant";
import { getCatalog, getItemHint, listSlips, raiseSlip } from "@/lib/plant-server";
import { fmtDate, todayISO } from "@/lib/utils";

export const Route = createFileRoute("/")({ component: RaiseSlipPage });

function RaiseSlipPage() {
  const qc = useQueryClient();
  const catalog = useQuery({ queryKey: ["catalog"], queryFn: () => getCatalog() });
  const slips = useQuery({ queryKey: ["slips"], queryFn: () => listSlips() });

  const items = catalog.data?.items ?? [];
  const machines = catalog.data?.machines ?? [];

  const [itemId, setItemId] = useState<number | "">("");
  const [machineId, setMachineId] = useState<number | "">("");
  const [qty, setQty] = useState("1");
  const [department, setDepartment] = useState<(typeof DEPARTMENTS)[number]>("Production");
  const [station, setStation] = useState("");
  const [slipDate, setSlipDate] = useState(todayISO);
  const [hodConfirmed, setHodConfirmed] = useState(false);

  const hodTitle = HOD_BY_DEPT[department];
  const item = items.find((i) => i.id === itemId);
  const machine = machines.find((m) => m.id === machineId);
  const qtyNum = Number(qty) || 0;

  const hint = useQuery({
    queryKey: ["hint", itemId, machineId],
    queryFn: () =>
      getItemHint({
        data: {
          itemId: Number(itemId),
          machineId: machineId === "" ? null : Number(machineId),
        },
      }),
    enabled: typeof itemId === "number",
  });

  const verdict = item ? verdictFor(qtyNum, item.qty) : null;
  const st = item ? stockStatus(item.qty, item.reorderLevel) : null;

  const raise = useMutation({
    mutationFn: () =>
      raiseSlip({
        data: {
          itemId: Number(itemId),
          machineId: Number(machineId),
          qty: qtyNum,
          department,
          station: station.trim(),
          hodTitle,
          hodConfirmed,
          slipDate,
        },
      }),
    onSuccess: (slip) => {
      toast.success(`${slip.token} sent to store`);
      setHodConfirmed(false);
      setQty("1");
      setStation("");
      void qc.invalidateQueries();
    },
    onError: (err) => toast.error(err.message),
  });

  const mine = useMemo(
    () => (slips.data ?? []).slice(0, 6),
    [slips.data],
  );

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!itemId || !machineId) {
      toast.error("Item and machine are required.");
      return;
    }
    if (qtyNum < 1) {
      toast.error("Quantity must be at least 1.");
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
            <div className="flex items-center justify-between border-b border-line bg-surface px-5 py-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                  Stores requisition
                </p>
                <p className="text-sm font-semibold">Internal slip</p>
              </div>
              <span className="font-mono text-xs text-muted">Date {fmtDate(slipDate)}</span>
            </div>

            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="item">Item name</Label>
                <Select
                  id="item"
                  required
                  value={itemId === "" ? "" : String(itemId)}
                  onChange={(e) => setItemId(e.target.value ? Number(e.target.value) : "")}
                >
                  <option value="">Select from item master</option>
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} · {i.code}
                    </option>
                  ))}
                </Select>
                {item && (
                  <p className="mt-1 font-mono text-xs text-muted">
                    Mapped code {item.code} · {item.uom}
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="qty">Item quantity</Label>
                <Input
                  id="qty"
                  type="number"
                  min={1}
                  step={1}
                  required
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                />
              </div>

              <div>
                <Label htmlFor="date">Date</Label>
                <Input
                  id="date"
                  type="date"
                  required
                  value={slipDate}
                  onChange={(e) => setSlipDate(e.target.value)}
                />
              </div>

              <div>
                <Label htmlFor="dept">Requester department</Label>
                <Select
                  id="dept"
                  value={department}
                  onChange={(e) =>
                    setDepartment(e.target.value as (typeof DEPARTMENTS)[number])
                  }
                >
                  {DEPARTMENTS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <Label htmlFor="machine">Machine (which spare is for)</Label>
                <Select
                  id="machine"
                  required
                  value={machineId === "" ? "" : String(machineId)}
                  onChange={(e) =>
                    setMachineId(e.target.value ? Number(e.target.value) : "")
                  }
                >
                  <option value="">Select machine</option>
                  {machines.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.code} · {m.name}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="sm:col-span-2">
                <Label htmlFor="station">Cell / station (optional)</Label>
                <Input
                  id="station"
                  placeholder="Lathe cell, Press bay…"
                  value={station}
                  onChange={(e) => setStation(e.target.value)}
                />
              </div>

              <div className="sm:col-span-2 rounded-lg bg-surface p-4">
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
                  {hodConfirmed && (
                    <Badge tone="ok">Authorised</Badge>
                  )}
                </div>
                <label className="mt-3 flex min-h-11 cursor-pointer items-start gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 accent-brass"
                    checked={hodConfirmed}
                    onChange={(e) => setHodConfirmed(e.target.checked)}
                  />
                  <span>
                    I confirm this slip is authorised by {hodTitle} for {department}.
                  </span>
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-line px-5 py-4">
              <Button type="submit" variant="brass" disabled={raise.isPending}>
                {raise.isPending ? "Sending…" : "Send slip to store"}
              </Button>
            </div>
          </Card>
        </form>

        <div className="flex flex-col gap-4">
          <Card>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">
              Live stock check
            </p>
            {!item ? (
              <p className="mt-3 text-sm text-muted">
                Pick an item. Current rack quantity and whether store will issue or raise a PR
                appear here — no manual stock walk.
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                <div className="flex items-end justify-between">
                  <div>
                    <div className="text-sm font-semibold">{item.name}</div>
                    <div className="font-mono text-xs text-muted">{item.code}</div>
                  </div>
                  <Badge
                    tone={st === "in" ? "ok" : st === "low" ? "wait" : "stop"}
                  >
                    {st === "in" ? "In stock" : st === "low" ? "Below reorder" : "Out"}
                  </Badge>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Stat n={item.qty} l={`On hand (${item.uom})`} />
                  <Stat n={item.reorderLevel} l="Reorder" />
                  <Stat n={qtyNum} l="This slip" />
                </div>
                {verdict && <StockVerdictBanner verdict={verdict} compact />}
                {hint.data?.lastOnThisMachine && machine && (
                  <p className="text-xs text-muted">
                    {machine.code} last drew {hint.data.lastOnThisMachine.qty} {item.uom} on{" "}
                    {fmtDate(hint.data.lastOnThisMachine.at)}.
                  </p>
                )}
                {hint.data?.lastIssues && hint.data.lastIssues.length > 0 && (
                  <ul className="space-y-1 text-xs text-muted">
                    {hint.data.lastIssues.map((row, i) => (
                      <li key={i}>
                        {fmtDate(row.at)} · {row.machineName ?? "—"} · {row.qty} {item.uom}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Card>

          <Card>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">
              Recent slips
            </p>
            {slips.isPending ? (
              <p className="mt-3 text-sm text-muted">Loading…</p>
            ) : mine.length === 0 ? (
              <EmptyHint>No slips yet.</EmptyHint>
            ) : (
              <ul className="mt-3 divide-y divide-line">
                {mine.map((s) => (
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
  return <Badge tone="brass">pending</Badge>;
}
