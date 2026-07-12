"""Application orchestrator: wires the hotkey to record -> transcribe -> insert."""

import threading
import time

from . import cleanup, history
from .audio import Recorder
from .hotkey import HotkeyListener, parse_key
from .inject import insert
from .transcribe import Transcriber
from .tray import build_icon


def _beep(start: bool):
    try:
        import winsound

        winsound.Beep(880 if start else 440, 90)
    except Exception:
        pass  # not on Windows, or sound unavailable


class FlowLocalApp:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.recorder = Recorder(
            sample_rate=cfg["sample_rate"],
            device=cfg["input_device"],
        )
        self.transcriber = Transcriber(
            model=cfg["model"],
            device=cfg["device"],
            compute_type=cfg["compute_type"],
            language=cfg["language"],
            vad_filter=cfg["vad_filter"],
            vocabulary=cfg["vocabulary"],
        )
        self.listener = HotkeyListener(
            parse_key(cfg["hotkey"]),
            cfg["hotkey_mode"],
            self._on_start,
            self._on_stop,
        )
        self._busy = threading.Lock()
        self._tray = None
        self._stop_event = threading.Event()
        self._shutdown_done = False

    # --- hotkey callbacks (run on the listener thread) -----------------
    def _on_start(self):
        try:
            self.recorder.start()
            if self.cfg["beep"]:
                _beep(True)
            if self._tray:
                self._tray.set_recording(True)
        except Exception as exc:
            print(f"[flowlocal] Could not start recording: {exc}")

    def _on_stop(self):
        try:
            audio = self.recorder.stop()
        except Exception as exc:
            print(f"[flowlocal] Could not stop recording: {exc}")
            audio = None
        if self.cfg["beep"]:
            _beep(False)
        if self._tray:
            self._tray.set_recording(False)
        if audio is None or len(audio) == 0:
            return
        # Transcription is slow: do it off the listener thread.
        threading.Thread(target=self._process, args=(audio,), daemon=True).start()

    # --- worker --------------------------------------------------------
    def _process(self, audio):
        with self._busy:
            try:
                text = self.transcriber.transcribe(audio)
            except Exception as exc:
                print(f"[flowlocal] Transcription failed: {exc}")
                return
            text = cleanup.clean(
                text,
                auto_capitalize=self.cfg["auto_capitalize"],
                collapse_spaces=self.cfg["collapse_spaces"],
                remove_fillers=self.cfg["remove_fillers"],
                filler_words=self.cfg["filler_words"],
                trailing_space=self.cfg["trailing_space"],
            )
            if not text:
                return
            try:
                insert(
                    text,
                    mode=self.cfg["insert_mode"],
                    restore_clipboard=self.cfg["restore_clipboard"],
                )
            except Exception as exc:
                print(f"[flowlocal] Could not insert text: {exc}")
            if self.cfg["save_history"]:
                history.record(text.strip())

    # --- lifecycle -----------------------------------------------------
    def run(self):
        print(f"[flowlocal] Loading model '{self.cfg['model']}' (first run downloads it)...")
        self.transcriber.load()
        print("[flowlocal] Model ready.")

        self.listener.start()
        mode = "hold" if self.cfg["hotkey_mode"] == "hold" else "toggle"
        verb = "Hold" if mode == "hold" else "Press"
        print(f"[flowlocal] Ready. {verb} '{self.cfg['hotkey']}' and speak.")

        self._tray = build_icon(self)
        if self._tray:
            self._tray.run()  # blocks until Quit
        else:
            print("[flowlocal] Tray unavailable; running in console. Press Ctrl+C to quit.")
            try:
                while not self._stop_event.is_set():
                    time.sleep(0.5)
            except KeyboardInterrupt:
                pass
        self.shutdown()

    def shutdown(self):
        if self._shutdown_done:
            return
        self._shutdown_done = True
        self._stop_event.set()
        self.listener.stop()
        print("[flowlocal] Stopped.")
