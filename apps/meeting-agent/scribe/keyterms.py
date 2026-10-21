"""Keyterms from the meeting context (spec §4.2, A2): names and titles the STT
should spell right. AssemblyAI takes at most 100 terms of up to 50 characters."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable

MAX_TERMS = 100
MAX_TERM_CHARS = 50


def build_keyterms(context: dict, limit: int = MAX_TERMS) -> list[str]:
    candidates = [
        context.get("meeting_title"),
        context.get("project_name"),
        context.get("workspace_name"),
        *(context.get("participant_names") or []),
    ]
    out: list[str] = []
    seen: set[str] = set()
    for c in candidates:
        term = " ".join(str(c or "").split())
        if not term or len(term) > MAX_TERM_CHARS or term.casefold() in seen:
            continue
        seen.add(term.casefold())
        out.append(term)
        if len(out) == limit:
            break
    return out


async def refresh_keyterms(fetch_context: Callable[[], Awaitable[dict]], terms: list[str]) -> list[str]:
    """Re-reads the meeting context (spec §4.2: a new person joined) and
    replaces `terms` in place, so every stream opened afterwards uses the new
    list. A failed read keeps the old list."""
    try:
        fresh = build_keyterms(await fetch_context())
    except Exception:  # noqa: BLE001 - keyterms are a hint; transcription goes on
        return terms
    terms[:] = fresh
    return terms


class KeytermRefresher:
    """Spec §4.2 off the join path: a join asks for a refresh and returns, so
    the newcomer's tracks start at once. One read is in flight at a time; joins
    during it cost one more read after it, not one each (the context read
    shares the agent's request budget with segments and translations)."""

    def __init__(
        self,
        fetch_context: Callable[[], Awaitable[dict]],
        terms: list[str],
        on_update: Callable[[list[str]], None],
    ) -> None:
        self._fetch = fetch_context
        self._terms = terms
        self._on_update = on_update
        self._task: asyncio.Task | None = None
        self._dirty = False

    def request(self) -> None:
        if self._task is not None:
            self._dirty = True
            return
        self._task = asyncio.create_task(self._run())

    async def _run(self) -> None:
        try:
            while True:
                self._dirty = False
                self._on_update(await refresh_keyterms(self._fetch, self._terms))
                if not self._dirty:
                    return
        finally:
            self._task = None
