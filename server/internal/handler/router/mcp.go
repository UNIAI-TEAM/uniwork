package router

import (
	"net/http"

	"github.com/go-chi/chi/v5"
)

// registerMCP mounts discovery and OAuth for external MCP clients outside the
// api wrapper and the OpenAPI catalogue: their bodies follow RFCs, not
// SDI/SDO (ADR 0031). swagger_test.go lists their prefixes (and /mcp, which
// joins them) as exceptions and router_test.go pins the routes.
//
// authorize, token and revoke share the credential budget (per address and
// path); registration writes a row for any caller and takes its own.
func registerMCP(r chi.Router, h Routes, credentialLimit, registerLimit func(http.Handler) http.Handler) {
	r.Get("/.well-known/oauth-protected-resource", h.McpProtectedResource)
	r.Get("/.well-known/oauth-protected-resource/mcp", h.McpProtectedResource)
	r.Get("/.well-known/oauth-authorization-server", h.McpAuthorizationServer)
	r.With(credentialLimit).Get("/oauth/authorize", h.McpAuthorize)
	r.With(credentialLimit).Post("/oauth/token", h.McpToken)
	r.With(credentialLimit).Post("/oauth/revoke", h.McpRevoke)
	r.With(registerLimit).Post("/oauth/register", h.McpRegister)
}
