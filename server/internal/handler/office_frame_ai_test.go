package handler

// Handler-level tests for GO-A7's AI routes on the web Office frame token
// (UNI-1014, CONTRACT C16, ADR 0029 D9) over the real router: every route
// answers through the frame token; the token's document must be the path's,
// a session token or another organization's token is refused, view access is
// rechecked on every call, entitlement and the module flag gate as on the
// session routes, the BYOK stream passes through byte for byte, and the frame
// token answer carries the AI grant the host may give the frame.

import (
	"context"
	"crypto/tls"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const frameAIKey = "sk-frame-ai-0123456789wxyz"

// frameAISSE is what the fake vendor streams; the frame must get it unchanged.
const frameAISSE = "data: {\"choices\":[{\"delta\":{\"content\":\"Xin chào\"}}]}\n\ndata: [DONE]\n\n"

type frameAIPublicResolver struct{}

func (frameAIPublicResolver) LookupIPAddr(context.Context, string) ([]net.IPAddr, error) {
	return []net.IPAddr{{IP: net.ParseIP("93.184.216.34")}}, nil
}

// frameAIWorld is an office world whose BYOK proxy reaches a fake TLS vendor
// (through the production address guard) and whose cloud tools are fakes.
type frameAIWorld struct {
	*officeWorld
	docID string
	token string
	// vendorAuth is the Authorization header the vendor last saw.
	vendorAuth string
}

func newFrameAIWorld(t *testing.T) *frameAIWorld {
	t.Helper()
	setCloudEnv(t, "fake", "fake", "fake")
	fw := &frameAIWorld{}
	vendor := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fw.vendorAuth = r.Header.Get("Authorization")
		if r.Method == http.MethodGet {
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"data":[{"id":"gpt-frame"}]}`)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, frameAISSE)
	}))
	t.Cleanup(vendor.Close)
	target := vendor.Listener.Addr().String()
	tweak := func(d *Deps, pool *pgxpool.Pool) {
		q := db.New(pool)
		gw := ai.NewGateway(q, nil, nil, nil, ai.Options{})
		gw.SetBYOKClient(provider.NewBYOKClient(provider.BYOKClientOptions{
			Resolver: frameAIPublicResolver{},
			// The httptest certificate does not name the vendor host; the
			// address guard still runs before this dial.
			TLSConfig: &tls.Config{InsecureSkipVerify: true}, //nolint:gosec // test vendor
			Dial: func(ctx context.Context, network, _ string) (net.Conn, error) {
				var dl net.Dialer
				return dl.DialContext(ctx, network, target)
			},
		}))
		d.AIBYOK = service.NewAIBYOKService(d.Organizations, service.NewEntitlementService(pool, q), d.AICredentials, gw)
	}
	fw.officeWorld = newOfficeWorldTweaked(t, true, func(*filesfake.Fake) service.OfficeEngine { return newHandlerStubEngine(t) }, tweak)
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
	{"GET", "/credentials", ""},
	{"PUT", "/credentials/openai", `{"api_key":"` + frameAIKey + `"}`},
	{"DELETE", "/credentials/openai", ""},
	{"POST", "/byok/openai/chat/completions", `{"model":"gpt-frame","stream":true,"messages":[]}`},
	{"POST", "/byok/anthropic/messages", `{"model":"claude","messages":[]}`},
	{"POST", "/byok/gemini/generate", `{"model":"gemini","request":{}}`},
	{"GET", "/byok/openai/models", ""},
	{"GET", "/cloud", ""},
	{"POST", "/cloud/search", `{"query":"giá cà phê","kind":"web","max_results":3}`},
	{"POST", "/cloud/images", `{"prompt":"văn phòng xanh","aspect_ratio":"16:9"}`},
	{"POST", "/cloud/media/analyze", `{"requirements":"mô tả ảnh","media":[{"mime":"image/png","data_base64":"` + cloudPNG + `"}]}`},
	{"POST", "/cloud/transcribe", `{"audio":{"mime":"audio/mpeg","data_base64":"AAAA"}}`},
}

// The whole round trip on the frame token alone: a key saved through the
// frame is the person's organization key (the session route lists it), the
// BYOK stream and model list pass through unchanged with the stored key
// attached server-side, the cloud tools answer, and the delete removes it.
func TestOfficeFrameAIHappyPath(t *testing.T) {
	w := newFrameAIWorld(t)

	code, body := rawCall(t, w.srv, "PUT", w.path(w.docID, "/credentials/openai"), w.token, `{"api_key":"`+frameAIKey+`","label":"frame key"}`)
	if code != http.StatusCreated || strings.Contains(body, frameAIKey) || !strings.Contains(body, `"key_hint":"…wxyz"`) {
		t.Fatalf("save through the frame = %d %s", code, body)
	}
	code, body = rawCall(t, w.srv, "GET", w.path(w.docID, "/credentials"), w.token, "")
	if code != http.StatusOK || !strings.Contains(body, `"provider":"openai"`) || strings.Contains(body, frameAIKey) {
		t.Fatalf("list through the frame = %d %s", code, body)
	}
	code, body = rawCall(t, w.srv, "GET", "/api/v1/orgs/"+w.orgID+"/ai/credentials", w.token0(), "")
	if code != http.StatusOK || !strings.Contains(body, `"label":"frame key"`) {
		t.Fatalf("the session route sees the frame's key: %d %s", code, body)
	}
	var audited int
	if err := testPool.QueryRow(context.Background(), `SELECT count(*) FROM audit_events WHERE organization_id = $1 AND action = 'ai.credential.saved'`, w.orgID).Scan(&audited); err != nil || audited != 1 {
		t.Fatalf("credential save audited %d times (%v), want 1", audited, err)
	}

	req, _ := http.NewRequest("POST", w.srv.URL+w.path(w.docID, "/byok/openai/chat/completions"), strings.NewReader(`{"model":"gpt-frame","stream":true,"messages":[]}`))
	req.Header.Set("Authorization", "Bearer "+w.token)
	req.Header.Set("Content-Type", "application/json")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := io.ReadAll(res.Body)
	_ = res.Body.Close()
	if res.StatusCode != http.StatusOK || string(raw) != frameAISSE || !strings.HasPrefix(res.Header.Get("Content-Type"), "text/event-stream") {
		t.Fatalf("stream = %d %q %q", res.StatusCode, res.Header.Get("Content-Type"), raw)
	}
	if w.vendorAuth != "Bearer "+frameAIKey {
		t.Fatalf("vendor saw Authorization %q, want the stored key", w.vendorAuth)
	}
	code, body = rawCall(t, w.srv, "GET", w.path(w.docID, "/byok/openai/models"), w.token, "")
	if code != http.StatusOK || !strings.Contains(body, "gpt-frame") {
		t.Fatalf("models = %d %s", code, body)
	}

	code, body = rawCall(t, w.srv, "GET", w.path(w.docID, "/cloud"), w.token, "")
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

	if code, body := rawCall(t, w.srv, "DELETE", w.path(w.docID, "/credentials/openai"), w.token, ""); code != http.StatusNoContent {
		t.Fatalf("delete through the frame = %d %s", code, body)
	}
	if code, body := rawCall(t, w.srv, "POST", w.path(w.docID, "/byok/openai/chat/completions"), w.token, `{"model":"m"}`); code != http.StatusNotFound || !strings.Contains(body, "credential_missing") {
		t.Fatalf("proxy after delete = %d %s", code, body)
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

	// A document in another organization the same owner holds.
	res, out := doJSON(t, w.srv, "POST", "/api/v1/orgs", w.token0(), map[string]string{"name": "Other Org", "slug": "frame-ai-other"})
	if res.StatusCode != 201 {
		t.Fatalf("create org: %d %v", res.StatusCode, out)
	}
	org2 := out["organization"].(map[string]any)["id"].(string)
	res, out = doJSON(t, w.srv, "POST", "/api/v1/orgs/"+org2+"/workspaces", w.token0(), map[string]string{"name": "Other WS", "slug": "frame-ai-other-ws"})
	if res.StatusCode != 201 {
		t.Fatalf("create ws: %d %v", res.StatusCode, out)
	}
	other := &officeWorld{srv: w.srv, q: w.q, token: w.token0(), wsID: out["workspace"].(map[string]any)["id"].(string)}
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
// office.ai_byok a key cannot be saved and the proxy refuses (list and delete
// stay open); without office.ai_cloud the tools refuse and the status says why.
func TestOfficeFrameAIEntitlementRequired(t *testing.T) {
	w := newFrameAIWorld(t)
	w.override(t, `{"office.ai_byok": false, "office.ai_cloud": false}`)
	for _, rt := range frameAIRoutes {
		code, body := rawCall(t, w.srv, rt.method, w.path(w.docID, rt.rest), w.token, rt.body)
		switch {
		case rt.rest == "/credentials":
			if code != http.StatusOK {
				t.Errorf("list without the plan = %d %s", code, body)
			}
		case rt.method == "DELETE":
			if code != http.StatusNotFound || !strings.Contains(body, "credential_missing") {
				t.Errorf("delete without the plan = %d %s", code, body)
			}
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

// The frame token answer carries the AI grant: all on with both plan keys and
// the fake cloud tools; the cloud keys off without office.ai_cloud; all off
// without office.ai_byok, since the cloud tools only count with `ai`.
func TestOfficeFrameTokenCarriesTheAIGrant(t *testing.T) {
	w := newFrameAIWorld(t)
	grant := func() map[string]any {
		t.Helper()
		return w.mintFrameToken(t, w.docID)["ai"].(map[string]any)
	}
	want := func(name string, got map[string]any, ai, cloud bool) {
		t.Helper()
		if got["ai"] != ai || got["web_search"] != cloud || got["image_search"] != cloud || got["image_generation"] != cloud {
			t.Errorf("%s: grant %v, want ai=%v cloud=%v", name, got, ai, cloud)
		}
	}
	want("full plan", grant(), true, true)
	w.override(t, `{"office.ai_cloud": false}`)
	want("no office.ai_cloud", grant(), true, false)
	w.override(t, `{"office.ai_byok": false}`)
	want("no office.ai_byok", grant(), false, false)
}
