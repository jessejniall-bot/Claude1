# Murmur — Voice Notepad

Open a link, talk, and get genuinely good text — on your computer *and* your
phone (iPhone included). Murmur records your voice and sends it to a Whisper
transcription service, so quality and accents are excellent. Then you press
**Copy** and paste it anywhere.

It's a single HTML file with no backend. Your API key is entered in the app and
stored **only in your browser**, so the link is safe to share — each person adds
their own key.

## Get it online (one-time, ~2 minutes)

The microphone only works on a secure **https** link, so host the file:

1. On a computer, open **[app.netlify.com/drop](https://app.netlify.com/drop)**
   in Chrome or Edge.
2. Drag **`murmur.html`** onto the drop area (rename it to `index.html` first if
   you want the site to open straight to it).
3. Netlify gives you an `https://…netlify.app` link. That's your app — open it on
   any device and send it to whoever you like.
4. *(Optional)* Make a free Netlify account to keep the link permanently.

You can also host it on GitHub Pages, Cloudflare Pages, or any static host.

## One-time setup: your transcription key

Murmur needs a key for the transcription service. Open **Settings (gear) →
Transcription engine**, pick a service, and paste a key:

- **Groq** — free tier, very fast. Get a key at
  [console.groq.com/keys](https://console.groq.com/keys).
- **OpenAI** — top quality. Get a key at
  [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
  (add a little credit; transcription is ~$0.006/minute).

The key is saved only in your browser. Everyone you share the link with adds
their own — nothing is baked into the file.

## Using it

- Press the **mic**, allow the microphone the first time, and talk. Press it
  again to stop — a moment later the transcription lands in the notepad.
- **Mode**: *Clean up* (tidy formatting), *Bullet points*, or *Verbatim*.
- **Language**: the spoken language (accents are handled automatically — no need
  to pick a region). Leave on English or choose another; *Auto-detect* also works.
- **Settings → Corrections & names**: add names/terms it should nail (a
  colleague's name, jargon). These are sent as a hint and fixed in the text.
- **Tidy** re-cleans the current text; **Copy** copies everything.

Works on desktop Chrome/Edge/Safari and on phones including iPhone, because it
records audio (via MediaRecorder) instead of relying on the browser's built-in
dictation.

## Privacy

Your notes, corrections, and key stay in your browser (local storage). Your
**audio** is sent to the transcription service you chose (OpenAI or Groq) to be
turned into text, and nowhere else. Murmur has no server of its own.

## Files

- `murmur.html` — the whole app (host this).
- `serve.bat` — optional: run it locally at `http://localhost:8000` for testing
  on a Windows PC (still needs a key and internet for transcription).
