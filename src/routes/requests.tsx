import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Maximize2, Minimize2, Plus } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell, EmptyHint, Kpi, PageHeader } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { DEPARTMENTS, statusLabel, verdictFor, type SlipStatus } from "@/lib/plant";
import { decideSlip, listRequests, receiveSlip, type RequestLine } from "@/lib/plant-server";
import { fmtDate } from "@/lib/utils";

import { RequireRole } from "@/components/role-guard";

export const Route = createFileRoute("/requests")({
  component: () => (
    <RequireRole roles={["store", "management"]}>
      <RequestsManagementPage />
    </RequireRole>
  ),
});

type StatusFilter = "all" | SlipStatus;
type PageSize = 10 | 25 | 50;

const money = (n: number) =>
  `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function RequestsManagementPage() {
  const qc = useQueryClient();
  const reqs = useQuery({ queryKey: ["requests"], queryFn: () => listRequests() });

  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [pageSize, setPageSize] = useState<PageSize>(10);
  const [page, setPage] = useState(0);
  const [fs, setFs] = useState(false);

  const rows = useMemo(() => reqs.data ?? [], [reqs.data]);

  const displayRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((l) => {
      const okTerm =
        !term ||
        l.token.toLowerCase().includes(term) ||
        (l.groupToken ?? "").toLowerCase().includes(term) ||
        l.itemName.toLowerCase().includes(term) ||
        l.itemCode.toLowerCase().includes(term) ||
        l.category.toLowerCase().includes(term) ||
        (l.machineCode ?? "").toLowerCase().includes(term) ||
        (l.machineName ?? "").toLowerCase().includes(term) ||
        l.department.toLowerCase().includes(term) ||
        l.cellStation.toLowerCase().includes(term);
      const okDept = deptFilter === "all" || l.department === deptFilter;
      const okStatus = statusFilter === "all" || l.status === statusFilter;
      return okTerm && okDept && okStatus;
    });
  }, [rows, search, deptFilter, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(displayRows.length / pageSize));
  const currentPage = Math.min(page, totalPages - 1);
  const paged = displayRows.slice(currentPage * pageSize, currentPage * pageSize + pageSize);

  // In full-screen every matching row is shown at once; outside it, the page is sliced.
  const lines = fs ? displayRows : paged;

  // Group lines: multi-item indents group under their Slip Header bar; single slips stand alone.
  const groupsOnPage = useMemo(() => {
    const map = new Map<string, RequestLine[]>();
    for (const l of lines) {
      const key = String(l.groupId ?? l.id);
      const arr = map.get(key) ?? [];
      arr.push(l);
      map.set(key, arr);
    }
    return [...map.values()];
  }, [lines]);

  const pendingCount = rows.filter((l) => l.status === "pending").length;
  const prCount = rows.filter((l) => l.status === "pr_open" || l.status === "partial").length;
  const issuedCount = rows.filter((l) => l.status === "issued" || l.status === "received").length;

  const decide = useMutation({
    mutationFn: (input: { id: number; mode: "stock" | "split" | "pr" | "reject" }) =>
      decideSlip({ data: input }),
    onSuccess: (s) => {
      toast.success(`${s.token} · ${statusLabel(s.status)}`);
      void qc.invalidateQueries();
    },
    onError: (err) => toast.error(err.message),
  });

  const receive = useMutation({
    mutationFn: (id: number) => receiveSlip({ data: { id } }),
    onSuccess: (s) => {
      toast.success(`${s.token} received onto the rack`);
      void qc.invalidateQueries();
    },
    onError: (err) => toast.error(err.message),
  });

  function resetFilters() {
    setSearch("");
    setDeptFilter("all");
    setStatusFilter("all");
    setPage(0);
  }

  const table = (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface px-4 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">
          Requests table
        </span>
        {!fs && (
          <Button size="sm" variant="outline" onClick={() => setFs(true)}>
            <Maximize2 className="size-4" />
            Full screen
          </Button>
        )}
      </div>

      <div className="scroll-thin overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface text-xs font-semibold uppercase tracking-wider text-muted">
            <tr>
              <th className="whitespace-nowrap px-4 py-3">Cell / Station</th>
              <th className="whitespace-nowrap px-4 py-3">Item details</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Current stock</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Requested qty</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Consumption</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Pricing</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Last time ordered</th>
              <th className="sticky right-0 z-20 whitespace-nowrap border-l border-line-strong bg-surface px-4 py-3 text-right shadow-[-10px_0_12px_-10px_rgba(28,25,22,0.2)]">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {reqs.isPending && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted">
                  Loading requests…
                </td>
              </tr>
            )}
            {!reqs.isPending && paged.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10">
                  <EmptyHint>No requests match the current filters.</EmptyHint>
                </td>
              </tr>
            )}
            {groupsOnPage.map((lines) => (
              <SlipGroup
                key={lines[0].groupId ?? lines[0].id}
                lines={lines}
                busy={decide.isPending || receive.isPending}
                detailed={fs}
                onDecide={(id, mode) => decide.mutate({ id, mode })}
                onReceive={(id) => receive.mutate(id)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface px-4 py-3">
        <div className="flex items-center gap-2 text-xs text-muted">
          <span>
            {fs
              ? `Showing all ${displayRows.length} line items · full detail`
              : `Showing ${displayRows.length === 0 ? 0 : currentPage * pageSize + 1}–${Math.min(
                  (currentPage + 1) * pageSize,
                  displayRows.length,
                )} of ${displayRows.length}`}
          </span>
          {!fs && (
            <Select
              value={String(pageSize)}
              onChange={(e) => {
                setPageSize(Number(e.target.value) as PageSize);
                setPage(0);
              }}
              className="h-8 w-[88px] text-xs"
            >
              <option value="10">10 / page</option>
              <option value="25">25 / page</option>
              <option value="50">50 / page</option>
            </Select>
          )}
        </div>
        {!fs && (
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              disabled={currentPage <= 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Previous
            </Button>
            <span className="px-2 text-xs tabular-nums text-muted">
              {currentPage + 1} / {totalPages}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={currentPage >= totalPages - 1}
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            >
              Next
            </Button>
          </div>
        )}
      </div>
    </Card>
  );

  return (
    <AppShell>
      <PageHeader
        kicker="Management"
        title="Item requests"
        subtitle="Every requisition line in one detailed table — grouped under its slip header, with live stock, rate and pricing."
        action={
          <div className="flex gap-2">
            <a href="/store" className="no-underline">
              <Button variant="outline" size="sm">
                Store desk
              </Button>
            </a>
            <a href="/management" className="no-underline">
              <Button variant="brass" size="sm">
                Refill rate
              </Button>
            </a>
          </div>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Total line items" value={rows.length} />
        <Kpi label="Pending" value={pendingCount} tone="brass" hint="Awaiting store" />
        <Kpi label="Open PRs" value={prCount} tone="wait" />
        <Kpi label="Issued / received" value={issuedCount} tone="ok" />
      </div>

      {/* Filters */}
      <Card className="mb-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">
              Search
            </label>
            <Input
              placeholder="Slip ID, item name, SKU, category, machine, department…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </div>
          <div className="w-full sm:w-44">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">
              Department
            </label>
            <Select
              value={deptFilter}
              onChange={(e) => {
                setDeptFilter(e.target.value);
                setPage(0);
              }}
            >
              <option value="all">All departments</option>
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-full sm:w-40">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted">
              Status
            </label>
            <Select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as StatusFilter);
                setPage(0);
              }}
            >
              <option value="all">All statuses</option>
              <option value="pending">Pending</option>
              <option value="issued">Issued</option>
              <option value="partial">Partial</option>
              <option value="pr_open">PR raised</option>
              <option value="received">Received</option>
              <option value="rejected">Rejected</option>
            </Select>
          </div>
          <Button variant="outline" size="sm" onClick={resetFilters}>
            Reset
          </Button>
        </div>
      </Card>

      {table}

      {/* Request a new item */}
      <div className="mt-4 flex flex-col items-center justify-between gap-3 rounded-lg border border-line bg-paper px-4 py-4 shadow-card sm:flex-row">
        <div>
          <p className="text-sm font-semibold">Request a new item</p>
          <p className="text-xs text-muted">
            Start a fresh requisition from the Raise Slip form — it flows straight into this table.
          </p>
        </div>
        <a href="/" className="no-underline">
          <Button variant="brass" className="whitespace-nowrap">
            <Plus className="size-4" /> Request a new item
          </Button>
        </a>
      </div>

      {fs && (
        <div className="fixed inset-0 z-[100] flex flex-col bg-canvas">
          <div className="flex items-center justify-between gap-3 border-b border-line bg-paper px-4 py-2">
            <div>
              <p className="text-sm font-semibold">Item requests — full screen</p>
              <p className="text-xs text-muted">Detailed requisition table</p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setFs(false)}>
              <Minimize2 className="size-4" /> Exit full screen
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto bg-surface/40 p-3 lg:p-5">
            {table}
          </div>
        </div>
      )}
    </AppShell>
  );
}

function SlipGroup({
  lines,
  busy,
  detailed,
  onDecide,
  onReceive,
}: {
  lines: RequestLine[];
  busy: boolean;
  detailed: boolean;
  onDecide: (id: number, mode: "stock" | "split" | "pr" | "reject") => void;
  onReceive: (id: number) => void;
}) {
  const head = lines[0];
  const isGroup = lines.length > 1 && head.groupToken != null;

  return (
    <Fragment>
      <tr className="border-t border-line-strong bg-brass-soft/40">
        <td colSpan={7} className="px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold">{head.token}</span>
              {isGroup && (
                <Badge tone="brass" className="font-mono">
                  {lines.length} items · {head.groupToken}
                </Badge>
              )}
              <span className="text-xs text-muted">
                {fmtDate(head.slipDate)}
                {head.decidedAt ? ` · decided ${fmtDate(head.decidedAt)}` : ""}
              </span>
            </div>
            <div className="text-xs text-muted">
              <span className="font-semibold text-ink">{head.department}</span>
              {head.hodTitle ? ` · ${head.hodTitle}` : ""}
            </div>
            <div className="text-xs text-muted">
              {head.hodConfirmed ? (
                <Badge tone="ok">Authorised</Badge>
              ) : (
                <Badge tone="stop">Not authorised</Badge>
              )}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <StatusBadge status={head.status} />
            </div>
          </div>
        </td>
        <td
          aria-hidden
          className="sticky right-0 z-20 border-l border-line-strong bg-brass-soft/40"
        />
      </tr>

      {lines.map((l) => (
        <RequestRow
          key={l.id}
          line={l}
          busy={busy}
          detailed={detailed}
          onDecide={onDecide}
          onReceive={onReceive}
        />
      ))}
    </Fragment>
  );
}

function RequestRow({
  line: l,
  busy,
  detailed,
  onDecide,
  onReceive,
}: {
  line: RequestLine;
  busy: boolean;
  detailed: boolean;
  onDecide: (id: number, mode: "stock" | "split" | "pr" | "reject") => void;
  onReceive: (id: number) => void;
}) {
  const v = verdictFor(l.requestedQty, l.currentStock);
  return (
    <Fragment>
      <tr className="border-t border-line align-top transition-colors hover:bg-surface/60 [&>td]:align-top">
      <td className="px-4 py-3">
        <div className="font-medium text-ink">{l.cellStation || "—"}</div>
        {(l.machineCode || l.machineName) && (
          <div className="mt-1 text-xs text-muted">
            {l.machineCode ?? ""}
            {l.machineName ? ` · ${l.machineName}` : ""}
          </div>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="font-medium text-ink">{l.itemName}</div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-mono text-xs text-muted">{l.itemCode}</span>
          <span className="text-xs font-medium uppercase tracking-wide text-muted">{l.category}</span>
        </div>
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-right">
        <div className={`font-mono text-base font-semibold tabular-nums ${stockColor(l.currentStock, l.requestedQty)}`}>
          {l.currentStock}
        </div>
        <div className="mt-1 text-[11px] text-muted">reorder level {l.reorderLevel ?? 0}</div>
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-right">
        <div className="font-mono font-semibold tabular-nums">
          {l.requestedQty} {l.uom}
        </div>
        {l.issuedQty > 0 && (
          <div className="mt-1 text-xs text-muted">issued {l.issuedQty}</div>
        )}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-right">
        <div className="tabular-nums">
          {l.consumptionRate} {l.uom}/mo
        </div>
        <div className="mt-1 text-xs text-muted">last 30 days</div>
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-right">
        <span className="tabular-nums text-muted">{money(l.unitPrice)} ea</span>
        {" / "}
        <span className="font-semibold tabular-nums">{money(l.totalCost)} total</span>
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-right">
        {l.lastOrderedDate ? (
          <div className="tabular-nums">
            {fmtDate(l.lastOrderedDate)} (Qty: {l.lastOrderedQty})
          </div>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>
      <td className="sticky right-0 z-10 border-l border-line bg-paper px-4 py-3 shadow-[-10px_0_12px_-10px_rgba(28,25,22,0.15)]">
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {l.status === "pending" && (
            <>
              {v.code === "stock" || v.code === "split" ? (
                <Button
                  size="sm"
                  variant="ok"
                  className="whitespace-nowrap"
                  disabled={busy}
                  onClick={() => onDecide(l.id, v.code === "split" ? "split" : "stock")}
                >
                  Approve issue
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="danger"
                  className="whitespace-nowrap"
                  disabled={busy}
                  onClick={() => onDecide(l.id, "pr")}
                >
                  Raise PR
                </Button>
              )}
              {v.code !== "pr" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="whitespace-nowrap"
                  disabled={busy}
                  onClick={() => onDecide(l.id, "pr")}
                >
                  Raise PR
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="whitespace-nowrap"
                disabled={busy}
                onClick={() => onDecide(l.id, "reject")}
              >
                Reject
              </Button>
            </>
          )}
          {(l.status === "pr_open" || l.status === "partial") && (
            <Button
              size="sm"
              variant="ok"
              className="whitespace-nowrap"
              disabled={busy}
              onClick={() => onReceive(l.id)}
            >
              Receive
            </Button>
          )}
          {(l.status === "issued" || l.status === "received" || l.status === "rejected") && (
            <span className="text-xs text-muted">—</span>
          )}
        </div>
      </td>
      </tr>
      {detailed && <DetailRow line={l} />}
    </Fragment>
  );
}

type StockTone = "out" | "low" | "good";

const TONE_CARD: Record<StockTone, string> = {
  out: "border-[#fecaca] bg-[#fef2f2] hover:bg-[#fee2e2]",
  low: "border-[#fef08a] bg-[#fefce8] hover:bg-[#fef9c3]",
  good: "border-[#bbf7d0] bg-[#f0fdf4] hover:bg-[#dcfce7]",
};

function stockToneFor(stock: number, reorder: number): StockTone {
  if (stock <= 0) return "out";
  if (stock <= Math.max(reorder, 0)) return "low";
  return "good";
}

function DetailRow({ line: l }: { line: RequestLine }) {
  const tone = stockToneFor(l.currentStock, l.reorderLevel ?? 0);
  const card = `rounded-sm border p-4 shadow-sm transition-all duration-200 ease-in-out hover:-translate-y-0.5 hover:shadow-md ${TONE_CARD[tone]}`;
  return (
    <tr className="border-t border-line bg-surface/50">
      <td colSpan={8} className="px-6 py-4">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <div className={`${card}`}>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">
              Stock vs request
            </p>
            <div className="mt-2 grid grid-cols-3 gap-2 text-center">
              <MiniStat n={l.currentStock} l="On rack" />
              <MiniStat n={l.requestedQty} l="Asked" />
              <MiniStat n={l.reorderLevel} l="Reorder" />
            </div>
          </div>
          <div className={`${card}`}>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">
              Ordering & cost
            </p>
            <dl className="mt-2 space-y-1.5 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Unit price</dt>
                <dd className="font-mono tabular-nums">{money(l.unitPrice)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Request total</dt>
                <dd className="font-mono font-semibold tabular-nums">{money(l.totalCost)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Usage (30d)</dt>
                <dd className="font-mono tabular-nums">{l.consumptionRate} / mo</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Last order</dt>
                <dd className="font-mono tabular-nums">
                  {l.lastOrderedDate ? `${fmtDate(l.lastOrderedDate)} × ${l.lastOrderedQty}` : "—"}
                </dd>
              </div>
            </dl>
          </div>
          <div className={`${card}`}>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">
              Authorisation
            </p>
            <div className="mt-2 flex items-center justify-between gap-4 text-sm">
              <span className="font-semibold">{l.hodTitle || "—"}</span>
              {l.hodConfirmed ? (
                <Badge tone="ok">Authorised</Badge>
              ) : (
                <Badge tone="stop">Not authorised</Badge>
              )}
            </div>
            <dl className="mt-1.5 space-y-1.5 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Department</dt>
                <dd className="font-medium">{l.department}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Machine</dt>
                <dd className="font-medium">
                  {l.machineCode ?? "—"}
                  {l.machineName ? ` · ${l.machineName}` : ""}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Issued</dt>
                <dd className="font-mono">{l.issuedQty} / {l.requestedQty} {l.uom}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Status</dt>
                <dd className="font-medium">{statusLabel(l.status)}</dd>
              </div>
            </dl>
          </div>
          <div className={`${card}`}>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted">Notes</p>
            <div className="mt-2 space-y-2 text-sm">
              {l.description ? <p className="break-words text-ink">{l.description}</p> : null}
              {l.note ? <p className="break-words text-muted">{l.note}</p> : null}
              {!l.description && !l.note && <p className="text-muted">No notes on this line.</p>}
              <p className="font-mono text-[11px] text-muted">
                Slip date {fmtDate(l.slipDate)}
                {l.decidedAt ? ` · decided ${fmtDate(l.decidedAt)}` : ""}
              </p>
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}

function MiniStat({ n, l }: { n: number; l: string }) {
  return (
    <div className="rounded-md bg-paper px-2 py-2 shadow-card">
      <div className="font-mono text-base font-semibold tabular-nums">{n}</div>
      <div className="text-[11px] text-muted">{l}</div>
    </div>
  );
}

function stockColor(stock: number, requested: number): string {
  if (stock <= 0) return "text-stop";
  if (stock < requested) return "text-wait";
  return "text-ok";
}

function StatusBadge({ status }: { status: SlipStatus }) {
  if (status === "issued" || status === "received") {
    return <Badge tone="ok">{statusLabel(status)}</Badge>;
  }
  if (status === "partial" || status === "pr_open") {
    return <Badge tone="wait">{statusLabel(status)}</Badge>;
  }
  if (status === "rejected") {
    return <Badge tone="stop">{statusLabel(status)}</Badge>;
  }
  return <Badge tone="brass">Pending</Badge>;
}