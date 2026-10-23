import asyncio

from scribe.api import ApiError
from scribe.batcher import SegmentBatcher


def seg(i: int) -> dict:
    return {"segment_id": f"s{i}"}


async def test_flushes_on_size_and_keeps_failed_batches():
    sent: list[list[str]] = []
    fail = {"on": True}

    async def send(batch: list[dict]) -> None:
        if fail["on"]:
            raise RuntimeError("server down")
        sent.append([s["segment_id"] for s in batch])

    b = SegmentBatcher(send, max_segments=3, max_wait_s=60)
    for i in range(5):
        b.add(seg(i))
    assert await b.flush() is False
    fail["on"] = False
    assert await b.flush() is True
    assert sent == [["s0", "s1", "s2"], ["s3", "s4"]]
    assert b.sent == 5


async def test_run_sends_after_max_wait_and_drain_sends_the_rest():
    sent: list[int] = []

    async def send(batch: list[dict]) -> None:
        sent.append(len(batch))

    b = SegmentBatcher(send, max_segments=20, max_wait_s=0.05)
    task = asyncio.create_task(b.run())
    b.add(seg(1))
    await asyncio.sleep(0.12)
    assert sent == [1]
    b.add(seg(2))
    await b.drain()
    await asyncio.wait_for(task, 1)
    assert sent == [1, 1]


async def test_queue_cap_drops_the_oldest():
    b = SegmentBatcher(lambda batch: asyncio.sleep(0), max_segments=50, max_queue=3)
    for i in range(5):
        b.add(seg(i))
    assert [s["segment_id"] for s in b._queue] == ["s2", "s3", "s4"]


async def test_final_refusals_drop_the_batch_and_retryable_errors_keep_it():
    """Review item 6: 400/404/409/413 cannot succeed again; 429 and 5xx can."""
    for status, kept in [(400, False), (404, False), (409, False), (413, False), (429, True), (503, True)]:

        async def send(batch: list[dict], status: int = status) -> None:
            raise ApiError(status, "/segments")

        b = SegmentBatcher(send, max_segments=2)
        b.add(seg(1))
        b.add(seg(2))
        b.add(seg(3))
        await b.flush()
        assert (len(b._queue) == 3) is kept, status
        assert (len(b._queue) == 0) is (not kept), status


async def test_concurrent_flushes_send_each_segment_once():
    sent: list[str] = []

    async def send(batch: list[dict]) -> None:
        await asyncio.sleep(0.01)
        sent.extend(s["segment_id"] for s in batch)

    b = SegmentBatcher(send, max_segments=2, max_wait_s=60)
    for i in range(5):
        b.add(seg(i))
    await asyncio.gather(b.flush(), b.flush())
    assert sent == ["s0", "s1", "s2", "s3", "s4"]


async def test_a_404_tells_the_agent_its_run_is_gone_once():
    """Benchmark #25: the token or the run is no longer valid mid-meeting. The
    agent leaves, so the server's sweep dispatches a fresh run; a 409 (scribe
    paused, nothing kept) is not a reason to leave."""
    gone: list[int] = []
    status = {"v": 404}

    async def send(batch: list[dict]) -> None:
        raise ApiError(status["v"], "/segments")

    b = SegmentBatcher(send, on_gone=lambda: gone.append(1))
    b.add(seg(1))
    await b.flush()
    b.add(seg(2))
    await b.flush()
    assert gone == [1]
    status["v"] = 409
    b2 = SegmentBatcher(send, on_gone=lambda: gone.append(2))
    b2.add(seg(3))
    await b2.flush()
    assert gone == [1]
