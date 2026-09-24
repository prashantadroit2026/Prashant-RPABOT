-- Bot Dashboard: bots, runs, alerts — extends plant store.
-- Unowned rows (no user_id) — one shared control plane.
-- Depends on 0002_plant.sql (items, machines, slips, movements).

-- Bots: RPA/automation definitions that drive the plant.
create table if not exists bots (
  id            serial primary key,
  code          text not null unique,
  name          text not null,
  description   text not null default '',
  type          text not null default 'generic',
  status        text not null default 'active' check (status in ('active','paused','error','draft')),
  cron_expr     text,
  config        jsonb not null default '{}'::jsonb,
  last_run_at   timestamptz,
  next_run_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists bots_status_idx on bots (status);
create index if not exists bots_type_idx on bots (type);

-- Bot runs: execution history for each bot.
create table if not exists bot_runs (
  id            serial primary key,
  bot_id        integer not null references bots(id) on delete cascade,
  status        text not null default 'success' check (status in ('running','success','failed','skipped')),
  trigger       text not null default 'schedule' check (trigger in ('schedule','manual','api','webhook')),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  duration_ms   integer,
  input         jsonb not null default '{}'::jsonb,
  output        jsonb,
  error         text,
  created_at    timestamptz not null default now()
);

create index if not exists bot_runs_bot_idx on bot_runs (bot_id, started_at desc);
create index if not exists bot_runs_status_idx on bot_runs (status, started_at desc);

-- Alerts: system notices (low stock, PR overdue, bot failure).
create table if not exists alerts (
  id            serial primary key,
  severity      text not null default 'info' check (severity in ('info','warn','critical')),
  title         text not null,
  message       text not null default '',
  bot_id        integer references bots(id) on delete set null,
  item_id       integer references items(id) on delete set null,
  acknowledged  boolean not null default false,
  created_at    timestamptz not null default now()
);

create index if not exists alerts_severity_idx on alerts (severity, created_at desc);
create index if not exists alerts_ack_idx on alerts (acknowledged, created_at desc);
create index if not exists alerts_bot_idx on alerts (bot_id);
create index if not exists alerts_item_idx on alerts (item_id);

-- Audit log: immutable trail for stock/PR/bot actions (optional but useful for dashboard).
create table if not exists audit_logs (
  id            serial primary key,
  actor         text not null default 'system',
  action        text not null,
  entity_type   text not null,
  entity_id     text not null,
  payload       jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists audit_logs_entity_idx on audit_logs (entity_type, entity_id);
create index if not exists audit_logs_created_idx on audit_logs (created_at desc);

-- Seed: 5 representative bots (including TCS iON PR+PO RPA bot)
insert into bots (code, name, description, type, status, cron_expr, config) values
  ('BOT-INV-SYNC', 'Inventory Sync Bot', 'Polls rack quantities every 10 min and raises low-stock alerts.', 'inventory', 'active', '*/10 * * * *', '{"threshold_pct": 15, "notify": "store"}'),
  ('BOT-SLIP-PROC', 'Slip Processor', 'Auto-issues from stock when qty available, else drafts PR.', 'slip', 'active', '*/5 * * * *', '{"auto_issue": true, "require_hod": false}'),
  ('BOT-REORDER', 'Reorder Watcher', 'Computes days-of-cover < 3 and creates PR suggestions.', 'reorder', 'active', '0 */6 * * *', '{"days_cover": 3}'),
  ('BOT-REPORT', 'Nightly Report Bot', 'Generates consumption vs receipt CSV at 02:00 UTC.', 'report', 'paused', '0 2 * * *', '{"format": "csv", "recipients": ["management@plant.local"]}'),
  ('BOT-TCS-PRPO', 'TCS iON PR+PO Bot', 'Creates PR, approves, then creates PO from PR via Playwright. See Bot/create_pr_po.py', 'generic', 'active', '0 9 * * 1', '{"script": "Bot/create_pr_po.py", "item_code": "PCPWB60132", "po_type": "Domestic"}')
on conflict (code) do nothing;

-- Seed: recent runs for each bot (last 7 days)
insert into bot_runs (bot_id, status, trigger, started_at, finished_at, duration_ms, input, output)
select b.id, 'success', 'schedule', now() - (n::text || ' hours')::interval, now() - (n::text || ' hours')::interval + interval '2 seconds', 1200 + (n*13)%800, '{}'::jsonb, jsonb_build_object('checked', 10, 'alerts', n%2)
from bots b cross join generate_series(6, 42, 6) as n
on conflict do nothing;

-- Seed: sample alerts tied to low-stock items
insert into alerts (severity, title, message, item_id, acknowledged)
select
  case when i.qty = 0 then 'critical' when i.qty <= i.reorder_level then 'warn' else 'info' end,
  case when i.qty = 0 then 'Out of stock: ' || i.name when i.qty <= i.reorder_level then 'Low stock: ' || i.name else 'Stock OK: ' || i.name end,
  'Qty ' || i.qty || ' ' || i.uom || ' vs reorder ' || i.reorder_level || '. Days cover computed from 30d consumption.',
  i.id,
  false
from items i where i.qty <= i.reorder_level
on conflict do nothing;
