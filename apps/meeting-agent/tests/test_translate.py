import asyncio
from datetime import UTC, datetime

from scribe.transcriber import Final
from scribe.translate import MAX_SEGMENTS, CaptionTranslator, wanted_languages


class Clock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


def final(n: int, language: str = "vi", text: str = "") -> Final:
    now = datetime(2026, 10, 21, 2, 0, tzinfo=UTC)
    return Final(f"AJ_1-TR_a-{n}", "uw_participant_p1", text or f"Câu {n}", language, now, now, 1000)


async def step(t: CaptionTranslator) -> None:
    """One tick, then let the per-language tasks it started run."""
    await t.tick()
    for _ in range(5):
        await asyncio.sleep(0)


def make(wanted: set[str], answer=None, fail: bool = False):
    clock = Clock()
    calls: list[tuple[str, list[str]]] = []
    published: list[tuple[str, str, str]] = []

    async def translate(segments: list[dict], target: str) -> dict:
        calls.append((target, [s["segment_id"] for s in segments]))
        if fail:
            raise RuntimeError("server down")
        if answer is not None:
            return answer
        return {"translations": [{"segment_id": s["segment_id"], "text": f"{target}:{s['text']}"} for s in segments]}

    async def publish(lang: str, f: Final, text: str) -> None:
        published.append((lang, f.segment_id, text))

    t = CaptionTranslator(translate, publish, lambda: set(wanted), clock=clock)
    return t, clock, calls, published


def with_skips(answer: dict):
    """A translator wanting en whose server answers `answer`, and the skips it tells the room."""
    published: list[str] = []
    skips: list[tuple[str, list[str], str]] = []

    async def translate(segments: list[dict], target: str) -> dict:
        return answer

    async def publish(lang: str, f: Final, text: str) -> None:
        published.append(f.segment_id)

    async def skip(lang: str, finals: list[Final], reason: str) -> None:
        skips.append((lang, [f.segment_id for f in finals], reason))

    t = CaptionTranslator(translate, publish, lambda: {"en"}, clock=Clock(), skip=skip)
    return t, published, skips


def test_wanted_languages_reads_the_server_set_attribute():
    attrs = [
        {"uw.caption_lang": "en"},
        {"uw.caption_lang": ""},
        {},
        {"uw.caption_lang": "fr"},
        {"uw.caption_lang": "vi"},
    ]
    assert wanted_languages(attrs) == {"en", "vi"}
    assert wanted_languages([{}, {"uw.shared_mic": "1"}]) == set()


async def test_nobody_wants_a_translation_no_call():
    t, _, calls, _ = make(set())
    t.add(final(1))
    await step(t)
    assert calls == []


async def test_only_finals_in_another_language_are_sent():
    t, _, calls, published = make({"en", "vi"})
    t.add(final(1, "vi-VN"))  # vi-VN is vi: only English wants it
    t.add(final(2, "en"))
    await step(t)
    assert sorted(calls) == [("en", ["AJ_1-TR_a-1"]), ("vi", ["AJ_1-TR_a-2"])]
    assert ("en", "AJ_1-TR_a-1", "en:Câu 1") in published
    assert ("vi", "AJ_1-TR_a-2", "vi:Câu 2") in published


async def test_one_call_a_second_per_language_batches_what_came_in():
    t, clock, calls, published = make({"en"})
    t.add(final(1))
    await step(t)
    assert calls == [("en", ["AJ_1-TR_a-1"])]
    # Finals inside the second wait and go together once it is over.
    for n in (2, 3):
        clock.t += 0.3
        t.add(final(n))
        await step(t)
    assert len(calls) == 1
    clock.t = 1001.0
    await step(t)
    assert calls[1] == ("en", ["AJ_1-TR_a-2", "AJ_1-TR_a-3"])
    assert [p[1] for p in published] == ["AJ_1-TR_a-1", "AJ_1-TR_a-2", "AJ_1-TR_a-3"]
    clock.t += 0.5
    await step(t)
    assert len(calls) == 2  # nothing queued, nothing sent


async def test_a_batch_holds_at_most_twenty_segments():
    t, clock, calls, _ = make({"en"})
    for n in range(MAX_SEGMENTS + 5):
        t.add(final(n))
    await step(t)
    assert len(calls[0][1]) == MAX_SEGMENTS
    clock.t += 1
    await step(t)
    assert len(calls[1][1]) == 5


async def test_failure_and_skip_drop_quietly_without_retry():
    t, clock, calls, published = make({"en"}, fail=True)
    t.add(final(1))
    await step(t)
    clock.t += 5
    await step(t)
    assert len(calls) == 1 and published == []
    t2, _, _, published2 = make({"en"}, answer={"translations": [], "skipped": "capped"})
    t2.add(final(1))
    await step(t2)
    assert published2 == []


async def test_only_ids_of_the_batch_are_published_once():
    answer = {
        "translations": [
            {"segment_id": "AJ_1-TR_a-1", "text": "One"},
            {"segment_id": "AJ_1-TR_a-1", "text": "Again"},
            {"segment_id": "other", "text": "Made up"},
            {"segment_id": "AJ_1-TR_a-2", "text": ""},
        ]
    }
    t, _, _, published = make({"en"}, answer=answer)
    t.add(final(1))
    t.add(final(2))
    await step(t)
    assert published == [("en", "AJ_1-TR_a-1", "One")]


async def test_a_language_nobody_reads_any_more_is_dropped():
    wanted = {"en"}
    clock = Clock()
    calls: list[str] = []

    async def translate(segments, target):
        calls.append(target)
        return {"translations": []}

    async def publish(*_):
        return None

    t = CaptionTranslator(translate, publish, lambda: set(wanted), clock=clock)
    t.add(final(1))
    wanted.clear()
    await step(t)
    assert calls == []


async def test_a_slow_language_does_not_hold_up_another():
    clock = Clock()
    release = asyncio.Event()
    published: list[str] = []

    async def translate(segments, target):
        if target == "en":
            await release.wait()  # a /translate call that takes its full 10 s
        return {"translations": [{"segment_id": s["segment_id"], "text": target} for s in segments]}

    async def publish(lang, f, text):
        published.append(lang)

    t = CaptionTranslator(translate, publish, lambda: {"en", "vi"}, clock=clock)
    t.add(final(1, "vi"))
    t.add(final(2, "en"))
    await asyncio.wait_for(step(t), 0.5)  # the tick itself never waits on a call
    assert published == ["vi"]
    # vi keeps its own pace while en is still in flight; en gets no second call meanwhile.
    clock.t += 1
    t.add(final(3, "en"))
    t.add(final(4, "vi"))
    await asyncio.wait_for(step(t), 0.5)
    assert published == ["vi", "vi"]
    release.set()
    await step(t)
    assert published == ["vi", "vi", "en"]


async def test_finals_older_than_three_seconds_are_not_paid_for():
    t, clock, calls, published = make({"en"})
    t.add(final(1))
    clock.t += 3.5  # the viewer has read past it: translating it costs and helps nobody
    t.add(final(2))
    await step(t)
    assert calls == [("en", ["AJ_1-TR_a-2"])]
    assert [p[1] for p in published] == ["AJ_1-TR_a-2"]


async def test_a_skipped_batch_tells_the_room_why_for_the_lines_left_untranslated():
    """The organization's AI quota is spent: the room must say so, not wait for nothing."""
    t, published, skips = with_skips({"translations": [], "skipped": "ai_quota_exceeded"})
    t.add(final(1))
    t.add(final(2))
    await step(t)
    assert published == []
    assert skips == [("en", ["AJ_1-TR_a-1", "AJ_1-TR_a-2"], "ai_quota_exceeded")]


async def test_a_translated_batch_tells_no_skip():
    t, published, skips = with_skips({"translations": [{"segment_id": "AJ_1-TR_a-1", "text": "Sentence 1"}]})
    t.add(final(1))
    await step(t)
    assert published == ["AJ_1-TR_a-1"] and skips == []
