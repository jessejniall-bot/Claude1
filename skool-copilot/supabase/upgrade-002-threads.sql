-- ============================================================================
-- Upgrade 002 — comment threading + reply queue
-- Run this once on projects that already applied schema.sql before v2.
-- Fresh installs get everything from schema.sql and can skip this.
-- ============================================================================

-- 1. Comment nesting + owner flag on the existing comments table.
alter table public.scraped_comments
  add column if not exists parent_comment_key text;
alter table public.scraped_comments
  add column if not exists is_owner boolean not null default false;

create index if not exists scraped_comments_post_idx
  on public.scraped_comments (community_id, post_key);

-- 1b. Post URL slug, so replies can deep-link back to the exact post.
alter table public.scraped_posts
  add column if not exists post_name text;

-- 2. Reply queue — replies composed in the PWA wait here for the extension
--    to submit them from the live Skool tab.
create table if not exists public.reply_queue (
  id                  uuid primary key default gen_random_uuid(),
  community_id        uuid not null references public.communities (id) on delete cascade,
  target_post_key     text not null,
  target_comment_key  text,
  reply_text          text not null,
  context_text        text not null default '',
  status              text not null default 'pending'
                      check (status in ('pending', 'submitting', 'submitted', 'failed', 'cancelled')),
  error               text,
  created_at          timestamptz not null default now(),
  submitted_at        timestamptz
);

create index if not exists reply_queue_pending_idx
  on public.reply_queue (community_id, status, created_at);

alter table public.reply_queue enable row level security;

drop policy if exists "own reply queue" on public.reply_queue;
create policy "own reply queue"
  on public.reply_queue for all
  using (public.owns_community(community_id))
  with check (public.owns_community(community_id));

-- If you use solo mode, also (re-)run supabase/solo-mode.sql so the new
-- reply_queue table gets the open anon policy too.
