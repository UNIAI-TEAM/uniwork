"""STT quality scoring (eval/score.py): Vietnamese-aware normalisation, corpus
WER and named-entity recall, the per-slice report and the launch gate."""

import unicodedata

import pytest

from eval.score import Scored, entity_recall, gate, normalize, number_words, slices, word_errors


def test_normalize_lowercases_strips_punctuation_and_composes():
    decomposed = unicodedata.normalize("NFD", "Chào  anh Nguyễn, hôm nay HỌP lúc mấy giờ?")
    assert normalize(decomposed) == "chào anh nguyễn hôm nay họp lúc mấy giờ"


def test_normalize_unifies_tone_placement_and_y_i_spelling():
    # Old and new tone placement, and the y/i spelling variants, are one word.
    assert normalize("Hòa thúy khỏe ủy ban") == normalize("hoà thuý khoẻ uỷ ban")
    assert normalize("kỹ thuật lý do Mỹ") == normalize("kĩ thuật lí do Mĩ")
    # A syllable with a final consonant keeps its mark, and qu- keeps its y.
    assert normalize("hoàn toán quý") == "hoàn toán quý"


def test_number_words_reads_vietnamese_numbers():
    assert number_words(0) == "không"
    assert number_words(15) == "mười năm"
    assert number_words(21) == "hai mươi một"
    assert number_words(24) == "hai mươi bốn"
    assert number_words(105) == "một trăm linh năm"
    assert number_words(2026) == "hai nghìn không trăm hai mươi sáu"
    assert number_words(1_000_005) == "một triệu không trăm linh năm"
    assert number_words(3_000_000_000) == "ba tỉ"


def test_normalize_spells_digits_like_the_spoken_reference():
    assert normalize("họp lúc 9 giờ, ngân sách 1.500.000 đồng") == normalize(
        "họp lúc chín giờ ngân sách một triệu năm trăm nghìn đồng"
    )
    assert normalize("tăng 50%") == normalize("tăng năm mươi phần trăm")
    assert normalize("3,5 điểm") == normalize("ba phẩy năm điểm")
    # Spoken variants of the same number word.
    assert normalize("hai mươi mốt, mười lăm, một trăm lẻ năm, ba ngàn") == normalize(
        "hai mươi một mười năm một trăm linh năm ba nghìn"
    )


def test_normalize_keeps_english_code_switching():
    assert normalize("Gửi file Excel cho team Marketing nhé!") == "gửi file excel cho team marketing nhé"


def test_word_errors_counts_substitutions_deletions_insertions():
    assert word_errors("a b c d", "a b c d") == (0, 4)
    assert word_errors("a b c d", "a x c") == (2, 4)  # one substitution, one deletion
    assert word_errors("a b", "a b c") == (1, 2)  # one insertion
    assert word_errors("", "a") == (1, 0)


def test_entity_recall_needs_the_whole_phrase():
    hyp = "anh nguyễn văn an gửi báo giá cho uniwork trước thứ sáu"
    found, total = entity_recall(["Nguyễn Văn An", "UniWork", "Trần Thị Bình"], hyp)
    assert (found, total) == (2, 3)
    # A partial name is a miss; the match is on whole words, not substrings.
    assert entity_recall(["Văn Anh"], "nguyễn văn an") == (0, 1)
    assert entity_recall(["An"], "anh") == (0, 1)


def test_slices_sum_errors_over_words_not_mean_of_items():
    items = [
        Scored("a", "north", "room", "batch", errors=1, words=10, found=1, entities=2),
        Scored("b", "north", "phone", "batch", errors=9, words=90, found=3, entities=3),
        Scored("c", "south", "phone", "batch", errors=0, words=10, found=0, entities=0),
    ]
    by = {(s.path, s.key): s for s in slices(items)}
    total = by[("batch", "all")]
    assert total.wer == pytest.approx(10 / 110)
    assert total.entity_recall == pytest.approx(4 / 5)
    assert by[("batch", "accent=north")].wer == pytest.approx(10 / 100)
    assert by[("batch", "mic=phone")].wer == pytest.approx(9 / 100)
    # A slice without entities has no recall, not 0 %.
    assert by[("batch", "accent=south")].entity_recall is None


def test_gate_fails_on_any_slice_over_the_bar():
    ok = Scored("a", "north", "room", "live", errors=1, words=10, found=4, entities=5)
    bad = Scored("b", "central", "phone", "live", errors=4, words=10, found=4, entities=5)
    passed, reasons = gate(slices([ok]), max_wer=0.2, min_entity_recall=0.8)
    assert passed and reasons == []
    passed, reasons = gate(slices([ok, bad]), max_wer=0.2, min_entity_recall=0.8)
    assert not passed
    assert any("accent=central" in r and "WER" in r for r in reasons)
    assert any(r.startswith("live all") for r in reasons)  # 5/20 = 25 % over all items too
