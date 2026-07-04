# Setup — the short version

Two paths. Start with the demo (zero setup) to see everything working, then do
the real setup when you're ready.

---

## Path A — see it working right now (0 minutes)

1. Open the hosted web app:
   **https://jessejniall-bot.github.io/Claude1/pwa/**
   (auto-deployed from this repo by GitHub Actions)
2. Click **🎪 Try the demo**.

That's the whole app on sample data — health score, charts, improvement
suggestions, drafts, queue. Add an AI key in Settings and the generate /
deep-review buttons make real calls even in demo mode.

---

## Path B — connect your real community (~5 minutes)

### 1. Backend (once, ~2 min)

1. Create a free project at [supabase.com/dashboard](https://supabase.com/dashboard).
2. In the web app's setup screen, click **📋 Copy schema SQL**, then in
   Supabase open **SQL Editor**, paste, **Run**.
3. In Supabase, open **Settings → API** and copy the **Project URL** and the
   **anon public key** into the web app's setup screen. The app verifies them
   and tells you exactly what's wrong if something doesn't match (bad URL,
   wrong key, schema not installed).
4. Create your account, add your community (name + Skool URL + the ownership
   checkbox), paste an AI key in Settings. Done with the web side.

### 2. Extension (once, ~2 min)

1. Get the code: `git clone` this repo (or GitHub → Code → Download ZIP and
   unzip).
2. Open `chrome://extensions`, turn on **Developer mode** (top right), click
   **Load unpacked**, and select the **`skool-copilot/extension`** folder —
   that exact folder, not the repo root.
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

Health dashboard + drafting live in the side panel and the web app.

---

## If something doesn't work

- **Side panel is blank or complains** — it now always says *why* (backend
  not configured / sign-in needed / exact error). Follow what it says.
- **"Test backend" fails** — the message tells you which of the three inputs
  is wrong: unreachable URL, rejected anon key, or schema not installed.
- **Pill stuck at 0 synced on a community you admin** — hover the pill: it
  shows which admin signal matched and the sync counters. Run
  `window.SC_COPILOT_DEBUG = true` in the page console for per-pass logs.
  Skool changes its markup occasionally; the selectors live at the top of
  `extension/content/scraper.js`.
- **Settings didn't sync to the extension** — make sure you opened the web
  app *after* installing the extension, and that the page shows
  "🧩 Extension detected". Reload the web app tab once.
