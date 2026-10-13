package telemetry

import (
	"context"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

// Attribute keys for a request served to an external MCP client (spec §10).
const (
	AttrMCPClientID = "mcp.client_id"
	AttrMCPGrantID  = "mcp.grant_id"
	AttrMCPTool     = "mcp.tool"
)

// SetMCP marks a span as served to an external MCP client. The ids are opaque
// ULIDs, never personal data; an empty value is left off, so the transport can
// stamp the client and grant when it authenticates and the tool name when the
// call arrives.
func SetMCP(ctx context.Context, clientID, grantID, tool string) {
	var attrs []attribute.KeyValue
	for _, kv := range []struct{ key, value string }{
		{AttrMCPClientID, clientID}, {AttrMCPGrantID, grantID}, {AttrMCPTool, tool},
	} {
		if kv.value != "" {
			attrs = append(attrs, attribute.String(kv.key, kv.value))
		}
	}
	if len(attrs) > 0 {
		trace.SpanFromContext(ctx).SetAttributes(attrs...)
	}
}
