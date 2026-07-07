-- ============================================================================
-- Skool Community Copilot — Supabase schema
-- ----------------------------------------------------------------------------
-- Multi-tenant from day one. Every row is scoped to a community, and every
-- community is scoped to auth.users via user_id. Row-level security ensures a
-- user can only ever touch rows belonging to communities they own.
--
-- Run this file once in the Supabase SQL editor (or `supabase db push`).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- communities
-- ---------------------------------------------------------------------------
create table if not exists public.communities (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  skool_url   text not null,          -- e.g. https://www.skool.com/my-community
  slug        text generated always as (
                lower(regexp_replace(skool_url, '^https?://(www\.)?skool\.com/([^/?#]+).*$', '\2'))
              ) stored,
  name        text not null,
  created_at  timestamptz not null default now(),
  unique (user_id, skool_url)
);

-- ---------------------------------------------------------------------------
-- pillars — content categories with a target share of posts
-- ---------------------------------------------------------------------------
create table if not exists public.pillars (
  id            uuid primary key default gen_random_uuid(),
  community_id  uuid not null references public.communities (id) on delete cascade,
  slug          text not null,        -- stable key used by the classifier
  name          text not null,
  description   text not null default '',
  target_ratio  numeric not null default 0 check (target_ratio >= 0 and target_ratio <= 100),
  position      int  not null default 0,
  created_at    timestamptz not null default now(),
  unique (community_id, slug)
);

-- ---------------------------------------------------------------------------
-- voice_profiles — one per community, injected into every generation call
-- ---------------------------------------------------------------------------
create table if not exists public.voice_profiles (
  id                uuid primary key default gen_random_uuid(),
  community_id      uuid not null references public.communities (id) on delete cascade,
  tone_notes        text not null default '',
  banned_words      text[] not null default '{}',
  formatting_rules  text not null default '',
  updated_at        timestamptz not null default now(),
  unique (community_id)
);

-- ---------------------------------------------------------------------------
-- scraped_posts — the raw material for the health engine
-- ---------------------------------------------------------------------------
create table if not exists public.scraped_posts (
  id                uuid primary key default gen_random_uuid(),
  community_id      uuid not null references public.communities (id) on delete cascade,
  post_key          text not null,    -- Skool post id when available, else content hash
  post_name         text,             -- Skool URL slug segment, for deep-linking back
  post_text         text not null default '',
  pillar_guess      text,             -- pillar slug from the keyword classifier
  likes             int  not null default 0,
  comments          int  not null default 0,
  posted_at         timestamptz,
  author            text,
  is_question       boolean not null default false,
  first_comment_at  timestamptz,      -- when the feed exposes it; powers response latency
  scraped_at        timestamptz not null default now(),
  unique (community_id, post_key)
);

create index if not exists scraped_posts_community_posted_idx
  on public.scraped_posts (community_id, posted_at desc);

-- ---------------------------------------------------------------------------
-- scraped_comments — comment-level data for participation & health analysis
-- ---------------------------------------------------------------------------
create table if not exists public.scraped_comments (
  id                  uuid primary key default gen_random_uuid(),
  community_id        uuid not null references public.communities (id) on delete cascade,
  comment_key         text not null,   -- Skool comment id when available, else content hash
  post_key            text,            -- best-effort link to scraped_posts.post_key
  parent_comment_key  text,            -- Skool id of the parent comment; null = top-level
  comment_text        text not null default '',
  author              text,
  is_owner            boolean not null default false, -- comment authored by the community owner
  likes               int  not null default 0,
  commented_at        timestamptz,
  scraped_at          timestamptz not null default now(),
  unique (community_id, comment_key)
);

create index if not exists scraped_comments_community_time_idx
  on public.scraped_comments (community_id, commented_at desc);
create index if not exists scraped_comments_post_idx
  on public.scraped_comments (community_id, post_key);

-- ---------------------------------------------------------------------------
-- ideas — captured seeds (member comments, health flags, manual notes)
-- ---------------------------------------------------------------------------
create table if not exists public.ideas (
  id            uuid primary key default gen_random_uuid(),
  community_id  uuid not null references public.communities (id) on delete cascade,
  source        text not null default 'manual'
                check (source in ('capture', 'health_flag', 'manual')),
  content       text not null,
  status        text not null default 'inbox'
                check (status in ('inbox', 'used', 'archived')),
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- drafts — AI-generated, user-edited posts
-- ---------------------------------------------------------------------------
create table if not exists public.drafts (
  id             uuid primary key default gen_random_uuid(),
  community_id   uuid not null references public.communities (id) on delete cascade,
  idea_id        uuid references public.ideas (id) on delete set null,
  pillar_slug    text,
  title          text not null default '',
  body           text not null default '',
  ai_provider    text,
  ai_model       text,
  status         text not null default 'draft'
                 check (status in ('draft', 'ready', 'posted')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- queue — copy-paste schedule (no auto-posting; Skool has no API for that)
-- ---------------------------------------------------------------------------
create table if not exists public.queue (
  id             uuid primary key default gen_random_uuid(),
  community_id   uuid not null references public.communities (id) on delete cascade,
  draft_id       uuid not null references public.drafts (id) on delete cascade,
  scheduled_for  date not null,
  position       int  not null default 0,
  status         text not null default 'queued'
                 check (status in ('queued', 'posted', 'skipped')),
  created_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- reply_queue — replies composed anywhere (e.g. the PWA, which has no live
-- Skool session) waiting for the extension to submit them from the live tab.
-- target_post_key / target_comment_key are Skool's own ids; parent null means
-- a top-level comment on the post, otherwise a reply to that comment.
-- ---------------------------------------------------------------------------
create table if not exists public.reply_queue (
  id                  uuid primary key default gen_random_uuid(),
  community_id        uuid not null references public.communities (id) on delete cascade,
  target_post_key     text not null,
  target_comment_key  text,            -- null = reply to the post; else reply to this comment
  reply_text          text not null,
  context_text        text not null default '', -- the comment being replied to, for display
  status              text not null default 'pending'
                      check (status in ('pending', 'submitting', 'submitted', 'failed', 'cancelled')),
  error               text,
  created_at          timestamptz not null default now(),
  submitted_at        timestamptz
);

create index if not exists reply_queue_pending_idx
  on public.reply_queue (community_id, status, created_at);

-- ============================================================================
-- Row-level security — everything scoped to the owning user
-- ============================================================================
alter table public.communities    enable row level security;
alter table public.pillars        enable row level security;
alter table public.voice_profiles enable row level security;
alter table public.scraped_posts  enable row level security;
alter table public.scraped_comments enable row level security;
alter table public.ideas          enable row level security;
alter table public.drafts         enable row level security;
alter table public.queue          enable row level security;
alter table public.reply_queue    enable row level security;

create policy "own communities"
  on public.communities for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Helper predicate reused by every child table.
create or replace function public.owns_community(cid uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.communities c
    where c.id = cid and c.user_id = auth.uid()
  );
$$;

create policy "own pillars"        on public.pillars        for all using (public.owns_community(community_id)) with check (public.owns_community(community_id));
create policy "own voice profile"  on public.voice_profiles for all using (public.owns_community(community_id)) with check (public.owns_community(community_id));
create policy "own scraped posts"  on public.scraped_posts  for all using (public.owns_community(community_id)) with check (public.owns_community(community_id));
create policy "own scraped comments" on public.scraped_comments for all using (public.owns_community(community_id)) with check (public.owns_community(community_id));
create policy "own ideas"          on public.ideas          for all using (public.owns_community(community_id)) with check (public.owns_community(community_id));
create policy "own drafts"         on public.drafts         for all using (public.owns_community(community_id)) with check (public.owns_community(community_id));
create policy "own queue"          on public.queue          for all using (public.owns_community(community_id)) with check (public.owns_community(community_id));
create policy "own reply queue"    on public.reply_queue    for all using (public.owns_community(community_id)) with check (public.owns_community(community_id));

-- ============================================================================
-- Seed data — default pillar library + empty voice profile per new community
-- Keep this list in sync with extension/shared/default-pillars.js
-- ============================================================================
create or replace function public.seed_community_defaults()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.pillars (community_id, slug, name, description, target_ratio, position) values
    (new.id, 'teaching',  'Teaching / How-To',          'Actionable lessons, walkthroughs, frameworks members can apply.', 25, 0),
    (new.id, 'story',     'Personal Story',             'First-person experiences, lessons learned, vulnerable moments.',  15, 1),
    (new.id, 'question',  'Engagement Question',        'Open questions, polls, this-or-that prompts that drive replies.', 20, 2),
    (new.id, 'resource',  'Tool or Resource Highlight', 'A tool, template, book, or link worth sharing, with context.',    15, 3),
    (new.id, 'win',       'Win / Social Proof',         'Member wins, milestones, testimonials, before-and-after results.',15, 4),
    (new.id, 'bts',       'Behind-the-Scenes',          'What you are building or figuring out; process over polish.',     10, 5);

  insert into public.voice_profiles (community_id) values (new.id);
  return new;
end;
$$;

drop trigger if exists communities_seed_defaults on public.communities;
create trigger communities_seed_defaults
  after insert on public.communities
  for each row execute function public.seed_community_defaults();

-- Keep drafts.updated_at fresh.
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists drafts_touch on public.drafts;
create trigger drafts_touch
  before update on public.drafts
  for each row execute function public.touch_updated_at();
