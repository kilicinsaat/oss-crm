-- Run this file once in the Supabase SQL Editor.
-- Rep removal is intentionally a soft delete so historical records remain valid.
-- Releasing customers and deactivating the Rep happen in one database transaction.

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

create or replace function public.deactivate_rep_and_release_customers(target_rep_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  released_count integer := 0;
begin
  if not public.current_user_is_active_boss() then
    raise exception 'Only an active boss can remove a Rep' using errcode = '42501';
  end if;

  if target_rep_id = auth.uid() then
    raise exception 'You cannot remove your own account' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = target_rep_id
      and role = 'employee'
      and is_active = true
  ) then
    raise exception 'Active Rep profile not found' using errcode = 'P0002';
  end if;

  update public.customers
  set assigned_employee = null,
      status = 'pool',
      assigned_at = null,
      last_action_by = auth.uid()
  where assigned_employee = target_rep_id;

  get diagnostics released_count = row_count;

  update public.profiles
  set is_active = false
  where id = target_rep_id;

  return released_count;
end;
$$;

revoke all on function public.deactivate_rep_and_release_customers(uuid) from public;
grant execute on function public.deactivate_rep_and_release_customers(uuid) to authenticated;

-- Direct profile deletion is no longer needed; the RPC above preserves history safely.
drop policy if exists "Bosses delete rep profiles" on public.profiles;
revoke delete on table public.profiles from authenticated;
