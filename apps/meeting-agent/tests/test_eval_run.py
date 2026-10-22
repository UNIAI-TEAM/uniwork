"""The golden-set runner (eval/run.py): manifest checks, the live replay through
the agent's own TrackTranscriber, the batch path against a fake vendor, the
drift guard against the server's batch request, and the report and gate."""

import json
import re
import wave
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pytest
from aiohttp import web
from livekit import rtc
from livekit.agents.vad import VADEventType

from eval import run
from scribe.stt import FakeSTT

REPO = Path(__file__).resolve().parents[3]


def write_wav(path: Path, segments: list[tuple[float, bool]], rate: int = 48000, channels: int = 2) -> None:
    """segments: (seconds, voiced). Voiced is a loud square wave, silence is 0."""
    chunks = []
    for seconds, voiced in segments:
        n = int(seconds * rate)
        chunks.append(np.full(n, 3000 if voiced else 0, dtype=np.int16))
    mono = np.concatenate(chunks)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(np.repeat(mono, channels).tobytes())


@dataclass
class Ev:
    type: VADEventType
    frames: list = field(default_factory=list)
    speech_duration: float = 0.0


class EnergyVAD:
    """Stands in for Silero: speech is any frame above an RMS; it ends after
    0.3 s below it."""

    def stream(self):
        return _EnergyStream()


class _EnergyStream:
    def __init__(self) -> None:
        import asyncio

        self._q: asyncio.Queue = asyncio.Queue()
        self._speaking, self._quiet, self._voiced = False, 0.0, 0.0

    def push_frame(self, f: rtc.AudioFrame) -> None:
        loud = np.sqrt(np.mean(np.square(np.frombuffer(f.data, dtype=np.int16).astype(np.float32)))) > 300
        if loud and not self._speaking:
            self._speaking, self._voiced = True, 0.0
            self._q.put_nowait(Ev(VADEventType.START_OF_SPEECH, frames=[f]))
        if self._speaking:
            self._voiced += f.duration if loud else 0.0
            self._quiet = 0.0 if loud else self._quiet + f.duration
            if self._quiet >= 0.3:
                self._speaking = False
                self._q.put_nowait(Ev(VADEventType.END_OF_SPEECH, speech_duration=self._voiced))

    def end_input(self) -> None:
        self._q.put_nowait(None)

    def __aiter__(self):
        return self

    async def __anext__(self):
        ev = await self._q.get()
        if ev is None:
            raise StopAsyncIteration
        return ev


def test_read_frames_downmixes_and_resamples_to_16k(tmp_path):
    p = tmp_path / "a.wav"
    write_wav(p, [(1.0, True)], rate=48000, channels=2)
    frames, seconds = run.read_frames(p)
    assert seconds == pytest.approx(1.0)
    assert all(f.sample_rate == 16000 and f.num_channels == 1 for f in frames)
    assert sum(f.samples_per_channel for f in frames) == pytest.approx(16000, abs=320)


async def test_live_replay_goes_through_the_agent_transcriber(tmp_path):
    p = tmp_path / "talk.wav"
    write_wav(p, [(0.2, False), (1.6, True), (1.0, False), (1.1, True), (0.5, False)])
    out = await run.replay_live(p, stt_impl=FakeSTT(), vad=EnergyVAD(), speed=0)
    # The fake STT: one word per 0.5 s voiced, a final at each end of speech.
    assert out.text == "từ1 từ2 từ3 từ1 từ2"
    assert out.finals == 2 and out.failures == 0
    assert out.session_ms > 0 and out.speech_ms == pytest.approx(2700, abs=100)


@pytest.fixture
async def vendor():
    seen: dict = {"polls": 0, "deleted": [], "auth": set()}

    async def upload(request: web.Request) -> web.Response:
        seen["auth"].add(request.headers.get("authorization"))
        seen["uploaded"] = len(await request.read())
        return web.json_response({"upload_url": "https://cdn.example/u/1"})

    async def submit(request: web.Request) -> web.Response:
        seen["auth"].add(request.headers.get("authorization"))
        seen["body"] = await request.json()
        return web.json_response({"id": "tr_1", "status": "queued"})

    async def poll(request: web.Request) -> web.Response:
        seen["polls"] += 1
        if seen["polls"] < 2:
            return web.json_response({"id": "tr_1", "status": "processing"})
        return web.json_response({"id": "tr_1", "status": "completed", "text": "Xin chào UniWork."})

    async def delete(request: web.Request) -> web.Response:
        seen["deleted"].append(request.match_info["id"])
        return web.json_response({})

    app = web.Application()
    app.router.add_post("/v2/upload", upload)
    app.router.add_post("/v2/transcript", submit)
    app.router.add_get("/v2/transcript/{id}", poll)
    app.router.add_delete("/v2/transcript/{id}", delete)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    port = site._server.sockets[0].getsockname()[1]
    yield f"http://127.0.0.1:{port}", seen
    await runner.cleanup()


async def test_batch_sends_the_servers_request_and_deletes_the_vendor_copy(tmp_path, vendor):
    base, seen = vendor
    p = tmp_path / "a.wav"
    write_wav(p, [(0.5, True)])
    text = await run.transcribe_batch(p, api_key="k", base_url=base, poll_s=0)
    assert text == "Xin chào UniWork."
    assert seen["auth"] == {"k"} and seen["uploaded"] == p.stat().st_size
    assert seen["body"] == {
        "audio_url": "https://cdn.example/u/1",
        "speech_models": run.BATCH_MODELS,
        "language_codes": run.BATCH_LANGUAGES,
        "speaker_labels": False,
    }
    assert seen["deleted"] == ["tr_1"]


def test_batch_request_matches_the_server():
    """The batch path must score what production sends: the server's
    assemblyModels and assemblyLanguages (file_transcribe.go)."""
    src = (REPO / "server/internal/ai/provider/file_transcribe.go").read_text()

    def go_list(name: str) -> list[str]:
        m = re.search(rf"var {name} = \[\]string\{{([^}}]*)\}}", src)
        assert m, f"{name} not found in file_transcribe.go"
        return re.findall(r'"([^"]+)"', m.group(1))

    assert run.BATCH_MODELS == go_list("assemblyModels")
    assert run.BATCH_LANGUAGES == go_list("assemblyLanguages")


def manifest(tmp_path: Path, items: list[dict]) -> Path:
    for it in items:
        write_wav(tmp_path / it["audio"], [(1.0, True)])
        (tmp_path / it["reference"]).write_text(it.pop("ref_text", "xin chào"), encoding="utf-8")
    p = tmp_path / "manifest.json"
    p.write_text(json.dumps({"version": 1, "items": items}), encoding="utf-8")
    return p


def item(i: str, **kw) -> dict:
    base = {"id": i, "audio": f"{i}.wav", "reference": f"{i}.txt", "accent": "north", "mic": "room"}
    return base | kw


def test_manifest_rejects_unknown_slices_and_missing_files(tmp_path):
    good = manifest(tmp_path, [item("a", entities=["UniWork"])])
    [loaded] = run.load_manifest(good)
    assert loaded.audio == tmp_path / "a.wav" and loaded.entities == ["UniWork"] and loaded.keyterms == []

    bad = json.loads(good.read_text())
    bad["items"][0]["accent"] = "hanoi"
    good.write_text(json.dumps(bad))
    with pytest.raises(ValueError, match="a: accent"):
        run.load_manifest(good)

    bad["items"][0] |= {"accent": "south", "audio": "missing.wav"}
    good.write_text(json.dumps(bad))
    with pytest.raises(ValueError, match="a: audio"):
        run.load_manifest(good)

    bad["items"] = [item("a"), item("a")]
    good.write_text(json.dumps(bad))
    with pytest.raises(ValueError, match="duplicate id a"):
        run.load_manifest(good)


def test_main_scores_cached_hypotheses_and_applies_the_gate(tmp_path):
    m = manifest(
        tmp_path,
        [
            item("hn", ref_text="Anh An gửi báo giá cho UniWork", entities=["An", "UniWork"]),
            item("sg", accent="south", mic="phone", ref_text="chị Bình chốt 50% ngân sách", entities=["Bình"]),
        ],
    )
    out = tmp_path / "out"
    out.mkdir()
    (out / "hn.batch.txt").write_text("anh an gửi báo giá cho uniwork", encoding="utf-8")
    (out / "sg.batch.txt").write_text("chị bình chốt năm mươi phần trăm ngân sách", encoding="utf-8")
    args = ["--manifest", str(m), "--out", str(out), "--path", "batch", "--min-hours", "0"]
    assert run.main(args) == 0
    results = json.loads((out / "results.json").read_text())
    assert results["passed"] is True
    assert {s["key"] for s in results["slices"]} >= {"all", "accent=north", "accent=south", "mic=phone"}
    report = (out / "report.md").read_text()
    assert "| batch | all | 2 |" in report and "Đạt" in report

    # One accent below the bar fails the whole set, and too little audio fails it too.
    (out / "sg.batch.txt").write_text("chị chốt ngân sách", encoding="utf-8")
    assert run.main(args) == 1
    assert "accent=south" in (out / "report.md").read_text()
    (out / "sg.batch.txt").write_text("chị bình chốt năm mươi phần trăm ngân sách", encoding="utf-8")
    assert run.main(args[:-1] + ["2"]) == 1
    assert "giờ âm thanh" in (out / "report.md").read_text()
