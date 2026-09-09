import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell, Kpi, PageHeader } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getBotStats, listAlerts, listBots, listBotRuns } from "@/lib/bot-server";
import { getCatalog, getInventory, getMachineStats, listSlips } from "@/lib/plant-server";

export const Route = createFileRoute("/system")({ component: SystemPage });

type Tab = "overview" | "tables" | "api" | "live";

function SystemPage() {
  const [tab, setTab] = useState<Tab>("overview");
  const stats = useQuery({ queryKey: ["system-stats"], queryFn: () => getBotStats() });
  const bots = useQuery({ queryKey: ["bots"], queryFn: () => listBots() });
  const runs = useQuery({ queryKey: ["runs"], queryFn: () => listBotRuns({ data: { limit: 8 } }) });
  const alerts = useQuery({ queryKey: ["alerts"], queryFn: () => listAlerts({ data: { limit: 6 } }) });
  const catalog = useQuery({ queryKey: ["catalog"], queryFn: () => getCatalog() });
  const inv = useQuery({ queryKey: ["inventory"], queryFn: () => getInventory() });
  const machines = useQuery({ queryKey: ["machines"], queryFn: () => getMachineStats() });
  const slips = useQuery({ queryKey: ["slips"], queryFn: () => listSlips() });

  return (
    <AppShell>
      <PageHeader
        kicker="System"
        title="Database & API"
        subtitle="Live schema, seed data, and a runnable explorer for every endpoint. The dashboard talks to the same DB via type-safe server functions and plain REST."
        action={
          <div className="flex flex-wrap gap-2">
            <a href="/docs/DATABASE.pdf" target="_blank" rel="noreferrer">
              <Button variant="outline" size="sm">DB PDF</Button>
            </a>
            <a href="/docs/API.pdf" target="_blank" rel="noreferrer">
              <Button variant="outline" size="sm">API PDF</Button>
            </a>
            <a href="/docs/Procurement-Hub-Docs.pdf" target="_blank" rel="noreferrer">
              <Button variant="brass" size="sm">Full PDF</Button>
            </a>
          </div>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Tables" value={9} hint="4 plant + 4 bot + 1 audit" />
        <Kpi label="Bots" value={stats.data?.bots.total ?? bots.data?.length ?? "—"} hint={`${stats.data?.bots.active ?? 0} active`} tone="ok" />
        <Kpi label="Endpoints" value={14} hint="REST + serverFn" />
        <Kpi label="Open alerts" value={stats.data?.alerts.unack ?? alerts.data?.filter((a) => !a.acknowledged).length ?? "—"} tone={stats.data?.alerts.critical ? "stop" : "wait"} hint={stats.data?.alerts.critical ? `${stats.data.alerts.critical} critical` : "no critical"} />
      </div>

      <div className="mb-4 flex flex-wrap gap-1 rounded-lg bg-surface p-1 shadow-inset">
        {(
          [
            ["overview", "Overview"],
            ["tables", "Tables & ER"],
            ["api", "API Endpoints"],
            ["live", "Live Data"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`h-10 rounded-md px-4 text-sm font-medium ${tab === id ? "bg-paper text-ink shadow-card" : "text-muted hover:text-ink"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" && <Overview />}

      {tab === "tables" && <TablesSection />}

      {tab === "api" && <ApiSection />}

      {tab === "live" && (
        <div className="grid gap-6">
          <Card>
            <h3 className="font-semibold">Live counts (from DB now)</h3>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 text-sm">
              <div className="rounded-md bg-surface p-3">Items: <b>{catalog.data?.items.length ?? "…"}</b></div>
              <div className="rounded-md bg-surface p-3">Machines: <b>{catalog.data?.machines.length ?? "…"}</b></div>
              <div className="rounded-md bg-surface p-3">Slips: <b>{slips.data?.length ?? "…"}</b></div>
              <div className="rounded-md bg-surface p-3">Inventory rows: <b>{inv.data?.length ?? "…"}</b></div>
              <div className="rounded-md bg-surface p-3">Machine stats: <b>{machines.data?.length ?? "…"}</b></div>
              <div className="rounded-md bg-surface p-3">Bots: <b>{bots.data?.length ?? "…"}</b></div>
              <div className="rounded-md bg-surface p-3">Runs: <b>{runs.data?.length ?? "…"}</b></div>
              <div className="rounded-md bg-surface p-3">Alerts: <b>{alerts.data?.length ?? "…"}</b></div>
            </div>
            <div className="mt-4 flex gap-2">
              <Button variant="outline" onClick={() => { void stats.refetch(); void bots.refetch(); void runs.refetch(); void alerts.refetch(); void catalog.refetch(); void slips.refetch(); toast.success("Refreshed from DB"); }}>Refresh</Button>
              <a href="/api/openapi.json" target="_blank" rel="noreferrer"><Button variant="brass">Open OpenAPI JSON</Button></a>
            </div>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <h4 className="text-sm font-semibold">Recent bot runs</h4>
              <ul className="mt-3 space-y-2 text-sm">
                {(runs.data ?? []).slice(0, 6).map((r) => (
                  <li key={r.id} className="flex justify-between rounded-md bg-surface px-3 py-2">
                    <span className="font-mono text-xs">{r.botCode} · {r.status}</span>
                    <span className="text-muted text-xs">{new Date(r.startedAt).toLocaleString()} · {r.durationMs}ms</span>
                  </li>
                ))}
                {!runs.data && <li className="text-muted">Loading…</li>}
              </ul>
            </Card>
            <Card>
              <h4 className="text-sm font-semibold">Recent alerts</h4>
              <ul className="mt-3 space-y-2 text-sm">
                {(alerts.data ?? []).slice(0, 6).map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-2 rounded-md bg-surface px-3 py-2">
                    <span><Badge tone={a.severity === "critical" ? "stop" : a.severity === "warn" ? "wait" : "brass"}>{a.severity}</Badge> <span className="ml-1">{a.title}</span></span>
                    <span className="text-xs text-muted">{a.acknowledged ? "ack" : "open"}</span>
                  </li>
                ))}
                {!alerts.data && <li className="text-muted">Loading…</li>}
              </ul>
            </Card>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function Overview() {
  return (
    <div className="grid gap-6">
      <Card>
        <h3 className="text-lg font-semibold">Architecture</h3>
        <p className="mt-2 text-sm text-muted">
          Postgres (Neon in production, PGLite WASM in preview) → <code className="font-mono text-xs bg-surface px-1 py-0.5 rounded">src/lib/db.ts</code> → type-safe <code className="font-mono text-xs bg-surface px-1 py-0.5 rounded">createServerFn</code> (plant & bot) + plain REST under <code className="font-mono text-xs bg-surface px-1 py-0.5 rounded">server/routes/api/*</code> (Nitro). One migration file is the single source of truth.
        </p>
        <div className="mt-4 overflow-x-auto rounded-lg bg-ink p-4 text-paper">
          <pre className="font-mono text-xs leading-5">
{`[ React + TanStack Start ] ─┐
                              ├─► createServerFn ──► getSql() ──► Postgres
[ External / curl / RPA ] ────┘        │
                                       └─► server/routes/api/* (REST JSON)
                                            • /api/health
                                            • /api/catalog, /api/inventory, /api/machines, /api/refill
                                            • /api/slips, /api/slips/decide, /api/slips/receive
                                            • /api/bots, /api/bots/trigger, /api/runs, /api/alerts
`}
          </pre>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          <Badge tone="ok">PGLite fallback</Badge>
          <Badge tone="brass">Neon on DATABASE_URL</Badge>
          <Badge tone="wait">Migrations in /migrations/*.sql</Badge>
          <Badge tone="ok">Seed on first query</Badge>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h4 className="font-semibold">Plant store flow</h4>
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-muted">
            <li><b className="text-ink">Shopfloor</b> raises slip (item, qty, machine, dept, HOD). Stored as <code className="font-mono text-xs">slips.status=pending</code>.</li>
            <li><b className="text-ink">Store</b> decides: <code>stock</code> (issue all), <code>split</code> (issue available + PR), <code>pr</code> (no issue, open PR).</li>
            <li>Issue writes <code>movements.kind=issue</code> with <code>qty=-want</code> and decrements <code>items.qty</code> atomically.</li>
            <li>PR receipt writes <code>movements.kind=receive</code> and increments stock, flip to <code>received</code>.</li>
            <li>Every 30d/8-week aggregates power <code>inventory</code>, <code>machines</code>, <code>refill</code> dashboards.</li>
          </ol>
        </Card>
        <Card>
          <h4 className="font-semibold">Bot dashboard flow</h4>
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-muted">
            <li><b className="text-ink">Bots</b> defined in <code className="font-mono text-xs">bots</code> with <code>cron_expr</code>, <code>config</code> JSON.</li>
            <li>Each execution → <code className="font-mono text-xs">bot_runs</code> (status, trigger, duration, input/output).</li>
            <li>Low-stock / bot failures → <code className="font-mono text-xs">alerts</code> (severity, ack). Tied to <code>items</code> or <code>bots</code>.</li>
            <li>Every mutation → <code className="font-mono text-xs">audit_logs</code> for traceability.</li>
            <li>Dashboard KPIs: active bots, 24h runs, unack alerts — from <code>getBotStats()</code>.</li>
          </ol>
        </Card>
      </div>

      <Card>
        <h4 className="font-semibold">Conventions</h4>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
          <li><b className="text-ink">snake_case</b> in SQL, <b className="text-ink">camelCase</b> in TypeScript (mapped in <code>plant-server.ts</code> / <code>bot-server.ts</code>).</li>
          <li>Unowned rows (no <code>user_id</code>) — shared plant floor. When <code>VITE_AUTH_ENABLED=true</code>, add <code>user_id TEXT</code> and scope by <code>requireUserId()</code>.</li>
          <li>Idempotency: bots use <code>ON CONFLICT (code) DO NOTHING</code> on seed; slips use token derived from count + month.</li>
          <li>Indexes on every foreign key + status + created_at for dashboard queries.</li>
        </ul>
      </Card>
    </div>
  );
}

const TABLE_DEFS: { name: string; sql: string; desc: string; cols: { col: string; type: string; note: string }[]; indexes: string[] }[] = [
  {
    name: "items",
    desc: "Master of stocked spares. Reorder level drives Low/Out badge.",
    sql: "migrations/0002_plant.sql",
    cols: [
      { col: "id", type: "serial PK", note: "auto" },
      { col: "code", type: "text UNIQUE", note: "e.g. HYD-040" },
      { col: "name", type: "text", note: "Hydraulic Oil ISO 68" },
      { col: "uom", type: "text", note: "Pcs / Ltr / Kg" },
      { col: "reorder_level", type: "int", note: "reorder trigger" },
      { col: "qty", type: "int", note: "on-hand" },
      { col: "created_at", type: "timestamptz", note: "now()" },
    ],
    indexes: ["code UNIQUE"],
  },
  {
    name: "machines",
    desc: "Plant assets that consume spares. Used on slips.",
    sql: "migrations/0002_plant.sql",
    cols: [
      { col: "id", type: "serial PK", note: "" },
      { col: "code", type: "text UNIQUE", note: "CNC-01" },
      { col: "name", type: "text", note: "CNC Lathe 01" },
      { col: "line", type: "text", note: "Machine shop" },
    ],
    indexes: ["code UNIQUE"],
  },
  {
    name: "slips",
    desc: "Digital replacement of paper requisition. Verdict → issue or PR.",
    sql: "migrations/0002_plant.sql",
    cols: [
      { col: "id", type: "serial PK", note: "" },
      { col: "token", type: "text UNIQUE", note: "SLIP-2609-0001" },
      { col: "item_id", type: "int FK → items", note: "not null" },
      { col: "machine_id", type: "int FK → machines", note: "nullable" },
      { col: "qty", type: "int", note: "requested" },
      { col: "issued_qty", type: "int", note: "default 0" },
      { col: "department", type: "text", note: "Production…" },
      { col: "station", type: "text", note: "Lathe cell" },
      { col: "hod_title", type: "text", note: "Production HOD" },
      { col: "hod_confirmed", type: "bool", note: "required" },
      { col: "slip_date", type: "date", note: "" },
      { col: "status", type: "text", note: "pending|issued|partial|pr_open|received" },
      { col: "note", type: "text", note: "" },
      { col: "created_at / decided_at", type: "timestamptz", note: "" },
    ],
    indexes: ["slips_status_idx (status, created_at desc)"],
  },
  {
    name: "movements",
    desc: "Immutable ledger: every stock in/out. Powers 30d & weekly charts.",
    sql: "migrations/0002_plant.sql",
    cols: [
      { col: "id", type: "serial PK", note: "" },
      { col: "item_id", type: "int FK → items", note: "" },
      { col: "machine_id", type: "int FK → machines", note: "nullable" },
      { col: "slip_id", type: "int FK → slips", note: "nullable" },
      { col: "qty", type: "int", note: "negative = issue, positive = receive" },
      { col: "kind", type: "text", note: "issue | receive" },
      { col: "created_at", type: "timestamptz", note: "" },
    ],
    indexes: ["movements_item_idx", "movements_machine_idx"],
  },
  {
    name: "bots",
    desc: "RPA bots that automate inventory sync, slip processing, reports.",
    sql: "migrations/0003_bot_dashboard.sql",
    cols: [
      { col: "id", type: "serial PK", note: "" },
      { col: "code", type: "text UNIQUE", note: "BOT-INV-SYNC" },
      { col: "name / description", type: "text", note: "" },
      { col: "type", type: "text", note: "inventory|slip|reorder|report|generic" },
      { col: "status", type: "text", note: "active|paused|error|draft" },
      { col: "cron_expr", type: "text", note: "*/10 * * * *" },
      { col: "config", type: "jsonb", note: "per-bot settings" },
      { col: "last_run_at / next_run_at", type: "timestamptz", note: "" },
    ],
    indexes: ["bots_status_idx", "bots_type_idx"],
  },
  {
    name: "bot_runs",
    desc: "Execution history. Every trigger writes a row with duration & output.",
    sql: "migrations/0003_bot_dashboard.sql",
    cols: [
      { col: "id", type: "serial PK", note: "" },
      { col: "bot_id", type: "int FK → bots", note: "cascade" },
      { col: "status", type: "text", note: "running|success|failed|skipped" },
      { col: "trigger", type: "text", note: "schedule|manual|api|webhook" },
      { col: "started_at / finished_at", type: "timestamptz", note: "" },
      { col: "duration_ms", type: "int", note: "" },
      { col: "input / output", type: "jsonb", note: "" },
      { col: "error", type: "text", note: "" },
    ],
    indexes: ["bot_runs_bot_idx", "bot_runs_status_idx"],
  },
  {
    name: "alerts",
    desc: "Notices for low stock, bot failures. Acknowledgable.",
    sql: "migrations/0003_bot_dashboard.sql",
    cols: [
      { col: "id", type: "serial PK", note: "" },
      { col: "severity", type: "text", note: "info|warn|critical" },
      { col: "title / message", type: "text", note: "" },
      { col: "bot_id", type: "int FK → bots", note: "nullable" },
      { col: "item_id", type: "int FK → items", note: "nullable" },
      { col: "acknowledged", type: "bool", note: "default false" },
    ],
    indexes: ["alerts_severity_idx", "alerts_ack_idx"],
  },
  {
    name: "audit_logs",
    desc: "Append-only trail for compliance. Every mutation logs actor+payload.",
    sql: "migrations/0003_bot_dashboard.sql",
    cols: [
      { col: "id", type: "serial PK", note: "" },
      { col: "actor", type: "text", note: "system / user" },
      { col: "action", type: "text", note: "bot.create / slip.decide…" },
      { col: "entity_type / entity_id", type: "text", note: "" },
      { col: "payload", type: "jsonb", note: "" },
      { col: "created_at", type: "timestamptz", note: "" },
    ],
    indexes: ["audit_logs_entity_idx", "audit_logs_created_idx"],
  },
];

function TablesSection() {
  return (
    <div className="grid gap-6">
      <Card>
        <h3 className="font-semibold">Entity-relationship</h3>
        <div className="mt-3 overflow-x-auto rounded-lg border border-line bg-paper p-2">
          <svg viewBox="0 0 920 360" className="h-auto w-full min-w-[720px]" xmlns="http://www.w3.org/2000/svg">
            <rect x="0" y="0" width="920" height="360" rx="12" fill="#f7f4ec" />
            {/* items */}
            <g>
              <rect x="14" y="18" width="150" height="112" rx="10" fill="#fbfaf6" stroke="#ddd6c8" />
              <text x="89" y="36" textAnchor="middle" fontSize="11" fontWeight="700">items</text>
              <text x="22" y="52" fontSize="9" fill="#6f675c">id PK • code UNIQUE</text>
              <text x="22" y="66" fontSize="9" fill="#6f675c">name, uom, reorder_level</text>
              <text x="22" y="80" fontSize="9" fill="#6f675c">qty (on-hand)</text>
              <text x="22" y="104" fontSize="8" fill="#9a6700">← slips.item_id</text>
              <text x="22" y="116" fontSize="8" fill="#9a6700">← movements.item_id</text>
              <text x="22" y="126" fontSize="8" fill="#9a6700">← alerts.item_id</text>
            </g>
            {/* machines */}
            <g>
              <rect x="194" y="18" width="150" height="112" rx="10" fill="#fbfaf6" stroke="#ddd6c8" />
              <text x="269" y="36" textAnchor="middle" fontSize="11" fontWeight="700">machines</text>
              <text x="202" y="52" fontSize="9" fill="#6f675c">id PK • code UNIQUE</text>
              <text x="202" y="66" fontSize="9" fill="#6f675c">name, line</text>
              <text x="202" y="94" fontSize="8" fill="#9a6700">← slips.machine_id</text>
              <text x="202" y="106" fontSize="8" fill="#9a6700">← movements.machine_id</text>
            </g>
            {/* slips */}
            <g>
              <rect x="374" y="18" width="170" height="138" rx="10" fill="#fff" stroke="#6e470e" strokeWidth="1.3" />
              <text x="459" y="36" textAnchor="middle" fontSize="11" fontWeight="700">slips ★ core</text>
              <text x="382" y="52" fontSize="9" fill="#1c1916">token UNIQUE • qty / issued_qty</text>
              <text x="382" y="66" fontSize="9" fill="#1c1916">department, station, hod_*</text>
              <text x="382" y="80" fontSize="9" fill="#1c1916">slip_date, status, note</text>
              <text x="382" y="94" fontSize="9" fill="#6f675c">item_id → items  •  machine_id → machines</text>
              <text x="382" y="116" fontSize="8" fill="#1d6b3f">── movements.slip_id (issue)</text>
            </g>
            {/* movements */}
            <g>
              <rect x="574" y="18" width="150" height="112" rx="10" fill="#fbfaf6" stroke="#ddd6c8" />
              <text x="649" y="36" textAnchor="middle" fontSize="11" fontWeight="700">movements</text>
              <text x="582" y="52" fontSize="9" fill="#6f675c">qty (+ receive / - issue)</text>
              <text x="582" y="66" fontSize="9" fill="#6f675c">kind, created_at</text>
              <text x="582" y="80" fontSize="9" fill="#6f675c">item_id, machine_id, slip_id</text>
              <text x="582" y="100" fontSize="8" fill="#6f675c">ledger for inventory</text>
            </g>
            {/* bots */}
            <g>
              <rect x="14" y="188" width="150" height="112" rx="10" fill="#fbfaf6" stroke="#ddd6c8" />
              <text x="89" y="206" textAnchor="middle" fontSize="11" fontWeight="700">bots</text>
              <text x="22" y="222" fontSize="9" fill="#6f675c">code UNIQUE • type, status</text>
              <text x="22" y="236" fontSize="9" fill="#6f675c">cron_expr, config jsonb</text>
              <text x="22" y="250" fontSize="9" fill="#6f675c">last_run_at</text>
              <text x="22" y="274" fontSize="8" fill="#1d6b3f">── bot_runs.bot_id</text>
              <text x="22" y="286" fontSize="8" fill="#a61b14">── alerts.bot_id</text>
            </g>
            {/* runs */}
            <g>
              <rect x="194" y="188" width="150" height="112" rx="10" fill="#fbfaf6" stroke="#ddd6c8" />
              <text x="269" y="206" textAnchor="middle" fontSize="11" fontWeight="700">bot_runs</text>
              <text x="202" y="222" fontSize="9" fill="#6f675c">status, trigger, duration_ms</text>
              <text x="202" y="236" fontSize="9" fill="#6f675c">input/output jsonb, error</text>
              <text x="202" y="250" fontSize="9" fill="#6f675c">started / finished</text>
            </g>
            {/* alerts */}
            <g>
              <rect x="374" y="188" width="170" height="112" rx="10" fill="#fbfaf6" stroke="#ddd6c8" />
              <text x="459" y="206" textAnchor="middle" fontSize="11" fontWeight="700">alerts</text>
              <text x="382" y="222" fontSize="9" fill="#6f675c">severity info|warn|critical</text>
              <text x="382" y="236" fontSize="9" fill="#6f675c">title, message, acknowledged</text>
              <text x="382" y="250" fontSize="9" fill="#6f675c">bot_id → bots  •  item_id → items</text>
            </g>
            {/* audit */}
            <g>
              <rect x="574" y="188" width="150" height="112" rx="10" fill="#fbfaf6" stroke="#ddd6c8" />
              <text x="649" y="206" textAnchor="middle" fontSize="11" fontWeight="700">audit_logs</text>
              <text x="582" y="222" fontSize="9" fill="#6f675c">actor, action</text>
              <text x="582" y="236" fontSize="9" fill="#6f675c">entity_type, entity_id</text>
              <text x="582" y="250" fontSize="9" fill="#6f675c">payload jsonb</text>
            </g>
            {/* arrows */}
            <path d="M164 70 H194" stroke="#6e470e" strokeWidth="1.2" markerEnd="url(#arrow)" fill="none" />
            <path d="M344 70 H374" stroke="#6e470e" strokeWidth="1.2" markerEnd="url(#arrow)" fill="none" />
            <path d="M544 70 H574" stroke="#6e470e" strokeWidth="1.2" markerEnd="url(#arrow)" fill="none" />
            <path d="M164 240 H194" stroke="#6e470e" strokeWidth="1.2" markerEnd="url(#arrow)" fill="none" />
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#6e470e" />
              </marker>
            </defs>
          </svg>
        </div>
        <p className="mt-2 text-xs text-muted">Auth tables (<code>user, session, account, verification</code> in <code>migrations/auth/0001_auth.sql</code>) are separate — enabled only when <code>VITE_AUTH_ENABLED=true</code>. They are not shown.</p>
      </Card>

      <div className="grid gap-4">
        {TABLE_DEFS.map((t) => (
          <Card key={t.name} className="p-0 overflow-hidden">
            <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line bg-surface px-5 py-3">
              <div>
                <div className="font-mono text-sm font-semibold">{t.name}</div>
                <div className="text-xs text-muted">{t.desc}</div>
              </div>
              <Badge tone="brass">{t.sql}</Badge>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="bg-surface text-xs uppercase tracking-wider text-muted">
                  <tr><th className="px-4 py-2">Column</th><th className="px-4 py-2">Type</th><th className="px-4 py-2">Notes</th></tr>
                </thead>
                <tbody>
                  {t.cols.map((c) => (
                    <tr key={c.col} className="border-t border-line">
                      <td className="px-4 py-2 font-mono text-xs font-medium">{c.col}</td>
                      <td className="px-4 py-2 font-mono text-xs text-muted">{c.type}</td>
                      <td className="px-4 py-2 text-xs text-muted">{c.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-5 py-2 text-xs text-muted">Indexes: {t.indexes.join(" · ") || "—"}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

const ENDPOINTS: { method: string; path: string; desc: string; body?: string; query?: string; tag: string }[] = [
  { method: "GET", path: "/api/health", desc: "Service + DB driver", tag: "health" },
  { method: "GET", path: "/api/catalog", desc: "Items + machines master", tag: "catalog" },
  { method: "GET", path: "/api/inventory", desc: "Rack + 30d/weekly consumption + daysCover", tag: "inventory" },
  { method: "GET", path: "/api/machines", desc: "Per-machine consumption & breakdown", tag: "machines" },
  { method: "GET", path: "/api/refill", desc: "Refill dashboard rows + weekly series", tag: "refill" },
  { method: "GET", path: "/api/slips?status=pending", desc: "List slips (optional status filter)", tag: "slips", query: "status=pending|issued|partial|pr_open|received" },
  { method: "POST", path: "/api/slips", desc: "Raise slip", tag: "slips", body: `{"itemId":1,"machineId":1,"qty":5,"department":"Production","station":"Lathe cell","hodTitle":"Production HOD","hodConfirmed":true,"slipDate":"2026-09-08"}` },
  { method: "POST", path: "/api/slips/decide", desc: "Store decide: stock | split | pr", tag: "slips", body: `{"id":1,"mode":"stock"}` },
  { method: "POST", path: "/api/slips/receive", desc: "Mark PR received → restock", tag: "slips", body: `{"id":1}` },
  { method: "GET", path: "/api/bots?status=active", desc: "List bots", tag: "bots", query: "status, type" },
  { method: "POST", path: "/api/bots", desc: "Create bot", tag: "bots", body: `{"code":"BOT-TEST","name":"Test Bot","type":"generic","status":"draft"}` },
  { method: "POST", path: "/api/bots/trigger", desc: "Manual run", tag: "bots", body: `{"id":1,"input":{}}` },
  { method: "GET", path: "/api/runs?botId=1&limit=20", desc: "Bot runs", tag: "runs", query: "botId, limit" },
  { method: "GET", path: "/api/alerts?severity=critical", desc: "Alerts", tag: "alerts", query: "severity, acknowledged, limit" },
  { method: "POST", path: "/api/alerts", desc: "Create alert", tag: "alerts", body: `{"severity":"warn","title":"Low stock","message":"...","itemId":1}` },
  { method: "POST", path: "/api/alerts/acknowledge", desc: "Ack alert", tag: "alerts", body: `{"id":1}` },
  { method: "GET", path: "/api/openapi.json", desc: "OpenAPI 3.0 spec", tag: "docs" },
];

function ApiSection() {
  const [filter, setFilter] = useState<string>("all");
  const [results, setResults] = useState<Record<string, string>>({});
  const [customBody, setCustomBody] = useState<Record<string, string>>({});

  const tags = useMemo(() => ["all", ...Array.from(new Set(ENDPOINTS.map((e) => e.tag)))], []);
  const shown = filter === "all" ? ENDPOINTS : ENDPOINTS.filter((e) => e.tag === filter);

  async function tryIt(e: (typeof ENDPOINTS)[number]) {
    const url = e.path;
    const bodyStr = customBody[e.path] ?? e.body ?? "";
    try {
      const opts: RequestInit = { method: e.method, headers: { "content-type": "application/json" } };
      if (e.method === "POST" && bodyStr) opts.body = bodyStr;
      const res = await fetch(url, opts);
      const text = await res.text();
      let pretty = text;
      try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { /* keep */ }
      setResults((m) => ({ ...m, [e.path]: `HTTP ${res.status} ${res.statusText}\n${pretty.slice(0, 4000)}` }));
      toast.success(`${e.method} ${url} → ${res.status}`);
    } catch (err) {
      setResults((m) => ({ ...m, [e.path]: String((err as Error).message) }));
      toast.error(String((err as Error).message));
    }
  }

  return (
    <div className="grid gap-6">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold">REST & Server Functions — dual surface</h3>
            <p className="mt-1 text-sm text-muted">Same Postgres via <code className="font-mono text-xs">getSql()</code>. React uses type-safe <code className="font-mono text-xs">createServerFn</code> (plant-server.ts / bot-server.ts). External RPA, curl, or n8n use plain REST under <code className="font-mono text-xs">/api/*</code> (Nitro). Both seed the same DB.</p>
          </div>
          <a href="/api/openapi.json" target="_blank" rel="noreferrer"><Button variant="outline">OpenAPI JSON</Button></a>
        </div>
        <div className="mt-4 flex flex-wrap gap-1">
          {tags.map((t) => (
            <button key={t} onClick={() => setFilter(t)} className={`rounded-full px-3 py-1.5 text-xs font-medium ${filter === t ? "bg-ink text-paper" : "bg-surface text-muted hover:text-ink"}`}>{t}</button>
          ))}
        </div>
      </Card>

      <div className="grid gap-4">
        {shown.map((e) => (
          <Card key={e.method + e.path} className="p-0 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
              <div className="flex items-center gap-2">
                <Badge tone={e.method === "GET" ? "ok" : e.method === "POST" ? "brass" : "wait"}>{e.method}</Badge>
                <span className="font-mono text-sm font-medium">{e.path}</span>
                <span className="hidden sm:inline text-xs text-muted">— {e.desc}</span>
              </div>
              <Button size="sm" onClick={() => void tryIt(e)}>Try it</Button>
            </div>
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted">Details</div>
                <div className="text-sm text-muted sm:hidden">{e.desc}</div>
                {e.query && <div className="font-mono text-xs">Query: <span className="text-ink">{e.query}</span></div>}
                <div className="text-xs text-muted">Maps to: <code className="font-mono text-xs bg-surface px-1 rounded">{e.tag}</code> in <code className="font-mono text-xs bg-surface px-1 rounded">src/lib/{e.tag === "health" ? "db" : e.tag.startsWith("bot") || e.tag === "runs" || e.tag === "alerts" ? "bot-server" : "plant-server"}.ts</code> + <code className="font-mono text-xs bg-surface px-1 rounded">server/routes/api/{e.path.replace("/api/", "").split("?")[0].replace("/", ".")}.ts</code></div>
                <div className="flex gap-2 pt-1">
                  <a href={e.path} target="_blank" rel="noreferrer" className="text-xs font-medium text-brass underline-offset-2 hover:underline">Open in new tab</a>
                  <span className="text-xs text-muted">·</span>
                  <button onClick={() => navigator.clipboard.writeText(`curl -X ${e.method} ${location.origin}${e.path} ${e.body ? `-H 'content-type: application/json' -d '${e.body}'` : ""}`)} className="text-xs font-medium text-muted hover:text-ink">Copy curl</button>
                </div>
              </div>
              <div className="space-y-2">
                {e.body && (
                  <>
                    <div className="text-xs font-semibold uppercase tracking-wider text-muted">Body (editable)</div>
                    <textarea value={customBody[e.path] ?? e.body} onChange={(ev) => setCustomBody((m) => ({ ...m, [e.path]: ev.target.value }))} rows={4} className="w-full rounded-md border border-line bg-surface px-3 py-2 font-mono text-xs outline-none focus:border-brass" />
                  </>
                )}
                {results[e.path] && (
                  <>
                    <div className="text-xs font-semibold uppercase tracking-wider text-muted">Response</div>
                    <pre className="max-h-64 overflow-auto rounded-md bg-ink px-3 py-2 font-mono text-xs text-paper">{results[e.path]}</pre>
                  </>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden p-0">
        <div className="px-5 py-3 border-b border-line bg-surface">
          <h4 className="text-sm font-semibold">cURL quickstart</h4>
        </div>
        <pre className="overflow-x-auto bg-ink p-4 font-mono text-xs leading-5 text-paper">
{`# health
curl http://localhost:8080/api/health

# catalog & inventory
curl http://localhost:8080/api/catalog | jq
curl http://localhost:8080/api/inventory | jq '.[0]'

# raise a slip
curl -X POST http://localhost:8080/api/slips \\
  -H 'content-type: application/json' \\
  -d '{"itemId":1,"machineId":1,"qty":5,"department":"Production","hodConfirmed":true,"slipDate":"2026-09-08"}'

# store decide (store|split|pr)
curl -X POST http://localhost:8080/api/slips/decide \\
  -H 'content-type: application/json' -d '{"id":1,"mode":"stock"}'

# mark PR received
curl -X POST http://localhost:8080/api/slips/receive \\
  -H 'content-type: application/json' -d '{"id":2}'

# bots
curl http://localhost:8080/api/bots | jq
curl http://localhost:8080/api/runs?limit=5 | jq
curl -X POST http://localhost:8080/api/bots/trigger -H 'content-type: application/json' -d '{"id":1}'
curl http://localhost:8080/api/alerts | jq

# openapi
curl http://localhost:8080/api/openapi.json | jq '.info'
`}
        </pre>
      </Card>
    </div>
  );
}


