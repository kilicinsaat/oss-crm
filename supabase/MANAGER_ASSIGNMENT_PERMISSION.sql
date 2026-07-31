-- Run once in Supabase SQL Editor.
-- Lets active managers use the same customer assignment/release actions as boss.
-- Rep deletion and staff creation remain boss-only.

create or replace function public.crm_assign_customers(
  p_customer_ids uuid[],
  p_employee_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  actor_role text;
  target_ids uuid[];
  affected_count integer := 0;
begin
  select role into actor_role
  from public.profiles
  where id = auth.uid() and is_active = true;

  if actor_role not in ('boss', 'manager') then
    raise exception 'Only an active boss or manager can assign customers' using errcode = '42501';
  end if;

  if coalesce(array_length(p_customer_ids, 1), 0) = 0 then
    return 0;
  end if;

  if p_employee_id is not null and not exists (
    select 1
    from public.profiles
    where id = p_employee_id
      and is_active = true
      and role in ('employee', 'manager')
  ) then
    raise exception 'Active employee or manager not found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(lock_key, 0))
  from (
    select distinct unnest(array[customer.phone_key, customer.phone_2_key]) as lock_key
    from public.customers customer
    where customer.id = any(p_customer_ids)
  ) locks
  where lock_key is not null
  order by lock_key;

  with recursive related(id, phone_key, phone_2_key) as (
    select customer.id, customer.phone_key, customer.phone_2_key
    from public.customers customer
    where customer.id = any(p_customer_ids)

    union

    select candidate.id, candidate.phone_key, candidate.phone_2_key
    from public.customers candidate
    join related current_customer on (
      current_customer.phone_key is not null
      and (candidate.phone_key = current_customer.phone_key or candidate.phone_2_key = current_customer.phone_key)
    ) or (
      current_customer.phone_2_key is not null
      and (candidate.phone_key = current_customer.phone_2_key or candidate.phone_2_key = current_customer.phone_2_key)
    )
  )
  select array_agg(distinct id) into target_ids
  from related;

  if coalesce(array_length(target_ids, 1), 0) = 0 then
    return 0;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(lock_key, 0))
  from (
    select distinct unnest(array[customer.phone_key, customer.phone_2_key]) as lock_key
    from public.customers customer
    where customer.id = any(target_ids)
  ) locks
  where lock_key is not null
  order by lock_key;

  update public.customers customer
  set assigned_employee = p_employee_id,
      assigned_at = case when p_employee_id is null then null else now() end,
      status = case
        when p_employee_id is null and customer.status = 'pool' then 'pool'::public.customer_status
        when p_employee_id is null and customer.status = 'assigned' and not exists (
          select 1 from public.customer_logs log where log.customer_id = customer.id
        ) then 'pool'::public.customer_status
        when p_employee_id is null then customer.status
        when customer.status = 'pool' then 'assigned'::public.customer_status
        else customer.status
      end,
      last_action_by = auth.uid()
  where customer.id = any(target_ids);

  get diagnostics affected_count = row_count;
  return affected_count;
end;
$function$;

create or replace function public.crm_release_employee_customers(p_employee_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  actor_role text;
  affected_count integer := 0;
begin
  select role into actor_role
  from public.profiles
  where id = auth.uid() and is_active = true;

  if actor_role not in ('boss', 'manager') then
    raise exception 'Only an active boss or manager can release employee customers' using errcode = '42501';
  end if;

  update public.customers customer
  set assigned_employee = null,
      assigned_at = null,
      status = case
        when customer.status = 'assigned'
          and customer.last_action_by is distinct from p_employee_id
        then 'pool'::public.customer_status
        else customer.status
      end,
      last_action_by = auth.uid()
  where customer.assigned_employee = p_employee_id;

  get diagnostics affected_count = row_count;
  return affected_count;
end;
$function$;

revoke all on function public.crm_assign_customers(uuid[], uuid) from public;
revoke all on function public.crm_release_employee_customers(uuid) from public;
grant execute on function public.crm_assign_customers(uuid[], uuid) to authenticated;
grant execute on function public.crm_release_employee_customers(uuid) to authenticated;
