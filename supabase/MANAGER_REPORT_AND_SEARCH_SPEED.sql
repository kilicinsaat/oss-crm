-- Run once in Supabase SQL Editor.
-- Fixes manager live-report access and keeps customer search fast on large data.

create extension if not exists pg_trgm with schema extensions;

create index if not exists customers_search_text_trgm_idx
  on public.customers using gin (search_text extensions.gin_trgm_ops);

create index if not exists customers_phone_key_idx
  on public.customers (phone_key)
  where phone_key is not null;

create index if not exists customers_phone_2_key_idx
  on public.customers (phone_2_key)
  where phone_2_key is not null;

create index if not exists customers_batch_name_page_created_idx
  on public.customers (batch_name, batch_page, created_at desc, id desc);

create index if not exists customers_assignee_status_created_fast_idx
  on public.customers (assigned_employee, status, created_at desc, id desc);

create index if not exists customers_status_created_fast_idx
  on public.customers (status, created_at desc, id desc);

create or replace function public.crm_live_reporting()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  actor_role text;
  summary_result jsonb;
  rep_result jsonb;
  data_result jsonb;
begin
  select role into actor_role
  from public.profiles
  where id = auth.uid() and is_active = true;

  if actor_role not in ('boss', 'manager') then
    raise exception 'Only an active boss or manager can read the live report' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'total', count(*),
    'pool', count(*) filter (where status = 'pool'),
    'available', count(*) filter (where status = 'pool' or assigned_employee is null),
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
  ) into summary_result
  from public.customers;

  select coalesce(jsonb_agg(to_jsonb(rep_row) order by rep_row.paid desc, rep_row.appointment desc, rep_row.total desc), '[]'::jsonb)
  into rep_result
  from (
    select
      profile.id,
      profile.full_name,
      profile.email,
      profile.role,
      count(customer.id) as total,
      count(customer.id) filter (where customer.status = 'called') as called,
      count(customer.id) filter (where customer.status in ('appointment', 'contract_appointment')) as appointment,
      count(customer.id) filter (where customer.status in ('no_answer', 'busy', 'not_approved', 'wrong_number')) as negative,
      count(customer.id) filter (where customer.approved = true) as approved,
      count(customer.id) filter (where customer.payment_received = true or customer.status = 'paid') as paid,
      count(customer.id) filter (
        where customer.status = 'assigned'
          and customer.last_action_by is distinct from customer.assigned_employee
      ) as untouched,
      count(customer.id) filter (
        where (
          customer.appointment_date < now()
          and customer.status in ('callback', 'appointment', 'contract_appointment')
        ) or (
          customer.status = 'assigned'
          and customer.last_action_by is distinct from customer.assigned_employee
          and customer.assigned_at < now() - interval '24 hours'
        )
      ) as delayed
    from public.profiles profile
    left join public.customers customer on customer.assigned_employee = profile.id
    where profile.is_active = true and profile.role in ('employee', 'manager')
    group by profile.id, profile.full_name, profile.email, profile.role
  ) rep_row;

  select coalesce(jsonb_agg(to_jsonb(data_row) order by data_row.paid desc, data_row.appointment desc, data_row.total desc, data_row.name), '[]'::jsonb)
  into data_result
  from (
    with source_rows as (
      select
        coalesce(nullif(btrim(source.batch_name), ''), 'Manuel kayıt') as name,
        customer.status,
        customer.payment_received
      from public.customer_data_sources source
      join public.customers customer on customer.id = source.customer_id
      union all
      select
        coalesce(nullif(btrim(customer.batch_name), ''), 'Manuel kayıt') as name,
        customer.status,
        customer.payment_received
      from public.customers customer
      where not exists (
        select 1
        from public.customer_data_sources source
        where source.customer_id = customer.id
      )
    )
    select
      name,
      count(*) as total,
      count(*) filter (where status in ('appointment', 'contract_appointment')) as appointment,
      count(*) filter (where payment_received = true or status = 'paid') as paid,
      count(*) filter (where status = 'wrong_number') as "wrongNumber"
    from source_rows
    group by name
  ) data_row;

  return jsonb_build_object(
    'generated_at', now(),
    'summary', coalesce(summary_result, '{}'::jsonb),
    'rep_stats', coalesce(rep_result, '[]'::jsonb),
    'data_stats', coalesce(data_result, '[]'::jsonb)
  );
end;
$function$;

revoke all on function public.crm_live_reporting() from public;
grant execute on function public.crm_live_reporting() to authenticated;

analyze public.customers;
analyze public.profiles;
