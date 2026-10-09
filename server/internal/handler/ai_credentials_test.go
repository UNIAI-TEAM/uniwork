package handler

// Handler-level tests for the UNI-1008 W1 AI provider key store over the real
// router: the key never comes back (only key_hint), 201 on create and 200 on
// replace, another member's key is a 404, an outsider gets 404 everywhere,
// office.ai_byok gates saving only, and a server without AI_CREDENTIAL_KEY
// answers 503 instead of failing to boot.

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const testHandlerAIKey = "sk-handler-0123456789wxyz"

type aiCredentialWorld struct {
	srv      *httptest.Server
	token    string
	orgID    string
	member   string
	outsider string
}

func newAICredentialWorld(t *testing.T) *aiCredentialWorld {
	t.Helper()
	srv := newTestServer(t)
	w := &aiCredentialWorld{srv: srv}
	w.token, _ = filesRegister(t, srv, "aikey-owner@example.com")
	res, out := doJSON(t, srv, "POST", "/api/v1/orgs", w.token, map[string]string{"name": "AI Key Org", "slug": "ai-key-org"})
	if res.StatusCode != 201 {
		t.Fatalf("create org: %d %v", res.StatusCode, out)
	}
	w.orgID = out["organization"].(map[string]any)["id"].(string)
	var memberID string
	w.member, memberID = filesRegister(t, srv, "aikey-member@example.com")
	if _, err := testPool.Exec(context.Background(), `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'member')`, w.orgID, memberID); err != nil {
		t.Fatal(err)
	}
	w.outsider, _ = filesRegister(t, srv, "aikey-outsider@example.com")
	return w
}

// rawCall returns the body as text, so a test can prove a string is absent
// from the whole answer, not just from one field.
func rawCall(t *testing.T, srv *httptest.Server, method, path, token, body string) (int, string) {
	t.Helper()
	req, err := http.NewRequest(method, srv.URL+path, strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	return res.StatusCode, string(raw)
}

func TestAICredentialHTTPNeverReturnsTheKey(t *testing.T) {
	w := newAICredentialWorld(t)
	base := "/api/v1/orgs/" + w.orgID + "/ai/credentials"

	status, raw := rawCall(t, w.srv, "PUT", base+"/openai", w.token, `{"api_key":"`+testHandlerAIKey+`","label":"Công việc"}`)
	if status != http.StatusCreated || strings.Contains(raw, testHandlerAIKey) || !strings.Contains(raw, `"key_hint":"…wxyz"`) {
		t.Fatalf("create = %d %s", status, raw)
	}
	status, raw = rawCall(t, w.srv, "PUT", base+"/openai", w.token, `{"api_key":"`+testHandlerAIKey+`","label":"Khác"}`)
	if status != http.StatusOK || strings.Contains(raw, testHandlerAIKey) {
		t.Fatalf("replace = %d %s", status, raw)
	}
	status, raw = rawCall(t, w.srv, "GET", base, w.token, "")
	if status != http.StatusOK || strings.Contains(raw, testHandlerAIKey) || strings.Contains(raw, "secret") {
		t.Fatalf("list = %d %s", status, raw)
	}
	res, out := doJSON(t, w.srv, "GET", base, w.token, nil)
	items, _ := out["items"].([]any)
	providers, _ := out["providers"].([]any)
	if res.StatusCode != 200 || len(items) != 1 || len(providers) == 0 {
		t.Fatalf("list shape = %d %v", res.StatusCode, out)
	}
	item := items[0].(map[string]any)
	if item["provider"] != "openai" || item["label"] != "Khác" || item["key_hint"] != "…wxyz" {
		t.Fatalf("item = %v", item)
	}

	status, raw = rawCall(t, w.srv, "DELETE", base+"/openai", w.token, "")
	if status != http.StatusNoContent {
		t.Fatalf("delete = %d %s", status, raw)
	}
	status, raw = rawCall(t, w.srv, "DELETE", base+"/openai", w.token, "")
	if status != http.StatusNotFound || !strings.Contains(raw, "credential_missing") {
		t.Fatalf("second delete = %d %s", status, raw)
	}
}

func TestAICredentialHTTPIsPersonal(t *testing.T) {
	w := newAICredentialWorld(t)
	base := "/api/v1/orgs/" + w.orgID + "/ai/credentials"
	if status, raw := rawCall(t, w.srv, "PUT", base+"/anthropic", w.token, `{"api_key":"`+testHandlerAIKey+`"}`); status != http.StatusCreated {
		t.Fatalf("create = %d %s", status, raw)
	}

	// Another member: an empty list, and the owner's key is a 404 to delete.
	res, out := doJSON(t, w.srv, "GET", base, w.member, nil)
	if items, _ := out["items"].([]any); res.StatusCode != 200 || len(items) != 0 {
		t.Fatalf("member list = %d %v", res.StatusCode, out)
	}
	if status, raw := rawCall(t, w.srv, "DELETE", base+"/anthropic", w.member, ""); status != http.StatusNotFound {
		t.Fatalf("member delete of the owner's key = %d %s", status, raw)
	}

	// An outsider: 404 on every route, the same answer as an unknown org.
	for _, c := range []struct{ method, path, body string }{
		{"GET", base, ""},
		{"PUT", base + "/anthropic", `{"api_key":"` + testHandlerAIKey + `"}`},
		{"DELETE", base + "/anthropic", ""},
	} {
		if status, raw := rawCall(t, w.srv, c.method, c.path, w.outsider, c.body); status != http.StatusNotFound || strings.Contains(raw, "…wxyz") {
			t.Errorf("outsider %s %s = %d %s, want 404", c.method, c.path, status, raw)
		}
	}

	// The owner's key is still there.
	res, out = doJSON(t, w.srv, "GET", base, w.token, nil)
	if items, _ := out["items"].([]any); res.StatusCode != 200 || len(items) != 1 {
		t.Fatalf("owner list = %d %v", res.StatusCode, out)
	}
}

func TestAICredentialHTTPRefusals(t *testing.T) {
	w := newAICredentialWorld(t)
	base := "/api/v1/orgs/" + w.orgID + "/ai/credentials"
	for _, c := range []struct {
		path, body string
		status     int
		code       string
	}{
		{base + "/codex", `{"api_key":"` + testHandlerAIKey + `"}`, http.StatusBadRequest, "provider_not_supported"},
		{base + "/custom", `{"api_key":"` + testHandlerAIKey + `","base_url":"http://10.0.0.1/v1"}`, http.StatusBadRequest, "base_url_refused"},
		{base + "/openai", `{"label":"no key yet"}`, http.StatusBadRequest, ""},
	} {
		status, raw := rawCall(t, w.srv, "PUT", c.path, w.token, c.body)
		if status != c.status || (c.code != "" && !strings.Contains(raw, c.code)) || strings.Contains(raw, testHandlerAIKey) {
			t.Errorf("PUT %s = %d %s, want %d %s", c.path, status, raw, c.status, c.code)
		}
	}

	// Without office.ai_byok saving is refused; listing still answers.
	if _, err := testPool.Exec(context.Background(), `UPDATE subscriptions SET overrides = '{"office.ai_byok": false}'::jsonb WHERE organization_id = $1`, w.orgID); err != nil {
		t.Fatal(err)
	}
	status, raw := rawCall(t, w.srv, "PUT", base+"/openai", w.token, `{"api_key":"`+testHandlerAIKey+`"}`)
	if status != http.StatusForbidden || !strings.Contains(raw, "entitlement_required") {
		t.Fatalf("save without office.ai_byok = %d %s", status, raw)
	}
	if status, raw := rawCall(t, w.srv, "GET", base, w.token, ""); status != http.StatusOK {
		t.Fatalf("list without office.ai_byok = %d %s", status, raw)
	}
}

func TestAICredentialHTTPWithoutKeyAnswers503(t *testing.T) {
	d, pool := newTestDeps(t, nil, discardOutbox{})
	q := db.New(pool)
	d.AICredentials = service.NewAICredentialService(pool, q, d.Organizations, service.NewEntitlementService(pool, q), nil)
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)

	token, _ := filesRegister(t, srv, "aikey-nobox@example.com")
	res, out := doJSON(t, srv, "POST", "/api/v1/orgs", token, map[string]string{"name": "No Box Org", "slug": "no-box-org"})
	if res.StatusCode != 201 {
		t.Fatalf("create org: %d %v", res.StatusCode, out)
	}
	base := "/api/v1/orgs/" + out["organization"].(map[string]any)["id"].(string) + "/ai/credentials"
	for _, c := range []struct{ method, path, body string }{
		{"GET", base, ""},
		{"PUT", base + "/openai", `{"api_key":"` + testHandlerAIKey + `"}`},
		{"DELETE", base + "/openai", ""},
	} {
		if status, raw := rawCall(t, srv, c.method, c.path, token, c.body); status != http.StatusServiceUnavailable || !strings.Contains(raw, "ai_credentials_unavailable") {
			t.Errorf("%s %s without AI_CREDENTIAL_KEY = %d %s, want 503", c.method, c.path, status, raw)
		}
	}
	// An outsider still gets the 404 every outsider gets.
	outsider, _ := filesRegister(t, srv, "aikey-nobox-outsider@example.com")
	if status, raw := rawCall(t, srv, "GET", base, outsider, ""); status != http.StatusNotFound {
		t.Fatalf("outsider without AI_CREDENTIAL_KEY = %d %s, want 404", status, raw)
	}
}
