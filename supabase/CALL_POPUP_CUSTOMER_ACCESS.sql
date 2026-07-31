-- Allows a rep to view a customer card only while an active incoming call for
-- that customer is currently assigned to the rep's extension/profile.
-- This does not give broad access to other reps' customer lists.

create index if not exists call_sessions_live_customer_profile_idx
  on public.call_sessions (customer_id, profile_id, updated_at desc)
  where ended_at is null and status in ('ringing', 'answered');

create index if not exists call_sessions_live_phone_profile_idx
  on public.call_sessions (profile_id, phone, updated_at desc)
  where ended_at is null and status in ('ringing', 'answered');

drop policy if exists customers_select_for_live_call_popup on public.customers;
create policy customers_select_for_live_call_popup
on public.customers
for select
to authenticated
using (
  exists (
    select 1
    from public.call_sessions call
    where call.customer_id = customers.id
      and call.profile_id = auth.uid()
      and call.direction = 'incoming'
      and call.status in ('ringing', 'answered')
      and call.ended_at is null
      and call.updated_at > now() - interval '10 minutes'
  )
  or exists (
    select 1
    from public.call_sessions call
    where call.profile_id = auth.uid()
      and call.direction = 'incoming'
      and call.status in ('ringing', 'answered')
      and call.ended_at is null
      and call.updated_at > now() - interval '10 minutes'
      and regexp_replace(coalesce(call.phone, ''), '[^0-9]', '', 'g') <> ''
      and right(regexp_replace(coalesce(call.phone, ''), '[^0-9]', '', 'g'), 10) in (
        right(regexp_replace(coalesce(customers.phone, ''), '[^0-9]', '', 'g'), 10),
        right(regexp_replace(coalesce(customers.phone_2, ''), '[^0-9]', '', 'g'), 10)
      )
  )
);

notify pgrst, 'reload schema';
