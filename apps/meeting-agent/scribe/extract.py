"""When to ask the server for live action items (spec §4.4, UNI-2025).

A call is due when 3 minutes passed since the last one and 15 new finals came
in, or after a 20 s pause that follows 5 new finals; never more than 20 calls
in any hour. One more call goes when the room closes. The server reads the
segments after its own cursor, so a failed call loses nothing: the next one
covers the same lines."""

from __future__ import annotations

import logging
import time
from collections import deque
from collections.abc import Awaitable, Callable

log = logging.getLogger("scribe.extract")

Extract = Callable[[], Awaitable[object]]


class ExtractCadence:
    def __init__(
        self,
        extract: Extract,
        *,
        clock: Callable[[], float] = time.monotonic,
        min_interval_s: float = 180,
        min_finals: int = 15,
        pause_s: float = 20,
        pause_finals: int = 5,
        per_hour: int = 20,
    ) -> None:
        self._extract = extract
        self._clock = clock
        self._interval = min_interval_s
        self._min_finals = min_finals
        self._pause = pause_s
        self._pause_finals = pause_finals
        self._per_hour = per_hour
        self._calls: deque[float] = deque()
        self._last_call = clock()
        self._last_final = self._last_call
        self._new = 0
        self._closed = False

    def on_final(self) -> None:
        self._new += 1
        self._last_final = self._clock()

    def due(self) -> bool:
        now = self._clock()
        while self._calls and now - self._calls[0] >= 3600:
            self._calls.popleft()
        if len(self._calls) >= self._per_hour:
            return False
        if self._new >= self._min_finals and now - self._last_call >= self._interval:
            return True
        return self._new >= self._pause_finals and now - self._last_final >= self._pause

    async def tick(self) -> None:
        if not self._closed and self.due():
            await self._run()

    async def final(self) -> None:
        """The room closed: one last call for what came in since the previous one."""
        self._closed = True
        if self._new > 0:
            await self._run()

    async def _run(self) -> None:
        now = self._clock()
        self._calls.append(now)
        self._last_call = now
        # Reset before the call: on failure the server's cursor has not moved,
        # so the next due call reads these lines again.
        self._new = 0
        try:
            await self._extract()
        except Exception as e:  # noqa: BLE001 - live items are a nicety; the summary covers the meeting
            log.warning("extract failed err=%s", type(e).__name__)
