"""STT health of one meeting (benchmark #1): the room hears that the scribe
is paused once STT has failed and nothing has succeeded for 20 s, and that
it is back on the next transcript."""

from scribe.health import SCRIBE_STATE_ATTR, StatePublisher, SttHealth


class Clock:
    def __init__(self) -> None:
        self.t = 100.0

    def __call__(self) -> float:
        return self.t


def test_degraded_only_after_twenty_seconds_without_a_success():
    clock = Clock()
    h = SttHealth(clock=clock)
    assert h.state() == "ok"
    h.failed()
    clock.t += 19
    h.failed()  # a retry that fails again keeps the first failure's clock
    assert h.state() == "ok"
    clock.t += 1
    assert h.state() == "degraded"
    h.ok()
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
    fail["on"] = True
    await p.tick()
    fail["on"] = False
    await p.tick()
    await p.tick()
    assert writes == [{SCRIBE_STATE_ATTR: "degraded"}]
    h.ok()
    await p.tick()
    assert writes[-1] == {SCRIBE_STATE_ATTR: "ok"}
