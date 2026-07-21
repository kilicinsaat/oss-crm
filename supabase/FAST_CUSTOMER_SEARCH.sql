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

create index if not exists customers_tc_no_digits_idx
  on public.customers ((regexp_replace(coalesce(tc_no, ''), '[^0-9]', '', 'g')))
  where nullif(regexp_replace(coalesce(tc_no, ''), '[^0-9]', '', 'g'), '') is not null;

analyze public.customers;
