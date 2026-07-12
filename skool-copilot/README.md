# Skool Community Copilot

> **Fast start:** follow **[SETUP.md](SETUP.md)**. A GitHub Actions workflow
> deploys the web app to **https://jessejniall-bot.github.io/Claude1/pwa/** —
> it needs one one-time unlock (make the repo public, or enable Pages on a
> paid plan; see SETUP.md), or run it locally with one command. With the
> extension installed, opening the web app syncs your settings into the
> extension automatically.

A Chrome extension + companion PWA that works with **any** Skool community you
own or admin. It reads your community's post feed (DOM/embedded-data based —
Skool has no public API), measures content health, and drafts on-pillar,
on-voice posts using an AI provider and API key **you** supply.

**The loop it closes:** scan the community → flag what's missing → draft the
post that fills the gap.

## Architecture

| Piece | What it does |
|---|---|
| `extension/` | Manifest V3 Chrome extension: content script scrapes the currently-viewed community (gated by ownership verification) and threads comments, the background worker syncs to Supabase, and the side panel shows the health score, pillar tracker, needs-response inbox, page pulse, and the on-pillar post generator. |
| `pwa/` | Mobile-friendly dashboard on the same account: health score + charts, pillar tracker, needs-response inbox with threaded conversations + summaries, pillar templates & AI suggestions, idea inbox, draft editor, queue, settings. |
| `supabase/schema.sql` | Postgres schema + row-level security + default-pillar seed trigger. Multi-tenant from day one; every row is scoped to your `auth.users` id. Upgrades in `supabase/upgrade-00*.sql`. |
| `extension/shared/` | Zero-dependency modules shared by both surfaces: Supabase REST client, encrypted BYOK key vault, multi-provider AI adapter, health engine (coverage, streaks, silent posts, new voices, threading, needs-response), pillar classifier, and pillar templates. |

AI calls go **directly from your browser to the provider** using your own key.
Keys are AES-GCM-encrypted with a locally generated device key and stored only
in browser storage — they are never sent to the backend.

## Try it in 30 seconds (no accounts, no keys)

Serve the folder and open the PWA, then click **🎪 Try the demo**:

```bash
cd skool-copilot
python3 -m http.server 8080
# open http://localhost:8080/pwa/ → "Try the demo"
```

Demo mode runs the entire app on realistic sample data stored in your
browser — health score, charts, improvement suggestions, idea inbox, drafts,
queue. Generate and AI-review return sample output until you add a real AI
key in Settings (with a key, they make real calls even in demo mode). Sign
out to leave the demo.

## Setup

1. **Backend** — create a free [Supabase](https://supabase.com) project, open
   its SQL editor, and run `supabase/schema.sql` once. Grab the project URL and
   anon key from *Settings → API*. (Upgrading an existing project rather than
   starting fresh? Run the upgrade scripts once, in order:
   `supabase/upgrade-001-comments.sql` then `supabase/upgrade-002-threads.sql`.
   Solo-mode users: re-run `supabase/solo-mode.sql` afterwards so the new
   `reply_queue` table gets its open policy too.)
2. **PWA** — serve this folder statically and open `pwa/`:
   ```bash
   cd skool-copilot
   python3 -m http.server 8080
   # open http://localhost:8080/pwa/
   ```
   (The PWA loads the shared modules from `../extension/shared/`, so serve from
   the `skool-copilot` root.) Paste your Supabase URL + anon key, create an
   account, add your community, set your voice profile, and add an AI key in
   Settings.
3. **Extension** — open `chrome://extensions`, enable Developer mode, *Load
   unpacked*, and pick the `extension/` folder. In the extension's options
   page, paste the same Supabase URL + anon key, then sign in from the side
   panel with the same account.
4. Browse your Skool community. When the status pill shows
   **“Copilot active — admin access confirmed”**, the feed syncs automatically
   and the 💡 button captures ideas.

## Ownership verification (required, both checks)

Scraping only runs when **both** pass, on every pageview:

1. **Allowlist by URL** — the community was added by you during setup; the
   content script only activates for slugs in your list.
2. **Live admin signal** — the page must show markers Skool only renders for
   owners/admins (membership role in the page data, settings/admin links). If
   absent, scraping stays disabled even for allowlisted URLs.

The status pill always shows the current state — active, "no admin access
detected", or "not in your allowlist". This is not tamper-proof against
deliberate spoofing, but prevents accidental or casual use against communities
you don't run. Skool can change its DOM/data at any time; the selectors and
data paths live at the top of `extension/content/scraper.js`.

### Debugging the scraper on your community

The status pill shows live sync counts ("… · 12p / 34c synced") and its hover
tooltip reports the slug, allowlist state, which admin signal matched, and
totals for this visit. For verbose extraction logs, run
`window.SC_COPILOT_DEBUG = true` in the page console — every scrape pass then
logs how many posts/comments it found and whether it used `__NEXT_DATA__` or
the DOM fallback. If counts stay at zero on a community you admin, the
heuristics in `extension/content/scraper.js` need updating for Skool's
current markup — the pill tooltip tells you which half (admin signal vs
extraction) is failing.

## Multi-provider AI (BYOK)

One internal `SC.generateDraft()` routes to the provider you pick in Settings:

| Provider | Endpoint | Default model |
|---|---|---|
| Anthropic | `POST /v1/messages` (direct-browser-access header) | `claude-opus-4-8` |
| OpenAI | `POST /v1/chat/completions` | `gpt-4o` |
| Google Gemini | `POST /v1beta/models/{model}:generateContent` | `gemini-2.5-flash` |
| xAI Grok | OpenAI-compatible `/v1/chat/completions` | `grok-4` |

Settings has a **Test connection** button that makes a tiny real call before
saving.

## Community Health Engine (pure calculation, zero AI cost)

- **Overall health score (0–100)** — a weighted verdict (Thriving / Healthy /
  Needs attention / At risk) built from five components: posting cadence,
  engagement trend, pillar balance, responsiveness, and participation
- **Engagement rate over time** — weekly avg likes+comments per post + trend
- **Posting cadence** — average days between posts, days since last post
- **Pillar balance** — actual % per pillar over trailing 30 days vs target
- **Participation** — comments per post, unique commenters, and whether the
  conversation is carried by the same few people (the extension scrapes
  comments as well as posts)
- **Dormant member flagging** — previously active posters gone quiet
- **Pillar coverage** — per-pillar recency + share vs target with
  on-track/due/drought status ("days since last fed" catches droughts that
  percentage balance hides)
- **Silent posts / new voices / streak / best day** — % of posts with zero
  comments, first-time commenters per month, consecutive posting weeks, and
  the weekday your posts earn the most engagement
- **Response latency** — question → first reply time, plus unanswered questions
- **Where to improve** — concrete, numbers-grounded suggestions computed from
  all of the above

All of it lives in `extension/shared/health-engine.js` as pure functions over
scraped rows, so the PWA, side panel, and tests share one implementation.

### AI deep review

The dashboard's **AI deep review** button sends the stats digest plus a sample
of real scraped comments and post titles to your chosen provider and returns a
verdict (is this community healthy, and why), what's working, and 3–5 concrete
improvements tied to specific stats or quoted comments. Like drafting, this is
one BYOK call from your browser — nothing goes through a middleman.

## Pillar tracking (the core)

- **Pillar tracker** (dashboard + side panel): per pillar, its share of recent
  posts vs target AND how many days since it was last fed, with a plain
  status — ✅ on track / ⏳ due / 🔴 drought / ⚪ never posted. Days-since
  catches what percentage math hides: a pillar can be "at target" while
  silent for three weeks.
- **Fully customizable**: add, rename, retarget, and delete pillars in
  Settings; the 6 generic defaults are just the starting point.
- **Templates by community type**: curated pillar sets for
  Coaching/Course, Fitness/Wellness, Business, Creative/Hobby, Tech/SaaS,
  and Faith/Lifestyle communities (Settings → "Start from a template").
  Every set's targets sum to 100; loading fills the editor, nothing is saved
  until you click Save.
- **AI suggestions**: "✨ Suggest for my community" reads your community's
  name, your one-line description, and recent post titles, and proposes a
  tailored 4–6 pillar set (one BYOK call).

## Engagement tracking

- **Needs-response inbox** (both surfaces): every member comment/question
  past your response window with nothing back from you — with one-click
  open-on-Skool. Answering these is the cheapest engagement win available.
- **Threaded conversations** with one-click AI **thread summaries** to catch
  up on long chains without reading top to bottom.
- **New variables on the dashboard**: silent posts (% with zero comments),
  new voices (first-time commenters this month), posting streak, and your
  best day to post (by engagement).
- **Page pulse** (side panel, no account needed): reads the posts on your
  current Skool tab and shows the pillar mix of what's visible, plus the
  open post's comment feed to copy.

Deliberately **not** included: reply drafting/automation. This tool measures
and advises; what you say to members stays yours.

## Post generator

Drafts are grounded in the scraped stats: every generation prompt includes the
health digest (score, trend, overdue pillar, unanswered questions) plus your
voice profile and recent post titles. Options:

- **Pillar** — Auto (fills the most overdue pillar) or pick any pillar
  directly — e.g. straight from a drought flagged by the tracker

- **Length** — short (≤500 chars, default) or medium (≤900); Skool posts that
  get read are short
- **Emojis** — "if helpful" (a few, never decorative) or none
- **Unicode styling** — Skool has no rich text, so the generator can render
  the title in Unicode bold (𝗹𝗶𝗸𝗲 𝘁𝗵𝗶𝘀), and a 𝗕 button bolds any selected
  text in the draft editors (`extension/shared/unicode-style.js`)

## Default pillar library (seeded per community, fully editable)

Teaching / How-To (25%) · Personal Story (15%) · Engagement Question (20%) ·
Tool or Resource Highlight (15%) · Win / Social Proof (15%) ·
Behind-the-Scenes (10%)

## Testing

- `node test/smoke.test.js` — zero-dependency checks of everything pure:
  pillar classifier, health engine (cadence, trend, balance, coverage,
  streaks, silent posts, new voices, best day, latency, comment stats,
  score, improvements, digest), needs-response, threading, pillar templates,
  pillar-suggestion prompt + parser, draft prompts, Unicode styling.
- `node test/sidepanel.smoke.js` — boots the **real side panel** in headless
  Chromium (chrome.* + Supabase shimmed, solo-mode path) and fails on any page
  error; guards the side-panel wiring that the PWA e2e doesn't cover. Same
  Playwright/`PW_CHROMIUM` setup as e2e.
- `node test/e2e.js` — drives the **real PWA** headlessly through
  configure → sign in → add community → dashboard → AI deep review →
  generate draft → **inbox (suggest reply) → thread expand + summarize**, with
  Supabase and the AI provider mocked at the network layer (no accounts or keys
  touched). Needs `npm i playwright`; set
  `PW_CHROMIUM=/path/to/chromium` to reuse an existing browser binary. It
  serves the repo itself on port 8123 and writes screenshots next to the
  script.

## Out of scope

- Posting anything to Skool, including replies (measure and advise only —
  the post queue stays copy-paste)
- Billing/payments (BYOK means no usage metering)
- Platforms other than Skool

## Worth flagging before distributing beyond personal use

Scraping a platform's pages through a browser extension sits in a legal gray
zone depending on that platform's Terms of Service. Read Skool's ToS on
automated data collection and extensions before giving this to other people —
especially anyone who might run it against communities they don't own.
