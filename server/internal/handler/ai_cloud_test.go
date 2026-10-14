package handler

// Handler-level tests for the UNI-1008 W3 Office cloud tools over the real
// router: every tool succeeds on the fake vendors and meters ai.tokens; a
// plan without office.ai_cloud refuses with 403 entitlement_required while
// the status still answers 200 enabled=false; exhausted credits answer 402
// credits_exhausted before the vendor is asked; an unconfigured tool answers
// 503 cloud_unavailable; an outsider is refused before any input check; and
// malformed or oversized bodies are 400/413.

import (
	"context"
	"encoding/base64"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/featureflags"
)

type aiCloudWorld struct {
	srv      *httptest.Server
	token    string
	orgID    string
	member   string
	memberID string
	outsider string
}

func setCloudEnv(t *testing.T, search, image, transcribe string) {
	t.Helper()
	t.Setenv("AI_PROVIDER", "fake")
	t.Setenv("AI_CLOUD_SEARCH_PROVIDER", search)
	t.Setenv("AI_CLOUD_IMAGE_PROVIDER", image)
	t.Setenv("AI_CLOUD_TRANSCRIBE_PROVIDER", transcribe)
	t.Setenv("AI_CLOUD_SEARCH_API_KEY", "")
	t.Setenv("AI_CLOUD_IMAGE_API_KEY", "")
	t.Setenv("AI_CLOUD_TRANSCRIBE_API_KEY", "")
}

func newAICloudWorld(t *testing.T, slug string) *aiCloudWorld {
	t.Helper()
	srv := newTestServer(t)
	w := &aiCloudWorld{srv: srv}
	w.token, _ = filesRegister(t, srv, slug+"-owner@example.com")
	res, out := doJSON(t, srv, "POST", "/api/v1/orgs", w.token, map[string]string{"name": "Cloud " + slug, "slug": slug})
	if res.StatusCode != 201 {
		t.Fatalf("create org: %d %v", res.StatusCode, out)
	}
	w.orgID = out["organization"].(map[string]any)["id"].(string)
	w.member, w.memberID = filesRegister(t, srv, slug+"-member@example.com")
	if _, err := testPool.Exec(context.Background(), `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'member')`, w.orgID, w.memberID); err != nil {
		t.Fatal(err)
	}
	w.outsider, _ = filesRegister(t, srv, slug+"-outsider@example.com")
	return w
}

func (w *aiCloudWorld) path(p string) string { return "/api/v1/orgs/" + w.orgID + "/ai/cloud" + p }

func (w *aiCloudWorld) override(t *testing.T, overrides string) {
	t.Helper()
	if _, err := testPool.Exec(context.Background(), `UPDATE subscriptions SET overrides = $2::jsonb WHERE organization_id = $1`, w.orgID, overrides); err != nil {
		t.Fatal(err)
	}
}

var cloudPNG = base64.StdEncoding.EncodeToString([]byte("\x89PNG\r\n\x1a\nfake"))

func cloudBodies() map[string]any {
	return map[string]any{
		"/search":        map[string]any{"query": "giá cà phê", "kind": "web", "max_results": 3},
		"/images":        map[string]any{"prompt": "văn phòng xanh", "aspect_ratio": "16:9"},
		"/media/analyze": map[string]any{"requirements": "mô tả ảnh", "media": []any{map[string]any{"mime": "image/png", "data_base64": cloudPNG}}},
		"/transcribe":    map[string]any{"audio": map[string]any{"mime": "audio/mpeg", "data_base64": base64.StdEncoding.EncodeToString(make([]byte, 2048))}},
	}
}

func (w *aiCloudWorld) used(t *testing.T) float64 {
	t.Helper()
	res, out := doJSON(t, w.srv, "GET", w.path(""), w.member, nil)
	if res.StatusCode != 200 {
		t.Fatalf("status: %d %v", res.StatusCode, out)
	}
	return out["credits"].(map[string]any)["used"].(float64)
}

func TestAICloudToolsSucceedOnFakeVendors(t *testing.T) {
	setCloudEnv(t, "fake", "fake", "fake")
	w := newAICloudWorld(t, "cloud-ok")

	res, out := doJSON(t, w.srv, "GET", w.path(""), w.member, nil)
	if res.StatusCode != 200 || out["enabled"] != true || out["reason"] != nil {
		t.Fatalf("status: %d %v", res.StatusCode, out)
	}
	tools := out["tools"].(map[string]any)
	for _, k := range []string{"web_search", "image_search", "image_generate", "media_analyze", "transcribe"} {
		if tools[k] != true {
			t.Fatalf("tool %s: %v", k, tools)
		}
	}
	credits := out["credits"].(map[string]any)
	if credits["unit"] != "ai.tokens" || credits["used"] != float64(0) || credits["limit"] == nil || credits["remaining"] != credits["limit"] {
		t.Fatalf("credits: %v", credits)
	}

	res, out = doJSON(t, w.srv, "POST", w.path("/search"), w.member, cloudBodies()["/search"])
	if res.StatusCode != 200 || len(out["results"].([]any)) != 3 || out["answer"] == "" {
		t.Fatalf("search: %d %v", res.StatusCode, out)
	}
	if got := w.used(t); got != 500 {
		t.Fatalf("search charged %v", got)
	}
	res, out = doJSON(t, w.srv, "POST", w.path("/search"), w.member, map[string]any{"query": "logo", "kind": "image"})
	if res.StatusCode != 200 || len(out["results"].([]any)) != 6 || out["results"].([]any)[0].(map[string]any)["image_url"] == "" {
		t.Fatalf("image search: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, w.srv, "POST", w.path("/images"), w.member, map[string]any{
		"prompt": "logo", "reference_images": []any{map[string]any{"mime": "image/png", "data_base64": cloudPNG}},
	})
	if res.StatusCode != 200 || out["model"] != "fake-image" {
		t.Fatalf("images: %d %v", res.StatusCode, out)
	}
	img := out["images"].([]any)[0].(map[string]any)
	if b, err := base64.StdEncoding.DecodeString(img["data_base64"].(string)); err != nil || len(b) == 0 || img["mime"] != "image/png" {
		t.Fatalf("image bytes: %v %v", img, err)
	}
	if got := w.used(t); got != 500+500+4000 {
		t.Fatalf("after image charged %v", got)
	}

	res, out = doJSON(t, w.srv, "POST", w.path("/media/analyze"), w.member, cloudBodies()["/media/analyze"])
	if res.StatusCode != 200 || out["text"] != "Phân tích thử nghiệm của 1 tệp." {
		t.Fatalf("analyze: %d %v", res.StatusCode, out)
	}
	before := w.used(t)
	res, out = doJSON(t, w.srv, "POST", w.path("/transcribe"), w.member, cloudBodies()["/transcribe"])
	if res.StatusCode != 200 || out["text"] != "Bản ghi thử nghiệm." {
		t.Fatalf("transcribe: %d %v", res.StatusCode, out)
	}
	if got := w.used(t) - before; got != 1000 {
		t.Fatalf("transcribe charged %v", got)
	}
}

func TestAICloudEntitlementCreditsAndAvailability(t *testing.T) {
	setCloudEnv(t, "fake", "", "fake")
	w := newAICloudWorld(t, "cloud-gate")

	// Image generation is not configured on this server.
	res, out := doJSON(t, w.srv, "GET", w.path(""), w.member, nil)
	if res.StatusCode != 200 || out["enabled"] != true || out["tools"].(map[string]any)["image_generate"] != false {
		t.Fatalf("status: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "POST", w.path("/images"), w.member, cloudBodies()["/images"])
	if code, _ := errCodeClass(out); res.StatusCode != 503 || code != "cloud_unavailable" {
		t.Fatalf("unconfigured images: %d %v", res.StatusCode, out)
	}

	// Credits below the call's token-equivalent: refused before the vendor,
	// nothing charged.
	w.override(t, `{"ai.tokens": 100}`)
	for _, p := range []string{"/search", "/transcribe"} {
		res, out = doJSON(t, w.srv, "POST", w.path(p), w.member, cloudBodies()[p])
		if code, _ := errCodeClass(out); res.StatusCode != 402 || code != "credits_exhausted" {
			t.Fatalf("%s over credits: %d %v", p, res.StatusCode, out)
		}
	}
	res, out = doJSON(t, w.srv, "GET", w.path(""), w.member, nil)
	if c := out["credits"].(map[string]any); res.StatusCode != 200 || c["limit"] != float64(100) || c["remaining"] != float64(100) || c["used"] != float64(0) {
		t.Fatalf("credits after refusals: %v", c)
	}

	// The plan without office.ai_cloud: status explains, tools refuse 403.
	w.override(t, `{"office.ai_cloud": false}`)
	res, out = doJSON(t, w.srv, "GET", w.path(""), w.member, nil)
	if res.StatusCode != 200 || out["enabled"] != false || out["reason"] != "entitlement_required" || out["tools"].(map[string]any)["web_search"] != false {
		t.Fatalf("status not entitled: %d %v", res.StatusCode, out)
	}
	for p, body := range cloudBodies() {
		res, out = doJSON(t, w.srv, "POST", w.path(p), w.member, body)
		if code, _ := errCodeClass(out); res.StatusCode != 403 || code != "entitlement_required" {
			t.Fatalf("%s not entitled: %d %v", p, res.StatusCode, out)
		}
	}
}

func TestAICloudRefusesOutsiderBeforeInput(t *testing.T) {
	setCloudEnv(t, "fake", "fake", "fake")
	w := newAICloudWorld(t, "cloud-iso")
	res, out := doJSON(t, w.srv, "GET", w.path(""), w.outsider, nil)
	if res.StatusCode != 403 && res.StatusCode != 404 {
		t.Fatalf("outsider status: %d %v", res.StatusCode, out)
	}
	for p := range cloudBodies() {
		// An empty body would be a 400 for a member; the outsider never gets
		// that far.
		res, out = doJSON(t, w.srv, "POST", w.path(p), w.outsider, map[string]any{})
		if res.StatusCode != 403 && res.StatusCode != 404 {
			t.Fatalf("outsider %s: %d %v", p, res.StatusCode, out)
		}
	}
	res, _ = doJSON(t, w.srv, "POST", w.path("/search"), "", cloudBodies()["/search"])
	if res.StatusCode != 401 {
		t.Fatalf("no session: %d", res.StatusCode)
	}
}

func TestAICloudRejectsMalformedBodies(t *testing.T) {
	setCloudEnv(t, "fake", "fake", "fake")
	w := newAICloudWorld(t, "cloud-bad")
	big := strings.Repeat("A", 4*((9<<20)/3+1)) // > 8 MiB decoded
	cases := []struct {
		path string
		body any
	}{
		{"/search", map[string]any{"query": ""}},
		{"/search", map[string]any{"query": strings.Repeat("x", 401)}},
		{"/search", map[string]any{"query": "q", "kind": "video"}},
		{"/search", map[string]any{"query": "q", "max_results": 11}},
		{"/images", map[string]any{"prompt": ""}},
		{"/images", map[string]any{"prompt": "p", "reference_images": []any{
			map[string]any{"mime": "image/png", "data_base64": cloudPNG}, map[string]any{"mime": "image/png", "data_base64": cloudPNG},
			map[string]any{"mime": "image/png", "data_base64": cloudPNG}, map[string]any{"mime": "image/png", "data_base64": cloudPNG},
			map[string]any{"mime": "image/png", "data_base64": cloudPNG}}}},
		{"/images", map[string]any{"prompt": "p", "reference_images": []any{map[string]any{"mime": "image/gif", "data_base64": cloudPNG}}}},
		{"/images", map[string]any{"prompt": "p", "reference_images": []any{map[string]any{"mime": "image/png", "data_base64": big}}}},
		{"/media/analyze", map[string]any{"requirements": "r", "media": []any{}}},
		{"/media/analyze", map[string]any{"requirements": "", "media": []any{map[string]any{"mime": "image/png", "data_base64": cloudPNG}}}},
		{"/media/analyze", map[string]any{"requirements": "r", "media": []any{map[string]any{"mime": "image/png", "data_base64": "%%%"}}}},
		{"/transcribe", map[string]any{"audio": map[string]any{"mime": "text/plain", "data_base64": cloudPNG}}},
		{"/transcribe", map[string]any{"audio": map[string]any{"mime": "audio/mpeg", "data_base64": ""}}},
	}
	for i, c := range cases {
		res, out := doJSON(t, w.srv, "POST", w.path(c.path), w.member, c.body)
		if res.StatusCode != 400 {
			t.Errorf("case %d %s: %d %v", i, c.path, res.StatusCode, out)
		}
	}
	status, _ := rawCall(t, w.srv, "POST", w.path("/search"), w.member, "{not json")
	if status != 400 {
		t.Fatalf("invalid json: %d", status)
	}
	status, _ = rawCall(t, w.srv, "POST", w.path("/search"), w.member, `{"query":"`+strings.Repeat("x", 1<<20)+`"}`)
	if status != 413 {
		t.Fatalf("search body over 1 MiB: %d", status)
	}
	if got := w.used(t); got != 0 {
		t.Fatalf("refused calls charged %v", got)
	}
}

// statusOf is the member's GET .../ai/cloud answer.
func (w *aiCloudWorld) statusOf(t *testing.T, token string) map[string]any {
	t.Helper()
	res, out := doJSON(t, w.srv, "GET", w.path(""), token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("status: %d %v", res.StatusCode, out)
	}
	return out
}

func chatOf(out map[string]any) any { return out["tools"].(map[string]any)["chat"] }

// G6-03c: tools.chat is on only for an entitled member while UniWork AI is
// configured and office_ai_uniwork is on for the caller, with the override
// order user > organization > global; spent credits show as reason
// credits_exhausted with enabled kept and chat unchanged.
func TestAICloudStatusChatFollowsEntitlementFlagsAndCredits(t *testing.T) {
	setCloudEnv(t, "fake", "fake", "fake")
	w := newAICloudWorld(t, "cloud-chat")
	if got := chatOf(w.statusOf(t, w.member)); got != false {
		t.Fatalf("flag off: chat=%v, want false", got)
	}
	setFlagOverride(t, "office_ai_uniwork", featureflags.ScopeGlobal, "", true)
	if got := chatOf(w.statusOf(t, w.member)); got != true {
		t.Fatalf("flag on globally: chat=%v, want true", got)
	}
	setFlagOverride(t, "office_ai_uniwork", featureflags.ScopeOrganization, w.orgID, false)
	if got := chatOf(w.statusOf(t, w.member)); got != false {
		t.Fatalf("flag off for the organization: chat=%v, want false", got)
	}
	setFlagOverride(t, "office_ai_uniwork", featureflags.ScopeUser, w.memberID, true)
	if a, b := chatOf(w.statusOf(t, w.member)), chatOf(w.statusOf(t, w.token)); a != true || b != false {
		t.Fatalf("flag on for the member only: member chat=%v owner chat=%v, want true false", a, b)
	}

	w.override(t, `{"ai.tokens": 0}`)
	out := w.statusOf(t, w.member)
	if out["enabled"] != true || out["reason"] != "credits_exhausted" || chatOf(out) != true || out["credits"].(map[string]any)["remaining"] != float64(0) {
		t.Fatalf("credits spent: %v, want enabled, reason credits_exhausted, chat true, remaining 0", out)
	}

	w.override(t, `{"office.ai_cloud": false}`)
	out = w.statusOf(t, w.member)
	if out["enabled"] != false || out["reason"] != "entitlement_required" || chatOf(out) != false {
		t.Fatalf("no office.ai_cloud: %v, want disabled, entitlement_required, chat false", out)
	}
}

// With no AI provider the gateway is off: chat stays false with the flag on,
// and the cloud tools that need no completion still answer.
func TestAICloudStatusChatNeedsTheGateway(t *testing.T) {
	setCloudEnv(t, "fake", "", "")
	t.Setenv("AI_PROVIDER", "")
	t.Setenv("ANTHROPIC_API_KEY", "")
	t.Setenv("OPENAI_API_KEY", "")
	t.Setenv("OLLAMA_BASE_URL", "")
	w := newAICloudWorld(t, "cloud-nochat")
	setFlagOverride(t, "office_ai_uniwork", featureflags.ScopeGlobal, "", true)
	out := w.statusOf(t, w.member)
	if chatOf(out) != false || out["tools"].(map[string]any)["web_search"] != true || out["enabled"] != true {
		t.Fatalf("gateway off: %v, want chat false with web_search on", out)
	}
	if got := out["uniwork_model"]; got != "" {
		t.Fatalf("gateway off: uniwork_model=%v, want \"\"", got)
	}
}

// G6-05m: the status carries the model the Gateway serves for UniWork AI in
// Office. It is the policy model while UniWork AI is on for the caller, an
// allowlisted AI_MODEL_OFFICE_UNIWORK_AI override wins over it, an override
// outside the allowlist leaves the default, and it is "" while UniWork AI is
// off or the plan has no office.ai_cloud.
func TestAICloudStatusCarriesTheUniworkModel(t *testing.T) {
	setCloudEnv(t, "fake", "fake", "fake")
	w := newAICloudWorld(t, "cloud-model")

	if got := w.statusOf(t, w.member)["uniwork_model"]; got != "" {
		t.Fatalf("UniWork AI off: uniwork_model=%v, want \"\"", got)
	}
	setFlagOverride(t, "office_ai_uniwork", featureflags.ScopeGlobal, "", true)
	// The fake provider's office_uniwork_ai policy model is "fake".
	if got := w.statusOf(t, w.member)["uniwork_model"]; got != "fake" {
		t.Fatalf("policy model: uniwork_model=%v, want fake", got)
	}
	t.Setenv("AI_MODEL_OFFICE_UNIWORK_AI", "claude-sonnet-5")
	if got := w.statusOf(t, w.member)["uniwork_model"]; got != "claude-sonnet-5" {
		t.Fatalf("allowlisted override: uniwork_model=%v, want claude-sonnet-5", got)
	}
	t.Setenv("AI_MODEL_OFFICE_UNIWORK_AI", "dev-model")
	if got := w.statusOf(t, w.member)["uniwork_model"]; got != "fake" {
		t.Fatalf("override outside the allowlist: uniwork_model=%v, want the default fake", got)
	}

	// G05MBE-1: the status resolves the model once, so a typo in .env warns
	// once per status call, not twice.
	var logs strings.Builder
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	defer slog.SetDefault(prev)
	w.statusOf(t, w.member)
	if got := strings.Count(logs.String(), "outside allowlist"); got != 1 {
		t.Fatalf("out-of-allowlist override warned %d times in one status call, want 1: %q", got, logs.String())
	}

	// A plan without office.ai_cloud never gets the model, whatever the flag
	// (still on globally) says: the entitlement gate runs first.
	w.override(t, `{"office.ai_cloud": false}`)
	out := w.statusOf(t, w.member)
	if out["enabled"] != false || out["reason"] != "entitlement_required" || out["uniwork_model"] != "" {
		t.Fatalf("not entitled: %v, want disabled, reason entitlement_required, uniwork_model \"\"", out)
	}
}
