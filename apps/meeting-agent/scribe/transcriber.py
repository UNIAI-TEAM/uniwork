"""One microphone track: Silero VAD gates an STT session that opens on speech
and closes after idle_close_s of silence (the vendor bills open-session time,
spec §4.1 and S0 §2.5). Interim and final texts go to the room as captions;
finals also go to the server. Never logs spoken text, only ids and lengths."""

from __future__ import annotations

import asyncio
import logging
import random
import time
from collections import deque
from collections.abc import Awaitable, Callable, Coroutine
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TypeVar

from livekit import rtc
from livekit.agents import stt

from scribe import metrics
from scribe.health import SttHealth

log = logging.getLogger("scribe.track")
T = TypeVar("T")

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
# Audio not yet covered by a final, kept so a failed or refused session loses
# no words: replayed into the next session after the backoff (benchmark #13).
BUFFER_MAX_S = 30.0
# The vendor refused a new session: AssemblyAI closes with 1008 past its
# new-sessions-per-minute limit, an HTTP handshake answers 429 (S0 row 5b).
SESSION_LIMIT_CODES = frozenset({1008, 429})


def failure_reason(e: BaseException) -> str:
    """session_limit when any exception in the chain carries a session-limit
    code (the plugin wraps the vendor's close after its own retries), else stream."""
    seen: set[int] = set()
    x: BaseException | None = e
    while x is not None and id(x) not in seen:
        seen.add(id(x))
        code = getattr(x, "status_code", None) or getattr(x, "status", None)
        if code in SESSION_LIMIT_CODES:
            return "session_limit"
        x = x.__cause__ or x.__context__
    return "stream"


class AudioBuffer:
    """The newest max_s seconds of frames."""

    def __init__(self, frames: list[rtc.AudioFrame] | None = None, max_s: float = BUFFER_MAX_S) -> None:
        self._frames: deque[rtc.AudioFrame] = deque()
        self._max = max_s
        self.seconds = 0.0
        for f in frames or []:
            self.add(f)

    def add(self, f: rtc.AudioFrame) -> None:
        self._frames.append(f)
        self.seconds += f.duration
        while self.seconds > self._max and len(self._frames) > 1:
            self.seconds -= self._frames.popleft().duration

    def take(self) -> list[rtc.AudioFrame]:
        out = list(self._frames)
        self._frames.clear()
        self.seconds = 0.0
        return out

    def __len__(self) -> int:
        return len(self._frames)


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
        health: SttHealth | None = None,
        rand: Callable[[], float] = random.random,
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
        self._health = health
        self._rand = rand
        self._session: stt.RecognizeStream | None = None
        self._drain: asyncio.Task | None = None
        self._speaking = False
        self._last_end = 0.0
        # Audio waiting for a session: the VAD's preroll, then (during a
        # backoff) everything heard since. None: nothing to open a session for.
        self._preroll: AudioBuffer | None = None
        self._unfinal = AudioBuffer()  # sent to the open session, no final for it yet
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
        if self._session is None and not (self._preroll is not None and self._backing_off()):
            self._preroll = AudioBuffer([] if self._degraded() else preroll)
        # In a backoff the buffer already holds what the preroll repeats.

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
                self._preroll = AudioBuffer()  # mid-sentence: the next frame reopens, not the next sentence

    @property
    def open(self) -> bool:
        return self._session is not None

    async def push(self, frame: rtc.AudioFrame) -> None:
        async with self._lock:
            if self._session is not None and self._failed:
                await self._drop()
            if self._session is None and self._preroll is not None:
                if self._backing_off():
                    if not self._degraded():
                        self._preroll.add(frame)  # replayed into the next session
                    return
                self._open(self._preroll.take())
                self._preroll = None
            if self._session is None or self._failed:
                return
            if self._idle_due():
                await self._close("idle")
                return
            try:
                self._session.push_frame(frame)
            except Exception as e:  # noqa: BLE001 - a dead session must not end the track
                log.warning("stt push failed track=%s err=%s", self._sid, type(e).__name__)
                self._fail("push")
                return
            if not self._degraded():
                self._unfinal.add(frame)

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

    def _degraded(self) -> bool:
        """While the meeting is degraded the room writes device captions into
        the transcript, so audio heard then is never kept for a replay: it
        would be stored twice. Audio kept before the fallback still replays."""
        return self._health is not None and self._health.state() == "degraded"

    def _backing_off(self) -> bool:
        return self._clock() < self._retry_at

    def _fail(self, reason: str) -> None:
        self.failures += 1
        metrics.STT_ERRORS.labels(reason=reason).inc()
        if self._health is not None:
            self._health.failed()
        self._failed = True

    def _idle_due(self) -> bool:
        idle = max(self._idle_base, SHARED_MIC_IDLE_S) if self._diarize else self._idle_base
        return not self._speaking and self._clock() - self._last_end >= idle

    def _open(self, preroll: list[rtc.AudioFrame]) -> None:
        self.sessions += 1
        metrics.STT_SESSIONS.inc()
        s = self._stt.stream()
        self._unfinal = AudioBuffer(preroll)
        self._failed = False
        self._session, self._drain = s, asyncio.create_task(self._read(s))
        try:
            for f in preroll:
                s.push_frame(f)
        except Exception as e:  # noqa: BLE001 - the next push drops it and the preroll replays
            log.warning("stt push failed track=%s err=%s", self._sid, type(e).__name__)
            self._fail("push")
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
        self._unfinal.take()  # every final of the session is out
        self.session_ms += int((self._clock() - self._opened_at) * 1000)
        log.info("stt close track=%s reason=%s", self._sid, reason)

    async def _drop(self) -> None:
        """Discards a failed session and schedules the retry, jittered so the
        tracks of a fleet that failed together do not reopen together. The audio
        it had no final for waits in the buffer with what is heard during the
        backoff, and opens the next session once retry_at passes."""
        s, self._session = self._session, None
        if s is not None:
            try:
                await s.aclose()
            except Exception:  # noqa: BLE001, S110 - it already failed
                pass
            self.session_ms += int((self._clock() - self._opened_at) * 1000)
        self._failed = False
        pending = self._unfinal.take()
        self._preroll = AudioBuffer(pending) if pending or self._speaking else None
        self._retry_at = self._clock() + self._retry_s * (0.5 + self._rand() / 2)
        log.warning("stt dropped track=%s retry_in_s=%.0f", self._sid, self._retry_s)
        self._retry_s = min(RETRY_MAX_S, self._retry_s * 2)

    async def _read(self, s: stt.RecognizeStream) -> None:
        try:
            async for ev in s:
                await self._event(ev)
        except Exception as e:  # noqa: BLE001 - the track lives on; push/tick drop the session
            reason = failure_reason(e)
            log.warning("stt failed track=%s reason=%s err=%s", self._sid, reason, type(e).__name__)
            self._fail(reason)

    async def _event(self, ev: stt.SpeechEvent) -> None:
        if ev.type not in (stt.SpeechEventType.INTERIM_TRANSCRIPT, stt.SpeechEventType.FINAL_TRANSCRIPT):
            return
        alt = ev.alternatives[0]
        if not alt.text.strip():
            return
        if self._health is not None:
            self._health.ok()
        final = ev.type == stt.SpeechEventType.FINAL_TRANSCRIPT
        seg_id = f"{self._sid}-{self._seg + 1}"
        language = alt.language or self._language
        if self._seg_started is None:
            self._seg_started = self._wall()
        try:
            await self._publish(Caption(self._identity, seg_id, alt.text, final, language))
        except Exception as e:  # noqa: BLE001 - a lost caption (room closing, stream error) must not lose the final
            log.warning("caption not published track=%s err=%s", self._sid, type(e).__name__)
        if not final:
            return
        self._seg += 1
        self._unfinal.take()  # the vendor finalised what it was sent
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


def start_once(
    transcribers: dict[str, T],
    tasks: set[asyncio.Task],
    sid: str,
    make: Callable[[], T],
    run: Callable[[T], Coroutine[object, object, None]],
) -> None:
    """Starts one transcriber per track. It is registered before its task is
    scheduled: a rejoin leaves the first join's track_subscribed listener
    behind, so one track can be announced twice before any task runs."""
    if sid in transcribers:
        return
    t = transcribers[sid] = make()
    task = asyncio.create_task(run(t))
    tasks.add(task)
    task.add_done_callback(tasks.discard)
