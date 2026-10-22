"""STT health of one meeting (benchmark #1). A vendor outage or a dead key
fails every session the meeting opens; the room must learn that the scribe
is paused, so its clients turn their own device captions back on. The agent
says it on its participant attribute uw.scribe_state (ok | degraded)."""

from __future__ import annotations

import logging
import time
from collections.abc import Awaitable, Callable

log = logging.getLogger("scribe.health")

SCRIBE_STATE_ATTR = "uw.scribe_state"
# One failed session is a blip the backoff absorbs; this long with failures
# and no transcript from any track is an outage (owner decision, N = 20 s).
DEGRADED_AFTER_S = 20.0


class SttHealth:
    """Shared by every track of the meeting: any transcript is proof STT works,
    so one healthy track keeps the meeting ok."""

    def __init__(self, *, after_s: float = DEGRADED_AFTER_S, clock: Callable[[], float] = time.monotonic) -> None:
        self._after = after_s
        self._clock = clock
        self._failing_since: float | None = None

    def failed(self) -> None:
        if self._failing_since is None:
            self._failing_since = self._clock()

    def ok(self) -> None:
        self._failing_since = None

    def state(self) -> str:
        if self._failing_since is not None and self._clock() - self._failing_since >= self._after:
            return "degraded"
        return "ok"


class StatePublisher:
    """Writes the attribute when the state changes; a failed write is tried
    again on the next tick."""

    def __init__(self, health: SttHealth, write: Callable[[dict[str, str]], Awaitable[None]]) -> None:
        self._health = health
        self._write = write
        self._said = "ok"  # the attribute is absent at join, which clients read as ok

    async def tick(self) -> None:
        state = self._health.state()
        if state == self._said:
            return
        try:
            await self._write({SCRIBE_STATE_ATTR: state})
        except Exception as e:  # noqa: BLE001 - the next tick tries again
            log.warning("scribe state not published state=%s err=%s", state, type(e).__name__)
            return
        self._said = state
        log.info("scribe state=%s", state)
