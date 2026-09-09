-- Plant store: item master, machines, digital slips, stock ledger.
-- Unowned rows (no user_id) — one shared plant floor.

create table if not exists items (
  id            serial primary key,
  code          text not null unique,
  name          text not null,
  uom           text not null default 'Pcs',
  reorder_level integer not null default 0,
  qty           integer not null default 0,
  created_at    timestamptz not null default now()
);

create table if not exists machines (
  id         serial primary key,
  code       text not null unique,
  name       text not null,
  line       text not null
);

create table if not exists slips (
  id             serial primary key,
  token          text not null unique,
  item_id        integer not null references items(id),
  machine_id     integer references machines(id),
  qty            integer not null,
  issued_qty     integer not null default 0,
  department     text not null,
  station        text not null default '',
  hod_title      text not null,
  hod_confirmed  boolean not null default false,
  slip_date      date not null,
  status         text not null default 'pending',
  note           text not null default '',
  created_at     timestamptz not null default now(),
  decided_at     timestamptz
);

create table if not exists movements (
  id          serial primary key,
  item_id     integer not null references items(id),
  machine_id  integer references machines(id),
  slip_id     integer references slips(id),
  qty         integer not null,
  kind        text not null,
  created_at  timestamptz not null default now()
);

create index if not exists movements_item_idx on movements (item_id, created_at desc);
create index if not exists movements_machine_idx on movements (machine_id, created_at desc);
create index if not exists slips_status_idx on slips (status, created_at desc);
