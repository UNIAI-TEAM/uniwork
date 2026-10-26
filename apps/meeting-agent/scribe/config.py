"""Agent settings from the environment (spec §4.6). LIVEKIT_URL, LIVEKIT_API_KEY and
LIVEKIT_API_SECRET are read by livekit-agents itself."""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass

STT_US = "wss://streaming.assemblyai.com"
STT_EU = "wss://streaming.eu.assemblyai.com"


def stt_base_url(env: Mapping[str, str]) -> str:
    """Live STT goes to the region batch transcription uses (spec parent §7.5:
    one region, one dossier): SCRIBE_STT_BASE_URL when set, else the EU host
    when AI_MEETING_TRANSCRIBE_BASE_URL is AssemblyAI's EU API, else the US."""
    explicit = env.get("SCRIBE_STT_BASE_URL", "").strip()
    if explicit:
        return explicit.rstrip("/")
    return STT_EU if ".eu." in env.get("AI_MEETING_TRANSCRIBE_BASE_URL", "") else STT_US


@dataclass(frozen=True)
class Settings:
    agent_name: str
    api_url: str
    stt_provider: str
    stt_base_url: str
    idle_close_s: float
    health_port: int
    metrics_port: int
    metrics_dir: str
    drain_timeout_s: int


def load() -> Settings:
    return Settings(
        agent_name=os.environ.get("MEETING_SCRIBE_AGENT_NAME", "uniwork-scribe"),
        api_url=os.environ.get("UNIWORK_API_URL", "http://localhost:8080").rstrip("/"),
        stt_provider=os.environ.get("SCRIBE_STT_PROVIDER", "fake"),
        stt_base_url=stt_base_url(os.environ),
        idle_close_s=float(os.environ.get("SCRIBE_IDLE_CLOSE_S", "30")),
        health_port=int(os.environ.get("SCRIBE_HEALTH_PORT", "8081")),
        metrics_port=int(os.environ.get("SCRIBE_METRICS_PORT", "9100")),
        metrics_dir=os.environ.get("PROMETHEUS_MULTIPROC_DIR", "/tmp/scribe-metrics"),
        # Spec §4.6: a draining pod lets every meeting it serves end (4 h),
        # two minutes under terminationGracePeriodSeconds (14400 s in the chart)
        # so a job the drain cuts off can still post /agent/finished.
        drain_timeout_s=int(os.environ.get("SCRIBE_DRAIN_TIMEOUT_S", "14280")),
    )
