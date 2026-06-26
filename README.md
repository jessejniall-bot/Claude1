# Skool Prompt Forge 🔥

A zero-dependency web app that generates **engagement-ready Skool posts about Google Gemini**.

Every post follows the same rules:

- ✅ **Punchy Title Case headings** — the first letter of every word is capitalised
- ✅ **A mix of emojis** (tunable: Light / Medium / Heavy)
- ✅ **Always under 500 characters** (title + body), with a live counter
- ✅ **Built for engagement** — every post ends with a reply-driving CTA or question

## What it makes

Posts are tailored to the **2026 Google Gemini** product line:

| Feature | What the posts cover |
|---|---|
| 🧩 Gems | Custom AI assistants (brand voice, outreach, onboarding) |
| 🔬 Deep Research | Autonomous cited research reports |
| 🎨 Canvas | Talk-to-build landing pages & one-pagers |
| 🍌 Nano Banana | Image generation & photo editing |
| 🎬 Veo | Text-to-video with sound |
| 🎙️ Gemini Live | Hands-free voice sessions & roleplay |
| 📥 Workspace | Gmail / Drive / Docs integration |
| ⚡ Core Prompting | Universal prompting techniques |

## Post types (rotate these across the week for best reach)

💡 Prompt Drop · 🌶️ Hot Take · 🗳️ Poll · 💬 Open Question · 🧭 Quick Tutorial · 🏆 Challenge · 🎉 Win Celebration

## How to use

Just open `index.html` in any browser — no build step, no server, no API key.

1. Pick a **Post Type**, a **Gemini Feature**, and an **Emoji Density**.
2. Hit **⚡ Generate Post** (or **📦 Generate 5** for a batch).
3. **📋 Copy** drops the title + body straight onto your clipboard, ready to paste into Skool.
4. **🔄 Reroll** swaps any single post for a fresh one.

## Files

- `index.html` — markup & controls
- `styles.css` — Skool-blue / Gemini-purple theme
- `content.js` — the curated, Gemini-specific content library
- `app.js` — generation engine (Title Case, emoji density, 500-char guarantee)

## Customising

Add your own material in `content.js`:

- Extend any feature's `nuggets` array with `{ topic, value, prompt }` to grow the **Prompt Drop** and **Quick Tutorial** pools.
- Add finished posts to `HOT_TAKES`, `POLLS`, `QUESTIONS`, `WINS`, or `CHALLENGES` (tag each with a `feature` key).
- Tweak `CTAS` to match your community's voice.

The `app.js` engine guarantees output stays under 500 characters and Title Cases every heading automatically.
