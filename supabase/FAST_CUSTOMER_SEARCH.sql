-- Run once in Supabase SQL Editor.
-- Keeps customer search fast on large datasets, especially phone and TC lookups.

create extension if not exists pg_trgm with schema extensions;

create index if not exists customers_phone_key_idx
  on public.customers (phone_key)
  where phone_key is not null;

create index if not exists customers_phone_2_key_idx
  on public.customers (phone_2_key)
  where phone_2_key is not null;

create index if not exists customers_search_text_trgm_idx
  on public.customers using gin (search_text extensions.gin_trgm_ops);

create index if not exists customers_first_name_trgm_idx
  on public.customers using gin (first_name extensions.gin_trgm_ops)
  where first_name is not null;

create index if not exists customers_last_name_trgm_idx
  on public.customers using gin (last_name extensions.gin_trgm_ops)
  where last_name is not null;

create index if not exists customers_batch_name_trgm_idx
  on public.customers using gin (batch_name extensions.gin_trgm_ops)
  where batch_name is not null;

create index if not exists customers_status_assigned_created_idx
  on public.customers (status, assigned_employee, created_at desc, id desc);

create index if not exists customers_assigned_created_idx
  on public.customers (assigned_employee, created_at desc, id desc)
  where assigned_employee is not null;

create index if not exists customers_pool_created_idx
  on public.customers (created_at desc, id desc)
  where status = 'pool' or assigned_employee is null;

create index if not exists customers_appointment_status_idx
  on public.customers (appointment_date, status, assigned_employee)
  where appointment_date is not null;

create index if not exists customers_tc_no_digits_idx
  on public.customers ((regexp_replace(coalesce(tc_no, ''), '[^0-9]', '', 'g')))
  where nullif(regexp_replace(coalesce(tc_no, ''), '[^0-9]', '', 'g'), '') is not null;

analyze public.customers;
