"""S0 self-check: closing an STT session with speech still pending loses no text.

Pushes 1.6 s of voiced audio with no flush (an open turn), then closes the
session the way agent.py does on idle (end_input, then drain until the stream
ends) and asserts the pending turn arrives as a final. AssemblyAI behaves the
same per its docs: after Terminate the server flushes the last Turn before
Termination, and the plugin keeps reading until the socket closes.
"""

import asyncio

import numpy as np
from livekit import rtc

from agent import FakeSTT


async def main() -> None:
    s = FakeSTT().stream()
    for _ in range(160):  # 160 x 10 ms of a loud tone
        f = rtc.AudioFrame.create(16000, 1, 160)
        np.copyto(np.frombuffer(f.data, dtype=np.int16), np.full(160, 3000, dtype=np.int16))
        s.push_frame(f)
    events = []

    async def drain() -> None:
        async for ev in s:
            events.append((ev.type.value, ev.alternatives[0].text))

    task = asyncio.create_task(drain())
    s.end_input()
    await task
    await s.aclose()
    finals = [t for k, t in events if k == "final_transcript"]
    assert finals == ["từ1 từ2 từ3"], events
    print("PASS pending turn delivered as a final on close:", events[-1])


asyncio.run(main())
