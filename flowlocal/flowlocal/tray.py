"""Optional system-tray icon (pystray + Pillow).

If those packages aren't installed the app still runs headless from the console,
so the tray is a nice-to-have rather than a hard dependency.
"""

import os

from .config import config_dir


def build_icon(app):
    """Return a tray controller, or None if tray dependencies are unavailable."""
    try:
        import pystray
        from PIL import Image, ImageDraw
    except Exception:
        return None
    return _Tray(app, pystray, Image, ImageDraw)


class _Tray:
    def __init__(self, app, pystray, Image, ImageDraw):
        self.app = app
        self._idle = self._draw(Image, ImageDraw, (90, 150, 245))   # blue
        self._recording = self._draw(Image, ImageDraw, (230, 70, 70))  # red
        menu = pystray.Menu(
            pystray.MenuItem("FlowLocal", None, enabled=False),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Open FlowLocal folder", self._open_folder),
            pystray.MenuItem("Quit", self._quit),
        )
        self.icon = pystray.Icon("flowlocal", self._idle, "FlowLocal — ready", menu)

    @staticmethod
    def _draw(Image, ImageDraw, color):
        img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        d.ellipse((22, 8, 42, 40), fill=color)      # mic capsule
        d.rectangle((30, 40, 34, 50), fill=color)   # stem
        d.rectangle((22, 50, 42, 55), fill=color)   # base
        return img

    def set_recording(self, recording: bool):
        try:
            self.icon.icon = self._recording if recording else self._idle
            self.icon.title = (
                "FlowLocal — recording…" if recording else "FlowLocal — ready"
            )
        except Exception:
            pass

    def _open_folder(self, *_):
        try:
            os.startfile(str(config_dir()))  # Windows only; harmless elsewhere
        except (AttributeError, OSError):
            pass

    def _quit(self, *_):
        try:
            self.icon.stop()
        finally:
            self.app.shutdown()

    def run(self):
        self.icon.run()

    def stop(self):
        try:
            self.icon.stop()
        except Exception:
            pass
