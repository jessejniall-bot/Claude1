-- ============================================================================
-- Upgrade 001 — comment scraping support
-- Run this once on projects that already applied the original schema.sql.
-- Fresh installs get this from schema.sql and can skip it.
-- ============================================================================

create table if not exists public.scraped_comments (
  id            uuid primary key default gen_random_uuid(),
  community_id  uuid not null references public.communities (id) on delete cascade,
  comment_key   text not null,
  post_key      text,
  comment_text  text not null default '',
  author        text,
  likes         int  not null default 0,
  commented_at  timestamptz,
  scraped_at    timestamptz not null default now(),
  unique (community_id, comment_key)
);

create index if not exists scraped_comments_community_time_idx
  on public.scraped_comments (community_id, commented_at desc);

alter table public.scraped_comments enable row level security;

drop policy if exists "own scraped comments" on public.scraped_comments;
create policy "own scraped comments"
  on public.scraped_comments for all
  using (public.owns_community(community_id))
  with check (public.owns_community(community_id));
