-- Run this small patch in Supabase SQL Editor if larger hardening files hit RLS/policy issues.
-- It only updates Rep removal routing:
-- fresh assigned customers return to the pool; worked customers keep their status for Boss > Customers.

create or replace function public.deactivate_rep_and_release_customers(target_rep_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  released_count integer := 0;
begin
  if not exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'boss'
      and is_active = true
  ) then
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

  update public.customers customer
  set assigned_employee = null,
      assigned_at = null,
      status = case
        when customer.status = 'assigned'
          and customer.last_action_by is distinct from target_rep_id
        then 'pool'::public.customer_status
        else customer.status
      end,
      last_action_by = auth.uid()
  where customer.assigned_employee = target_rep_id;

  get diagnostics released_count = row_count;

  update public.profiles
  set is_active = false
  where id = target_rep_id
    and role = 'employee';

  return released_count;
end;
$function$;

revoke all on function public.deactivate_rep_and_release_customers(uuid) from public;
grant execute on function public.deactivate_rep_and_release_customers(uuid) to authenticated;

notify pgrst, 'reload schema';
