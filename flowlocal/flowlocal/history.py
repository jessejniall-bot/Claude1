"""Append-only local history of dictations (history.jsonl next to the config)."""

import json
import time

from .config import config_dir


def record(text: str):
    path = config_dir() / "history.jsonl"
    entry = {"ts": time.strftime("%Y-%m-%dT%H:%M:%S"), "text": text}
    try:
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except OSError as exc:
        print(f"[history] Could not write history: {exc}")
    return path
