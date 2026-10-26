// Package logger configures slog for the server. LOG_FORMAT=json is one JSON
// object per line. Any other value is the dev text handler, which colours
// stderr even when it is not a terminal. NO_COLOR and LOG_COLOR=never switch
// that colour off; LOG_COLOR=auto keeps the old terminal check. LOG_LEVEL
// selects the minimum level. RequestAttrs lifts request-scoped dimensions
// into handler log lines so they match the access log.
package logger

import (
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"

	chimw "github.com/go-chi/chi/v5/middleware"

	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/telemetry"
)

// isTerminal reports whether f is attached to a terminal. Only LOG_COLOR=auto
// consults it. The default text format colours a pipe.
func isTerminal(f *os.File) bool {
	fi, err := f.Stat()
	if err != nil {
		return false
	}
	return fi.Mode()&os.ModeCharDevice != 0
}

// colorEnabled decides ANSI for the text format. NO_COLOR wins over
// LOG_COLOR=always. auto is the only mode that consults the terminal bit.
// An empty LOG_COLOR, "always", and any other value turn colour on, including
// when stderr is a pipe.
func colorEnabled(stderrIsTerminal bool) bool {
	if strings.TrimSpace(os.Getenv("NO_COLOR")) != "" {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(os.Getenv("LOG_COLOR"))) {
	case "never":
		return false
	case "auto":
		return stderrIsTerminal
	default:
		return true
	}
}

// buildHandler is the test seam. newHandler passes os.Stderr and whether that
// file is a terminal. Colour is decided once, here, not per line.
func buildHandler(w io.Writer, stderrIsTerminal bool) slog.Handler {
	level := parseLevel(os.Getenv("LOG_LEVEL"))
	if strings.EqualFold(strings.TrimSpace(os.Getenv("LOG_FORMAT")), "json") {
		return telemetry.WrapLogHandler(slog.NewJSONHandler(w, &slog.HandlerOptions{Level: level}))
	}
	return telemetry.WrapLogHandler(newTextHandler(w, level, colorEnabled(stderrIsTerminal)))
}

// newHandler picks the sink by LOG_FORMAT and wraps it so context-aware lines
// carry trace and tenant fields.
func newHandler() slog.Handler {
	return buildHandler(os.Stderr, isTerminal(os.Stderr))
}

// Init installs the process-wide slog default so bare slog.Info/Warn calls
// from any package land in the same sink as injected loggers.
func Init() {
	slog.SetDefault(slog.New(newHandler()))
}

// NewLogger returns a logger tagged with a component name.
func NewLogger(component string) *slog.Logger {
	return slog.New(newHandler()).With("component", component)
}

// New is the server's default logger. Kept as the entry point main.go has
// always used; it is NewLogger for the "server" component.
func New() *slog.Logger {
	return NewLogger("server")
}

// RequestAttrs extracts request_id, user_id and the X-Client-* metadata from a
// request for handler-level structured logging, mirroring the access log so
// both carry the same observability dimensions.
func RequestAttrs(r *http.Request) []any {
	attrs := make([]any, 0, 12)
	if rid := chimw.GetReqID(r.Context()); rid != "" {
		attrs = append(attrs, "request_id", rid)
	}
	if uid := middleware.UserID(r.Context()); uid != "" {
		attrs = append(attrs, "user_id", uid)
	}
	platform, version, clientOS := middleware.ClientMetadataFromContext(r.Context())
	if platform != "" {
		attrs = append(attrs, "client_platform", platform)
	}
	if version != "" {
		attrs = append(attrs, "client_version", version)
	}
	if clientOS != "" {
		attrs = append(attrs, "client_os", clientOS)
	}
	if update := middleware.ClientUpdateIDFromContext(r.Context()); update != "" {
		attrs = append(attrs, "client_update_id", update)
	}
	return attrs
}

func parseLevel(s string) slog.Level {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "info":
		return slog.LevelInfo
	case "warn", "warning":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelDebug
	}
}
