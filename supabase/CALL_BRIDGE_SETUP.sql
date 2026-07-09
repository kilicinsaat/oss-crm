-- Run once in the Supabase SQL Editor before deploying the call-event function.

create table if not exists public.call_sessions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete set null,
  profile_id uuid references public.profiles(id) on delete set null,
  device_id text not null,
  phone text not null,
  direction text not null check (direction in ('incoming', 'outgoing')),
  status text not null check (status in ('ringing', 'answered', 'completed', 'missed')),
  ringing_at timestamptz,
  answered_at timestamptz,
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists call_sessions_customer_created_idx
  on public.call_sessions (customer_id, created_at desc);
create index if not exists call_sessions_profile_created_idx
  on public.call_sessions (profile_id, created_at desc);
create index if not exists call_sessions_open_device_phone_idx
  on public.call_sessions (device_id, phone, created_at desc)
  where ended_at is null;

alter table public.call_sessions enable row level security;

drop policy if exists "call_sessions_select_by_role" on public.call_sessions;
create policy "call_sessions_select_by_role"
on public.call_sessions
for select
to authenticated
using (
  (select public.current_user_customer_role()) in ('boss', 'manager')
  or profile_id = (select auth.uid())
);

revoke insert, update, delete on table public.call_sessions from authenticated;
grant select on table public.call_sessions to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'call_sessions'
  ) then
    alter publication supabase_realtime add table public.call_sessions;
  end if;
end
$$;
