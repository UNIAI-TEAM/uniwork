from scribe.extract import ExtractCadence


class Clock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


def make(fail: bool = False):
    clock = Clock()
    calls: list[float] = []

    async def extract() -> None:
        calls.append(clock.t)
        if fail:
            raise RuntimeError("server down")

    return ExtractCadence(extract, clock=clock), clock, calls


def finals(c: ExtractCadence, clock: Clock, n: int, every_s: float = 1) -> None:
    for _ in range(n):
        clock.t += every_s
        c.on_final()


async def test_due_after_three_minutes_and_fifteen_finals():
    c, clock, calls = make()
    finals(c, clock, 14, every_s=13)  # 182 s but 14 finals
    await c.tick()
    assert calls == []
    c2, clock2, calls2 = make()
    finals(c2, clock2, 15, every_s=11)  # 15 finals but 165 s
    await c2.tick()
    assert calls2 == []
    clock2.t += 15  # 180 s; a 15 s pause is below the pause rule
    await c2.tick()
    assert len(calls2) == 1
    await c2.tick()
    assert len(calls2) == 1  # counters reset


async def test_due_after_a_pause_that_follows_five_finals():
    c, clock, calls = make()
    finals(c, clock, 4)
    clock.t += 60
    await c.tick()
    assert calls == []  # 4 finals: a pause alone is not enough
    finals(c, clock, 1)
    clock.t += 19
    await c.tick()
    assert calls == []
    clock.t += 1
    await c.tick()
    assert len(calls) == 1


async def test_at_most_twenty_calls_in_any_hour():
    c, clock, calls = make()
    for _ in range(25):
        finals(c, clock, 5)
        clock.t += 20
        await c.tick()
    assert len(calls) == 20
    clock.t = calls[0] + 3600  # the first call leaves the window
    finals(c, clock, 5)
    clock.t += 20
    await c.tick()
    assert len(calls) == 21


async def test_a_failed_call_is_not_retried_at_once():
    c, clock, calls = make(fail=True)
    finals(c, clock, 5)
    clock.t += 20
    await c.tick()
    await c.tick()
    assert len(calls) == 1


async def test_room_close_calls_once_more_only_with_new_finals():
    c, clock, calls = make()
    await c.final()
    assert calls == []
    finals(c, clock, 2)
    await c.final()
    assert len(calls) == 1
    finals(c, clock, 5)
    clock.t += 30
    await c.tick()
    assert len(calls) == 1  # closed: the cadence stops


async def test_a_call_cancelled_at_shutdown_leaves_its_lines_to_final():
    import asyncio

    clock = Clock()
    started = asyncio.Event()
    calls: list[str] = []

    async def extract() -> None:
        calls.append("call")
        if len(calls) == 1:
            started.set()
            await asyncio.sleep(3600)  # in flight when shutdown cancels it

    c = ExtractCadence(extract, clock=clock)
    finals(c, clock, 5)
    clock.t += 20
    tick = asyncio.create_task(c.tick())
    await started.wait()
    tick.cancel()
    try:
        await tick
    except asyncio.CancelledError:
        pass
    await c.final()
    assert calls == ["call", "call"]
