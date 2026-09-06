package telemetry

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
	"go.opentelemetry.io/otel/trace"
)

// TraceHeader is returned on every response so support can ask a user for
// the id and find the trace, the log lines and the audit rows behind it.
const TraceHeader = "X-Trace-Id"

// DebugTraceHeader forces sampling of the request (spec F-11 §6.1).
const DebugTraceHeader = "X-Debug-Trace"

// HTTP is the outermost router middleware: starts the server span from the
// incoming traceparent (or a new trace), attaches the Fields holder, writes
// X-Trace-Id, and once routing is done names the span by chi route pattern
// (never the raw path — cardinality).
func HTTP(next http.Handler) http.Handler {
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := WithFields(r.Context())
		span := trace.SpanFromContext(ctx)
		if id := TraceID(ctx); id != "" {
			w.Header().Set(TraceHeader, id)
		}
		next.ServeHTTP(w, r.WithContext(ctx))
		if rctx := chi.RouteContext(ctx); rctx != nil {
			if p := rctx.RoutePattern(); p != "" {
				span.SetName(r.Method + " " + p)
				span.SetAttributes(semconv.HTTPRoute(p))
			}
		}
	})
	otel := otelhttp.NewHandler(inner, "http",
		otelhttp.WithFilter(func(r *http.Request) bool { return !isProbe(r.URL.Path) }),
		otelhttp.WithSpanNameFormatter(func(_ string, r *http.Request) string { return r.Method }),
	)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get(DebugTraceHeader) == "1" {
			r = r.WithContext(WithDebugTrace(r.Context()))
		}
		otel.ServeHTTP(w, r)
	})
}

func isProbe(path string) bool {
	return path == "/healthz" || path == "/readyz" || path == "/health"
}
