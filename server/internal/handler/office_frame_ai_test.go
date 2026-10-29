package handler

// Handler-level tests for GO-A7's AI routes on the web Office frame token
// (UNI-1014, CONTRACT C16, ADR 0029 D9) over the real router: every route
// answers through the frame token; the token's document must be the path's,
// a session token or another organization's token is refused, view access is
// rechecked on every call, entitlement and the module flag gate as on the
// session routes, and the frame token answer carries the AI grant the host
// may give the frame.

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// frameAIWorld is an office world whose cloud tools are fakes.
type frameAIWorld struct {
	*officeWorld
	docID string
	token string
}

func newFrameAIWorld(t *testing.T) *frameAIWorld {
	t.Helper()
	return newFrameAIWorldWith(t, nil)
}

// newFrameAIWorldWith is newFrameAIWorld with extra run on the dependencies,
// to swap a service in before the server starts.
func newFrameAIWorldWith(t *testing.T, extra func(*Deps, *pgxpool.Pool)) *frameAIWorld {
	t.Helper()
	setCloudEnv(t, "fake", "fake", "fake")
	fw := &frameAIWorld{}
	fw.officeWorld = newOfficeWorldTweaked(t, true, func(*filesfake.Fake) service.OfficeEngine { return newHandlerStubEngine(t) }, extra)
	enableOfficeDocsWeb(t, fw.q)
	fw.docID = fw.createDocx(t, "frame-ai.docx", frameDocx(t, "frameai"))
	fw.token = fw.mintFrameToken(t, fw.docID)["token"].(string)
	return fw
}

func (w *frameAIWorld) path(doc, rest string) string {
	return "/api/v1/office-frame/documents/" + doc + "/ai" + rest
}

func (w *frameAIWorld) override(t *testing.T, overrides string) {
	t.Helper()
	if _, err := testPool.Exec(context.Background(), `UPDATE subscriptions SET overrides = $2::jsonb WHERE organization_id = $1`, w.orgID, overrides); err != nil {
		t.Fatal(err)
	}
}

// frameAIRoute is one frame AI route with a body its handler accepts.
type frameAIRoute struct{ method, rest, body string }

var frameAIRoutes = []frameAIRoute{
	{"GET", "/cloud", ""},
	{"POST", "/cloud/search", `{"query":"giá cà phê","kind":"web","max_results":3}`},
	{"POST", "/cloud/images", `{"prompt":"văn phòng xanh","aspect_ratio":"16:9"}`},
	{"POST", "/cloud/media/analyze", `{"requirements":"mô tả ảnh","media":[{"mime":"image/png","data_base64":"` + cloudPNG + `"}]}`},
	{"POST", "/cloud/transcribe", `{"audio":{"mime":"audio/mpeg","data_base64":"AAAA"}}`},
}

// The whole round trip on the frame token alone: the cloud status says the
// tools are on and every cloud tool answers.
func TestOfficeFrameAIHappyPath(t *testing.T) {
	w := newFrameAIWorld(t)
	code, body := rawCall(t, w.srv, "GET", w.path(w.docID, "/cloud"), w.token, "")
	if code != http.StatusOK || !strings.Contains(body, `"enabled":true`) {
		t.Fatalf("cloud status = %d %s", code, body)
	}
	for _, rt := range frameAIRoutes {
		if !strings.HasPrefix(rt.rest, "/cloud/") {
			continue
		}
		if code, body := rawCall(t, w.srv, rt.method, w.path(w.docID, rt.rest), w.token, rt.body); code != http.StatusOK {
			t.Errorf("%s %s = %d %s", rt.method, rt.rest, code, body)
		}
	}
}

// token0 is the owner's session token (the world's own).
func (w *frameAIWorld) token0() string { return w.officeWorld.token }

// Every route refuses what is not this document's frame token: no token, the
// session token, a garbage token, another document's token (same user) and
// another organization's token all fail before any handler runs.
func TestOfficeFrameAIRefusesEverythingButThisDocumentsToken(t *testing.T) {
	w := newFrameAIWorld(t)
	otherDoc := w.createDocx(t, "other.docx", frameDocx(t, "other"))
	otherDocToken := w.mintFrameToken(t, otherDoc)["token"].(string)

	// A document in another organization the same owner holds. No API can
	// put one person in two organizations any more (ADR 0032), so the owner
	// joins the second one by raw seeding, as accounts from before it did.
	founderTok, _ := filesRegister(t, w.srv, "frame-ai-other-founder@example.com")
	res, out := doJSON(t, w.srv, "POST", "/api/v1/orgs", founderTok, map[string]string{"name": "Other Org", "slug": "frame-ai-other"})
	if res.StatusCode != 201 {
		t.Fatalf("create org: %d %v", res.StatusCode, out)
	}
	org2 := out["organization"].(map[string]any)["id"].(string)
	res, out = doJSON(t, w.srv, "POST", "/api/v1/orgs/"+org2+"/workspaces", founderTok, map[string]string{"name": "Other WS", "slug": "frame-ai-other-ws"})
	if res.StatusCode != 201 {
		t.Fatalf("create ws: %d %v", res.StatusCode, out)
	}
	ws2 := out["workspace"].(map[string]any)["id"].(string)
	if err := w.q.AddOrganizationMember(context.Background(), db.AddOrganizationMemberParams{
		OrganizationID: org2, UserID: w.userID, Role: "admin",
	}); err != nil {
		t.Fatal(err)
	}
	if err := w.q.AddWorkspaceMember(context.Background(), db.AddWorkspaceMemberParams{
		WorkspaceID: ws2, OrganizationID: org2, UserID: w.userID, Role: "admin",
	}); err != nil {
		t.Fatal(err)
	}
	other := &officeWorld{srv: w.srv, q: w.q, token: w.token0(), wsID: ws2}
	org2Doc := other.createDocx(t, "org2.docx", frameDocx(t, "org2"))
	org2Token := other.mintFrameToken(t, org2Doc)["token"].(string)

	for _, rt := range frameAIRoutes {
		for _, c := range []struct {
			name, token string
			status      int
		}{
			{"session token", w.token0(), http.StatusUnauthorized},
			{"garbage token", "oft1.not.a-token", http.StatusUnauthorized},
			{"another document's token", otherDocToken, http.StatusNotFound},
			{"another organization's token", org2Token, http.StatusNotFound},
		} {
			if code, body := rawCall(t, w.srv, rt.method, w.path(w.docID, rt.rest), c.token, rt.body); code != c.status {
				t.Errorf("%s %s with %s = %d %s, want %d", rt.method, rt.rest, c.name, code, body, c.status)
			}
		}
		req, _ := http.NewRequest(rt.method, w.srv.URL+w.path(w.docID, rt.rest), strings.NewReader(rt.body))
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_ = res.Body.Close()
		if res.StatusCode != http.StatusUnauthorized {
			t.Errorf("%s %s without a token = %d, want 401", rt.method, rt.rest, res.StatusCode)
		}
	}
}

// View access is rechecked on every call: a member who loses the workspace
// loses the frame's AI with the next request, though the token is still
// within its lifetime.
func TestOfficeFrameAIRechecksViewAccessPerRequest(t *testing.T) {
	w := newFrameAIWorld(t)
	ctx := context.Background()
	if err := w.q.AddWorkspaceMember(ctx, db.AddWorkspaceMemberParams{WorkspaceID: w.wsID, UserID: w.outsider, Role: "member", OrganizationID: w.orgID}); err != nil {
		t.Fatal(err)
	}
	res, out := doJSON(t, w.srv, "POST", "/api/v1/documents/"+w.docID+"/office/frame-token", w.outsiderTok, nil)
	if res.StatusCode != 201 {
		t.Fatalf("member mint = %d %v", res.StatusCode, out)
	}
	memberToken := out["token"].(string)
	if code, body := rawCall(t, w.srv, "GET", w.path(w.docID, "/cloud"), memberToken, ""); code != http.StatusOK {
		t.Fatalf("member with view access = %d %s", code, body)
	}
	if _, err := testPool.Exec(ctx, `DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`, w.wsID, w.outsider); err != nil {
		t.Fatal(err)
	}
	for _, rt := range frameAIRoutes {
		if code, body := rawCall(t, w.srv, rt.method, w.path(w.docID, rt.rest), memberToken, rt.body); code != http.StatusNotFound {
			t.Errorf("%s %s after losing access = %d %s, want 404", rt.method, rt.rest, code, body)
		}
	}
}

// The plan gates the frame exactly as the session routes: without
// office.ai_cloud the tools refuse and the status says why.
func TestOfficeFrameAIEntitlementRequired(t *testing.T) {
	w := newFrameAIWorld(t)
	w.override(t, `{"office.ai_cloud": false}`)
	for _, rt := range frameAIRoutes {
		code, body := rawCall(t, w.srv, rt.method, w.path(w.docID, rt.rest), w.token, rt.body)
		switch {
		case rt.rest == "/cloud":
			if code != http.StatusOK || !strings.Contains(body, `"reason":"entitlement_required"`) {
				t.Errorf("cloud status without the plan = %d %s", code, body)
			}
		default:
			if code != http.StatusForbidden || !strings.Contains(body, "entitlement_required") {
				t.Errorf("%s %s without the plan = %d %s, want 403 entitlement_required", rt.method, rt.rest, code, body)
			}
		}
	}
}

// The token module's flag closes the frame AI as it closes every frame route.
func TestOfficeFrameAIFollowsTheModuleFlag(t *testing.T) {
	w := newFrameAIWorld(t)
	setOfficeDocsWebFor(t, w.q, w.orgID, false)
	for _, rt := range frameAIRoutes {
		if code, body := rawCall(t, w.srv, rt.method, w.path(w.docID, rt.rest), w.token, rt.body); code != http.StatusNotFound || !strings.Contains(body, "feature_disabled") {
			t.Errorf("%s %s with office_docs_web off = %d %s, want 404 feature_disabled", rt.method, rt.rest, code, body)
		}
	}
}

// The frame token answer carries the cloud grant: the three cloud tools follow
// UniWork AI (flags on, office.ai_cloud on), and the answer has no `ai` key
// at all.
func TestOfficeFrameTokenCarriesTheAIGrant(t *testing.T) {
	w := newFrameAIWorld(t)
	grant := func() map[string]any {
		t.Helper()
		return w.mintFrameToken(t, w.docID)["ai"].(map[string]any)
	}
	want := func(name string, got map[string]any, on bool) {
		t.Helper()
		if _, has := got["ai"]; has {
			t.Errorf("%s: grant %v still carries an ai key", name, got)
		}
		if got["uniwork_ai"] != on || got["web_search"] != on || got["image_search"] != on || got["image_generation"] != on {
			t.Errorf("%s: grant %v, want every field %v", name, got, on)
		}
	}
	want("flags off", grant(), false)
	enableUniworkAI(t, "docx")
	want("full plan", grant(), true)
	w.override(t, `{"office.ai_cloud": false}`)
	want("no office.ai_cloud", grant(), false)
}

// enableUniworkAI turns office_ai_uniwork and the given per-format flags on
// globally (they default off).
func enableUniworkAI(t *testing.T, formats ...string) {
	t.Helper()
	setFlagOverride(t, "office_ai_uniwork", featureflags.ScopeGlobal, "", true)
	for _, f := range formats {
		setFlagOverride(t, "office_ai_uniwork_"+f, featureflags.ScopeGlobal, "", true)
	}
}

// UniWork AI and the cloud tools follow office.ai_cloud and the flags; spent
// credits do not take them away (the turn answers 402 instead).
func TestOfficeFrameCloudToolsFollowUniworkAI(t *testing.T) {
	w := newFrameAIWorld(t)
	grant := func() map[string]any {
		t.Helper()
		return w.mintFrameToken(t, w.docID)["ai"].(map[string]any)
	}
	all := func(got map[string]any, on bool) bool {
		return got["uniwork_ai"] == on && got["web_search"] == on && got["image_search"] == on && got["image_generation"] == on
	}
	enableUniworkAI(t, "docx")
	got := grant()
	if _, has := got["ai"]; has || !all(got, true) {
		t.Fatalf("full plan: grant %v, want the four fields true and no ai key", got)
	}
	setFlagOverride(t, "office_ai_uniwork", featureflags.ScopeGlobal, "", false)
	if got := grant(); !all(got, false) {
		t.Fatalf("office_ai_uniwork off: grant %v, want the four fields false", got)
	}
	setFlagOverride(t, "office_ai_uniwork", featureflags.ScopeGlobal, "", true)
	w.override(t, `{"ai.tokens": 0}`)
	if got := grant(); got["uniwork_ai"] != true {
		t.Fatalf("credits spent: grant %v, want uniwork_ai still true", got)
	}
	w.override(t, `{"office.ai_cloud": false}`)
	if got := grant(); !all(got, false) {
		t.Fatalf("no office.ai_cloud: grant %v, want the four fields false", got)
	}
}

// The kill switch and the per-format flags hide uniwork_ai: a format switched
// off closes only that format, and the override order is user > organization
// > global.
func TestOfficeFrameUniworkAIFollowsTheFormatFlags(t *testing.T) {
	w := newFrameAIWorld(t)
	pdf := w.createDocx(t, "scan.pdf", framePDF)
	uniworkAI := func(doc string) any {
		t.Helper()
		return w.mintFrameToken(t, doc)["ai"].(map[string]any)["uniwork_ai"]
	}
	setFlagOverride(t, "office_ai_uniwork_docx", featureflags.ScopeGlobal, "", true)
	setFlagOverride(t, "office_ai_uniwork_pdf", featureflags.ScopeGlobal, "", true)
	if got := uniworkAI(w.docID); got != false {
		t.Fatalf("format on, kill switch off: uniwork_ai=%v, want false", got)
	}
	setFlagOverride(t, "office_ai_uniwork", featureflags.ScopeGlobal, "", true)
	if a, b := uniworkAI(w.docID), uniworkAI(pdf); a != true || b != true {
		t.Fatalf("both formats on: docx=%v pdf=%v, want true true", a, b)
	}
	setFlagOverride(t, "office_ai_uniwork_docx", featureflags.ScopeOrganization, w.orgID, false)
	if a, b := uniworkAI(w.docID), uniworkAI(pdf); a != false || b != true {
		t.Fatalf("docx off for the organization: docx=%v pdf=%v, want false true", a, b)
	}
	setFlagOverride(t, "office_ai_uniwork_docx", featureflags.ScopeUser, w.userID, true)
	if got := uniworkAI(w.docID); got != true {
		t.Fatalf("docx on for the user over the organization: uniwork_ai=%v, want true", got)
	}
	setFlagOverride(t, "office_ai_uniwork", featureflags.ScopeOrganization, w.orgID, false)
	if a, b := uniworkAI(w.docID), uniworkAI(pdf); a != false || b != false {
		t.Fatalf("kill switch off for the organization: docx=%v pdf=%v, want false false", a, b)
	}
}

// uniworkNamedProvider is the fake provider under another name, so UniWork AI
// resolves (or fails to resolve) a model for that provider.
type uniworkNamedProvider struct {
	*provider.Fake
	name string
}

func (p uniworkNamedProvider) Name() string { return p.name }

// UniWork AI needs a configured gateway: with no provider, or a provider
// without an office_uniwork_ai model (ollama), neither the frame grant nor the
// cloud status turns it on, whatever the flags say.
func TestOfficeFrameUniworkAINeedsAConfiguredGateway(t *testing.T) {
	for _, c := range []struct {
		name string
		p    provider.Provider
	}{
		{"no provider", nil},
		{"provider without a model", uniworkNamedProvider{&provider.Fake{}, "ollama"}},
	} {
		t.Run(c.name, func(t *testing.T) {
			w := newFrameAIWorldWith(t, func(d *Deps, pool *pgxpool.Pool) {
				q := db.New(pool)
				d.AICloud = service.NewAICloudService(d.Organizations, service.NewEntitlementService(pool, q),
					ai.NewGateway(q, c.p, nil, nil, ai.Options{}))
			})
			enableUniworkAI(t, "docx")
			if got := w.mintFrameToken(t, w.docID)["ai"].(map[string]any); got["uniwork_ai"] != false {
				t.Fatalf("grant %v, want uniwork_ai=false", got)
			}
			code, body := rawCall(t, w.srv, "GET", w.path(w.docID, "/cloud"), w.token, "")
			if code != http.StatusOK || !strings.Contains(body, `"chat":false`) || !strings.Contains(body, `"uniwork_model":""`) {
				t.Fatalf("cloud status = %d %s, want chat=false and an empty uniwork_model", code, body)
			}
		})
	}
}

// G6-05m: the frame's cloud status carries the same uniwork_model as the
// session route: "" while UniWork AI is off for the caller, the Gateway's
// policy model once it is on.
func TestOfficeFrameCloudStatusCarriesTheUniworkModel(t *testing.T) {
	w := newFrameAIWorld(t)
	status := func() string {
		t.Helper()
		code, body := rawCall(t, w.srv, "GET", w.path(w.docID, "/cloud"), w.token, "")
		if code != http.StatusOK {
			t.Fatalf("cloud status = %d %s", code, body)
		}
		return body
	}
	if body := status(); !strings.Contains(body, `"uniwork_model":""`) {
		t.Fatalf("UniWork AI off: %s, want an empty uniwork_model", body)
	}
	enableUniworkAI(t, "docx")
	if body := status(); !strings.Contains(body, `"uniwork_model":"fake"`) {
		t.Fatalf("UniWork AI on: %s, want the Gateway's policy model", body)
	}
}

// Only a member who may view the document gets a grant: a person outside the
// organization reads all off, and a member whose view access is gone gets no
// token at all, so no grant.
func TestOfficeFrameUniworkAIOnlyForMembersWithAccess(t *testing.T) {
	var deps *Deps
	w := newFrameAIWorldWith(t, func(d *Deps, _ *pgxpool.Pool) { deps = d })
	enableUniworkAI(t, "docx")
	_, strangerID := filesRegister(t, w.srv, "frame-ai-stranger@example.com")
	h := &handlers{Deps: *deps}
	h.OfficeCapabilities = service.NewOfficeCapabilitiesService(deps.Organizations, deps.FeatureFlags)
	member := h.officeFrameAIGrant(context.Background(), service.OfficeFrameClaims{UserID: w.userID, OrganizationID: w.orgID})
	if !member.UniworkAI {
		t.Fatalf("member grant %+v, want uniwork_ai", member)
	}
	stranger := h.officeFrameAIGrant(context.Background(), service.OfficeFrameClaims{UserID: strangerID, OrganizationID: w.orgID})
	if stranger != (sdo.OfficeFrameAIGrantSDO{}) {
		t.Fatalf("non-member grant %+v, want all off", stranger)
	}

	// A workspace member with a view share on a restricted document gets the
	// grant; once the share is revoked there is no token and no grant.
	viewer, viewerID := w.officeJoinWorkspace(t, "frame-ai-viewer@example.com")
	restricted := w.restrictedFileSharedWith(t, "secret.docx", frameDocx(t, "secret"), viewerID, "view")
	res, out := doJSON(t, w.srv, "POST", "/api/v1/documents/"+restricted+"/office/frame-token", viewer, nil)
	if res.StatusCode != http.StatusCreated || out["ai"].(map[string]any)["uniwork_ai"] != true {
		t.Fatalf("shared viewer mint = %d %v, want 201 with uniwork_ai", res.StatusCode, out)
	}
	sharesPath := "/api/v1/documents/" + restricted + "/shares"
	sharesRes, access := doJSON(t, w.srv, "GET", sharesPath, w.token0(), nil)
	shares, ok := access["shares"].([]any)
	if !ok {
		t.Fatalf("list shares = %d %v, want a shares array", sharesRes.StatusCode, access)
	}
	revoked := false
	for _, it := range shares {
		share := it.(map[string]any)
		if share["principal_id"] == viewerID {
			if r, o := doJSON(t, w.srv, "DELETE", sharesPath+"/"+share["id"].(string), w.token0(), nil); r.StatusCode >= 300 {
				t.Fatalf("revoke share: %d %v", r.StatusCode, o)
			}
			revoked = true
		}
	}
	if !revoked {
		t.Fatalf("no share of the viewer in %v", access)
	}
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+restricted+"/office/frame-token", viewer, nil)
	if (res.StatusCode != http.StatusNotFound && res.StatusCode != http.StatusForbidden) || out["ai"] != nil {
		t.Fatalf("revoked viewer mint = %d %v, want a refusal without a grant", res.StatusCode, out)
	}
}

// An older desktop app still asks the session routes for the organization's
// stored keys and still posts to the key proxy: with a valid device session
// both answer 404, and no model is called and nothing is metered.
func TestOldDesktopKeyListIsNotFound(t *testing.T) {
	d, pool := newTestDeps(t, nil, discardOutbox{})
	q := db.New(pool)
	d.Cfg.DesktopAuthClientID = "uniwork-office"
	d.Cfg.DesktopAuthDeploymentIDs = []string{"default"}
	d.DesktopAuth = service.NewDesktopAuthService(pool, q, d.Minter, d.Cfg)
	model := &provider.Fake{}
	d.AICloud = service.NewAICloudService(d.Organizations, service.NewEntitlementService(pool, q), ai.NewGateway(q, model, nil, nil, ai.Options{}))
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)

	webToken, userID := filesRegister(t, srv, "old-desktop-keys@example.com")
	res, out := doJSON(t, srv, "POST", "/api/v1/orgs", webToken, map[string]string{"name": "Old Desktop Org", "slug": "old-desktop-org"})
	if res.StatusCode != 201 {
		t.Fatalf("create org: %d %v", res.StatusCode, out)
	}
	orgID := out["organization"].(map[string]any)["id"].(string)

	const deviceSessionID = "old-desktop-device-session"
	if _, err := q.CreateDeviceSession(context.Background(), db.CreateDeviceSessionParams{
		ID: deviceSessionID, UserID: userID, SessionFamilyID: "old-desktop-family",
		ClientID: "uniwork-office", DeploymentID: "default", DeviceLabel: "MacBook",
		Platform: "darwin", Build: "1.0.0", RefreshTokenDigest: "old-desktop-refresh-digest",
		ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(time.Hour), Valid: true}, CreatedByKind: "human",
	}); err != nil {
		t.Fatal(err)
	}
	deviceToken, err := d.Minter.MintSession(userID, deviceSessionID)
	if err != nil {
		t.Fatal(err)
	}
	// Control: the device bearer opens a live AI route, so the 404s below are
	// the missing routes, not a refused bearer.
	if code, body := rawCall(t, srv, "GET", "/api/v1/orgs/"+orgID+"/ai/cloud", deviceToken, ""); code != http.StatusOK {
		t.Fatalf("device bearer on the cloud status = %d %s, want 200", code, body)
	}

	for _, c := range []struct{ method, path, body string }{
		{"GET", "/api/v1/orgs/" + orgID + "/ai/credentials", ""},
		{"POST", "/api/v1/orgs/" + orgID + "/ai/byok/openai/chat/completions", `{"model":"gpt-4.1-mini","stream":true,"messages":[]}`},
	} {
		if code, body := rawCall(t, srv, c.method, c.path, deviceToken, c.body); code != http.StatusNotFound {
			t.Errorf("%s %s with a device session = %d %s, want 404", c.method, c.path, code, body)
		}
	}
	if model.Calls != 0 {
		t.Fatalf("the model was called %d times, want none", model.Calls)
	}
	var metered int
	if err := testPool.QueryRow(context.Background(), `SELECT count(*) FROM ai_usage_events WHERE organization_id = $1`, orgID).Scan(&metered); err != nil || metered != 0 {
		t.Fatalf("usage rows = %d (%v), want none", metered, err)
	}
}
