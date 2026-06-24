-- Run this file once in the Supabase SQL Editor.
-- It allows only active boss accounts to create staff profiles and delete rep profiles.

create or replace function public.current_user_is_active_boss()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'boss'
      and is_active = true
  );
$$;

revoke all on function public.current_user_is_active_boss() from public;
grant execute on function public.current_user_is_active_boss() to authenticated;

grant insert, delete on table public.profiles to authenticated;

drop policy if exists "Bosses create staff profiles" on public.profiles;
create policy "Bosses create staff profiles"
  on public.profiles for insert
  to authenticated
  with check (
    public.current_user_is_active_boss()
    and role in ('employee', 'manager')
  );

drop policy if exists "Bosses delete rep profiles" on public.profiles;
create policy "Bosses delete rep profiles"
  on public.profiles for delete
  to authenticated
  using (
    public.current_user_is_active_boss()
    and role = 'employee'
    and id <> auth.uid()
  );
