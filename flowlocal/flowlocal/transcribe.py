"""On-device speech-to-text via faster-whisper.

The model is downloaded once (from Hugging Face) on first use and cached under
the user's profile; after that transcription is fully offline.
"""


def _autodetect():
    """Return (device, compute_type) preferring CUDA when available."""
    try:
        import ctranslate2

        if ctranslate2.get_cuda_device_count() > 0:
            return "cuda", "float16"
    except Exception:
        pass
    return "cpu", "int8"


class Transcriber:
    def __init__(
        self,
        model="base.en",
        device="auto",
        compute_type="auto",
        language="en",
        vad_filter=True,
        vocabulary=None,
    ):
        self.model_name = model
        self.language = language
        self.vad_filter = vad_filter
        self.vocabulary = vocabulary or []
        self._device = device
        self._compute_type = compute_type
        self._model = None

    def _resolve(self):
        device, compute_type = self._device, self._compute_type
        if device == "auto":
            device, auto_ct = _autodetect()
            if compute_type == "auto":
                compute_type = auto_ct
        elif compute_type == "auto":
            compute_type = "int8" if device == "cpu" else "float16"
        return device, compute_type

    def load(self):
        from faster_whisper import WhisperModel

        device, compute_type = self._resolve()
        self._model = WhisperModel(
            self.model_name, device=device, compute_type=compute_type
        )
        return self

    def _initial_prompt(self):
        if not self.vocabulary:
            return None
        return "Vocabulary: " + ", ".join(self.vocabulary) + "."

    def transcribe(self, audio) -> str:
        if self._model is None:
            self.load()
        kwargs = dict(language=self.language, initial_prompt=self._initial_prompt())
        try:
            segments, _ = self._model.transcribe(
                audio, vad_filter=self.vad_filter, **kwargs
            )
        except Exception:
            # The VAD path needs onnxruntime; if it's missing, retry without it.
            segments, _ = self._model.transcribe(audio, vad_filter=False, **kwargs)
        return "".join(seg.text for seg in segments).strip()
