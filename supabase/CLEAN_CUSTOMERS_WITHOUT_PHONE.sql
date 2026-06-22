-- Run this file once in the Supabase SQL Editor.
-- Deletes only customers that have no Turkish mobile number in either phone field.

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

create or replace function public.delete_customers_without_phone()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  deleted_count integer := 0;
begin
  if not public.current_user_is_active_boss() then
    raise exception 'Only an active boss can clean customer data' using errcode = '42501';
  end if;

  delete from public.customer_logs
  where customer_id in (
    select id
    from public.customers
    where right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) !~ '^5[0-9]{9}$'
      and right(regexp_replace(coalesce(phone_2, ''), '\D', '', 'g'), 10) !~ '^5[0-9]{9}$'
  );

  delete from public.customers
  where right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) !~ '^5[0-9]{9}$'
    and right(regexp_replace(coalesce(phone_2, ''), '\D', '', 'g'), 10) !~ '^5[0-9]{9}$';

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.delete_customers_without_phone() from public;
grant execute on function public.delete_customers_without_phone() to authenticated;
