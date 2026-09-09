#!/usr/bin/env python3
"""LiveKit STT worker → UniWork POST /meetings/{id}/transcript/agent.

Run: python agent.py dev
Requires livekit-agents + deepgram plugin (see requirements.txt).
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone

import httpx
from dotenv import load_dotenv
from livekit.agents import JobContext, WorkerOptions, cli

load_dotenv()

log = logging.getLogger("meeting-stt-agent")
ROOM_PREFIX = "uw_mtg_"

api_url = os.environ.get("UNIWORK_API_URL", "").rstrip("/")
agent_secret = os.environ.get("MEETING_STT_AGENT_SECRET", "")


def meeting_id_from_room(room_name: str) -> str | None:
    if not room_name.startswith(ROOM_PREFIX):
        return None
    return room_name[len(ROOM_PREFIX) :]


async def post_segment(
    client: httpx.AsyncClient,
    meeting_id: str,
    identity: str,
    speaker: str,
    text: str,
) -> None:
    if not api_url or not agent_secret:
        log.warning("UNIWORK_API_URL or MEETING_STT_AGENT_SECRET not set; dropping segment")
        return
    payload = {
        "participant_identity": identity,
        "speaker_name": speaker,
        "text": text,
        "spoken_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    url = f"{api_url}/api/v1/meetings/{meeting_id}/transcript/agent"
    resp = await client.post(
        url,
        json=payload,
        headers={"X-Meeting-Agent-Secret": agent_secret},
        timeout=15.0,
    )
    if resp.status_code >= 400:
        log.error("ingest failed %s: %s", resp.status_code, resp.text)


async def entrypoint(ctx: JobContext) -> None:
    """Join a UniWork meeting room and forward STT segments to the control plane.

    Wire Deepgram (or another STT plugin) in this entrypoint following LiveKit
    Agents docs: subscribe audio tracks, emit final transcripts, call post_segment().
    """
    import asyncio

    meeting_id = meeting_id_from_room(ctx.room.name)
    if not meeting_id:
        log.warning("skip room %s (not a UniWork meeting room)", ctx.room.name)
        return

    await ctx.connect()
    log.info("joined room %s meeting=%s — attach STT pipeline here", ctx.room.name, meeting_id)

    done = asyncio.Event()

    @ctx.room.on("disconnected")
    def _on_disconnect(*_args: object) -> None:
        done.set()

    async with httpx.AsyncClient() as client:
        _ = client  # use in STT handlers: await post_segment(client, meeting_id, ...)
        await done.wait()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
