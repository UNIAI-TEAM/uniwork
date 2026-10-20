"""STT providers, chosen by SCRIBE_STT_PROVIDER (spec D13). `fake` is for tests
and e2e: no vendor key exists outside production, and no test calls a vendor."""

from __future__ import annotations

import numpy as np
from livekit.agents import DEFAULT_API_CONNECT_OPTIONS, APIConnectOptions, stt
from livekit.agents.types import NOT_GIVEN, NotGivenOr

# Fake: one "word" per this much voiced audio, words only above this RMS.
FAKE_WORD_S = 0.5
FAKE_VOICE_RMS = 300.0


class FakeSTT(stt.STT):
    """Deterministic streaming STT: an interim per word, a final when flushed.
    AssemblyAI ends turns itself; the fake needs the VAD's end of speech."""

    flush_on_vad_end = True

    def __init__(self, language: str = "vi") -> None:
        super().__init__(capabilities=stt.STTCapabilities(streaming=True, interim_results=True))
        self._language = language

    async def _recognize_impl(self, buffer, *, language, conn_options):  # noqa: ANN001
        raise NotImplementedError("streaming only")

    def stream(
        self,
        *,
        language: NotGivenOr[str] = NOT_GIVEN,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
    ) -> stt.RecognizeStream:
        return _FakeStream(stt=self, conn_options=conn_options, language=self._language)


class _FakeStream(stt.RecognizeStream):
    def __init__(self, *, stt: FakeSTT, conn_options: APIConnectOptions, language: str) -> None:
        super().__init__(stt=stt, conn_options=conn_options)
        self._language = language

    async def _run(self) -> None:
        words, voiced_s = 0, 0.0
        async for data in self._input_ch:
            if isinstance(data, self._FlushSentinel):
                if words:
                    self._emit(stt.SpeechEventType.FINAL_TRANSCRIPT, words)
                    words, voiced_s = 0, 0.0
                continue
            samples = np.asarray(data.data, dtype=np.float32)
            if samples.size and np.sqrt(np.mean(np.square(samples))) > FAKE_VOICE_RMS:
                voiced_s += data.duration
            if voiced_s >= FAKE_WORD_S:
                words, voiced_s = words + 1, 0.0
                self._emit(stt.SpeechEventType.INTERIM_TRANSCRIPT, words)

    def _emit(self, kind: stt.SpeechEventType, words: int) -> None:
        text = " ".join(f"từ{i}" for i in range(1, words + 1))
        self._event_ch.send_nowait(
            stt.SpeechEvent(type=kind, alternatives=[stt.SpeechData(language=self._language, text=text)])
        )


def make_stt(provider: str, keyterms: list[str]) -> stt.STT:
    if provider == "fake":
        return FakeSTT()
    if provider == "assemblyai":
        from livekit.plugins import assemblyai

        # S0 results §2.3: only Universal-3.6 Pro lists Vietnamese for streaming.
        return assemblyai.STT(
            model="universal-3-6-pro",
            language_codes=["vi", "en"],
            keyterms_prompt=keyterms[:100],
            mode="max_accuracy",
            voice_focus="near-field",
        )
    raise ValueError(f"unknown SCRIBE_STT_PROVIDER {provider!r}")
