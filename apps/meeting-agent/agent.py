"""uniwork-scribe: one LiveKit Agents job per meeting (spec
docs/superpowers/specs/2026-10-20-meeting-scribe-agent-design.md §4.1, ADR 0036).

Explicit dispatch only (agent_name set), so the worker never joins a room on
its own; the server dispatches it with a per-meeting uwma_ token. Per microphone
track: Silero VAD -> STT session -> captions on the uw.caption text stream and
finals in 2 s batches to /agent/segments. Never logs spoken text.
"""

from __future__ import annotations

import asyncio
import logging

import aiohttp
from livekit import rtc
from livekit.agents import AgentServer, AutoSubscribe, JobContext, JobProcess, JobRequest, cli
from livekit.agents.vad import VADEventType
from livekit.agents.worker import WorkerPermissions
from livekit.plugins import silero

from scribe import config
from scribe.api import ApiError, UniworkClient
from scribe.batcher import SegmentBatcher
from scribe.job import AGENT_IDENTITY, AGENT_NAME, parse_metadata, should_transcribe
from scribe.keyterms import build_keyterms
from scribe.stt import make_stt
from scribe.transcriber import Caption, TrackTranscriber

CAPTION_TOPIC = "uw.caption"
SETTINGS = config.load()
log = logging.getLogger("scribe")


async def on_request(req: JobRequest) -> None:
    if parse_metadata(req.job.metadata, req.room.name) is None:
        log.warning("reject job room=%s: invalid metadata", req.room.name)
        await req.reject()
        return
    await req.accept(identity=AGENT_IDENTITY, name=AGENT_NAME, attributes={"uw.kind": "scribe"})


def prewarm(proc: JobProcess) -> None:
    proc.userdata["vad"] = silero.VAD.load()


server = AgentServer(
    setup_fnc=prewarm,
    port=SETTINGS.health_port,
    load_threshold=0.7,
    # Spec §4.1: subscribe and publish data; no audio or video; visible in the room.
    permissions=WorkerPermissions(
        can_publish=False, can_subscribe=True, can_publish_data=True, can_update_metadata=False
    ),
)


@server.rtc_session(agent_name=SETTINGS.agent_name, on_request=on_request)
async def entrypoint(ctx: JobContext) -> None:
    meta = parse_metadata(ctx.job.metadata, ctx.room.name)
    if meta is None:
        return
    http = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15))
    client = UniworkClient(http, SETTINGS.api_url, meta["meeting_id"], meta["token"])
    batcher = SegmentBatcher(client.segments)
    transcribers: dict[str, TrackTranscriber] = {}
    tasks: set[asyncio.Task] = set()
    vad_model = ctx.proc.userdata["vad"]
    keyterms: list[str] = []

    async def publish(c: Caption) -> None:
        await ctx.room.local_participant.send_text(
            c.text,
            topic=CAPTION_TOPIC,
            # Captions are a sentence long; uncompressed, every web client reads them.
            compress=False,
            attributes={
                "uw.participant_identity": c.identity,
                "uw.segment_id": c.segment_id,
                "uw.final": "1" if c.final else "0",
                "uw.language": c.language,
            },
        )

    async def transcribe(p: rtc.RemoteParticipant, track: rtc.Track) -> None:
        t = TrackTranscriber(
            track_sid=track.sid,
            identity=p.identity,
            stt_impl=make_stt(SETTINGS.stt_provider, keyterms),
            publish=publish,
            on_final=lambda f: batcher.add(f.as_json()),
            idle_close_s=SETTINGS.idle_close_s,
            language=meta["locale"],
        )
        transcribers[track.sid] = t
        audio = rtc.AudioStream(track, sample_rate=16000, num_channels=1)
        vad_stream = vad_model.stream()

        async def vad_events() -> None:
            async for ev in vad_stream:
                if ev.type == VADEventType.START_OF_SPEECH:
                    t.on_vad_start(ev.frames)
                elif ev.type == VADEventType.END_OF_SPEECH:
                    t.on_vad_end(ev.speech_duration)

        vad_task = asyncio.create_task(vad_events())
        async for fe in audio:
            vad_stream.push_frame(fe.frame)
            await t.push(fe.frame)
        vad_stream.end_input()
        await vad_task
        await t.close()
        await audio.aclose()

    async def on_participant(_: JobContext, p: rtc.RemoteParticipant) -> None:
        kind = p.kind
        if not should_transcribe(
            p.identity,
            kind == rtc.ParticipantKind.PARTICIPANT_KIND_AGENT,
            kind == rtc.ParticipantKind.PARTICIPANT_KIND_EGRESS,
        ):
            return

        def maybe_start(track: rtc.Track, pub: rtc.RemoteTrackPublication) -> None:
            if (
                track.kind == rtc.TrackKind.KIND_AUDIO
                and pub.source == rtc.TrackSource.SOURCE_MICROPHONE
                and track.sid not in transcribers
            ):
                task = asyncio.create_task(transcribe(p, track))
                tasks.add(task)
                task.add_done_callback(tasks.discard)

        def on_sub(track: rtc.Track, pub: rtc.RemoteTrackPublication, who: rtc.RemoteParticipant) -> None:
            if who.identity == p.identity:
                maybe_start(track, pub)

        ctx.room.on("track_subscribed", on_sub)
        for pub in p.track_publications.values():
            if pub.track is not None:
                maybe_start(pub.track, pub)

    async def shutdown() -> None:
        for t in list(transcribers.values()):
            await t.close()
        await batcher.drain()
        session_ms = sum(t.session_ms for t in transcribers.values())
        try:
            await client.finished(session_ms)
        except Exception as e:  # noqa: BLE001 - the server's sweep closes the run anyway
            log.warning("finished not reported err=%s", type(e).__name__)
        await http.close()
        log.info("job done meeting=%s segments=%d stt_session_ms=%d", meta["meeting_id"], batcher.sent, session_ms)

    ctx.add_shutdown_callback(shutdown)
    try:
        context = await client.context()
        keyterms.extend(build_keyterms(context))
        await client.started()
    except ApiError as e:
        # 404: token or run no longer valid; 409: the run was closed (switched off).
        log.warning("leaving room=%s: server answered %d", ctx.room.name, e.status)
        ctx.shutdown(reason="run closed")
        return
    flusher = asyncio.create_task(batcher.run())
    tasks.add(flusher)
    ctx.add_participant_entrypoint(on_participant)
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    log.info("joined room=%s meeting=%s keyterms=%d", ctx.room.name, meta["meeting_id"], len(keyterms))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    cli.run_app(server)
