# Ember 🔥

**Your community's campfire — the fire only burns while you talk.**

Ember is a tiny, zero-build web app that gives your community a live gathering
spot outside Skool. Instead of another boring chat box, it's an animated
night-time campfire:

- **Every message feeds the fire.** Chat and it flares; go quiet and it dies
  down to embers. The room's energy is literally visible — from `Embers…` to
  `BONFIRE!`
- **Members sit around the fire** as glowing name chips (live presence).
- **Words rise with the smoke** — each message floats up from the flames.
- **Toss things in**: 🍡 toast a marshmallow, ✨ throw sparks, 🪵 throw a log on
  (big flare). Everyone sees it land.
- Starry sky, moon, treeline, fireflies, optional synthesized fire-crackle
  sound (no audio files). No frameworks, no build step, no tracking.

## Try it in 10 seconds (free, no accounts)

Open `index.html` in a browser. That's it. **Demo mode** starts with a
simulated crowd (Maya, Theo, Priya…) so you can feel the vibe solo — they
greet you, chat, reply, and toss marshmallows. Toggle them off in ⚙️.

## Go live with real members — still $0

1. **Host the folder anywhere static & free** — GitHub Pages, Cloudflare
   Pages, Netlify, or Vercel (all have free tiers). It's just 4 files.
2. **Create a free Supabase project** (supabase.com — free tier, no card).
   Copy *Project URL* and *anon public key* from **Settings → API**.
3. On your hosted page: **⚙️ → Mode: Live**, paste the URL + key, pick a room
   name, save. Everyone who opens your link with that room name shares one
   fire — realtime messages, presence, and tosses ride Supabase Realtime,
   comfortably inside the free tier for a community-sized chat.
4. *(Optional)* Run `setup.sql` in the Supabase SQL Editor so the last ~40
   messages persist across refreshes. Skip it and messages are simply
   ephemeral — arguably very campfire.

Share different rooms with `?room=name` in the URL (e.g. `…/index.html?room=friday-fire`).

**Honest security note:** in this test setup, the page link + room name *is*
the key — same trust model as an unlisted Discord/WhatsApp invite link. That's
fine for testing with members you invite. Before a big rollout, add Supabase
Auth magic links (members claim a seat with their email) and tighten the RLS
policies in `setup.sql`.

## Inviting your Skool members — the right way

Ember deliberately has **no scraping and no auto-adding**. Members join by
clicking a link, which keeps you clean with Skool's ToS, the chat platforms,
and privacy law:

- 📌 Pin a post in your community: *"The campfire is lit tonight →"*
- 👋 Put the link in your Skool auto-welcome DM and Classroom onboarding.
- ✉️ Email your member list (Skool gives owners member emails / CSV export —
  data members agreed to share). One clear invite with an obvious opt-out.
- ⚡ Later: Skool's official Zapier integration ("new member joined" trigger)
  can auto-send each new member the campfire link, or land them in your own
  Supabase `members` table for magic-link auth.
- 🚫 Never bulk-DM on Skool with automation, scrape member profiles, or
  auto-add phone numbers to group chats.

## Files

- `index.html` — markup
- `styles.css` — night theme, glass chat panel, wisp/chip animations
- `fire.js` — canvas scene: particle fire, embers, smoke, sky, moon, fireflies, tosses
- `app.js` — chat, heat engine, presence, demo crowd, tab-sync, Supabase live mode, crackle audio
- `setup.sql` — optional message history table for live mode

## Tuning the fire

In `app.js`: `HALF_LIFE` (seconds for the fire to halve when nobody talks —
75s is demo-snappy; try 1800 for a real community so the fire smoulders
between bursts) and each message's stoke amount in `stokeHeat(...)` calls.
