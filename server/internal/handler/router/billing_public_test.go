package router

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/config"
)

func TestPublicPlanCatalogKeepsSubscriptionPrivate(t *testing.T) {
	mux := New(Deps{Cfg: config.Config{FrontendOrigin: "http://localhost:3000", EnableSwagger: true}}, stubRoutes())
	for _, tc := range []struct {
		path string
		want int
	}{
		{"/api/v1/plans", http.StatusOK},
		{"/api/v1/orgs/org1/billing", http.StatusUnauthorized},
		{"/api/v1/orgs/org1/billing/invoices", http.StatusUnauthorized},
	} {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, tc.path, nil))
		if rec.Code != tc.want {
			t.Fatalf("anonymous GET %s = %d, want %d", tc.path, rec.Code, tc.want)
		}
		if tc.want == http.StatusOK && rec.Body.String() != "ListPlans" {
			t.Fatalf("catalog bound to wrong handler: %s", rec.Body.String())
		}
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/swagger/doc.json", nil))
	var spec struct {
		Paths map[string]map[string]struct {
			Security []map[string][]string `json:"security"`
		} `json:"paths"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &spec); err != nil {
		t.Fatal(err)
	}
	if len(spec.Paths["/api/v1/plans"]["get"].Security) != 0 {
		t.Fatal("public catalog must not require Bearer in OpenAPI")
	}
	if len(spec.Paths["/api/v1/orgs/{orgID}/billing"]["get"].Security) == 0 {
		t.Fatal("subscription must still require Bearer in OpenAPI")
	}
}
