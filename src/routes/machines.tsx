import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppShell, EmptyHint, Kpi, PageHeader } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { getMachineStats } from "@/lib/plant-server";
import { cn } from "@/lib/utils";

import { RequireRole } from "@/components/role-guard";

export const Route = createFileRoute("/machines")({
  component: () => (
    <RequireRole>
      <MachinesPage />
    </RequireRole>
  ),
});

function MachinesPage() {
  const stats = useQuery({ queryKey: ["machines"], queryFn: () => getMachineStats() });
  const rows = stats.data ?? [];
  const [open, setOpen] = useState<number | null>(rows[0]?.id ?? null);
  const selected = rows.find((r) => r.id === open) ?? rows[0];
  const chart = rows.map((r) => ({
    name: r.code,
    consumed: r.consumed30,
  }));

  return (
    <AppShell>
      <PageHeader
        kicker="Consumption"
        title="Which machine uses which spare"
        subtitle="Every issue from store is booked against the machine on the slip. This is the record the paper notes never left behind."
      />
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Kpi label="Machines" value={rows.length} />
        <Kpi
          label="30d issues"
          value={rows.reduce((s, r) => s + r.consumed30, 0)}
          hint="Units drawn"
        />
        <Kpi
          label="Heaviest"
          value={rows.slice().sort((a, b) => b.consumed30 - a.consumed30)[0]?.code ?? "—"}
          hint="Last 30 days"
        />
      </div>

      <Card className="mb-5">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">
          30-day spare draw by machine
        </p>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart} barSize={28}>
              <CartesianGrid stroke="var(--color-line)" vertical={false} />
              <XAxis
                dataKey="name"
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
              <Bar dataKey="consumed" fill="var(--color-brass)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {stats.isPending ? (
        <p className="text-sm text-muted">Loading machines…</p>
      ) : rows.length === 0 ? (
        <EmptyHint>No machines yet.</EmptyHint>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="flex flex-col gap-2">
            {rows.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setOpen(m.id)}
                className={cn(
                  "rounded-lg bg-paper p-4 text-left shadow-card",
                  selected?.id === m.id && "ring-2 ring-brass",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-mono text-xs text-muted">{m.code}</div>
                    <div className="font-semibold">{m.name}</div>
                    <div className="text-xs text-muted">{m.line}</div>
                  </div>
                  <Badge tone="brass">{m.consumed30} / 30d</Badge>
                </div>
                {m.topItem && (
                  <p className="mt-2 text-xs text-muted">Top spare: {m.topItem}</p>
                )}
              </button>
            ))}
          </div>
          <Card>
            {selected ? (
              <>
                <div className="mb-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                    Spare breakdown
                  </p>
                  <h2 className="text-lg font-semibold">{selected.name}</h2>
                  <p className="text-sm text-muted">
                    {selected.distinctItems} distinct spares on record
                  </p>
                </div>
                {selected.rows.length === 0 ? (
                  <EmptyHint>No issues booked to this machine yet.</EmptyHint>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="text-xs uppercase tracking-wider text-muted">
                      <tr>
                        <th className="py-2 text-left">Spare</th>
                        <th className="py-2 text-right">Drawn</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.rows.map((r) => (
                        <tr key={r.itemCode} className="border-t border-line">
                          <td className="py-2">
                            <div className="font-medium">{r.itemName}</div>
                            <div className="font-mono text-xs text-muted">{r.itemCode}</div>
                          </td>
                          <td className="py-2 text-right font-mono tabular-nums">
                            {r.qty} {r.uom}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            ) : null}
          </Card>
        </div>
      )}
    </AppShell>
  );
}
