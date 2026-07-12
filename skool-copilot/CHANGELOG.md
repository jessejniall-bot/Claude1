# Changelog

All notable changes to Skool Community Copilot, and — importantly — the
judgment calls made where the spec left something open. This file exists so a
future reader (human or AI) can see *why* a decision was made without having to
reverse-engineer it from the diff.

## v3.0 — The health pivot: tracker-first, reply suggestions removed

Direction change, requested explicitly: the product is no longer a reply
assistant — it's a **community health tracker** centered on engagement and
content pillars. "I'm no longer interested in it offering post reply
suggestions. I'm more interested in it monitoring the health of the community
and focusing more on engagement and hitting the pillars, also being able to
customize pillars. Maybe even suggest certain pillars for certain types of
communities."

### Removed — all reply-suggestion machinery

- Side panel: the reply drafter ("Draft 3 replies", per-comment "Suggest
  answers") and the inbox's suggest/post-to-Skool actions.
- PWA: inbox reply drafting, the reply queue, per-comment reply buttons in
  threads.
- Under the hood: `net-observer.js` (the MAIN-world request learner),
  `reply-template.js` (learn/replay templating), `voice-local.js` (the
  reply-voice few-shot store) and its Options section, the reply prompts in
  `ai-providers.js`, the reply-queue handlers in the background worker, and
  the MAIN-world content-script block in the manifest. The `reply_queue`
  table stays in the schema (harmless, unused) so no migration is needed.
- Kept deliberately: the **post generator** (it fills pillars — core to the
  new focus), **thread summarization** (catching up on engagement is health
  work, not reply drafting), and the **needs-response inbox** as a
  list-with-open/copy (it *measures* engagement debt; it just no longer
  writes replies for you).

### Added — pillar-first health tracking

- **Pillar tracker** (dashboard + side panel): per pillar, share of recent
  posts vs target AND days since it was last fed, with a plain status —
  ✅ on track / ⏳ due / 🔴 drought / ⚪ never posted. Catches the failure mode
  percentage-balance math hides: a pillar can be "at target" while silent
  for three weeks.
- **New health variables** in the engine, all surfaced as dashboard tiles
  and/or improvement suggestions: **silent posts** (% of recent posts with
  zero comments), **new voices** (first-time commenters in the window —
  freshness vs the same circle carrying every thread), **posting streak**
  (consecutive weeks with a post), **best day to post** (weekday whose posts
  earn the most engagement), plus **pillar droughts** and never-fed pillars
  in the improvements list.
- **Pillar templates by community type** (`shared/pillar-templates.js`):
  curated starter sets for Coaching/Course, Fitness/Wellness,
  Business/Entrepreneurship, Creative/Hobby, Tech/SaaS, and
  Faith/Lifestyle/Support — every set's targets sum to 100, applied via
  Settings → "Start from a template," fully editable after loading, and
  nothing saves until "Save pillars."
- **AI pillar suggestions** ("✨ Suggest for my community"): one BYOK call
  reading the community name, your one-line description, and recent post
  titles; returns a tailored 4–6 pillar set (tolerant, truncation-aware JSON
  parsing; targets auto-rescaled to 100). Canned suggestion in demo mode.
- **Generator pillar picker**: draft for a specific pillar on demand, not
  just the auto-picked most-overdue one.
- **Page pulse** (side panel, replaces the reply drafter): reads the current
  Skool tab and grades it — pillar mix of the visible posts (with an
  unclassified count), per-post pillar chips, and the open post's comment
  feed with copy (feature kept from v2.2, now analysis-only).

### Decisions

- Template/suggestion loads reuse existing pillar ids when slugs match, so
  saving updates-in-place instead of hitting unique-slug collisions, and
  pillars removed from the editor are deleted on save — clean replace
  semantics with one explicit Save.
- The 5-part health score composition is unchanged (stability over churn);
  the new variables feed tiles and improvement suggestions instead of
  silently reshuffling everyone's score.

## v2.5 — Quality pass: truncated replies, cut-off text, comment reading

Driven by a full expert audit after user reports of "punctuation cut off" in
replies and the comment feed appearing unreadable. Every root cause below was
reproduced in a test before fixing, and every fix is verified by the same test
now passing.

### Reply truncation ("punctuation cut off and such") — three causes fixed

1. **Token-capped model output served as fragments.** With `maxTokens: 900`
   for three drafts, the model's JSON answer could be cut mid-string; the old
   parser then sliced between brackets and fell back to line-splitting,
   serving drafts like `"Love this — what worked best for you when yo` —
   stray quotes, trailing commas, cut mid-word. `parseReplyDrafts` is now
   truncation-aware: it scans for *complete* JSON string literals (with
   escape handling); the cut-off fragment never gets a closing quote, so it
   is naturally excluded instead of served. The list fallback also strips
   stray wrapping quotes/commas. Caps raised across the board (standalone
   drafts 900→2000, comment replies 600→1200, thread summaries 500→800).
2. **Gemini 2.5 Flash "thinking" starvation.** Flash silently spends the
   same output budget on internal thinking before writing, truncating
   answers at small caps. `thinkingConfig: { thinkingBudget: 0 }` is now set
   for 2.5-flash models (Pro doesn't allow disabling, so it's flash-only).
3. **The DOM reader dropped the post's last line.** `saveIdx - 1` assumed a
   like-count line always sat between body and "Save"; when absent, the
   post's final line vanished — the AI replied to a post whose ending it
   never saw. Body extraction now *filters* chrome lines (counts, controls,
   timestamps, author name) instead of doing position math, and preserves
   paragraph breaks.

### Comment feed reading — two reproduced failures fixed

- **Multi-paragraph comments lost everything after the first line** (the old
  reader took exactly one line after the "•" timestamp). Now: all lines
  after the anchor to the action row, minus chrome — whole comments.
- **CSS-drawn bullets made every body null** (`::before` content isn't in
  `innerText`, so the "•" scan never matched). Now three anchor strategies:
  bullet line, relative-time pattern ("4h", "2 days ago"), then the author
  name line. Also: inline action rows ("Reply Like 3" as one line) are
  recognized as a token-wise control row, and bodiless blocks no longer
  dedupe-collapse per author.
- **The "Tune-up" card (page report) is restored** — removed in v2.3 by
  request, but it's the only tool that can calibrate extraction against
  Skool's live markup, which the user's comment-feed issue needs. It now
  additionally captures a `commentSample`: the innerText lines + tag
  structure of the first two comment blocks (real comment text included —
  the card warns to skim before sharing).

### Small but visible

- Post snippets no longer append "…" unconditionally — only when actually
  truncated. (Every snippet previously *looked* cut off.)
- Duplicate post rows reconciled: the same post could be stored under both
  its Skool hex id (page-data reader) and its slug (DOM reader), inflating
  cadence/pillar stats. The background now prefers the hex row, skips
  incoming slug duplicates, and retires stale ones.

## v2.4 — Reverted Google sign-in; skip sign-in from the panel directly

Real-world follow-up to v2.3: the user hit exactly the wall that section's
honest caveat warned about — Google requires its own Google Cloud Console
project, OAuth consent screen, and client credentials before Supabase's
"enable Google" toggle even works, and then a Client-ID-field validation
error, and then Chrome's `identity` flow failing to load the authorize page at
all. That's three separate failure points before a single sign-in succeeded.
Explicit feedback: *"I don't want sign-in to be so damn complicated... this is
far too complex."* Asked directly (no accounts / email-only / keep debugging
Google) — chose no accounts.

**What shipped**

- **Removed Google sign-in entirely** — the button, its setup-help block, the
  `identity` permission, and `signInWithOAuth` / `oauthRedirectURL` /
  `fetchUser` from `supabase-lite.js`. Not disabled, removed: it added a
  Chrome permission prompt and real setup burden for a path that was never
  going to be simple, for a use case (one person, one community) that doesn't
  need multi-provider auth.
- **Solo mode is now enabled directly from the side panel** — previously it
  could only be turned on from the PWA, meaning "skip sign-in" itself required
  a detour through the thing it was meant to skip. Since a packaged Chrome
  extension can only read files inside its own directory (it can't `fetch()`
  `../supabase/solo-mode.sql` the way the PWA does), the SQL is now also
  bundled as a JS string in `shared/solo-sql.js`, kept byte-identical to
  `supabase/solo-mode.sql` (verified by a diff script before shipping — and
  that check caught a real pre-existing bug: the source file's "how to revert"
  comment was missing `reply_queue` from the table list, fixed in both places).
  The panel's sign-in card now leads with **"Skip sign-in — one time, then
  never again"**: copy the setup script, run it once in Supabase, click
  Enable. Same probe pattern the PWA already used (a test insert only
  succeeds once the SQL has run), so it's exactly as safe. Email/password
  sign-in is kept, but demoted to a collapsed "prefer an account?" option
  underneath — still there for anyone who wants real per-user accounts, no
  longer the assumed default.

**Decision:** don't quietly patch the OAuth flow and hope the next error is
the last one. The actual problem wasn't a bug — it's that Google sign-in is
inherently multi-step for any app, and this product's real audience (one
person running their own community) never needed multiple accounts. Solo mode
already existed and already solved this; the fix was making it reachable
without leaving the extension, not making OAuth more resilient.

## v2.3 — Google sign-in, clearer panel, comment-feed reading surfaced

- **Sign in with Google** (extension v0.6.0). New button in the side panel's
  sign-in card. Uses Chrome's `identity` web-auth flow against Supabase's OAuth
  (`/auth/v1/authorize?provider=google`), parses the returned session from the
  redirect fragment, and fetches the user record. Added the `identity`
  permission. The card shows the exact **redirect URL** to whitelist in Supabase
  (Authentication → URL Configuration), with a copy button, and a collapsible
  one-time-setup note. Email/password sign-in stays; both now give a clear
  "add your Supabase URL in Settings first" message instead of a vague error
  when no backend is configured. **Note:** Google authenticates you to *your
  Supabase backend*, not to Skool — the two are separate.
- **Removed the Troubleshooting / "Capture page report" section** entirely, as
  requested — the card, its side-panel wiring, and the now-dead
  `CAPTURE_PAGE_REPORT` content-script handler plus `collectPageReport` /
  `summarizeValue` / `normalizeClassName` helpers. (If Skool restyles and
  extraction needs recalibrating later, that tool can be restored.)
- **Clearer engage card.** Renamed to **Read & reply** with a two-step "how to
  use" (feed → lists posts; open a post → reads its comment feed), plus a
  comment-count selector (15 / 40 / 100). The comment-feed reading itself
  already shipped in v0.5.0; this makes it discoverable and controllable.

## v2.2 — Comment feed reader + audit cleanup

Two things: the extension can now read the actual comment feed on a post (not
just answer the post), and a pass to remove code that had been superseded.

### Comment feed (the missing piece)

Opening a post and hitting **📥 Read this page** now shows a **Comment feed**
box under the post: every comment currently rendered on the page, each with:

- **📋 Copy** the single comment, or **📋 Copy all** to grab the whole thread as
  plain text, and
- **💬 Suggest answers** — three reply options drafted in your voice that target
  *that specific comment* (the post + the rest of the thread go in as context).

This is powered by the class-free `SC.extract.extractComments()` reading the
rendered DOM — the reliable path, since Skool's `__NEXT_DATA__` snapshot usually
omits comment text even on a post's own page. The same DOM read now also feeds
the passive comment sync (when signed in) as a fallback, so backend threads /
the needs-response inbox fill in from post pages too. You still open the post
yourself; the copilot reads what's on screen.

`buildLocalReplyPrompt` gained a `replyTo` mode so a draft can answer one
comment instead of the post.

### Audit — removed as redundant / dead

- **"Read & suggest" card** (the older `detailed_reply/quick_comment/like_only`
  per-post JSON flow) — fully superseded by the standalone "Engage with this
  page" drafter, which does the same job without a backend and now also handles
  comments. Removed the card + its `ENGAGE_SYSTEM_PROMPT`,
  `buildEngagementPrompt`, `parseEngagementSuggestions`, and the
  `READ_PAGE_POSTS` message handler.
- **`READ_PAGE_THREAD`** and **`GET_REPLY_CAPABILITY`** message handlers — never
  called by any surface (leftovers from earlier iterations).
- **`DRAIN_REPLIES`** background handler — dead; the queue drainer lives in the
  content script and talks to `LIST_PENDING_REPLIES`/`MARK_REPLY` directly.
- **`SC_COPILOT_DIAGNOSE()`** console helper — the in-panel "Capture page
  report" button replaced it; docs updated to point there.
- **Duplicate `sc_ai_settings` constant** in the PWA, merged.

Everything removed was confirmed to have no remaining caller first.

## v2.1 — Standalone reply drafter (works with no account)

The extension no longer needs the web app or a Supabase backend to be useful.
A new **Draft replies** card in the side panel reads the posts on your current
Skool tab and drafts replies in your voice — account optional.

**What shipped**

- **Class-free DOM scraper** (`content/extract.js`). Anchors on the permalink
  `<a href="/{group}/{slug}?p={id}">` and walks up to the post card, instead of
  matching Skool's hashed style-component class names. Two rules are kept on
  purpose and must not be "simplified" away: never select by class (hashed),
  and never key anything on `postId` across sessions (it rotates — the stable
  key is `slug`). This also replaces the old class-based DOM fallback in the
  passive scraper, and (unlike the `__NEXT_DATA__` snapshot) it sees posts
  loaded by infinite scroll.
- **Local voice profile** (`shared/voice-local.js`, Options page). Paste 5–10
  of your own real replies + an optional style note; stored in
  `chrome.storage.local` (`sc_local_voice`). Those few-shot samples are what
  make drafts sound like you — same idea as the backend voice profile, but no
  account required.
- **Standalone drafter** (side panel). "Read this page" lists the posts found
  (or, on a post's detail page, that post + its comments), and "Draft 3
  replies" produces three options per post via one BYOK call, parsed from JSON.
  Copy the one you like — suggestion-only, nothing is posted.
- The side panel no longer blocks on a backend: the drafter is always visible;
  the account-only cards (health, needs-response inbox, generator, etc.) appear
  only when a backend is configured and signed in, with a one-line
  "connect an account (optional)" note otherwise.

**Decisions**

- **Reused the existing BYOK + admin-gate machinery, added nothing backend.**
  The drafter is gated by the same live admin signal (or the per-community
  force-enable override, read straight from `chrome.storage`) as scraping, so
  it still only ever acts on communities you appear to own — but it needs no
  allowlist, because there's no backend to hold one.
- **Kept the extension unaware of the app, as requested.** Nothing in this
  feature calls Supabase; the API key comes from the local vault (Options),
  the voice from local storage, the content from the live tab.
- **`parsePermalink` is string-based, not `new URL(...)`**, so it never depends
  on the page origin (robust on skool.com and in tests alike).

## v2 — Threads, replies, and the needs-response inbox

This pass extends a working product; it does not rebuild it. Every v1 feature
(scrape → health dashboard → draft generation, plus demo/solo modes) is
unchanged and still passes its tests.

### Feature 1 — Full comment threads (not just the post)

**What shipped**

- Comments are now stored with their nesting: each comment carries the id of
  the post it belongs to *and* the id of its parent comment (null for
  top-level comments). The scraper walks the whole comment tree on a post's
  detail page, not just the count shown on the feed.
- Threaded display (replies indented under their parent) in both the PWA and
  the extension side panel.
- The response-latency metric is now clickable: it opens the **Needs response**
  inbox, which lists the actual member comments/questions sitting past your
  response window with nothing back from you yet — instead of just showing a
  number.

**Decisions**

1. **Reused `scraped_comments` instead of adding a second `comments` table.**
   The spec named a new `comments` table with columns
   `id, post_id, parent_comment_id, skool_comment_id, author, text, likes,
   posted_at`. v1 already had `scraped_comments` feeding the health engine.
   Creating a parallel table would have split the source of truth and forced a
   rewrite of the health/participation math for no behavioural gain. Instead I
   mapped the requested shape onto the existing table:
   `skool_comment_id → comment_key`, `post_id → post_key`,
   `parent_comment_id → parent_comment_key`, `text → comment_text`,
   `posted_at → commented_at`, and added the one genuinely new column,
   `parent_comment_key`. See `supabase/upgrade-002-threads.sql`.

2. **Linked comments to posts by text key, not a hard UUID foreign key.**
   The spec implied `post_id` as a FK. Scraped comments and posts arrive
   independently and in any order (you might open a post before its feed card
   was ever scraped), so a rigid FK would drop comments whose post row doesn't
   exist yet. `post_key`/`parent_comment_key` are Skool's own string ids and
   link loosely, which is what a scraper needs. Threading is assembled
   client-side in `SC.threads.build()`.

3. **Comment content only exists on the post-detail page.** Skool's community
   feed carries a comment *count*, not comment text (confirmed via the
   page-report tool last round). So thread scraping populates when the owner
   opens an individual post. The extraction handles Skool's nested
   `postTrees[].post` + child-comment tree; if Skool's exact comment field
   names differ from what's implemented, one page-report capture from a *post*
   page (not the feed) is enough to calibrate — the storage, threading,
   latency wiring, and UI are all already built and will fill in as soon as the
   shape matches.

### Feature 2 — Reply to a specific comment/reply

Skool still has no public write API, so — exactly as the spec describes — the
only way to post is to replay Skool's own internal request, authenticated as
the logged-in user inside the live Skool tab.

**The honest constraint, and the design that respects it**

This build environment cannot reach skool.com (network-restricted) and has no
logged-in Skool session, so I could not sit in front of the Network tab and
copy the current comment-create endpoint myself — and hardcoding an
undocumented endpoint that "shifts without notice" would rot the day Skool
ships a change. So instead of guessing:

- **Learn mode.** A `world: "MAIN"` content script (`content/net-observer.js`)
  watches the page's own `fetch`/XHR. The first time *you* manually post a
  comment or reply on Skool, it captures the real request shape — method, URL,
  content-type, and which JSON fields hold the comment text, the post id, and
  the parent-comment id — and stores that as a redacted **template**
  (`sc_reply_template_<host>`). The captured text and ids themselves are
  **not** stored; only the shape is. This means the extension learns Skool's
  real, current endpoint from your own click instead of a guess that goes
  stale.
- **Replay.** Submitting a queued reply fills the template (new text + the
  target post/parent id) and fires it via the *page's own* fetch, so the live
  session cookie rides along automatically. No Skool token is ever stored,
  transmitted, or refreshed by us — sidestepping the cookie-rotation problems
  server-side tools hit.
- **Composed from either surface.** A reply drafted in the PWA (which has no
  live Skool session) is queued in Supabase (`reply_queue`); the extension
  drains that queue the next time it sees the matching Skool tab open.
  Submission only ever happens from the extension, in the live tab.
- **Spacing.** The queue drainer submits at most one reply per randomized
  45–90s window, so a batch never fires as a burst that reads as automation.
- **Fallback that never fails silently.** If no template has been learned yet,
  or a replay errors or is rate-limited, the reply is copied to your clipboard
  and a deep link to that exact comment (or at least the post) is opened, so
  it's paste-and-send instead of a dead end.

**Decision: submission is always an explicit user action.** Earlier in the
project the owner asked that nothing be auto-clicked. This pass adds real
writing, but every submit is something you deliberately trigger (a "Submit to
Skool" click, or a reply you explicitly queued) — the drainer only ever sends
items you queued yourself. Nothing is generated-and-sent behind your back.

### Bundled improvements

- **Suggested replies** — one-tap AI draft for any incoming comment, using the
  existing voice profile + pillar context, one AI call per draft (no second
  cost path; reuses `SC.generateDraft`).
- **Needs-response inbox** — one screen: every comment/question past your
  response threshold with no owner reply yet.
- **Thread summarization** — collapse a long comment chain into a few lines
  (one AI call) instead of reading top to bottom.
- **Mobile input polish** — reply/draft fields use large touch targets and
  dictation-friendly attributes (`autocapitalize=sentences`,
  `autocorrect=off`, `spellcheck` left on) with clear focus states, so
  voice-to-text doesn't fight the field.
- **Error-handling pass** — empty threads, deleted comments, expired/again
  scrape, and failed submits all surface a message; nothing fails silently.

**Left untouched:** the voice-profile system. Everything new that generates
text pulls from the existing `voice_profiles` + pillar data; there is no second
voice implementation.
