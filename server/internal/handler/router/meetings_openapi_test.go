package router

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/config"
)

// UNI-1995 access review: every read gated by authorizeAIContent tells API
// clients who may read it and the 403 it answers everyone else.
func TestAIContentReadsDescribeTheirGate(t *testing.T) {
	mux := New(Deps{Cfg: config.Config{FrontendOrigin: "http://localhost:3000", EnableSwagger: true}}, stubRoutes())
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/swagger/doc.json", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /swagger/doc.json = %d", rec.Code)
	}
	var spec struct {
		Paths map[string]map[string]struct {
			Description string `json:"description"`
		} `json:"paths"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &spec); err != nil {
		t.Fatal(err)
	}
	for _, op := range []struct{ method, path string }{
		{"get", "/meetings/{meetingID}/transcript"},
		{"get", "/meetings/{meetingID}/summary"},
		{"get", "/meetings/{meetingID}/evidence"},
		{"get", "/meetings/{meetingID}/speaker-labels"},
		{"get", "/meetings/{meetingID}/transcriptions"},
		{"post", "/meetings/{meetingID}/catch-up"},
	} {
		d := spec.Paths["/api/v1"+op.path][op.method].Description
		if !strings.Contains(d, "403 meeting_ai_restricted") || !strings.Contains(d, "ai-sharing") || strings.Contains(d, "Mọi thành viên workspace") {
			t.Errorf("%s %s description %q does not describe the AI-content gate", op.method, op.path, d)
		}
	}
}
