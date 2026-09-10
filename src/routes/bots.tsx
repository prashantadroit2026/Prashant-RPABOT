import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell, Kpi, PageHeader } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getCatalog } from "@/lib/plant-server";
import { listBots, listBotRuns, triggerBot } from "@/lib/bot-server";
import { listBotFiles } from "@/lib/bot-files";
import { cn, fmtDate } from "@/lib/utils";

import { RequireRole } from "@/components/role-guard";

export const Route = createFileRoute("/bots")({
  component: () => (
    <RequireRole>
      <BotsPage />
    </RequireRole>
  ),
});

function BotsPage() {
  const qc = useQueryClient();
  const bots = useQuery({ queryKey: ["bots"], queryFn: () => listBots() });
  const runs = useQuery({ queryKey: ["bot-runs-all"], queryFn: () => listBotRuns({ data: { limit: 12 } }) });
  const files = useQuery({ queryKey: ["bot-files"], queryFn: () => listBotFiles() });
  const catalog = useQuery({ queryKey: ["catalog"], queryFn: () => getCatalog() });

  const [selectedBot, setSelectedBot] = useState<number | null>(null);
  const [itemCode, setItemCode] = useState("PCPWB60132");
  const [qty, setQty] = useState("10");
  const [poType, setPoType] = useState("Domestic");
  const [currency, setCurrency] = useState("INR");

  const tcsBot = bots.data?.find((b) => b.code === "BOT-TCS-PRPO") ?? bots.data?.[0];
  const items = catalog.data?.items ?? [];

  const trigger = useMutation({
    mutationFn: (input: { id: number; input: Record<string, unknown> }) => triggerBot({ data: input }),
    onSuccess: (run) => {
      toast.success(`${run.botCode} ${run.status} — ${run.durationMs}ms`);
      void qc.invalidateQueries({ queryKey: ["bot-runs-all"] });
      void qc.invalidateQueries({ queryKey: ["bots"] });
    },
    onError: (e) => toast.error(e.message),
  });

  function handleTrigger(botId: number) {
    if (!itemCode.trim() || !qty.trim()) {
      toast.error("Item code and qty required");
      return;
    }
    trigger.mutate({ id: botId, input: { itemCode: itemCode.trim(), qty: Number(qty) || 10, poType, currency } });
  }

  return (
    <AppShell>
      <PageHeader
        kicker="Automation"
        title="Bot Directory"
        subtitle="Frontend ↔ RPA bridge — trigger the Python TCS bot from the dashboard, see its runs and file source in one place."
        action={
          <div className="flex gap-2">
            <a href="/system" className="no-underline">
              <Button variant="outline" size="sm">System → API</Button>
            </a>
            <a href="/docs/DATABASE.pdf" target="_blank" rel="noreferrer" className="no-underline">
              <Button variant="brass" size="sm">Docs PDF</Button>
            </a>
          </div>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Bots (DB)" value={bots.data?.length ?? "—"} hint={`${bots.data?.filter((b) => b.status === "active").length ?? 0} active`} tone="ok" />
        <Kpi label="Files" value={files.data?.length ?? "—"} hint="Bot/*.py" />
        <Kpi label="Runs (24h)" value={runs.data?.length ?? "—"} hint="latest 12" />
        <Kpi label="Bridge" value={tcsBot ? "Connected" : "—"} hint={tcsBot?.code ?? "no TCS bot"} tone={tcsBot ? "ok" : "stop"} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        {/* File system */}
        <Card>
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Bot/ — file system</h3>
            <Badge tone="brass">{files.data?.length ?? 0} files</Badge>
          </div>
          <p className="mt-1 text-xs text-muted">Live listing from <code className="font-mono text-xs bg-surface px-1 rounded">Bot/</code> on the server. This is the RPA source the dashboard triggers.</p>
          {files.isPending ? (
            <p className="mt-4 text-sm text-muted">Scanning Bot/…</p>
          ) : !files.data || files.data.length === 0 ? (
            <LocalEmptyHint>No Python bots found in Bot/</LocalEmptyHint>
          ) : (
            <ul className="mt-4 space-y-2">
              {files.data.map((f) => (
                <li key={f.name} className="flex items-center justify-between rounded-md bg-surface px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge tone={f.kind === "python" ? "ok" : f.kind === "doc" ? "brass" : "wait"}>{f.kind}</Badge>
                      <span className="truncate font-mono text-sm font-medium">{f.name}</span>
                    </div>
                    <div className="mt-1 font-mono text-xs text-muted">{f.path} • {(f.size / 1024).toFixed(1)} KB • {new Date(f.mtime).toLocaleDateString()}</div>
                  </div>
                  {f.name === "create_pr_po.py" && <span className="ml-2 shrink-0 text-xs text-muted">1490 lines • 41 funcs</span>}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4 rounded-lg bg-ink p-3 font-mono text-xs text-paper">
            <div className="text-muted">Run locally:</div>
            <div>pip install -r Bot/requirements.txt && playwright install chromium</div>
            <div>python Bot/create_pr_po.py --item-code PCPWB60132 --qty 50</div>
            <div className="mt-2 text-muted">Via dashboard (connected):</div>
            <div>POST /api/bots/trigger {"{"}"id": {tcsBot?.id ?? 5}, "input": {"{"}"itemCode":"PCPWB60132","qty":50{"}"}{"}"}</div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href="/api/bots" target="_blank" rel="noreferrer" className="text-xs font-medium text-brass underline">GET /api/bots</a>
            <span className="text-xs text-muted">·</span>
            <a href="/api/runs?limit=5" target="_blank" rel="noreferrer" className="text-xs font-medium text-brass underline">GET /api/runs</a>
            <span className="text-xs text-muted">·</span>
            <span className="text-xs text-muted">Bot ↔ Dashboard: <code className="font-mono text-xs">Bot/dashboard_client.py</code></span>
          </div>
        </Card>

        {/* Trigger */}
        <Card>
          <h3 className="font-semibold">Trigger — Frontend → Bot</h3>
          <p className="mt-1 text-xs text-muted">Pick the TCS bot, choose an item from the live catalog (or type a TCS code), and trigger. The dashboard spawns <code className="font-mono text-xs bg-surface px-1 rounded">python Bot/create_pr_po.py</code> via <code className="font-mono text-xs bg-surface px-1 rounded">rpa-runner.ts</code> and records the run in <code className="font-mono text-xs bg-surface px-1 rounded">bot_runs</code>.</p>

          <div className="mt-4 grid gap-3">
            <div>
              <Label>Bot</Label>
              <Select value={String(selectedBot ?? tcsBot?.id ?? "")} onChange={(e) => setSelectedBot(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Auto (TCS_PRPO)</option>
                {(bots.data ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} — {b.name} ({b.status})
                  </option>
                ))}
              </Select>
              {tcsBot && <p className="mt-1 text-xs text-muted">Default: {tcsBot.code} • {tcsBot.name} • cron {tcsBot.cronExpr}</p>}
            </div>

            <div>
              <Label htmlFor="itemCode">Item code (TCS or dashboard)</Label>
              <div className="flex gap-2">
                <Select
                  id="itemCode"
                  value={items.find((i) => i.code === itemCode) ? itemCode : "__custom__"}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v !== "__custom__") setItemCode(v);
                  }}
                  className="flex-1"
                >
                  <option value="__custom__">Custom / TCS code…</option>
                  {items.slice(0, 8).map((i) => (
                    <option key={i.id} value={i.code}>
                      {i.code} — {i.name}
                    </option>
                  ))}
                </Select>
                <Input value={itemCode} onChange={(e) => setItemCode(e.target.value)} placeholder="PCPWB60132" className="flex-1 font-mono" />
              </div>
              <p className="mt-1 text-xs text-muted">Dashboard codes: {items.slice(0, 3).map((i) => i.code).join(", ")} — or any TCS code like PCPWB60132</p>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label htmlFor="qty">Qty</Label>
                <Input id="qty" type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="poType">PO Type</Label>
                <Select id="poType" value={poType} onChange={(e) => setPoType(e.target.value)}>
                  <option>Domestic</option>
                  <option>Import</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="currency">Currency</Label>
                <Select id="currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  <option>INR</option>
                  <option>USD</option>
                  <option>EUR</option>
                </Select>
              </div>
            </div>

            {!process.env.TCS_USERNAME && (
              <div className="rounded-md bg-wait-soft px-3 py-2 text-xs text-wait">
                <b>Heads-up:</b> <code>TCS_USERNAME</code> / <code>TCS_PASSWORD</code> not set. Trigger will return a failed run with a helpful error (no browser launched). Set them in <code>Bot/.env</code> for a real run.
              </div>
            )}

            <Button
              variant="brass"
              disabled={trigger.isPending}
              onClick={() => {
                const id = selectedBot ?? tcsBot?.id ?? 5;
                if (!id) return toast.error("No bot selected");
                handleTrigger(id);
              }}
              className="w-full"
            >
              {trigger.isPending ? "Running bot…" : tcsBot ? `Trigger ${tcsBot.code}` : "Trigger Bot"}
            </Button>

            {trigger.data && (
              <div className={cn("rounded-md p-3 text-sm", (trigger.data as unknown as { status: string }).status === "success" ? "bg-ok-soft text-ok" : "bg-stop-soft text-stop")}>
                <div className="font-mono text-xs font-semibold">
                  {(trigger.data as unknown as { botCode: string; status: string }).botCode} • {(trigger.data as unknown as { status: string }).status} • {(trigger.data as unknown as { durationMs: number }).durationMs}ms
                </div>
                {(trigger.data as unknown as { output?: { prNumber?: string } }).output?.prNumber && (
                  <div className="mt-1">PR: <b className="font-mono">{(trigger.data as unknown as { output: { prNumber: string } }).output.prNumber}</b></div>
                )}
                {(trigger.data as unknown as { error?: string }).error && <div className="mt-1 text-xs">{String((trigger.data as unknown as { error: string }).error).slice(0, 300)}</div>}
                {(trigger.data as unknown as { output?: { stdoutSnippet?: string } }).output?.stdoutSnippet && (
                  <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-ink p-2 font-mono text-xs text-paper">{String((trigger.data as unknown as { output: { stdoutSnippet: string } }).output.stdoutSnippet).slice(0, 800)}</pre>
                )}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Dashboard bots table */}
      <Card className="mt-6 overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-5 py-3">
          <h3 className="font-semibold">Bots — dashboard registry</h3>
          <div className="flex gap-2">
            <Badge tone="ok">{bots.data?.filter((b) => b.status === "active").length ?? 0} active</Badge>
            <Badge tone="brass">{bots.data?.length ?? 0} total</Badge>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-surface text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-2">Code</th>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Cron</th>
                <th className="px-4 py-2">Last run</th>
                <th className="px-4 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {bots.isPending ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted">
                    Loading bots…
                  </td>
                </tr>
              ) : (
                (bots.data ?? []).map((b) => (
                  <tr key={b.id} className="border-t border-line">
                    <td className="px-4 py-2 font-mono text-xs font-semibold">{b.code}</td>
                    <td className="px-4 py-2">
                      <div className="font-medium">{b.name}</div>
                      <div className="max-w-[320px] truncate text-xs text-muted">{b.description}</div>
                    </td>
                    <td className="px-4 py-2">
                      <Badge tone="brass">{b.type}</Badge>
                    </td>
                    <td className="px-4 py-2">
                      <Badge tone={b.status === "active" ? "ok" : b.status === "paused" ? "wait" : b.status === "error" ? "stop" : "brass"}>{b.status}</Badge>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{b.cronExpr ?? "—"}</td>
                    <td className="px-4 py-2 font-mono text-xs text-muted">{b.lastRunAt ? fmtDate(b.lastRunAt) : "—"}</td>
                    <td className="px-4 py-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={trigger.isPending}
                        onClick={() => handleTrigger(b.id)}
                      >
                        Trigger
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-line bg-surface px-5 py-3 text-xs text-muted">
          Connected via <code className="font-mono">src/lib/rpa-runner.ts</code> → <code className="font-mono">python Bot/create_pr_po.py --item-code --qty</code> → <code className="font-mono">bot_runs</code> + <code className="font-mono">alerts</code>. Simulated bots (inventory/slip) stay fast; <code className="font-mono">BOT-TCS-PRPO</code> is real and respects <code className="font-mono">HEADLESS</code> &amp; <code className="font-mono">TCS_*</code> env.
        </div>
      </Card>

      {/* Recent runs */}
      <Card className="mt-6">
        <h3 className="font-semibold">Recent runs — Frontend ↔ Bot</h3>
        <p className="mt-1 text-xs text-muted">Every trigger (frontend or API) writes a row in <code className="font-mono text-xs">bot_runs</code> with input/output/error. The Python bot also calls <code className="font-mono text-xs">Bot/dashboard_client.py</code> → <code className="font-mono text-xs">POST /api/alerts</code> on success.</p>
        {runs.isPending ? (
          <p className="mt-4 text-sm text-muted">Loading runs…</p>
        ) : !runs.data || runs.data.length === 0 ? (
          <LocalEmptyHint>No runs yet — trigger a bot above.</LocalEmptyHint>
        ) : (
          <div className="mt-4 grid gap-3">
            {runs.data.slice(0, 8).map((r) => (
              <div key={r.id} className="flex flex-wrap items-start justify-between gap-3 rounded-md bg-surface px-4 py-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Badge tone={r.status === "success" ? "ok" : r.status === "failed" ? "stop" : "wait"}>{r.status}</Badge>
                    <span className="font-mono text-xs font-semibold">
                      {r.botCode} • {r.trigger}
                    </span>
                    <span className="text-xs text-muted">{fmtDate(r.startedAt)} • {r.durationMs}ms</span>
                  </div>
                  <div className="mt-1 font-mono text-xs text-muted">input: {JSON.stringify(r.input).slice(0, 120)}</div>
                  {r.output && <div className="mt-1 text-xs">output: <span className="font-mono">{JSON.stringify(r.output).slice(0, 200)}</span></div>}
                  {r.error && <div className="mt-1 text-xs text-stop">error: {String(r.error).slice(0, 300)}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* How it connects */}
      <Card className="mt-6 bg-ink text-paper">
        <h3 className="font-semibold text-paper">How Frontend & RPA are connected</h3>
        <div className="mt-3 grid gap-4 font-mono text-xs leading-5 sm:grid-cols-2">
          <div>
            <div className="font-semibold text-brass-soft">Frontend → Bot</div>
            <div className="mt-1 text-paper/80">Button in <code className="bg-white/10 px-1 rounded">/bots</code> → <code className="bg-white/10 px-1 rounded">triggerBot({`{id, input}`})</code> → <code className="bg-white/10 px-1 rounded">rpa-runner.ts</code> spawns <code className="bg-white/10 px-1 rounded">python Bot/create_pr_po.py --item-code --qty</code> with <code className="bg-white/10 px-1 rounded">HEADLESS</code> &amp; <code className="bg-white/10 px-1 rounded">TCS_*</code> env. Stdout/stderr + prNumber captured → <code className="bg-white/10 px-1 rounded">bot_runs.output</code>.</div>
          </div>
          <div>
            <div className="font-semibold text-brass-soft">Bot → Frontend</div>
            <div className="mt-1 text-paper/80">Python imports <code className="bg-white/10 px-1 rounded">Bot/dashboard_client.py</code> → <code className="bg-white/10 px-1 rounded">GET /api/slips?status=pending</code> to pull work, and <code className="bg-white/10 px-1 rounded">POST /api/alerts</code> / <code className="bg-white/10 px-1 rounded">POST /api/bots</code> to report. Node also inserts <code className="bg-white/10 px-1 rounded">alerts</code> on PR success/fail so <code className="bg-white/10 px-1 rounded">/system</code> lights up.</div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <a href="/api/bots" target="_blank" rel="noreferrer" className="rounded bg-paper px-3 py-1.5 text-xs font-semibold text-ink no-underline">
            GET /api/bots
          </a>
          <a href="/api/openapi.json" target="_blank" rel="noreferrer" className="rounded bg-white/10 px-3 py-1.5 text-xs font-semibold text-paper no-underline">
            OpenAPI
          </a>
          <a href="/system" className="rounded bg-white/10 px-3 py-1.5 text-xs font-semibold text-paper no-underline">
            System → Live
          </a>
        </div>
      </Card>
    </AppShell>
  );
}

function LocalEmptyHint({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg bg-surface px-4 py-8 text-center text-sm text-muted">{children}</p>;
}
