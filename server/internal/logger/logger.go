// Package logger configures slog for the server: tint-coloured output when
// stderr is a terminal, plain text when it is redirected, level from
// LOG_LEVEL, and a helper that lifts request-scoped dimensions (request id,
// user, client platform) into handler log lines so they match the access log.
package logger

import (
	"log/slog"
	"net/http"
	"os"
	"strings"

	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/lmittmann/tint"

	"github.com/unicomhub/uniwork/server/internal/middleware"
)

// isTerminal reports whether f is attached to a terminal. ANSI colour is only
// emitted in that case, so a redirected log file stays clean.
func isTerminal(f *os.File) bool {
	fi, err := f.Stat()
	if err != nil {
		return false
	}
	return fi.Mode()&os.ModeCharDevice != 0
}

func newHandler() slog.Handler {
	return tint.NewTextHandler(os.Stderr, &tint.Options{
		Level:      parseLevel(os.Getenv("LOG_LEVEL")),
		TimeFormat: "15:04:05.000",
		NoColor:    !isTerminal(os.Stderr),
	})
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
	attrs := make([]any, 0, 10)
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
