"""Runs the STT golden set (eval/README.md) through the live path, the batch
path or both, scores it (eval/score.py) and writes report.md + results.json.

    python -m eval.run --manifest ~/golden/manifest.json --out ~/golden/out --path both

Live: each WAV is replayed in real time through the agent's own pipeline (VAD,
TrackTranscriber, make_stt with SCRIBE_STT_PROVIDER). Batch: the file goes to
AssemblyAI's pre-recorded API with the server's request (file_transcribe.go).
Hypotheses are cached in --out, so a re-run only re-scores (--fresh redoes
them: the vendor bills every run). Exit 0 = the set passes the bar, 1 = it does
not, 2 = the manifest is wrong."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import statistics
import sys
import time
import wave
from dataclasses import asdict, dataclass, field
from pathlib import Path

import aiohttp
import numpy as np
from livekit import rtc
from livekit.agents import stt
from livekit.agents.vad import VADEventType

from eval.score import Scored, entity_recall, gate, slices, word_errors
from scribe.transcriber import Caption, Final, TrackTranscriber

ACCENTS = {"north", "central", "south", "mixed"}
MICS = {"headset", "laptop", "phone", "room"}
RATE, FRAME = 16000, 160  # what the agent's AudioStream hands the VAD and STT (10 ms)
# Mirrors server/internal/ai/provider/file_transcribe.go (assemblyModels,
# assemblyLanguages); tests/test_eval_run.py fails when they drift.
BATCH_MODELS = ["universal-3-5-pro", "universal-2"]
BATCH_LANGUAGES = ["vi", "en"]
TRAILING_SILENCE_S = 2.0  # lets the VAD end the last turn and the vendor finalise it


@dataclass(frozen=True)
class Item:
    id: str
    audio: Path
    reference: Path
    accent: str
    mic: str
    entities: list[str] = field(default_factory=list)
    # What production would send as keyterms (meeting title, participant
    # names); never the entities, which would score the hint, not the STT.
    keyterms: list[str] = field(default_factory=list)


def load_manifest(path: Path) -> list[Item]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if raw.get("version") != 1 or not isinstance(raw.get("items"), list) or not raw["items"]:
        raise ValueError(f"{path.name}: needs version 1 and a non-empty items list")
    out: list[Item] = []
    seen: set[str] = set()
    for i, it in enumerate(raw["items"]):
        iid = str(it.get("id") or f"#{i}")
        if iid in seen:
            raise ValueError(f"{path.name}: duplicate id {iid}")
        seen.add(iid)
        if it.get("accent") not in ACCENTS:
            raise ValueError(f"{iid}: accent must be one of {sorted(ACCENTS)}")
        if it.get("mic") not in MICS:
            raise ValueError(f"{iid}: mic must be one of {sorted(MICS)}")
        files = {k: path.parent / str(it.get(k) or "") for k in ("audio", "reference")}
        for k, f in files.items():
            if not it.get(k) or not f.is_file():
                raise ValueError(f"{iid}: {k} file {f} not found")
        for k in ("entities", "keyterms"):
            if not all(isinstance(e, str) for e in it.get(k, [])):
                raise ValueError(f"{iid}: {k} must be a list of strings")
        out.append(
            Item(
                iid,
                files["audio"],
                files["reference"],
                it["accent"],
                it["mic"],
                list(it.get("entities", [])),
                list(it.get("keyterms", [])),
            )
        )
    return out


def read_frames(path: Path) -> tuple[list[rtc.AudioFrame], float]:
    """A 16-bit PCM WAV as the agent would hear it: mono, 16 kHz, 10 ms frames."""
    with wave.open(str(path), "rb") as w:
        if w.getsampwidth() != 2:
            raise ValueError(f"{path.name}: 16-bit PCM WAV only (ffmpeg -i in -ac 1 -ar 16000 -c:a pcm_s16le out.wav)")
        rate, channels, n = w.getframerate(), w.getnchannels(), w.getnframes()
        data = np.frombuffer(w.readframes(n), dtype=np.int16)
    mono = data.reshape(-1, channels).mean(axis=1).astype(np.int16) if channels > 1 else data
    if rate != RATE:
        rs = rtc.AudioResampler(rate, RATE, num_channels=1, quality=rtc.AudioResamplerQuality.HIGH)
        parts = rs.push(bytearray(mono.tobytes())) + rs.flush()
        mono = np.concatenate([np.frombuffer(f.data, dtype=np.int16) for f in parts]) if parts else mono[:0]
    frames = []
    for i in range(0, len(mono), FRAME):
        chunk = mono[i : i + FRAME]
        frames.append(rtc.AudioFrame(chunk.tobytes(), RATE, 1, len(chunk)))
    return frames, n / rate


@dataclass
class LiveRun:
    text: str
    finals: int
    failures: int
    session_ms: int
    speech_ms: int
    latencies_s: list[float]


async def replay_live(path: Path, *, stt_impl: stt.STT, vad, speed: float = 1.0, idle_close_s: float = 30.0) -> LiveRun:
    """Mirrors agent.py's transcribe(): the VAD marks speech, TrackTranscriber
    opens and closes the STT session. speed 1 is real time (the only speed at
    which latency and vendor behaviour mean anything); 0 is as fast as possible."""
    frames, _ = read_frames(path)
    frames += [rtc.AudioFrame(bytes(FRAME * 2), RATE, 1, FRAME)] * int(TRAILING_SILENCE_S * 100)
    virtual = [0.0]  # audio time: the idle window counts audio, whatever the speed
    finals: list[Final] = []
    latencies: list[float] = []
    ended: list[float] = []

    async def publish(_: Caption) -> None:
        return None

    def on_final(f: Final) -> None:
        finals.append(f)
        if ended:
            latencies.append(time.monotonic() - ended.pop())
            ended.clear()

    t = TrackTranscriber(
        segment_prefix=f"eval-{path.stem}",
        identity="eval",
        stt_impl=stt_impl,
        publish=publish,
        on_final=on_final,
        idle_close_s=idle_close_s,
        clock=lambda: virtual[0],
    )
    vad_stream = vad.stream()

    async def vad_events() -> None:
        async for ev in vad_stream:
            if ev.type == VADEventType.START_OF_SPEECH:
                t.on_vad_start(ev.frames)
            elif ev.type == VADEventType.END_OF_SPEECH:
                ended.append(time.monotonic())
                t.on_vad_end(ev.speech_duration)

    task = asyncio.create_task(vad_events())
    start = time.monotonic()
    for f in frames:
        vad_stream.push_frame(f)
        await t.push(f)
        virtual[0] += f.duration
        await asyncio.sleep(max(0.0, start + virtual[0] / speed - time.monotonic()) if speed > 0 else 0)
    vad_stream.end_input()
    await task
    await t.close()
    return LiveRun(
        " ".join(f.text for f in finals),
        len(finals),
        t.failures,
        t.session_ms,
        sum(f.speech_ms for f in finals),
        latencies,
    )


async def transcribe_batch(
    path: Path, *, api_key: str, base_url: str, poll_s: float = 3.0, timeout_s: float = 3 * 3600
) -> str:
    """Upload, submit with the server's request, poll, then delete the vendor's
    copy as the server does (spec follow-through §7.5)."""
    base = base_url.rstrip("/")
    headers = {"authorization": api_key}
    async with aiohttp.ClientSession(headers=headers, timeout=aiohttp.ClientTimeout(total=600)) as http:
        with path.open("rb") as body:
            async with http.post(f"{base}/v2/upload", data=body) as r:
                if r.status != 200:
                    raise RuntimeError(f"{path.name}: upload answered {r.status}")
                audio_url = (await r.json())["upload_url"]
        req = {
            "audio_url": audio_url,
            "speech_models": BATCH_MODELS,
            "language_codes": BATCH_LANGUAGES,
            "speaker_labels": False,
        }
        async with http.post(f"{base}/v2/transcript", json=req) as r:
            if r.status != 200:
                raise RuntimeError(f"{path.name}: submit answered {r.status}")
            job = (await r.json())["id"]
        try:
            deadline = time.monotonic() + timeout_s
            while time.monotonic() < deadline:
                async with http.get(f"{base}/v2/transcript/{job}") as r:
                    out = await r.json()
                if out.get("status") == "completed":
                    return str(out.get("text") or "")
                if out.get("status") == "error":
                    raise RuntimeError(f"{path.name}: the vendor failed the job")
                await asyncio.sleep(poll_s)
            raise RuntimeError(f"{path.name}: no result after {timeout_s:.0f} s")
        finally:
            async with http.delete(f"{base}/v2/transcript/{job}") as r:
                if r.status >= 300:
                    print(f"warning: {path.name}: vendor copy not deleted ({r.status})", file=sys.stderr)


def live_stt(it: Item) -> tuple[stt.STT, str]:
    """The STT production would open for this item's track: scribe/job.py
    diarizes the room's shared microphone (spec §4.3) and only that one."""
    from scribe.stt import make_stt

    provider = os.environ.get("SCRIBE_STT_PROVIDER", "assemblyai")
    return make_stt(provider, it.keyterms, diarize=it.mic == "room"), provider


def _p(values: list[float], q: float) -> float | None:
    if not values:
        return None
    return statistics.quantiles(values, n=100, method="inclusive")[q - 1] if len(values) > 1 else values[0]


async def _hypotheses(args: argparse.Namespace, items: list[Item], paths: list[str]) -> dict:
    """{(id, path): {"text", ...live stats}}, from the cache in --out or fresh."""
    out_dir, got, vad = Path(args.out), {}, None
    for it in items:
        for p in paths:
            txt, stats = out_dir / f"{it.id}.{p}.txt", out_dir / f"{it.id}.{p}.json"
            if txt.is_file() and not args.fresh:
                got[it.id, p] = {"text": txt.read_text(encoding="utf-8")} | (
                    json.loads(stats.read_text(encoding="utf-8")) if stats.is_file() else {}
                )
                continue
            if p == "live":
                if vad is None:
                    from livekit.plugins import silero

                    vad = silero.VAD.load()
                impl, provider = live_stt(it)
                run = await replay_live(it.audio, stt_impl=impl, vad=vad, speed=args.speed)
                rec = asdict(run) | {"speed": args.speed, "provider": provider}
            else:
                key = os.environ.get("ASSEMBLYAI_API_KEY", "")
                if not key:
                    raise SystemExit("ASSEMBLYAI_API_KEY is required for the batch path")
                base = os.environ.get("AI_MEETING_TRANSCRIBE_BASE_URL") or "https://api.assemblyai.com"
                rec = {"text": await transcribe_batch(it.audio, api_key=key, base_url=base)}
            txt.write_text(rec["text"], encoding="utf-8")
            if p == "live":
                stats.write_text(json.dumps({k: v for k, v in rec.items() if k != "text"}), encoding="utf-8")
            got[it.id, p] = rec
            print(f"{it.id} {p}: {len(rec['text'].split())} words", file=sys.stderr)
    return got


def _report(args, items, scored, all_slices, hyps, hours, passed, reasons) -> str:
    fmt = lambda v: "—" if v is None else f"{v:.1%}"  # noqa: E731
    lines = [
        "# Kết quả bộ đánh giá STT",
        "",
        f"Manifest: `{args.manifest}` · {len(items)} bản ghi · {hours:.2f} giờ âm thanh · "
        f"ngưỡng: WER ≤ {args.max_wer:.0%}, thực thể ≥ {args.min_entity_recall:.0%}, "
        f"p95 độ trễ ≤ {args.max_p95_latency:g} s, ≥ {args.min_hours:g} giờ",
        "",
        f"**Kết quả: {'Đạt' if passed else 'Không đạt'}**",
        *[f"- {r}" for r in reasons],
        "",
        "| Đường | Lát cắt | Bản ghi | Từ | WER | Thực thể |",
        "|---|---|---|---|---|---|",
        *[
            f"| {s.path} | {s.key} | {s.items} | {s.words} | {fmt(s.wer)} | {fmt(s.entity_recall)} |"
            for s in all_slices
        ],
        "",
        "| Bản ghi | Đường | Giọng | Micro | WER | Thực thể |",
        "|---|---|---|---|---|---|",
        *[
            f"| {s.id} | {s.path} | {s.accent} | {s.mic} | {fmt(s.errors / s.words if s.words else None)} | "
            f"{s.found}/{s.entities} |"
            for s in scored
        ],
    ]
    live = [h for (_, p), h in hyps.items() if p == "live" and "latencies_s" in h]
    if live:
        lat = [x for h in live for x in h["latencies_s"]]
        session, speech = sum(h["session_ms"] for h in live), sum(h["speech_ms"] for h in live)
        p50, p95 = _p(lat, 50), _p(lat, 95)
        lines += [
            "",
            f"Live: độ trễ từ hết câu tới bản chốt p50 {p50 or 0:.2f} s, p95 {p95 or 0:.2f} s "
            f"(tốc độ phát {live[0].get('speed')}); phiên STT / giây nói = "
            f"{session / speech if speech else 0:.2f} (nhà cung cấp tính tiền theo thời gian mở phiên).",
        ]
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m eval.run", description=__doc__.split("\n")[0])
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--path", choices=["live", "batch", "both"], default="both")
    ap.add_argument("--speed", type=float, default=1.0, help="live replay speed; 1 = real time")
    ap.add_argument("--fresh", action="store_true", help="transcribe again instead of reusing --out")
    # The launch bar (README "Cổng bật cờ"); changing it is an owner decision.
    ap.add_argument("--max-wer", type=float, default=0.25)
    ap.add_argument("--min-entity-recall", type=float, default=0.80)
    ap.add_argument("--max-p95-latency", type=float, default=4.0)
    ap.add_argument("--min-hours", type=float, default=2.0)
    args = ap.parse_args(argv)
    try:
        items = load_manifest(Path(args.manifest))
    except (ValueError, OSError, json.JSONDecodeError) as e:
        print(f"manifest: {e}", file=sys.stderr)
        return 2
    paths = ["live", "batch"] if args.path == "both" else [args.path]
    Path(args.out).mkdir(parents=True, exist_ok=True)
    hyps = asyncio.run(_hypotheses(args, items, paths))
    scored = []
    for it in items:
        ref = it.reference.read_text(encoding="utf-8")
        for p in paths:
            errors, words = word_errors(ref, hyps[it.id, p]["text"])
            found, total = entity_recall(it.entities, hyps[it.id, p]["text"])
            scored.append(Scored(it.id, it.accent, it.mic, p, errors, words, found, total))
    all_slices = slices(scored)
    passed, reasons = gate(all_slices, max_wer=args.max_wer, min_entity_recall=args.min_entity_recall)
    hours = sum(read_frames(it.audio)[1] for it in items) / 3600
    if hours < args.min_hours:
        reasons.append(f"chỉ có {hours:.2f} giờ âm thanh, cần ≥ {args.min_hours:g} giờ")
    # The launch gate scores both paths; a run of one is a measurement, never a pass.
    for p in ("live", "batch"):
        if p not in paths:
            reasons.append(f"chưa chạy đường {p}: cổng bật cờ cần cả hai (--path both)")
    if "live" in paths:
        live = [h for (_, p), h in hyps.items() if p == "live" and h.get("speed") == 1.0]
        lat = [x for h in live for x in h.get("latencies_s", [])]
        if (p95 := _p(lat, 95)) is None:
            reasons.append("live: chưa đo độ trễ ở --speed 1 (thời gian thực)")
        elif p95 > args.max_p95_latency:
            reasons.append(f"live: p95 độ trễ {p95:.2f} s > {args.max_p95_latency:g} s")
    passed = not reasons
    out = Path(args.out)
    (out / "report.md").write_text(_report(args, items, scored, all_slices, hyps, hours, passed, reasons), "utf-8")
    results = {
        "passed": passed,
        "reasons": reasons,
        "hours": hours,
        "slices": [asdict(s) | {"wer": s.wer, "entity_recall": s.entity_recall} for s in all_slices],
        "items": [asdict(s) for s in scored],
    }
    (out / "results.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), "utf-8")
    print(f"{'PASS' if passed else 'FAIL'}: {out / 'report.md'}", file=sys.stderr)
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
