"""Agent metrics (spec §4.6): Prometheus, served by the worker on
SCRIBE_METRICS_PORT. Jobs run in child processes, so the worker uses the
client's multiprocess mode (AgentServer prometheus_multiproc_dir); counters
and the histogram aggregate across them, the gauge sums live processes."""

from __future__ import annotations

from prometheus_client import Counter, Gauge, Histogram

JOBS_RUNNING = Gauge("scribe_jobs_running", "Meetings this worker is transcribing.", multiprocess_mode="livesum")
STT_LATENCY = Histogram(
    "scribe_stt_final_latency_seconds",
    "From the VAD's end of speech to the STT final of that turn.",
    buckets=(0.1, 0.25, 0.5, 1, 2, 4, 8),
)
STT_ERRORS = Counter("scribe_stt_errors_total", "STT sessions that failed and were dropped.")
SEGMENTS = Counter("scribe_segments_total", "Final segments produced.")
SPEECH_SECONDS = Counter("scribe_speech_seconds_total", "Seconds of speech (VAD) in final segments.")
