-- Ember: OPTIONAL message history for live mode.
-- Live mode works fine without this — messages are just ephemeral (gone on refresh).
-- To keep the last messages around the fire: Supabase dashboard → SQL Editor → paste → Run.

create table if not exists public.ember_messages (
  id bigint generated always as identity primary key,
  room text not null,
  name text not null,
  color text,
  text text not null,
  created_at timestamptz not null default now()
);

create index if not exists ember_messages_room_time
  on public.ember_messages (room, created_at desc);

alter table public.ember_messages enable row level security;

-- TEST-TIER SECURITY, on purpose:
-- anyone who has your page link (which contains nothing secret) plus your room name
-- can read and post, same as an unlisted group-chat invite link.
-- Before rolling out wide, lock this down with Supabase Auth (magic links) and
-- replace these policies with auth.uid()-based ones.
create policy "ember read" on public.ember_messages
  for select using (true);

create policy "ember write" on public.ember_messages
  for insert with check (
    char_length(text) <= 280
    and char_length(name) <= 24
    and char_length(room) <= 32
  );
