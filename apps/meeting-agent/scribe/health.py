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
# One failed session is a blip the backoff absorbs; failures that keep coming
# for this long with no transcript from any track are an outage (owner
# decision, N = 20 s).
DEGRADED_AFTER_S = 20.0
# Retries come at most RETRY_MAX_S (transcriber, 30 s) apart while anyone
# speaks; this long without one means nothing is failing any more (a quiet
# room), so the meeting reads ok again and a later failure starts afresh.
STALE_AFTER_S = 45.0


class SttHealth:
    """Shared by every track of the meeting: any transcript is proof STT works,
    so one healthy track keeps the meeting ok. Degraded needs failures at both
    ends of the 20 s: one failure followed by silence proves nothing."""

    def __init__(self, *, after_s: float = DEGRADED_AFTER_S, clock: Callable[[], float] = time.monotonic) -> None:
        self._after = after_s
        self._clock = clock
        self._failing_since: float | None = None
        self._last_failed = 0.0

    def failed(self) -> None:
        now = self._clock()
        if self._failing_since is None or now - self._last_failed > STALE_AFTER_S:
            self._failing_since = now
        self._last_failed = now

    def ok(self) -> None:
        self._failing_since = None

    def state(self) -> str:
        if self._failing_since is None or self._clock() - self._last_failed > STALE_AFTER_S:
            return "ok"
        return "degraded" if self._last_failed - self._failing_since >= self._after else "ok"


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
