"""Scoring for the STT golden set: Vietnamese-aware normalisation, word error
rate and named-entity recall, summed per slice (accent, microphone) and
checked against the launch bar. Pure functions; no audio, no vendor."""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable
from dataclasses import dataclass

_DIGITS = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"]
_SCALES = ["", "nghìn", "triệu", "tỉ"]

# Spoken variants of one word, folded to the form number_words() writes.
# Both sides are folded, so a rare collision ("tư nhân") costs nothing.
_VARIANTS = {"ngàn": "nghìn", "lăm": "năm", "nhăm": "năm", "mốt": "một", "tư": "bốn", "lẻ": "linh"}

# Vietnamese reads "1.500.000" as thousands and "3,5" as a decimal.
_NUMBER = re.compile(r"(\d{1,3}(?:\.\d{3})+(?!\d)|\d+(?:[,.]\d+)?)(\s*%)?")
# Old-style tone placement on an open oa/oe/uy syllable ("hòa", "thúy") moves
# to the second vowel ("hoà", "thuý"); in NFD the mark follows its letter.
_TONE = re.compile(r"([ou])([̣̀́̃̉])([aey])$")
# "kỹ"/"kĩ", "lý"/"lí": a y right after the initial consonant is spelled i.
_Y_SYLLABLE = re.compile(r"^(ngh|ng|nh|ch|gh|kh|ph|th|tr|[bcdđghklmnpqrstvx])([yýỳỷỹỵ])$")
_Y_TO_I = str.maketrans("yýỳỷỹỵ", "iíìỉĩị")


def _below_thousand(n: int, padded: bool) -> list[str]:
    """padded: a group after the leading one reads its zero hundreds
    ("một nghìn không trăm linh năm")."""
    h, t, u = n // 100, n // 10 % 10, n % 10
    out: list[str] = []
    if h or padded:
        out += [_DIGITS[h], "trăm"]
    if t == 0:
        if u:
            out += ["linh", _DIGITS[u]] if out else [_DIGITS[u]]
    elif t == 1:
        out += ["mười"] + ([_DIGITS[u]] if u else [])
    else:
        out += [_DIGITS[t], "mươi"] + ([_DIGITS[u]] if u else [])
    return out


def number_words(n: int) -> str:
    """Reads 0 <= n < 10**12 the way a Vietnamese speaker says it."""
    if n == 0:
        return _DIGITS[0]
    groups: list[int] = []
    while n:
        groups.append(n % 1000)
        n //= 1000
    out: list[str] = []
    for i in range(len(groups) - 1, -1, -1):
        if groups[i] == 0:
            continue
        out += _below_thousand(groups[i], padded=bool(out))
        if _SCALES[i]:
            out.append(_SCALES[i])
    return " ".join(out)


def _digit_run(s: str) -> str:
    # A phone number or a code ("0912…", a 13-digit id) is read digit by digit.
    if (s.startswith("0") and len(s) > 1) or len(s) > 12:
        return " ".join(_DIGITS[int(c)] for c in s)
    return number_words(int(s))


def _spell_number(m: re.Match[str]) -> str:
    raw, percent = m.group(1), m.group(2)
    if re.fullmatch(r"\d{1,3}(?:\.\d{3})+", raw):
        words = _digit_run(raw.replace(".", ""))
    elif "," in raw or "." in raw:
        whole, frac = re.split(r"[,.]", raw)
        words = f"{_digit_run(whole)} phẩy {_digit_run(frac)}"
    else:
        words = _digit_run(raw)
    return f" {words}{' phần trăm' if percent else ''} "


def _word(w: str) -> str:
    w = unicodedata.normalize("NFC", _TONE.sub(r"\1\3\2", unicodedata.normalize("NFD", w)))
    if m := _Y_SYLLABLE.match(w):
        w = m.group(1) + m.group(2).translate(_Y_TO_I)
    return _VARIANTS.get(w, w)


def normalize(text: str) -> str:
    """NFC, lowercase, numbers spelled out, punctuation and symbols dropped,
    tone placement and spelling variants unified. English words pass through."""
    text = _NUMBER.sub(_spell_number, unicodedata.normalize("NFC", text).lower())
    text = "".join(" " if unicodedata.category(c)[0] in "PS" else c for c in text)
    return " ".join(_word(w) for w in text.split())


def word_errors(reference: str, hypothesis: str) -> tuple[int, int]:
    """(substitutions + deletions + insertions, reference words) after
    normalisation: the numerator and denominator of WER."""
    ref, hyp = normalize(reference).split(), normalize(hypothesis).split()
    prev = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        cur = [i] + [0] * len(hyp)
        for j, h in enumerate(hyp, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r != h))
        prev = cur
    return prev[-1], len(ref)


def entity_recall(entities: Iterable[str], hypothesis: str) -> tuple[int, int]:
    """(entities found, entities expected): an entity counts when its whole
    normalised phrase appears as consecutive words of the hypothesis."""
    hyp = f" {normalize(hypothesis)} "
    wanted = [n for n in (normalize(e) for e in entities) if n]
    return sum(f" {e} " in hyp for e in wanted), len(wanted)


@dataclass(frozen=True)
class Scored:
    """One recording through one path (live or batch)."""

    id: str
    accent: str
    mic: str
    path: str
    errors: int
    words: int
    found: int
    entities: int


@dataclass(frozen=True)
class Slice:
    path: str
    key: str  # "all", "accent=<a>" or "mic=<m>"
    items: int
    errors: int
    words: int
    found: int
    entities: int

    @property
    def wer(self) -> float | None:
        return self.errors / self.words if self.words else None

    @property
    def entity_recall(self) -> float | None:
        return self.found / self.entities if self.entities else None


def slices(items: Iterable[Scored]) -> list[Slice]:
    """Corpus figures per path, overall and per accent and microphone: errors
    are summed over words, so a long recording weighs what it holds."""
    groups: dict[tuple[str, str], list[Scored]] = {}
    for s in items:
        for key in ("all", f"accent={s.accent}", f"mic={s.mic}"):
            groups.setdefault((s.path, key), []).append(s)
    return [
        Slice(
            path,
            key,
            len(g),
            sum(s.errors for s in g),
            sum(s.words for s in g),
            sum(s.found for s in g),
            sum(s.entities for s in g),
        )
        for (path, key), g in sorted(groups.items())
    ]


def gate(all_slices: Iterable[Slice], *, max_wer: float, min_entity_recall: float) -> tuple[bool, list[str]]:
    """The launch bar holds for every slice, not only on average: one accent
    or one microphone type below it fails the set (README "Cổng bật cờ")."""
    reasons: list[str] = []
    for s in all_slices:
        if s.wer is not None and s.wer > max_wer:
            reasons.append(f"{s.path} {s.key}: WER {s.wer:.1%} > {max_wer:.1%}")
        if s.entity_recall is not None and s.entity_recall < min_entity_recall:
            reasons.append(f"{s.path} {s.key}: entity recall {s.entity_recall:.1%} < {min_entity_recall:.1%}")
    return not reasons, reasons
