"""Configuration loading and defaults.

The config lives in a per-machine JSON file under %APPDATA%\\FlowLocal (or the
user's home directory if APPDATA is not set). Every machine keeps its own copy;
there is no sync.
"""

import json
import os
from pathlib import Path

APP_NAME = "FlowLocal"

DEFAULTS = {
    # --- Hotkey ---------------------------------------------------------
    "hotkey": "ctrl_r",          # pynput key name (e.g. ctrl_r, alt_r, f9) or a single character
    "hotkey_mode": "hold",       # "hold" = push-to-talk, "toggle" = press once to start/stop

    # --- Transcription --------------------------------------------------
    "model": "base.en",          # faster-whisper model: tiny(.en) base(.en) small(.en) medium(.en) large-v3
    "device": "auto",            # "auto" | "cpu" | "cuda"
    "compute_type": "auto",      # "auto" | "int8" | "int8_float16" | "float16" | "float32"
    "language": "en",
    "vad_filter": True,          # trim silence before transcribing
    "vocabulary": [],            # words/names to bias the recognizer toward

    # --- Text insertion -------------------------------------------------
    "insert_mode": "paste",      # "paste" (fast, via clipboard) or "type" (character by character)
    "restore_clipboard": True,   # put the previous clipboard contents back after pasting
    "trailing_space": True,      # append a space so consecutive dictations flow

    # --- Local cleanup (no network / no LLM) ---------------------------
    "auto_capitalize": True,
    "collapse_spaces": True,
    "remove_fillers": False,
    "filler_words": ["um", "uh", "er", "erm", "hmm", "uhh", "umm"],

    # --- Audio ----------------------------------------------------------
    "sample_rate": 16000,        # Whisper expects 16 kHz; leave this alone unless you know why
    "input_device": None,        # None = system default mic; or an index/name from `--devices`

    # --- Misc -----------------------------------------------------------
    "beep": True,                # short tones when recording starts/stops
    "save_history": True,        # append each dictation to history.jsonl
}


def config_dir() -> Path:
    """Directory that holds config.json and history.jsonl for this machine."""
    base = os.getenv("APPDATA") or os.path.expanduser("~")
    d = Path(base) / APP_NAME
    d.mkdir(parents=True, exist_ok=True)
    return d


def config_path() -> Path:
    return config_dir() / "config.json"


def load() -> dict:
    """Return the effective config: defaults overlaid with the user's file."""
    cfg = dict(DEFAULTS)
    path = config_path()
    if path.exists():
        try:
            user = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(user, dict):
                cfg.update(user)
        except (json.JSONDecodeError, OSError) as exc:
            print(f"[config] Could not read {path}: {exc}. Using defaults.")
    return cfg


def save(cfg: dict) -> Path:
    path = config_path()
    path.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
    return path


def ensure_exists() -> Path:
    """Write a default config file on first run so the user has something to edit."""
    path = config_path()
    if not path.exists():
        save(DEFAULTS)
    return path
