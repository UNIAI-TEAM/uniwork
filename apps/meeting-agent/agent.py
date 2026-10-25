"""uniwork-scribe: one LiveKit Agents job per meeting (spec
docs/superpowers/specs/2026-10-20-meeting-scribe-agent-design.md §4.1, ADR 0045).

Explicit dispatch only (agent_name set), so the worker never joins a room on
its own; the server dispatches it with a per-meeting uwma_ token. Per microphone
track: Silero VAD -> STT session -> captions on the uw.caption text stream and
finals in 2 s batches to /agent/segments; live action items through
/agent/extract on the §4.4 cadence. A phone caller the host admits hears the
spoken scribe notice, alone (scribe/notice.py). Never logs spoken text.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import math

import aiohttp
from livekit import rtc
from livekit.agents import AgentServer, AutoSubscribe, JobContext, JobProcess, JobRequest, cli
from livekit.agents.vad import VADEventType
from livekit.agents.worker import ServerEnvOption, WorkerPermissions
from livekit.plugins import silero
from livekit.protocol import models

from scribe import config, metrics
from scribe.api import ApiError, UniworkClient
from scribe.batcher import SegmentBatcher
from scribe.extract import ExtractCadence
from scribe.health import StatePublisher, SttHealth
from scribe.job import (
    AGENT_IDENTITY,
    AGENT_NAME,
    SHARED_MIC_ATTR,
    parse_metadata,
    reports_finished,
    shared_mic,
    should_transcribe,
)
from scribe.keyterms import KeytermRefresher, build_keyterms
from scribe.notice import NOTICE_PATH, NoticeLedger, frames_of, read_notice
from scribe.stt import make_stt
from scribe.tracing import setup_tracing
from scribe.transcriber import Caption, Final, TrackTranscriber, start_once, stop_track
from scribe.translate import CaptionTranslator, wanted_languages

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
    # Production refuses jobs past 70% CPU; `dev` shares a laptop with the app
    # and would turn every meeting away, so there it takes them all.
    load_threshold=ServerEnvOption(dev_default=math.inf, prod_default=0.7),
    # A job joins only once its process has loaded the VAD and the RTC
    # library. On a busy host that outlasted the library's 10 s, every spawn
    # was killed and the scribe walked in minutes late, on the server's
    # re-dispatch. One warm process in `dev` too, as production keeps four.
    initialize_process_timeout=30.0,
    num_idle_processes=ServerEnvOption(dev_default=1, prod_default=4),
    drain_timeout=SETTINGS.drain_timeout_s,
    # The shutdown callbacks (flush, closing extract, /agent/finished) get the
    # 120 s the chart leaves between drain_timeout and the pod's grace period.
    shutdown_process_timeout=110,
    prometheus_port=SETTINGS.metrics_port,
    prometheus_multiproc_dir=SETTINGS.metrics_dir,
    # Spec §4.1: subscribe and publish data; visible in the room. Audio only
    # for the phone callers' notice (UNI-1995 access): microphone source, a
    # track only the caller being told may subscribe to; never video.
    # can_update_metadata: the agent's own uw.scribe_state attribute
    # (benchmark #1); it never writes anyone else's.
    permissions=WorkerPermissions(
        can_publish=True,
        can_subscribe=True,
        can_publish_data=True,
        can_update_metadata=True,
        can_publish_sources=[models.TrackSource.MICROPHONE],
    ),
)


@server.rtc_session(agent_name=SETTINGS.agent_name, on_request=on_request)
async def entrypoint(ctx: JobContext) -> None:
    meta = parse_metadata(ctx.job.metadata, ctx.room.name)
    if meta is None:
        return
    http = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15))
    client = UniworkClient(http, SETTINGS.api_url, meta["meeting_id"], meta["token"])
    # A 404 mid-meeting: this run's token is no longer valid; leave so the sweep sends a fresh run.
    batcher = SegmentBatcher(client.segments, on_gone=lambda: ctx.shutdown(reason="run gone"))
    health = SttHealth()

    async def extract() -> None:
        # The server reads what it stored: send the queued finals first.
        await batcher.flush()
        out = await client.extract()
        log.info("extract created=%s skipped=%s", out.get("created"), out.get("skipped", ""))

    cadence = ExtractCadence(extract)
    transcribers: dict[str, TrackTranscriber] = {}
    tasks: set[asyncio.Task] = set()
    # Each track's transcribe task, and the transcribers of tracks that left (their STT time still counts).
    running: dict[str, asyncio.Task] = {}
    ended: list[TrackTranscriber] = []
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

    async def publish_translation(lang: str, f: Final, text: str) -> None:
        await ctx.room.local_participant.send_text(
            text,
            topic=f"{CAPTION_TOPIC}.{lang}",
            compress=False,
            attributes={
                "uw.participant_identity": f.identity,
                "uw.segment_id": f.segment_id,
                "uw.final": "1",
                "uw.language": lang,
            },
        )

    async def publish_skip(lang: str, finals: list[Final], reason: str) -> None:
        # No uw.segment_id: the room reads this as why those lines stay in the original.
        await ctx.room.local_participant.send_text(
            reason,
            topic=f"{CAPTION_TOPIC}.{lang}",
            compress=False,
            attributes={"uw.skipped": reason, "uw.segment_ids": ",".join(f.segment_id for f in finals)},
        )

    # Spec §5.3: the languages the people in the room picked (server-set attribute).
    translator = CaptionTranslator(
        client.translate,
        publish_translation,
        lambda: wanted_languages(p.attributes for p in ctx.room.remote_participants.values()),
        skip=publish_skip,
    )

    def on_final(f: Final) -> None:
        batcher.add(f.as_json())
        cadence.on_final()
        translator.add(f)

    def new_transcriber(p: rtc.RemoteParticipant, track: rtc.Track) -> TrackTranscriber:
        diarize = shared_mic(p.attributes)
        return TrackTranscriber(
            # The job id keeps segment ids unique across the runs of one meeting.
            segment_prefix=f"{ctx.job.id}-{track.sid}",
            identity=p.identity,
            stt_impl=make_stt(SETTINGS.stt_provider, keyterms, diarize=diarize, base_url=SETTINGS.stt_base_url),
            publish=publish,
            on_final=on_final,
            idle_close_s=SETTINGS.idle_close_s,
            language=meta["locale"],
            diarize=diarize,
            health=health,
        )

    async def transcribe(t: TrackTranscriber, track: rtc.Track) -> None:
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

    def apply_keyterms(terms: list[str]) -> None:
        for t in transcribers.values():
            t.update_keyterms(terms)

    keyterm_refresh = KeytermRefresher(client.context, keyterms, apply_keyterms)

    async def on_participant(_: JobContext, p: rtc.RemoteParticipant) -> None:
        kind = p.kind
        if not should_transcribe(
            p.identity,
            kind == rtc.ParticipantKind.PARTICIPANT_KIND_AGENT,
            kind == rtc.ParticipantKind.PARTICIPANT_KIND_EGRESS,
        ):
            return
        # A caller admitted before the scribe joined is told now.
        maybe_notice(p)
        # Spec §4.2: the newcomer's name joins the keyterms; the read runs in
        # the background so their streams open now, and reaches them when it lands.
        keyterm_refresh.request()

        def maybe_start(track: rtc.Track, pub: rtc.RemoteTrackPublication) -> None:
            if track.kind == rtc.TrackKind.KIND_AUDIO and pub.source == rtc.TrackSource.SOURCE_MICROPHONE:
                task = start_once(
                    transcribers, tasks, track.sid, lambda: new_transcriber(p, track), lambda t: transcribe(t, track)
                )
                if task is not None:
                    running[track.sid] = task

        def on_sub(track: rtc.Track, pub: rtc.RemoteTrackPublication, who: rtc.RemoteParticipant) -> None:
            if who.identity == p.identity:
                maybe_start(track, pub)

        ctx.room.on("track_subscribed", on_sub)
        for pub in p.track_publications.values():
            if pub.track is not None:
                maybe_start(pub.track, pub)

    def stop(sid: str) -> None:
        if (t := stop_track(transcribers, running, sid)) is not None:
            ended.append(t)

    def on_left(p: rtc.RemoteParticipant) -> None:
        # The SDK drops the participant before any per-track event can name its tracks.
        for sid in [sid for sid, t in transcribers.items() if t.identity == p.identity]:
            stop(sid)

    # A track that leaves must close its stream (stop_track): a reload otherwise captions every line twice.
    ctx.room.on("track_unsubscribed", lambda track, _pub, _who: stop(track.sid))
    ctx.room.on("track_unpublished", lambda pub, _who: stop(pub.sid))
    ctx.room.on("participant_disconnected", on_left)

    def on_attributes(changed: dict[str, str], p: rtc.Participant) -> None:
        # Spec §4.3: the server set or cleared uw.shared_mic; reopen that
        # participant's streams with or without diarization.
        if SHARED_MIC_ATTR not in changed:
            return
        diarize = shared_mic(p.attributes)
        for t in list(transcribers.values()):
            if t.identity == p.identity:
                task = asyncio.create_task(
                    t.set_stt(
                        make_stt(SETTINGS.stt_provider, keyterms, diarize=diarize, base_url=SETTINGS.stt_base_url),
                        diarize=diarize,
                    )
                )
                tasks.add(task)
                task.add_done_callback(tasks.discard)
        log.info("shared mic identity=%s on=%s", p.identity, diarize)

    ctx.room.on("participant_attributes_changed", on_attributes)

    # UNI-1995 access (#2): an admitted phone caller hears the notice, alone.
    # One at a time: the subscription permission is per publisher, not per track.
    notices = NoticeLedger()
    notice_lock = asyncio.Lock()

    async def play_notice(identity: str) -> None:
        async with notice_lock:
            lp = ctx.room.local_participant
            pub = None
            try:
                rate, channels, pcm = read_notice(NOTICE_PATH)
                source = rtc.AudioSource(rate, channels)
                track = rtc.LocalAudioTrack.create_audio_track("uw-scribe-notice", source)
                only = rtc.ParticipantTrackPermission(participant_identity=identity, allow_all=True)
                lp.set_track_subscription_permissions(allow_all_participants=False, participant_permissions=[only])
                pub = await lp.publish_track(track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE))
                await asyncio.sleep(1)  # the caller's SIP leg subscribes
                per = rate // 100
                for chunk in frames_of(pcm, rate, channels):
                    await source.capture_frame(rtc.AudioFrame(chunk, rate, channels, per))
                await source.wait_for_playout()
                log.info("notice played identity=%s", identity)
            except Exception as e:  # noqa: BLE001 - a failed notice must not end the job
                notices.failed(identity)
                log.warning("notice not played identity=%s err=%s", identity, type(e).__name__)
            finally:
                if pub is not None:
                    with contextlib.suppress(Exception):
                        await lp.unpublish_track(pub.sid)

    def maybe_notice(p: rtc.Participant) -> None:
        if notices.due(p.identity, getattr(p, "kind", None) == rtc.ParticipantKind.PARTICIPANT_KIND_SIP, p.attributes):
            task = asyncio.create_task(play_notice(p.identity))
            tasks.add(task)
            task.add_done_callback(tasks.discard)

    ctx.room.on("participant_attributes_changed", lambda _changed, p: maybe_notice(p))

    disconnect: dict[str, str | None] = {"reason": None}
    extractor: dict[str, asyncio.Task | None] = {"task": None}
    translating: dict[str, asyncio.Task | None] = {"task": None}

    def on_disconnected(reason: rtc.DisconnectReason.ValueType) -> None:
        disconnect["reason"] = rtc.DisconnectReason.Name(reason)

    ctx.room.on("disconnected", on_disconnected)

    async def shutdown() -> None:
        metrics.JOBS_RUNNING.dec()
        # Stop the translate loop first, so no call starts after close() drops those in flight.
        if (task := translating["task"]) is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        await translator.close()
        for t in list(transcribers.values()):
            await t.close()
        await batcher.drain()
        # Cancel the tick loop (and a call it has in flight) and await it before
        # the closing extract, so the two never overlap.
        if (task := extractor["task"]) is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        await cadence.final()
        session_ms = sum(t.session_ms for t in [*transcribers.values(), *ended])
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

    extractor["task"] = asyncio.create_task(extract_ticks())
    tasks.add(extractor["task"])

    async def translate_ticks() -> None:
        while True:
            await asyncio.sleep(0.2)
            await translator.tick()

    translating["task"] = asyncio.create_task(translate_ticks())
    tasks.add(translating["task"])

    # Benchmark #1: the room learns when STT is down, and its clients fall back to device captions.
    state = StatePublisher(health, lambda attrs: ctx.room.local_participant.set_attributes(attrs))

    async def health_ticks() -> None:
        while True:
            await asyncio.sleep(1)
            await state.tick()

    tasks.add(asyncio.create_task(health_ticks()))
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
