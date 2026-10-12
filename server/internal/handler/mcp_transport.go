package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"runtime"
	"runtime/debug"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/telemetry"
)

// The /mcp endpoint (ADR 0031): Streamable HTTP, stateless, JSON responses.
// mcpServe authenticates every request; the go-sdk server behind it only ever
// sees a request whose principal is already on the context.

// mcpMaxBody caps one JSON-RPC request. The SDK enforces it while reading.
const mcpMaxBody = 1 << 20

type mcpPrincipalKey struct{}

// mcpRequestKey carries the HTTP request's own context to the tool. The SDK
// hands a tool a context that keeps the request's values but not its
// cancellation (verified on v1.8.0 for the protocol revisions served here: a
// client that disconnects leaves its tool running to the end, and the HTTP
// handler waits for it), so the transport ties the two itself.
type mcpRequestKey struct{}

// mcpCallContext is what mcpServe puts on the request before the SDK reads it.
func mcpCallContext(r *http.Request, p service.McpPrincipal) context.Context {
	ctx := context.WithValue(r.Context(), mcpPrincipalKey{}, p)
	return context.WithValue(ctx, mcpRequestKey{}, r.Context())
}

func boolPtr(v bool) *bool { return &v }

// newMcpHandler builds the go-sdk server once. Stateless: no session id, no
// sticky routing across replicas. The SDK's localhost DNS-rebinding guard is
// off because every request must carry a bearer token and the API sits behind
// a reverse proxy on the same host, which makes the request arrive from
// 127.0.0.1 with the public Host header (spec §7.1, Review Focus 2).
func newMcpHandler(tools ai.Registry, metrics service.McpMetrics, log *slog.Logger) http.Handler {
	if log == nil {
		log = slog.Default()
	}
	srv := mcp.NewServer(&mcp.Implementation{Name: "uniwork", Title: "UniWork", Version: "1"},
		&mcp.ServerOptions{
			SupportedProtocolVersions: mcpProtocolVersions,
			// Tools, and no list-changed notifications: a stateless server never
			// has a stream to send one on, so advertising it was untrue, and the
			// SDK's subscriptions/listen handler parks for as long as the client
			// stays while it is advertised. The default {"logging":{}} goes too:
			// nothing here answers logging/setLevel.
			Capabilities: &mcp.ServerCapabilities{Tools: &mcp.ToolCapabilities{ListChanged: false}},
		})
	for _, t := range tools {
		var schema map[string]any
		if err := json.Unmarshal(t.Schema, &schema); err != nil {
			// A tool whose schema is not JSON is a programming error that the
			// service's own tests catch; refuse to serve it rather than list a
			// tool no client can call.
			panic("mcp: tool " + t.Name + " has an invalid input schema: " + err.Error())
		}
		srv.AddTool(&mcp.Tool{
			Name: t.Name, Description: t.Description, InputSchema: schema,
			// Read-only is the whole of v1 (TestMCPToolsAreReadOnly). Clients
			// may skip a confirmation for such a tool; none of them is open
			// world, as every result comes from the person's organization.
			Annotations: &mcp.ToolAnnotations{ReadOnlyHint: true, DestructiveHint: boolPtr(false), OpenWorldHint: boolPtr(false)},
		}, func(ctx context.Context, req *mcp.CallToolRequest) (res *mcp.CallToolResult, _ error) {
			telemetry.SetMCP(ctx, "", "", t.Name)
			start := time.Now()
			if reqCtx, ok := ctx.Value(mcpRequestKey{}).(context.Context); ok {
				// A client that goes away stops its tool, and the database
				// work behind it, instead of leaving both to run to the end.
				var cancel context.CancelFunc
				ctx, cancel = context.WithCancel(ctx)
				defer cancel()
				defer context.AfterFunc(reqCtx, cancel)()
			}
			p, ok := ctx.Value(mcpPrincipalKey{}).(service.McpPrincipal)
			// The SDK runs a tool on a goroutine of its own, outside the HTTP
			// middleware that recovers every other route's panics; one here
			// would end the process for every tenant.
			defer func() {
				if v := recover(); v != nil {
					log.ErrorContext(ctx, "mcp tool panic", "tool", t.Name, "grant_id", p.GrantID, "panic", mcpPanicSummary(v), "stack", string(debug.Stack()))
					metrics.ObserveTool(t.Name, "error", time.Since(start))
					_, res = mcpToolResult(ctx, nil, errors.New("panic"))
				}
			}()
			if !ok || p.UserID == "" || p.OrganizationID == "" {
				// mcpServe puts the principal there before the SDK runs; a
				// call without one is a wiring bug, and runs nothing.
				log.ErrorContext(ctx, "mcp tool without a principal", "tool", t.Name)
				_, res := mcpToolResult(ctx, nil, errors.New("no principal"))
				metrics.ObserveTool(t.Name, "error", time.Since(start))
				return res, nil
			}
			args, _ := json.Marshal(req.Params.Arguments)
			out, err := t.Handle(ctx, p.ToolContext(), args)
			outcome, res := mcpToolResult(ctx, out, err)
			if outcome == "error" {
				// Ids and the error only: never the token or the arguments.
				log.ErrorContext(ctx, "mcp tool", "tool", t.Name, "grant_id", p.GrantID, "err", err)
			}
			metrics.ObserveTool(t.Name, outcome, time.Since(start))
			return res, nil
		})
	}
	return mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return srv }, &mcp.StreamableHTTPOptions{
		Stateless: true, JSONResponse: true, DisableLocalhostProtection: true, MaxRequestBodyBytes: mcpMaxBody,
	})
}

// mcpToolResult turns a tool outcome into an MCP result and the label the
// metrics count it under (ok, invalid, not_found, cancelled, error). A model's mistake is an isError result it can read
// and fix, never a JSON-RPC error. Not found and forbidden read the same, so
// an id's existence never leaks (spec §7.5).
func mcpToolResult(ctx context.Context, out json.RawMessage, err error) (string, *mcp.CallToolResult) {
	text := func(s string) []mcp.Content { return []mcp.Content{&mcp.TextContent{Text: s}} }
	var bad service.McpInvalidArgs
	switch {
	case err == nil:
		res := &mcp.CallToolResult{Content: text(string(out))}
		var v any
		if json.Unmarshal(out, &v) == nil {
			if list, ok := v.([]any); ok {
				v = map[string]any{"items": list} // structuredContent must be an object
			}
			if obj, ok := v.(map[string]any); ok {
				res.StructuredContent = obj
			}
		}
		return "ok", res
	case errors.As(err, &bad):
		return "invalid", &mcp.CallToolResult{IsError: true, Content: text(bad.Error())}
	case errors.Is(err, service.ErrNotFound), errors.Is(err, service.ErrForbidden):
		return "not_found", &mcp.CallToolResult{IsError: true, Content: text("not found or not accessible")}
	case ctx.Err() != nil:
		// The client went away or the server is stopping: nothing of ours
		// failed, so it is neither an error line nor an error in the metrics.
		return "cancelled", &mcp.CallToolResult{IsError: true, Content: text("temporarily unavailable")}
	default:
		return "error", &mcp.CallToolResult{IsError: true, Content: text("temporarily unavailable")}
	}
}

// mcpPanicSummary is what a panic puts in the log: its type, and for a runtime
// error its message (the runtime's own text carries nothing of ours). A panic
// value a tool chose can hold the row or the argument it was working on.
func mcpPanicSummary(v any) string {
	if e, ok := v.(runtime.Error); ok {
		return e.Error()
	}
	return fmt.Sprintf("%T", v)
}

// bearerToken reads an Authorization: Bearer credential. The scheme is
// case-insensitive (RFC 6750 §2.1; Review Focus 5).
func bearerToken(r *http.Request) (string, bool) {
	scheme, token, ok := strings.Cut(r.Header.Get("Authorization"), " ")
	token = strings.TrimSpace(token)
	if !ok || !strings.EqualFold(scheme, "Bearer") || token == "" {
		return "", false
	}
	return token, true
}

// mcpUnauthorized is RFC 9728 §5.1: the challenge points the client at the
// protected-resource metadata of /mcp, so it finds the authorization server
// and starts the flow again. A request with no credentials carries no error
// code (RFC 6750 §3.1).
func (h *handlers) mcpUnauthorized(w http.ResponseWriter, code string) {
	v := `Bearer resource_metadata="` + h.McpAuth.Issuer() + `/.well-known/oauth-protected-resource/mcp"`
	if code != "" {
		v += `, error="` + code + `"`
	}
	w.Header().Set("WWW-Authenticate", v)
	respondError(w, http.StatusUnauthorized, "invalid_token", "a valid UniWork MCP access token is required")
}

// mcpServe is the gate in front of the SDK: token, grant, platform flag, the
// organization's switch, membership. A token problem is 401 so the client
// signs in again; an organization that closed its door (switch off, suspended,
// deactivated member) is the service's own 403.
func (h *handlers) mcpServe(w http.ResponseWriter, r *http.Request) {
	if h.McpAuth == nil || h.mcpHandler == nil {
		respondError(w, http.StatusNotFound, "not_found", "not found")
		return
	}
	noStore(w)
	raw, ok := bearerToken(r)
	if !ok {
		h.mcpUnauthorized(w, "")
		return
	}
	p, err := h.McpAuth.Authenticate(r.Context(), raw)
	if errors.Is(err, service.ErrMcpTokenInvalid) {
		h.mcpUnauthorized(w, "invalid_token")
		return
	}
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	telemetry.SetActor(r.Context(), p.UserID, "human", "mcp")
	telemetry.SetTenant(r.Context(), p.OrganizationID, "")
	telemetry.SetMCP(r.Context(), p.ClientID, p.GrantID, "")
	if h.mcpGuard(w, r) {
		return
	}
	h.mcpHandler.ServeHTTP(&noStoreWriter{ResponseWriter: w}, r.WithContext(mcpCallContext(r, p)))
}
