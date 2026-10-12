package handler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
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
	srv := mcp.NewServer(&mcp.Implementation{Name: "uniwork", Title: "UniWork", Version: "1"}, nil)
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
			p, ok := ctx.Value(mcpPrincipalKey{}).(service.McpPrincipal)
			// The SDK runs a tool on a goroutine of its own, outside the HTTP
			// middleware that recovers every other route's panics; one here
			// would end the process for every tenant.
			defer func() {
				if v := recover(); v != nil {
					log.ErrorContext(ctx, "mcp tool panic", "tool", t.Name, "grant_id", p.GrantID, "panic", fmt.Sprint(v), "stack", string(debug.Stack()))
					metrics.ObserveTool(t.Name, "error", time.Since(start))
					_, res = mcpToolResult(nil, errors.New("panic"))
				}
			}()
			if !ok || p.UserID == "" || p.OrganizationID == "" {
				// mcpServe puts the principal there before the SDK runs; a
				// call without one is a wiring bug, and runs nothing.
				log.ErrorContext(ctx, "mcp tool without a principal", "tool", t.Name)
				_, res := mcpToolResult(nil, errors.New("no principal"))
				metrics.ObserveTool(t.Name, "error", time.Since(start))
				return res, nil
			}
			args, _ := json.Marshal(req.Params.Arguments)
			out, err := t.Handle(ctx, p.ToolContext(), args)
			outcome, res := mcpToolResult(out, err)
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
// metrics count it under. A model's mistake is an isError result it can read
// and fix, never a JSON-RPC error. Not found and forbidden read the same, so
// an id's existence never leaks (spec §7.5).
func mcpToolResult(out json.RawMessage, err error) (string, *mcp.CallToolResult) {
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
	default:
		return "error", &mcp.CallToolResult{IsError: true, Content: text("temporarily unavailable")}
	}
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
	h.mcpHandler.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), mcpPrincipalKey{}, p)))
}
