package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type McpClient struct {
	ClientID     string
	Kind         string
	Name         string
	LogoURI      string
	RedirectURIs []string
	AuthMethod   string
	Verified     bool
	secretDigest string
}

// McpRegistration is the RFC 7591 request body.
type McpRegistration struct {
	ClientName              string   `json:"client_name"`
	RedirectURIs            []string `json:"redirect_uris"`
	GrantTypes              []string `json:"grant_types"`
	ResponseTypes           []string `json:"response_types"`
	TokenEndpointAuthMethod string   `json:"token_endpoint_auth_method"`
	LogoURI                 string   `json:"logo_uri"`
}

type McpRegistered struct {
	Client       McpClient
	ClientSecret string // empty for public clients; shown once, stored as a digest
	IssuedAt     time.Time
}

// verifiedRedirectHosts are callback hosts checked against each vendor's own
// documentation (spec §5.4). A client earns the "verified" badge only when
// every redirect URI is on one of them; a client's own name never counts.
// Re-check these against the vendors' docs before each release that touches them.
var verifiedRedirectHosts = map[string]bool{
	"claude.ai":   true, // Claude custom connectors: https://claude.ai/api/mcp/auth_callback
	"claude.com":  true,
	"chatgpt.com": true, // ChatGPT connectors: https://chatgpt.com/connector_platform_oauth_redirect
}

var errMcpClientUnknown = errors.New("mcp: unknown client")

const cimdCacheTTL = 24 * time.Hour

func (s *McpAuthService) Register(ctx context.Context, in McpRegistration) (McpRegistered, error) {
	name := strings.TrimSpace(in.ClientName)
	if name == "" || utf8.RuneCountInString(name) > 100 {
		return McpRegistered{}, oauthErr(http.StatusBadRequest, "invalid_client_metadata", "client_name is required (1-100 characters)")
	}
	if len(in.RedirectURIs) == 0 || len(in.RedirectURIs) > 10 {
		return McpRegistered{}, oauthErr(http.StatusBadRequest, "invalid_redirect_uri", "between 1 and 10 redirect_uris are required")
	}
	for _, u := range in.RedirectURIs {
		if !validMcpRedirectURI(u) {
			return McpRegistered{}, oauthErr(http.StatusBadRequest, "invalid_redirect_uri", "redirect_uris must be https (or loopback http) with no fragment, wildcard or credentials")
		}
	}
	for _, g := range in.GrantTypes {
		if g != "authorization_code" && g != "refresh_token" {
			return McpRegistered{}, oauthErr(http.StatusBadRequest, "invalid_client_metadata", "grant_types may hold authorization_code and refresh_token only")
		}
	}
	for _, r := range in.ResponseTypes {
		if r != "code" {
			return McpRegistered{}, oauthErr(http.StatusBadRequest, "invalid_client_metadata", "response_types may hold code only")
		}
	}
	method := in.TokenEndpointAuthMethod
	if method == "" {
		method = "client_secret_basic" // RFC 7591 §2 default
	}
	if method != "none" && method != "client_secret_post" && method != "client_secret_basic" {
		return McpRegistered{}, oauthErr(http.StatusBadRequest, "invalid_client_metadata", "unsupported token_endpoint_auth_method")
	}
	var secret string
	var secretDigest pgtype.Text
	if method != "none" {
		raw, err := randomToken(32)
		if err != nil {
			return McpRegistered{}, err
		}
		secret, secretDigest = raw, pgtype.Text{String: digest(raw), Valid: true}
	}
	uris, err := json.Marshal(in.RedirectURIs)
	if err != nil {
		return McpRegistered{}, err
	}
	row, err := s.q.CreateMcpClient(ctx, db.CreateMcpClientParams{
		ID: util.NewID(), ClientID: "mcpc_" + util.NewID(), ClientName: name, LogoUri: safeLogo(in.LogoURI),
		RedirectUris: string(uris), TokenEndpointAuthMethod: method, SecretDigest: secretDigest,
	})
	if err != nil {
		return McpRegistered{}, err
	}
	s.metrics.IncOAuth("client_registered")
	return McpRegistered{Client: mcpClientFromRow(row), ClientSecret: secret, IssuedAt: row.CreatedAt.Time}, nil
}

// ResolveClient finds a registered client or fetches its metadata document.
func (s *McpAuthService) ResolveClient(ctx context.Context, clientID string) (McpClient, error) {
	if isCIMDClientID(clientID) {
		return s.resolveCIMD(ctx, clientID)
	}
	row, err := s.q.GetMcpClientByClientID(ctx, clientID)
	if errors.Is(err, pgx.ErrNoRows) {
		return McpClient{}, errMcpClientUnknown
	}
	if err != nil {
		return McpClient{}, err
	}
	return mcpClientFromRow(row), nil
}

func (s *McpAuthService) resolveCIMD(ctx context.Context, clientID string) (McpClient, error) {
	row, err := s.q.GetMcpClientByClientID(ctx, clientID)
	if err == nil && row.MetadataFetchedAt.Valid && s.now().Sub(row.MetadataFetchedAt.Time) < cimdCacheTTL {
		return mcpClientFromRow(row), nil
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return McpClient{}, err
	}
	cached := err == nil // a stale row exists; it answers if the refetch cannot
	if s.fetch == nil {
		return McpClient{}, errMcpClientUnknown
	}
	body, err := s.fetch.Fetch(ctx, clientID)
	if err != nil {
		// stale-while-error, for a host that is down only: a definitive answer
		// (withdrawn document, refused address) must not keep the client alive.
		if cached && !errors.Is(err, errCIMDRejected) && !errors.Is(err, errCIMDNotAllowed) {
			return mcpClientFromRow(row), nil
		}
		return McpClient{}, errMcpClientUnknown
	}
	var doc struct {
		ClientID                 string   `json:"client_id"`
		ClientName               string   `json:"client_name"`
		RedirectURIs             []string `json:"redirect_uris"`
		LogoURI                  string   `json:"logo_uri"`
		TokenEndpointAuthMethod  string   `json:"token_endpoint_auth_method"`
		TokenEndpointAuthMethods []string `json:"token_endpoint_auth_methods_supported"`
	}
	if json.Unmarshal(body, &doc) != nil || doc.ClientID != clientID || strings.TrimSpace(doc.ClientName) == "" || len(doc.RedirectURIs) == 0 || len(doc.RedirectURIs) > 10 {
		return McpClient{}, errMcpClientUnknown
	}
	if !cimdOffersNone(doc.TokenEndpointAuthMethod, doc.TokenEndpointAuthMethods) {
		return McpClient{}, errMcpClientUnknown // a public document cannot pre-share a secret
	}
	for _, u := range doc.RedirectURIs {
		if !validMcpRedirectURI(u) {
			return McpClient{}, errMcpClientUnknown
		}
	}
	uris, err := json.Marshal(doc.RedirectURIs)
	if err != nil {
		return McpClient{}, err
	}
	name := strings.TrimSpace(doc.ClientName)
	if utf8.RuneCountInString(name) > 100 {
		name = string([]rune(name)[:100])
	}
	up, err := s.q.UpsertMcpCIMDClient(ctx, db.UpsertMcpCIMDClientParams{
		ID: util.NewID(), ClientID: clientID, ClientName: name, LogoUri: safeLogo(doc.LogoURI), RedirectUris: string(uris),
	})
	if err != nil {
		return McpClient{}, err
	}
	return mcpClientFromRow(up), nil
}

// cimdOffersNone reports whether a metadata document lets its client
// authenticate as a public one. A document may name one method or list several
// (ChatGPT names private_key_jwt and lists none beside it, then picks none
// from what we advertise); either way the client is stored as none and uses
// PKCE, and fields for other methods (jwks_uri) are ignored. A document that
// names neither defaults to none, as before; one whose methods leave none out
// is refused.
func cimdOffersNone(method string, methods []string) bool {
	return method == "none" || slices.Contains(methods, "none") || (method == "" && len(methods) == 0)
}

// authenticateClient implements the token endpoint's client check: public
// clients rely on PKCE, confidential ones must present their secret.
func (s *McpAuthService) authenticateClient(ctx context.Context, clientID, secret string) (McpClient, error) {
	c, err := s.ResolveClient(ctx, clientID)
	if errors.Is(err, errMcpClientUnknown) {
		return McpClient{}, oauthErr(http.StatusUnauthorized, "invalid_client", "unknown client")
	}
	if err != nil {
		return McpClient{}, err // infrastructure fault: not the client's, so not invalid_client
	}
	if c.AuthMethod == "none" {
		return c, nil
	}
	if secret == "" || !secureDigestEqual(c.secretDigest, digest(secret)) {
		return McpClient{}, oauthErr(http.StatusUnauthorized, "invalid_client", "client authentication failed")
	}
	return c, nil
}

func isCIMDClientID(id string) bool {
	u, err := url.Parse(id)
	return err == nil && u.Scheme == "https" && u.Host != "" && u.Path != "" && u.Path != "/" && u.Fragment == ""
}

// validMcpRedirectURI: https anywhere, or http on a loopback host (RFC 8252
// native clients such as Gemini CLI); never a fragment, wildcard or userinfo.
func validMcpRedirectURI(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.Fragment != "" || u.User != nil || strings.Contains(raw, "*") {
		return false
	}
	switch u.Scheme {
	case "https":
		return true
	case "http":
		h := u.Hostname()
		return h == "127.0.0.1" || h == "::1" || h == "localhost"
	}
	return false
}

func safeLogo(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Scheme != "https" || u.Host == "" || len(raw) > 2048 {
		return ""
	}
	return u.String()
}

func mcpClientFromRow(r db.McpClient) McpClient {
	var uris []string
	_ = json.Unmarshal([]byte(r.RedirectUris), &uris)
	return McpClient{
		ClientID: r.ClientID, Kind: r.Kind, Name: r.ClientName, LogoURI: r.LogoUri, RedirectURIs: uris,
		AuthMethod: r.TokenEndpointAuthMethod, Verified: verifiedRedirects(uris), secretDigest: r.SecretDigest.String,
	}
}

func verifiedRedirects(uris []string) bool {
	if len(uris) == 0 {
		return false
	}
	for _, raw := range uris {
		u, err := url.Parse(raw)
		if err != nil || u.Scheme != "https" || !verifiedRedirectHosts[u.Hostname()] {
			return false
		}
	}
	return true
}

// allowsRedirect matches uri against the registered redirect URIs exactly,
// with one exception from RFC 8252 §7.3: a native client registers an http
// loopback callback and listens on whatever port the system gives it, so for
// http on a loopback host the port is ignored and scheme, host, path and query
// must still match. The attempt keeps the URI as asked, port included, and the
// token endpoint compares against that exactly.
func (c McpClient) allowsRedirect(uri string) bool {
	if slices.Contains(c.RedirectURIs, uri) {
		return true
	}
	asked, ok := loopbackRedirect(uri)
	if !ok {
		return false
	}
	for _, raw := range c.RedirectURIs {
		reg, ok := loopbackRedirect(raw)
		if ok && reg.Hostname() == asked.Hostname() && reg.EscapedPath() == asked.EscapedPath() && reg.RawQuery == asked.RawQuery && reg.ForceQuery == asked.ForceQuery {
			return true
		}
	}
	return false
}

// loopbackRedirect parses an http redirect URI on a loopback host that is
// otherwise acceptable as a redirect URI; ok is false for anything else.
func loopbackRedirect(raw string) (*url.URL, bool) {
	if !validMcpRedirectURI(raw) {
		return nil, false
	}
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "http" {
		return nil, false
	}
	return u, true
}
