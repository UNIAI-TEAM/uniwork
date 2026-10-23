"""STT health of one meeting (benchmark #1): the room hears that the scribe
is paused once STT has kept failing for 20 s with nothing succeeding, and
that it is back on the next transcript, or once the failures stop."""

from scribe.health import SCRIBE_STATE_ATTR, StatePublisher, SttHealth


class Clock:
    def __init__(self) -> None:
        self.t = 100.0

    def __call__(self) -> float:
        return self.t


def test_degraded_only_after_twenty_seconds_of_failures_without_a_success():
    clock = Clock()
    h = SttHealth(clock=clock)
    assert h.state() == "ok"
    h.failed()
    clock.t += 19
    h.failed()  # a retry that fails again keeps the first failure's clock
    assert h.state() == "ok"
    clock.t += 1
    assert h.state() == "ok"  # 20 s have passed, but nothing has failed since 119
    h.failed()
    assert h.state() == "degraded"
    h.ok()
    assert h.state() == "ok"


def test_one_blip_then_a_quiet_room_stays_ok():
    """Review: a single failure followed by silence (a screen share, everyone
    muted) is not an outage; nothing proves STT is still failing."""
    clock = Clock()
    h = SttHealth(clock=clock)
    h.failed()
    clock.t += 25
    assert h.state() == "ok"


def test_degraded_ends_when_the_failures_stop():
    """An outage the room then goes quiet through stops reading as degraded
    once no retry has failed for longer than the longest backoff, and a later
    failure starts a fresh 20 s clock instead of reusing the old one."""
    from scribe.health import STALE_AFTER_S

    clock = Clock()
    h = SttHealth(clock=clock)
    h.failed()
    clock.t += 20
    h.failed()
    assert h.state() == "degraded"
    clock.t += STALE_AFTER_S
    assert h.state() == "degraded"
    clock.t += 1
    assert h.state() == "ok"
    h.failed()
    assert h.state() == "ok"


def test_a_success_on_another_track_keeps_the_meeting_ok():
    clock = Clock()
    h = SttHealth(clock=clock)
    h.failed()
    clock.t += 10
    h.ok()  # someone else's session delivered: not an outage
    clock.t += 15
    assert h.state() == "ok"


async def test_publisher_sets_the_attribute_once_per_change_and_retries_a_failed_write():
    clock = Clock()
    h = SttHealth(clock=clock)
    writes: list[dict] = []
    fail = {"on": False}

    async def write(attrs: dict) -> None:
        if fail["on"]:
            raise RuntimeError("room closing")
        writes.append(attrs)

    p = StatePublisher(h, write)
    await p.tick()
    assert writes == []  # ok is the default; nothing to say
    h.failed()
    clock.t += 21
    h.failed()
    fail["on"] = True
    await p.tick()
    fail["on"] = False
    await p.tick()
    await p.tick()
    assert writes == [{SCRIBE_STATE_ATTR: "degraded"}]
    h.ok()
    await p.tick()
    assert writes[-1] == {SCRIBE_STATE_ATTR: "ok"}
