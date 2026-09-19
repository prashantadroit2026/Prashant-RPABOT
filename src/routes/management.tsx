import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppShell, EmptyHint, Kpi, PageHeader } from "@/components/app-shell";
import { Sparkline } from "@/components/stock-verdict";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { statusLabel } from "@/lib/plant";
import { getRefillDashboard, listSlips, receiveSlip } from "@/lib/plant-server";
import { fmtDate } from "@/lib/utils";

import { RequireRole } from "@/components/role-guard";

export const Route = createFileRoute("/management")({
  component: () => (
    <RequireRole roles={["management", "store"]}>
      <ManagementPage />
    </RequireRole>
  ),
});

function ManagementPage() {
  const qc = useQueryClient();
  const dash = useQuery({ queryKey: ["refill"], queryFn: () => getRefillDashboard() });
  const slips = useQuery({ queryKey: ["slips"], queryFn: () => listSlips() });
  const rows = dash.data?.rows ?? [];
  const series = dash.data?.series ?? [];
  const openPr = (slips.data ?? []).filter(
    (s) => s.status === "pr_open" || s.status === "partial",
  );
  const below = rows.filter((r) => r.qty <= r.reorderLevel).length;
  const consumed = rows.reduce((s, r) => s + r.consumed30, 0);
  const received = rows.reduce((s, r) => s + r.received30, 0);

  const receive = useMutation({
    mutationFn: (id: number) => receiveSlip({ data: { id } }),
    onSuccess: (s) => {
      toast.success(`${s.token} booked inward`);
      void qc.invalidateQueries();
    },
    onError: (err) => toast.error(err.message),
  });

  const chart = series.map((p) => ({
    week: p.week.slice(5),
    Consumed: p.consumed,
    Received: p.received,
  }));

  return (
    <AppShell>
      <PageHeader
        kicker="Management"
        title="Stock refill rate"
        subtitle="Consumption versus receipts by week, days of cover, and open PRs — without scrolling a spreadsheet."
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Below reorder" value={below} tone={below ? "stop" : "ok"} />
        <Kpi label="Open PRs" value={openPr.length} tone="wait" />
        <Kpi label="30d consumed" value={consumed} />
        <Kpi
          label="30d refilled"
          value={received}
          hint={consumed > 0 ? `${Math.round((received / consumed) * 100)}% of draw` : undefined}
          tone={received >= consumed ? "ok" : "wait"}
        />
      </div>

      <Card className="mb-6">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
          Weekly draw vs inward
        </p>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} barGap={4}>
              <CartesianGrid stroke="var(--color-line)" vertical={false} />
              <XAxis
                dataKey="week"
                tick={{ fill: "var(--color-muted)", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "var(--color-muted)", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              <Tooltip
                cursor={{ fill: "var(--color-surface)" }}
                contentStyle={{
                  background: "var(--color-paper)",
                  border: "1px solid var(--color-line)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Consumed" fill="var(--color-ink)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Received" fill="var(--color-brass)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="mb-6 grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]">
        <Card className="overflow-hidden p-0">
          <div className="border-b border-line px-5 py-3">
            <h2 className="text-sm font-semibold">Per-item refill</h2>
            <p className="text-xs text-muted">Days of cover uses last-30-day draw</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="bg-surface text-xs font-semibold uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-4 py-2">Item</th>
                  <th className="px-4 py-2 text-right">On hand</th>
                  <th className="px-4 py-2 text-right">Used</th>
                  <th className="px-4 py-2 text-right">Inward</th>
                  <th className="px-4 py-2 text-right">Cover</th>
                  <th className="px-4 py-2">Trend</th>
                </tr>
              </thead>
              <tbody>
                {dash.isPending && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted">
                      Loading refill…
                    </td>
                  </tr>
                )}
                {rows.map((r) => {
                  const short = r.qty <= r.reorderLevel;
                  return (
                    <tr key={r.itemId} className="border-t border-line">
                      <td className="px-4 py-2.5">
                        <div className="font-medium">{r.name}</div>
                        <div className="font-mono text-xs text-muted">{r.code}</div>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                        {r.qty}
                        {short && (
                          <div>
                            <Badge tone="stop">reorder</Badge>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                        {r.consumed30}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                        {r.received30}
                        <div className="text-[11px] text-muted">{r.receipts} receipts</div>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums">
                        {r.daysCover == null ? "—" : `${r.daysCover}d`}
                      </td>
                      <td className="px-4 py-2.5">
                        <Sparkline values={r.weekly} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <h2 className="text-sm font-semibold">Open purchase requisitions</h2>
          <p className="mb-3 text-xs text-muted">
            Raised by store when the rack cannot cover a slip.
          </p>
          {openPr.length === 0 ? (
            <EmptyHint>No open PRs.</EmptyHint>
          ) : (
            <ul className="space-y-3">
              {openPr.map((s) => (
                <li key={s.id} className="rounded-lg bg-surface p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-mono text-xs text-muted">{s.token}</div>
                      <div className="text-sm font-semibold">
                        {s.itemName} × {s.qty - s.issuedQty} {s.uom}
                      </div>
                      <div className="text-xs text-muted">
                        {s.machineCode} · {fmtDate(s.slipDate)} · {statusLabel(s.status)}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ok"
                      disabled={receive.isPending}
                      onClick={() => receive.mutate(s.id)}
                    >
                      Receive
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
