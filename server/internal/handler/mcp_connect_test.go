package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/service"
)

// The web side of the MCP connector (Task 9): consent, a person's connected
// apps, an organization's grants and its switch. The OAuth side is in
// mcp_oauth_test.go; the tenant boundary is the isolation matrix.

// mcpTenant is one organization and its owner on a running server.
type mcpTenant struct {
	token, userID, email, orgID, slug string
}

type mcpConnectWorld struct {
	srv   *httptest.Server
	d     Deps
	owner mcpTenant
}

func newMcpConnectWorld(t *testing.T, tag string, tune func(*Deps)) *mcpConnectWorld {
	t.Helper()
	srv, d := newMcpTestServerWith(t, tune)
	w := &mcpConnectWorld{srv: srv, d: d}
	w.owner = w.addTenant(t, tag)
	return w
}

// addTenant registers a new owner with an organization on the same server.
func (w *mcpConnectWorld) addTenant(t *testing.T, tag string) mcpTenant {
	t.Helper()
	tn := mcpTenant{email: "mcp-" + tag + "@example.com", slug: "mcp-" + tag}
	tn.token, _ = registerOrgWorkspace(t, w.srv, tn.email, "Connect "+tag, tn.slug)
	userID, err := w.d.Minter.Parse(tn.token)
	if err != nil {
		t.Fatal(err)
	}
	tn.userID = userID
	if err := testPool.QueryRow(context.Background(), `SELECT id FROM organizations WHERE slug = $1`, tn.slug).Scan(&tn.orgID); err != nil {
		t.Fatal(err)
	}
	return tn
}

// addMember signs a new person up and makes them a member of tn's
// organization with the role, the way an accepted invitation would.
func (w *mcpConnectWorld) addMember(t *testing.T, tn mcpTenant, tag, role string) mcpTenant {
	t.Helper()
	m := mcpTenant{email: "mcp-" + tag + "@example.com", orgID: tn.orgID, slug: tn.slug}
	m.token, m.userID = signUp(t, w.srv, m.email, "Member "+tag)
	if _, err := testPool.Exec(context.Background(), `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, $3)`, tn.orgID, m.userID, role); err != nil {
		t.Fatal(err)
	}
	return m
}

func (w *mcpConnectWorld) setPolicy(t *testing.T, tn mcpTenant, enabled bool) {
	t.Helper()
	if _, err := w.d.McpAuth.SetPolicy(context.Background(), tn.userID, tn.orgID, enabled); err != nil {
		t.Fatal(err)
	}
}

// attempt opens an authorization attempt the way /oauth/authorize does.
func (w *mcpConnectWorld) attempt(t *testing.T, clientID string) string {
	t.Helper()
	to, err := w.d.McpAuth.Start(context.Background(), service.McpAuthorizeInput{
		ResponseType: "code", ClientID: clientID, RedirectURI: mcpTestRedirect,
		CodeChallenge: mcpTestChallenge, CodeChallengeMethod: "S256", State: "st",
	})
	if err != nil {
		t.Fatal(err)
	}
	u, _ := url.Parse(to)
	return u.Query().Get("attempt")
}

// read is GET /auth/connect/attempts/{id} as token.
func (w *mcpConnectWorld) read(t *testing.T, token, attempt string) (*http.Response, map[string]any) {
	t.Helper()
	return doJSON(t, w.srv, "GET", "/api/v1/auth/connect/attempts/"+attempt, token, nil)
}

// decide is POST /auth/connect/attempts/{id} as token.
func (w *mcpConnectWorld) decide(t *testing.T, token, attempt string, body map[string]any) (*http.Response, map[string]any) {
	t.Helper()
	return doJSON(t, w.srv, "POST", "/api/v1/auth/connect/attempts/"+attempt, token, body)
}

// pending opens an attempt for a fresh client, reads it as tn's owner and
// returns the attempt with its CSRF token.
func (w *mcpConnectWorld) pending(t *testing.T, tn mcpTenant) (attempt, csrf string) {
	t.Helper()
	attempt = w.attempt(t, mcpRegister(t, w.srv, mcpTestRedirect))
	res, consent := w.read(t, tn.token, attempt)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("read consent: %d %v", res.StatusCode, consent)
	}
	return attempt, consent["csrf_token"].(string)
}

// connect walks a new client through the service flow for u (a member of
// orgID, whose connector is on) and returns its access token and grant id.
func (w *mcpConnectWorld) connect(t *testing.T, u mcpTenant) (access, grantID string) {
	t.Helper()
	ctx := context.Background()
	svc := w.d.McpAuth
	reg, err := svc.Register(ctx, service.McpRegistration{ClientName: "Connect " + u.slug, RedirectURIs: []string{mcpTestRedirect}, TokenEndpointAuthMethod: "none"})
	if err != nil {
		t.Fatal(err)
	}
	id := w.attempt(t, reg.Client.ClientID)
	consent, err := svc.Consent(ctx, u.userID, id)
	if err != nil {
		t.Fatal(err)
	}
	back, err := svc.Approve(ctx, u.userID, id, consent.CSRFToken, u.orgID, false)
	if err != nil {
		t.Fatal(err)
	}
	bu, _ := url.Parse(back)
	pair, err := svc.Exchange(ctx, service.McpExchangeInput{ClientID: reg.Client.ClientID, Code: bu.Query().Get("code"), CodeVerifier: mcpTestVerifier, RedirectURI: mcpTestRedirect})
	if err != nil {
		t.Fatal(err)
	}
	grants, err := svc.ListMyGrants(ctx, u.userID)
	if err != nil {
		t.Fatal(err)
	}
	for _, g := range grants {
		if g.ClientID == reg.Client.ClientID {
			return pair.AccessToken, g.ID
		}
	}
	t.Fatalf("no grant for %s in %v", reg.Client.ClientID, grants)
	return "", ""
}

func (w *mcpConnectWorld) toolsList(t *testing.T, access string) int {
	t.Helper()
	res, _ := mcpRPC(t, w.srv, "Bearer "+access, "", `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)
	return res.StatusCode
}

func sortedKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func wantKeys(t *testing.T, what string, m map[string]any, want ...string) {
	t.Helper()
	sort.Strings(want)
	if got := sortedKeys(m); !reflect.DeepEqual(got, want) {
		t.Errorf("%s keys = %v, want %v", what, got, want)
	}
}

func wantError(t *testing.T, what string, res *http.Response, out map[string]any, status int, code string) {
	t.Helper()
	if res.StatusCode != status || errorCodeOf(out) != code {
		t.Errorf("%s = %d %v, want %d %s", what, res.StatusCode, out, status, code)
	}
}

func TestMcpConnectFlowOverHTTP(t *testing.T) {
	w := newMcpConnectWorld(t, "flow", nil)
	session := w.owner.token

	_, pol := doJSON(t, w.srv, "PUT", "/api/v1/orgs/"+w.owner.slug+"/mcp-policy", session, map[string]any{"enabled": true})
	if pol["enabled"] != true || pol["mcp_url"] != mcpTestIssuer+"/mcp" {
		t.Fatalf("policy = %v", pol)
	}

	clientID := mcpRegister(t, w.srv, mcpTestRedirect)
	q := url.Values{"response_type": {"code"}, "client_id": {clientID}, "redirect_uri": {mcpTestRedirect}, "code_challenge": {mcpTestChallenge}, "code_challenge_method": {"S256"}, "state": {"s"}}
	res, err := noFollow(w.srv).Get(w.srv.URL + "/oauth/authorize?" + q.Encode())
	if err != nil {
		t.Fatal(err)
	}
	consentURL, _ := url.Parse(res.Header.Get("Location"))
	attempt := consentURL.Query().Get("attempt")

	_, consent := w.read(t, session, attempt)
	orgs, _ := consent["organizations"].([]any)
	if len(orgs) != 1 {
		t.Fatalf("consent = %v", consent)
	}
	org := orgs[0].(map[string]any)
	if consent["status"] != "pending" || consent["redirect_host"] != "x.test" || org["enabled"] != true {
		t.Fatalf("consent = %v", consent)
	}

	_, result := w.decide(t, session, attempt, map[string]any{
		"decision": "approve", "csrf_token": consent["csrf_token"], "organization_id": org["id"],
	})
	back, _ := url.Parse(result["redirect_to"].(string))
	code := back.Query().Get("code")
	if result["status"] != "approved" || code == "" || back.Query().Get("state") != "s" || back.Query().Get("iss") != mcpTestIssuer {
		t.Fatalf("approve = %v", result)
	}

	form := mcpForm("grant_type", "authorization_code", "client_id", clientID, "code", code, "code_verifier", mcpTestVerifier, "redirect_uri", mcpTestRedirect, "resource", mcpTestIssuer+"/mcp")
	tokRes, err := w.srv.Client().Post(w.srv.URL+"/oauth/token", "application/x-www-form-urlencoded", strings.NewReader(form))
	if err != nil {
		t.Fatal(err)
	}
	tok := readJSON(t, tokRes)
	access, _ := tok["access_token"].(string)
	if tokRes.StatusCode != http.StatusOK || !strings.HasPrefix(access, "uwm_at_") {
		t.Fatalf("token = %d %v", tokRes.StatusCode, tok)
	}
	if status := w.toolsList(t, access); status != http.StatusOK {
		t.Fatalf("tools/list with a fresh token: %d", status)
	}

	_, mine := doJSON(t, w.srv, "GET", "/api/v1/me/connected-apps", session, nil)
	grants, _ := mine["grants"].([]any)
	if len(grants) != 1 || mine["mcp_url"] != mcpTestIssuer+"/mcp" {
		t.Fatalf("connected apps = %v", mine)
	}
	grantID := grants[0].(map[string]any)["id"].(string)
	if res, out := doJSON(t, w.srv, "DELETE", "/api/v1/me/connected-apps/"+grantID, session, nil); res.StatusCode != http.StatusOK || out["status"] != "ok" {
		t.Fatalf("revoke: %d %v", res.StatusCode, out)
	}
	if status := w.toolsList(t, access); status != http.StatusUnauthorized {
		t.Fatalf("revoked token on /mcp: %d, want 401", status)
	}
}

func TestMcpConsentShapeAndCSRFRotation(t *testing.T) {
	w := newMcpConnectWorld(t, "shape", nil)
	w.setPolicy(t, w.owner, true)
	attempt := w.attempt(t, mcpRegister(t, w.srv, mcpTestRedirect))

	res, consent := w.read(t, w.owner.token, attempt)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("read: %d %v", res.StatusCode, consent)
	}
	wantNoStore(t, res)
	wantKeys(t, "consent", consent, "attempt_id", "status", "client", "redirect_host", "scope", "organizations", "csrf_token", "write_requested")
	client, _ := consent["client"].(map[string]any)
	wantKeys(t, "consent client", client, "client_id", "name", "logo_uri", "verified")
	if consent["attempt_id"] != attempt || consent["status"] != "pending" || consent["scope"] != "read" || client["name"] != "Test" || client["verified"] != false {
		t.Fatalf("consent = %v", consent)
	}
	orgs, _ := consent["organizations"].([]any)
	if len(orgs) != 1 {
		t.Fatalf("organizations = %v", orgs)
	}
	org := orgs[0].(map[string]any)
	wantKeys(t, "consent organization", org, "id", "slug", "name", "enabled", "write_enabled", "reason")
	if org["id"] != w.owner.orgID || org["slug"] != w.owner.slug || org["enabled"] != true || org["reason"] != "" {
		t.Fatalf("organization = %v", org)
	}
	raw, _ := json.Marshal(consent)
	if strings.Contains(string(raw), w.owner.email) {
		t.Errorf("the consent page carries an email address: %s", raw)
	}

	// Every read rotates the token: only the page the person is looking at
	// can approve.
	first := consent["csrf_token"].(string)
	_, again := w.read(t, w.owner.token, attempt)
	second := again["csrf_token"].(string)
	if first == "" || second == "" || first == second {
		t.Fatalf("csrf tokens %q then %q; each read must issue a new one", first, second)
	}
	if res, out := w.decide(t, w.owner.token, attempt, map[string]any{"decision": "approve", "csrf_token": first, "organization_id": w.owner.orgID}); res.StatusCode != http.StatusBadRequest || errorCodeOf(out) != "csrf_invalid" {
		t.Fatalf("approve with the superseded token: %d %v", res.StatusCode, out)
	}

	// An organization whose connector is off is listed, and says why.
	w.setPolicy(t, w.owner, false)
	_, off := w.read(t, w.owner.token, attempt)
	offOrg := off["organizations"].([]any)[0].(map[string]any)
	if offOrg["enabled"] != false || offOrg["reason"] != "connector_disabled" {
		t.Fatalf("a switched-off organization = %v", offOrg)
	}
}

// The consent screen tells the person that the app asked for write and whether
// the organization allows it; their tick decides the grant's scope.
func TestMcpConsentWriteChoiceOverHTTP(t *testing.T) {
	w := newMcpConnectWorld(t, "write", nil)
	w.setPolicy(t, w.owner, true)
	if _, err := w.d.McpAuth.SetWritePolicy(context.Background(), w.owner.userID, w.owner.orgID, true); err != nil {
		t.Fatal(err)
	}
	clientID := mcpRegister(t, w.srv, mcpTestRedirect)
	to, err := w.d.McpAuth.Start(context.Background(), service.McpAuthorizeInput{
		ResponseType: "code", ClientID: clientID, RedirectURI: mcpTestRedirect,
		CodeChallenge: mcpTestChallenge, CodeChallengeMethod: "S256", State: "st", Scope: "read write",
	})
	if err != nil {
		t.Fatal(err)
	}
	u, _ := url.Parse(to)
	attempt := u.Query().Get("attempt")

	res, consent := w.read(t, w.owner.token, attempt)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("read consent: %d %v", res.StatusCode, consent)
	}
	org := consent["organizations"].([]any)[0].(map[string]any)
	if consent["write_requested"] != true || consent["scope"] != "read write" || org["write_enabled"] != true {
		t.Fatalf("consent = %v", consent)
	}

	res, out := w.decide(t, w.owner.token, attempt, map[string]any{
		"decision": "approve", "csrf_token": consent["csrf_token"], "organization_id": org["id"], "write": true,
	})
	if res.StatusCode != http.StatusOK || out["status"] != "approved" {
		t.Fatalf("approve: %d %v", res.StatusCode, out)
	}
	_, mine := doJSON(t, w.srv, "GET", "/api/v1/me/connected-apps", w.owner.token, nil)
	grants, _ := mine["grants"].([]any)
	if len(grants) != 1 || grants[0].(map[string]any)["scope"] != "read write" {
		t.Fatalf("connected apps = %v, want one grant with scope read write", mine)
	}
}

func TestMcpConsentAfterTheAttemptEnds(t *testing.T) {
	w := newMcpConnectWorld(t, "ended", nil)
	w.setPolicy(t, w.owner, true)

	assertEnded := func(t *testing.T, what, attempt, status string) {
		t.Helper()
		res, out := w.read(t, w.owner.token, attempt)
		if res.StatusCode != http.StatusOK {
			t.Fatalf("%s: %d %v", what, res.StatusCode, out)
		}
		wantKeys(t, what, out, "attempt_id", "status", "client", "redirect_host", "scope", "organizations", "csrf_token", "write_requested")
		if out["status"] != status || out["client"] != nil || out["csrf_token"] != "" || out["attempt_id"] != attempt {
			t.Errorf("%s = %v, want status %s, no client and no token", what, out, status)
		}
		if orgs, ok := out["organizations"].([]any); !ok || len(orgs) != 0 {
			t.Errorf("%s organizations = %#v, want an empty list", what, out["organizations"])
		}
	}

	attempt, csrf := w.pending(t, w.owner)
	if res, out := w.decide(t, w.owner.token, attempt, map[string]any{"decision": "approve", "csrf_token": csrf, "organization_id": w.owner.orgID}); res.StatusCode != http.StatusOK {
		t.Fatalf("approve: %d %v", res.StatusCode, out)
	}
	assertEnded(t, "approved", attempt, "approved")

	attempt, csrf = w.pending(t, w.owner)
	if res, out := w.decide(t, w.owner.token, attempt, map[string]any{"decision": "cancel", "csrf_token": csrf}); res.StatusCode != http.StatusOK {
		t.Fatalf("cancel: %d %v", res.StatusCode, out)
	}
	assertEnded(t, "cancelled", attempt, "cancelled")

	attempt, _ = w.pending(t, w.owner)
	if _, err := testPool.Exec(context.Background(), `UPDATE mcp_auth_attempts SET expires_at = now() - interval '1 minute' WHERE id = $1`, attempt); err != nil {
		t.Fatal(err)
	}
	assertEnded(t, "expired", attempt, "expired")
}

// Reading an attempt claims it, so another account gets nothing from it: the
// same 404 as an id that never existed, and the claimant is unharmed.
func TestMcpConsentIsInvisibleToOthers(t *testing.T) {
	w := newMcpConnectWorld(t, "owner-a", nil)
	other := w.addTenant(t, "owner-b")
	w.setPolicy(t, w.owner, true)
	w.setPolicy(t, other, true)
	attempt, csrf := w.pending(t, w.owner)

	foreignRes, foreign := w.read(t, other.token, attempt)
	unknownRes, unknown := w.read(t, other.token, "01J8X4NOSUCHATTEMPT00000000")
	wantError(t, "another account reading the attempt", foreignRes, foreign, http.StatusNotFound, "not_found")
	wantError(t, "an unknown attempt", unknownRes, unknown, http.StatusNotFound, "not_found")
	if !reflect.DeepEqual(foreign, unknown) {
		t.Errorf("a claimed attempt answers %v, an unknown one %v; the bodies must match", foreign, unknown)
	}
	if res, out := doJSON(t, w.srv, "GET", "/api/v1/auth/connect/attempts/"+attempt, "", nil); res.StatusCode != http.StatusUnauthorized {
		t.Errorf("no session: %d %v, want 401", res.StatusCode, out)
	}

	// The refused read neither claimed the attempt nor rotated its token.
	if res, out := w.decide(t, w.owner.token, attempt, map[string]any{"decision": "approve", "csrf_token": csrf, "organization_id": w.owner.orgID}); res.StatusCode != http.StatusOK {
		t.Fatalf("the claimant's approve after a stranger's read: %d %v", res.StatusCode, out)
	}
}

func TestMcpConsentCommandValidation(t *testing.T) {
	w := newMcpConnectWorld(t, "validation", nil)
	w.setPolicy(t, w.owner, true)
	attempt, csrf := w.pending(t, w.owner)

	for name, body := range map[string]map[string]any{
		"unknown decision":       {"decision": "maybe", "csrf_token": csrf, "organization_id": w.owner.orgID},
		"no decision":            {"csrf_token": csrf, "organization_id": w.owner.orgID},
		"another verb":           {"decision": "approve-all", "csrf_token": csrf, "organization_id": w.owner.orgID},
		"approve with no org":    {"decision": "approve", "csrf_token": csrf},
		"approve with an empty":  {"decision": "approve", "csrf_token": csrf, "organization_id": ""},
		"approve with a blank":   {"decision": "approve", "csrf_token": csrf, "organization_id": "  "},
		"a number for decision":  {"decision": 1, "csrf_token": csrf, "organization_id": w.owner.orgID},
		"an object for decision": {"decision": map[string]any{"approve": true}, "csrf_token": csrf},
	} {
		res, out := w.decide(t, w.owner.token, attempt, body)
		wantError(t, name, res, out, http.StatusBadRequest, "invalid_request")
	}
	req, _ := http.NewRequest("POST", w.srv.URL+"/api/v1/auth/connect/attempts/"+attempt, strings.NewReader("{not json"))
	req.Header.Set("Authorization", "Bearer "+w.owner.token)
	req.Header.Set("Content-Type", "application/json")
	res, err := w.srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if out := readJSON(t, res); res.StatusCode != http.StatusBadRequest || errorCodeOf(out) != "invalid_request" {
		t.Errorf("malformed body: %d %v", res.StatusCode, out)
	}

	// None of the refusals above used the token up.
	res2, out := w.decide(t, w.owner.token, attempt, map[string]any{"decision": "approve", "csrf_token": csrf, "organization_id": w.owner.orgID})
	if res2.StatusCode != http.StatusOK || out["status"] != "approved" {
		t.Fatalf("approve after the refusals: %d %v", res2.StatusCode, out)
	}
}

func TestMcpCancelOverHTTPIgnoresTheOrganization(t *testing.T) {
	w := newMcpConnectWorld(t, "cancel", nil)
	w.setPolicy(t, w.owner, true)
	attempt, csrf := w.pending(t, w.owner)

	if res, out := w.decide(t, w.owner.token, attempt, map[string]any{"decision": "cancel", "csrf_token": "wrong"}); res.StatusCode != http.StatusBadRequest || errorCodeOf(out) != "csrf_invalid" {
		t.Fatalf("cancel with a wrong token: %d %v", res.StatusCode, out)
	}
	res, out := w.decide(t, w.owner.token, attempt, map[string]any{"decision": "cancel", "csrf_token": csrf, "organization_id": "not-an-organization"})
	if res.StatusCode != http.StatusOK || out["status"] != "cancelled" {
		t.Fatalf("cancel: %d %v", res.StatusCode, out)
	}
	wantKeys(t, "cancel result", out, "status", "redirect_to")
	back, _ := url.Parse(out["redirect_to"].(string))
	if back.Query().Get("error") != "access_denied" || back.Query().Get("state") != "st" || back.Query().Get("code") != "" {
		t.Errorf("redirect_to = %s", out["redirect_to"])
	}
	wantNoStore(t, res)
	if res, out := w.decide(t, w.owner.token, attempt, map[string]any{"decision": "cancel", "csrf_token": csrf}); res.StatusCode != http.StatusGone || errorCodeOf(out) != "attempt_expired" {
		t.Errorf("cancelling twice: %d %v, want 410 attempt_expired", res.StatusCode, out)
	}
	if n := mcpCount(t, `SELECT count(*) FROM mcp_grants WHERE organization_id = $1`, w.owner.orgID); n != 0 {
		t.Errorf("grants after a cancel = %d", n)
	}
}

func mcpCount(t *testing.T, query string, args ...any) int {
	t.Helper()
	var n int
	if err := testPool.QueryRow(context.Background(), query, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestMcpApproveRefusals(t *testing.T) {
	w := newMcpConnectWorld(t, "refuse-a", nil)
	other := w.addTenant(t, "refuse-b")
	w.setPolicy(t, w.owner, true)
	w.setPolicy(t, other, true)

	t.Run("an organization the person is not in", func(t *testing.T) {
		attempt, csrf := w.pending(t, w.owner)
		res, out := w.decide(t, w.owner.token, attempt, map[string]any{"decision": "approve", "csrf_token": csrf, "organization_id": other.orgID})
		wantError(t, "approving into another organization", res, out, http.StatusForbidden, "forbidden")
		res, out = w.decide(t, w.owner.token, attempt, map[string]any{"decision": "approve", "csrf_token": csrf, "organization_id": "01J8X4NOSUCHORG000000000000"})
		wantError(t, "approving into an unknown organization", res, out, http.StatusForbidden, "forbidden")
		if n := mcpCount(t, `SELECT count(*) FROM mcp_grants WHERE organization_id = $1`, other.orgID); n != 0 {
			t.Errorf("grants in the other organization = %d", n)
		}
	})

	t.Run("an organization whose switch is off", func(t *testing.T) {
		w.setPolicy(t, w.owner, false)
		defer w.setPolicy(t, w.owner, true)
		attempt, csrf := w.pending(t, w.owner)
		res, out := w.decide(t, w.owner.token, attempt, map[string]any{"decision": "approve", "csrf_token": csrf, "organization_id": w.owner.orgID})
		wantError(t, "approving into a switched-off organization", res, out, http.StatusForbidden, "connector_disabled")
	})

	t.Run("another person's attempt answers like one that does not exist", func(t *testing.T) {
		attempt, csrf := w.pending(t, w.owner)
		foreignRes, foreign := w.decide(t, other.token, attempt, map[string]any{"decision": "approve", "csrf_token": csrf, "organization_id": other.orgID})
		unknownRes, unknown := w.decide(t, other.token, "01J8X4NOSUCHATTEMPT00000000", map[string]any{"decision": "approve", "csrf_token": csrf, "organization_id": other.orgID})
		wantError(t, "another person approving", foreignRes, foreign, http.StatusBadRequest, "csrf_invalid")
		wantError(t, "an unknown attempt", unknownRes, unknown, http.StatusBadRequest, "csrf_invalid")
		if !reflect.DeepEqual(foreign, unknown) {
			t.Errorf("another person's attempt answers %v, an unknown one %v; the bodies must match", foreign, unknown)
		}
		cRes, c := w.decide(t, other.token, attempt, map[string]any{"decision": "cancel", "csrf_token": csrf})
		wantError(t, "another person cancelling", cRes, c, http.StatusBadRequest, "csrf_invalid")
		// The claimant's attempt is untouched.
		if res, out := w.decide(t, w.owner.token, attempt, map[string]any{"decision": "approve", "csrf_token": csrf, "organization_id": w.owner.orgID}); res.StatusCode != http.StatusOK {
			t.Errorf("the claimant approving after the attempts on it: %d %v", res.StatusCode, out)
		}
	})

	t.Run("an attempt that lapsed or was decided", func(t *testing.T) {
		attempt, csrf := w.pending(t, w.owner)
		if _, err := testPool.Exec(context.Background(), `UPDATE mcp_auth_attempts SET expires_at = now() - interval '1 minute' WHERE id = $1`, attempt); err != nil {
			t.Fatal(err)
		}
		res, out := w.decide(t, w.owner.token, attempt, map[string]any{"decision": "approve", "csrf_token": csrf, "organization_id": w.owner.orgID})
		wantError(t, "approving an expired attempt", res, out, http.StatusGone, "attempt_expired")

		attempt, csrf = w.pending(t, w.owner)
		body := map[string]any{"decision": "approve", "csrf_token": csrf, "organization_id": w.owner.orgID}
		if res, out := w.decide(t, w.owner.token, attempt, body); res.StatusCode != http.StatusOK {
			t.Fatalf("first approve: %d %v", res.StatusCode, out)
		}
		res, out = w.decide(t, w.owner.token, attempt, body)
		wantError(t, "approving twice", res, out, http.StatusGone, "attempt_expired")
	})

	t.Run("a door that closed", func(t *testing.T) {
		member := w.addMember(t, other, "refuse-member", "member")
		attempt, csrf := w.pending(t, member)
		body := map[string]any{"decision": "approve", "csrf_token": csrf, "organization_id": other.orgID}

		if _, err := testPool.Exec(context.Background(), `UPDATE organization_members SET deactivated_at = now() WHERE organization_id = $1 AND user_id = $2`, other.orgID, member.userID); err != nil {
			t.Fatal(err)
		}
		res, out := w.decide(t, member.token, attempt, body)
		wantError(t, "a deactivated member", res, out, http.StatusForbidden, "member_deactivated")

		if _, err := testPool.Exec(context.Background(), `UPDATE organizations SET status = 'suspended' WHERE id = $1`, other.orgID); err != nil {
			t.Fatal(err)
		}
		res, out = w.decide(t, other.token, attempt, body)
		wantError(t, "a suspended organization", res, out, http.StatusForbidden, "organization_suspended")
	})
}

// Ruling 32: the page can tell the person the client is gone (410), instead of
// a 500 that reads as UniWork being broken.
func TestMcpConsentOfAWithdrawnClientIsGoneOverHTTP(t *testing.T) {
	w := newMcpConnectWorld(t, "withdrawn", nil)
	w.setPolicy(t, w.owner, true)
	clientID := mcpRegister(t, w.srv, mcpTestRedirect)
	attempt := w.attempt(t, clientID)
	if _, err := testPool.Exec(context.Background(), `DELETE FROM mcp_clients WHERE client_id = $1`, clientID); err != nil {
		t.Fatal(err)
	}
	res, out := w.read(t, w.owner.token, attempt)
	wantError(t, "consent of a swept client", res, out, http.StatusGone, "client_unavailable")
	envelope, _ := out["error"].(map[string]any)
	if msg, _ := envelope["message"].(string); msg == "" {
		t.Errorf("no message in %v", out)
	}
	wantNoStore(t, res)
}

func TestMcpMyConnectedApps(t *testing.T) {
	w := newMcpConnectWorld(t, "mine-a", nil)
	other := w.addTenant(t, "mine-b")
	w.setPolicy(t, w.owner, true)
	w.setPolicy(t, other, true)

	res, empty := doJSON(t, w.srv, "GET", "/api/v1/me/connected-apps", w.owner.token, nil)
	if grants, ok := empty["grants"].([]any); res.StatusCode != http.StatusOK || !ok || len(grants) != 0 {
		t.Fatalf("no grants yet: %d %v; want an empty list, not null", res.StatusCode, empty)
	}

	access, grantID := w.connect(t, w.owner)
	_, otherGrant := w.connect(t, other)

	res, mine := doJSON(t, w.srv, "GET", "/api/v1/me/connected-apps", w.owner.token, nil)
	wantKeys(t, "connected apps", mine, "grants", "mcp_url")
	grants, _ := mine["grants"].([]any)
	if res.StatusCode != http.StatusOK || len(grants) != 1 || mine["mcp_url"] != mcpTestIssuer+"/mcp" {
		t.Fatalf("connected apps = %d %v", res.StatusCode, mine)
	}
	g := grants[0].(map[string]any)
	wantKeys(t, "grant", g, "id", "organization_id", "organization_name", "user_id", "user_name", "client_id", "client_name", "verified", "scope", "created_at", "last_used_at")
	if g["id"] != grantID || g["organization_id"] != w.owner.orgID || g["user_id"] != w.owner.userID || g["scope"] != "read" || g["verified"] != false || g["client_name"] != "Connect "+w.owner.slug {
		t.Fatalf("grant = %v", g)
	}
	if name, _ := g["organization_name"].(string); name == "" {
		t.Errorf("no organization_name in %v", g)
	}
	if created, _ := g["created_at"].(string); created == "" {
		t.Errorf("no created_at in %v", g)
	} else if _, err := time.Parse(time.RFC3339, created); err != nil {
		t.Errorf("created_at %q is not RFC 3339: %v", created, err)
	}
	if g["last_used_at"] != nil {
		t.Errorf("last_used_at = %v before the grant was used", g["last_used_at"])
	}
	raw, _ := json.Marshal(mine)
	if strings.Contains(string(raw), w.owner.email) || strings.Contains(string(raw), other.orgID) {
		t.Errorf("the list carries an email or another organization's id: %s", raw)
	}

	// Using the connection stamps last_used_at.
	if status := w.toolsList(t, access); status != http.StatusOK {
		t.Fatalf("tools/list: %d", status)
	}
	_, mine = doJSON(t, w.srv, "GET", "/api/v1/me/connected-apps", w.owner.token, nil)
	used, _ := mine["grants"].([]any)[0].(map[string]any)["last_used_at"].(string)
	if _, err := time.Parse(time.RFC3339, used); err != nil {
		t.Errorf("last_used_at = %q after use: %v", used, err)
	}

	// A grant that is not the caller's is not found, and is not touched.
	res, out := doJSON(t, w.srv, "DELETE", "/api/v1/me/connected-apps/"+otherGrant, w.owner.token, nil)
	wantError(t, "revoking another person's grant", res, out, http.StatusNotFound, "not_found")
	res, out = doJSON(t, w.srv, "DELETE", "/api/v1/me/connected-apps/01J8X4NOSUCHGRANT0000000000", w.owner.token, nil)
	wantError(t, "revoking an unknown grant", res, out, http.StatusNotFound, "not_found")

	res, out = doJSON(t, w.srv, "DELETE", "/api/v1/me/connected-apps/"+grantID, w.owner.token, nil)
	if res.StatusCode != http.StatusOK || out["status"] != "ok" {
		t.Fatalf("revoke: %d %v", res.StatusCode, out)
	}
	if res, out := doJSON(t, w.srv, "DELETE", "/api/v1/me/connected-apps/"+grantID, w.owner.token, nil); res.StatusCode != http.StatusOK || out["status"] != "ok" {
		t.Errorf("revoking twice: %d %v, want the same ok", res.StatusCode, out)
	}
	if status := w.toolsList(t, access); status != http.StatusUnauthorized {
		t.Errorf("the revoked token on /mcp: %d, want 401", status)
	}
	_, after := doJSON(t, w.srv, "GET", "/api/v1/me/connected-apps", w.owner.token, nil)
	if grants, _ := after["grants"].([]any); len(grants) != 0 {
		t.Errorf("grants after revoking = %v", grants)
	}
	if n := mcpCount(t, `SELECT count(*) FROM mcp_grants WHERE id = $1 AND revoked_at IS NULL`, otherGrant); n != 1 {
		t.Errorf("the other person's grant was revoked by a refused request")
	}
}

func TestMcpOrganizationConnectedApps(t *testing.T) {
	w := newMcpConnectWorld(t, "org-a", nil)
	outsider := w.addTenant(t, "org-b")
	w.setPolicy(t, w.owner, true)
	w.setPolicy(t, outsider, true)
	member := w.addMember(t, w.owner, "org-member", "member")
	admin := w.addMember(t, w.owner, "org-admin", "admin")

	ownerAccess, ownerGrant := w.connect(t, w.owner)
	memberAccess, memberGrant := w.connect(t, member)
	_, outsiderGrant := w.connect(t, outsider)
	base := "/api/v1/orgs/" + w.owner.slug + "/connected-apps"

	res, list := doJSON(t, w.srv, "GET", base, w.owner.token, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("list as owner: %d %v", res.StatusCode, list)
	}
	wantKeys(t, "organization list", list, "grants", "mcp_url")
	if list["mcp_url"] != mcpTestIssuer+"/mcp" {
		t.Errorf("mcp_url = %v", list["mcp_url"])
	}
	byID := map[string]map[string]any{}
	for _, g := range list["grants"].([]any) {
		g := g.(map[string]any)
		wantKeys(t, "organization grant", g, "id", "organization_id", "organization_name", "user_id", "user_name", "client_id", "client_name", "verified", "scope", "created_at", "last_used_at")
		byID[g["id"].(string)] = g
	}
	if len(byID) != 2 || byID[ownerGrant] == nil || byID[memberGrant] == nil || byID[outsiderGrant] != nil {
		t.Fatalf("the organization's grants = %v, want the owner's and the member's only", byID)
	}
	if g := byID[memberGrant]; g["user_id"] != member.userID || g["user_name"] != "Member org-member" || g["organization_id"] != w.owner.orgID {
		t.Errorf("the member's grant = %v", g)
	}
	raw, _ := json.Marshal(list)
	if strings.Contains(string(raw), member.email) || strings.Contains(string(raw), outsider.orgID) {
		t.Errorf("the list carries an email or another organization's id: %s", raw)
	}

	// An organization admin reads too; a plain member does not.
	if res, out := doJSON(t, w.srv, "GET", base, admin.token, nil); res.StatusCode != http.StatusOK {
		t.Errorf("list as admin: %d %v", res.StatusCode, out)
	}
	res, out := doJSON(t, w.srv, "GET", base, member.token, nil)
	wantError(t, "list as a plain member", res, out, http.StatusForbidden, "forbidden")
	res, out = doJSON(t, w.srv, "DELETE", base+"/"+ownerGrant, member.token, nil)
	wantError(t, "revoke as a plain member", res, out, http.StatusForbidden, "forbidden")

	// Another organization's owner is a stranger to this slug.
	res, out = doJSON(t, w.srv, "GET", base, outsider.token, nil)
	wantError(t, "list as another organization's owner", res, out, http.StatusNotFound, "not_found")
	res, out = doJSON(t, w.srv, "DELETE", base+"/"+ownerGrant, outsider.token, nil)
	wantError(t, "revoke as another organization's owner", res, out, http.StatusNotFound, "not_found")
	// Their own slug with this organization's grant id is not found either.
	res, out = doJSON(t, w.srv, "DELETE", "/api/v1/orgs/"+outsider.slug+"/connected-apps/"+ownerGrant, outsider.token, nil)
	wantError(t, "revoke through their own slug", res, out, http.StatusNotFound, "not_found")
	res, out = doJSON(t, w.srv, "GET", base, "", nil)
	wantError(t, "list with no session", res, out, http.StatusUnauthorized, "unauthorized")
	if n := mcpCount(t, `SELECT count(*) FROM mcp_grants WHERE id = ANY($1) AND revoked_at IS NULL`, []string{ownerGrant, memberGrant}); n != 2 {
		t.Fatalf("a refused request revoked a grant; %d of 2 left", n)
	}

	// The owner ends the member's connection and nobody else's.
	res, out = doJSON(t, w.srv, "DELETE", base+"/"+memberGrant, w.owner.token, nil)
	if res.StatusCode != http.StatusOK || out["status"] != "ok" {
		t.Fatalf("revoke as owner: %d %v", res.StatusCode, out)
	}
	if status := w.toolsList(t, memberAccess); status != http.StatusUnauthorized {
		t.Errorf("the member's token after the revoke: %d, want 401", status)
	}
	if status := w.toolsList(t, ownerAccess); status != http.StatusOK {
		t.Errorf("the owner's token after revoking the member's: %d, want 200", status)
	}
	res, out = doJSON(t, w.srv, "DELETE", base+"/"+memberGrant, admin.token, nil)
	if res.StatusCode != http.StatusOK || out["status"] != "ok" {
		t.Errorf("revoking again as an admin: %d %v, want the same ok", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "DELETE", base+"/"+outsiderGrant, w.owner.token, nil)
	wantError(t, "revoking another organization's grant by its id", res, out, http.StatusNotFound, "not_found")
	if n := mcpCount(t, `SELECT count(*) FROM mcp_grants WHERE id = $1 AND revoked_at IS NULL`, outsiderGrant); n != 1 {
		t.Errorf("another organization's grant was revoked")
	}
	if n := mcpCount(t, `SELECT count(*) FROM audit_events WHERE organization_id = $1 AND action = 'mcp_grant.revoked'`, w.owner.orgID); n != 1 {
		t.Errorf("revoke audit rows = %d, want 1 (the repeat changes nothing)", n)
	}
}

func TestMcpPolicyOverHTTP(t *testing.T) {
	w := newMcpConnectWorld(t, "policy", nil)
	admin := w.addMember(t, w.owner, "policy-admin", "admin")
	path := "/api/v1/orgs/" + w.owner.slug + "/mcp-policy"

	res, off := doJSON(t, w.srv, "GET", path, w.owner.token, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("read: %d %v", res.StatusCode, off)
	}
	wantKeys(t, "policy", off, "enabled", "available", "enabled_at", "enabled_by", "mcp_url", "write_enabled", "write_available", "write_enabled_at", "write_enabled_by")
	if off["enabled"] != false || off["available"] != true || off["enabled_at"] != nil || off["enabled_by"] != "" || off["mcp_url"] != mcpTestIssuer+"/mcp" {
		t.Fatalf("policy before the switch = %v", off)
	}

	res, on := doJSON(t, w.srv, "PUT", path, w.owner.token, map[string]any{"enabled": true})
	if res.StatusCode != http.StatusOK || on["enabled"] != true || on["enabled_by"] != w.owner.userID || on["available"] != true {
		t.Fatalf("switch on: %d %v", res.StatusCode, on)
	}
	at, _ := on["enabled_at"].(string)
	if _, err := time.Parse(time.RFC3339, at); err != nil {
		t.Errorf("enabled_at = %q: %v", at, err)
	}
	// Another admin switching it on again changes nothing: who and when stay.
	res, again := doJSON(t, w.srv, "PUT", path, admin.token, map[string]any{"enabled": true})
	if res.StatusCode != http.StatusOK || again["enabled_by"] != w.owner.userID || again["enabled_at"] != on["enabled_at"] {
		t.Errorf("switching on twice: %d %v, want the first change kept", res.StatusCode, again)
	}
	if _, read := doJSON(t, w.srv, "GET", path, admin.token, nil); read["enabled"] != true || read["enabled_by"] != w.owner.userID {
		t.Errorf("read as admin = %v", read)
	}

	// Switching off closes the door at once and keeps the grants.
	access, grantID := w.connect(t, w.owner)
	res, closed := doJSON(t, w.srv, "PUT", path, w.owner.token, map[string]any{"enabled": false})
	if res.StatusCode != http.StatusOK || closed["enabled"] != false || closed["enabled_at"] != nil {
		t.Fatalf("switch off: %d %v", res.StatusCode, closed)
	}
	if status := w.toolsList(t, access); status != http.StatusForbidden {
		t.Errorf("/mcp with the switch off: %d, want 403", status)
	}
	if n := mcpCount(t, `SELECT count(*) FROM mcp_grants WHERE id = $1 AND revoked_at IS NULL`, grantID); n != 1 {
		t.Errorf("switching off deleted or revoked the grant")
	}

	req, _ := http.NewRequest("PUT", w.srv.URL+path, strings.NewReader("{not json"))
	req.Header.Set("Authorization", "Bearer "+w.owner.token)
	req.Header.Set("Content-Type", "application/json")
	bad, err := w.srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if out := readJSON(t, bad); bad.StatusCode != http.StatusBadRequest || errorCodeOf(out) != "invalid_request" {
		t.Errorf("malformed body: %d %v", bad.StatusCode, out)
	}
}

// Only an owner or an admin reads or flips the switch; to anyone else the
// organization is either forbidden (a member) or not there (a stranger).
func TestMcpPolicyNeedsOrgAdmin(t *testing.T) {
	w := newMcpConnectWorld(t, "policy-admin-only", nil)
	member := w.addMember(t, w.owner, "policy-member", "member")
	outsider := w.addTenant(t, "policy-out")
	w.setPolicy(t, w.owner, true)
	path := "/api/v1/orgs/" + w.owner.slug + "/mcp-policy"

	res, out := doJSON(t, w.srv, "GET", path, member.token, nil)
	wantError(t, "read as a plain member", res, out, http.StatusForbidden, "forbidden")
	res, out = doJSON(t, w.srv, "PUT", path, member.token, map[string]any{"enabled": false})
	wantError(t, "switch as a plain member", res, out, http.StatusForbidden, "forbidden")
	res, out = doJSON(t, w.srv, "PUT", path, outsider.token, map[string]any{"enabled": false})
	wantError(t, "switch as another organization's owner", res, out, http.StatusNotFound, "not_found")
	res, out = doJSON(t, w.srv, "GET", path, outsider.token, nil)
	wantError(t, "read as another organization's owner", res, out, http.StatusNotFound, "not_found")
	if _, read := doJSON(t, w.srv, "GET", path, w.owner.token, nil); read["enabled"] != true {
		t.Fatalf("a refused request changed the switch: %v", read)
	}
	if n := mcpCount(t, `SELECT count(*) FROM audit_events WHERE organization_id = $1 AND action = 'organization.mcp_policy_changed'`, w.owner.orgID); n != 1 {
		t.Errorf("policy audit rows = %d, want only the owner's own switch-on", n)
	}
}

// Write access is a second switch under the connector's own (ADR 0033): it
// refuses to turn on while the connector is off, and reads back on the policy.
func TestMcpWritePolicyOverHTTP(t *testing.T) {
	w := newMcpConnectWorld(t, "write-policy", nil)
	path := "/api/v1/orgs/" + w.owner.slug + "/mcp-policy"

	res, out := doJSON(t, w.srv, "PUT", path+"/write", w.owner.token, map[string]any{"enabled": true})
	wantError(t, "write on before the connector", res, out, http.StatusConflict, "connector_off")

	w.setPolicy(t, w.owner, true)
	res, on := doJSON(t, w.srv, "PUT", path+"/write", w.owner.token, map[string]any{"enabled": true})
	if res.StatusCode != http.StatusOK || on["write_enabled"] != true || on["write_available"] != true || on["write_enabled_by"] != w.owner.userID {
		t.Fatalf("write on: %d %v", res.StatusCode, on)
	}
	if at, _ := on["write_enabled_at"].(string); at == "" {
		t.Errorf("write_enabled_at = %v, want an RFC 3339 time", on["write_enabled_at"])
	}
	res, read := doJSON(t, w.srv, "GET", path, w.owner.token, nil)
	if res.StatusCode != http.StatusOK || read["write_enabled"] != true || read["write_available"] != true || read["enabled"] != true {
		t.Errorf("read after write on: %d %v", res.StatusCode, read)
	}

	res, off := doJSON(t, w.srv, "PUT", path+"/write", w.owner.token, map[string]any{"enabled": false})
	if res.StatusCode != http.StatusOK || off["write_enabled"] != false || off["write_enabled_at"] != nil || off["enabled"] != true {
		t.Errorf("write off: %d %v", res.StatusCode, off)
	}
}

func TestMcpPolicyCannotTurnOnWhileThePlatformFlagIsOff(t *testing.T) {
	w := newMcpConnectWorld(t, "flag-off", func(d *Deps) { d.McpAuth.SetFlags(mcpTestFlags(false)) })
	path := "/api/v1/orgs/" + w.owner.slug + "/mcp-policy"

	res, out := doJSON(t, w.srv, "PUT", path, w.owner.token, map[string]any{"enabled": true})
	wantError(t, "switching on with the flag off", res, out, http.StatusForbidden, "connector_unavailable")
	res, read := doJSON(t, w.srv, "GET", path, w.owner.token, nil)
	if res.StatusCode != http.StatusOK || read["available"] != false || read["enabled"] != false || read["mcp_url"] != mcpTestIssuer+"/mcp" {
		t.Errorf("policy with the flag off: %d %v", res.StatusCode, read)
	}
	if res, out := doJSON(t, w.srv, "PUT", path, w.owner.token, map[string]any{"enabled": false}); res.StatusCode != http.StatusOK || out["enabled"] != false {
		t.Errorf("switching off with the flag off: %d %v, want it allowed", res.StatusCode, out)
	}
}

func TestMcpAdminRoutesAnswerForAClosedDoor(t *testing.T) {
	for name, c := range map[string]struct {
		code  string
		close func(t *testing.T, tn mcpTenant, member mcpTenant)
	}{
		"member deactivated": {"member_deactivated", func(t *testing.T, tn, member mcpTenant) {
			if _, err := testPool.Exec(context.Background(), `UPDATE organization_members SET deactivated_at = now() WHERE organization_id = $1 AND user_id = $2`, tn.orgID, member.userID); err != nil {
				t.Fatal(err)
			}
		}},
		"organization suspended": {"organization_suspended", func(t *testing.T, tn, _ mcpTenant) {
			if _, err := testPool.Exec(context.Background(), `UPDATE organizations SET status = 'suspended' WHERE id = $1`, tn.orgID); err != nil {
				t.Fatal(err)
			}
		}},
	} {
		t.Run(name, func(t *testing.T) {
			tag := strings.ReplaceAll(name, " ", "-")
			w := newMcpConnectWorld(t, "door-"+tag, nil)
			w.setPolicy(t, w.owner, true)
			admin := w.addMember(t, w.owner, "door-admin-"+tag, "admin")
			_, grantID := w.connect(t, w.owner)
			c.close(t, w.owner, admin)
			base := "/api/v1/orgs/" + w.owner.slug
			for _, r := range []struct{ method, path string }{
				{"GET", base + "/connected-apps"},
				{"DELETE", base + "/connected-apps/" + grantID},
				{"GET", base + "/mcp-policy"},
				{"PUT", base + "/mcp-policy"},
				{"PUT", base + "/mcp-policy/write"},
			} {
				res, out := doJSON(t, w.srv, r.method, r.path, admin.token, map[string]any{"enabled": false})
				wantError(t, r.method+" "+r.path, res, out, http.StatusForbidden, c.code)
			}
		})
	}
}

func TestMcpConnectRoutesNeedASession(t *testing.T) {
	w := newMcpConnectWorld(t, "nosession", nil)
	for _, r := range mcpConnectRoutes(w.owner) {
		res, out := doJSON(t, w.srv, r.method, r.path, "", r.body)
		if res.StatusCode != http.StatusUnauthorized {
			t.Errorf("%s %s with no session = %d %v, want 401", r.method, r.path, res.StatusCode, out)
		}
	}
}

func TestMcpConnectRoutesAreNotFoundWhenTheConnectorIsNotWired(t *testing.T) {
	w := newMcpConnectWorld(t, "unwired", func(d *Deps) { d.McpAuth = nil })
	for _, r := range mcpConnectRoutes(w.owner) {
		res, out := doJSON(t, w.srv, r.method, r.path, w.owner.token, r.body)
		wantError(t, r.method+" "+r.path+" unwired", res, out, http.StatusNotFound, "not_found")
	}
}

type mcpConnectRoute struct {
	method, path string
	body         any
}

func mcpConnectRoutes(tn mcpTenant) []mcpConnectRoute {
	const id = "01J8X4ATT0N1P2Q3R4S5T6U7V8"
	org := "/api/v1/orgs/" + tn.slug
	return []mcpConnectRoute{
		{"GET", "/api/v1/auth/connect/attempts/" + id, nil},
		{"POST", "/api/v1/auth/connect/attempts/" + id, map[string]any{"decision": "cancel", "csrf_token": "x"}},
		{"GET", "/api/v1/me/connected-apps", nil},
		{"DELETE", "/api/v1/me/connected-apps/" + id, nil},
		{"GET", org + "/connected-apps", nil},
		{"DELETE", org + "/connected-apps/" + id, nil},
		{"GET", org + "/mcp-policy", nil},
		{"PUT", org + "/mcp-policy", map[string]any{"enabled": true}},
		{"PUT", org + "/mcp-policy/write", map[string]any{"enabled": true}},
	}
}
