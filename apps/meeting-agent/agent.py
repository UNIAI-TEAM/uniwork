"""uniwork-scribe: one LiveKit Agents job per meeting (spec
docs/superpowers/specs/2026-10-20-meeting-scribe-agent-design.md §4.1, ADR 0037).

Explicit dispatch only (agent_name set), so the worker never joins a room on
its own; the server dispatches it with a per-meeting uwma_ token. Per microphone
track: Silero VAD -> STT session -> captions on the uw.caption text stream and
finals in 2 s batches to /agent/segments; live action items through
/agent/extract on the §4.4 cadence. Never logs spoken text.
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

from scribe import config, metrics
from scribe.api import ApiError, UniworkClient
from scribe.batcher import SegmentBatcher
from scribe.extract import ExtractCadence
from scribe.job import (
    AGENT_IDENTITY,
    AGENT_NAME,
    SHARED_MIC_ATTR,
    parse_metadata,
    reports_finished,
    shared_mic,
    should_transcribe,
)
from scribe.keyterms import build_keyterms, refresh_keyterms
from scribe.stt import make_stt
from scribe.tracing import setup_tracing
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
    setup_tracing()  # per job process; a no-op without OTEL_EXPORTER_OTLP_ENDPOINT


server = AgentServer(
    setup_fnc=prewarm,
    port=SETTINGS.health_port,
    load_threshold=0.7,
    num_idle_processes=SETTINGS.idle_processes,
    drain_timeout=SETTINGS.drain_timeout_s,
    prometheus_port=SETTINGS.metrics_port,
    prometheus_multiproc_dir=SETTINGS.metrics_dir,
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

    async def extract() -> None:
        # The server reads what it stored: send the queued finals first.
        await batcher.flush()
        out = await client.extract()
        log.info("extract created=%s skipped=%s", out.get("created"), out.get("skipped", ""))

    cadence = ExtractCadence(extract)
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
        diarize = shared_mic(p.attributes)
        t = TrackTranscriber(
            # The job id keeps segment ids unique across the runs of one meeting.
            segment_prefix=f"{ctx.job.id}-{track.sid}",
            identity=p.identity,
            stt_impl=make_stt(SETTINGS.stt_provider, keyterms, diarize=diarize),
            publish=publish,
            on_final=lambda f: (batcher.add(f.as_json()), cadence.on_final()),
            idle_close_s=SETTINGS.idle_close_s,
            language=meta["locale"],
            diarize=diarize,
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

        async def idle_ticks() -> None:
            while True:
                await asyncio.sleep(1)
                await t.tick()

        vad_task = asyncio.create_task(vad_events())
        tick_task = asyncio.create_task(idle_ticks())
        try:
            async for fe in audio:
                vad_stream.push_frame(fe.frame)
                await t.push(fe.frame)
        finally:
            tick_task.cancel()
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
        # Spec §4.2: the newcomer's name joins the keyterms before their streams open.
        await refresh_keyterms(client.context, keyterms)
        for t in transcribers.values():
            t.update_keyterms(keyterms)

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

    def on_attributes(changed: dict[str, str], p: rtc.Participant) -> None:
        # Spec §4.3: the server set or cleared uw.shared_mic; reopen that
        # participant's streams with or without diarization.
        if SHARED_MIC_ATTR not in changed:
            return
        diarize = shared_mic(p.attributes)
        for t in list(transcribers.values()):
            if t.identity == p.identity:
                task = asyncio.create_task(
                    t.set_stt(make_stt(SETTINGS.stt_provider, keyterms, diarize=diarize), diarize=diarize)
                )
                tasks.add(task)
                task.add_done_callback(tasks.discard)
        log.info("shared mic identity=%s on=%s", p.identity, diarize)

    ctx.room.on("participant_attributes_changed", on_attributes)

    disconnect: dict[str, str | None] = {"reason": None}

    def on_disconnected(reason: rtc.DisconnectReason.ValueType) -> None:
        disconnect["reason"] = rtc.DisconnectReason.Name(reason)

    ctx.room.on("disconnected", on_disconnected)

    async def shutdown() -> None:
        metrics.JOBS_RUNNING.dec()
        for t in list(transcribers.values()):
            await t.close()
        await batcher.drain()
        await cadence.final()
        session_ms = sum(t.session_ms for t in transcribers.values())
        if not reports_finished(disconnect["reason"]):
            log.info("replaced by another connection; the run is not ours to finish")
        else:
            try:
                await client.finished(session_ms)
            except Exception as e:  # noqa: BLE001 - the server's sweep closes the run anyway
                log.warning("finished not reported err=%s", type(e).__name__)
        await http.close()
        log.info("job done meeting=%s segments=%d stt_session_ms=%d", meta["meeting_id"], batcher.sent, session_ms)

    metrics.JOBS_RUNNING.inc()
    ctx.add_shutdown_callback(shutdown)
    try:
        context = await client.context()
        keyterms.extend(build_keyterms(context))
    except ApiError as e:
        # 404: token or run no longer valid; 409: the run was closed (switched off).
        log.warning("leaving room=%s: server answered %d", ctx.room.name, e.status)
        ctx.shutdown(reason="run closed")
        return
    flusher = asyncio.create_task(batcher.run())
    tasks.add(flusher)

    async def extract_ticks() -> None:
        while True:
            await asyncio.sleep(1)
            await cadence.tick()

    extractor = asyncio.create_task(extract_ticks())
    tasks.add(extractor)
    ctx.add_participant_entrypoint(on_participant)
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    try:
        # After connect: the server records this connection's SID, and only its
        # participant_left closes the run.
        await client.started(ctx.room.local_participant.sid)
    except ApiError as e:
        log.warning("leaving room=%s: server answered %d", ctx.room.name, e.status)
        ctx.shutdown(reason="run closed")
        return
    log.info("joined room=%s meeting=%s keyterms=%d", ctx.room.name, meta["meeting_id"], len(keyterms))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    cli.run_app(server)
