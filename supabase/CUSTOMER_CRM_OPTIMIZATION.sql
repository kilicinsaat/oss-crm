-- Run once in the Supabase SQL Editor.
-- Adds indexed customer search, exact server summaries, and atomic ownership
-- updates for duplicate customer cards that share a phone number.

create extension if not exists pg_trgm with schema extensions;

create or replace function public.crm_phone_key(raw_value text)
returns text
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $function$
  select case
    when length(regexp_replace(coalesce(raw_value, ''), '[^0-9]', '', 'g')) >= 10
      then right(regexp_replace(coalesce(raw_value, ''), '[^0-9]', '', 'g'), 10)
    else null
  end;
$function$;

alter table public.customers
  add column if not exists phone_key text
    generated always as (public.crm_phone_key(phone)) stored,
  add column if not exists phone_2_key text
    generated always as (public.crm_phone_key(phone_2)) stored,
  add column if not exists search_text text
    generated always as (
      lower(
        coalesce(first_name, '') || ' ' ||
        coalesce(last_name, '') || ' ' ||
        coalesce(email, '') || ' ' ||
        coalesce(phone, '') || ' ' ||
        coalesce(phone_2, '') || ' ' ||
        coalesce(public.crm_phone_key(phone), '') || ' ' ||
        coalesce(public.crm_phone_key(phone_2), '') || ' ' ||
        coalesce(tc_no, '') || ' ' ||
        coalesce(batch_name, '')
      )
    ) stored;

create index if not exists customers_phone_key_idx
  on public.customers (phone_key)
  where phone_key is not null;

create index if not exists customers_phone_2_key_idx
  on public.customers (phone_2_key)
  where phone_2_key is not null;

create index if not exists customers_search_text_trgm_idx
  on public.customers using gin (search_text extensions.gin_trgm_ops);

create index if not exists customers_assignee_created_idx
  on public.customers (assigned_employee, created_at desc, id desc);

create index if not exists customers_assignee_status_created_idx
  on public.customers (assigned_employee, status, created_at desc, id desc);

create index if not exists customers_approved_created_idx
  on public.customers (created_at desc, id desc)
  where approved = true;

create index if not exists customers_payment_created_idx
  on public.customers (created_at desc, id desc)
  where payment_received = true;

-- Keep every imported row, but give all cards sharing a phone number the
-- owner from the most recent assignment. Pool duplicates of an assigned
-- contact become assigned cards instead of remaining available to another rep.
with key_assignments as (
  select phone_key as contact_key, assigned_employee, assigned_at, created_at, id
  from public.customers
  where phone_key is not null and assigned_employee is not null
  union all
  select phone_2_key as contact_key, assigned_employee, assigned_at, created_at, id
  from public.customers
  where phone_2_key is not null and assigned_employee is not null
), canonical_by_key as (
  select distinct on (contact_key)
    contact_key,
    assigned_employee,
    assigned_at,
    created_at as source_created_at,
    id as source_id
  from key_assignments
  order by contact_key, assigned_at desc nulls last, created_at desc, id desc
), owner_candidates as (
  select
    customer.id,
    owner.assigned_employee,
    owner.assigned_at,
    row_number() over (
      partition by customer.id
      order by owner.assigned_at desc nulls last, owner.source_created_at desc, owner.source_id desc
    ) as owner_rank
  from public.customers customer
  join canonical_by_key owner
    on owner.contact_key = customer.phone_key
    or owner.contact_key = customer.phone_2_key
), chosen_owner as (
  select id, assigned_employee, assigned_at
  from owner_candidates
  where owner_rank = 1
)
update public.customers customer
set assigned_employee = owner.assigned_employee,
    assigned_at = coalesce(owner.assigned_at, customer.assigned_at, now()),
    status = case
      when customer.status = 'pool' then 'assigned'::public.customer_status
      else customer.status
    end
from chosen_owner owner
where customer.id = owner.id
  and (
    customer.assigned_employee is distinct from owner.assigned_employee
    or customer.assigned_at is null
    or customer.status = 'pool'
  );

create or replace function public.crm_customer_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  actor_role text;
  result jsonb;
begin
  select role into actor_role
  from public.profiles
  where id = auth.uid() and is_active = true;

  if actor_role is null then
    raise exception 'Active CRM profile not found' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'total', count(*),
    'pool', count(*) filter (where status = 'pool'),
    'assigned', count(*) filter (where status = 'assigned'),
    'assigned_total', count(*) filter (where assigned_employee is not null),
    'fresh_assigned', count(*) filter (
      where status = 'assigned'
        and assigned_employee is not null
        and last_action_by is distinct from assigned_employee
    ),
    'no_answer', count(*) filter (where status = 'no_answer'),
    'busy', count(*) filter (where status = 'busy'),
    'callback', count(*) filter (where status = 'callback'),
    'appointment', count(*) filter (where status = 'appointment'),
    'contract_appointment', count(*) filter (where status = 'contract_appointment'),
    'meeting_done', count(*) filter (where status = 'meeting_done'),
    'not_approved', count(*) filter (where status = 'not_approved'),
    'wrong_number', count(*) filter (where status = 'wrong_number'),
    'using', count(*) filter (where status = 'using'),
    'approved', count(*) filter (where approved = true),
    'paid', count(*) filter (where payment_received = true or status = 'paid'),
    'followups', count(*) filter (
      where status in ('no_answer', 'busy', 'appointment', 'contract_appointment', 'callback', 'meeting_done', 'not_approved')
    ),
    'today_work', count(*) filter (
      where appointment_date < date_trunc('day', now()) + interval '1 day'
        and status in ('callback', 'appointment', 'contract_appointment')
    )
  ) into result
  from public.customers customer
  where actor_role = 'boss' or customer.assigned_employee = auth.uid();

  return coalesce(result, '{}'::jsonb);
end;
$function$;

create or replace function public.crm_related_customer_ids(p_customer_id uuid)
returns table(customer_id uuid)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  actor_role text;
begin
  select role into actor_role
  from public.profiles
  where id = auth.uid() and is_active = true;

  if actor_role is null then
    raise exception 'Active CRM profile not found' using errcode = '42501';
  end if;

  if actor_role <> 'boss' and not exists (
    select 1
    from public.customers
    where id = p_customer_id and assigned_employee = auth.uid()
  ) then
    return;
  end if;

  return query
  with recursive related(id, phone_key, phone_2_key) as (
    select customer.id, customer.phone_key, customer.phone_2_key
    from public.customers customer
    where customer.id = p_customer_id

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
  select distinct related.id
  from related
  join public.customers customer on customer.id = related.id
  where actor_role = 'boss' or customer.assigned_employee = auth.uid();
end;
$function$;

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

  if actor_role <> 'boss' then
    raise exception 'Only an active boss can assign customers' using errcode = '42501';
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

  -- Lock the selected contact keys before discovering related rows. Imports
  -- use the same lock, so a concurrent insert cannot escape this assignment.
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

  if actor_role <> 'boss' then
    raise exception 'Only an active boss can release employee customers' using errcode = '42501';
  end if;

  update public.customers customer
  set assigned_employee = null,
      assigned_at = null,
      status = case
        when customer.status = 'pool' then 'pool'::public.customer_status
        when customer.status = 'assigned' and not exists (
          select 1 from public.customer_logs log where log.customer_id = customer.id
        ) then 'pool'::public.customer_status
        else customer.status
      end,
      last_action_by = auth.uid()
  where customer.assigned_employee = p_employee_id;

  get diagnostics affected_count = row_count;
  return affected_count;
end;
$function$;

create or replace function public.crm_inherit_customer_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  new_phone_key text := public.crm_phone_key(new.phone);
  new_phone_2_key text := public.crm_phone_key(new.phone_2);
  inherited_employee uuid;
  inherited_at timestamptz;
begin
  if new_phone_key is null and new_phone_2_key is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(lock_key, 0))
  from (
    select distinct unnest(array[new_phone_key, new_phone_2_key]) as lock_key
  ) locks
  where lock_key is not null
  order by lock_key;

  select customer.assigned_employee, customer.assigned_at
  into inherited_employee, inherited_at
  from public.customers customer
  where customer.assigned_employee is not null
    and (
      customer.phone_key in (new_phone_key, new_phone_2_key)
      or customer.phone_2_key in (new_phone_key, new_phone_2_key)
    )
  order by customer.assigned_at desc nulls last, customer.created_at desc, customer.id desc
  limit 1;

  if inherited_employee is not null then
    new.assigned_employee := inherited_employee;
    new.assigned_at := coalesce(inherited_at, now());
    if new.status = 'pool' then
      new.status := 'assigned'::public.customer_status;
    end if;
  end if;

  return new;
end;
$function$;

drop trigger if exists customers_inherit_assignment_by_phone on public.customers;
create trigger customers_inherit_assignment_by_phone
  before insert or update of phone, phone_2 on public.customers
  for each row execute function public.crm_inherit_customer_assignment();

revoke all on function public.crm_phone_key(text) from public;
revoke all on function public.crm_customer_summary() from public;
revoke all on function public.crm_related_customer_ids(uuid) from public;
revoke all on function public.crm_assign_customers(uuid[], uuid) from public;
revoke all on function public.crm_release_employee_customers(uuid) from public;
revoke all on function public.crm_inherit_customer_assignment() from public;

grant execute on function public.crm_phone_key(text) to authenticated;
grant execute on function public.crm_customer_summary() to authenticated;
grant execute on function public.crm_related_customer_ids(uuid) to authenticated;
grant execute on function public.crm_assign_customers(uuid[], uuid) to authenticated;
grant execute on function public.crm_release_employee_customers(uuid) to authenticated;

analyze public.customers;
