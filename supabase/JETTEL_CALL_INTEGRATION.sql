-- Run once in Supabase SQL Editor before enabling Jettel call sync/webhooks.
-- Extends the existing call_sessions table without storing Jettel API secrets.

alter table public.call_sessions
  add column if not exists provider text not null default 'microsip',
  add column if not exists external_call_id text,
  add column if not exists caller_name text,
  add column if not exists extension text,
  add column if not exists transfer_target text,
  add column if not exists recording_url text,
  add column if not exists raw_event jsonb not null default '{}'::jsonb;

create index if not exists call_sessions_provider_external_idx
  on public.call_sessions (provider, external_call_id)
  where external_call_id is not null;

create index if not exists call_sessions_phone_created_idx
  on public.call_sessions (phone, created_at desc);

create index if not exists call_sessions_recording_created_idx
  on public.call_sessions (created_at desc)
  where recording_url is not null;

create table if not exists public.jettel_extensions (
  extension text primary key,
  profile_id uuid references public.profiles(id) on delete set null,
  display_name text,
  line_number text,
  group_name text,
  is_active boolean not null default true,
  is_connected boolean not null default false,
  last_seen_at timestamptz,
  raw_status jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists jettel_extensions_profile_idx
  on public.jettel_extensions (profile_id)
  where profile_id is not null;

alter table public.jettel_extensions enable row level security;

drop policy if exists "jettel_extensions_select_by_role" on public.jettel_extensions;
create policy "jettel_extensions_select_by_role"
on public.jettel_extensions
for select
to authenticated
using ((select public.current_user_customer_role()) in ('boss', 'manager'));

drop policy if exists "jettel_extensions_write_by_boss" on public.jettel_extensions;
create policy "jettel_extensions_write_by_boss"
on public.jettel_extensions
for all
to authenticated
using ((select public.current_user_customer_role()) = 'boss')
with check ((select public.current_user_customer_role()) = 'boss');

insert into public.jettel_extensions (extension, display_name, line_number, group_name)
values
  ('101', '101', '902129030222', 'Default'),
  ('102', '102', '902129030222', 'Default'),
  ('103', '103', '902129030222', 'Default'),
  ('104', '104', '902129030222', 'Default'),
  ('105', '105', '902129030222', 'Default'),
  ('106', '106', '902129030222', 'Default'),
  ('107', '107', '902129030222', 'Default'),
  ('108', '108', '902129030222', 'Default'),
  ('109', '109', '902129030222', 'Default'),
  ('110', '110', '902129030222', 'Default')
on conflict (extension) do update
set display_name = excluded.display_name,
    line_number = excluded.line_number,
    group_name = excluded.group_name,
    updated_at = now();

grant select, update on table public.jettel_extensions to authenticated;

notify pgrst, 'reload schema';
