-- Allow importing multiple customer rows with the same phone number.
-- Call matching and searches can still use the non-unique phone index.

drop index if exists public.customers_phone_unique_idx;

create index if not exists customers_phone_idx
on public.customers (phone);
