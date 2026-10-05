package telemetry

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"
)

func recorder(t *testing.T, ratio string) *tracetest.SpanRecorder {
	t.Helper()
	sr := tracetest.NewSpanRecorder()
	// The recorder stands in for the exporter's batch processor.
	shutdown, err := install(Config{ServiceName: "test", SamplerArg: ratio}, sr)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = shutdown(context.Background()) })
	return sr
}

func router(t *testing.T) (chi.Router, *[]Fields) {
	t.Helper()
	var seen []Fields
	r := chi.NewRouter()
	r.Use(HTTP)
	r.Get("/ws/{id}", func(w http.ResponseWriter, req *http.Request) {
		SetActor(req.Context(), "u1", "human", "web")
		SetTenant(req.Context(), "org1", chi.URLParam(req, "id"))
		seen = append(seen, Snapshot(req.Context()))
		w.WriteHeader(http.StatusNoContent)
	})
	return r, &seen
}

func TestHTTPStartsTraceAndReturnsHeader(t *testing.T) {
	sr := recorder(t, "")
	r, _ := router(t)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/ws/w1", nil))
	id := rec.Header().Get(TraceHeader)
	if len(id) != 32 {
		t.Fatalf("X-Trace-Id = %q", id)
	}
	spans := sr.Ended()
	if len(spans) != 1 || spans[0].SpanContext().TraceID().String() != id {
		t.Fatalf("spans = %d, want the one behind %s", len(spans), id)
	}
	if spans[0].Name() != "GET /ws/{id}" {
		t.Fatalf("span name = %q, want the route pattern", spans[0].Name())
	}
}

func TestHTTPContinuesIncomingTraceparent(t *testing.T) {
	sr := recorder(t, "")
	r, _ := router(t)
	const parent = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"
	req := httptest.NewRequest(http.MethodGet, "/ws/w1", nil)
	req.Header.Set("traceparent", parent)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if got := rec.Header().Get(TraceHeader); got != "0af7651916cd43dd8448eb211c80319c" {
		t.Fatalf("X-Trace-Id = %q, want the incoming trace", got)
	}
	if sr.Ended()[0].Parent().SpanID().String() != "b7ad6b7169203331" {
		t.Fatal("span is not a child of the incoming parent")
	}
}

func TestActorAndTenantReachSpanAndFields(t *testing.T) {
	sr := recorder(t, "")
	r, seen := router(t)
	r.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/ws/w1", nil))
	f := (*seen)[0]
	if f.ActorID != "u1" || f.ActorKind != "human" || f.OrganizationID != "org1" || f.WorkspaceID != "w1" || f.ClientPlatform != "web" {
		t.Fatalf("fields = %+v", f)
	}
	attrs := map[string]string{}
	for _, kv := range sr.Ended()[0].Attributes() {
		attrs[string(kv.Key)] = kv.Value.AsString()
	}
	for k, want := range map[string]string{AttrActorID: "u1", AttrActorKind: "human", AttrOrganizationID: "org1", AttrWorkspaceID: "w1", AttrClientPlatform: "web", "http.route": "/ws/{id}"} {
		if attrs[k] != want {
			t.Errorf("%s = %q, want %q", k, attrs[k], want)
		}
	}
}

func TestDebugHeaderForcesSamplingAtZeroRatio(t *testing.T) {
	sr := recorder(t, "0")
	r, _ := router(t)
	r.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/ws/w1", nil))
	if n := len(sr.Ended()); n != 0 {
		t.Fatalf("ratio 0 recorded %d spans", n)
	}
	req := httptest.NewRequest(http.MethodGet, "/ws/w1", nil)
	req.Header.Set(DebugTraceHeader, "1")
	r.ServeHTTP(httptest.NewRecorder(), req)
	if n := len(sr.Ended()); n != 1 {
		t.Fatalf("debug header recorded %d spans, want 1", n)
	}
}

func TestProbesAreNotTraced(t *testing.T) {
	sr := recorder(t, "")
	r := chi.NewRouter()
	r.Use(HTTP)
	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(200) })
	r.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if len(sr.Ended()) != 0 {
		t.Fatal("liveness probe produced a span")
	}
}

func TestLogHandlerStampsTraceAndTenant(t *testing.T) {
	recorder(t, "")
	var buf bytes.Buffer
	log := slog.New(WrapLogHandler(slog.NewJSONHandler(&buf, nil)))
	r := chi.NewRouter()
	r.Use(HTTP)
	r.Get("/x", func(w http.ResponseWriter, req *http.Request) {
		SetActor(req.Context(), "u1", "human", "")
		SetTenant(req.Context(), "org1", "w1")
		log.InfoContext(req.Context(), "hello")
		w.WriteHeader(200)
	})
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/x", nil))
	var line map[string]any
	if err := json.Unmarshal(buf.Bytes(), &line); err != nil {
		t.Fatal(err, buf.String())
	}
	if line["trace_id"] != rec.Header().Get(TraceHeader) || line["organization_id"] != "org1" || line["workspace_id"] != "w1" || line["actor_id"] != "u1" {
		t.Fatalf("line = %v", line)
	}
	// Lines without a request context stay untouched.
	buf.Reset()
	log.Info("plain")
	if bytes.Contains(buf.Bytes(), []byte("trace_id")) {
		t.Fatal("trace_id on a line with no request context")
	}
}

func TestPropagatorIsW3C(t *testing.T) {
	recorder(t, "")
	fields := otel.GetTextMapPropagator().Fields()
	want := propagation.TraceContext{}.Fields()[0]
	for _, f := range fields {
		if f == want {
			return
		}
	}
	t.Fatalf("propagator fields = %v, want %s", fields, want)
}

// Without an exporter nothing ever reads a span, so the provider must not
// record one — not even under a sampled remote parent or X-Debug-Trace — while
// every request still gets a trace id: correlation_id and X-Trace-Id are that
// id (spec F-11 §2.5), and an incoming traceparent is still continued.
func TestNoExporterRecordsNothingButKeepsTraceIDs(t *testing.T) {
	shutdown, err := Init(context.Background(), Config{ServiceName: "test"}, slog.Default())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = shutdown(context.Background()) })
	sr := tracetest.NewSpanRecorder()
	otel.GetTracerProvider().(*sdktrace.TracerProvider).RegisterSpanProcessor(sr)

	var recording []bool
	r := chi.NewRouter()
	r.Use(HTTP)
	r.Get("/x", func(w http.ResponseWriter, req *http.Request) {
		recording = append(recording, trace.SpanFromContext(req.Context()).IsRecording())
		w.WriteHeader(http.StatusNoContent)
	})

	plain := httptest.NewRecorder()
	r.ServeHTTP(plain, httptest.NewRequest(http.MethodGet, "/x", nil))
	if id := plain.Header().Get(TraceHeader); len(id) != 32 || id == strings.Repeat("0", 32) {
		t.Fatalf("X-Trace-Id = %q, want a fresh trace id", id)
	}

	const parent = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01"
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.Header.Set("traceparent", parent)
	req.Header.Set(DebugTraceHeader, "1")
	continued := httptest.NewRecorder()
	r.ServeHTTP(continued, req)
	if got := continued.Header().Get(TraceHeader); got != "0af7651916cd43dd8448eb211c80319c" {
		t.Fatalf("X-Trace-Id = %q, want the incoming trace", got)
	}

	if n := len(sr.Started()); n != 0 {
		t.Fatalf("no exporter, yet %d spans were recorded", n)
	}
	for i, rec := range recording {
		if rec {
			t.Fatalf("request %d ran under a recording span", i)
		}
	}
}
