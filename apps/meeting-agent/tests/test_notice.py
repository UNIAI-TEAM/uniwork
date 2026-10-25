import wave
from pathlib import Path

import pytest

from scribe.notice import (
    DIAL_IN_ATTR,
    NOTICE_PATH,
    NOTICE_TEXT_VI,
    NoticeLedger,
    frames_of,
    read_notice,
)


def test_only_an_admitted_phone_caller_is_due_the_notice_and_only_once():
    ledger = NoticeLedger()
    admitted = {DIAL_IN_ATTR: "admitted"}
    assert not ledger.due("sip_1", False, admitted), "a web participant reads the chip; no audio"
    assert not ledger.due("sip_1", True, {DIAL_IN_ATTR: "waiting"}), "held callers hear nothing"
    assert not ledger.due("sip_1", True, {}), "no state yet: not admitted"
    assert ledger.due("sip_1", True, admitted)
    assert not ledger.due("sip_1", True, admitted), "once per caller per job"
    assert ledger.due("sip_2", True, admitted)


def test_a_caller_whose_playback_failed_is_due_again():
    ledger = NoticeLedger()
    admitted = {DIAL_IN_ATTR: "admitted"}
    assert ledger.due("sip_1", True, admitted)
    ledger.failed("sip_1")
    assert ledger.due("sip_1", True, admitted)


def test_frames_split_pcm_into_10ms_chunks_and_pad_the_last():
    rate, channels = 16000, 1
    per = rate // 100 * channels * 2  # 10 ms of 16-bit mono
    pcm = b"\x01\x00" * (rate // 100 * 2 + 5)  # 2 frames and 5 samples
    frames = list(frames_of(pcm, rate, channels))
    assert len(frames) == 3
    assert all(len(f) == per for f in frames)
    assert frames[-1].endswith(b"\x00" * 10)


def test_read_notice_refuses_anything_but_16_bit_pcm(tmp_path: Path):
    p = tmp_path / "bad.wav"
    with wave.open(str(p), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(1)
        w.setframerate(8000)
        w.writeframes(b"\x00" * 80)
    with pytest.raises(ValueError):
        read_notice(p)


def test_the_shipped_notice_is_vietnamese_16_bit_pcm_of_a_few_seconds():
    rate, channels, pcm = read_notice(NOTICE_PATH)
    seconds = len(pcm) / (rate * channels * 2)
    assert rate in (16000, 48000) and channels == 1
    assert 3 <= seconds <= 20, seconds
    # Where the audio is processed is said in the organization's settings only.
    assert "Thư ký UNI, trợ lý AI" in NOTICE_TEXT_VI and "Việt Nam" not in NOTICE_TEXT_VI
