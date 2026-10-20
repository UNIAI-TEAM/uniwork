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

log = logging.getLogger("scribe.track")

MAX_SPEECH_MS = 600_000


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

    def as_json(self) -> dict:
        return {
            "segment_id": self.segment_id,
            "participant_identity": self.identity,
            "spoken_at": self.spoken_at.isoformat(timespec="milliseconds"),
            "ended_at": self.ended_at.isoformat(timespec="milliseconds"),
            "speech_ms": self.speech_ms,
            "text": self.text,
            "language": self.language,
        }


class TrackTranscriber:
    """The audio loop (push) is the only place a session opens or closes, so a
    new session never starts while the old one drains (S0 §1 item 5a)."""

    def __init__(
        self,
        *,
        track_sid: str,
        identity: str,
        stt_impl: stt.STT,
        publish: Callable[[Caption], Awaitable[None]],
        on_final: Callable[[Final], None],
        idle_close_s: float = 30.0,
        language: str = "vi",
        clock: Callable[[], float] = time.monotonic,
        wall: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._sid = track_sid
        self._identity = identity
        self._stt = stt_impl
        self._publish = publish
        self._on_final = on_final
        self._idle = idle_close_s
        self._language = language
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
        self.sessions = 0
        self.session_ms = 0

    # VAD side: only marks state.
    def on_vad_start(self, preroll: list[rtc.AudioFrame]) -> None:
        self._speaking = True
        if self._session is None:
            self._preroll = list(preroll)

    def on_vad_end(self, speech_s: float) -> None:
        self._speaking, self._last_end = False, self._clock()
        self._speech_ms = min(MAX_SPEECH_MS, self._speech_ms + int(speech_s * 1000))
        if self._session is not None and getattr(self._stt, "flush_on_vad_end", False):
            self._session.flush()

    @property
    def open(self) -> bool:
        return self._session is not None

    async def push(self, frame: rtc.AudioFrame) -> None:
        if self._session is None and self._preroll is not None:
            self._open(self._preroll)
            self._preroll = None
        if self._session is None:
            return
        if not self._speaking and self._clock() - self._last_end >= self._idle:
            await self._close("idle")
        else:
            self._session.push_frame(frame)

    async def close(self) -> None:
        await self._close("track ended")

    def _open(self, preroll: list[rtc.AudioFrame]) -> None:
        self.sessions += 1
        s = self._stt.stream()
        for f in preroll:
            s.push_frame(f)
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

    async def _read(self, s: stt.RecognizeStream) -> None:
        async for ev in s:
            if ev.type not in (stt.SpeechEventType.INTERIM_TRANSCRIPT, stt.SpeechEventType.FINAL_TRANSCRIPT):
                continue
            alt = ev.alternatives[0]
            if not alt.text.strip():
                continue
            final = ev.type == stt.SpeechEventType.FINAL_TRANSCRIPT
            seg_id = f"{self._sid}-{self._seg + 1}"
            language = alt.language or self._language
            if self._seg_started is None:
                self._seg_started = self._wall()
            await self._publish(Caption(self._identity, seg_id, alt.text, final, language))
            if final:
                self._seg += 1
                ended = self._wall()
                self._on_final(
                    Final(seg_id, self._identity, alt.text, language, self._seg_started, ended, self._speech_ms)
                )
                self._seg_started, self._speech_ms = None, 0
                log.info("final seg=%s chars=%d", seg_id, len(alt.text))
