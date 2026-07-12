# FlowLocal

A local, private voice-dictation app for Windows — the same core idea as Wispr
Flow, but everything runs **on your own machine**. Hold a hotkey, speak, and your
words are transcribed on-device and typed into whatever app has focus. No audio
ever leaves your computer.

Because it's independent per machine, you just install it on each of your
computers and it works the same everywhere — settings live in a local file you
can copy over if you want them to match.

---

## What it does

- **Push-to-talk dictation** — hold **Right Ctrl**, speak, release. The text lands
  at your cursor in any application (email, editor, browser, chat…).
- **On-device transcription** — uses [faster-whisper](https://github.com/SYSTRAN/faster-whisper).
  The model downloads once, then works fully offline.
- **System-tray icon** — sits in the background and turns red while listening.
- **Local cleanup** — fixes capitalization/spacing and can optionally strip filler
  words ("um", "uh"). No LLM, no network.
- **Custom vocabulary** — bias the recognizer toward names/jargon it keeps getting
  wrong.
- **Toggle mode** — prefer press-once-to-start / press-again-to-stop? Set it.

---

## Install (Windows)

1. Install **Python 3.9+** from <https://www.python.org/downloads/> — tick
   *"Add Python to PATH"* during setup.
2. Download/clone this `flowlocal` folder onto your PC.
3. Double-click **`install.bat`**. It creates a self-contained virtual environment
   and installs the dependencies. (One-time; takes a few minutes.)
4. Double-click **`run.bat`** to start it. The first launch downloads the speech
   model (~150 MB for `base.en`), so give it a minute and make sure you're online
   that first time.

You'll see a microphone icon appear in your system tray.

---

## Use it

1. Click into any text field.
2. **Hold Right Ctrl** and speak.
3. **Release** — a moment later your words appear.

That's it. Right-click the tray icon for *Open FlowLocal folder* (config + history)
and *Quit*.

---

## Configuration

Settings live in `%APPDATA%\FlowLocal\config.json`. Run this to see the exact path:

```
run.bat --config
```

(or `python -m flowlocal --config`)

Edit the file and restart the app. Handy options:

| Setting | Default | Notes |
|---|---|---|
| `hotkey` | `"ctrl_r"` | Any single character or a name like `alt_r`, `f9`, `cmd`. |
| `hotkey_mode` | `"hold"` | `"hold"` = push-to-talk; `"toggle"` = press to start/stop. |
| `model` | `"base.en"` | `tiny.en` (fastest) → `small.en` → `medium.en` → `large-v3` (most accurate). |
| `device` | `"auto"` | `"cpu"`, or `"cuda"` if you have an NVIDIA GPU. |
| `insert_mode` | `"paste"` | `"paste"` (fast, uses clipboard) or `"type"` (keystrokes). |
| `vocabulary` | `[]` | e.g. `["Kubernetes", "Anthropic"]` to nudge tricky words. |
| `remove_fillers` | `false` | Strip "um"/"uh"/etc. from the output. |
| `input_device` | `null` | System default mic. Run `run.bat --devices` to list options and use an index. |

See `config.example.json` for a complete sample.

### Picking a model

`base.en` is a good default on a typical laptop CPU. If accuracy matters more than
speed, try `small.en` or `medium.en`. On an NVIDIA GPU, set `"device": "cuda"` and
you can run `large-v3` comfortably.

---

## Privacy & getting it allowlisted

FlowLocal is designed to be easy to clear with an IT/security team:

- **No audio or text is uploaded.** Transcription runs locally via faster-whisper.
- **The only network activity** is a one-time model download from Hugging Face on
  first run. After that it works with no internet at all — you can verify this by
  disconnecting and dictating.
- **What it does touch:** your microphone (to record while the hotkey is held), and
  it simulates a **Ctrl+V paste** (or keystrokes) to insert text into the focused
  window. Some endpoint-protection tools flag input-simulation by default, so it's
  worth mentioning that to whoever reviews it.
- Everything it stores stays in `%APPDATA%\FlowLocal` (`config.json`, `history.jsonl`).
  Delete `history.jsonl`, or set `"save_history": false`, if you don't want a log.

If you'd like, I can help you draft a short summary for your IT team.

---

## Troubleshooting

- **Nothing gets typed** — make sure a text field is focused before you release the
  hotkey. Try `"insert_mode": "type"` if a particular app ignores paste.
- **First run is slow / errors about downloading** — you need internet the first
  time so the model can download. It's offline after that.
- **Hotkey conflicts with something** — change `hotkey` in the config (e.g. `"f9"`).
- **Wrong microphone** — run `run.bat --devices`, find your mic's index, and set
  `input_device` to that number.
- **Antivirus flags it** — this is usually the input-simulation (paste/typing). Ask
  IT to allowlist it; see the section above.

---

## Optional: build a single .exe

To hand yourself a double-clickable executable (no Python needed to run it):

```
call .venv\Scripts\activate.bat
pip install pyinstaller
pyinstaller --noconsole --name FlowLocal -p . flowlocal\__main__.py
```

The result lands in `dist\FlowLocal\`. (Model files still download on first run.)

---

## Project layout

```
flowlocal/
  flowlocal/          the Python package
    __main__.py       CLI entry (python -m flowlocal)
    app.py            wires hotkey -> record -> transcribe -> insert
    config.py         defaults + per-machine config file
    audio.py          microphone capture (sounddevice)
    transcribe.py     on-device Whisper (faster-whisper)
    cleanup.py        local text tidy-up (no network)
    inject.py         paste/type text into the focused window
    hotkey.py         global hotkey listener (pynput)
    tray.py           system-tray icon (pystray)
    history.py        local dictation log
  tests/              unit tests for the pure logic
  install.bat         one-time setup
  run.bat             start the app
```
