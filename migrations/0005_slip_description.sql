-- Per-item description on slips: what each requested spare is for. Optional free text.
alter table slips add column if not exists description text not null default '';