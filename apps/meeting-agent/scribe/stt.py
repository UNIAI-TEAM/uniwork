"""STT providers, chosen by SCRIBE_STT_PROVIDER (spec D13). `fake` is for tests
and e2e: no vendor key exists outside production, and no test calls a vendor."""

from __future__ import annotations

import numpy as np
from livekit.agents import DEFAULT_API_CONNECT_OPTIONS, APIConnectOptions, stt
from livekit.agents.types import NOT_GIVEN, NotGivenOr

# Fake: one "word" per this much voiced audio, words only above this RMS.
FAKE_WORD_S = 0.5
FAKE_VOICE_RMS = 300.0


# Fake diarization: a turn of at least this many words is speaker "A"; a
# shorter one has no speaker, as AssemblyAI leaves short turns unlabelled.
FAKE_LABEL_WORDS = 2


class FakeSTT(stt.STT):
    """Deterministic streaming STT: an interim per word, a final when flushed.
    AssemblyAI ends turns itself; the fake needs the VAD's end of speech."""

    flush_on_vad_end = True

    def __init__(self, language: str = "vi", diarize: bool = False) -> None:
        super().__init__(capabilities=stt.STTCapabilities(streaming=True, interim_results=True))
        self._language = language
        self.diarize = diarize

    async def _recognize_impl(self, buffer, *, language, conn_options):  # noqa: ANN001
        raise NotImplementedError("streaming only")

    def stream(
        self,
        *,
        language: NotGivenOr[str] = NOT_GIVEN,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
    ) -> stt.RecognizeStream:
        return _FakeStream(stt=self, conn_options=conn_options, language=self._language, diarize=self.diarize)


class _FakeStream(stt.RecognizeStream):
    def __init__(self, *, stt: FakeSTT, conn_options: APIConnectOptions, language: str, diarize: bool) -> None:
        super().__init__(stt=stt, conn_options=conn_options)
        self._language = language
        self._diarize = diarize

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
        speaker = "A" if self._diarize and words >= FAKE_LABEL_WORDS else None
        self._event_ch.send_nowait(
            stt.SpeechEvent(
                type=kind, alternatives=[stt.SpeechData(language=self._language, text=text, speaker_id=speaker)]
            )
        )


# A conference room's mic hears a table of people; the vendor's diarization
# is told to expect at most this many (S0 results §2.3: max_speakers with
# speaker_labels). shortcut: a fixed cap, not the in-person count; pass that
# when the meeting knows who sits in the room.
SHARED_MIC_MAX_SPEAKERS = 10


def make_stt(provider: str, keyterms: list[str], diarize: bool = False, base_url: str = "") -> stt.STT:
    """diarize: the shared microphone's track (spec §4.3), and only that one -
    diarization thins out the vendor's interim captions. base_url: the
    vendor's streaming host (config.stt_base_url, benchmark #15)."""
    if provider == "fake":
        return FakeSTT(diarize=diarize)
    if provider == "assemblyai":
        from livekit.plugins import assemblyai

        # S0 results §2.3: only Universal-3.6 Pro lists Vietnamese for streaming.
        # A room mic is far from its speakers: far-field (S0 §2.3, A3).
        return assemblyai.STT(
            model="universal-3-6-pro",
            language_codes=["vi", "en"],
            keyterms_prompt=keyterms[:100],
            mode="max_accuracy",
            voice_focus="far-field" if diarize else "near-field",
            speaker_labels=True if diarize else NOT_GIVEN,
            max_speakers=SHARED_MIC_MAX_SPEAKERS if diarize else NOT_GIVEN,
            **({"base_url": base_url} if base_url else {}),
        )
    raise ValueError(f"unknown SCRIBE_STT_PROVIDER {provider!r}")
