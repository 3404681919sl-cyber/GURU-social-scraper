alter table public.snapshots
  add column if not exists author text,
  add column if not exists content text,
  add column if not exists published_at text,
  add column if not exists tags text[] not null default '{}',
  add column if not exists source_kind text,
  add column if not exists verification_status text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'snapshots_source_kind_check') then
    alter table public.snapshots add constraint snapshots_source_kind_check check (source_kind is null or source_kind = 'agent-browser') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'snapshots_verification_status_check') then
    alter table public.snapshots add constraint snapshots_verification_status_check check (verification_status is null or verification_status = 'verified') not valid;
  end if;
end $$;

create index if not exists snapshots_user_note_captured_idx
  on public.snapshots(user_id, note_id, captured_at desc);
