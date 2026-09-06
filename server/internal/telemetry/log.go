package telemetry

import (
	"context"
	"log/slog"
)

// LogHandler decorates a slog.Handler so every record written with a
// *Context method carries trace_id, span_id and the tenant/actor fields of
// the request. Records written without a context pass through untouched.
type LogHandler struct{ slog.Handler }

// WrapLogHandler returns h wrapped; idempotent on an already wrapped handler.
func WrapLogHandler(h slog.Handler) slog.Handler {
	if _, ok := h.(LogHandler); ok {
		return h
	}
	return LogHandler{h}
}

func (h LogHandler) Handle(ctx context.Context, r slog.Record) error {
	if ctx == nil {
		return h.Handler.Handle(ctx, r)
	}
	if id := TraceID(ctx); id != "" {
		r.AddAttrs(slog.String("trace_id", id))
		r.AddAttrs(slog.String("span_id", spanID(ctx)))
	}
	f := Snapshot(ctx)
	if f.OrganizationID != "" {
		r.AddAttrs(slog.String("organization_id", f.OrganizationID))
	}
	if f.WorkspaceID != "" {
		r.AddAttrs(slog.String("workspace_id", f.WorkspaceID))
	}
	if f.ActorID != "" {
		r.AddAttrs(slog.String("actor_id", f.ActorID), slog.String("actor_kind", f.ActorKind))
	}
	return h.Handler.Handle(ctx, r)
}

func (h LogHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return LogHandler{h.Handler.WithAttrs(attrs)}
}

func (h LogHandler) WithGroup(name string) slog.Handler {
	return LogHandler{h.Handler.WithGroup(name)}
}
