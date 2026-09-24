-- Item master enrichment: category + unit price for the detailed requests view.
alter table items add column if not exists category text not null default 'General Spares';
alter table items add column if not exists unit_price numeric(12,2) not null default 0;