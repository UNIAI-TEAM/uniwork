"""The per-track loop with the fake STT: captions and finals for one speaker,
the STT session closed after the idle window and reopened on speech, segment
ids unique across sessions, and a turn cut by the close still finalised."""

import asyncio
from datetime import UTC, datetime

import numpy as np
from livekit import rtc

from scribe.stt import FakeSTT
from scribe.transcriber import Caption, Final, TrackTranscriber, start_once

RATE, FRAME = 16000, 160  # 10 ms frames


def frame(voiced: bool) -> rtc.AudioFrame:
    samples = np.full(FRAME, 3000 if voiced else 0, dtype=np.int16)
    return rtc.AudioFrame(samples.tobytes(), RATE, 1, FRAME)


class Clock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


def make(clock: Clock, idle: float = 30.0, job: str = "AJ_1", stt_impl=None):
    captions: list[Caption] = []
    finals: list[Final] = []

    async def publish(c: Caption) -> None:
        captions.append(c)

    t = TrackTranscriber(
        segment_prefix=f"{job}-TR_a",
        identity="uw_participant_p1",
        stt_impl=stt_impl or FakeSTT(),
        publish=publish,
        on_final=finals.append,
        idle_close_s=idle,
        clock=clock,
        wall=lambda: datetime(2026, 10, 20, 2, 0, tzinfo=UTC),
    )
    return t, captions, finals


async def speak(t: TrackTranscriber, clock: Clock, seconds: float) -> None:
    t.on_vad_start([frame(True)])
    for _ in range(int(seconds * 100)):
        await t.push(frame(True))
        clock.t += 0.01
    t.on_vad_end(seconds)
    await asyncio.sleep(0.05)  # let the session task publish the final


async def test_captions_and_finals_for_one_speaker():
    clock = Clock()
    t, captions, finals = make(clock)
    await speak(t, clock, 1.6)
    assert t.open and t.sessions == 1
    assert [c.final for c in captions] == [False, False, False, True]
    assert {c.segment_id for c in captions} == {"AJ_1-TR_a-1"}
    assert all(c.identity == "uw_participant_p1" and c.language == "vi" for c in captions)
    assert len(finals) == 1
    f = finals[0]
    assert f.segment_id == "AJ_1-TR_a-1" and f.text == "từ1 từ2 từ3" and f.speech_ms == 1600
    assert f.as_json()["spoken_at"] == "2026-10-20T02:00:00.000+00:00"
    await t.close()


async def test_closes_after_idle_and_reopens_on_speech():
    clock = Clock()
    t, captions, finals = make(clock)
    await speak(t, clock, 1.0)
    clock.t += 29.0
    await t.push(frame(False))
    assert t.open  # still inside the idle window
    clock.t += 1.5
    await t.push(frame(False))
    assert not t.open and t.session_ms > 0
    await t.push(frame(False))
    assert t.sessions == 1  # silence alone never opens a session
    await speak(t, clock, 0.6)
    assert t.sessions == 2
    assert [f.segment_id for f in finals] == ["AJ_1-TR_a-1", "AJ_1-TR_a-2"]
    await t.close()


async def test_close_mid_turn_still_delivers_the_final():
    clock = Clock()
    t, captions, finals = make(clock)
    t.on_vad_start([frame(True)])
    for _ in range(120):
        await t.push(frame(True))
        clock.t += 0.01
    await t.close()  # the participant left mid-sentence
    # end_input flushes the session, so the cut turn still comes out as a final (S0 boundary_check).
    assert [f.text for f in finals] == ["từ1 từ2"]
    assert captions[-1].final and captions[-1].segment_id == "AJ_1-TR_a-1"


async def test_caption_publish_failure_still_delivers_the_final():
    """Review R5 M3: at shutdown the room disconnects before the transcribers
    close, so the caption of the cut turn cannot be sent; its final must still
    reach the server, and the session must not count as failed."""
    clock = Clock()
    finals: list[Final] = []
    disconnected = False

    async def publish(c: Caption) -> None:
        if disconnected:
            raise RuntimeError("room disconnected")

    t = TrackTranscriber(
        segment_prefix="AJ-TR", identity="p", stt_impl=FakeSTT(), publish=publish, on_final=finals.append, clock=clock
    )
    t.on_vad_start([frame(True)])
    for _ in range(120):
        await t.push(frame(True))
        clock.t += 0.01
    disconnected = True
    await t.close()
    assert [f.text for f in finals] == ["từ1 từ2"]
    assert t.failures == 0


async def test_one_transcriber_per_track_when_the_track_is_announced_twice():
    """Review R5 M1: a rejoin leaves the first join's track_subscribed listener
    behind, so one track is announced twice in one dispatch, before any task runs."""
    transcribers: dict[str, object] = {}
    tasks: set[asyncio.Task] = set()
    made: list[object] = []
    ran: list[object] = []

    def make_one() -> object:
        made.append(object())
        return made[-1]

    async def run(t: object) -> None:
        ran.append(t)

    start_once(transcribers, tasks, "TR_a", make_one, run)
    start_once(transcribers, tasks, "TR_a", make_one, run)
    await asyncio.gather(*tasks)
    assert len(made) == 1 and ran == made and transcribers == {"TR_a": made[0]}


async def test_segment_ids_are_unique_across_jobs_on_the_same_track():
    """Review item 2: a later run's job on the same track must not reuse ids."""
    ids = []
    for job in ("AJ_first", "AJ_second"):
        clock = Clock()
        t, _, finals = make(clock, job=job)
        await speak(t, clock, 0.6)
        await t.close()
        ids += [f.segment_id for f in finals]
    assert ids == ["AJ_first-TR_a-1", "AJ_second-TR_a-1"]
    assert all(len(i) < 128 for i in ids)


async def test_idle_session_closes_without_frames():
    """Review item 9: a muted track sends no frames; tick closes the session."""
    clock = Clock()
    t, _, _ = make(clock)
    await speak(t, clock, 0.6)
    assert t.open
    clock.t += 29
    await t.tick()
    assert t.open
    clock.t += 2
    await t.tick()
    assert not t.open
    await t.close()


class FlakySTT(FakeSTT):
    """Its first session fails when read (a vendor socket that drops), the next works."""

    def __init__(self) -> None:
        super().__init__()
        self.streams = 0

    def stream(self, **kw):  # noqa: ANN003
        self.streams += 1
        s = super().stream(**kw)
        if self.streams == 1:

            async def fail(_self):  # noqa: ANN001
                raise RuntimeError("vendor socket closed")

            s.__class__ = type("FailingStream", (s.__class__,), {"__anext__": fail})
        return s


async def test_stt_failure_drops_the_session_and_reopens_after_backoff():
    """Review item 3: one STT failure does not end the track."""
    clock = Clock()
    stt_impl = FlakySTT()
    t, _, finals = make(clock, stt_impl=stt_impl)
    t.on_vad_start([frame(True)])
    await t.push(frame(True))
    await asyncio.sleep(0.05)  # the reader hits the failure
    assert t.failures == 1
    await t.push(frame(True))  # drops the dead session, schedules the retry
    assert not t.open
    t.on_vad_start([frame(True)])
    await t.push(frame(True))
    assert not t.open  # still inside the backoff
    clock.t += 1.5
    await speak(t, clock, 0.6)
    assert stt_impl.streams == 2
    assert [f.text for f in finals] == ["từ1"]
    await t.close()


async def test_shared_mic_reopens_the_session_with_speaker_labels():
    """Spec §4.3: the attribute turns on, the open session closes, and the next
    one diarizes; every final then carries <identity>:<session>:<label>, "?"
    for a line the vendor could not attribute. Turning it off stops that."""
    clock = Clock()
    t, _, finals = make(clock)
    await speak(t, clock, 1.0)
    assert t.open and t.sessions == 1
    await t.set_stt(FakeSTT(diarize=True), diarize=True)
    assert not t.open  # the plain session closed at once
    await speak(t, clock, 1.6)  # a long turn: the fake labels it A
    await speak(t, clock, 0.6)  # a short one: no label
    assert t.sessions == 2
    assert [f.speaker_label for f in finals] == [
        "",
        "uw_participant_p1:AJ_1-TR_a-2:A",
        "uw_participant_p1:AJ_1-TR_a-2:?",
    ]
    assert "speaker_label" not in finals[0].as_json()
    assert finals[1].as_json()["speaker_label"] == "uw_participant_p1:AJ_1-TR_a-2:A"
    await t.set_stt(FakeSTT(), diarize=False)
    await speak(t, clock, 1.6)
    assert t.sessions == 3 and finals[-1].speaker_label == ""
    await t.close()


async def test_shared_mic_switched_mid_sentence_keeps_listening():
    clock = Clock()
    t, _, finals = make(clock)
    t.on_vad_start([frame(True)])
    for _ in range(60):
        await t.push(frame(True))
        clock.t += 0.01
    await t.set_stt(FakeSTT(diarize=True), diarize=True)
    for _ in range(120):
        await t.push(frame(True))
        clock.t += 0.01
    t.on_vad_end(1.8)
    await asyncio.sleep(0.05)
    assert t.sessions == 2
    assert finals[-1].speaker_label == "uw_participant_p1:AJ_1-TR_a-2:A"
    await t.close()


async def test_shared_mic_session_rides_out_pauses_up_to_five_minutes():
    """Review: a diarized session closes after 300 s of silence, not 30 s, so
    one pause does not start a new set of speakers to name."""
    clock = Clock()
    t, _, _ = make(clock)
    await t.set_stt(FakeSTT(diarize=True), diarize=True)
    await speak(t, clock, 1.0)
    clock.t += 60.0
    await t.tick()
    assert t.open  # a plain track would have closed at 30 s
    clock.t += 240.0
    await t.tick()
    assert not t.open
    await t.set_stt(FakeSTT(), diarize=False)
    await speak(t, clock, 1.0)
    clock.t += 31.0
    await t.tick()
    assert not t.open  # back to the 30 s rule
    await t.close()


def errors(reason: str) -> float:
    from scribe import metrics

    return metrics.STT_ERRORS.labels(reason=reason)._value.get()


async def test_failure_reason_tells_the_session_limit_from_other_failures():
    """Benchmark #13: AssemblyAI closes with 1008 (or answers 429) past the
    new-sessions-per-minute limit; the plugin wraps it after its retries."""
    import aiohttp
    from livekit.agents import APIConnectionError, APIStatusError

    from scribe.transcriber import failure_reason

    def wrapped(inner: Exception) -> Exception:
        try:
            raise APIConnectionError("failed to recognize speech after 3 attempts") from inner
        except APIConnectionError as e:
            return e

    assert failure_reason(wrapped(APIStatusError("closed", status_code=1008))) == "session_limit"
    handshake = aiohttp.WSServerHandshakeError(None, (), status=429, message="Too Many Requests")  # type: ignore[arg-type]
    assert failure_reason(wrapped(handshake)) == "session_limit"
    assert failure_reason(wrapped(APIStatusError("closed", status_code=1011))) == "stream"
    assert failure_reason(RuntimeError("socket")) == "stream"


async def test_speech_during_a_refused_session_and_its_backoff_is_replayed():
    """Benchmark #13: a refused open no longer loses the turn. The audio sent
    to the dead session and the audio heard during the backoff go into the
    next session, so the final carries every word."""
    from scribe.health import SttHealth

    clock = Clock()
    stt_impl = FlakySTT()
    health = SttHealth(clock=clock)
    finals: list[Final] = []

    async def publish(c: Caption) -> None:
        pass

    t = TrackTranscriber(
        segment_prefix="AJ-TR",
        identity="p",
        stt_impl=stt_impl,
        publish=publish,
        on_final=finals.append,
        clock=clock,
        health=health,
        rand=lambda: 1.0,
    )
    before = errors("stream")
    opened_before = __import__("scribe.metrics", fromlist=["x"]).STT_SESSIONS._value.get()
    t.on_vad_start([frame(True)])
    await t.push(frame(True))
    await asyncio.sleep(0.05)  # the vendor refuses the session
    assert t.failures == 1 and errors("stream") == before + 1
    assert health.state() == "ok"  # not yet 20 s
    for _ in range(150):  # 1.5 s of speech: the drop, the 1 s backoff, the reopening
        await t.push(frame(True))
        clock.t += 0.01
    t.on_vad_end(1.52)
    await asyncio.sleep(0.05)
    assert stt_impl.streams == 2
    assert [f.text for f in finals] == ["từ1 từ2 từ3"]
    assert __import__("scribe.metrics", fromlist=["x"]).STT_SESSIONS._value.get() == opened_before + 2
    await t.close()


async def test_the_backoff_buffer_is_bounded():
    from scribe.transcriber import BUFFER_MAX_S

    clock = Clock()
    t, _, _ = make(clock, stt_impl=FlakySTT())
    t.on_vad_start([frame(True)])
    await t.push(frame(True))
    await asyncio.sleep(0.05)
    t._retry_s = 1000.0  # a long backoff
    await t.push(frame(True))  # the drop; this frame is buffered
    t._retry_at = clock.t + 1000
    for _ in range(int(BUFFER_MAX_S * 100) + 500):
        await t.push(frame(True))
    assert t._preroll is not None
    assert abs(t._preroll.seconds - BUFFER_MAX_S) < 0.02
    await t.close()


async def test_retry_is_jittered():
    clock = Clock()
    t, _, _ = make(clock, stt_impl=FlakySTT())
    t._rand = lambda: 0.0  # the low end: half the backoff
    t.on_vad_start([frame(True)])
    await t.push(frame(True))
    await asyncio.sleep(0.05)
    await t.push(frame(True))
    assert t._retry_at == clock.t + 0.5
    await t.close()


async def test_a_failed_push_counts_as_an_stt_error_and_marks_health():
    from scribe.health import SttHealth

    class BrokenPush(FakeSTT):
        def stream(self, **kw):  # noqa: ANN003
            s = super().stream(**kw)

            def boom(_self, _f):  # noqa: ANN001
                raise RuntimeError("closed")

            s.__class__ = type("BrokenPushStream", (s.__class__,), {"push_frame": boom})
            return s

    clock = Clock()
    health = SttHealth(clock=clock)
    finals: list[Final] = []

    async def publish(c: Caption) -> None:
        pass

    before = errors("push")
    t = TrackTranscriber(
        segment_prefix="AJ-TR",
        identity="p",
        stt_impl=BrokenPush(),
        publish=publish,
        on_final=finals.append,
        clock=clock,
        health=health,
    )
    t.on_vad_start([])
    await t.push(frame(True))
    assert errors("push") == before + 1
    clock.t += 20
    assert health.state() == "ok"  # one failure, then nothing: not proof of an outage
    await t.push(frame(True))  # drops the dead session; the backoff starts
    clock.t += 2
    await t.push(frame(True))  # the retry fails too, 22 s after the first
    assert errors("push") == before + 2
    assert health.state() == "degraded"
    await t.close()


async def test_a_transcript_marks_health_ok():
    from scribe.health import SttHealth

    clock = Clock()
    health = SttHealth(clock=clock)
    health.failed()
    clock.t += 30
    finals: list[Final] = []

    async def publish(c: Caption) -> None:
        pass

    t = TrackTranscriber(
        segment_prefix="AJ-TR",
        identity="p",
        stt_impl=FakeSTT(),
        publish=publish,
        on_final=finals.append,
        clock=clock,
        health=health,
    )
    await speak(t, clock, 0.6)
    assert health.state() == "ok"
    await t.close()


async def test_speech_heard_while_degraded_is_not_replayed():
    """Review: while the meeting is degraded every client writes its own device
    captions into the transcript; replaying that audio into the next session
    would store the same words twice. Audio buffered before the fallback is
    still replayed."""
    from scribe.health import SttHealth

    clock = Clock()
    stt_impl = FlakySTT()
    health = SttHealth(clock=clock)
    finals: list[Final] = []

    async def publish(c: Caption) -> None:
        pass

    t = TrackTranscriber(
        segment_prefix="AJ-TR",
        identity="p",
        stt_impl=stt_impl,
        publish=publish,
        on_final=finals.append,
        clock=clock,
        health=health,
        rand=lambda: 1.0,
    )
    t.on_vad_start([frame(True)])
    for _ in range(40):  # 0.4 s of speech go to the session the vendor drops
        await t.push(frame(True))
    await asyncio.sleep(0.05)
    assert t.failures == 1
    health.failed()
    clock.t += 20
    health.failed()  # other tracks kept failing: the room fell back to device captions
    assert health.state() == "degraded"
    for _ in range(150):  # 1.5 s heard while degraded, through the backoff and the reopening
        await t.push(frame(True))
        clock.t += 0.01
    t.on_vad_end(1.9)
    await asyncio.sleep(0.05)
    assert stt_impl.streams == 2
    # 0.41 s from before the fallback plus 0.5 s heard live after the reopening
    # make one 0.5 s word; replaying the 1 s of the backoff would make three.
    assert [f.text for f in finals] == ["từ1"]
    await t.close()
