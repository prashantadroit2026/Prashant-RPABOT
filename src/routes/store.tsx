import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell, EmptyHint, Kpi, PageHeader } from "@/components/app-shell";
import { StockVerdictBanner } from "@/components/stock-verdict";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { statusLabel, verdictFor, type Slip } from "@/lib/plant";
import { decideSlip, listSlips, listSlipGroups, receiveSlip, type SlipGroup } from "@/lib/plant-server";
import { cn, fmtDate } from "@/lib/utils";

import { RequireRole } from "@/components/role-guard";

export const Route = createFileRoute("/store")({
  component: () => (
    <RequireRole roles={["store", "management"]}>
      <StorePage />
    </RequireRole>
  ),
});

type Filter = "pending" | "pr" | "done";

function StorePage() {
  const qc = useQueryClient();
  const slips = useQuery({ queryKey: ["slips"], queryFn: () => listSlips() });
  const groups = useQuery({ queryKey: ["slip-groups"], queryFn: () => listSlipGroups() });
  const [filter, setFilter] = useState<Filter>("pending");

  const rows = slips.data ?? [];
  const pending = rows.filter((s) => s.status === "pending");
  const prs = rows.filter((s) => s.status === "pr_open" || s.status === "partial");
  const done = rows.filter((s) => s.status === "issued" || s.status === "received");

  const shown = filter === "pending" ? pending : filter === "pr" ? prs : done;
  const canIssue = pending.filter((s) => verdictFor(s.qty, s.onHand).code === "stock").length;
  const needPr = pending.filter((s) => verdictFor(s.qty, s.onHand).code !== "stock").length;

  // Build a map from slip id → group token (for multi-item indent badge)
  const slipGroupMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const g of groups.data ?? []) {
      for (const s of g.slips) {
        map.set(s.id, g.groupToken);
      }
    }
    return map;
  }, [groups.data]);

  const decide = useMutation({
    mutationFn: (input: { id: number; mode: "stock" | "split" | "pr" }) =>
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

  return (
    <AppShell>
      <PageHeader
        kicker="Store desk"
        title="Issue from stock, or raise a PR"
        subtitle="Each slip shows rack quantity against the request. You no longer guess from a paper note."
      />
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Waiting" value={pending.length} hint="New slips" />
        <Kpi label="Can issue" value={canIssue} hint="Covered by rack" tone="ok" />
        <Kpi label="Need PR" value={needPr} hint="Short or out" tone="stop" />
        <Kpi label="Open PRs" value={prs.length} hint="Awaiting inward" tone="wait" />
      </div>

      <div className="mb-4 flex flex-wrap gap-1 rounded-lg bg-surface p-1 shadow-inset">
        {(
          [
            ["pending", `Queue (${pending.length})`],
            ["pr", `Open PR (${prs.length})`],
            ["done", `Done (${done.length})`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={cn(
              "h-10 rounded-md px-3 text-sm font-medium",
              filter === id ? "bg-paper text-ink shadow-card" : "text-muted",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {slips.isPending ? (
        <p className="text-sm text-muted">Loading slips…</p>
      ) : shown.length === 0 ? (
        <EmptyHint>Nothing in this queue.</EmptyHint>
      ) : (
        <div className="grid gap-4">
          {shown.map((s) => (
            <SlipCard
              key={s.id}
              slip={s}
              groupToken={slipGroupMap.get(s.id)}
              busy={decide.isPending || receive.isPending}
              onDecide={(mode) => decide.mutate({ id: s.id, mode })}
              onReceive={() => receive.mutate(s.id)}
            />
          ))}
        </div>
      )}
    </AppShell>
  );
}

function SlipCard({
  slip,
  groupToken,
  busy,
  onDecide,
  onReceive,
}: {
  slip: Slip;
  groupToken?: string;
  busy: boolean;
  onDecide: (mode: "stock" | "split" | "pr") => void;
  onReceive: () => void;
}) {
  const v = useMemo(() => verdictFor(slip.qty, slip.onHand), [slip.qty, slip.onHand]);
  const open = slip.status === "pending";
  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-muted">{slip.token}</span>
            {groupToken && (
              <span className="rounded bg-surface px-1.5 py-0.5 font-mono text-[10px] text-muted">
                {groupToken}
              </span>
            )}
          </div>
          <h2 className="text-base font-semibold">
            {slip.itemName}{" "}
            <span className="font-mono text-sm font-medium text-muted">
              × {slip.qty} {slip.uom}
            </span>
          </h2>
          <p className="text-sm text-muted">
            {slip.department}
            {slip.station ? ` · ${slip.station}` : ""} · {slip.machineCode} {slip.machineName} ·{" "}
            {fmtDate(slip.slipDate)}
          </p>
        </div>
        <Badge
          tone={
            slip.status === "issued" || slip.status === "received"
              ? "ok"
              : slip.status === "pending"
                ? "brass"
                : "wait"
          }
        >
          {statusLabel(slip.status)}
        </Badge>
      </div>
      <div className="grid gap-4 p-5 md:grid-cols-[1fr_auto]">
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 text-center">
            <Mini n={slip.onHand} l="On rack" />
            <Mini n={slip.qty} l="Asked" />
            <Mini n={slip.reorderLevel} l="Reorder" />
          </div>
          {open && <StockVerdictBanner verdict={v} />}
          {slip.description && <p className="text-sm text-muted">{slip.description}</p>}
          {slip.note && <p className="text-xs text-muted">{slip.note}</p>}
          <p className="text-xs text-muted">Authorised by {slip.hodTitle}</p>
        </div>
        <div className="flex min-w-[200px] flex-col gap-2">
          {open && v.code === "stock" && (
            <Button variant="ok" disabled={busy} onClick={() => onDecide("stock")}>
              Issue {v.canIssue} from stock
            </Button>
          )}
          {open && v.code === "split" && (
            <>
              <Button variant="brass" disabled={busy} onClick={() => onDecide("split")}>
                Issue {v.canIssue}, PR {v.prQty}
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => onDecide("pr")}>
                Raise PR for all {slip.qty}
              </Button>
            </>
          )}
          {open && v.code === "pr" && (
            <Button variant="danger" disabled={busy} onClick={() => onDecide("pr")}>
              Raise PR for {v.prQty}
            </Button>
          )}
          {open && v.code === "stock" && (
            <Button variant="outline" disabled={busy} onClick={() => onDecide("pr")}>
              Raise PR instead
            </Button>
          )}
          {(slip.status === "pr_open" || slip.status === "partial") && (
            <Button variant="ok" disabled={busy} onClick={onReceive}>
              Mark PR received ({slip.qty - slip.issuedQty} {slip.uom})
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function Mini({ n, l }: { n: number; l: string }) {
  return (
    <div className="rounded-md bg-surface py-2">
      <div className="font-mono text-lg font-semibold tabular-nums">{n}</div>
      <div className="text-[11px] text-muted">{l}</div>
    </div>
  );
}
