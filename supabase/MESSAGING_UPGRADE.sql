-- Run this file once in the Supabase SQL Editor.

grant select on table public.profiles to authenticated;

drop policy if exists "Authenticated users view office profiles" on public.profiles;
create policy "Authenticated users view office profiles"
  on public.profiles for select
  to authenticated
  using (true);

alter table public.app_messages
  add column if not exists attachment_url text,
  add column if not exists attachment_name text,
  add column if not exists attachment_type text,
  add column if not exists reply_to_id bigint references public.app_messages(id) on delete set null,
  add column if not exists edited_at timestamptz;

drop policy if exists "Recipients mark messages read" on public.app_messages;

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

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-files',
  'chat-files',
  true,
  10485760,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'application/pdf',
    'text/plain', 'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Chat files are public" on storage.objects;
create policy "Chat files are public"
  on storage.objects for select
  using (bucket_id = 'chat-files');

drop policy if exists "Users upload chat files" on storage.objects;
create policy "Users upload chat files"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'chat-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "Users delete own chat files" on storage.objects;
create policy "Users delete own chat files"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'chat-files'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
