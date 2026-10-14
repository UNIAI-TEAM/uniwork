package audit

import (
	"context"
	"regexp"
)

// RequestInfo is the request-scoped provenance every audit row carries. It is
// put on the context once, by middleware.Correlation, and read at the bottom
// of the stack — services never thread it through their signatures.
type RequestInfo struct {
	// CorrelationID follows one user action across HTTP, database, outbox and
	// every log line it produces. RequestID is one hop inside that chain.
	CorrelationID string
	RequestID     string
	IP            string
	UserAgent     string
	// Via is the channel the request came through when it is not the
	// person's own screen; nil otherwise.
	Via *Via
}

type requestKey struct{}

// correlationPattern is what a client-supplied X-Correlation-ID must match.
// Anything else is replaced with a generated id: the value ends up in logs and
// in a column, so an unvalidated header would be a log-injection vector.
var correlationPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{8,64}$`)

// ValidCorrelationID reports whether a client-supplied id may be used as-is.
func ValidCorrelationID(s string) bool { return correlationPattern.MatchString(s) }

// WithRequest returns a context carrying the request provenance.
func WithRequest(ctx context.Context, info RequestInfo) context.Context {
	return context.WithValue(ctx, requestKey{}, info)
}

// Via names an AI app that acts for the person through the MCP connector
// (ADR 0033). Record writes it into metadata.via so history can say who
// pressed the key and through what.
type Via struct {
	Kind       string
	ClientID   string
	GrantID    string
	ClientName string
}

// WithVia returns ctx with v added to the request provenance.
func WithVia(ctx context.Context, v Via) context.Context {
	info := RequestFromContext(ctx)
	info.Via = &v
	return WithRequest(ctx, info)
}

// withVia copies m and adds the channel; the caller's map is never mutated,
// since callers reuse it.
func withVia(m map[string]any, v *Via) map[string]any {
	if v == nil {
		return m
	}
	out := make(map[string]any, len(m)+1)
	for k, val := range m {
		out[k] = val
	}
	out["via"] = map[string]any{"kind": v.Kind, "client_id": v.ClientID, "grant_id": v.GrantID, "client_name": v.ClientName}
	return out
}

// RequestFromContext returns the provenance put there by WithRequest, or the
// zero value. A zero CorrelationID makes Record generate one, so a command
// started by a worker is still traceable end to end.
func RequestFromContext(ctx context.Context) RequestInfo {
	info, _ := ctx.Value(requestKey{}).(RequestInfo)
	return info
}

// CorrelationID is the short read for loggers.
func CorrelationID(ctx context.Context) string {
	return RequestFromContext(ctx).CorrelationID
}
