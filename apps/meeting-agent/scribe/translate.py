"""Translated captions (spec §5.3 B9, UNI-2028).

Each participant's caption language is the attribute uw.caption_lang, which
only the server sets (D11). While someone wants a language L, every final in
another language queues for L; a language's queue goes to /agent/translate at
most once a second, so a batch holds the finals of the last second at most.
The answer is published on uw.caption.<L> under the original uw.segment_id.
Nothing is retried: a missing translation shows the original caption."""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable, Iterable, Mapping

from scribe.transcriber import Final

log = logging.getLogger("scribe.translate")

CAPTION_LANG_ATTR = "uw.caption_lang"
LANGUAGES = frozenset({"vi", "en"})
MAX_SEGMENTS = 20
MAX_RUNES = 4000
# shortcut: a queue that outgrows this drops its oldest finals; only an outage that lasts minutes gets there.
MAX_QUEUE = 100

Translate = Callable[[list[dict], str], Awaitable[dict]]
Publish = Callable[[str, Final, str], Awaitable[object]]


def wanted_languages(attributes: Iterable[Mapping[str, str]]) -> set[str]:
    """The caption languages someone in the room picked; the original needs nothing."""
    return {lang for a in attributes if (lang := a.get(CAPTION_LANG_ATTR, "")) in LANGUAGES}


def base_language(language: str) -> str:
    """vi-VN and vi are the same caption language."""
    return language[:2].lower()


class CaptionTranslator:
    def __init__(
        self,
        translate: Translate,
        publish: Publish,
        wanted: Callable[[], set[str]],
        *,
        clock: Callable[[], float] = time.monotonic,
        spacing_s: float = 1.0,
    ) -> None:
        self._translate = translate
        self._publish = publish
        self._wanted = wanted
        self._clock = clock
        self._spacing = spacing_s
        self._queues: dict[str, list[Final]] = {}
        self._last_call: dict[str, float] = {}

    def add(self, f: Final) -> None:
        for lang in self._wanted():
            if base_language(f.language) == lang:
                continue
            q = self._queues.setdefault(lang, [])
            q.append(f)
            if len(q) > MAX_QUEUE:
                q.pop(0)

    def _due(self, lang: str, now: float) -> bool:
        last = self._last_call.get(lang)
        return bool(self._queues.get(lang)) and (last is None or now - last >= self._spacing)

    def _take(self, lang: str) -> list[Final]:
        q, batch, runes = self._queues[lang], [], 0
        while q and len(batch) < MAX_SEGMENTS and (not batch or runes + len(q[0].text) <= MAX_RUNES):
            f = q.pop(0)
            if len(f.text) > MAX_RUNES:
                continue  # longer than the server takes in one call: the original stays
            batch.append(f)
            runes += len(f.text)
        return batch

    async def tick(self) -> None:
        """Sends each language that is due; one call per language in flight."""
        now = self._clock()
        wanted = self._wanted()
        for lang in list(self._queues):
            if lang not in wanted:
                del self._queues[lang]  # nobody reads it any more
        due = [lang for lang in self._queues if self._due(lang, now)]
        await asyncio.gather(*(self._send(lang, now) for lang in due))

    async def _send(self, lang: str, now: float) -> None:
        batch = self._take(lang)
        if not batch:
            return
        self._last_call[lang] = now
        try:
            out = await self._translate([{"segment_id": f.segment_id, "text": f.text} for f in batch], lang)
        except Exception as e:  # noqa: BLE001 - a missing translation shows the original
            log.warning("translate failed target=%s segments=%d err=%s", lang, len(batch), type(e).__name__)
            return
        if skipped := out.get("skipped"):
            log.info("translate skipped target=%s reason=%s", lang, skipped)
        by_id = {f.segment_id: f for f in batch}
        for t in out.get("translations") or []:
            f = by_id.pop(str(t.get("segment_id", "")), None)
            text = t.get("text")
            if f is not None and isinstance(text, str) and text:
                try:
                    await self._publish(lang, f, text)
                except Exception as e:  # noqa: BLE001 - the room is closing; the loop must not die
                    log.warning("translation not published target=%s err=%s", lang, type(e).__name__)
                    return
