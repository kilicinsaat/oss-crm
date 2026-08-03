-- Run once in Supabase SQL Editor.
-- Hardens customer status saves so customer update + customer log insert happen together.

alter type public.customer_status add value if not exists 'using';
alter type public.customer_status add value if not exists 'approved';
alter type public.customer_status add value if not exists 'paid';

do $$
begin
  if exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'customers'
      and constraint_name = 'customers_status_check'
  ) then
    alter table public.customers drop constraint customers_status_check;
  end if;
end $$;

alter table public.customers
  add constraint customers_status_check
  check ((status::text) in (
    'pool',
    'assigned',
    'called',
    'no_answer',
    'busy',
    'callback',
    'appointment',
    'contract_appointment',
    'meeting_done',
    'not_approved',
    'wrong_number',
    'using',
    'approved',
    'paid'
  ));

create or replace function public.crm_save_customer_status(
  p_customer_ids uuid[],
  p_status text,
  p_appointment_date timestamptz default null,
  p_approved boolean default false,
  p_payment_received boolean default false,
  p_info_note text default null,
  p_has_info_note boolean default false
)
returns setof public.customers
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  v_user_id uuid := auth.uid();
  v_customer_id uuid;
  v_before public.customers%rowtype;
  v_status public.customer_status;
  v_saved_count integer := 0;
begin
  if v_user_id is null then
    raise exception 'Authenticated user is required.';
  end if;

  if p_customer_ids is null or array_length(p_customer_ids, 1) is null then
    raise exception 'At least one customer id is required.';
  end if;

  if p_status is null or p_status not in (
    'pool',
    'assigned',
    'called',
    'no_answer',
    'busy',
    'callback',
    'appointment',
    'contract_appointment',
    'meeting_done',
    'not_approved',
    'wrong_number',
    'using',
    'approved',
    'paid'
  ) then
    raise exception 'Invalid customer status: %', coalesce(p_status, '<null>');
  end if;

  v_status := p_status::public.customer_status;

  foreach v_customer_id in array p_customer_ids loop
    select *
    into v_before
    from public.customers
    where id = v_customer_id
    for update;

    if not found then
      continue;
    end if;

    update public.customers
    set
      status = v_status,
      appointment_date = p_appointment_date,
      approved = coalesce(p_approved, false),
      payment_received = coalesce(p_payment_received, false),
      info_note = case
        when p_has_info_note then coalesce(p_info_note, '')
        else info_note
      end,
      last_action_by = v_user_id,
      updated_at = now()
    where id = v_customer_id;

    insert into public.customer_logs (
      customer_id,
      user_id,
      old_status,
      new_status,
      note
    )
    values (
      v_customer_id,
      v_user_id,
      v_before.status::text,
      p_status,
      case when p_has_info_note then coalesce(p_info_note, '') else '' end
    );

    v_saved_count := v_saved_count + 1;
  end loop;

  if v_saved_count = 0 then
    raise exception 'No customer was updated. Check record id or RLS policy.';
  end if;

  return query
  select customer.*
  from public.customers customer
  where customer.id = any(p_customer_ids)
  order by customer.updated_at desc nulls last, customer.created_at desc nulls last;
end;
$function$;

revoke all on function public.crm_save_customer_status(uuid[], text, timestamptz, boolean, boolean, text, boolean) from public;
grant execute on function public.crm_save_customer_status(uuid[], text, timestamptz, boolean, boolean, text, boolean) to authenticated;
