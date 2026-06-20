-- Run this once in Supabase SQL Editor after removing duplicate phone records.
-- These indexes do not create new tables or change customer data.

create unique index if not exists customers_phone_unique_idx
  on public.customers (phone);

create index if not exists customers_assignee_status_idx
  on public.customers (assigned_employee, status);

create index if not exists customers_status_appointment_idx
  on public.customers (status, appointment_date)
  where appointment_date is not null;

create index if not exists customer_logs_customer_created_idx
  on public.customer_logs (customer_id, created_at desc);
