-- Run this file once in the Supabase SQL Editor if customer status values need to be widened.

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
  check (status in (
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
    'approved',
    'paid'
  ));
