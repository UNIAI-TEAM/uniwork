"""Final segments go to the server in batches: at most every max_wait seconds or
max_segments segments (spec §4.1: 2 s or 20). A batch the server could not take
stays queued and goes again; segment ids make a resend harmless."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable

from scribe.api import ApiError

log = logging.getLogger("scribe.batcher")

# The server refused the batch itself (malformed, run or meeting gone, too
# big): sending it again cannot succeed, so it is dropped. Everything else
# (429, 5xx, network) is kept for the next round.
FINAL_REFUSALS = frozenset({400, 404, 409, 413})

Send = Callable[[list[dict]], Awaitable[object]]


class SegmentBatcher:
    def __init__(self, send: Send, *, max_segments: int = 20, max_wait_s: float = 2.0, max_queue: int = 2000) -> None:
        self._send = send
        self._max = max_segments
        self._wait = max_wait_s
        self._cap = max_queue
        self._queue: list[dict] = []
        self._full = asyncio.Event()
        self._closed = False
        # The extract cadence flushes too (finals reach the server before it
        # reads them); two flushes at once would send and drop the same batch.
        self._lock = asyncio.Lock()
        self.sent = 0

    def add(self, segment: dict) -> None:
        self._queue.append(segment)
        if len(self._queue) > self._cap:
            # shortcut: an outage longer than the queue drops the oldest finals; persist to disk if that ever matters.
            dropped = self._queue.pop(0)
            log.warning("queue full, dropped segment=%s", dropped.get("segment_id"))
        if len(self._queue) >= self._max:
            self._full.set()

    async def flush(self) -> bool:
        """Sends what is queued, a batch at a time; False when the server refused or failed."""
        async with self._lock:
            return await self._flush()

    async def _flush(self) -> bool:
        while self._queue:
            batch = self._queue[: self._max]
            try:
                await self._send(batch)
            except ApiError as e:
                if e.status not in FINAL_REFUSALS:
                    log.warning("send failed segments=%d status=%d", len(batch), e.status)
                    return False
                ids = ",".join(str(s.get("segment_id")) for s in batch)
                log.warning("server refused batch status=%d dropped segments=%s", e.status, ids)
                del self._queue[: len(batch)]
                continue
            except Exception as e:  # noqa: BLE001 - network and the like keep the batch for the next round
                log.warning("send failed segments=%d err=%s", len(batch), type(e).__name__)
                return False
            del self._queue[: len(batch)]
            self.sent += len(batch)
            log.info("sent segments=%d", len(batch))
        return True

    async def run(self) -> None:
        while not self._closed:
            try:
                await asyncio.wait_for(self._full.wait(), self._wait)
            except TimeoutError:
                pass
            self._full.clear()
            await self.flush()

    async def drain(self) -> None:
        self._closed = True
        self._full.set()
        await self.flush()
