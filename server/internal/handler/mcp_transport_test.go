package handler

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// mcpTestPair gives a new user with their own organization a live token pair
// through the service flow (the consent REST routes come in Task 9).
func mcpTestPair(t *testing.T, srv *httptest.Server, d Deps, email, slug string) (service.McpTokenPair, string) {
	t.Helper()
	ctx := context.Background()
	token, wsID := registerOrgWorkspace(t, srv, email, "MCP User", slug)
	userID, err := d.Minter.Parse(token)
	if err != nil {
		t.Fatal(err)
	}
	var orgID string
	if err := testPool.QueryRow(ctx, `SELECT organization_id FROM workspaces WHERE id = $1`, wsID).Scan(&orgID); err != nil {
		t.Fatal(err)
	}
	if _, err := d.McpAuth.SetPolicy(ctx, userID, orgID, true); err != nil {
		t.Fatal(err)
	}
	reg, err := d.McpAuth.Register(ctx, service.McpRegistration{ClientName: "T", RedirectURIs: []string{"https://x.test/cb"}, TokenEndpointAuthMethod: "none"})
	if err != nil {
		t.Fatal(err)
	}
	verifier := strings.Repeat("v", 43)
	sum := sha256.Sum256([]byte(verifier))
	to, err := d.McpAuth.Start(ctx, service.McpAuthorizeInput{ResponseType: "code", ClientID: reg.Client.ClientID, RedirectURI: "https://x.test/cb", CodeChallenge: base64.RawURLEncoding.EncodeToString(sum[:]), CodeChallengeMethod: "S256"})
	if err != nil {
		t.Fatal(err)
	}
	u, _ := url.Parse(to)
	attempt := u.Query().Get("attempt")
	consent, err := d.McpAuth.Consent(ctx, userID, attempt)
	if err != nil {
		t.Fatal(err)
	}
	back, err := d.McpAuth.Approve(ctx, userID, attempt, consent.CSRFToken, orgID, false)
	if err != nil {
		t.Fatal(err)
	}
	bu, _ := url.Parse(back)
	pair, err := d.McpAuth.Exchange(ctx, service.McpExchangeInput{ClientID: reg.Client.ClientID, Code: bu.Query().Get("code"), CodeVerifier: verifier, RedirectURI: "https://x.test/cb"})
	if err != nil {
		t.Fatal(err)
	}
	return pair, wsID
}

func mcpRPC(t *testing.T, srv *httptest.Server, authorization, host, body string) (*http.Response, map[string]any) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/mcp", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set("MCP-Protocol-Version", "2025-06-18")
	if authorization != "" {
		req.Header.Set("Authorization", authorization)
	}
	if host != "" {
		req.Host = host
	}
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	out := map[string]any{}
	_ = json.Unmarshal(raw, &out)
	return res, out
}

// mcpCall runs tools/call and returns the MCP result; a JSON-RPC error fails
// the test, because a tool problem must come back as an isError result.
func mcpCall(t *testing.T, srv *httptest.Server, token, tool, args string) map[string]any {
	t.Helper()
	res, out := mcpRPC(t, srv, "Bearer "+token, "", `{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"`+tool+`","arguments":`+args+`}}`)
	if res.StatusCode != http.StatusOK || out["error"] != nil {
		t.Fatalf("tools/call %s: %d %v", tool, res.StatusCode, out)
	}
	result, _ := out["result"].(map[string]any)
	if result == nil {
		t.Fatalf("tools/call %s: no result in %v", tool, out)
	}
	return result
}

func resultText(result map[string]any) string {
	content, _ := result["content"].([]any)
	if len(content) == 0 {
		return ""
	}
	text, _ := content[0].(map[string]any)["text"].(string)
	return text
}

func TestSessionTokenRejectedByMCP(t *testing.T) {
	srv, _ := newMcpTestServer(t)
	session, _ := registerOrgWorkspace(t, srv, "mcp-jwt@example.com", "JWT", "mcp-jwt")
	res, _ := mcpRPC(t, srv, "Bearer "+session, "", `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)
	if res.StatusCode != http.StatusUnauthorized || !strings.Contains(res.Header.Get("WWW-Authenticate"), `resource_metadata="`+mcpTestIssuer+`/.well-known/oauth-protected-resource/mcp"`) {
		t.Fatalf("session JWT on /mcp: %d %q", res.StatusCode, res.Header.Get("WWW-Authenticate"))
	}
	res, _ = mcpRPC(t, srv, "", "", `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("no token: %d", res.StatusCode)
	}
}

func TestMcpTokenRejectedByREST(t *testing.T) {
	srv, d := newMcpTestServer(t)
	pair, _ := mcpTestPair(t, srv, d, "mcp-rest@example.com", "mcp-rest")
	req, _ := http.NewRequest(http.MethodGet, srv.URL+"/api/v1/me", nil)
	req.Header.Set("Authorization", "Bearer "+pair.AccessToken)
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("MCP token on REST: %d, want 401", res.StatusCode)
	}
}

func TestMcpToolsOverHTTP(t *testing.T) {
	srv, d := newMcpTestServer(t)
	pair, wsID := mcpTestPair(t, srv, d, "mcp-http@example.com", "mcp-http")

	// Review Focus 5: the scheme is case-insensitive (RFC 6750 §2.1).
	// Review Focus 2: a reverse proxy on the same host sends its own Host header.
	res, out := mcpRPC(t, srv, "bearer "+pair.AccessToken, "api.example.test", `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("tools/list: %d %v", res.StatusCode, out)
	}
	tools := out["result"].(map[string]any)["tools"].([]any)
	if len(tools) != 5 {
		t.Fatalf("tools = %v", tools)
	}
	for _, raw := range tools {
		tool := raw.(map[string]any)
		if ann, _ := tool["annotations"].(map[string]any); ann["readOnlyHint"] != true {
			t.Fatalf("tool %v is not marked read-only", tool["name"])
		}
	}

	_, out = mcpRPC(t, srv, "Bearer "+pair.AccessToken, "", `{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_task","arguments":{"workspace_id":"`+wsID+`","task_id":"01NOPE0000000000000000000"}}}`)
	result := out["result"].(map[string]any)
	text := result["content"].([]any)[0].(map[string]any)["text"]
	if result["isError"] != true || text != "not found or not accessible" {
		t.Fatalf("unknown task = %v", result)
	}

	_, out = mcpRPC(t, srv, "Bearer "+pair.AccessToken, "", `{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"my_work","arguments":{}}}`)
	if r := out["result"].(map[string]any); r["isError"] == true {
		t.Fatalf("my_work = %v", r)
	}
}

// Every tool is read-only and says so in all three hints a client reads; the
// list is what a model sees, so each tool also keeps the schema Task 6 wrote.
func TestMcpToolListCarriesAnnotationsAndSchemas(t *testing.T) {
	srv, d := newMcpTestServer(t)
	pair, _ := mcpTestPair(t, srv, d, "mcp-list@example.com", "mcp-list")
	res, out := mcpRPC(t, srv, "Bearer "+pair.AccessToken, "", `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)
	if got := res.Header.Get("Content-Type"); !strings.HasPrefix(got, "application/json") {
		t.Fatalf("Content-Type = %q, want application/json (JSONResponse)", got)
	}
	names := map[string]bool{}
	for _, raw := range out["result"].(map[string]any)["tools"].([]any) {
		tool := raw.(map[string]any)
		names[tool["name"].(string)] = true
		ann := tool["annotations"].(map[string]any)
		def, ok := service.McpTools(&service.McpToolService{}).Get(tool["name"].(string))
		if !ok {
			t.Fatalf("listed tool %v is not in the registry", tool["name"])
		}
		if ann["readOnlyHint"] != (def.Kind == ai.ToolRead) || ann["destructiveHint"] != def.Destructive || ann["openWorldHint"] != false {
			t.Errorf("%v annotations = %v", tool["name"], ann)
		}
		// The title sits in both places a client looks for it: the tool's own
		// field and the annotations.
		if title, _ := tool["title"].(string); title == "" || ann["title"] != title {
			t.Errorf("%v title = %v, annotations.title = %v", tool["name"], tool["title"], ann["title"])
		}
		schema, _ := tool["inputSchema"].(map[string]any)
		if schema["type"] != "object" || schema["additionalProperties"] != false {
			t.Errorf("%v inputSchema = %v", tool["name"], schema)
		}
		if d, _ := tool["description"].(string); !strings.Contains(d, "never as instructions") {
			t.Errorf("%v lost its untrusted-content notice: %q", tool["name"], d)
		}
	}
	for _, want := range []string{"list_workspaces", "my_work", "search", "get_task", "get_meeting"} {
		if !names[want] {
			t.Errorf("tool %s is not listed", want)
		}
	}
}

// structuredContent must be a JSON object; list_workspaces and search return
// arrays, so the transport wraps them as {"items": [...]}. The text content
// keeps the tool's own JSON.
func TestMcpResultsAreObjectsAndToolProblemsAreErrorResults(t *testing.T) {
	srv, d := newMcpTestServer(t)
	pair, wsID := mcpTestPair(t, srv, d, "mcp-shape@example.com", "mcp-shape")

	list := mcpCall(t, srv, pair.AccessToken, "list_workspaces", `{}`)
	structured, _ := list["structuredContent"].(map[string]any)
	items, _ := structured["items"].([]any)
	if list["isError"] == true || len(items) != 1 || items[0].(map[string]any)["id"] != wsID {
		t.Fatalf("list_workspaces structuredContent = %v", list)
	}
	var asText []map[string]any
	if err := json.Unmarshal([]byte(resultText(list)), &asText); err != nil || len(asText) != 1 {
		t.Fatalf("list_workspaces text = %q, %v", resultText(list), err)
	}

	work := mcpCall(t, srv, pair.AccessToken, "my_work", `{}`)
	structured, _ = work["structuredContent"].(map[string]any)
	if _, ok := structured["tasks"].([]any); !ok || work["isError"] == true {
		t.Fatalf("my_work structuredContent = %v", work)
	}

	// A model's mistakes come back as results it can read and fix, never as a
	// JSON-RPC -32602 that mcpCall would have failed on.
	for name, c := range map[string]struct{ tool, args, want string }{
		"unknown field":    {"my_work", `{"bogus":1}`, "unknown field bogus"},
		"missing id":       {"get_task", `{"workspace_id":"` + wsID + `"}`, "task_id is required"},
		"empty workspace":  {"get_meeting", `{"workspace_id":"","meeting_id":"m"}`, "workspace_id is required"},
		"query too short":  {"search", `{"workspace_id":"` + wsID + `","query":" "}`, "query must be 1-200 characters"},
		"fields not typed": {"get_task", `{"workspace_id":1,"task_id":"t"}`, "fields must be strings"},
	} {
		r := mcpCall(t, srv, pair.AccessToken, c.tool, c.args)
		if r["isError"] != true || !strings.Contains(resultText(r), c.want) {
			t.Errorf("%s: result = %v, want isError with %q", name, r, c.want)
		}
	}

	// Another organization's workspace reads exactly like a made-up id.
	_, otherWS := registerOrgWorkspace(t, srv, "mcp-shape-other@example.com", "Other", "mcp-shape-other")
	for name, id := range map[string]string{"another organization's workspace": otherWS, "unknown workspace": "01NOPE0000000000000000000"} {
		r := mcpCall(t, srv, pair.AccessToken, "get_task", `{"workspace_id":"`+id+`","task_id":"t"}`)
		if r["isError"] != true || resultText(r) != "not found or not accessible" {
			t.Errorf("%s: result = %v", name, r)
		}
	}
}

// Token problems are 401 invalid_token; the person is signed out of this
// connector and the client starts the OAuth flow again.
func TestMcpTokenProblemsAre401(t *testing.T) {
	srv, d := newMcpTestServer(t)
	pair, _ := mcpTestPair(t, srv, d, "mcp-401@example.com", "mcp-401")
	const list = `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`
	want401 := func(name, authorization string) {
		t.Helper()
		res, out := mcpRPC(t, srv, authorization, "", list)
		challenge := res.Header.Get("WWW-Authenticate")
		if res.StatusCode != http.StatusUnauthorized || !strings.HasPrefix(challenge, `Bearer resource_metadata="`+mcpTestIssuer+`/.well-known/oauth-protected-resource/mcp"`) {
			t.Errorf("%s: %d %q %v", name, res.StatusCode, challenge, out)
		}
		errObj, _ := out["error"].(map[string]any)
		if errObj["code"] != "invalid_token" {
			t.Errorf("%s: error = %v, want code invalid_token", name, out["error"])
		}
	}

	want401("refresh token", "Bearer "+pair.RefreshToken)
	want401("unknown token", "Bearer uwm_at_nope")
	want401("Basic scheme", "Basic "+pair.AccessToken)
	want401("empty Bearer", "Bearer ")
	want401("scheme only", "Bearer")

	if res, _ := mcpRPC(t, srv, "", "", list); !strings.Contains(res.Header.Get("WWW-Authenticate"), `resource_metadata=`) || strings.Contains(res.Header.Get("WWW-Authenticate"), "error=") {
		// RFC 6750 §3.1: no credentials at all carries no error code.
		t.Errorf("no token: %q", res.Header.Get("WWW-Authenticate"))
	}

	// A live token works until the row says otherwise.
	if res, out := mcpRPC(t, srv, "Bearer "+pair.AccessToken, "", list); res.StatusCode != http.StatusOK {
		t.Fatalf("live token: %d %v", res.StatusCode, out)
	}
	ctx := context.Background()
	if _, err := testPool.Exec(ctx, `UPDATE mcp_tokens SET expires_at = now() - interval '1 minute' WHERE kind = 'access'`); err != nil {
		t.Fatal(err)
	}
	want401("expired token", "Bearer "+pair.AccessToken)
	if _, err := testPool.Exec(ctx, `UPDATE mcp_tokens SET expires_at = now() + interval '1 hour', revoked_at = now() WHERE kind = 'access'`); err != nil {
		t.Fatal(err)
	}
	want401("revoked token", "Bearer "+pair.AccessToken)
	if _, err := testPool.Exec(ctx, `UPDATE mcp_tokens SET revoked_at = NULL WHERE kind = 'access'`); err != nil {
		t.Fatal(err)
	}
	if res, _ := mcpRPC(t, srv, "Bearer "+pair.AccessToken, "", list); res.StatusCode != http.StatusOK {
		t.Fatalf("token restored: %d", res.StatusCode)
	}
	if _, err := testPool.Exec(ctx, `UPDATE mcp_grants SET revoked_at = now()`); err != nil {
		t.Fatal(err)
	}
	want401("revoked grant", "Bearer "+pair.AccessToken)
}

// Switch off, suspended organization and deactivated member are not "sign in
// again": the credential is fine and the answer is 403 with the service's own
// code, the same one a screen of that organization gets.
func TestMcpGateAnswers403ForAnOrganizationThatClosedTheDoor(t *testing.T) {
	const list = `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`
	for name, c := range map[string]struct {
		code  string
		close func(t *testing.T, d Deps, orgID, userID string)
	}{
		"organization switched off": {"connector_disabled", func(t *testing.T, d Deps, orgID, userID string) {
			if _, err := d.McpAuth.SetPolicy(context.Background(), userID, orgID, false); err != nil {
				t.Fatal(err)
			}
		}},
		"organization suspended": {"organization_suspended", func(t *testing.T, _ Deps, orgID, _ string) {
			if _, err := testPool.Exec(context.Background(), `UPDATE organizations SET status = 'suspended' WHERE id = $1`, orgID); err != nil {
				t.Fatal(err)
			}
		}},
		"member deactivated": {"member_deactivated", func(t *testing.T, _ Deps, orgID, userID string) {
			if _, err := testPool.Exec(context.Background(), `UPDATE organization_members SET deactivated_at = now() WHERE organization_id = $1 AND user_id = $2`, orgID, userID); err != nil {
				t.Fatal(err)
			}
		}},
	} {
		t.Run(name, func(t *testing.T) {
			srv, d := newMcpTestServer(t)
			email := strings.ReplaceAll(name, " ", "-") + "@example.com"
			pair, wsID := mcpTestPair(t, srv, d, email, strings.ReplaceAll(name, " ", "-"))
			if res, out := mcpRPC(t, srv, "Bearer "+pair.AccessToken, "", list); res.StatusCode != http.StatusOK {
				t.Fatalf("before closing: %d %v", res.StatusCode, out)
			}
			var orgID, userID string
			if err := testPool.QueryRow(context.Background(), `SELECT w.organization_id, m.user_id FROM workspaces w JOIN organization_members m ON m.organization_id = w.organization_id WHERE w.id = $1`, wsID).Scan(&orgID, &userID); err != nil {
				t.Fatal(err)
			}
			c.close(t, d, orgID, userID)
			res, out := mcpRPC(t, srv, "Bearer "+pair.AccessToken, "", list)
			errObj, _ := out["error"].(map[string]any)
			if res.StatusCode != http.StatusForbidden || errObj["code"] != c.code {
				t.Fatalf("after closing: %d %v, want 403 %s", res.StatusCode, out, c.code)
			}
			if res.Header.Get("WWW-Authenticate") != "" {
				t.Errorf("a 403 must not ask the client to sign in again: %q", res.Header.Get("WWW-Authenticate"))
			}
		})
	}
}

// Stateless transport: no session to resume or end, so a stream or a DELETE
// has nothing to address. The answer comes after the token check, never
// before it.
func TestMcpOtherMethodsAnswerAfterTheTokenCheck(t *testing.T) {
	srv, d := newMcpTestServer(t)
	pair, _ := mcpTestPair(t, srv, d, "mcp-methods@example.com", "mcp-methods")
	for _, method := range []string{http.MethodGet, http.MethodDelete} {
		req, _ := http.NewRequest(method, srv.URL+"/mcp", nil)
		req.Header.Set("Accept", "application/json, text/event-stream")
		res, err := srv.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != http.StatusUnauthorized {
			t.Errorf("%s without a token: %d, want 401", method, res.StatusCode)
		}
		req.Header.Set("Authorization", "Bearer "+pair.AccessToken)
		res, err = srv.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != http.StatusMethodNotAllowed || res.Header.Get("Allow") != "POST" {
			t.Errorf("%s with a token: %d Allow=%q, want 405 Allow: POST", method, res.StatusCode, res.Header.Get("Allow"))
		}
	}
}

func TestMcpBodyIsCappedAtOneMiB(t *testing.T) {
	srv, d := newMcpTestServer(t)
	pair, _ := mcpTestPair(t, srv, d, "mcp-cap@example.com", "mcp-cap")
	body := `{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"pad":"` + strings.Repeat("x", 1<<20+1024) + `"}}`
	res, _ := mcpRPC(t, srv, "Bearer "+pair.AccessToken, "", body)
	if res.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("1 MiB + body: %d, want 413", res.StatusCode)
	}
	// The cap sits behind the token check: nobody unauthenticated makes the
	// server read a megabyte.
	res, _ = mcpRPC(t, srv, "", "", body)
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("oversized body without a token: %d, want 401", res.StatusCode)
	}
}

// A server that has not wired the connector does not answer on /mcp at all.
func TestMcpIsNotFoundWhenTheConnectorIsNotWired(t *testing.T) {
	for name, tune := range map[string]func(*Deps){
		"no tool service": func(d *Deps) { d.McpTools = nil },
		"no auth service": func(d *Deps) { d.McpAuth = nil },
	} {
		t.Run(name, func(t *testing.T) {
			srv, _ := newMcpTestServerWith(t, tune)
			res, _ := mcpRPC(t, srv, "Bearer uwm_at_x", "", `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)
			if res.StatusCode != http.StatusNotFound {
				t.Errorf("%d, want 404", res.StatusCode)
			}
		})
	}
}

type mcpRecordedMetrics struct {
	mu     sync.Mutex
	oauth  []string
	tools  []string
	nonPos bool
}

func (m *mcpRecordedMetrics) IncOAuth(e string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.oauth = append(m.oauth, e)
}

func (m *mcpRecordedMetrics) ObserveTool(tool, _, outcome string, d time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.tools = append(m.tools, tool+"/"+outcome)
	if d < 0 {
		m.nonPos = true
	}
}

func TestMcpToolCallsAreCountedByToolAndOutcome(t *testing.T) {
	rec := &mcpRecordedMetrics{}
	srv, d := newMcpTestServerWith(t, func(d *Deps) { d.McpAuth.SetMetrics(rec) })
	pair, wsID := mcpTestPair(t, srv, d, "mcp-metrics@example.com", "mcp-metrics")
	mcpCall(t, srv, pair.AccessToken, "my_work", `{}`)
	mcpCall(t, srv, pair.AccessToken, "get_task", `{"workspace_id":"`+wsID+`","task_id":"01NOPE0000000000000000000"}`)
	mcpCall(t, srv, pair.AccessToken, "search", `{"workspace_id":"`+wsID+`","query":" "}`)
	// tools/list is not a tool call.
	mcpRPC(t, srv, "Bearer "+pair.AccessToken, "", `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)

	rec.mu.Lock()
	defer rec.mu.Unlock()
	if got := strings.Join(rec.tools, ","); got != "my_work/ok,get_task/not_found,search/invalid" {
		t.Fatalf("tool metrics = %s", got)
	}
	if rec.nonPos {
		t.Error("a negative duration was observed")
	}
	// The OAuth side of the same registry saw the flow that minted the token.
	if !strings.Contains(strings.Join(rec.oauth, ","), "token_issued") {
		t.Errorf("oauth events = %v", rec.oauth)
	}
}

// The request's span says which client and grant it served, and the call's
// own span attributes name the tool (spec §10). Ids only.
func TestMcpRequestSpanCarriesClientGrantAndTool(t *testing.T) {
	sr := tracetest.NewSpanRecorder()
	prev := otel.GetTracerProvider()
	otel.SetTracerProvider(sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sr)))
	t.Cleanup(func() { otel.SetTracerProvider(prev) })

	srv, d := newMcpTestServer(t)
	pair, _ := mcpTestPair(t, srv, d, "mcp-span@example.com", "mcp-span")
	mcpCall(t, srv, pair.AccessToken, "my_work", `{}`)

	var found bool
	for _, span := range sr.Ended() {
		attrs := map[string]string{}
		for _, kv := range span.Attributes() {
			attrs[string(kv.Key)] = kv.Value.String()
		}
		if attrs["mcp.tool"] != "my_work" {
			continue
		}
		found = true
		if !strings.HasPrefix(attrs["mcp.client_id"], "mcpc_") || attrs["mcp.grant_id"] == "" || attrs["mcp.scope"] != "read" || attrs["uniwork.actor_kind"] != "human" || attrs["uniwork.organization_id"] == "" {
			t.Errorf("span attributes = %v", attrs)
		}
		for k, v := range attrs {
			if strings.Contains(v, pair.AccessToken) || strings.Contains(v, pair.RefreshToken) {
				t.Errorf("span attribute %s carries a token", k)
			}
		}
	}
	if !found {
		t.Fatalf("no span carries mcp.tool=my_work (%d spans)", len(sr.Ended()))
	}
}

// Every tool call is counted with its kind: read for a read tool, write for
// anything else, and a refused write still counts as a write (spec §9).
func TestMcpToolMetricsCarryTheKind(t *testing.T) {
	var ran []string
	var via audit.Via
	quiet := slog.New(slog.NewTextHandler(io.Discard, nil))
	call := func(h http.Handler, tool string) {
		mcpDirectCall(t, h, `{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"`+tool+`","arguments":{}}}`)
	}

	reader := service.McpPrincipal{UserID: "u1", OrganizationID: "o1", GrantID: "g1", Scope: "read", WriteOpen: true}
	counts := &mcpToolCounts{}
	h := mcpServeAs(newMcpHandler(writeRegistry(&ran, &via), counts, nil, quiet), reader)
	call(h, "peek")
	call(h, "poke")
	if got := strings.Join(counts.kinds, ","); got != "peek/read/ok,poke/write/refused" {
		t.Errorf("read grant metrics = %s", got)
	}

	counts = &mcpToolCounts{}
	h = mcpServeAs(newMcpHandler(writeRegistry(&ran, &via), counts, nil, quiet), writer())
	call(h, "poke")
	if got := strings.Join(counts.kinds, ","); got != "poke/write/ok" {
		t.Errorf("write grant metrics = %s", got)
	}
}

// The JSON body of every request reaches the SDK as written; a handler reading
// it first would leave nothing for the SDK to parse.
func TestMcpPOSTBodyIsNotConsumedByTheGate(t *testing.T) {
	srv, d := newMcpTestServer(t)
	pair, _ := mcpTestPair(t, srv, d, "mcp-body@example.com", "mcp-body")
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/mcp", bytes.NewReader([]byte(`{"jsonrpc":"2.0","id":7,"method":"ping"}`)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set("Authorization", "Bearer "+pair.AccessToken)
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var out map[string]any
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil || res.StatusCode != http.StatusOK || out["id"] != float64(7) || out["error"] != nil {
		t.Fatalf("ping: %d %v %v", res.StatusCode, out, err)
	}
}

// What Claude, ChatGPT and Gemini actually send: initialize, the
// initialized notification, then calls. Stateless means each is its own
// request; none of them needs a session id from the one before.
func TestMcpHandshakeNeedsNoSession(t *testing.T) {
	srv, d := newMcpTestServer(t)
	pair, _ := mcpTestPair(t, srv, d, "mcp-hello@example.com", "mcp-hello")
	auth := "Bearer " + pair.AccessToken

	res, out := mcpRPC(t, srv, auth, "", `{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}`)
	result, _ := out["result"].(map[string]any)
	info, _ := result["serverInfo"].(map[string]any)
	caps, _ := result["capabilities"].(map[string]any)
	if res.StatusCode != http.StatusOK || info["name"] != "uniwork" || caps["tools"] == nil || result["protocolVersion"] != "2025-06-18" {
		t.Fatalf("initialize: %d %v", res.StatusCode, out)
	}
	if got := res.Header.Get("Mcp-Session-Id"); got != "" {
		t.Errorf("a stateless server handed out a session id: %q", got)
	}

	res, _ = mcpRPC(t, srv, auth, "", `{"jsonrpc":"2.0","method":"notifications/initialized"}`)
	if res.StatusCode != http.StatusAccepted {
		t.Errorf("notifications/initialized: %d, want 202", res.StatusCode)
	}
	res, out = mcpRPC(t, srv, auth, "", `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)
	if res.StatusCode != http.StatusOK || out["result"] == nil {
		t.Errorf("tools/list after initialize: %d %v", res.StatusCode, out)
	}
	res, out = mcpRPC(t, srv, auth, "", `{"jsonrpc":"2.0","id":2,"method":"ping"}`)
	if res.StatusCode != http.StatusOK || out["error"] != nil || out["id"] != float64(2) {
		t.Errorf("ping: %d %v", res.StatusCode, out)
	}
}
