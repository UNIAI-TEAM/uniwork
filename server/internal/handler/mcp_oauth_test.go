package handler

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type mcpTestFlags bool

func (f mcpTestFlags) IsEnabled(context.Context, string, bool) bool { return bool(f) }

const (
	mcpTestIssuer = "https://api.example.test"
	// RFC 7636 appendix B pair.
	mcpTestVerifier  = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
	mcpTestChallenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
	mcpTestRedirect  = "https://x.test/cb"
	mcpConnectPage   = "http://localhost:3000/auth/connect/authorize"
)

func newMcpTestServer(t *testing.T) (*httptest.Server, Deps) {
	t.Helper()
	return newMcpTestServerWith(t, nil)
}

// newMcpTestServerWith lets a test change the wiring (metrics, a missing
// service) before the router is built from it.
func newMcpTestServerWith(t *testing.T, tune func(*Deps)) (*httptest.Server, Deps) {
	t.Helper()
	d, pool := newTestDeps(t, nil, discardOutbox{})
	d.Cfg.APIPublicURL = mcpTestIssuer
	d.McpAuth = service.NewMcpAuthService(pool, db.New(pool), d.Organizations, d.Cfg)
	d.McpAuth.SetFlags(mcpTestFlags(true))
	d.McpTools = service.NewMcpToolService(db.New(pool), d.AskUNI, d.Home, d.Workspaces, d.Cfg.FrontendOrigin)
	if tune != nil {
		tune(&d)
	}
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)
	return srv, d
}

func noFollow(srv *httptest.Server) *http.Client {
	c := *srv.Client()
	c.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &c
}

func readJSON(t *testing.T, res *http.Response) map[string]any {
	t.Helper()
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	out := map[string]any{}
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("body %q: %v", raw, err)
	}
	return out
}

func mcpRegister(t *testing.T, srv *httptest.Server, redirect string) string {
	t.Helper()
	body := `{"client_name":"Test","redirect_uris":["` + redirect + `"],"token_endpoint_auth_method":"none"}`
	res, err := srv.Client().Post(srv.URL+"/oauth/register", "application/json", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("register status = %d", res.StatusCode)
	}
	return readJSON(t, res)["client_id"].(string)
}

// mcpForm builds a form body; a repeated key stays repeated.
func mcpForm(kv ...string) string {
	v := url.Values{}
	for i := 0; i+1 < len(kv); i += 2 {
		v.Add(kv[i], kv[i+1])
	}
	return v.Encode()
}

func mcpBasic(id, secret string) string {
	return "Basic " + base64.StdEncoding.EncodeToString([]byte(url.QueryEscape(id)+":"+url.QueryEscape(secret)))
}

func wantNoStore(t *testing.T, res *http.Response) {
	t.Helper()
	if got := res.Header.Get("Cache-Control"); got != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store", got)
	}
	if got := res.Header.Get("Pragma"); got != "no-cache" {
		t.Errorf("Pragma = %q, want no-cache", got)
	}
}

func wantJSONType(t *testing.T, res *http.Response) {
	t.Helper()
	if got := res.Header.Get("Content-Type"); !strings.HasPrefix(got, "application/json") {
		t.Errorf("Content-Type = %q, want application/json", got)
	}
}

// wantOAuthError checks an RFC 6749 §5.2 error: status, the two fields, and
// the headers every token-endpoint answer carries.
func wantOAuthError(t *testing.T, what string, res *http.Response, out map[string]any, status int, code string) {
	t.Helper()
	if res.StatusCode != status || out["error"] != code {
		t.Errorf("%s: %d %v, want %d %s", what, res.StatusCode, out, status, code)
	}
	if d, _ := out["error_description"].(string); d == "" {
		t.Errorf("%s: no error_description in %v", what, out)
	}
	wantNoStore(t, res)
	wantJSONType(t, res)
}

// mcpOAuthWorld is a server with one organization whose owner may approve
// consent, so a test can obtain a real authorization code.
type mcpOAuthWorld struct {
	srv    *httptest.Server
	d      Deps
	userID string
	orgID  string
}

func newMcpOAuthWorld(t *testing.T) *mcpOAuthWorld {
	t.Helper()
	srv, d := newMcpTestServer(t)
	token, userID := signUp(t, srv, "mcp-oauth@example.com", "MCP OAuth")
	res, out := doJSON(t, srv, http.MethodPost, "/api/v1/orgs", token, map[string]string{"name": "MCP Org", "slug": "mcp-org"})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create org: %d %v", res.StatusCode, out)
	}
	orgID := out["organization"].(map[string]any)["id"].(string)
	if _, err := db.New(testPool).SetOrganizationMcpPolicy(context.Background(), db.SetOrganizationMcpPolicyParams{ID: orgID, Enabled: true, ActorID: userID}); err != nil {
		t.Fatal(err)
	}
	return &mcpOAuthWorld{srv: srv, d: d, userID: userID, orgID: orgID}
}

// post sends body to path and returns the response with its JSON body (empty
// map for an empty body). Content-Type defaults to the form type.
func (w *mcpOAuthWorld) post(t *testing.T, path, body string, header map[string]string) (*http.Response, map[string]any) {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, w.srv.URL+path, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	for k, v := range header {
		req.Header.Set(k, v)
	}
	res, err := w.srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := io.ReadAll(res.Body)
	res.Body.Close()
	out := map[string]any{}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &out); err != nil {
			t.Fatalf("%s body %q: %v", path, raw, err)
		}
	}
	return res, out
}

// register runs DCR with a JSON body and returns the 201 document.
func (w *mcpOAuthWorld) register(t *testing.T, body string) map[string]any {
	t.Helper()
	res, out := w.post(t, "/oauth/register", body, map[string]string{"Content-Type": "application/json"})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("register: %d %v", res.StatusCode, out)
	}
	return out
}

// code walks authorize → consent → approve for the owner and returns the code.
func (w *mcpOAuthWorld) code(t *testing.T, clientID, redirect string) string {
	t.Helper()
	ctx := context.Background()
	to, err := w.d.McpAuth.Start(ctx, service.McpAuthorizeInput{
		ResponseType: "code", ClientID: clientID, RedirectURI: redirect,
		CodeChallenge: mcpTestChallenge, CodeChallengeMethod: "S256", State: "st",
	})
	if err != nil {
		t.Fatal(err)
	}
	u, _ := url.Parse(to)
	attempt := u.Query().Get("attempt")
	consent, err := w.d.McpAuth.Consent(ctx, w.userID, attempt)
	if err != nil {
		t.Fatal(err)
	}
	back, err := w.d.McpAuth.Approve(ctx, w.userID, attempt, consent.CSRFToken, w.orgID)
	if err != nil {
		t.Fatal(err)
	}
	bu, _ := url.Parse(back)
	return bu.Query().Get("code")
}

// exchangeForm is the authorization_code request body for a fresh code.
func (w *mcpOAuthWorld) exchangeForm(t *testing.T, clientID string, extra ...string) string {
	t.Helper()
	kv := []string{"grant_type", "authorization_code", "code", w.code(t, clientID, mcpTestRedirect), "code_verifier", mcpTestVerifier, "redirect_uri", mcpTestRedirect}
	return mcpForm(append(kv, extra...)...)
}

// pair issues a token pair through the real endpoint for a public client.
func (w *mcpOAuthWorld) pair(t *testing.T, clientID string) (access, refresh string) {
	t.Helper()
	res, out := w.post(t, "/oauth/token", w.exchangeForm(t, clientID, "client_id", clientID), nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("token: %d %v", res.StatusCode, out)
	}
	return out["access_token"].(string), out["refresh_token"].(string)
}

func TestMcpDiscoveryDocuments(t *testing.T) {
	srv, _ := newMcpTestServer(t)
	for _, path := range []string{"/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"} {
		res, err := srv.Client().Get(srv.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		wantJSONType(t, res)
		doc := readJSON(t, res)
		if doc["resource"] != mcpTestIssuer+"/mcp" {
			t.Fatalf("%s resource = %v", path, doc["resource"])
		}
		servers, _ := doc["authorization_servers"].([]any)
		if len(servers) != 1 || servers[0] != mcpTestIssuer {
			t.Fatalf("%s authorization_servers = %v", path, doc["authorization_servers"])
		}
		if scopes, _ := doc["scopes_supported"].([]any); len(scopes) != 1 || scopes[0] != "read" {
			t.Fatalf("%s scopes_supported = %v", path, doc["scopes_supported"])
		}
		if methods, _ := doc["bearer_methods_supported"].([]any); len(methods) != 1 || methods[0] != "header" {
			t.Fatalf("%s bearer_methods_supported = %v", path, doc["bearer_methods_supported"])
		}
	}
	res, err := srv.Client().Get(srv.URL + "/.well-known/oauth-authorization-server")
	if err != nil {
		t.Fatal(err)
	}
	wantJSONType(t, res)
	doc := readJSON(t, res)
	if doc["issuer"] != mcpTestIssuer || doc["token_endpoint"] != mcpTestIssuer+"/oauth/token" || doc["client_id_metadata_document_supported"] != true {
		t.Fatalf("authorization server metadata = %v", doc)
	}
	for key, want := range map[string]string{
		"authorization_endpoint": mcpTestIssuer + "/oauth/authorize",
		"registration_endpoint":  mcpTestIssuer + "/oauth/register",
		"revocation_endpoint":    mcpTestIssuer + "/oauth/revoke",
	} {
		if doc[key] != want {
			t.Errorf("%s = %v, want %s", key, doc[key], want)
		}
	}
	strs := func(key string) []string {
		var out []string
		for _, v := range doc[key].([]any) {
			out = append(out, v.(string))
		}
		return out
	}
	if got := strs("code_challenge_methods_supported"); !slices.Equal(got, []string{"S256"}) {
		t.Errorf("code_challenge_methods_supported = %v, want only S256", got)
	}
	if got := strs("response_types_supported"); !slices.Equal(got, []string{"code"}) {
		t.Errorf("response_types_supported = %v", got)
	}
	if got := strs("grant_types_supported"); !slices.Equal(got, []string{"authorization_code", "refresh_token"}) {
		t.Errorf("grant_types_supported = %v", got)
	}
	for _, key := range []string{"token_endpoint_auth_methods_supported", "revocation_endpoint_auth_methods_supported"} {
		if got := strs(key); !slices.Equal(got, []string{"none", "client_secret_post", "client_secret_basic"}) {
			t.Errorf("%s = %v", key, got)
		}
	}
	if doc["authorization_response_iss_parameter_supported"] != true {
		t.Errorf("authorization_response_iss_parameter_supported = %v, want true (RFC 9207)", doc["authorization_response_iss_parameter_supported"])
	}
}

func TestMcpAuthorizeRedirects(t *testing.T) {
	srv, _ := newMcpTestServer(t)
	clientID := mcpRegister(t, srv, "https://x.test/cb")
	c := noFollow(srv)
	challenge := "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
	q := url.Values{"response_type": {"code"}, "client_id": {clientID}, "redirect_uri": {"https://x.test/cb"}, "code_challenge": {challenge}, "code_challenge_method": {"S256"}, "state": {"s1"}}
	res, err := c.Get(srv.URL + "/oauth/authorize?" + q.Encode())
	if err != nil {
		t.Fatal(err)
	}
	if loc := res.Header.Get("Location"); res.StatusCode != http.StatusFound || !strings.HasPrefix(loc, "http://localhost:3000/auth/connect/authorize?attempt=") {
		t.Fatalf("valid authorize: %d %s", res.StatusCode, loc)
	}
	wantNoStore(t, res)

	q.Set("code_challenge_method", "plain")
	res, _ = c.Get(srv.URL + "/oauth/authorize?" + q.Encode())
	loc, _ := url.Parse(res.Header.Get("Location"))
	if loc.Host != "x.test" || loc.Query().Get("error") != "invalid_request" || loc.Query().Get("state") != "s1" {
		t.Fatalf("protocol error redirect = %s", loc)
	}
	if loc.Query().Get("iss") != mcpTestIssuer {
		t.Errorf("error redirect iss = %q, want the issuer (RFC 9207)", loc.Query().Get("iss"))
	}
	if loc.Query().Get("error_description") == "" {
		t.Error("error redirect carries no error_description")
	}
	wantNoStore(t, res)

	q.Set("client_id", "mcpc_unknown")
	res, _ = c.Get(srv.URL + "/oauth/authorize?" + q.Encode())
	if loc := res.Header.Get("Location"); !strings.HasPrefix(loc, "http://localhost:3000/auth/connect/authorize?error=invalid_client") {
		t.Fatalf("unknown client must land on the UniWork error page, got %s", loc)
	}
}

// A redirect URI registered with a query keeps it on the error redirect, and
// a parameter of ours replaces a planted one instead of doubling up.
func TestMcpAuthorizeErrorRedirectKeepsRegisteredQuery(t *testing.T) {
	srv, _ := newMcpTestServer(t)
	redirect := "https://x.test/cb?x=1&state=planted"
	clientID := mcpRegister(t, srv, redirect)
	q := url.Values{"response_type": {"token"}, "client_id": {clientID}, "redirect_uri": {redirect}, "code_challenge": {mcpTestChallenge}, "code_challenge_method": {"S256"}, "state": {"s1"}}
	res, err := noFollow(srv).Get(srv.URL + "/oauth/authorize?" + q.Encode())
	if err != nil {
		t.Fatal(err)
	}
	loc, err := url.Parse(res.Header.Get("Location"))
	if err != nil || res.StatusCode != http.StatusFound || loc.Host != "x.test" || loc.Path != "/cb" {
		t.Fatalf("error redirect: %d %s", res.StatusCode, res.Header.Get("Location"))
	}
	got := loc.Query()
	if got.Get("x") != "1" {
		t.Errorf("registered query lost: %s", loc)
	}
	if got.Get("error") != "unsupported_response_type" || got.Get("iss") != mcpTestIssuer {
		t.Errorf("error redirect = %s", loc)
	}
	if states := got["state"]; len(states) != 1 || states[0] != "s1" {
		t.Errorf("state = %v, want exactly [s1] (the planted value replaced)", states)
	}
}

// Start decides where a request may be sent back: an unregistered redirect
// URI is never used, and neither is a request whose parameters are repeated.
func TestMcpAuthorizeNeverRedirectsToAnUntrustedURI(t *testing.T) {
	srv, _ := newMcpTestServer(t)
	clientID := mcpRegister(t, srv, mcpTestRedirect)
	base := func() url.Values {
		return url.Values{"response_type": {"code"}, "client_id": {clientID}, "redirect_uri": {mcpTestRedirect}, "code_challenge": {mcpTestChallenge}, "code_challenge_method": {"S256"}, "state": {"s1"}}
	}
	onPage := func(what, rawQuery, wantCode string) {
		t.Helper()
		res, err := noFollow(srv).Get(srv.URL + "/oauth/authorize?" + rawQuery)
		if err != nil {
			t.Fatal(err)
		}
		loc := res.Header.Get("Location")
		if res.StatusCode != http.StatusFound || !strings.HasPrefix(loc, mcpConnectPage+"?error="+wantCode) {
			t.Errorf("%s: %d %s, want the UniWork error page with %s", what, res.StatusCode, loc, wantCode)
		}
		if strings.Contains(loc, "evil.test") || strings.Contains(loc, "x.test") {
			t.Errorf("%s: redirected towards a client address: %s", what, loc)
		}
		wantNoStore(t, res)
	}

	for what, mutate := range map[string]func(url.Values){
		"other host": func(q url.Values) { q.Set("redirect_uri", "https://evil.test/cb") },
		"other path": func(q url.Values) { q.Set("redirect_uri", "https://x.test/other") },
		"missing":    func(q url.Values) { q.Del("redirect_uri") },
		"other, bad method": func(q url.Values) {
			q.Set("redirect_uri", "https://evil.test/cb")
			q.Set("code_challenge_method", "plain")
		},
		"other, bad type": func(q url.Values) { q.Set("redirect_uri", "https://evil.test/cb"); q.Set("response_type", "token") },
	} {
		q := base()
		mutate(q)
		onPage(what, q.Encode(), "invalid_request")
	}

	for _, key := range []string{"client_id", "redirect_uri", "state", "code_challenge", "response_type", "code_challenge_method"} {
		q := base()
		extra := "evil"
		if key == "redirect_uri" {
			extra = "https://evil.test/cb"
		}
		onPage("repeated "+key, q.Encode()+"&"+key+"="+url.QueryEscape(extra), "invalid_request")
	}
}

func TestMcpTokenEndpointErrors(t *testing.T) {
	srv, _ := newMcpTestServer(t)
	post := func(contentType, body string) map[string]any {
		res, err := srv.Client().Post(srv.URL+"/oauth/token", contentType, strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		if res.Header.Get("Cache-Control") != "no-store" {
			t.Fatal("token responses must not be cached")
		}
		return readJSON(t, res)
	}
	if got := post("application/json", `{"grant_type":"authorization_code"}`); got["error"] != "invalid_request" {
		t.Fatalf("json body: %v", got)
	}
	if got := post("application/x-www-form-urlencoded", "grant_type=password"); got["error"] != "unsupported_grant_type" {
		t.Fatalf("password grant: %v", got)
	}
	if got := post("application/x-www-form-urlencoded", "grant_type=authorization_code&code=a&code=b"); got["error"] != "invalid_request" {
		t.Fatalf("repeated parameter: %v", got)
	}
	// Complete parameters, so the answer comes from client authentication and
	// not from the required-parameter check that runs first.
	unknown := mcpForm("grant_type", "authorization_code", "client_id", "mcpc_nope", "code", "x", "code_verifier", mcpTestVerifier, "redirect_uri", mcpTestRedirect)
	if got := post("application/x-www-form-urlencoded", unknown); got["error"] != "invalid_client" {
		t.Fatalf("unknown client: %v", got)
	}
}

func TestMcpTokenRequiresItsParameters(t *testing.T) {
	w := newMcpOAuthWorld(t)
	for what, body := range map[string]string{
		"no grant_type":        mcpForm("client_id", "mcpc_nope"),
		"empty grant_type":     mcpForm("grant_type", "", "client_id", "mcpc_nope"),
		"code missing":         mcpForm("grant_type", "authorization_code", "client_id", "mcpc_nope", "code_verifier", mcpTestVerifier, "redirect_uri", mcpTestRedirect),
		"code_verifier absent": mcpForm("grant_type", "authorization_code", "client_id", "mcpc_nope", "code", "x", "redirect_uri", mcpTestRedirect),
		"redirect_uri absent":  mcpForm("grant_type", "authorization_code", "client_id", "mcpc_nope", "code", "x", "code_verifier", mcpTestVerifier),
		"code empty":           mcpForm("grant_type", "authorization_code", "client_id", "mcpc_nope", "code", "", "code_verifier", mcpTestVerifier, "redirect_uri", mcpTestRedirect),
		"refresh_token absent": mcpForm("grant_type", "refresh_token", "client_id", "mcpc_nope"),
		"refresh_token empty":  mcpForm("grant_type", "refresh_token", "client_id", "mcpc_nope", "refresh_token", ""),
	} {
		// The client is unknown: only a check made before the service runs
		// can answer invalid_request instead of invalid_client.
		res, out := w.post(t, "/oauth/token", body, nil)
		wantOAuthError(t, what, res, out, http.StatusBadRequest, "invalid_request")
	}

	res, out := w.post(t, "/oauth/token", mcpForm("grant_type", "implicit", "client_id", "mcpc_nope"), nil)
	wantOAuthError(t, "unsupported grant", res, out, http.StatusBadRequest, "unsupported_grant_type")
}

func TestMcpEndpointsRefuseRepeatedParameters(t *testing.T) {
	w := newMcpOAuthWorld(t)
	for what, c := range map[string]struct{ path, body string }{
		"token: grant_type":     {"/oauth/token", "grant_type=refresh_token&grant_type=authorization_code&refresh_token=a"},
		"token: client_id":      {"/oauth/token", "grant_type=refresh_token&client_id=a&client_id=b&refresh_token=c"},
		"token: refresh_token":  {"/oauth/token", "grant_type=refresh_token&refresh_token=a&refresh_token=b"},
		"token: code_verifier":  {"/oauth/token", "grant_type=authorization_code&code=a&code_verifier=b&code_verifier=c&redirect_uri=d"},
		"token: redirect_uri":   {"/oauth/token", "grant_type=authorization_code&code=a&code_verifier=b&redirect_uri=d&redirect_uri=e"},
		"revoke: token":         {"/oauth/revoke", "client_id=a&token=a&token=b"},
		"revoke: client_secret": {"/oauth/revoke", "client_id=a&client_secret=a&client_secret=b&token=c"},
	} {
		res, out := w.post(t, c.path, c.body, nil)
		wantOAuthError(t, what, res, out, http.StatusBadRequest, "invalid_request")
	}
}

func TestMcpOAuthFormsAreCapped(t *testing.T) {
	w := newMcpOAuthWorld(t)
	big := strings.Repeat("a", 17<<10)
	for _, path := range []string{"/oauth/token", "/oauth/revoke"} {
		res, out := w.post(t, path, "grant_type=refresh_token&refresh_token="+big, nil)
		wantOAuthError(t, path+" oversize", res, out, http.StatusBadRequest, "invalid_request")
		if d, _ := out["error_description"].(string); !strings.Contains(d, "too large") {
			t.Errorf("%s oversize: description %q does not say the body is too large", path, d)
		}
		res, out = w.post(t, path, "token=a", map[string]string{"Content-Type": "application/json"})
		wantOAuthError(t, path+" JSON body", res, out, http.StatusBadRequest, "invalid_request")
		res, out = w.post(t, path, "token=a", map[string]string{"Content-Type": "text/plain"})
		wantOAuthError(t, path+" text body", res, out, http.StatusBadRequest, "invalid_request")
		res, out = w.post(t, path, "token=a", map[string]string{"Content-Type": ""})
		wantOAuthError(t, path+" no content type", res, out, http.StatusBadRequest, "invalid_request")
	}

	// A form with a charset parameter is still a form.
	res, out := w.post(t, "/oauth/token", mcpForm("grant_type", "implicit"), map[string]string{"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"})
	wantOAuthError(t, "charset", res, out, http.StatusBadRequest, "unsupported_grant_type")

	// Query parameters are not form parameters: nothing in the URL counts.
	res, out = w.post(t, "/oauth/token?grant_type=refresh_token&refresh_token=x&client_id=y", "", nil)
	wantOAuthError(t, "query only", res, out, http.StatusBadRequest, "invalid_request")
}

func TestMcpTokenIssuesAndRotates(t *testing.T) {
	w := newMcpOAuthWorld(t)
	clientID := mcpRegister(t, w.srv, mcpTestRedirect)

	res, out := w.post(t, "/oauth/token", w.exchangeForm(t, clientID, "client_id", clientID), nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("exchange: %d %v", res.StatusCode, out)
	}
	wantNoStore(t, res)
	wantJSONType(t, res)
	keys := make([]string, 0, len(out))
	for k := range out {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	if !slices.Equal(keys, []string{"access_token", "expires_in", "refresh_token", "scope", "token_type"}) {
		t.Fatalf("token response members = %v", keys)
	}
	access, refresh := out["access_token"].(string), out["refresh_token"].(string)
	if !strings.HasPrefix(access, "uwm_at_") || !strings.HasPrefix(refresh, "uwm_rt_") {
		t.Errorf("token prefixes: %.9s / %.9s", access, refresh)
	}
	if out["token_type"] != "Bearer" || out["scope"] != "read" || out["expires_in"] != float64(3600) {
		t.Errorf("token response = token_type %v scope %v expires_in %v", out["token_type"], out["scope"], out["expires_in"])
	}
	if _, err := w.d.McpAuth.Authenticate(context.Background(), access); err != nil {
		t.Errorf("the issued access token does not authenticate: %v", err)
	}

	res, out = w.post(t, "/oauth/token", mcpForm("grant_type", "refresh_token", "client_id", clientID, "refresh_token", refresh), nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("refresh: %d %v", res.StatusCode, out)
	}
	wantNoStore(t, res)
	next := out["refresh_token"].(string)
	if next == refresh || out["access_token"] == access || out["scope"] != "read" || out["token_type"] != "Bearer" {
		t.Errorf("refresh did not rotate: %v", out)
	}

	// The client raced itself: the old token inside the grace window is
	// refused without closing the family, so the new token still works.
	res, out = w.post(t, "/oauth/token", mcpForm("grant_type", "refresh_token", "client_id", clientID, "refresh_token", refresh), nil)
	wantOAuthError(t, "refresh raced", res, out, http.StatusBadRequest, "invalid_grant")
	res, out = w.post(t, "/oauth/token", mcpForm("grant_type", "refresh_token", "client_id", clientID, "refresh_token", next), nil)
	if res.StatusCode != http.StatusOK {
		t.Errorf("the family was closed by a raced refresh: %d %v", res.StatusCode, out)
	}
}

func TestMcpTokenRefusesAReplayedCode(t *testing.T) {
	w := newMcpOAuthWorld(t)
	clientID := mcpRegister(t, w.srv, mcpTestRedirect)
	form := w.exchangeForm(t, clientID, "client_id", clientID)

	res, out := w.post(t, "/oauth/token", form, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("exchange: %d %v", res.StatusCode, out)
	}
	access := out["access_token"].(string)

	// The second use of a code means someone else holds a copy: refused, and
	// what the first use issued is closed (RFC 6749 §4.1.2).
	res, out = w.post(t, "/oauth/token", form, nil)
	wantOAuthError(t, "replayed code", res, out, http.StatusBadRequest, "invalid_grant")
	if res.Header.Get("WWW-Authenticate") != "" {
		t.Errorf("invalid_grant carries WWW-Authenticate %q", res.Header.Get("WWW-Authenticate"))
	}
	if _, err := w.d.McpAuth.Authenticate(context.Background(), access); err == nil {
		t.Error("the access token of a replayed code still authenticates")
	}

	res, out = w.post(t, "/oauth/token", mcpForm("grant_type", "authorization_code", "client_id", clientID, "code", "never-issued", "code_verifier", mcpTestVerifier, "redirect_uri", mcpTestRedirect), nil)
	wantOAuthError(t, "unknown code", res, out, http.StatusBadRequest, "invalid_grant")
}

func TestMcpTokenClientAuthentication(t *testing.T) {
	w := newMcpOAuthWorld(t)
	reg := w.register(t, `{"client_name":"Confidential","redirect_uris":["`+mcpTestRedirect+`"],"token_endpoint_auth_method":"client_secret_basic"}`)
	id, secret := reg["client_id"].(string), reg["client_secret"].(string)

	// One code serves every refusal: client authentication fails before the
	// code is looked at, so it stays unused.
	form := w.exchangeForm(t, id)
	refused := map[string]struct {
		header map[string]string
		extra  string
		status int
		code   string
		basic  bool
	}{
		"wrong secret in Basic":       {header: map[string]string{"Authorization": mcpBasic(id, "wrong")}, status: 401, code: "invalid_client", basic: true},
		"wrong secret in the body":    {extra: "&" + mcpForm("client_id", id, "client_secret", "wrong"), status: 401, code: "invalid_client"},
		"no secret":                   {extra: "&" + mcpForm("client_id", id), status: 401, code: "invalid_client"},
		"unknown client in Basic":     {header: map[string]string{"Authorization": mcpBasic("mcpc_nope", secret)}, status: 401, code: "invalid_client", basic: true},
		"malformed escape in Basic":   {header: map[string]string{"Authorization": "Basic " + base64.StdEncoding.EncodeToString([]byte("a%zz:b"))}, status: 401, code: "invalid_client", basic: true},
		"undecodable Basic":           {header: map[string]string{"Authorization": "Basic !!!"}, status: 401, code: "invalid_client", basic: true},
		"Basic and a body secret":     {header: map[string]string{"Authorization": mcpBasic(id, secret)}, extra: "&" + mcpForm("client_secret", secret), status: 400, code: "invalid_request"},
		"Basic with another body id":  {header: map[string]string{"Authorization": mcpBasic(id, secret)}, extra: "&" + mcpForm("client_id", "mcpc_other"), status: 400, code: "invalid_request"},
		"Basic secret, body mismatch": {header: map[string]string{"Authorization": mcpBasic(id, secret)}, extra: "&" + mcpForm("client_id", "mcpc_other", "client_secret", secret), status: 400, code: "invalid_request"},
	}
	for what, c := range refused {
		res, out := w.post(t, "/oauth/token", form+c.extra, c.header)
		wantOAuthError(t, what, res, out, c.status, c.code)
		challenge := res.Header.Get("WWW-Authenticate")
		switch {
		case c.basic && !strings.HasPrefix(challenge, "Basic"):
			t.Errorf("%s: WWW-Authenticate = %q, want a Basic challenge (RFC 6749 §5.2)", what, challenge)
		case !c.basic && challenge != "":
			t.Errorf("%s: WWW-Authenticate = %q, want none: the client did not use Basic", what, challenge)
		}
	}

	accepted := map[string]struct {
		header map[string]string
		extra  string
	}{
		"Basic":                         {header: map[string]string{"Authorization": mcpBasic(id, secret)}},
		"lowercase basic scheme":        {header: map[string]string{"Authorization": "basic " + strings.TrimPrefix(mcpBasic(id, secret), "Basic ")}},
		"Basic with the same client_id": {header: map[string]string{"Authorization": mcpBasic(id, secret)}, extra: "&" + mcpForm("client_id", id)},
		"client_secret_post":            {extra: "&" + mcpForm("client_id", id, "client_secret", secret)},
		"Basic scheme in odd case":      {header: map[string]string{"Authorization": "bAsIc " + strings.TrimPrefix(mcpBasic(id, secret), "Basic ")}},
	}
	for what, c := range accepted {
		res, out := w.post(t, "/oauth/token", w.exchangeForm(t, id)+c.extra, c.header)
		if res.StatusCode != http.StatusOK || out["access_token"] == nil {
			t.Errorf("%s: %d %v, want 200 with a token", what, res.StatusCode, out)
		}
	}

	// A Bearer header is not client authentication; the body still decides.
	res, out := w.post(t, "/oauth/token", w.exchangeForm(t, id, "client_id", id, "client_secret", secret), map[string]string{"Authorization": "Bearer uwm_at_whatever"})
	if res.StatusCode != http.StatusOK {
		t.Errorf("a Bearer header must not hide client_secret_post: %d %v", res.StatusCode, out)
	}
}

func TestOAuthClientDecodesBasicCredentials(t *testing.T) {
	// RFC 6749 §2.3.1: both halves are form-urlencoded before Base64.
	basic := "Basic " + base64.StdEncoding.EncodeToString([]byte(url.QueryEscape("id:1")+":"+url.QueryEscape("s+ec ret/=")))
	req := httptest.NewRequest(http.MethodPost, "/oauth/token", nil)
	req.Header.Set("Authorization", basic)
	got, err := oauthClient(req, url.Values{})
	if err != nil {
		t.Fatal(err)
	}
	if got.id != "id:1" || got.secret != "s+ec ret/=" || !got.basic {
		t.Errorf("decoded = %+v", got)
	}

	// No header: the body names the client.
	req = httptest.NewRequest(http.MethodPost, "/oauth/token", nil)
	got, err = oauthClient(req, url.Values{"client_id": {"a"}, "client_secret": {"b"}})
	if err != nil || got.id != "a" || got.secret != "b" || got.basic {
		t.Errorf("post credentials = %+v, %v", got, err)
	}
}

func TestMcpRegisterIssuesClients(t *testing.T) {
	w := newMcpOAuthWorld(t)
	before := time.Now().Unix()

	res, out := w.post(t, "/oauth/register", `{"client_name":"Confidential","redirect_uris":["`+mcpTestRedirect+`"],"logo_uri":"https://x.test/logo.png"}`, map[string]string{"Content-Type": "application/json"})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("register: %d %v", res.StatusCode, out)
	}
	wantNoStore(t, res)
	wantJSONType(t, res)
	if id, _ := out["client_id"].(string); !strings.HasPrefix(id, "mcpc_") {
		t.Errorf("client_id = %v", out["client_id"])
	}
	if at, _ := out["client_id_issued_at"].(float64); int64(at) < before-1 || int64(at) > time.Now().Unix()+1 {
		t.Errorf("client_id_issued_at = %v", out["client_id_issued_at"])
	}
	if out["client_name"] != "Confidential" || out["token_endpoint_auth_method"] != "client_secret_basic" {
		t.Errorf("registered metadata = %v", out)
	}
	if uris, _ := out["redirect_uris"].([]any); len(uris) != 1 || uris[0] != mcpTestRedirect {
		t.Errorf("redirect_uris = %v", out["redirect_uris"])
	}
	if got, _ := out["grant_types"].([]any); len(got) != 2 || got[0] != "authorization_code" || got[1] != "refresh_token" {
		t.Errorf("grant_types = %v", out["grant_types"])
	}
	if got, _ := out["response_types"].([]any); len(got) != 1 || got[0] != "code" {
		t.Errorf("response_types = %v", out["response_types"])
	}
	if secret, _ := out["client_secret"].(string); secret == "" || out["client_secret_expires_at"] != float64(0) {
		t.Errorf("a confidential client gets a secret that does not expire: %v / %v", out["client_secret"], out["client_secret_expires_at"])
	}
	if out["logo_uri"] != "https://x.test/logo.png" {
		t.Errorf("logo_uri = %v", out["logo_uri"])
	}

	res, out = w.post(t, "/oauth/register", `{"client_name":"Public","redirect_uris":["http://127.0.0.1:8123/cb"],"token_endpoint_auth_method":"none"}`, map[string]string{"Content-Type": "application/json"})
	if res.StatusCode != http.StatusCreated || out["token_endpoint_auth_method"] != "none" {
		t.Fatalf("public client: %d %v", res.StatusCode, out)
	}
	for _, key := range []string{"client_secret", "client_secret_expires_at", "logo_uri"} {
		if _, ok := out[key]; ok {
			t.Errorf("a public client's answer carries %s: %v", key, out)
		}
	}
}

func TestMcpRegisterRejectsBadMetadata(t *testing.T) {
	srv, _ := newMcpTestServer(t)
	res, err := srv.Client().Post(srv.URL+"/oauth/register", "application/json", strings.NewReader(`{"client_name":"X","redirect_uris":["http://evil.example/cb"]}`))
	if err != nil {
		t.Fatal(err)
	}
	if got := readJSON(t, res); res.StatusCode != http.StatusBadRequest || got["error"] != "invalid_redirect_uri" {
		t.Fatalf("register = %d %v", res.StatusCode, got)
	}
}

func TestMcpRegisterAnswersRFC7591Errors(t *testing.T) {
	w := newMcpOAuthWorld(t)
	for what, c := range map[string]struct{ body, code string }{
		"not json":              {`name=x`, "invalid_client_metadata"},
		"empty body":            {``, "invalid_client_metadata"},
		"an array":              {`[]`, "invalid_client_metadata"},
		"a string":              {`"x"`, "invalid_client_metadata"},
		"wrong field type":      {`{"client_name":"x","redirect_uris":"https://x.test/cb"}`, "invalid_client_metadata"},
		"trailing data":         {`{"client_name":"x","redirect_uris":["https://x.test/cb"]}}`, "invalid_client_metadata"},
		"two documents":         {`{"client_name":"x","redirect_uris":["https://x.test/cb"]}{}`, "invalid_client_metadata"},
		"oversize":              {`{"client_name":"` + strings.Repeat("a", 17<<10) + `","redirect_uris":["https://x.test/cb"]}`, "invalid_client_metadata"},
		"no name":               {`{"redirect_uris":["https://x.test/cb"]}`, "invalid_client_metadata"},
		"no redirect_uris":      {`{"client_name":"x"}`, "invalid_redirect_uri"},
		"wildcard redirect":     {`{"client_name":"x","redirect_uris":["https://*.x.test/cb"]}`, "invalid_redirect_uri"},
		"unsupported auth":      {`{"client_name":"x","redirect_uris":["https://x.test/cb"],"token_endpoint_auth_method":"private_key_jwt"}`, "invalid_client_metadata"},
		"unsupported grant":     {`{"client_name":"x","redirect_uris":["https://x.test/cb"],"grant_types":["password"]}`, "invalid_client_metadata"},
		"unsupported response":  {`{"client_name":"x","redirect_uris":["https://x.test/cb"],"response_types":["token"]}`, "invalid_client_metadata"},
		"fragment in redirect":  {`{"client_name":"x","redirect_uris":["https://x.test/cb#f"]}`, "invalid_redirect_uri"},
		"credentials redirect":  {`{"client_name":"x","redirect_uris":["https://u:p@x.test/cb"]}`, "invalid_redirect_uri"},
		"http non-loopback":     {`{"client_name":"x","redirect_uris":["http://x.test/cb"]}`, "invalid_redirect_uri"},
		"javascript redirect":   {`{"client_name":"x","redirect_uris":["javascript://x.test/%0aalert(1)"]}`, "invalid_redirect_uri"},
		"too many redirect_uri": {`{"client_name":"x","redirect_uris":["https://x.test/1","https://x.test/2","https://x.test/3","https://x.test/4","https://x.test/5","https://x.test/6","https://x.test/7","https://x.test/8","https://x.test/9","https://x.test/10","https://x.test/11"]}`, "invalid_redirect_uri"},
	} {
		res, out := w.post(t, "/oauth/register", c.body, map[string]string{"Content-Type": "application/json"})
		wantOAuthError(t, what, res, out, http.StatusBadRequest, c.code)
	}
}

func TestMcpRevokeFollowsRFC7009(t *testing.T) {
	w := newMcpOAuthWorld(t)
	ctx := context.Background()
	owner := mcpRegister(t, w.srv, mcpTestRedirect)
	stranger := mcpRegister(t, w.srv, mcpTestRedirect)
	access, refresh := w.pair(t, owner)

	revoke := func(what, clientID, token string) {
		t.Helper()
		res, out := w.post(t, "/oauth/revoke", mcpForm("client_id", clientID, "token", token), nil)
		if res.StatusCode != http.StatusOK || len(out) != 0 {
			t.Errorf("%s: %d %v, want an empty 200", what, res.StatusCode, out)
		}
		wantNoStore(t, res)
	}

	// Nothing to revoke, or not this client's to revoke: still 200, nothing happens.
	revoke("unknown token", owner, "uwm_rt_does-not-exist")
	revoke("empty token", owner, "")
	res, out := w.post(t, "/oauth/revoke", mcpForm("client_id", owner), nil)
	if res.StatusCode != http.StatusOK || len(out) != 0 {
		t.Errorf("missing token: %d %v", res.StatusCode, out)
	}
	revoke("a stranger's access token", stranger, access)
	revoke("a stranger's refresh token", stranger, refresh)
	if _, err := w.d.McpAuth.Authenticate(ctx, access); err != nil {
		t.Fatalf("a stranger's revoke ended the access token: %v", err)
	}
	res, out = w.post(t, "/oauth/token", mcpForm("grant_type", "refresh_token", "client_id", owner, "refresh_token", refresh), nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("a stranger's revoke ended the refresh token: %d %v", res.StatusCode, out)
	}
	access, refresh = out["access_token"].(string), out["refresh_token"].(string)

	// The owner revokes its access token: that one stops, the refresh token lives.
	revoke("own access token", owner, access)
	if _, err := w.d.McpAuth.Authenticate(ctx, access); err == nil {
		t.Error("a revoked access token still authenticates")
	}
	revoke("own access token again", owner, access)
	res, out = w.post(t, "/oauth/token", mcpForm("grant_type", "refresh_token", "client_id", owner, "refresh_token", refresh), nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("revoking an access token closed the refresh token: %d %v", res.StatusCode, out)
	}
	newAccess, refresh := out["access_token"].(string), out["refresh_token"].(string)

	// Revoking a refresh token closes its family, access tokens included.
	revoke("own refresh token", owner, refresh)
	revoke("own refresh token again", owner, refresh)
	if _, err := w.d.McpAuth.Authenticate(ctx, newAccess); err == nil {
		t.Error("the family's access token survived a refresh token revoke")
	}
	res, out = w.post(t, "/oauth/token", mcpForm("grant_type", "refresh_token", "client_id", owner, "refresh_token", refresh), nil)
	wantOAuthError(t, "refresh after revoke", res, out, http.StatusBadRequest, "invalid_grant")
}

func TestMcpRevokeAuthenticatesTheClient(t *testing.T) {
	w := newMcpOAuthWorld(t)
	ctx := context.Background()
	reg := w.register(t, `{"client_name":"Confidential","redirect_uris":["`+mcpTestRedirect+`"]}`)
	id, secret := reg["client_id"].(string), reg["client_secret"].(string)
	res, out := w.post(t, "/oauth/token", w.exchangeForm(t, id)+"&"+mcpForm("client_id", id, "client_secret", secret), nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("exchange: %d %v", res.StatusCode, out)
	}
	access := out["access_token"].(string)

	for what, c := range map[string]struct {
		body   string
		header map[string]string
		basic  bool
	}{
		"wrong secret, Basic": {body: mcpForm("token", access), header: map[string]string{"Authorization": mcpBasic(id, "wrong")}, basic: true},
		"wrong secret, post":  {body: mcpForm("token", access, "client_id", id, "client_secret", "wrong")},
		"no secret":           {body: mcpForm("token", access, "client_id", id)},
		"unknown client":      {body: mcpForm("token", access, "client_id", "mcpc_nope")},
		"empty token, wrong":  {body: mcpForm("token", "", "client_id", id, "client_secret", "wrong")},
		"no client at all":    {body: mcpForm("token", access)},
	} {
		res, out := w.post(t, "/oauth/revoke", c.body, c.header)
		wantOAuthError(t, what, res, out, http.StatusUnauthorized, "invalid_client")
		challenge := res.Header.Get("WWW-Authenticate")
		if c.basic != strings.HasPrefix(challenge, "Basic") {
			t.Errorf("%s: WWW-Authenticate = %q, want a Basic challenge only for a Basic client", what, challenge)
		}
		if _, err := w.d.McpAuth.Authenticate(ctx, access); err != nil {
			t.Fatalf("%s: a refused revoke still ended the token: %v", what, err)
		}
	}

	res, out = w.post(t, "/oauth/revoke", mcpForm("token", access), map[string]string{"Authorization": mcpBasic(id, secret)})
	if res.StatusCode != http.StatusOK || len(out) != 0 {
		t.Fatalf("authenticated revoke: %d %v", res.StatusCode, out)
	}
	if _, err := w.d.McpAuth.Authenticate(ctx, access); err == nil {
		t.Error("an authenticated revoke left the token alive")
	}

	// Both ways of authenticating at once is a malformed request.
	res, out = w.post(t, "/oauth/revoke", mcpForm("token", access, "client_secret", secret), map[string]string{"Authorization": mcpBasic(id, secret)})
	wantOAuthError(t, "Basic and body secret", res, out, http.StatusBadRequest, "invalid_request")
}

func TestMcpOAuthRoutesNeedTheService(t *testing.T) {
	d, _ := newTestDeps(t, nil, discardOutbox{})
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)
	for _, c := range []struct{ method, path string }{
		{http.MethodGet, "/.well-known/oauth-protected-resource"},
		{http.MethodGet, "/.well-known/oauth-protected-resource/mcp"},
		{http.MethodGet, "/.well-known/oauth-authorization-server"},
		{http.MethodGet, "/oauth/authorize"},
		{http.MethodPost, "/oauth/token"},
		{http.MethodPost, "/oauth/revoke"},
		{http.MethodPost, "/oauth/register"},
	} {
		req, _ := http.NewRequest(c.method, srv.URL+c.path, strings.NewReader(""))
		res, err := srv.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != http.StatusNotFound {
			t.Errorf("%s %s without the service = %d, want 404", c.method, c.path, res.StatusCode)
		}
	}
}

func TestMcpOAuthRoutesAnswerOnlyTheirMethods(t *testing.T) {
	srv, _ := newMcpTestServer(t)
	for _, c := range []struct{ method, path string }{
		{http.MethodPost, "/oauth/authorize"},
		{http.MethodGet, "/oauth/token"},
		{http.MethodGet, "/oauth/revoke"},
		{http.MethodGet, "/oauth/register"},
		{http.MethodPost, "/.well-known/oauth-authorization-server"},
		{http.MethodPost, "/.well-known/oauth-protected-resource"},
	} {
		req, _ := http.NewRequest(c.method, srv.URL+c.path, strings.NewReader(""))
		res, err := srv.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != http.StatusMethodNotAllowed {
			t.Errorf("%s %s = %d, want 405", c.method, c.path, res.StatusCode)
		}
	}
}
