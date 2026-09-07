package logger

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	chimw "github.com/go-chi/chi/v5/middleware"

	"github.com/unicomhub/uniwork/server/internal/middleware"
)

func TestParseLevelDefaultsToDebug(t *testing.T) {
	for in, want := range map[string]slog.Level{
		"info": slog.LevelInfo, " WARN ": slog.LevelWarn, "warning": slog.LevelWarn,
		"error": slog.LevelError, "": slog.LevelDebug, "verbose": slog.LevelDebug,
	} {
		if got := parseLevel(in); got != want {
			t.Errorf("parseLevel(%q) = %v, want %v", in, got, want)
		}
	}
}

// Handler log lines carry the same dimensions as the access log, and only
// the ones the request actually had — no empty keys.
func TestRequestAttrsMirrorAccessLog(t *testing.T) {
	var got []any
	inner := http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) { got = RequestAttrs(r) })
	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set(middleware.HeaderClientPlatform, "web")
	r.Header.Set(middleware.HeaderClientVersion, "1.2.3")
	ctx := context.WithValue(r.Context(), chimw.RequestIDKey, "req-1")
	ctx = middleware.WithUserID(ctx, "user-1")
	middleware.ClientMetadata(inner).ServeHTTP(httptest.NewRecorder(), r.WithContext(ctx))

	want := []any{"request_id", "req-1", "user_id", "user-1", "client_platform", "web", "client_version", "1.2.3"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("RequestAttrs = %v, want %v", got, want)
	}
	if attrs := RequestAttrs(httptest.NewRequest("GET", "/", nil)); len(attrs) != 0 {
		t.Fatalf("bare request should carry no attrs, got %v", attrs)
	}
}

// LOG_FORMAT picks the sink; both go through the telemetry wrapper and
// both honour LOG_LEVEL.
func TestNewHandlerHonoursFormatAndLevel(t *testing.T) {
	t.Setenv("LOG_LEVEL", "warn")
	for _, format := range []string{"json", "text"} {
		t.Setenv("LOG_FORMAT", format)
		h := newHandler()
		if h.Enabled(context.Background(), slog.LevelInfo) || !h.Enabled(context.Background(), slog.LevelWarn) {
			t.Errorf("LOG_FORMAT=%s: level warn not honoured", format)
		}
	}
	Init()
	if NewLogger("x") == nil || New() == nil {
		t.Fatal("nil logger")
	}
}
