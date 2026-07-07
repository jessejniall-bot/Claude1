# Changelog

All notable changes to Skool Community Copilot, and — importantly — the
judgment calls made where the spec left something open. This file exists so a
future reader (human or AI) can see *why* a decision was made without having to
reverse-engineer it from the diff.

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
