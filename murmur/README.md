# Murmur — Voice Notepad (keyless, local)

Talk into a notepad; your words are transcribed by your browser and tidied up by
local rules. Then hit **Copy** and paste anywhere. No account, no API key, and
nothing is sent to any server we run — it's a single HTML file.

## Run it

1. Put `murmur.html` and `serve.bat` in the same folder.
2. Double-click **`serve.bat`**. A browser tab opens at
   `http://localhost:8000/murmur.html` and a small "Murmur server" window stays
   open in the background.
3. Use it in **Chrome or Edge** (other browsers don't support in-page voice).
4. Close the "Murmur server" window when you're done.

> **Why the little server?** Browsers block the speech engine on `file://`
> pages (you'll see a "network" error). Serving from `http://localhost` is a
> secure origin, so voice works reliably. `serve.bat` uses Python's built-in
> web server — if you don't have Python, install it from python.org (tick
> "Add to PATH"), or host `murmur.html` on any https site instead.

## Using it

- Press the **mic** (allow the microphone the first time) and talk. Text lands
  in the notepad, tidied as you pause. Press the mic again to stop.
- **Mode** (top bar):
  - **Clean up** — capitalization, spacing, punctuation, filler removal.
  - **Bullet points** — each sentence becomes a bullet.
  - **Verbatim** — exactly as heard (still applies your corrections).
- **Accent** (top bar) — set the recognizer's locale, including **English ·
  Ireland** for Irish accents, plus UK, Australia, India, and more.
- **Settings** (gear):
  - **Cleanup options** — toggle filler removal, smart capitalization, and
    spoken punctuation (say "period", "comma", "new line").
  - **Corrections it learns** — when it mishears a name/term, add "it hears X →
    you mean Y" and it's fixed on every dictation afterward.
- **Copy** copies everything to your clipboard.

## Sharing

Because it's just two files with no keys or accounts, send `murmur.html` +
`serve.bat` to anyone (e.g. a colleague) and they run it the same way. Their
settings and corrections are saved on their own machine.

## Privacy

Everything runs in your browser. Your notes, corrections, and settings are
stored only in that browser (local storage). The one thing that leaves your
machine: to convert speech to text, **Chrome's built-in voice recognition sends
the audio to Google's servers** — that's how the browser's dictation works, not
something this app adds. If you need audio to never leave the device, use the
on-device Whisper desktop app (`flowlocal/`) instead.
