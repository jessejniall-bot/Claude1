"""Global hotkey listening built on pynput.

Supports two modes:
  * "hold"   -> push-to-talk: recording lasts while the key is held down.
  * "toggle" -> press once to start, press again to stop.
"""

from pynput import keyboard


def parse_key(name: str):
    """Convert a config string (e.g. "ctrl_r", "f9", "z") into a pynput key."""
    name = (name or "").strip()
    if not name:
        raise ValueError("Hotkey is empty")
    special = getattr(keyboard.Key, name.lower(), None)
    if special is not None:
        return special
    if len(name) == 1:
        return keyboard.KeyCode.from_char(name)
    raise ValueError(
        f"Unrecognized hotkey {name!r}. Use a single character or a name like "
        "ctrl_r, alt_r, cmd, f9."
    )


def key_matches(target, key) -> bool:
    if isinstance(target, keyboard.Key):
        return key == target
    if isinstance(target, keyboard.KeyCode):
        return isinstance(key, keyboard.KeyCode) and key.char == target.char
    return False


class HotkeyListener:
    """Watches for the configured key and drives the start/stop callbacks.

    Callbacks fire on the pynput listener thread, so keep on_start cheap and
    offload anything slow (like transcription) to a worker thread from on_stop.
    """

    def __init__(self, key, mode, on_start, on_stop):
        self._target = key
        self._mode = mode
        self._on_start = on_start
        self._on_stop = on_stop
        self._active = False   # currently recording
        self._held = False     # physical key currently down (guards auto-repeat)
        self._listener = None

    def _press(self, key):
        if not key_matches(self._target, key):
            return
        if self._held:
            return  # ignore keyboard auto-repeat while held
        self._held = True

        if self._mode == "toggle":
            self._active = not self._active
            (self._on_start if self._active else self._on_stop)()
        else:  # hold / push-to-talk
            if not self._active:
                self._active = True
                self._on_start()

    def _release(self, key):
        if not key_matches(self._target, key):
            return
        self._held = False
        if self._mode == "hold" and self._active:
            self._active = False
            self._on_stop()

    def start(self):
        self._listener = keyboard.Listener(
            on_press=self._press, on_release=self._release
        )
        self._listener.start()

    def stop(self):
        if self._listener is not None:
            self._listener.stop()
            self._listener = None
