-- Run this file once in the Supabase SQL Editor.

alter table public.profiles
  add column if not exists availability_status text not null default 'online'
  check (availability_status in ('online', 'busy'));
