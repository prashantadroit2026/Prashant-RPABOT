import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell, EmptyHint, Kpi, PageHeader } from "@/components/app-shell";
import { Sparkline } from "@/components/stock-verdict";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { getInventory } from "@/lib/plant-server";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/inventory")({ component: InventoryPage });

function InventoryPage() {
  const inv = useQuery({ queryKey: ["inventory"], queryFn: () => getInventory() });
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "in" | "low" | "out">("all");
  const rows = useMemo(() => inv.data ?? [], [inv.data]);
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      const okTerm =
        !term ||
        r.name.toLowerCase().includes(term) ||
        r.code.toLowerCase().includes(term);
      const okFilter = filter === "all" || r.status === filter;
      return okTerm && okFilter;
    });
  }, [rows, q, filter]);

  const low = rows.filter((r) => r.status === "low").length;
  const out = rows.filter((r) => r.status === "out").length;

  return (
    <AppShell>
      <PageHeader
        kicker="Rack"
        title="Store inventory"
        subtitle="On-hand quantity, reorder, 30-day consumption, and days of cover. Stock moves when store issues a slip or marks a PR received."
      />
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Items" value={rows.length} />
        <Kpi label="Low" value={low} tone="wait" />
        <Kpi label="Out" value={out} tone="stop" />
        <Kpi
          label="30d issued"
          value={rows.reduce((s, r) => s + r.consumed30, 0)}
          hint="All spares"
        />
      </div>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <Input
          placeholder="Search name or code"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="sm:max-w-xs"
        />
        <Select
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
          className="sm:max-w-[180px]"
        >
          <option value="all">All statuses</option>
          <option value="in">In stock</option>
          <option value="low">Low</option>
          <option value="out">Out</option>
        </Select>
      </div>
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-surface text-xs font-semibold uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-3">Item</th>
                <th className="px-4 py-3">UOM</th>
                <th className="px-4 py-3 text-right">On hand</th>
                <th className="px-4 py-3 text-right">Reorder</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">30d used</th>
                <th className="px-4 py-3 text-right">Cover</th>
                <th className="px-4 py-3">8 weeks</th>
              </tr>
            </thead>
            <tbody>
              {inv.isPending && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted">
                    Loading rack…
                  </td>
                </tr>
              )}
              {!inv.isPending && shown.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8">
                    <EmptyHint>No items match.</EmptyHint>
                  </td>
                </tr>
              )}
              {shown.map((r) => (
                <tr
                  key={r.id}
                  className={cn(
                    "border-t border-line",
                    r.status === "out" && "bg-stop-soft/40",
                    r.status === "low" && "bg-wait-soft/40",
                  )}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium">{r.name}</div>
                    <div className="font-mono text-xs text-muted">{r.code}</div>
                  </td>
                  <td className="px-4 py-3 text-muted">{r.uom}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums font-semibold">
                    {r.qty}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-muted">
                    {r.reorderLevel}
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      tone={r.status === "in" ? "ok" : r.status === "low" ? "wait" : "stop"}
                    >
                      {r.status === "in" ? "In stock" : r.status === "low" ? "Low" : "Out"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">{r.consumed30}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {r.daysCover == null ? "—" : `${r.daysCover}d`}
                  </td>
                  <td className="px-4 py-3">
                    <Sparkline values={r.weekly} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </AppShell>
  );
}
