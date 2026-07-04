# Skool Community Copilot

> **Fast start:** hosted web app at
> **https://jessejniall-bot.github.io/Claude1/pwa/** (auto-deployed from this
> repo) — click "Try the demo" for zero-setup, or follow **[SETUP.md](SETUP.md)**
> for the ~5-minute real setup. With the extension installed, opening the web
> app syncs your settings into the extension automatically.

A Chrome extension + companion PWA that works with **any** Skool community you
own or admin. It reads your community's post feed (DOM/embedded-data based —
Skool has no public API), measures content health, and drafts on-pillar,
on-voice posts using an AI provider and API key **you** supply.

**The loop it closes:** scan the community → flag what's missing → draft the
post that fills the gap.

## Architecture

| Piece | What it does |
|---|---|
| `extension/` | Manifest V3 Chrome extension: content script scrapes the currently-viewed community feed (gated by ownership verification), background worker syncs to Supabase, side panel shows health + generates drafts without leaving Skool. |
| `pwa/` | Mobile-friendly dashboard on the same account: health charts, idea inbox, draft editor, queue, settings. |
| `supabase/schema.sql` | Postgres schema + row-level security + default-pillar seed trigger. Multi-tenant from day one; every row is scoped to your `auth.users` id. |
| `extension/shared/` | Zero-dependency modules shared by both surfaces: Supabase REST client, encrypted BYOK key vault, multi-provider AI adapter, health engine, pillar classifier. |

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
   anon key from *Settings → API*. (If you set up a project before comment
   scraping was added, run `supabase/upgrade-001-comments.sql` once instead of
   re-running the full schema.)
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

## Post generator

Drafts are grounded in the scraped stats: every generation prompt includes the
health digest (score, trend, overdue pillar, unanswered questions) plus your
voice profile and recent post titles. Options:

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
  pillar classifier, health engine (cadence, trend, balance, latency, comment
  stats, score, improvements, digest), prompt builders, Unicode styling.
- `node test/e2e.js` — drives the **real PWA** headlessly through
  configure → sign in → add community → dashboard → AI deep review →
  generate draft, with Supabase and the AI provider mocked at the network
  layer (no accounts or keys touched). Needs `npm i playwright`; set
  `PW_CHROMIUM=/path/to/chromium` to reuse an existing browser binary. It
  serves the repo itself on port 8123 and writes screenshots next to the
  script.

## Out of scope for v1

- Auto-posting to Skool (no public API — the queue is copy-paste)
- Billing/payments (BYOK means no usage metering)
- Platforms other than Skool

## Worth flagging before distributing beyond personal use

Scraping a platform's pages through a browser extension sits in a legal gray
zone depending on that platform's Terms of Service. Read Skool's ToS on
automated data collection and extensions before giving this to other people —
especially anyone who might run it against communities they don't own.
