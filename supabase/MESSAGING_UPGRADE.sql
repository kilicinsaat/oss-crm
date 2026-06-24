-- Run this file once if the messaging table was created before read receipts existed.

alter table public.app_messages
  add column if not exists reply_to_id bigint references public.app_messages(id) on delete set null,
  add column if not exists read_at timestamptz,
  add column if not exists edited_at timestamptz;

drop policy if exists "Senders update own messages" on public.app_messages;
create policy "Senders update own messages"
  on public.app_messages for update
  to authenticated
  using (sender_id = auth.uid())
  with check (sender_id = auth.uid());

drop policy if exists "Senders delete own messages" on public.app_messages;
create policy "Senders delete own messages"
  on public.app_messages for delete
  to authenticated
  using (sender_id = auth.uid());

create or replace function public.mark_messages_read(p_sender_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.app_messages
  set read_at = coalesce(read_at, now())
  where recipient_id = auth.uid()
    and sender_id = p_sender_id
    and read_at is null;
$$;

revoke all on function public.mark_messages_read(uuid) from public;
grant execute on function public.mark_messages_read(uuid) to authenticated;
