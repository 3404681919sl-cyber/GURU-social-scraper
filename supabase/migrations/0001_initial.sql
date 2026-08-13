create extension if not exists pgcrypto;

create table if not exists public.scrape_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null default 'xhs',
  mode text not null,
  target text not null,
  requested_count integer not null check (requested_count between 1 and 100),
  result_count integer not null default 0,
  qa_status text not null default 'PASS',
  status text not null default 'completed',
  created_at timestamptz not null default now()
);

create table if not exists public.snapshots (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null references public.scrape_tasks(id) on delete cascade,
  note_id text not null,
  title text not null,
  url text,
  likes integer not null default 0,
  comments integer not null default 0,
  saves integer not null default 0,
  captured_at timestamptz not null default now()
);

create table if not exists public.schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  frequency text not null,
  scope text not null default 'all',
  active boolean not null default true,
  next_run timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists scrape_tasks_user_created_idx on public.scrape_tasks(user_id, created_at desc);
create index if not exists snapshots_user_captured_idx on public.snapshots(user_id, captured_at desc);
create index if not exists schedules_user_created_idx on public.schedules(user_id, created_at desc);

alter table public.scrape_tasks enable row level security;
alter table public.snapshots enable row level security;
alter table public.schedules enable row level security;

create policy "users manage own scrape tasks" on public.scrape_tasks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users manage own snapshots" on public.snapshots for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users manage own schedules" on public.schedules for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
