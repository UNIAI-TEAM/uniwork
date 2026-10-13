package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"
)

func TestMcpRegisterPublicClient(t *testing.T) {
	w := newMcpWorld(t)
	reg, err := w.svc.Register(w.ctx, McpRegistration{ClientName: "Claude", RedirectURIs: []string{"https://claude.ai/api/mcp/auth_callback"}, TokenEndpointAuthMethod: "none"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(reg.Client.ClientID, "mcpc_") || reg.ClientSecret != "" || reg.Client.AuthMethod != "none" {
		t.Fatalf("public client = %+v secret %q", reg.Client, reg.ClientSecret)
	}
	got, err := w.svc.ResolveClient(w.ctx, reg.Client.ClientID)
	if err != nil || got.Name != "Claude" || !got.Verified {
		t.Fatalf("resolve = %+v, %v", got, err)
	}
}

func TestMcpRegisterRejectsBadRedirects(t *testing.T) {
	w := newMcpWorld(t)
	for _, uri := range []string{"", "http://example.com/cb", "https://example.com/cb#frag", "https://*.example.com/cb", "ftp://example.com/cb", "https://user:pw@example.com/cb", "/relative"} {
		_, err := w.svc.Register(w.ctx, McpRegistration{ClientName: "X", RedirectURIs: []string{uri}, TokenEndpointAuthMethod: "none"})
		var oe OAuthError
		if !errors.As(err, &oe) || oe.Code != "invalid_redirect_uri" {
			t.Errorf("redirect %q: err = %v, want invalid_redirect_uri", uri, err)
		}
	}
	for _, uri := range []string{"http://127.0.0.1:7777/cb", "http://[::1]:7777/cb", "http://localhost:7777/cb", "https://example.com/cb?x=1"} {
		if !validMcpRedirectURI(uri) {
			t.Errorf("redirect %q refused, want accepted", uri)
		}
	}
}

func TestMcpRegisterRejectsUnknownGrantAndMethod(t *testing.T) {
	w := newMcpWorld(t)
	cases := []McpRegistration{
		{ClientName: "X", RedirectURIs: []string{"https://x.test/cb"}, GrantTypes: []string{"client_credentials"}},
		{ClientName: "X", RedirectURIs: []string{"https://x.test/cb"}, ResponseTypes: []string{"token"}},
		{ClientName: "X", RedirectURIs: []string{"https://x.test/cb"}, TokenEndpointAuthMethod: "private_key_jwt"},
		{ClientName: " ", RedirectURIs: []string{"https://x.test/cb"}},
	}
	for i, c := range cases {
		var oe OAuthError
		if _, err := w.svc.Register(w.ctx, c); !errors.As(err, &oe) || oe.Code != "invalid_client_metadata" {
			t.Errorf("case %d: err = %v, want invalid_client_metadata", i, err)
		}
	}
}

func TestMcpConfidentialClientAuthenticates(t *testing.T) {
	w := newMcpWorld(t)
	reg, err := w.svc.Register(w.ctx, McpRegistration{ClientName: "Server App", RedirectURIs: []string{"https://x.test/cb"}, TokenEndpointAuthMethod: "client_secret_post"})
	if err != nil || reg.ClientSecret == "" {
		t.Fatalf("register = %+v, %v", reg, err)
	}
	if _, err := w.svc.authenticateClient(w.ctx, reg.Client.ClientID, reg.ClientSecret); err != nil {
		t.Fatalf("right secret: %v", err)
	}
	var oe OAuthError
	if _, err := w.svc.authenticateClient(w.ctx, reg.Client.ClientID, "wrong"); !errors.As(err, &oe) || oe.Code != "invalid_client" || oe.Status != 401 {
		t.Fatalf("wrong secret: %v", err)
	}
}

func TestMcpVerifiedOnlyByRedirectHost(t *testing.T) {
	w := newMcpWorld(t)
	fake := w.publicClient(t, "https://evil.example/claude")
	if fake.Verified {
		t.Fatal("a client is verified by its redirect host, never by its name")
	}
	mixed, err := w.svc.Register(w.ctx, McpRegistration{ClientName: "Claude", RedirectURIs: []string{"https://claude.ai/api/mcp/auth_callback", "https://evil.example/cb"}, TokenEndpointAuthMethod: "none"})
	if err != nil || mixed.Client.Verified {
		t.Fatalf("one foreign redirect must drop the badge: %+v %v", mixed.Client, err)
	}
}

func TestMcpResolveCIMD(t *testing.T) {
	w := newMcpWorld(t)
	id := "https://client.example/oauth/metadata.json"
	doc, _ := json.Marshal(map[string]any{"client_id": id, "client_name": "Doc Client", "redirect_uris": []string{"https://client.example/cb"}})
	f := &fakeCIMD{body: doc}
	w.svc.SetFetcher(f)
	c, err := w.svc.ResolveClient(w.ctx, id)
	if err != nil || c.Kind != "cimd" || c.Name != "Doc Client" || !c.allowsRedirect("https://client.example/cb") {
		t.Fatalf("resolve = %+v, %v", c, err)
	}
	if _, err := w.svc.ResolveClient(w.ctx, id); err != nil || f.calls != 1 {
		t.Fatalf("second resolve fetched again (calls=%d, err=%v); the 24h cache must answer", f.calls, err)
	}

	other := "https://client.example/oauth/other.json"
	f.body, _ = json.Marshal(map[string]any{"client_id": "https://attacker.example/x.json", "client_name": "X", "redirect_uris": []string{"https://client.example/cb"}})
	if _, err := w.svc.ResolveClient(w.ctx, other); !errors.Is(err, errMcpClientUnknown) {
		t.Fatalf("client_id mismatch: %v", err)
	}
	f.body, _ = json.Marshal(map[string]any{"client_id": other, "client_name": "X", "redirect_uris": []string{"https://client.example/cb"}, "token_endpoint_auth_method": "client_secret_basic"})
	if _, err := w.svc.ResolveClient(w.ctx, other); !errors.Is(err, errMcpClientUnknown) {
		t.Fatalf("a metadata document cannot carry a shared secret: %v", err)
	}
}

// Only an unknown client is the client's fault (401 invalid_client); a database
// fault must surface unchanged so a handler answers 500 and the MCP client
// keeps its registration.
func TestMcpAuthenticateClientPropagatesInfrastructureErrors(t *testing.T) {
	w := newMcpWorld(t)
	var oe OAuthError
	if _, err := w.svc.authenticateClient(w.ctx, "mcpc_does_not_exist", ""); !errors.As(err, &oe) || oe.Code != "invalid_client" || oe.Status != 401 {
		t.Fatalf("unknown DCR id: err = %v, want 401 invalid_client", err)
	}

	ctx, cancel := context.WithCancel(w.ctx)
	cancel()
	_, err := w.svc.authenticateClient(ctx, "mcpc_x", "")
	if err == nil {
		t.Fatal("cancelled context: want an error")
	}
	if errors.As(err, &oe) {
		t.Fatalf("a database fault became an OAuth error %+v; clients would drop their registration", oe)
	}
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want the context error propagated", err)
	}
}

// A stale cached document is a better answer than 401 when the host is down:
// a transient fetch failure must not make MCP clients drop their registration.
func TestMcpResolveCIMDServesStaleRowWhenRefetchFails(t *testing.T) {
	w := newMcpWorld(t)
	id := "https://stale.example/oauth/metadata.json"
	doc, _ := json.Marshal(map[string]any{"client_id": id, "client_name": "Stale Client", "redirect_uris": []string{"https://stale.example/cb"}})
	f := &fakeCIMD{body: doc}
	w.svc.SetFetcher(f)
	if _, err := w.svc.ResolveClient(w.ctx, id); err != nil || f.calls != 1 {
		t.Fatalf("first resolve = calls %d, %v", f.calls, err)
	}

	w.svc.now = func() time.Time { return time.Now().Add(25 * time.Hour) }
	f.err = errors.New("down")
	c, err := w.svc.ResolveClient(w.ctx, id)
	if err != nil || c.Name != "Stale Client" || !c.allowsRedirect("https://stale.example/cb") || f.calls != 2 {
		t.Fatalf("stale resolve = %+v, calls %d, err %v; want the cached client after one refetch attempt", c, f.calls, err)
	}

	never := "https://never-seen.example/oauth/metadata.json"
	if _, err := w.svc.ResolveClient(w.ctx, never); !errors.Is(err, errMcpClientUnknown) {
		t.Fatalf("no cached row and the fetch fails: err = %v, want errMcpClientUnknown", err)
	}

	f.err = nil
	f.body = []byte(`{"client_id":"` + id + `","client_name":"","redirect_uris":[]}`)
	if _, err := w.svc.ResolveClient(w.ctx, id); !errors.Is(err, errMcpClientUnknown) {
		t.Fatalf("an invalid document is a real answer, not a stale fallback: err = %v", err)
	}
}

// Stale-while-error is for a host that is down, not for one that answered: a
// withdrawn document (404/410) or an address that is now refused must stop the
// client from resolving even though a cached row exists.
func TestMcpResolveCIMDDefinitiveAnswersDropStaleRow(t *testing.T) {
	w := newMcpWorld(t)
	id := "https://withdrawn.example/oauth/metadata.json"
	doc, _ := json.Marshal(map[string]any{"client_id": id, "client_name": "Withdrawn Client", "redirect_uris": []string{"https://withdrawn.example/cb"}})
	f := &fakeCIMD{body: doc}
	w.svc.SetFetcher(f)
	if _, err := w.svc.ResolveClient(w.ctx, id); err != nil {
		t.Fatalf("first resolve: %v", err)
	}
	w.svc.now = func() time.Time { return time.Now().Add(25 * time.Hour) }

	definitive := map[string]error{
		"404 gone":          fmt.Errorf("%w: status 404", errCIMDRejected),
		"410 gone":          fmt.Errorf("%w: status 410", errCIMDRejected),
		"address refused":   errCIMDNotAllowed,
		"wrapped refused":   fmt.Errorf("fetch: %w", errCIMDNotAllowed),
		"wrapped rejection": fmt.Errorf("fetch: %w", errCIMDRejected),
	}
	for name, ferr := range definitive {
		f.err = ferr
		if c, err := w.svc.ResolveClient(w.ctx, id); !errors.Is(err, errMcpClientUnknown) {
			t.Errorf("%s: resolve = %+v, %v; want errMcpClientUnknown despite the cached row", name, c, err)
		}
	}

	for name, ferr := range map[string]error{
		"plain transport error": errors.New("connection reset"),
		"deadline":              context.DeadlineExceeded,
		"server error":          cimdStatusError(503),
	} {
		f.err = ferr
		if c, err := w.svc.ResolveClient(w.ctx, id); err != nil || c.Name != "Withdrawn Client" {
			t.Errorf("%s: resolve = %+v, %v; want the stale client", name, c, err)
		}
	}
}

// C1: ChatGPT publishes a metadata document whose singular method is
// private_key_jwt but whose list also offers none; it picks none from the
// intersection with what we advertise. Such a client is public and uses PKCE,
// so it is stored as none and its other fields (jwks_uri) are ignored. A
// document that offers no none at all still cannot be a public client.
func TestMcpResolveCIMDAcceptsAPublicMethodInTheList(t *testing.T) {
	w := newMcpWorld(t)
	f := &fakeCIMD{}
	w.svc.SetFetcher(f)
	doc := func(id string, extra map[string]any) []byte {
		m := map[string]any{"client_id": id, "client_name": "ChatGPT", "redirect_uris": []string{"https://chatgpt.com/connector_platform_oauth_redirect"}}
		for k, v := range extra {
			m[k] = v
		}
		b, _ := json.Marshal(m)
		return b
	}

	chatgpt := "https://chatgpt.com/oauth/client.json"
	f.body = doc(chatgpt, map[string]any{
		"token_endpoint_auth_method":            "private_key_jwt",
		"token_endpoint_auth_methods_supported": []string{"none", "private_key_jwt"},
		"jwks_uri":                              "https://chatgpt.com/oauth/jwks.json",
	})
	c, err := w.svc.ResolveClient(w.ctx, chatgpt)
	if err != nil || c.Kind != "cimd" || c.AuthMethod != "none" || !c.Verified {
		t.Fatalf("ChatGPT-shaped document: %+v, %v; want a verified public cimd client", c, err)
	}
	if _, err := w.svc.authenticateClient(w.ctx, chatgpt, ""); err != nil {
		t.Fatalf("a public client authenticates by PKCE alone: %v", err)
	}

	for name, extra := range map[string]map[string]any{
		"singular only, no none": {"token_endpoint_auth_method": "private_key_jwt"},
		"list without none":      {"token_endpoint_auth_method": "private_key_jwt", "token_endpoint_auth_methods_supported": []string{"private_key_jwt"}},
		"empty singular, list without none": {
			"token_endpoint_auth_methods_supported": []string{"private_key_jwt", "client_secret_basic"},
		},
	} {
		id := "https://refused.example/" + strings.ReplaceAll(name, " ", "-") + ".json"
		f.body = doc(id, extra)
		if c, err := w.svc.ResolveClient(w.ctx, id); !errors.Is(err, errMcpClientUnknown) {
			t.Errorf("%s: resolve = %+v, %v; want errMcpClientUnknown", name, c, err)
		}
	}
}

// C2, RFC 8252 §7.3: a native client registers a loopback callback without a
// port and listens on whatever port the system gives it, so http on a loopback
// host matches on scheme, host, path and query whatever the port. Everything
// else is matched exactly.
func TestMcpLoopbackRedirectMatchesAnyPort(t *testing.T) {
	w := newMcpWorld(t)
	reg, err := w.svc.Register(w.ctx, McpRegistration{ClientName: "Claude Code", TokenEndpointAuthMethod: "none", RedirectURIs: []string{
		"http://localhost/callback", "http://127.0.0.1/callback", "http://[::1]:7777/cb?x=1", "https://app.example/cb",
	}})
	if err != nil {
		t.Fatal(err)
	}
	c := reg.Client
	for _, uri := range []string{
		"http://localhost/callback", "http://localhost:3118/callback", "http://127.0.0.1:51234/callback",
		"http://[::1]:7777/cb?x=1", "http://[::1]/cb?x=1", "http://[::1]:9/cb?x=1", "https://app.example/cb",
	} {
		if !c.allowsRedirect(uri) {
			t.Errorf("%s refused, want accepted", uri)
		}
	}
	for _, uri := range []string{
		"http://localhost:3118/other",        // another path
		"http://localhost:3118/callback?x=1", // another query
		"http://[::1]:9/cb",                  // the registered query is missing
		"http://[::1]:9/cb?x=2",              // another query value
		"http://127.0.0.1:3118/cb?x=1",       // the ::1 entry is ::1 only
		"http://[::1]:9/callback",            // localhost and 127.0.0.1 entries are theirs only
		"http://localhost:3118/callback#f",   // a fragment
		"http://u@localhost:3118/callback",   // credentials
		"https://localhost:3118/callback",    // the port rule is for http only
		"https://app.example:8443/cb",        // https stays exact
		"http://app.example/cb",              // a non-loopback http host
		"http://localhost.evil.example:3118/callback",
		"http://localhost:x/callback",
	} {
		if c.allowsRedirect(uri) {
			t.Errorf("%s accepted, want refused", uri)
		}
	}
}

// The attempt records the redirect URI the client sent, port included, and the
// token exchange compares against it exactly: a code issued for one port does
// not redeem for another. A protocol error after the redirect check goes back
// to the port the request named.
func TestMcpLoopbackRedirectIsExactAtTheTokenEndpoint(t *testing.T) {
	w := newMcpWorld(t)
	w.enable(t)
	c := w.publicClient(t, "http://localhost/callback")
	const asked = "http://localhost:3118/callback"

	_, err := w.svc.Start(w.ctx, McpAuthorizeInput{ResponseType: "token", ClientID: c.ClientID, RedirectURI: asked, CodeChallenge: mcpTestChallenge(), CodeChallengeMethod: "S256", State: "s"})
	var ae *McpAuthorizeError
	if !errors.As(err, &ae) || ae.Code != "unsupported_response_type" || ae.RedirectURI != asked {
		t.Fatalf("protocol error: %#v; want it sent back to %s", err, asked)
	}
	_, err = w.svc.Start(w.ctx, McpAuthorizeInput{ResponseType: "code", ClientID: c.ClientID, RedirectURI: "http://localhost:3118/elsewhere", CodeChallenge: mcpTestChallenge(), CodeChallengeMethod: "S256"})
	if !errors.As(err, &ae) || ae.Code != "invalid_request" || ae.RedirectURI != "" {
		t.Fatalf("unregistered path: %#v; want no redirect", err)
	}

	code := w.approve(t, c, asked)
	if code == "" {
		t.Fatal("no code for the loopback callback")
	}
	var oe OAuthError
	if _, err := w.svc.Exchange(w.ctx, McpExchangeInput{ClientID: c.ClientID, Code: code, CodeVerifier: mcpTestVerifier, RedirectURI: "http://localhost:4000/callback"}); !errors.As(err, &oe) || oe.Code != "invalid_grant" {
		t.Fatalf("exchange on another port: %v, want invalid_grant", err)
	}
	if _, err := w.svc.Exchange(w.ctx, McpExchangeInput{ClientID: c.ClientID, Code: code, CodeVerifier: mcpTestVerifier, RedirectURI: asked}); err != nil {
		t.Fatalf("exchange on the authorize port: %v", err)
	}
}
