-- Run once in Supabase SQL Editor.
-- Keeps processed customers out of the new pool and makes imports idempotent.

begin;

create or replace function public.crm_import_customers(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  actor_role text;
  row_data jsonb;
  primary_key text;
  secondary_key text;
  tc_key text;
  inserted_count integer := 0;
  skipped_count integer := 0;
begin
  select role into actor_role
  from public.profiles
  where id = auth.uid() and is_active = true;

  if actor_role <> 'boss' then
    raise exception 'Only an active boss can import customers' using errcode = '42501';
  end if;

  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Import payload must be an array' using errcode = '22023';
  end if;

  for row_data in select value from jsonb_array_elements(p_rows)
  loop
    primary_key := public.crm_phone_key(row_data->>'phone');
    secondary_key := public.crm_phone_key(row_data->>'phone_2');
    tc_key := nullif(regexp_replace(coalesce(row_data->>'tc_no', ''), '[^0-9]', '', 'g'), '');

    if primary_key is null then
      skipped_count := skipped_count + 1;
      continue;
    end if;

    perform pg_advisory_xact_lock(hashtextextended(lock_key, 0))
    from (
      select distinct unnest(array[primary_key, secondary_key, case when tc_key is null then null else 'tc:' || tc_key end]) as lock_key
    ) locks
    where lock_key is not null
    order by lock_key;

    if exists (
      select 1
      from public.customers customer
      where customer.phone_key in (primary_key, secondary_key)
         or customer.phone_2_key in (primary_key, secondary_key)
         or (tc_key is not null and regexp_replace(coalesce(customer.tc_no, ''), '[^0-9]', '', 'g') = tc_key)
    ) then
      skipped_count := skipped_count + 1;
      continue;
    end if;

    insert into public.customers (
      first_name, last_name, email, phone, phone_2, tc_no, info_note,
      batch_name, batch_page, status, approved, payment_received,
      created_by, last_action_by
    ) values (
      coalesce(nullif(trim(row_data->>'first_name'), ''), 'Musteri'),
      coalesce(row_data->>'last_name', ''),
      coalesce(row_data->>'email', ''),
      row_data->>'phone',
      nullif(row_data->>'phone_2', ''),
      tc_key,
      coalesce(row_data->>'info_note', ''),
      nullif(row_data->>'batch_name', ''),
      nullif(row_data->>'batch_page', '')::integer,
      'pool'::public.customer_status,
      false,
      false,
      auth.uid(),
      auth.uid()
    );

    inserted_count := inserted_count + 1;
  end loop;

  return jsonb_build_object('inserted', inserted_count, 'skipped', skipped_count);
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
    select 1 from public.profiles
    where id = p_employee_id and is_active = true and role in ('employee', 'manager')
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
    select 1 from public.profiles
    where id = auth.uid() and role = 'boss' and is_active = true
  ) then
    raise exception 'Only an active boss can remove a Rep' using errcode = '42501';
  end if;

  if target_rep_id = auth.uid() then
    raise exception 'You cannot remove your own account' using errcode = '22023';
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
  where customer.assigned_employee = target_rep_id;

  get diagnostics released_count = row_count;

  update public.profiles set is_active = false where id = target_rep_id and role = 'employee';
  return released_count;
end;
$function$;

revoke all on function public.crm_import_customers(jsonb) from public;
revoke all on function public.crm_assign_customers(uuid[], uuid) from public;
revoke all on function public.crm_release_employee_customers(uuid) from public;
revoke all on function public.deactivate_rep_and_release_customers(uuid) from public;
grant execute on function public.crm_import_customers(jsonb) to authenticated;
grant execute on function public.crm_assign_customers(uuid[], uuid) to authenticated;
grant execute on function public.crm_release_employee_customers(uuid) to authenticated;
grant execute on function public.deactivate_rep_and_release_customers(uuid) to authenticated;

-- Repair cards that were previously returned to pool after a real status action.
with latest_action as (
  select distinct on (customer_id)
    customer_id,
    new_status
  from public.customer_logs
  where new_status is not null
    and new_status <> 'pool'
  order by customer_id, created_at desc, id desc
)
update public.customers customer
set status = latest_action.new_status::public.customer_status
from latest_action
where customer.id = latest_action.customer_id
  and customer.status = 'pool';

-- Merge existing cards sharing a primary or secondary phone number. The card
-- with activity/status/ownership wins; history and calls are moved before the
-- duplicate card is deleted.
drop table if exists pg_temp.crm_contact_owner;
drop table if exists pg_temp.crm_duplicate_map;

create temporary table crm_contact_owner as
with activity as (
  select customer_id, count(*) as log_count, max(created_at) as last_log_at
  from public.customer_logs
  group by customer_id
), contacts as (
  select id as customer_id, phone_key as contact_key from public.customers where phone_key is not null
  union
  select id as customer_id, phone_2_key as contact_key from public.customers where phone_2_key is not null
)
select distinct on (contacts.contact_key)
  contacts.contact_key,
  customer.id as keeper_id
from contacts
join public.customers customer on customer.id = contacts.customer_id
left join activity on activity.customer_id = customer.id
order by
  contacts.contact_key,
  (coalesce(activity.log_count, 0) > 0) desc,
  (customer.status not in ('pool', 'assigned')) desc,
  (customer.assigned_employee is not null) desc,
  customer.payment_received desc,
  customer.approved desc,
  activity.last_log_at desc nulls last,
  customer.updated_at desc nulls last,
  customer.created_at desc,
  customer.id;

create unique index crm_contact_owner_key_idx on crm_contact_owner(contact_key);

create temporary table crm_duplicate_map as
with contacts as (
  select id as customer_id, phone_key as contact_key from public.customers where phone_key is not null
  union
  select id as customer_id, phone_2_key as contact_key from public.customers where phone_2_key is not null
), candidates as (
  select
    contacts.customer_id as duplicate_id,
    owner.keeper_id,
    row_number() over (
      partition by contacts.customer_id
      order by
        (coalesce(activity.log_count, 0) > 0) desc,
        (keeper.status not in ('pool', 'assigned')) desc,
        (keeper.assigned_employee is not null) desc,
        keeper.payment_received desc,
        keeper.approved desc,
        activity.last_log_at desc nulls last,
        keeper.updated_at desc nulls last,
        keeper.created_at desc,
        keeper.id
    ) as candidate_rank
  from contacts
  join crm_contact_owner owner on owner.contact_key = contacts.contact_key
  join public.customers keeper on keeper.id = owner.keeper_id
  left join (
    select customer_id, count(*) as log_count, max(created_at) as last_log_at
    from public.customer_logs
    group by customer_id
  ) activity on activity.customer_id = keeper.id
)
select duplicate_id, keeper_id
from candidates
where candidate_rank = 1
  and duplicate_id <> keeper_id;

create unique index crm_duplicate_map_duplicate_idx on crm_duplicate_map(duplicate_id);

-- Resolve chained phone links to one final keeper.
do $merge_roots$
declare
  changed_rows integer;
begin
  loop
    update crm_duplicate_map child
    set keeper_id = parent.keeper_id
    from crm_duplicate_map parent
    where child.keeper_id = parent.duplicate_id
      and child.keeper_id <> parent.keeper_id;
    get diagnostics changed_rows = row_count;
    exit when changed_rows = 0;
  end loop;
end
$merge_roots$;

-- Preserve ownership and business flags from every duplicate in the group.
with group_values as (
  select
    mapping.keeper_id,
    (array_agg(customer.assigned_employee order by customer.assigned_at desc nulls last)
      filter (where customer.assigned_employee is not null))[1] as assigned_employee,
    max(customer.assigned_at) as assigned_at,
    bool_or(customer.approved) as approved,
    bool_or(customer.payment_received) as payment_received
  from crm_duplicate_map mapping
  join public.customers customer on customer.id = mapping.duplicate_id
  group by mapping.keeper_id
)
update public.customers keeper
set assigned_employee = coalesce(keeper.assigned_employee, group_values.assigned_employee),
    assigned_at = coalesce(keeper.assigned_at, group_values.assigned_at),
    approved = keeper.approved or group_values.approved,
    payment_received = keeper.payment_received or group_values.payment_received
from group_values
where keeper.id = group_values.keeper_id;

update public.customer_logs log
set customer_id = mapping.keeper_id
from crm_duplicate_map mapping
where log.customer_id = mapping.duplicate_id;

do $move_calls$
begin
  if to_regclass('public.call_sessions') is not null then
    execute $sql$
      update public.call_sessions call
      set customer_id = mapping.keeper_id
      from crm_duplicate_map mapping
      where call.customer_id = mapping.duplicate_id
    $sql$;
  end if;
end
$move_calls$;

delete from public.customers customer
using crm_duplicate_map mapping
where customer.id = mapping.duplicate_id;

drop table crm_duplicate_map;
drop table crm_contact_owner;

create or replace function public.crm_prevent_duplicate_customer_contact()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  new_phone_key text := public.crm_phone_key(new.phone);
  new_phone_2_key text := public.crm_phone_key(new.phone_2);
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

  if exists (
    select 1
    from public.customers customer
    where customer.id is distinct from new.id
      and (
        customer.phone_key in (new_phone_key, new_phone_2_key)
        or customer.phone_2_key in (new_phone_key, new_phone_2_key)
      )
  ) then
    raise exception 'A customer card with this phone already exists'
      using errcode = '23505';
  end if;

  return new;
end;
$function$;

drop trigger if exists customers_prevent_duplicate_contact on public.customers;
create trigger customers_prevent_duplicate_contact
  before insert or update of phone, phone_2 on public.customers
  for each row execute function public.crm_prevent_duplicate_customer_contact();

revoke all on function public.crm_prevent_duplicate_customer_contact() from public;

create index if not exists customers_tc_digits_idx
  on public.customers ((regexp_replace(coalesce(tc_no, ''), '[^0-9]', '', 'g')))
  where nullif(regexp_replace(coalesce(tc_no, ''), '[^0-9]', '', 'g'), '') is not null;

analyze public.customers;

commit;
