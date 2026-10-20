"""The per-track loop with the fake STT: captions and finals for one speaker,
the STT session closed after the idle window and reopened on speech, segment
ids unique across sessions, and a turn cut by the close still finalised."""

import asyncio
from datetime import UTC, datetime

import numpy as np
from livekit import rtc

from scribe.stt import FakeSTT
from scribe.transcriber import Caption, Final, TrackTranscriber

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
