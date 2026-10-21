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
    await t.tick()
    assert calls == []


async def test_only_finals_in_another_language_are_sent():
    t, _, calls, published = make({"en", "vi"})
    t.add(final(1, "vi-VN"))  # vi-VN is vi: only English wants it
    t.add(final(2, "en"))
    await t.tick()
    assert sorted(calls) == [("en", ["AJ_1-TR_a-1"]), ("vi", ["AJ_1-TR_a-2"])]
    assert ("en", "AJ_1-TR_a-1", "en:Câu 1") in published
    assert ("vi", "AJ_1-TR_a-2", "vi:Câu 2") in published


async def test_one_call_a_second_per_language_batches_what_came_in():
    t, clock, calls, published = make({"en"})
    t.add(final(1))
    await t.tick()
    assert calls == [("en", ["AJ_1-TR_a-1"])]
    # Finals inside the second wait and go together once it is over.
    for n in (2, 3):
        clock.t += 0.3
        t.add(final(n))
        await t.tick()
    assert len(calls) == 1
    clock.t = 1001.0
    await t.tick()
    assert calls[1] == ("en", ["AJ_1-TR_a-2", "AJ_1-TR_a-3"])
    assert [p[1] for p in published] == ["AJ_1-TR_a-1", "AJ_1-TR_a-2", "AJ_1-TR_a-3"]
    clock.t += 0.5
    await t.tick()
    assert len(calls) == 2  # nothing queued, nothing sent


async def test_a_batch_holds_at_most_twenty_segments():
    t, clock, calls, _ = make({"en"})
    for n in range(MAX_SEGMENTS + 5):
        t.add(final(n))
    await t.tick()
    assert len(calls[0][1]) == MAX_SEGMENTS
    clock.t += 1
    await t.tick()
    assert len(calls[1][1]) == 5


async def test_failure_and_skip_drop_quietly_without_retry():
    t, clock, calls, published = make({"en"}, fail=True)
    t.add(final(1))
    await t.tick()
    clock.t += 5
    await t.tick()
    assert len(calls) == 1 and published == []
    t2, _, _, published2 = make({"en"}, answer={"translations": [], "skipped": "capped"})
    t2.add(final(1))
    await t2.tick()
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
    await t.tick()
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
    await t.tick()
    assert calls == []
