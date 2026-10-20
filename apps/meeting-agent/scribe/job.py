"""Pure rules of a job: which dispatch to accept, whom to transcribe."""

from __future__ import annotations

import json

AGENT_IDENTITY = "uw_agent_scribe"
AGENT_NAME = "UniWork AI"
ROOM_PREFIX = "uw_mtg_"
TOKEN_PREFIX = "uwma_"


def parse_metadata(metadata: str | None, room_name: str) -> dict | None:
    """The job metadata the server signed into the dispatch (spec D6), or None to
    reject the job: the agent never joins a room nobody asked it into."""
    try:
        meta = json.loads(metadata or "")
    except ValueError:
        return None
    if not isinstance(meta, dict):
        return None
    meeting_id, token = meta.get("meeting_id"), meta.get("token")
    if not isinstance(meeting_id, str) or not meeting_id or not isinstance(token, str):
        return None
    if not token.startswith(TOKEN_PREFIX) or room_name != ROOM_PREFIX + meeting_id:
        return None
    locale = meta.get("locale")
    return {"meeting_id": meeting_id, "token": token, "locale": locale if isinstance(locale, str) and locale else "vi"}


def should_transcribe(identity: str, is_agent: bool, is_egress: bool) -> bool:
    """People only: other agents (this one included) and egress recorders are not
    speakers (spec §4.1)."""
    return not (is_agent or is_egress or identity.startswith("uw_agent_"))
