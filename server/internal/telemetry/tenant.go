package telemetry

import (
	"context"
	"sync"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

// Attribute keys shared by spans and log lines (spec F-11 §6.1).
const (
	AttrOrganizationID = "uniwork.organization_id"
	AttrWorkspaceID    = "uniwork.workspace_id"
	AttrActorID        = "uniwork.actor_id"
	AttrActorKind      = "uniwork.actor_kind"
	AttrClientPlatform = "uniwork.client_platform"
)

// Fields is what a request knows about itself once auth and membership have
// run. It lives behind a pointer on the context so RequireMember, deep in the
// service layer, can fill it in without returning a new context up the stack.
type Fields struct {
	OrganizationID string
	WorkspaceID    string
	ActorID        string
	ActorKind      string
	ClientPlatform string
}

// holder is the mutable cell behind the context value; Fields itself stays a
// plain value so callers can copy it freely.
type holder struct {
	mu sync.Mutex
	f  Fields
}

type fieldsKey struct{}

// WithFields attaches an empty holder; the HTTP middleware does this once per
// request. Contexts without one make SetActor/SetTenant only touch the span.
func WithFields(ctx context.Context) context.Context {
	return context.WithValue(ctx, fieldsKey{}, &holder{})
}

func fieldsFrom(ctx context.Context) *holder {
	h, _ := ctx.Value(fieldsKey{}).(*holder)
	return h
}

// Snapshot returns a copy of the request fields, zero when none are attached.
func Snapshot(ctx context.Context) Fields {
	f := fieldsFrom(ctx)
	if f == nil {
		return Fields{}
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.f
}

// SetActor records who is acting: the auth middleware for humans, the agent
// gate for agents. kind is human | agent | system (ADR 0007).
func SetActor(ctx context.Context, id, kind, clientPlatform string) {
	if f := fieldsFrom(ctx); f != nil {
		f.mu.Lock()
		f.f.ActorID, f.f.ActorKind, f.f.ClientPlatform = id, kind, clientPlatform
		f.mu.Unlock()
	}
	attrs := []attribute.KeyValue{attribute.String(AttrActorID, id), attribute.String(AttrActorKind, kind)}
	if clientPlatform != "" {
		attrs = append(attrs, attribute.String(AttrClientPlatform, clientPlatform))
	}
	trace.SpanFromContext(ctx).SetAttributes(attrs...)
}

// SetTenant records the organization and workspace the request resolved to.
// Called from WorkspaceService.RequireMember so every workspace-scoped span
// and log line carries both ids without each handler repeating it.
func SetTenant(ctx context.Context, organizationID, workspaceID string) {
	if f := fieldsFrom(ctx); f != nil {
		f.mu.Lock()
		if organizationID != "" {
			f.f.OrganizationID = organizationID
		}
		if workspaceID != "" {
			f.f.WorkspaceID = workspaceID
		}
		f.mu.Unlock()
	}
	var attrs []attribute.KeyValue
	if organizationID != "" {
		attrs = append(attrs, attribute.String(AttrOrganizationID, organizationID))
	}
	if workspaceID != "" {
		attrs = append(attrs, attribute.String(AttrWorkspaceID, workspaceID))
	}
	if len(attrs) > 0 {
		trace.SpanFromContext(ctx).SetAttributes(attrs...)
	}
}

// TraceID is the hex trace id of the span on ctx, "" when there is none.
func TraceID(ctx context.Context) string {
	sc := trace.SpanContextFromContext(ctx)
	if !sc.HasTraceID() {
		return ""
	}
	return sc.TraceID().String()
}

func spanID(ctx context.Context) string {
	return trace.SpanContextFromContext(ctx).SpanID().String()
}
