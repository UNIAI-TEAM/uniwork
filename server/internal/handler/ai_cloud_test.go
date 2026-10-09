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
	"net/http/httptest"
	"strings"
	"testing"
)

type aiCloudWorld struct {
	srv      *httptest.Server
	token    string
	orgID    string
	member   string
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
	var memberID string
	w.member, memberID = filesRegister(t, srv, slug+"-member@example.com")
	if _, err := testPool.Exec(context.Background(), `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'member')`, w.orgID, memberID); err != nil {
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
