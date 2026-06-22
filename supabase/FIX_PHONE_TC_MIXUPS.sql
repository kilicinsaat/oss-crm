-- Run this file once in the Supabase SQL Editor.
-- Repairs/deletes records created by the old importer when TC-like data became a phone.

create or replace function public.current_user_is_active_boss()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'boss'
      and is_active = true
  );
$$;

revoke all on function public.current_user_is_active_boss() from public;
grant execute on function public.current_user_is_active_boss() to authenticated;

create or replace function public.repair_phone_tc_mixups()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  affected_count integer := 0;
begin
  if not public.current_user_is_active_boss() then
    raise exception 'Only an active boss can repair customer data' using errcode = '42501';
  end if;

  select count(*) into affected_count
  from public.customers
  where length(regexp_replace(coalesce(tc_no, ''), '\D', '', 'g')) = 11
    and regexp_replace(coalesce(phone, ''), '\D', '', 'g') =
      right(regexp_replace(coalesce(tc_no, ''), '\D', '', 'g'), 10);

  -- Preserve the card when Telefon 2 contains a real number: promote it to Telefon.
  update public.customers
  set phone = right(regexp_replace(phone_2, '\D', '', 'g'), 10),
      phone_2 = null,
      tc_no = null
  where length(regexp_replace(coalesce(tc_no, ''), '\D', '', 'g')) = 11
    and regexp_replace(coalesce(phone, ''), '\D', '', 'g') =
      right(regexp_replace(coalesce(tc_no, ''), '\D', '', 'g'), 10)
    and length(regexp_replace(coalesce(phone_2, ''), '\D', '', 'g')) >= 10;

  -- If there is no real second phone, remove the corrupt card and its history.
  delete from public.customer_logs
  where customer_id in (
    select id
    from public.customers
    where length(regexp_replace(coalesce(tc_no, ''), '\D', '', 'g')) = 11
      and regexp_replace(coalesce(phone, ''), '\D', '', 'g') =
        right(regexp_replace(coalesce(tc_no, ''), '\D', '', 'g'), 10)
      and length(regexp_replace(coalesce(phone_2, ''), '\D', '', 'g')) < 10
  );

  delete from public.customers
  where length(regexp_replace(coalesce(tc_no, ''), '\D', '', 'g')) = 11
    and regexp_replace(coalesce(phone, ''), '\D', '', 'g') =
      right(regexp_replace(coalesce(tc_no, ''), '\D', '', 'g'), 10)
    and length(regexp_replace(coalesce(phone_2, ''), '\D', '', 'g')) < 10;

  return affected_count;
end;
$$;

revoke all on function public.repair_phone_tc_mixups() from public;
grant execute on function public.repair_phone_tc_mixups() to authenticated;
