-- Slip groups: one form submission can request multiple items at once.
-- Each group references one machine and department; each line item is a row in slips.

create table if not exists slip_groups (
  id            serial primary key,
  group_token   text not null unique,
  department    text not null,
  machine_code  text not null default '',
  station       text not null default '',
  hod_confirmed boolean not null default false,
  slip_date     date not null,
  created_at    timestamptz not null default now()
);

alter table slips add column if not exists slip_group_id integer references slip_groups(id);

create index if not exists slips_group_idx on slips (slip_group_id);
