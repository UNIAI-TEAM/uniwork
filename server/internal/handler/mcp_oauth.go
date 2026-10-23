package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/service"
)

// OAuth endpoints for external MCP clients (ADR 0031). Bodies follow the
// RFCs, not SDI/SDO, so these routes sit outside the api wrapper and cap
// their own bodies instead of going through decode.
const mcpFormLimit = 16 << 10

var mcpAuthMethods = []string{"none", "client_secret_post", "client_secret_basic"}

func (h *handlers) mcpReady(w http.ResponseWriter) bool {
	if h.McpAuth != nil {
		return true
	}
	respondError(w, http.StatusNotFound, "not_found", "not found")
	return false
}

// mcpProtectedResource is the RFC 9728 document; it answers on the bare
// well-known path and on the one derived from the /mcp resource path.
func (h *handlers) mcpProtectedResource(w http.ResponseWriter, _ *http.Request) {
	if !h.mcpReady(w) {
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{
		"resource":                 h.McpAuth.ResourceURL(),
		"authorization_servers":    []string{h.McpAuth.Issuer()},
		"scopes_supported":         []string{"read", "write"},
		"bearer_methods_supported": []string{"header"},
		"resource_name":            "UniWork",
	})
}

// mcpAuthorizationServer is the RFC 8414 document.
func (h *handlers) mcpAuthorizationServer(w http.ResponseWriter, _ *http.Request) {
	if !h.mcpReady(w) {
		return
	}
	iss := h.McpAuth.Issuer()
	respondJSON(w, http.StatusOK, map[string]any{
		"issuer":                                         iss,
		"authorization_endpoint":                         iss + "/oauth/authorize",
		"token_endpoint":                                 iss + "/oauth/token",
		"registration_endpoint":                          iss + "/oauth/register",
		"revocation_endpoint":                            iss + "/oauth/revoke",
		"response_types_supported":                       []string{"code"},
		"grant_types_supported":                          []string{"authorization_code", "refresh_token"},
		"code_challenge_methods_supported":               []string{"S256"},
		"token_endpoint_auth_methods_supported":          mcpAuthMethods,
		"revocation_endpoint_auth_methods_supported":     mcpAuthMethods,
		"scopes_supported":                               []string{"read", "write"},
		"client_id_metadata_document_supported":          true,
		"authorization_response_iss_parameter_supported": true,
	})
}

// mcpAuthorize answers in redirects only: to the UniWork consent page, to the
// client when Start vouches for its redirect URI, otherwise to the UniWork
// error page. A request is never sent back to an address Start did not check.
func (h *handlers) mcpAuthorize(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	if !h.mcpReady(w) {
		return
	}
	q := r.URL.Query()
	for _, vs := range q {
		if len(vs) > 1 {
			// RFC 6749 §3.1: no parameter twice. Which copy is the real
			// redirect_uri is unknowable, so the client is not told.
			http.Redirect(w, r, h.connectErrorURL("invalid_request"), http.StatusFound)
			return
		}
	}
	to, err := h.McpAuth.Start(r.Context(), service.McpAuthorizeInput{
		ResponseType: q.Get("response_type"), ClientID: q.Get("client_id"), RedirectURI: q.Get("redirect_uri"),
		CodeChallenge: q.Get("code_challenge"), CodeChallengeMethod: q.Get("code_challenge_method"),
		State: q.Get("state"), Scope: q.Get("scope"), Resource: q.Get("resource"),
	})
	var ae *service.McpAuthorizeError
	switch {
	case err == nil:
		http.Redirect(w, r, to, http.StatusFound)
	case errors.As(err, &ae) && ae.RedirectURI != "":
		http.Redirect(w, r, h.authorizeErrorURL(ae), http.StatusFound)
	case errors.As(err, &ae):
		http.Redirect(w, r, h.connectErrorURL(ae.Code), http.StatusFound)
	default:
		h.Log.Error("mcp authorize", "err", err)
		respondError(w, http.StatusInternalServerError, "internal", "internal error")
	}
}

// authorizeErrorURL is the client's registered redirect URI with the RFC 6749
// §4.1.2.1 error parameters and the RFC 9207 issuer. A query the client
// registered stays; a parameter of ours replaces one of the same name.
func (h *handlers) authorizeErrorURL(ae *service.McpAuthorizeError) string {
	u, err := url.Parse(ae.RedirectURI)
	if err != nil {
		return h.connectErrorURL("invalid_request")
	}
	v := u.Query()
	v.Set("error", ae.Code)
	v.Set("error_description", ae.Description)
	v.Set("iss", h.McpAuth.Issuer())
	if ae.State != "" {
		v.Set("state", ae.State)
	}
	u.RawQuery = v.Encode()
	return u.String()
}

// connectErrorURL is the UniWork page that explains a request it could not
// send back to the client.
func (h *handlers) connectErrorURL(code string) string {
	return strings.TrimRight(h.Cfg.FrontendOrigin, "/") + "/auth/connect/authorize?error=" + url.QueryEscape(code)
}

// mcpToken is RFC 6749 §3.2. Parameters are checked here, before any service
// call, so a malformed request never reaches a database lookup.
func (h *handlers) mcpToken(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	if !h.mcpReady(w) {
		return
	}
	form, err := parseOAuthForm(w, r)
	if err != nil {
		writeOAuthError(w, oauthInvalidRequest(err.Error()))
		return
	}
	client, err := oauthClient(r, form)
	if err != nil {
		h.writeOAuthErr(w, err, client.basic)
		return
	}
	var pair service.McpTokenPair
	switch form.Get("grant_type") {
	case "authorization_code":
		if err := requireOAuthParams(form, "code", "code_verifier", "redirect_uri"); err != nil {
			writeOAuthError(w, oauthInvalidRequest(err.Error()))
			return
		}
		pair, err = h.McpAuth.Exchange(r.Context(), service.McpExchangeInput{
			ClientID: client.id, ClientSecret: client.secret, Code: form.Get("code"), CodeVerifier: form.Get("code_verifier"),
			RedirectURI: form.Get("redirect_uri"), Resource: form.Get("resource"),
		})
	case "refresh_token":
		if err := requireOAuthParams(form, "refresh_token"); err != nil {
			writeOAuthError(w, oauthInvalidRequest(err.Error()))
			return
		}
		pair, err = h.McpAuth.Refresh(r.Context(), service.McpRefreshInput{
			ClientID: client.id, ClientSecret: client.secret, RefreshToken: form.Get("refresh_token"), Resource: form.Get("resource"),
		})
	case "":
		writeOAuthError(w, oauthInvalidRequest("grant_type is required"))
		return
	default:
		writeOAuthError(w, service.OAuthError{Code: "unsupported_grant_type", Description: "grant_type must be authorization_code or refresh_token", Status: http.StatusBadRequest})
		return
	}
	if err != nil {
		h.writeOAuthErr(w, err, client.basic)
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{
		"access_token": pair.AccessToken, "token_type": "Bearer", "expires_in": pair.ExpiresIn,
		"refresh_token": pair.RefreshToken, "scope": pair.Scope,
	})
}

// mcpRegister is RFC 7591 dynamic client registration.
func (h *handlers) mcpRegister(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	if !h.mcpReady(w) {
		return
	}
	var in service.McpRegistration
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, mcpFormLimit))
	err := dec.Decode(&in)
	if err == nil {
		// One JSON object and nothing after it.
		if _, tail := dec.Token(); !errors.Is(tail, io.EOF) {
			err = errors.New("trailing data")
		}
	}
	if err != nil {
		desc := "body must be one JSON object"
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			desc = "request body is too large"
		}
		writeOAuthError(w, service.OAuthError{Code: "invalid_client_metadata", Description: desc, Status: http.StatusBadRequest})
		return
	}
	reg, err := h.McpAuth.Register(r.Context(), in)
	if err != nil {
		h.writeOAuthErr(w, err, false)
		return
	}
	out := map[string]any{
		"client_id": reg.Client.ClientID, "client_id_issued_at": reg.IssuedAt.Unix(), "client_name": reg.Client.Name,
		"redirect_uris": reg.Client.RedirectURIs, "grant_types": []string{"authorization_code", "refresh_token"},
		"response_types": []string{"code"}, "token_endpoint_auth_method": reg.Client.AuthMethod,
	}
	if reg.Client.LogoURI != "" {
		out["logo_uri"] = reg.Client.LogoURI
	}
	if reg.ClientSecret != "" {
		out["client_secret"] = reg.ClientSecret
		out["client_secret_expires_at"] = 0
	}
	respondJSON(w, http.StatusCreated, out)
}

// mcpRevoke is RFC 7009. A token that is unknown, another client's, already
// revoked or empty answers 200 and changes nothing; only a client that cannot
// authenticate is refused (§2.2.1).
func (h *handlers) mcpRevoke(w http.ResponseWriter, r *http.Request) {
	noStore(w)
	if !h.mcpReady(w) {
		return
	}
	form, err := parseOAuthForm(w, r)
	if err != nil {
		writeOAuthError(w, oauthInvalidRequest(err.Error()))
		return
	}
	client, err := oauthClient(r, form)
	if err != nil {
		h.writeOAuthErr(w, err, client.basic)
		return
	}
	if err := h.McpAuth.RevokeToken(r.Context(), client.id, client.secret, form.Get("token")); err != nil {
		h.writeOAuthErr(w, err, client.basic)
		return
	}
	w.WriteHeader(http.StatusOK)
}

// parseOAuthForm reads the body, and only the body, as an
// application/x-www-form-urlencoded form of at most mcpFormLimit bytes. A
// parameter that appears twice is refused (RFC 6749 §3.2).
func parseOAuthForm(w http.ResponseWriter, r *http.Request) (url.Values, error) {
	media, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if media != "application/x-www-form-urlencoded" {
		return nil, errors.New("content type must be application/x-www-form-urlencoded")
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, mcpFormLimit))
	if err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			return nil, errors.New("request body is too large")
		}
		return nil, errors.New("request body could not be read")
	}
	form, err := url.ParseQuery(string(raw))
	if err != nil {
		return nil, errors.New("malformed form body")
	}
	for k, v := range form {
		if len(v) > 1 {
			return nil, fmt.Errorf("parameter %s is repeated", k)
		}
	}
	return form, nil
}

func requireOAuthParams(form url.Values, names ...string) error {
	for _, n := range names {
		if form.Get(n) == "" {
			return fmt.Errorf("%s is required", n)
		}
	}
	return nil
}

// oauthClientAuth is who a token or revocation request says it is. basic
// records that the client used HTTP Basic, which decides whether a refusal
// carries a WWW-Authenticate challenge (RFC 6749 §5.2).
type oauthClientAuth struct {
	id, secret string
	basic      bool
}

// oauthClient reads client_secret_basic (Authorization: Basic, each half
// form-urlencoded, RFC 6749 §2.3.1) or client_secret_post / none from the
// body. Presenting both, or a client_id that disagrees with the Basic one, is
// a malformed request; a Basic header that cannot be decoded is a failed
// authentication, never a silent fall back to the body.
func oauthClient(r *http.Request, form url.Values) (oauthClientAuth, error) {
	header := r.Header.Get("Authorization")
	if len(header) < len("Basic ") || !strings.EqualFold(header[:len("Basic ")], "Basic ") {
		return oauthClientAuth{id: form.Get("client_id"), secret: form.Get("client_secret")}, nil
	}
	basic := oauthClientAuth{basic: true}
	user, pass, ok := r.BasicAuth()
	if !ok {
		return basic, oauthInvalidClient("malformed Basic credentials")
	}
	id, idErr := url.QueryUnescape(user)
	secret, secretErr := url.QueryUnescape(pass)
	if idErr != nil || secretErr != nil {
		return basic, oauthInvalidClient("malformed Basic credentials")
	}
	if form.Has("client_secret") {
		return basic, oauthInvalidRequest("use one client authentication method")
	}
	if form.Has("client_id") && form.Get("client_id") != id {
		return basic, oauthInvalidRequest("client_id does not match the Basic credentials")
	}
	basic.id, basic.secret = id, secret
	return basic, nil
}

func oauthInvalidRequest(desc string) service.OAuthError {
	return service.OAuthError{Code: "invalid_request", Description: desc, Status: http.StatusBadRequest}
}

func oauthInvalidClient(desc string) service.OAuthError {
	return service.OAuthError{Code: "invalid_client", Description: desc, Status: http.StatusUnauthorized}
}

// writeOAuthErr answers a service error. Protocol errors keep the status the
// service chose; anything else is ours, logged without the request's content.
func (h *handlers) writeOAuthErr(w http.ResponseWriter, err error, basic bool) {
	var oe service.OAuthError
	if errors.As(err, &oe) {
		if oe.Status == http.StatusUnauthorized && basic {
			w.Header().Set("WWW-Authenticate", `Basic realm="uniwork"`)
		}
		writeOAuthError(w, oe)
		return
	}
	h.Log.Error("mcp oauth", "err", err)
	writeOAuthError(w, service.OAuthError{Code: "server_error", Description: "internal error", Status: http.StatusInternalServerError})
}

func writeOAuthError(w http.ResponseWriter, e service.OAuthError) {
	respondJSON(w, e.Status, map[string]string{"error": e.Code, "error_description": e.Description})
}
