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
	AttrMCPScope    = "mcp.scope"
	AttrMCPTool     = "mcp.tool"
)

// SetMCP marks a span as served to an external MCP client. The ids are opaque
// ULIDs, never personal data, and the scope is the grant's normalized scope
// string (read, or read write); an empty value is left off, so the transport
// can stamp the client, grant and scope when it authenticates and the tool
// name when the call arrives.
func SetMCP(ctx context.Context, clientID, grantID, scope, tool string) {
	var attrs []attribute.KeyValue
	for _, kv := range []struct{ key, value string }{
		{AttrMCPClientID, clientID}, {AttrMCPGrantID, grantID}, {AttrMCPScope, scope}, {AttrMCPTool, tool},
	} {
		if kv.value != "" {
			attrs = append(attrs, attribute.String(kv.key, kv.value))
		}
	}
	if len(attrs) > 0 {
		trace.SpanFromContext(ctx).SetAttributes(attrs...)
	}
}
