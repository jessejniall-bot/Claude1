"""Microphone capture using sounddevice (PortAudio).

Records mono float32 audio at 16 kHz, which is what Whisper expects, so no
resampling is needed downstream.
"""

import threading

import numpy as np
import sounddevice as sd


class Recorder:
    def __init__(self, sample_rate=16000, channels=1, device=None):
        self.sample_rate = sample_rate
        self.channels = channels
        self.device = device
        self._frames = []
        self._stream = None
        self._lock = threading.Lock()

    def _callback(self, indata, frames, time_info, status):
        # status can flag input overflows; we simply keep going.
        with self._lock:
            self._frames.append(indata.copy())

    def start(self):
        with self._lock:
            self._frames = []
        self._stream = sd.InputStream(
            samplerate=self.sample_rate,
            channels=self.channels,
            dtype="float32",
            device=self.device,
            callback=self._callback,
        )
        self._stream.start()

    def stop(self) -> np.ndarray:
        """Stop recording and return the captured audio as a 1-D float32 array."""
        if self._stream is not None:
            self._stream.stop()
            self._stream.close()
            self._stream = None
        with self._lock:
            frames = list(self._frames)
            self._frames = []
        if not frames:
            return np.zeros(0, dtype=np.float32)
        audio = np.concatenate(frames, axis=0)
        if audio.ndim > 1:
            audio = audio[:, 0]  # collapse to mono
        return audio.astype(np.float32)


def list_devices():
    """Return the available audio devices (use to find an input_device index)."""
    return sd.query_devices()
