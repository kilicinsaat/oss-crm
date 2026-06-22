-- Run this file once in the Supabase SQL Editor.
-- Allows every customer status used by the CRM, for either enum or text schemas.

do $$
declare
  status_schema text;
  status_type text;
  status_kind "char";
  item text;
  constraint_row record;
  allowed_statuses text[] := array[
    'pool', 'assigned', 'called', 'no_answer', 'busy', 'callback',
    'appointment', 'contract_appointment', 'meeting_done',
    'not_approved', 'wrong_number', 'approved', 'paid'
  ];
begin
  select type_namespace.nspname, type_info.typname, type_info.typtype
  into status_schema, status_type, status_kind
  from pg_attribute column_info
  join pg_class table_info on table_info.oid = column_info.attrelid
  join pg_namespace table_namespace on table_namespace.oid = table_info.relnamespace
  join pg_type type_info on type_info.oid = column_info.atttypid
  join pg_namespace type_namespace on type_namespace.oid = type_info.typnamespace
  where table_namespace.nspname = 'public'
    and table_info.relname = 'customers'
    and column_info.attname = 'status'
    and not column_info.attisdropped;

  if status_type is null then
    raise exception 'public.customers.status column was not found';
  end if;

  if status_kind = 'e' then
    foreach item in array allowed_statuses loop
      execute format('alter type %I.%I add value if not exists %L', status_schema, status_type, item);
    end loop;
  else
    for constraint_row in
      select constraint_info.conname
      from pg_constraint constraint_info
      where constraint_info.conrelid = 'public.customers'::regclass
        and constraint_info.contype = 'c'
        and pg_get_constraintdef(constraint_info.oid) ilike '%status%'
    loop
      execute format('alter table public.customers drop constraint %I', constraint_row.conname);
    end loop;

    alter table public.customers
      add constraint customers_status_check
      check (status in (
        'pool', 'assigned', 'called', 'no_answer', 'busy', 'callback',
        'appointment', 'contract_appointment', 'meeting_done',
        'not_approved', 'wrong_number', 'approved', 'paid'
      ));
  end if;
end;
$$;
