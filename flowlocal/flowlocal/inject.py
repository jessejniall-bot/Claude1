"""Insert transcribed text into whatever window currently has focus.

Two strategies:
  * "paste" (default) -> put the text on the clipboard and send Ctrl+V. Fast and
    handles Unicode/newlines cleanly. The previous clipboard is restored after.
  * "type"            -> simulate keystrokes for each character. Slower but never
    touches the clipboard.
"""

import time

import pyperclip
from pynput.keyboard import Controller, Key

_controller = Controller()


def insert(text: str, *, mode="paste", restore_clipboard=True):
    if not text:
        return
    if mode == "type":
        _controller.type(text)
        return
    _paste_via_clipboard(text, restore_clipboard)


def _paste_via_clipboard(text, restore_clipboard):
    previous = None
    if restore_clipboard:
        try:
            previous = pyperclip.paste()
        except Exception:
            previous = None

    pyperclip.copy(text)
    time.sleep(0.02)  # let the clipboard settle before pasting
    _send_paste()

    if restore_clipboard:
        time.sleep(0.15)  # let the target app read the clipboard first
        try:
            pyperclip.copy(previous if previous is not None else "")
        except Exception:
            pass


def _send_paste():
    _controller.press(Key.ctrl)
    _controller.press("v")
    _controller.release("v")
    _controller.release(Key.ctrl)
