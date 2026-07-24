-- Run once in Supabase SQL Editor.
-- Keeps one customer card per phone/TC, but records every uploaded data source row.

begin;

create table if not exists public.customer_data_sources (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  batch_name text not null,
  batch_page integer,
  source_phone text,
  source_phone_2 text,
  source_tc_no text,
  source_contact_key text not null,
  source_info_note text,
  source_extra jsonb not null default '{}'::jsonb,
  import_status text not null default 'existing'
    check (import_status in ('inserted', 'existing')),
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (batch_name, batch_page, source_contact_key)
);

create index if not exists customer_data_sources_batch_idx
  on public.customer_data_sources (batch_name, created_at desc);

create index if not exists customer_data_sources_customer_idx
  on public.customer_data_sources (customer_id);

alter table public.customer_data_sources
  add column if not exists source_info_note text,
  add column if not exists source_extra jsonb not null default '{}'::jsonb;

alter table public.customer_data_sources enable row level security;

drop policy if exists "Authenticated users read customer data sources" on public.customer_data_sources;
create policy "Authenticated users read customer data sources"
  on public.customer_data_sources for select
  to authenticated
  using (true);

grant select on table public.customer_data_sources to authenticated;

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
  source_batch_name text;
  source_batch_page integer;
  existing_customer_id uuid;
  inserted_customer_id uuid;
  source_inserted_id uuid;
  inserted_count integer := 0;
  matched_existing_count integer := 0;
  source_count integer := 0;
  already_tracked_count integer := 0;
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
    source_batch_name := coalesce(nullif(btrim(row_data->>'batch_name'), ''), 'Manuel kayıt');
    source_batch_page := nullif(row_data->>'batch_page', '')::integer;

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

    select customer.id into existing_customer_id
    from public.customers customer
    where customer.phone_key in (primary_key, secondary_key)
       or customer.phone_2_key in (primary_key, secondary_key)
       or (tc_key is not null and regexp_replace(coalesce(customer.tc_no, ''), '[^0-9]', '', 'g') = tc_key)
    order by
      case when customer.status <> 'pool' then 0 else 1 end,
      customer.assigned_at desc nulls last,
      customer.updated_at desc nulls last,
      customer.created_at desc
    limit 1;

    if existing_customer_id is not null then
      insert into public.customer_data_sources (
        customer_id, batch_name, batch_page, source_phone, source_phone_2,
        source_tc_no, source_contact_key, source_info_note, source_extra, import_status, created_by
      ) values (
        existing_customer_id, source_batch_name, source_batch_page, row_data->>'phone',
        nullif(row_data->>'phone_2', ''), tc_key, primary_key,
        nullif(row_data->>'info_note', ''),
        coalesce(row_data->'source_extra', '{}'::jsonb),
        'existing', auth.uid()
      )
      on conflict (batch_name, batch_page, source_contact_key) do nothing
      returning id into source_inserted_id;

      if source_inserted_id is null then
        already_tracked_count := already_tracked_count + 1;
      else
        matched_existing_count := matched_existing_count + 1;
        source_count := source_count + 1;
        update public.customers
        set info_note = nullif(btrim(concat_ws(E'\n\n', nullif(info_note, ''), nullif(row_data->>'info_note', ''))), ''),
            updated_at = now()
        where id = existing_customer_id
          and nullif(row_data->>'info_note', '') is not null
          and coalesce(info_note, '') not like '%' || nullif(row_data->>'info_note', '') || '%';
      end if;
      source_inserted_id := null;
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
    )
    returning id into inserted_customer_id;

    insert into public.customer_data_sources (
      customer_id, batch_name, batch_page, source_phone, source_phone_2,
      source_tc_no, source_contact_key, source_info_note, source_extra, import_status, created_by
    ) values (
      inserted_customer_id, source_batch_name, source_batch_page, row_data->>'phone',
      nullif(row_data->>'phone_2', ''), tc_key, primary_key,
      nullif(row_data->>'info_note', ''),
      coalesce(row_data->'source_extra', '{}'::jsonb),
      'inserted', auth.uid()
    )
    on conflict (batch_name, batch_page, source_contact_key) do nothing
    returning id into source_inserted_id;

    inserted_count := inserted_count + 1;
    if source_inserted_id is null then
      already_tracked_count := already_tracked_count + 1;
    else
      source_count := source_count + 1;
    end if;
    source_inserted_id := null;
  end loop;

  return jsonb_build_object(
    'inserted', inserted_count,
    'matched_existing', matched_existing_count,
    'source_rows', source_count,
    'already_tracked', already_tracked_count,
    'skipped', skipped_count
  );
end;
$function$;

revoke all on function public.crm_import_customers(jsonb) from public;
grant execute on function public.crm_import_customers(jsonb) to authenticated;

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

  if actor_role <> 'boss' then
    raise exception 'Only an active boss can read the live report' using errcode = '42501';
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

commit;
