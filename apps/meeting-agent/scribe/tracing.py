"""OpenTelemetry for the agent (spec §4.6): spans of livekit-agents go to the
collector at OTEL_EXPORTER_OTLP_ENDPOINT (gRPC, like the API's); without it
nothing is installed and tracing stays a no-op."""

from __future__ import annotations

import os


def setup_tracing() -> bool:
    if not os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT"):
        return False
    from livekit.agents.telemetry import set_tracer_provider
    from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    provider = TracerProvider(resource=Resource.create({"service.name": "uniwork-meeting-agent"}))
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    # allow_pii=False: spans never carry what people said.
    set_tracer_provider(provider, allow_pii=False)
    return True
