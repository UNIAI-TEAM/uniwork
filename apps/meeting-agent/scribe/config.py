"""Agent settings from the environment (spec §4.6). LIVEKIT_URL, LIVEKIT_API_KEY and
LIVEKIT_API_SECRET are read by livekit-agents itself."""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    agent_name: str
    api_url: str
    stt_provider: str
    idle_close_s: float
    health_port: int
    metrics_port: int
    metrics_dir: str
    idle_processes: int
    drain_timeout_s: int


def load() -> Settings:
    return Settings(
        agent_name=os.environ.get("MEETING_SCRIBE_AGENT_NAME", "uniwork-scribe"),
        api_url=os.environ.get("UNIWORK_API_URL", "http://localhost:8080").rstrip("/"),
        stt_provider=os.environ.get("SCRIBE_STT_PROVIDER", "fake"),
        idle_close_s=float(os.environ.get("SCRIBE_IDLE_CLOSE_S", "30")),
        health_port=int(os.environ.get("SCRIBE_HEALTH_PORT", "8081")),
        metrics_port=int(os.environ.get("SCRIBE_METRICS_PORT", "9100")),
        metrics_dir=os.environ.get("PROMETHEUS_MULTIPROC_DIR", "/tmp/scribe-metrics"),
        # Spec §4.6: warm processes per CPU; a job is one process.
        idle_processes=int(os.environ.get("SCRIBE_IDLE_PROCESSES", str(os.cpu_count() or 2))),
        # Spec §4.6: a draining pod lets every meeting it serves end (4 h),
        # equal to terminationGracePeriodSeconds in the chart.
        drain_timeout_s=int(os.environ.get("SCRIBE_DRAIN_TIMEOUT_S", "14400")),
    )
