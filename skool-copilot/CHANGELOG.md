# Changelog

All notable changes to Skool Community Copilot, and — importantly — the
judgment calls made where the spec left something open. This file exists so a
future reader (human or AI) can see *why* a decision was made without having to
reverse-engineer it from the diff.

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
