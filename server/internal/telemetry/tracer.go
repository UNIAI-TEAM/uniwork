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
	// connection attempt; spans are still created so every request has a
	// trace id (X-Trace-Id, correlation_id) even on a deployment without a
	// collector.
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
	ratio := 1.0
	if cfg.SamplerArg != "" {
		if f, err := strconv.ParseFloat(cfg.SamplerArg, 64); err == nil && f >= 0 && f <= 1 {
			ratio = f
		}
	}
	// Schemaless on purpose: resource.Default() carries the SDK's own schema
	// URL and Merge refuses two different ones.
	res, err := resource.Merge(resource.Default(), resource.NewSchemaless(
		semconv.ServiceName(cfg.ServiceName),
		semconv.ServiceVersion(cfg.Version),
	))
	if err != nil {
		return nil, err
	}
	opts := []sdktrace.TracerProviderOption{
		sdktrace.WithResource(res),
		sdktrace.WithSampler(debugSampler{sdktrace.ParentBased(sdktrace.TraceIDRatioBased(ratio))}),
	}
	if cfg.Endpoint != "" {
		exp, err := otlptracegrpc.New(ctx, otlptracegrpc.WithEndpointURL(cfg.Endpoint))
		if err != nil {
			return nil, err
		}
		opts = append(opts, sdktrace.WithBatcher(exp, sdktrace.WithBatchTimeout(2*time.Second)))
		log.Info("otel tracing enabled", "endpoint", cfg.Endpoint, "sampler_ratio", ratio)
	}
	tp := sdktrace.NewTracerProvider(opts...)
	otel.SetTracerProvider(tp)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(propagation.TraceContext{}, propagation.Baggage{}))
	return tp.Shutdown, nil
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
