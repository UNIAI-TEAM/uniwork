package handler

// Handler-level tests for the UNI-1008 W1 AI provider key store over the real
// router: the key never comes back (only key_hint), 201 on create and 200 on
// replace, another member's key is a 404, an outsider gets 404 everywhere,
// office.ai_byok gates saving only, and a server without AI_CREDENTIAL_KEY
// answers 503 instead of failing to boot.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type failingBYOKEntitlements struct {
	err error
}

func (f failingBYOKEntitlements) Can(context.Context, string, string) error {
	return f.err
}

const testHandlerAIKey = "sk-handler-0123456789wxyz"

type aiCredentialWorld struct {
	srv      *httptest.Server
	token    string
	ownerID  string
	orgID    string
	member   string
	outsider string
}

func newAICredentialWorld(t *testing.T) *aiCredentialWorld {
	t.Helper()
	srv := newTestServer(t)
	w := &aiCredentialWorld{srv: srv}
	w.token, w.ownerID = filesRegister(t, srv, "aikey-owner@example.com")
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

// UNI-1240: the chosen model is part of the credential. A model-only PUT
// switches it without the key, GET returns it with model_updated_at, and a
// malformed id is a 400.
func TestAICredentialHTTPSavesTheModel(t *testing.T) {
	w := newAICredentialWorld(t)
	base := "/api/v1/orgs/" + w.orgID + "/ai/credentials"

	status, raw := rawCall(t, w.srv, "PUT", base+"/openai", w.token, `{"api_key":"`+testHandlerAIKey+`"}`)
	if status != http.StatusCreated || !strings.Contains(raw, `"model":""`) || !strings.Contains(raw, `"model_updated_at":""`) {
		t.Fatalf("create = %d %s", status, raw)
	}
	status, raw = rawCall(t, w.srv, "PUT", base+"/openai", w.token, `{"model":"gpt-4.1-mini"}`)
	if status != http.StatusOK || !strings.Contains(raw, `"model":"gpt-4.1-mini"`) || !strings.Contains(raw, `"key_hint":"…wxyz"`) {
		t.Fatalf("model-only PUT = %d %s", status, raw)
	}
	res, out := doJSON(t, w.srv, "GET", base, w.token, nil)
	items, _ := out["items"].([]any)
	if res.StatusCode != 200 || len(items) != 1 {
		t.Fatalf("list = %d %v", res.StatusCode, out)
	}
	item := items[0].(map[string]any)
	if item["model"] != "gpt-4.1-mini" || item["model_updated_at"] == "" {
		t.Fatalf("item = %v", item)
	}
	if status, raw = rawCall(t, w.srv, "PUT", base+"/openai", w.token, `{"model":"gpt 4; drop"}`); status != http.StatusBadRequest {
		t.Fatalf("bad model = %d %s", status, raw)
	}
	// Another member never sees the owner's model.
	if _, out := doJSON(t, w.srv, "GET", base, w.member, nil); len(out["items"].([]any)) != 0 {
		t.Fatalf("member list = %v", out)
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

// G6-05k (ADR 0034): GET /orgs/{orgID}/ai/credentials carries byok {enabled,
// reason} for both a web session and a desktop device session, and an older
// client that only decodes {items, providers} continues to parse.
func TestAICredentialHTTPListCarriesBYOKStatus(t *testing.T) {
	d, _ := newTestDeps(t, nil, discardOutbox{})
	var logs bytes.Buffer
	d.Log = slog.New(slog.NewTextHandler(&logs, nil))
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)

	webToken, ownerID := filesRegister(t, srv, "aikey-byok-owner@example.com")
	res, out := doJSON(t, srv, "POST", "/api/v1/orgs", webToken, map[string]string{"name": "AI Key BYOK Org", "slug": "ai-key-byok-org"})
	if res.StatusCode != 201 {
		t.Fatalf("create org: %d %v", res.StatusCode, out)
	}
	orgID := out["organization"].(map[string]any)["id"].(string)

	base := "/api/v1/orgs/" + orgID + "/ai/credentials"
	if status, raw := rawCall(t, srv, "PUT", base+"/openai", webToken, `{"api_key":"`+testHandlerAIKey+`","model":"gpt-4.1-mini"}`); status != http.StatusCreated {
		t.Fatalf("create = %d %s", status, raw)
	}

	minter := auth.TokenMinter{Secret: []byte("test"), TTL: time.Minute}
	deviceToken, err := minter.MintSession(ownerID, "cred-device-session")
	if err != nil {
		t.Fatal(err)
	}

	type olderClientShape struct {
		Items []struct {
			Provider string `json:"provider"`
			KeyHint  string `json:"key_hint"`
		} `json:"items"`
		Providers []struct {
			ID string `json:"id"`
		} `json:"providers"`
	}

	for _, c := range []struct {
		name, token string
	}{
		{"web session", webToken},
		{"device session", deviceToken},
	} {
		status, raw := rawCall(t, srv, "GET", base, c.token, "")
		if status != http.StatusOK {
			t.Fatalf("%s list = %d %s", c.name, status, raw)
		}
		var full map[string]any
		if err := json.Unmarshal([]byte(raw), &full); err != nil {
			t.Fatalf("%s decode full = %v", c.name, err)
		}
		byok, ok := full["byok"].(map[string]any)
		if !ok || byok["enabled"] != true || byok["reason"] != "" {
			t.Fatalf("%s byok = %v, want enabled=true reason=\"\"", c.name, full["byok"])
		}
		var older olderClientShape
		if err := json.Unmarshal([]byte(raw), &older); err != nil {
			t.Fatalf("%s older-shape decode = %v", c.name, err)
		}
		if len(older.Items) != 1 || older.Items[0].Provider != "openai" || older.Items[0].KeyHint != "…wxyz" || len(older.Providers) == 0 {
			t.Fatalf("%s older-shape = %+v", c.name, older)
		}
	}

	if _, err := testPool.Exec(context.Background(), `UPDATE subscriptions SET overrides = '{"office.ai_byok": false}'::jsonb WHERE organization_id = $1`, orgID); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		name, token string
	}{
		{"web session", webToken},
		{"device session", deviceToken},
	} {
		res, out := doJSON(t, srv, "GET", base, c.token, nil)
		byok, ok := out["byok"].(map[string]any)
		if res.StatusCode != http.StatusOK || !ok || byok["enabled"] != false || byok["reason"] != "entitlement_required" {
			t.Fatalf("%s without office.ai_byok = %d %v, want enabled=false reason=entitlement_required", c.name, res.StatusCode, out)
		}
	}

	// G05KBE-4d: h.AIBYOK == nil reports a neutral reason ("") while the credential store works.
	noBYOKDeps := d
	noBYOKDeps.AIBYOK = nil
	noBYOKSrv := httptest.NewServer(New(noBYOKDeps))
	t.Cleanup(noBYOKSrv.Close)
	res, out = doJSON(t, noBYOKSrv, "GET", base, webToken, nil)
	if byok, ok := out["byok"].(map[string]any); res.StatusCode != http.StatusOK || !ok || byok["enabled"] != false || byok["reason"] != "" {
		t.Fatalf("nil AIBYOK = %d %v, want 200 enabled=false reason=\"\"", res.StatusCode, out)
	}

	// G05KBE-4e: an unexpected entitlement-lookup error logs and keeps the list answering 200 with neutral byok.
	logs.Reset()
	errBYOKDeps := d
	errBYOKDeps.AIBYOK = service.NewAIBYOKService(d.Organizations, failingBYOKEntitlements{err: errors.New("entitlement db hiccup")}, d.AICredentials, nil)
	errBYOKSrv := httptest.NewServer(New(errBYOKDeps))
	t.Cleanup(errBYOKSrv.Close)
	res, out = doJSON(t, errBYOKSrv, "GET", base, webToken, nil)
	items, _ := out["items"].([]any)
	byok, ok := out["byok"].(map[string]any)
	if res.StatusCode != http.StatusOK || len(items) != 1 || !ok || byok["enabled"] != false || byok["reason"] != "" {
		t.Fatalf("unexpected entitlement error = %d %v, want 200 with items and byok enabled=false reason=\"\"", res.StatusCode, out)
	}
	if logOut := logs.String(); !strings.Contains(logOut, "level=ERROR") || !strings.Contains(logOut, "entitlement db hiccup") || strings.Contains(logOut, "aikey-byok-owner@example.com") {
		t.Fatalf("unexpected entitlement error log = %q, want ERROR without PII", logOut)
	}
}
