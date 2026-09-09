package middleware

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

func TestRequireFeatureFlagReturns404WhenDisabled(t *testing.T) {
	const flagKey = "agents_assignee"
	flag, ok := featureflags.Lookup(flagKey)
	if !ok {
		t.Fatalf("flag %q must be declared", flagKey)
	}

	provider := featureflag.NewStaticProvider()
	provider.Set(flagKey, featureflag.Rule{Default: false})
	svc := featureflag.NewService(provider)

	r := chi.NewRouter()
	r.With(RequireFeatureFlag(svc, flagKey)).Get("/api/v1/workspaces/{workspaceID}/agents", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/workspaces/ws_1/agents", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("json: %v body=%q", err, rec.Body.String())
	}
	errObj, _ := body["error"].(map[string]any)
	if errObj["code"] != "feature_disabled" {
		t.Fatalf("body = %#v, want feature_disabled (default=%v)", body, flag.Default)
	}

	provider.Set(flagKey, featureflag.Rule{Default: true})
	req2 := httptest.NewRequest(http.MethodGet, "/api/v1/workspaces/ws_1/agents", nil)
	rec2 := httptest.NewRecorder()
	r.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusOK {
		t.Fatalf("enabled status = %d, want 200", rec2.Code)
	}
}
