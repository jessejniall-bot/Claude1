/* =====================================================================
   Skool Community Copilot — bundled solo-mode SQL
   ---------------------------------------------------------------------
   The side panel needs to offer "skip sign-in" without leaving the
   extension, but a Chrome extension can only read files inside its own
   package — it can't fetch ../supabase/solo-mode.sql the way the PWA
   does (the PWA is served as one whole site; the extension ships only
   the extension/ folder). So this is a copy of that file's SQL, kept in
   sync by hand. Source of truth: supabase/solo-mode.sql.
   ===================================================================== */
(function (SC) {
  "use strict";

  SC.SOLO_MODE_SQL =
"-- ============================================================================\n" +
"-- Solo mode — single-user install with NO accounts and NO sign-in.\n" +
"-- ----------------------------------------------------------------------------\n" +
"-- Run this once in your Supabase project's SQL editor. It:\n" +
"--   1. makes communities.user_id optional (there is no signed-in user), and\n" +
"--   2. adds an open policy on every Copilot table so the anon key alone can\n" +
"--      read and write.\n" +
"--\n" +
"-- ⚠️ Only do this for a personal, single-user project: afterwards, ANYONE who\n" +
"-- has your project URL + anon key can read/write this data. Don't publish\n" +
"-- those two values anywhere.\n" +
"--\n" +
"-- To turn solo mode back off later, run the block at the bottom.\n" +
"-- ============================================================================\n" +
"\n" +
"alter table public.communities alter column user_id drop not null;\n" +
"\n" +
"do $$\n" +
"declare t text;\n" +
"begin\n" +
"  foreach t in array array[\n" +
"    'communities', 'pillars', 'voice_profiles', 'scraped_posts',\n" +
"    'scraped_comments', 'ideas', 'drafts', 'queue', 'reply_queue'\n" +
"  ]\n" +
"  loop\n" +
"    execute format('drop policy if exists \"solo mode\" on public.%I', t);\n" +
"    execute format(\n" +
"      'create policy \"solo mode\" on public.%I for all to anon, authenticated using (true) with check (true)',\n" +
"      t\n" +
"    );\n" +
"  end loop;\n" +
"end $$;\n" +
"\n" +
"-- ============================================================================\n" +
"-- To REVERT to account-based access, run this instead:\n" +
"--\n" +
"-- do $$\n" +
"-- declare t text;\n" +
"-- begin\n" +
"--   foreach t in array array[\n" +
"--     'communities', 'pillars', 'voice_profiles', 'scraped_posts',\n" +
"--     'scraped_comments', 'ideas', 'drafts', 'queue', 'reply_queue'\n" +
"--   ]\n" +
"--   loop\n" +
"--     execute format('drop policy if exists \"solo mode\" on public.%I', t);\n" +
"--   end loop;\n" +
"-- end $$;\n" +
"-- ============================================================================\n";
})(typeof globalThis !== "undefined" ? (globalThis.SC = globalThis.SC || {}) : {});
