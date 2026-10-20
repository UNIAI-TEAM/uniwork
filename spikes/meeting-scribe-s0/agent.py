"""S0 spike (UNI-2022): the thinnest `uniwork-scribe` agent.

Throwaway reference code, not wired into the product. One job per room
(explicit dispatch only), one STT stream per microphone track, Silero VAD
gating, captions on the `uw.caption` text stream, STT session closed after
SCRIBE_IDLE_CLOSE_S of VAD silence and reopened on speech. The STT is fake
(no vendor key exists here); `make_stt()` shows the AssemblyAI options S1
would use. Never logs spoken text, only ids and lengths.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time

import numpy as np
from livekit import rtc
from livekit.agents import (
    DEFAULT_API_CONNECT_OPTIONS,
    AgentServer,
    APIConnectOptions,
    AutoSubscribe,
    JobContext,
    JobProcess,
    JobRequest,
    cli,
    stt,
)
from livekit.agents.types import NOT_GIVEN, NotGivenOr
from livekit.agents.vad import VADEventType
from livekit.agents.worker import WorkerPermissions
from livekit.plugins import silero

AGENT_NAME = os.environ.get("MEETING_SCRIBE_AGENT_NAME", "uniwork-scribe")
AGENT_IDENTITY = "uw_agent_scribe"
ROOM_PREFIX = "uw_mtg_"
IDLE_CLOSE_S = float(os.environ.get("SCRIBE_IDLE_CLOSE_S", "30"))
CAPTION_TOPIC = "uw.caption"

log = logging.getLogger("scribe")


# --- STT ---------------------------------------------------------------------


class FakeSTT(stt.STT):
    """Deterministic streaming STT: one interim per 0.5 s of audio, a final on flush."""

    def __init__(self) -> None:
        super().__init__(capabilities=stt.STTCapabilities(streaming=True, interim_results=True))

    async def _recognize_impl(self, buffer, *, language, conn_options):  # noqa: ANN001
        raise NotImplementedError("streaming only")

    def stream(
        self,
        *,
        language: NotGivenOr[str] = NOT_GIVEN,
        conn_options: APIConnectOptions = DEFAULT_API_CONNECT_OPTIONS,
    ) -> stt.RecognizeStream:
        return _FakeStream(stt=self, conn_options=conn_options)


class _FakeStream(stt.RecognizeStream):
    async def _run(self) -> None:
        words, voiced_s = 0, 0.0
        async for data in self._input_ch:
            if isinstance(data, self._FlushSentinel):
                if words:
                    self._emit(stt.SpeechEventType.FINAL_TRANSCRIPT, words)
                    words, voiced_s = 0, 0.0
                continue
            # Only voiced audio makes "words", like a real STT: silence yields no text.
            if np.sqrt(np.mean(np.square(np.asarray(data.data, dtype=np.float32)))) > 300:
                voiced_s += data.duration
            if voiced_s >= 0.5:
                words, voiced_s = words + 1, 0.0
                self._emit(stt.SpeechEventType.INTERIM_TRANSCRIPT, words)
        # end_input() flushes before closing, so nothing is pending here.

    def _emit(self, kind: stt.SpeechEventType, words: int) -> None:
        text = " ".join(f"từ{i}" for i in range(1, words + 1))
        self._event_ch.send_nowait(
            stt.SpeechEvent(type=kind, alternatives=[stt.SpeechData(language="vi", text=text)])
        )


def make_stt(keyterms: list[str]) -> stt.STT:
    if os.environ.get("SCRIBE_STT_PROVIDER", "fake") != "assemblyai":
        return FakeSTT()
    from livekit.plugins import assemblyai  # only with a key; not exercised in S0

    return assemblyai.STT(
        model="universal-3-6-pro",  # 3.6 lists Vietnamese for streaming; see results doc
        language_codes=["vi", "en"],  # steer to vi with en code switching
        keyterms_prompt=keyterms[:100],  # plugin/API cap: 100 terms
        mode="max_accuracy",  # "for scribes/post-call" per plugin docstring
        voice_focus="near-field",  # A3 shared mic: "far-field" + speaker_labels=True
    )


# --- job ---------------------------------------------------------------------


async def on_request(req: JobRequest) -> None:
    try:
        meta = json.loads(req.job.metadata or "")
        ok = (
            isinstance(meta, dict)
            and meta.get("meeting_id")
            and meta.get("token")
            and req.room.name == ROOM_PREFIX + str(meta["meeting_id"])
        )
    except ValueError:
        ok = False
    if not ok:
        log.warning("reject job room=%s: invalid metadata", req.room.name)
        await req.reject()
        return
    await req.accept(
        identity=AGENT_IDENTITY, name="UniWork AI", attributes={"uw.kind": "scribe"}
    )


def prewarm(proc: JobProcess) -> None:
    proc.userdata["vad"] = silero.VAD.load()


server = AgentServer(
    setup_fnc=prewarm,
    port=int(os.environ.get("SCRIBE_HEALTH_PORT", "8091")),
    # Spec §4.1: subscribe + publish data, no audio/video, not hidden.
    permissions=WorkerPermissions(
        can_publish=False, can_subscribe=True, can_publish_data=True, can_update_metadata=False
    ),
)


@server.rtc_session(agent_name=AGENT_NAME, on_request=on_request)
async def entrypoint(ctx: JobContext) -> None:
    meta = json.loads(ctx.job.metadata)
    language = meta.get("locale", "vi")
    vad_model = ctx.proc.userdata["vad"]
    started: set[str] = set()

    async def on_participant(ctx: JobContext, p: rtc.RemoteParticipant) -> None:
        # Default kinds already exclude AGENT and EGRESS; the prefix guard is belt and braces.
        if p.identity.startswith("uw_agent_"):
            return

        def maybe_start(track: rtc.Track, pub: rtc.RemoteTrackPublication) -> None:
            if (
                track.kind == rtc.TrackKind.KIND_AUDIO
                and pub.source == rtc.TrackSource.SOURCE_MICROPHONE
                and track.sid not in started
            ):
                started.add(track.sid)
                asyncio.create_task(
                    transcribe_track(ctx.room, p, track, vad_model, language)
                )

        def on_sub(track: rtc.Track, pub: rtc.RemoteTrackPublication, who: rtc.RemoteParticipant) -> None:
            if who.identity == p.identity:
                maybe_start(track, pub)

        ctx.room.on("track_subscribed", on_sub)
        for pub in p.track_publications.values():
            if pub.track is not None:
                maybe_start(pub.track, pub)

    ctx.add_participant_entrypoint(on_participant)
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    log.info("joined room=%s meeting=%s", ctx.room.name, meta["meeting_id"])


async def transcribe_track(
    room: rtc.Room,
    p: rtc.RemoteParticipant,
    track: rtc.Track,
    vad_model: silero.VAD,
    language: str,
) -> None:
    """VAD → STT session (opened on speech, closed after IDLE_CLOSE_S silence) → captions."""
    audio = rtc.AudioStream(track, sample_rate=16000, num_channels=1)
    vad_stream = vad_model.stream()
    stt_impl = make_stt([])
    state = {"session": None, "drain": None, "speaking": False, "last_end": 0.0, "seg": 0,
             "preroll": None}
    sessions = 0

    async def publish(stream: stt.RecognizeStream) -> None:
        async for ev in stream:
            if ev.type not in (
                stt.SpeechEventType.INTERIM_TRANSCRIPT,
                stt.SpeechEventType.FINAL_TRANSCRIPT,
            ):
                continue
            final = ev.type == stt.SpeechEventType.FINAL_TRANSCRIPT
            # The segment counter lives on the track, not the session, so ids stay unique
            # across close/reopen.
            seg_id = f"{track.sid}-{state['seg'] + 1}"
            await room.local_participant.send_text(
                ev.alternatives[0].text,
                topic=CAPTION_TOPIC,
                attributes={
                    "uw.participant_identity": p.identity,
                    "uw.segment_id": seg_id,
                    "uw.final": "1" if final else "0",
                    "uw.language": ev.alternatives[0].language or language,
                    "uw.spike_emit_ns": str(int(ev.created_at * 1e9)),  # spike-only: latency
                },
            )
            if final:
                state["seg"] += 1
                log.info("final seg=%s chars=%d", seg_id, len(ev.alternatives[0].text))

    def open_session(preroll: list[rtc.AudioFrame]) -> None:
        nonlocal sessions
        sessions += 1
        s = stt_impl.stream()
        for f in preroll:
            s.push_frame(f)
        state["session"], state["drain"] = s, asyncio.create_task(publish(s))
        log.info("stt open track=%s session=%d", track.sid, sessions)

    async def close_session(reason: str) -> None:
        s, drain = state["session"], state["drain"]
        if s is None:
            return
        state["session"] = None
        s.end_input()  # AssemblyAI plugin: sends Terminate, keeps reading until the WS closes
        await drain  # every final of the old session is published before we go on
        await s.aclose()
        log.info("stt close track=%s reason=%s", track.sid, reason)

    async def vad_events() -> None:
        async for ev in vad_stream:
            if ev.type == VADEventType.START_OF_SPEECH:
                state["speaking"] = True
                if state["session"] is None:
                    state["preroll"] = ev.frames  # the frame loop opens it, never mid-close
            elif ev.type == VADEventType.END_OF_SPEECH:
                state["speaking"], state["last_end"] = False, time.monotonic()
                if state["session"] is not None:
                    state["session"].flush()  # fake STT finalises here; AssemblyAI endpoints itself

    vad_task = asyncio.create_task(vad_events())
    async for fe in audio:
        vad_stream.push_frame(fe.frame)
        if state["session"] is None and state["preroll"] is not None:
            open_session(state["preroll"])
            state["preroll"] = None
        s = state["session"]
        if s is None:
            continue
        if not state["speaking"] and time.monotonic() - state["last_end"] >= IDLE_CLOSE_S:
            await close_session("idle")
        else:
            s.push_frame(fe.frame)
    vad_stream.end_input()
    await vad_task
    await close_session("track ended")
    await audio.aclose()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    cli.run_app(server)
