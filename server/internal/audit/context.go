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
