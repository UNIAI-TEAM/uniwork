"""Keyterms from the meeting context (spec §4.2, A2): names and titles the STT
should spell right. AssemblyAI takes at most 100 terms of up to 50 characters."""

from __future__ import annotations

MAX_TERMS = 100
MAX_TERM_CHARS = 50


def build_keyterms(context: dict, limit: int = MAX_TERMS) -> list[str]:
    candidates = [
        context.get("meeting_title"),
        context.get("project_name"),
        context.get("workspace_name"),
        *(context.get("participant_names") or []),
    ]
    out: list[str] = []
    seen: set[str] = set()
    for c in candidates:
        term = " ".join(str(c or "").split())
        if not term or len(term) > MAX_TERM_CHARS or term.casefold() in seen:
            continue
        seen.add(term.casefold())
        out.append(term)
        if len(out) == limit:
            break
    return out
