package router

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
)

// mcpAccessPrefix starts every access token the authorization server issues
// (service/mcp_auth.go). The router reads no database, so the prefix is all it
// can use to tell a token that might be one of ours from anything else.
const mcpAccessPrefix = "uwm_at_"

// registerMCP mounts discovery, OAuth and the /mcp endpoint for external MCP
// clients outside the api wrapper and the OpenAPI catalogue: their bodies
// follow RFCs and the MCP spec, not SDI/SDO (ADR 0031). swagger_test.go lists
// their prefixes as exceptions and router_test.go pins the routes.
//
// authorize, token and revoke share the credential budget (per address and
// path); registration writes a row for any caller and takes its own; /mcp is
// budgeted per access token (mcpBearer) under a ceiling per address, and is off
// the global limiter.
func registerMCP(r chi.Router, h Routes, credentialLimit, registerLimit, mcpLimit func(http.Handler) http.Handler) {
	r.Get("/.well-known/oauth-protected-resource", h.McpProtectedResource)
	r.Get("/.well-known/oauth-protected-resource/mcp", h.McpProtectedResource)
	r.Get("/.well-known/oauth-authorization-server", h.McpAuthorizationServer)
	r.With(credentialLimit).Get("/oauth/authorize", h.McpAuthorize)
	r.With(credentialLimit).Post("/oauth/token", h.McpToken)
	r.With(credentialLimit).Post("/oauth/revoke", h.McpRevoke)
	r.With(registerLimit).Post("/oauth/register", h.McpRegister)
	// Stateless transport: only POST carries a request. GET and DELETE are
	// mounted so the handler answers them (401, then 405 with Allow: POST)
	// instead of the mux answering 404.
	r.With(mcpLimit).Post("/mcp", h.McpServe)
	r.With(mcpLimit).Get("/mcp", h.McpServe)
	r.With(mcpLimit).Delete("/mcp", h.McpServe)
}

// mcpLimits runs the limiters in order, first to last. The address ceiling
// goes first so a request it refuses never opens a per-token counter.
func mcpLimits(limits ...func(http.Handler) http.Handler) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		for i := len(limits) - 1; i >= 0; i-- {
			next = limits[i](next)
		}
		return next
	}
}

// mcpBearer keys the /mcp budget by access token. The router reads no
// database, so the token string is all it can key on, and the token is not
// verified here. A grant can hold several live access tokens at once: a
// refresh rotation does not revoke the access token it replaces (it lives out
// its hour), and each re-authorization opens a new token family on the same
// grant. So one person's connection may spread over a few per-token budgets;
// the per-address ceiling (mcp-ip) bounds the total. The global limiter keys by
// session JWT and leaves every other request on its client address, which
// would put every team behind one vendor egress address on one budget; /mcp is
// exempt from it for that reason. A request with no token that looks like ours
// falls back to its address, so junk credentials share the address's budget
// instead of each minting a fresh one.
func mcpBearer(r *http.Request) string {
	scheme, token, ok := strings.Cut(r.Header.Get("Authorization"), " ")
	token = strings.TrimSpace(token)
	if !ok || !strings.EqualFold(scheme, "Bearer") || !strings.HasPrefix(token, mcpAccessPrefix) {
		return ""
	}
	sum := sha256.Sum256([]byte(token))
	return "mcp:" + hex.EncodeToString(sum[:8])
}
