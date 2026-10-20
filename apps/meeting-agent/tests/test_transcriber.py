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


def make(clock: Clock, idle: float = 30.0):
    captions: list[Caption] = []
    finals: list[Final] = []

    async def publish(c: Caption) -> None:
        captions.append(c)

    t = TrackTranscriber(
        track_sid="TR_a",
        identity="uw_participant_p1",
        stt_impl=FakeSTT(),
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
    assert {c.segment_id for c in captions} == {"TR_a-1"}
    assert all(c.identity == "uw_participant_p1" and c.language == "vi" for c in captions)
    assert len(finals) == 1
    f = finals[0]
    assert f.segment_id == "TR_a-1" and f.text == "từ1 từ2 từ3" and f.speech_ms == 1600
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
    assert [f.segment_id for f in finals] == ["TR_a-1", "TR_a-2"]
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
    assert captions[-1].final and captions[-1].segment_id == "TR_a-1"
