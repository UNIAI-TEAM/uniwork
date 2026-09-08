package router

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/config"
)

type catalogueFile struct {
	Routes []struct {
		Method      string `json:"method"`
		TargetPath  string `json:"target_path"`
		Group       string `json:"group"`
		Disposition string `json:"disposition"`
	} `json:"routes"`
}

func loadSlice2Catalogue(t *testing.T) catalogueFile {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	// server/internal/handler/router → repo root
	root := filepath.Clean(filepath.Join(filepath.Dir(file), "..", "..", "..", ".."))
	raw, err := os.ReadFile(filepath.Join(root, "docs/parity/tasks-api-client-core-routes.json"))
	if err != nil {
		t.Fatal(err)
	}
	var cat catalogueFile
	if err := json.Unmarshal(raw, &cat); err != nil {
		t.Fatal(err)
	}
	if len(cat.Routes) == 0 {
		t.Fatal("catalogue has no routes")
	}
	return cat
}

func TestAllCatalogueRoutesAreRegistered(t *testing.T) {
	cat := loadSlice2Catalogue(t)
	cfg := config.Config{FrontendOrigin: "http://localhost:3000", EnableSwagger: true, AdminRateLimitPerMin: 60}
	mux := New(Deps{Cfg: cfg, PlatformRoles: fakeRoles{}}, stubRoutes())

	bound := map[string]bool{}
	err := chi.Walk(mux.(chi.Routes), func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		bound[method+" "+strings.TrimSuffix(route, "/")] = true
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	var missing []string
	for _, r := range cat.Routes {
		key := r.Method + " " + r.TargetPath
		if !bound[key] {
			missing = append(missing, key)
		}
	}
	if len(missing) > 0 {
		t.Fatalf("catalogue routes not registered on Chi (%d):\n  %s", len(missing), strings.Join(missing, "\n  "))
	}
}

// TestSuiteCatalogueRoutesCarryFeatureFlagMiddleware proves every non-MVP
// catalogue path is mounted under RequireFeatureFlag by checking the Chi
// middleware chain length (suite Group adds the flag gate; MVP tasks do not).
func TestSuiteCatalogueRoutesCarryFeatureFlagMiddleware(t *testing.T) {
	cat := loadSlice2Catalogue(t)
	cfg := config.Config{FrontendOrigin: "http://localhost:3000", AdminRateLimitPerMin: 60}
	mux := New(Deps{Cfg: cfg, PlatformRoles: fakeRoles{}}, stubRoutes())

	mvp := map[string]bool{
		"GET /api/v1/workspaces/{workspaceID}/tasks":  true,
		"POST /api/v1/workspaces/{workspaceID}/tasks": true,
		"GET /api/v1/tasks/{taskID}":                  true,
		"PATCH /api/v1/tasks/{taskID}":                true,
		"DELETE /api/v1/tasks/{taskID}":               true,
		"GET /api/v1/tasks/{taskID}/comments":         true,
		"POST /api/v1/tasks/{taskID}/comments":        true,
	}

	mwCount := map[string]int{}
	err := chi.Walk(mux.(chi.Routes), func(method, route string, _ http.Handler, mws ...func(http.Handler) http.Handler) error {
		mwCount[method+" "+strings.TrimSuffix(route, "/")] = len(mws)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	mvpCount, ok := mwCount["GET /api/v1/tasks/{taskID}"]
	if !ok {
		t.Fatal("MVP GET task route missing")
	}
	var ungated []string
	for _, r := range cat.Routes {
		key := r.Method + " " + r.TargetPath
		if mvp[key] {
			continue
		}
		n, ok := mwCount[key]
		if !ok {
			ungated = append(ungated, key+" (unregistered)")
			continue
		}
		// Suite group adds RequireFeatureFlag on top of the authed stack.
		if n <= mvpCount {
			ungated = append(ungated, key)
		}
	}
	if len(ungated) > 0 {
		t.Fatalf("suite catalogue routes missing feature-flag middleware (%d):\n  %s", len(ungated), strings.Join(ungated, "\n  "))
	}
}
