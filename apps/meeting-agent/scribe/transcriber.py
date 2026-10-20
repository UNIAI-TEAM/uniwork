"""One microphone track: Silero VAD gates an STT session that opens on speech
and closes after idle_close_s of silence (the vendor bills open-session time,
spec §4.1 and S0 §2.5). Interim and final texts go to the room as captions;
finals also go to the server. Never logs spoken text, only ids and lengths."""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime

from livekit import rtc
from livekit.agents import stt

from scribe import metrics

log = logging.getLogger("scribe.track")

MAX_SPEECH_MS = 600_000
# A failed STT session is retried on the next speech, waiting at least this
# long, doubling up to RETRY_MAX_S (spec §4.1: retry with backoff, keep the job).
RETRY_MIN_S = 1.0
RETRY_MAX_S = 30.0
# A diarized (shared-mic) session stays open through pauses this long: vendor
# speaker labels hold within one session only, and every reopening starts a
# new set of speakers a clerk has to name. Cost: about 5.6 US cents per extra
# 5-minute pause per room mic (plan for UNI-2024).
SHARED_MIC_IDLE_S = 300.0


@dataclass(frozen=True)
class Caption:
    identity: str
    segment_id: str
    text: str
    final: bool
    language: str


@dataclass(frozen=True)
class Final:
    segment_id: str
    identity: str
    text: str
    language: str
    spoken_at: datetime
    ended_at: datetime
    speech_ms: int
    speaker_label: str = ""

    def as_json(self) -> dict:
        out = {
            "segment_id": self.segment_id,
            "participant_identity": self.identity,
            "spoken_at": self.spoken_at.isoformat(timespec="milliseconds"),
            "ended_at": self.ended_at.isoformat(timespec="milliseconds"),
            "speech_ms": self.speech_ms,
            "text": self.text,
            "language": self.language,
        }
        if self.speaker_label:
            out["speaker_label"] = self.speaker_label
        return out


class TrackTranscriber:
    """Sessions open and close under one lock (push, tick, close), so a new
    session never starts while the old one drains (S0 §1 item 5a).

    segment_prefix names the job and the track ("<job id>-<track sid>"): a
    later job on the same track must not reuse an earlier job's segment ids,
    which the server deduplicates per meeting."""

    def __init__(
        self,
        *,
        segment_prefix: str,
        identity: str,
        stt_impl: stt.STT,
        publish: Callable[[Caption], Awaitable[None]],
        on_final: Callable[[Final], None],
        idle_close_s: float = 30.0,
        language: str = "vi",
        diarize: bool = False,
        clock: Callable[[], float] = time.monotonic,
        wall: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._sid = segment_prefix
        self._identity = identity
        self._stt = stt_impl
        self._publish = publish
        self._on_final = on_final
        self._idle_base = idle_close_s
        self._language = language
        self._diarize = diarize
        self._clock = clock
        self._wall = wall
        self._session: stt.RecognizeStream | None = None
        self._drain: asyncio.Task | None = None
        self._speaking = False
        self._last_end = 0.0
        self._preroll: list[rtc.AudioFrame] | None = None
        self._seg = 0  # per track, not per session: ids stay unique across reopenings
        self._speech_ms = 0  # VAD speech since the last final
        self._seg_started: datetime | None = None
        self._opened_at = 0.0
        self._lock = asyncio.Lock()
        self._failed = False  # the open session's reader died
        self._retry_at = 0.0
        self._retry_s = RETRY_MIN_S
        self._end_at: float | None = None  # end of speech awaiting its final
        self.sessions = 0
        self.session_ms = 0
        self.failures = 0

    # VAD side: only marks state.
    def on_vad_start(self, preroll: list[rtc.AudioFrame]) -> None:
        self._speaking = True
        if self._session is None:
            self._preroll = list(preroll)

    def on_vad_end(self, speech_s: float) -> None:
        self._speaking, self._last_end = False, self._clock()
        self._end_at = self._last_end
        self._speech_ms = min(MAX_SPEECH_MS, self._speech_ms + int(speech_s * 1000))
        if self._session is not None and getattr(self._stt, "flush_on_vad_end", False):
            self._session.flush()

    def update_keyterms(self, terms: list[str]) -> None:
        """Spec §4.2: a newcomer's name reaches this track's STT too; the
        provider applies it to the open session (AssemblyAI UpdateConfiguration)."""
        update = getattr(self._stt, "update_options", None)
        if update is None:
            return
        try:
            update(keyterms_prompt=terms[:100])
        except TypeError:
            pass  # a provider without keyterms

    @property
    def identity(self) -> str:
        return self._identity

    async def set_stt(self, stt_impl: stt.STT, *, diarize: bool) -> None:
        """Spec §4.3: the shared-mic attribute changed. The open session ends
        now (its finals go out unlabelled or labelled as they were), and the
        next speech opens one on the new STT."""
        async with self._lock:
            await self._close("shared mic changed")
            self._stt, self._diarize = stt_impl, diarize
            if self._speaking:
                self._preroll = []  # mid-sentence: the next frame reopens, not the next sentence

    @property
    def open(self) -> bool:
        return self._session is not None

    async def push(self, frame: rtc.AudioFrame) -> None:
        async with self._lock:
            if self._session is not None and self._failed:
                await self._drop()
            if self._session is None and self._preroll is not None:
                if self._clock() < self._retry_at:
                    return  # backing off after a failure; speech resumes the session later
                self._open(self._preroll)
                self._preroll = None
            if self._session is None:
                return
            if self._idle_due():
                await self._close("idle")
                return
            try:
                self._session.push_frame(frame)
            except Exception as e:  # noqa: BLE001 - a dead session must not end the track
                log.warning("stt push failed track=%s err=%s", self._sid, type(e).__name__)
                self._failed = True

    async def tick(self) -> None:
        """Called once a second: a muted track sends no frames, and its session
        must still close after the idle window (the vendor bills open time)."""
        async with self._lock:
            if self._session is not None and self._failed:
                await self._drop()
            elif self._session is not None and self._idle_due():
                await self._close("idle")

    async def close(self) -> None:
        async with self._lock:
            await self._close("track ended")

    def _idle_due(self) -> bool:
        idle = max(self._idle_base, SHARED_MIC_IDLE_S) if self._diarize else self._idle_base
        return not self._speaking and self._clock() - self._last_end >= idle

    def _open(self, preroll: list[rtc.AudioFrame]) -> None:
        self.sessions += 1
        s = self._stt.stream()
        for f in preroll:
            s.push_frame(f)
        self._failed = False
        self._session, self._drain = s, asyncio.create_task(self._read(s))
        self._opened_at = self._clock()
        log.info("stt open track=%s session=%d", self._sid, self.sessions)

    async def _close(self, reason: str) -> None:
        s, drain = self._session, self._drain
        if s is None:
            return
        self._session = None
        s.end_input()  # AssemblyAI: Terminate, then read on until the socket closes
        if drain is not None:
            await drain  # every final of this session is out before the next opens
        await s.aclose()
        self.session_ms += int((self._clock() - self._opened_at) * 1000)
        log.info("stt close track=%s reason=%s", self._sid, reason)

    async def _drop(self) -> None:
        """Discards a failed session and schedules the retry: the next speech
        after retry_at opens a new one."""
        s, self._session = self._session, None
        if s is not None:
            try:
                await s.aclose()
            except Exception:  # noqa: BLE001, S110 - it already failed
                pass
            self.session_ms += int((self._clock() - self._opened_at) * 1000)
        self._failed = False
        self._preroll = None
        self._retry_at = self._clock() + self._retry_s
        log.warning("stt dropped track=%s retry_in_s=%.0f", self._sid, self._retry_s)
        self._retry_s = min(RETRY_MAX_S, self._retry_s * 2)

    async def _read(self, s: stt.RecognizeStream) -> None:
        try:
            async for ev in s:
                await self._event(ev)
        except Exception as e:  # noqa: BLE001 - the track lives on; push/tick drop the session
            self.failures += 1
            metrics.STT_ERRORS.inc()
            log.warning("stt failed track=%s err=%s", self._sid, type(e).__name__)
            self._failed = True

    async def _event(self, ev: stt.SpeechEvent) -> None:
        if ev.type not in (stt.SpeechEventType.INTERIM_TRANSCRIPT, stt.SpeechEventType.FINAL_TRANSCRIPT):
            return
        alt = ev.alternatives[0]
        if not alt.text.strip():
            return
        final = ev.type == stt.SpeechEventType.FINAL_TRANSCRIPT
        seg_id = f"{self._sid}-{self._seg + 1}"
        language = alt.language or self._language
        if self._seg_started is None:
            self._seg_started = self._wall()
        await self._publish(Caption(self._identity, seg_id, alt.text, final, language))
        if not final:
            return
        self._seg += 1
        self._retry_s = RETRY_MIN_S  # a session that delivers is healthy again
        if self._end_at is not None:
            metrics.STT_LATENCY.observe(max(0.0, self._clock() - self._end_at))
            self._end_at = None
        metrics.SEGMENTS.inc()
        metrics.SPEECH_SECONDS.inc(self._speech_ms / 1000)
        label = ""
        if self._diarize:
            # Vendor labels hold within one session only, so the session names the label.
            label = f"{self._identity}:{self._sid}-{self.sessions}:{alt.speaker_id or '?'}"
        self._on_final(
            Final(seg_id, self._identity, alt.text, language, self._seg_started, self._wall(), self._speech_ms, label)
        )
        self._seg_started, self._speech_ms = None, 0
        log.info("final seg=%s chars=%d", seg_id, len(alt.text))
