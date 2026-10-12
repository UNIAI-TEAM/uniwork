package handler

// Handler tests for the Office app capability route (plan X-03,
// GET /api/v1/orgs/{orgID}/office/capabilities): the flag defaults a fresh
// deployment serves, the override order (user > organization > global) the
// same evaluator GET /api/v1/config uses, the membership gate, and the
// OpenAPI shape. The route is app-only: no web client reads it.

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// appCapabilityWorld is one organization with an owner and an outsider who
// belongs to no organization, on a fresh test database.
type appCapabilityWorld struct {
	srv                       *httptest.Server
	ownerToken, ownerID       string
	outsiderToken, outsiderID string
	orgID, orgSlug            string
}

func newAppCapabilityWorld(t *testing.T) *appCapabilityWorld {
	t.Helper()
	d, _ := newTestDeps(t, nil, discardOutbox{})
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)

	ownerToken, ownerID := filesRegister(t, srv, "app-capability-owner@example.test")
	outsiderToken, outsiderID := filesRegister(t, srv, "app-capability-outsider@example.test")
	res, out := doJSON(t, srv, "POST", "/api/v1/orgs", ownerToken, map[string]string{"name": "App Caps", "slug": "app-caps"})
	if res.StatusCode != 201 {
		t.Fatalf("org: %d %v", res.StatusCode, out)
	}
	org := out["organization"].(map[string]any)
	return &appCapabilityWorld{
		srv: srv, ownerToken: ownerToken, ownerID: ownerID,
		outsiderToken: outsiderToken, outsiderID: outsiderID,
		orgID: org["id"].(string), orgSlug: org["slug"].(string),
	}
}

// setFlagOverride writes one override through the fixture pool and drops the
// provider cache the way the flag.updated consumer does in production. It must
// run after newTestDeps: a fresh testutil.DB would block on the advisory lock
// the fixture pool holds.
func setFlagOverride(t *testing.T, key, scopeType, scopeID string, enabled bool) {
	t.Helper()
	if testPool == nil {
		t.Fatal("setFlagOverride: call newTestDeps first")
	}
	q := db.New(testPool)
	if _, err := q.UpsertFlagOverride(context.Background(), db.UpsertFlagOverrideParams{
		ID: util.NewID(), FlagKey: key, ScopeType: scopeType, ScopeID: scopeID,
		Enabled: enabled, Note: "X-03 capability test", CreatedBy: "test",
	}); err != nil {
		t.Fatalf("override %s/%s/%s: %v", key, scopeType, scopeID, err)
	}
	if testFlagOverrides != nil {
		testFlagOverrides.Invalidate()
	}
}

func clearFlagOverride(t *testing.T, key, scopeType, scopeID string) {
	t.Helper()
	q := db.New(testPool)
	if _, err := q.DeleteFlagOverride(context.Background(), db.DeleteFlagOverrideParams{
		FlagKey: key, ScopeType: scopeType, ScopeID: scopeID,
	}); err != nil {
		t.Fatalf("delete override %s/%s/%s: %v", key, scopeType, scopeID, err)
	}
	if testFlagOverrides != nil {
		testFlagOverrides.Invalidate()
	}
}

func (w *appCapabilityWorld) get(t *testing.T, token string) (*http.Response, map[string]any) {
	t.Helper()
	return doJSON(t, w.srv, "GET", "/api/v1/orgs/"+w.orgID+"/office/capabilities", token, nil)
}

func (w *appCapabilityWorld) configFlags(t *testing.T, token string) map[string]any {
	t.Helper()
	res, out := doJSON(t, w.srv, "GET", "/api/v1/config?organization_id="+w.orgID, token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("config: %d %v", res.StatusCode, out)
	}
	return out["flags"].(map[string]any)
}

// A fresh deployment with no overrides serves the catalogue defaults: the two
// sync kill switches on, the offline library and UniWork AI off, no AI format
// listed, and the 300 second TTL.
func TestOfficeAppCapabilitiesFreshDeploymentDefaults(t *testing.T) {
	w := newAppCapabilityWorld(t)

	res, out := w.get(t, w.ownerToken)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("capabilities: %d %v", res.StatusCode, out)
	}
	if out["sync_feed"] != true || out["sync_write"] != true {
		t.Fatalf("sync capabilities = %v/%v, want both true", out["sync_feed"], out["sync_write"])
	}
	if out["offline_library"] != false || out["ai_uniwork"] != false {
		t.Fatalf("offline/ai = %v/%v, want both false", out["offline_library"], out["ai_uniwork"])
	}
	if formats, ok := out["ai_uniwork_formats"].([]any); !ok || len(formats) != 0 {
		t.Fatalf("ai_uniwork_formats = %v, want an empty list", out["ai_uniwork_formats"])
	}
	if ttl, ok := out["ttl_seconds"].(float64); !ok || ttl != 300 {
		t.Fatalf("ttl_seconds = %v, want 300", out["ttl_seconds"])
	}

	// The same flags through GET /api/v1/config: the public ones appear
	// (office_sync_feed on, every office_ai_uniwork* off), the private ones do
	// not, so the web client never sees a capability it cannot use.
	flags := w.configFlags(t, w.ownerToken)
	if flags["office_sync_feed"] != true {
		t.Fatalf("config office_sync_feed = %v, want true", flags["office_sync_feed"])
	}
	for _, key := range []string{"office_sync_write", "office_offline_library"} {
		if _, published := flags[key]; published {
			t.Fatalf("%s is not public and must not appear in config flags", key)
		}
	}
	for key, value := range flags {
		if strings.HasPrefix(key, "office_ai_uniwork") && value != false {
			t.Fatalf("config %s = %v, want false", key, value)
		}
	}
	if _, published := flags["office_ai_uniwork"]; !published {
		t.Fatal("office_ai_uniwork is public and must appear in config flags")
	}
}

// Overrides resolve user > organization > global for every capability, through
// the same evaluator the web config route uses: the app and the web client
// never disagree about a flag.
func TestOfficeAppCapabilitiesResolveUserThenOrgThenGlobal(t *testing.T) {
	w := newAppCapabilityWorld(t)

	// global on, organization off, user on -> the user wins.
	setFlagOverride(t, "office_sync_write", featureflags.ScopeGlobal, "", true)
	setFlagOverride(t, "office_sync_write", featureflags.ScopeOrganization, w.orgID, false)
	setFlagOverride(t, "office_sync_write", featureflags.ScopeUser, w.ownerID, true)
	if _, out := w.get(t, w.ownerToken); out["sync_write"] != true {
		t.Fatalf("user override must win: %v", out["sync_write"])
	}

	// Without the user row the organization wins over global.
	clearFlagOverride(t, "office_sync_write", featureflags.ScopeUser, w.ownerID)
	if _, out := w.get(t, w.ownerToken); out["sync_write"] != false {
		t.Fatalf("organization override must win over global: %v", out["sync_write"])
	}

	// Without the organization row global applies.
	clearFlagOverride(t, "office_sync_write", featureflags.ScopeOrganization, w.orgID)
	if _, out := w.get(t, w.ownerToken); out["sync_write"] != true {
		t.Fatalf("global override must apply: %v", out["sync_write"])
	}

	// The other organization's owner is untouched by this organization's row:
	// the route answers the caller's own override, not the path's.
	setFlagOverride(t, "office_sync_feed", featureflags.ScopeOrganization, w.orgID, false)
	res, out := doJSON(t, w.srv, "POST", "/api/v1/orgs", w.outsiderToken, map[string]string{"name": "Other", "slug": "other"})
	if res.StatusCode != 201 {
		t.Fatalf("other org: %d %v", res.StatusCode, out)
	}
	otherOrg := out["organization"].(map[string]any)["id"].(string)
	res, out = doJSON(t, w.srv, "GET", "/api/v1/orgs/"+otherOrg+"/office/capabilities", w.outsiderToken, nil)
	if res.StatusCode != http.StatusOK || out["sync_feed"] != true {
		t.Fatalf("another organization's capability = %d %v, want the default true", res.StatusCode, out)
	}
}

// ai_uniwork_formats lists only the formats whose per-format flag is on while
// office_ai_uniwork is on: a per-format switch can never widen the kill switch.
func TestOfficeAppCapabilitiesAIFormatsFollowTheKillSwitch(t *testing.T) {
	w := newAppCapabilityWorld(t)

	// A per-format flag alone, with the kill switch off, lists nothing.
	setFlagOverride(t, "office_ai_uniwork_docx", featureflags.ScopeOrganization, w.orgID, true)
	if _, out := w.get(t, w.ownerToken); out["ai_uniwork"] != false {
		t.Fatalf("ai_uniwork = %v, want false", out["ai_uniwork"])
	} else if formats := out["ai_uniwork_formats"].([]any); len(formats) != 0 {
		t.Fatalf("formats with the kill switch off = %v, want empty", formats)
	}

	// The kill switch on plus two formats lists exactly those two, in the
	// catalogue order.
	setFlagOverride(t, "office_ai_uniwork", featureflags.ScopeGlobal, "", true)
	setFlagOverride(t, "office_ai_uniwork_xlsx", featureflags.ScopeOrganization, w.orgID, true)
	_, out := w.get(t, w.ownerToken)
	if out["ai_uniwork"] != true {
		t.Fatalf("ai_uniwork = %v, want true", out["ai_uniwork"])
	}
	formats, _ := out["ai_uniwork_formats"].([]any)
	if len(formats) != 2 || formats[0] != "docx" || formats[1] != "xlsx" {
		t.Fatalf("formats = %v, want [docx xlsx]", out["ai_uniwork_formats"])
	}
}

// The route is organization-scoped: an outsider naming another organization's
// id is refused with no text or id of that organization, a caller with no
// session is refused 401, and a suspended organization closes the route to its
// own members.
func TestOfficeAppCapabilitiesMembershipOnly(t *testing.T) {
	w := newAppCapabilityWorld(t)

	// The outsider (B) names the organization (A): refused, and the answer
	// carries no id of A's.
	res, raw := officeRaw(t, w.srv, "GET", "/api/v1/orgs/"+w.orgID+"/office/capabilities", w.outsiderToken, nil, nil)
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("outsider = %d, want 403: %s", res.StatusCode, raw)
	}
	if strings.Contains(string(raw), w.orgID) || strings.Contains(string(raw), w.orgSlug) {
		t.Fatalf("refusal leaked A's id or slug: %s", raw)
	}

	// No session at all.
	res, _ = doJSON(t, w.srv, "GET", "/api/v1/orgs/"+w.orgID+"/office/capabilities", "", nil)
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("anonymous = %d, want 401", res.StatusCode)
	}

	// A suspended organization is closed to its own members on this gate too.
	if _, err := testPool.Exec(context.Background(), `UPDATE organizations SET status = 'suspended' WHERE id = $1`, w.orgID); err != nil {
		t.Fatal(err)
	}
	res, out := w.get(t, w.ownerToken)
	if code, _ := errCodeClass(out); res.StatusCode != http.StatusForbidden || code != "organization_suspended" {
		t.Fatalf("suspended = %d %v, want 403 organization_suspended", res.StatusCode, out)
	}
	if _, err := testPool.Exec(context.Background(), `UPDATE organizations SET status = 'active' WHERE id = $1`, w.orgID); err != nil {
		t.Fatal(err)
	}

	// A deactivated member keeps the same refusal.
	if _, err := testPool.Exec(context.Background(), `UPDATE organization_members SET deactivated_at = now() WHERE organization_id = $1 AND user_id = $2`, w.orgID, w.ownerID); err != nil {
		t.Fatal(err)
	}
	res, out = w.get(t, w.ownerToken)
	if code, _ := errCodeClass(out); res.StatusCode != http.StatusForbidden || code != "member_deactivated" {
		t.Fatalf("deactivated = %d %v, want 403 member_deactivated", res.StatusCode, out)
	}
}

// The route documents its SDO shape and the {orgID} path parameter, and the
// summary keeps it apart from the per-document capabilities route.
func TestOfficeAppCapabilitiesOpenAPI(t *testing.T) {
	h := New(Deps{Cfg: config.Config{FrontendOrigin: "http://localhost:3000", EnableSwagger: true}})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/swagger/doc.json", nil))
	var spec struct {
		Paths map[string]struct {
			Get struct {
				Summary    string `json:"summary"`
				Parameters []struct {
					Name string `json:"name"`
				} `json:"parameters"`
				Responses map[string]json.RawMessage `json:"responses"`
			} `json:"get"`
		} `json:"paths"`
		Components struct {
			Schemas map[string]struct {
				Properties map[string]json.RawMessage `json:"properties"`
			} `json:"schemas"`
		} `json:"components"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &spec); err != nil {
		t.Fatal(err)
	}
	op, ok := spec.Paths["/api/v1/orgs/{orgID}/office/capabilities"]
	if !ok {
		t.Fatal("the app capability route is missing from the spec")
	}
	if op.Get.Summary != "Office features enabled for this organization (app)" {
		t.Fatalf("summary = %q", op.Get.Summary)
	}
	params := map[string]bool{}
	for _, p := range op.Get.Parameters {
		params[p.Name] = true
	}
	if !params["orgID"] {
		t.Error("missing the orgID path parameter")
	}
	if _, ok := op.Get.Responses["200"]; !ok {
		t.Fatal("missing the 200 response")
	}
	// The reflector names the schema after the Go type and the response 200
	// $refs it. Every wire field must be a documented property, so the app
	// contract and the SDO cannot drift.
	schema, ok := spec.Components.Schemas["SdoOfficeAppCapabilitiesSDO"]
	if !ok {
		t.Fatal("the SDO schema is missing from the spec")
	}
	for _, field := range []string{"sync_feed", "sync_write", "offline_library", "ai_uniwork", "ai_uniwork_formats", "ttl_seconds"} {
		if _, ok := schema.Properties[field]; !ok {
			t.Errorf("SDO schema is missing %s", field)
		}
	}
}
