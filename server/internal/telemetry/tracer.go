// Package telemetry is the OpenTelemetry seam of the server (spec F-11 §6.1):
// tracer provider, HTTP instrumentation, the per-request tenant/actor holder
// that span attributes and log lines read from, and the slog handler that
// stamps trace_id on every line written with a context.
//
// The package is a leaf: it imports OpenTelemetry and nothing else from the
// server, so middleware, service and logger can all reach it without a cycle.
package telemetry

import (
	"context"
	"log/slog"
	"os"
	"strconv"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracegrpc"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
	"go.opentelemetry.io/otel/trace"
)

// Config is read from the OTEL_* variables listed in .env.example.
type Config struct {
	// Endpoint is OTEL_EXPORTER_OTLP_ENDPOINT. Empty means no exporter and no
	// connection attempt; spans still carry a trace id so every request has
	// one (X-Trace-Id, correlation_id) even on a deployment without a
	// collector, but nothing is recorded because nothing would read it.
	Endpoint    string
	ServiceName string
	Version     string
	// SamplerArg is OTEL_TRACES_SAMPLER_ARG, the parent-based ratio. Empty is
	// 1.0: OPEN_QUESTIONS O3 keeps 100% until there are more than five tenants.
	SamplerArg string
}

// ConfigFromEnv reads the OTEL_* variables; version is the build version
// main.go passes so the resource carries it.
func ConfigFromEnv(version string) Config {
	name := os.Getenv("OTEL_SERVICE_NAME")
	if name == "" {
		name = "uniwork-api"
	}
	return Config{
		Endpoint:    os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT"),
		ServiceName: name,
		Version:     version,
		SamplerArg:  os.Getenv("OTEL_TRACES_SAMPLER_ARG"),
	}
}

// Init installs the global tracer provider and W3C propagator and returns
// the function main.go calls during shutdown. It never fails on a missing
// collector: the exporter connects lazily and drops batches it cannot send.
func Init(ctx context.Context, cfg Config, log *slog.Logger) (func(context.Context) error, error) {
	var proc sdktrace.SpanProcessor
	if cfg.Endpoint != "" {
		exp, err := otlptracegrpc.New(ctx, otlptracegrpc.WithEndpointURL(cfg.Endpoint))
		if err != nil {
			return nil, err
		}
		proc = sdktrace.NewBatchSpanProcessor(exp, sdktrace.WithBatchTimeout(2*time.Second))
		log.Info("otel tracing enabled", "endpoint", cfg.Endpoint, "sampler_ratio", samplerRatio(cfg.SamplerArg))
	}
	return install(cfg, proc)
}

// install builds the provider around proc, the one place spans go. A nil
// proc means no exporter: the sampler then drops every span, so a request
// pays for a trace id and a non-recording span instead of a recorded span
// (with its SQL and Redis children) that is thrown away at End.
func install(cfg Config, proc sdktrace.SpanProcessor) (func(context.Context) error, error) {
	// Schemaless on purpose: resource.Default() carries the SDK's own schema
	// URL and Merge refuses two different ones.
	res, err := resource.Merge(resource.Default(), resource.NewSchemaless(
		semconv.ServiceName(cfg.ServiceName),
		semconv.ServiceVersion(cfg.Version),
	))
	if err != nil {
		return nil, err
	}
	// NeverSample, not ParentBased(NeverSample): a sampled traceparent from
	// upstream would otherwise make this process record spans nobody exports.
	// The SDK still mints (or continues) the trace id before it asks the
	// sampler, so X-Trace-Id and correlation_id are unchanged.
	sampler := sdktrace.NeverSample()
	opts := []sdktrace.TracerProviderOption{sdktrace.WithResource(res)}
	if proc != nil {
		sampler = debugSampler{sdktrace.ParentBased(sdktrace.TraceIDRatioBased(samplerRatio(cfg.SamplerArg)))}
		opts = append(opts, sdktrace.WithSpanProcessor(proc))
	}
	tp := sdktrace.NewTracerProvider(append(opts, sdktrace.WithSampler(sampler))...)
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(propagation.TraceContext{}, propagation.Baggage{}))
	return tp.Shutdown, nil
}

// samplerRatio parses OTEL_TRACES_SAMPLER_ARG; empty or out of [0,1] is 1.0.
func samplerRatio(arg string) float64 {
	if arg != "" {
		if f, err := strconv.ParseFloat(arg, 64); err == nil && f >= 0 && f <= 1 {
			return f
		}
	}
	return 1.0
}

// debugSampler forces a sample when the request carried X-Debug-Trace: 1
// (marked on the context by the HTTP middleware) and otherwise defers to the
// configured parent-based ratio.
//
// ponytail: any bearer holder can set the header; with ratio 1.0 (O3) it is a
// no-op today. Restrict to platform_role when the ratio drops below 1.
type debugSampler struct{ base sdktrace.Sampler }

func (s debugSampler) ShouldSample(p sdktrace.SamplingParameters) sdktrace.SamplingResult {
	if forced, _ := p.ParentContext.Value(debugTraceKey{}).(bool); forced {
		return sdktrace.SamplingResult{
			Decision:   sdktrace.RecordAndSample,
			Tracestate: trace.SpanContextFromContext(p.ParentContext).TraceState(),
		}
	}
	return s.base.ShouldSample(p)
}

func (s debugSampler) Description() string { return "uniwork-debug(" + s.base.Description() + ")" }

type debugTraceKey struct{}

// WithDebugTrace marks ctx so the sampler records the span regardless of ratio.
func WithDebugTrace(ctx context.Context) context.Context {
	return context.WithValue(ctx, debugTraceKey{}, true)
}
