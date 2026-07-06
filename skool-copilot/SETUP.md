# Setup — the short version

Two paths. Start with the demo (zero setup) to see everything working, then do
the real setup when you're ready.

---

## Path A — see it working right now

1. Open the hosted web app: **https://jessejniall-bot.github.io/Claude1/pwa/**
2. Click **🎪 Try the demo**.

*(Prefer to run it on your own machine? `cd skool-copilot && python3 -m
http.server 8080`, then open http://localhost:8080/pwa/.)*

That's the whole app on sample data — health score, charts, improvement
suggestions, drafts, queue. Add an AI key in Settings and the generate /
deep-review buttons make real calls even in demo mode.

---

## Path B — connect your real community (~5 minutes)

### 1. Backend (once, ~2 min)

1. Create a free project at [supabase.com/dashboard](https://supabase.com/dashboard).
2. **Turn off email confirmation** (do this first — it saves a lot of pain).
   Supabase's free email sender only allows a few confirmation emails per hour,
   and an unconfirmed account can't sign in. In Supabase go to
   **Authentication → Sign In / Providers → Email** and switch **off**
   "Confirm email", then **Save**. Now sign-up is instant, no email needed.
   *(Already created an account that's stuck? Authentication → Users → click it
   → Confirm — or just delete it and sign up again after flipping the toggle.)*
3. In the web app's setup screen, click **📋 Copy schema SQL**, then in
   Supabase open **SQL Editor**, paste, **Run**.
4. In Supabase, open **Settings → API** and copy the **Project URL** and the
   **anon public key** into the web app's setup screen. The app verifies them
   and tells you exactly what's wrong if something doesn't match (bad URL,
   wrong key, schema not installed).
5. Create your account, add your community (name + Skool URL + the ownership
   checkbox), paste an AI key in Settings. Done with the web side.

**Don't want accounts at all?** Use **solo mode** — it removes the sign-in
screen from both the app and the extension (meant for a personal,
single-user setup). On the sign-in screen: click **📋 Copy solo-mode SQL**,
run it once in Supabase → SQL Editor, then click **🔓 Enable solo mode**.
After that there is no sign-in anywhere; the extension picks the setting up
automatically the next time you open the web app. ⚠️ Trade-off: anyone with
your project URL + anon key could then read/write your data, so don't share
those two values. (This also sidesteps every email-confirmation headache.)
To go back to accounts later, the revert SQL is at the bottom of
`supabase/solo-mode.sql`.

### 2. Extension (once, ~2 min)

1. Get the code: on the repo's front page
   ([github.com/jessejniall-bot/Claude1](https://github.com/jessejniall-bot/Claude1))
   click the green **Code** button → **Download ZIP**, then unzip it (Mac:
   double-click; Windows: right-click → Extract All).
2. Open `chrome://extensions`, turn on **Developer mode** (top right), click
   **Load unpacked**, and select the **`skool-copilot/extension`** folder
   *inside* the unzipped folder — that exact folder, not the repo root.
   *(After downloading a newer copy, click the ↻ reload icon on the extension
   card so Chrome picks up the changes.)*
3. **Open the web app once** (the URL from Path A) — with the extension
   installed, your backend + AI settings sync into the extension
   automatically. The web app shows "🧩 Extension detected" when this works.
4. Click the extension's toolbar icon → the side panel opens → sign in with
   the same email/password. (Sign-in is the only thing that doesn't sync,
   on purpose — shared sessions get each other logged out.)

### 3. Use it

Browse your Skool community. The pill in the bottom-left shows the live
state:

| Pill says | Meaning |
|---|---|
| 🟢 Copilot active — admin access confirmed · 12p / 34c synced | Working; posts/comments are syncing |
| 🔴 No admin access detected | You're on the allowlisted community but the page shows no admin markers — hover the pill to see which checks ran |
| ⚪ Not in your allowlist | This community wasn't added to your account |

Health dashboard + drafting live in the side panel and the web app. The side
panel's **📖 Read & suggest** button reads the posts currently on your screen
and suggests how to engage with each (like / quick comment / drafted reply to
copy) — it never clicks or posts for you.

---

## If something doesn't work

- **Side panel is blank or complains** — it now always says *why* (backend
  not configured / sign-in needed / exact error). Follow what it says.
- **"Test backend" fails** — the message tells you which of the three inputs
  is wrong: unreachable URL, rejected anon key, or schema not installed.
- **Posts/comments never sync, even with the override on** — Skool's page
  structure has likely changed in a way the extraction code doesn't
  recognize at all (not just the admin check). In the side panel, scroll to
  **Troubleshooting → 🔬 Capture page report**, click it, then **📋 Copy
  report** and send the output to Claude — it reports page structure (element
  counts, class names, data shapes), not member content, except capped raw
  samples under "flight data" which may include real post text, so skim
  before sharing. This is the fastest path to getting extraction fixed for
  real.
- **Comments never sync, even though posts do** — this is expected for now.
  Skool's community feed page only sends a *comment count* per post, not the
  actual comment text — that only loads once you open an individual post.
  Comment syncing needs its own extraction pass from the post-detail page,
  which isn't wired up yet.
- **"No admin access detected" on a community you DO admin** — Skool's
  markup changed and automatic detection missed it. Open the side panel,
  select the community, and tick **"Force-enable scraping here"**, then
  reload the Skool tab — the pill turns green ("manual admin override").
  The allowlist + ownership pledge still apply. To help fix detection
  properly, run `SC_COPILOT_DIAGNOSE()` in the Skool page's console
  (F12 → Console) and share the output — it reports page structure
  (role fields and admin-ish links), not post contents.
- **Pill stuck at 0 synced on a community you admin** — hover the pill: it
  shows which admin signal matched and the sync counters. Run
  `window.SC_COPILOT_DEBUG = true` in the page console for per-pass logs.
  Skool changes its markup occasionally; the selectors live at the top of
  `extension/content/scraper.js`.
- **Settings didn't sync to the extension** — make sure you opened the web
  app *after* installing the extension, and that the page shows
  "🧩 Extension detected". Reload the web app tab once.
