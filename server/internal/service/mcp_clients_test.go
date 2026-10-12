package service

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
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
