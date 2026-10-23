"""The spoken AI-scribe notice for phone callers (UNI-1995 access, #2).

A web participant sees the scribe chip; a caller on the phone sees nothing.
Once the host admits a caller (the server sets uw.dial_in=admitted on their
SIP participant), the agent plays this short Vietnamese notice to that caller
alone: the track's subscription permission names only their identity.

The asset is generated, not recorded:
  say -v Linh --data-format=LEI16@16000 -o assets/sip-notice-vi.wav "$(python -c
  'from scribe.notice import NOTICE_TEXT_VI; print(NOTICE_TEXT_VI)')"
"""

from __future__ import annotations

import wave
from collections.abc import Iterator
from pathlib import Path

# Set by the server on a phone caller's participant: waiting, then admitted.
DIAL_IN_ATTR = "uw.dial_in"
NOTICE_PATH = Path(__file__).resolve().parent.parent / "assets" / "sip-notice-vi.wav"
NOTICE_TEXT_VI = (
    "Cuộc họp này có Thư ký AI của UniWork ghi lời nói thành văn bản. "
    "Bản ghi do tổ chức chủ trì cuộc họp lưu trên UniWork. "
    "Âm thanh được một dịch vụ chuyển giọng nói thành chữ xử lý ở ngoài Việt Nam."
)


class NoticeLedger:
    """Who has been told in this job: each admitted caller once."""

    def __init__(self) -> None:
        self._told: set[str] = set()

    def due(self, identity: str, is_sip: bool, attributes: dict[str, str]) -> bool:
        if not is_sip or attributes.get(DIAL_IN_ATTR) != "admitted" or identity in self._told:
            return False
        self._told.add(identity)
        return True

    def failed(self, identity: str) -> None:
        """Playback did not happen: the next admission event may try again."""
        self._told.discard(identity)


def read_notice(path: Path) -> tuple[int, int, bytes]:
    """(sample rate, channels, 16-bit PCM) of the notice; anything else is refused."""
    with wave.open(str(path), "rb") as w:
        if w.getsampwidth() != 2:
            raise ValueError("notice must be 16-bit PCM")
        return w.getframerate(), w.getnchannels(), w.readframes(w.getnframes())


def frames_of(pcm: bytes, rate: int, channels: int) -> Iterator[bytes]:
    """10 ms chunks of the PCM, the last one padded with silence."""
    size = rate // 100 * channels * 2
    for i in range(0, len(pcm), size):
        chunk = pcm[i : i + size]
        yield chunk + b"\x00" * (size - len(chunk))
