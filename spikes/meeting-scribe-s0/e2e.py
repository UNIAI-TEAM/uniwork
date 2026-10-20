"""S0 spike (UNI-2022) end-to-end check against a local LiveKit + a running agent.py.

Room A (uw_mtg_<a>): alice and bob speak (macOS `say` audio), watcher reads captions;
the Go program dispatches `uniwork-scribe` here only.
Room B: carol speaks, no dispatch -> no agent may join (agent_name disables auto dispatch).
Room C: dave speaks, dispatch with invalid metadata -> agent must reject the job.
Alice speaks again after IDLE_CLOSE_S + 3 s of silence, across the STT session close.
Exits non-zero on any failed assertion and prints latency numbers.
"""

from __future__ import annotations

import asyncio
import os
import statistics
import subprocess
import sys
import tempfile
import time
import wave
from pathlib import Path

import numpy as np
from livekit import api, rtc

HERE = Path(__file__).parent
URL, KEY, SECRET = (os.environ[k] for k in ("LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"))
IDLE_CLOSE_S = float(os.environ.get("SCRIBE_IDLE_CLOSE_S", "30"))
SR, FRAME = 48000, 480  # 10 ms frames
AGENT_KIND = rtc.ParticipantKind.PARTICIPANT_KIND_AGENT

PHRASES = {
    "a1": "We should ship the scribe agent next sprint",
    "b1": "I will write the dispatch code tomorrow morning",
    "a2": "Please add the keyterms from the meeting title",
    "b2": "The captions must show the right speaker name",
    "a3": "After a long silence the session opens again",
}


def speech(key: str, tmp: Path) -> np.ndarray:
    out = tmp / f"{key}.wav"
    subprocess.run(
        ["say", "-o", str(out), "--file-format=WAVE", f"--data-format=LEI16@{SR}", PHRASES[key]],
        check=True,
    )
    with wave.open(str(out)) as w:
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)


def token(identity: str, room: str) -> str:
    return (
        api.AccessToken(KEY, SECRET)
        .with_identity(identity)
        .with_name(identity.removeprefix("uw_participant_"))
        .with_grants(api.VideoGrants(room_join=True, room=room))
        .to_jwt()
    )


async def join(identity: str, room_name: str) -> rtc.Room:
    room = rtc.Room()
    await room.connect(URL, token(identity, room_name))
    return room


async def speaker(room: rtc.Room, schedule: list[tuple[float, np.ndarray]], t0: float, until: float,
                  windows: list[tuple[float, float]]) -> None:
    """Publish a mic track; play each clip at t0+offset, silence otherwise, paced in real time."""
    src = rtc.AudioSource(SR, 1)
    track = rtc.LocalAudioTrack.create_audio_track("mic", src)
    await room.local_participant.publish_track(
        track, rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
    )
    pending = sorted(schedule, key=lambda x: x[0])
    clip, pos = None, 0
    n = 0
    while True:
        now = t0 + n * FRAME / SR
        if now >= until:
            break
        if clip is None and pending and now >= t0 + pending[0][0]:
            clip, pos = pending.pop(0)[1], 0
            windows.append((time.time(), time.time() + len(clip) / SR))
        if clip is not None:
            chunk = clip[pos : pos + FRAME]
            pos += FRAME
            if pos >= len(clip):
                clip = None
            chunk = np.pad(chunk, (0, FRAME - len(chunk)))
        else:
            chunk = np.zeros(FRAME, dtype=np.int16)
        f = rtc.AudioFrame.create(SR, 1, FRAME)
        np.copyto(np.frombuffer(f.data, dtype=np.int16), chunk)
        await src.capture_frame(f)
        n += 1
        lag = (t0 + n * FRAME / SR) - time.time()
        if lag > 0:
            await asyncio.sleep(lag)


def dispatch(meeting: str, metadata: str = "") -> float:
    args = ["go", "run", ".", "-meeting", meeting] + (["-metadata", metadata] if metadata else [])
    t = time.time()
    out = subprocess.run(args, cwd=HERE / "dispatch", check=True, capture_output=True, text=True)
    print(out.stdout.strip())
    return t


def agents_in(room: rtc.Room) -> list[rtc.RemoteParticipant]:
    return [p for p in room.remote_participants.values() if p.kind == AGENT_KIND]


async def main() -> int:
    tag = str(int(time.time()))
    ids = {"A": f"s0a{tag}", "B": f"s0b{tag}", "C": f"s0c{tag}"}
    tmp = Path(tempfile.mkdtemp(prefix="s0-"))
    clips = {k: speech(k, tmp) for k in PHRASES}

    watcher = await join("uw_participant_watcher", "uw_mtg_" + ids["A"])
    alice = await join("uw_participant_alice", "uw_mtg_" + ids["A"])
    bob = await join("uw_participant_bob", "uw_mtg_" + ids["A"])
    carol = await join("uw_participant_carol", "uw_mtg_" + ids["B"])
    dave = await join("uw_participant_dave", "uw_mtg_" + ids["C"])

    captions: list[dict] = []
    agent_joined = asyncio.Event()

    def on_caption(reader: rtc.TextStreamReader, sender: str) -> None:
        idx = len(captions)
        rec = {"idx": idx, "sender": sender, "attrs": dict(reader.info.attributes)}
        captions.append(rec)

        async def read() -> None:
            rec["text"] = await reader.read_all()
            rec["recv_ns"] = time.time_ns()

        asyncio.ensure_future(read())

    watcher.register_text_stream_handler("uw.caption", on_caption)
    watcher.on("participant_connected", lambda p: p.kind == AGENT_KIND and agent_joined.set())

    # Speech schedule (seconds after t0); dispatch happens at ~2 s.
    t_last = 16 + 6 + IDLE_CLOSE_S + 3
    alice_sched = [(6, clips["a1"]), (16, clips["a2"]), (t_last, clips["a3"])]
    bob_sched = [(11, clips["b1"]), (21, clips["b2"])]
    end = t_last + 8
    t0 = time.time() + 1
    win = {"alice": [], "bob": [], "carol": [], "dave": []}
    tasks = [
        asyncio.create_task(speaker(alice, alice_sched, t0, t0 + end, win["alice"])),
        asyncio.create_task(speaker(bob, bob_sched, t0, t0 + end, win["bob"])),
        asyncio.create_task(speaker(carol, [(6, clips["b1"]), (16, clips["a2"])], t0, t0 + end, win["carol"])),
        asyncio.create_task(speaker(dave, [(6, clips["a1"])], t0, t0 + end, win["dave"])),
    ]

    await asyncio.sleep(2.5)
    failures: list[str] = []

    def check(ok: bool, msg: str) -> None:
        print(("PASS " if ok else "FAIL ") + msg)
        if not ok:
            failures.append(msg)

    check(not agents_in(watcher), "no agent in room A before CreateDispatch (no automatic dispatch)")
    t_dispatch = await asyncio.to_thread(dispatch, ids["A"])
    await asyncio.to_thread(dispatch, ids["C"], '{"meeting_id":"wrong"}')
    try:
        await asyncio.wait_for(agent_joined.wait(), 20)
        print(f"agent joined room A {time.time() - t_dispatch:.2f} s after CreateDispatch started")
    except asyncio.TimeoutError:
        pass
    agents = agents_in(watcher)
    check(len(agents) == 1, f"exactly one AGENT-kind participant in room A (got {len(agents)})")
    if agents:
        a = agents[0]
        check(a.identity == "uw_agent_scribe" and a.name == "UniWork AI"
              and a.attributes.get("uw.kind") == "scribe",
              f"agent identity/name/attribute ({a.identity!r}, {a.name!r}, {a.attributes})")
        check(a.permissions.can_publish is False and a.permissions.can_publish_data is True
              and a.permissions.hidden is False, f"agent permissions {a.permissions}")

    await asyncio.gather(*tasks)
    await asyncio.sleep(3)

    check(not agents_in(carol), "room B (people, no dispatch): no agent")
    check(not agents_in(dave), "room C (dispatch with invalid metadata): agent rejected the job")
    check(not any(c["sender"] for c in captions if c["sender"] != "uw_agent_scribe"), "captions only from agent")

    finals = [c for c in captions if c["attrs"].get("uw.final") == "1"]
    by_who: dict[str, list[dict]] = {}
    for c in finals:
        by_who.setdefault(c["attrs"]["uw.participant_identity"], []).append(c)
    n_alice, n_bob = len(by_who.get("uw_participant_alice", [])), len(by_who.get("uw_participant_bob", []))
    check(n_alice == 3 and n_bob == 2, f"one final per utterance: alice {n_alice}/3, bob {n_bob}/2")
    check(set(by_who) <= {"uw_participant_alice", "uw_participant_bob"}, f"identities {sorted(by_who)}")

    # Identity: every caption arrives while its owner speaks (or within 2 s after), never the other.
    def owner_at(t: float) -> set[str]:
        return {who for who, ws in win.items() if any(s <= t <= e + 2.0 for s, e in ws)}

    wrong = [c for c in captions
             if c["attrs"]["uw.participant_identity"].removeprefix("uw_participant_") not in owner_at(c["recv_ns"] / 1e9)]
    check(not wrong, f"every caption falls in its speaker's window ({len(captions)} captions, {len(wrong)} outside)")

    # Order: per segment, interims then exactly one final, last; segments increase per track.
    segs: dict[str, list[dict]] = {}
    for c in captions:
        segs.setdefault(c["attrs"]["uw.segment_id"], []).append(c)
    bad = [s for s, cs in segs.items()
           if [x["attrs"]["uw.final"] for x in cs].count("1") != 1 or cs[-1]["attrs"]["uw.final"] != "1"]
    check(not bad, f"{len(segs)} segments, each interim* then one final ({bad})")
    per_track: dict[str, list[int]] = {}
    for c in captions:
        trk, n = c["attrs"]["uw.segment_id"].rsplit("-", 1)
        per_track.setdefault(trk, []).append(int(n))
    check(all(v == sorted(v) for v in per_track.values()), "segment numbers non-decreasing per track")
    check(all(c["attrs"].get("uw.language") == "vi" for c in captions), "uw.language=vi")
    reopen_at = win["alice"][-1][0] if len(win["alice"]) == 3 else float("inf")
    a3 = [c for c in by_who.get("uw_participant_alice", []) if c["recv_ns"] / 1e9 >= reopen_at]
    a_segs = [c["attrs"]["uw.segment_id"] for c in by_who.get("uw_participant_alice", [])]
    check(len(a3) == 1 and len(set(a_segs)) == len(a_segs),
          f"utterance after the idle close gets its final, segment ids stay unique ({a_segs})")
    voiced = [c for c in finals if c.get("text")]
    check(len(voiced) == len(finals), "every final carries text")

    for kind, flag in (("interim", "0"), ("final", "1")):
        lat = sorted((c["recv_ns"] - int(c["attrs"]["uw.spike_emit_ns"])) / 1e6
                     for c in captions if c["attrs"]["uw.final"] == flag and "recv_ns" in c)
        if lat:
            p95 = lat[min(len(lat) - 1, int(len(lat) * 0.95))]
            print(f"latency {kind}: n={len(lat)} p50={statistics.median(lat):.1f} ms "
                  f"p95={p95:.1f} ms max={lat[-1]:.1f} ms")

    for r in (watcher, alice, bob, carol, dave):
        await r.disconnect()
    print("RESULT", "FAIL" if failures else "PASS", f"({len(failures)} failed)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
