-- Run this file once in the Supabase SQL Editor.
-- It allows signed-in employees to see the office contact list.

grant select on table public.profiles to authenticated;

drop policy if exists "Authenticated users view office profiles" on public.profiles;
create policy "Authenticated users view office profiles"
  on public.profiles for select
  to authenticated
  using (true);
