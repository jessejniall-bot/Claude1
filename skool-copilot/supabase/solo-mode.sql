-- ============================================================================
-- Solo mode — single-user install with NO accounts and NO sign-in.
-- ----------------------------------------------------------------------------
-- Run this once in your Supabase project's SQL editor. It:
--   1. makes communities.user_id optional (there is no signed-in user), and
--   2. adds an open policy on every Copilot table so the anon key alone can
--      read and write.
--
-- ⚠️ Only do this for a personal, single-user project: afterwards, ANYONE who
-- has your project URL + anon key can read/write this data. Don't publish
-- those two values anywhere.
--
-- To turn solo mode back off later, run the block at the bottom.
-- ============================================================================

alter table public.communities alter column user_id drop not null;

do $$
declare t text;
begin
  foreach t in array array[
    'communities', 'pillars', 'voice_profiles', 'scraped_posts',
    'scraped_comments', 'ideas', 'drafts', 'queue'
  ]
  loop
    execute format('drop policy if exists "solo mode" on public.%I', t);
    execute format(
      'create policy "solo mode" on public.%I for all to anon, authenticated using (true) with check (true)',
      t
    );
  end loop;
end $$;

-- ============================================================================
-- To REVERT to account-based access, run this instead:
--
-- do $$
-- declare t text;
-- begin
--   foreach t in array array[
--     'communities', 'pillars', 'voice_profiles', 'scraped_posts',
--     'scraped_comments', 'ideas', 'drafts', 'queue'
--   ]
--   loop
--     execute format('drop policy if exists "solo mode" on public.%I', t);
--   end loop;
-- end $$;
-- ============================================================================
