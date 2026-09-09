package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/workcapability"
)

// GET /api/v1/config publishes work-management capabilities (stubs stay
// unavailable) and no longer lists the removed parity flag.
func TestConfigPublishesWorkManagementCapabilities(t *testing.T) {
	h := New(Deps{Cfg: config.Config{FrontendOrigin: "http://localhost:3000"}, Log: slog.Default()})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/config", nil)
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	var out struct {
		Flags                      map[string]bool                 `json:"flags"`
		WorkManagementCapabilities map[string]workcapability.Entry `json:"work_management_capabilities"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if _, ok := out.Flags["tasks_work_management_parity"]; ok {
		t.Fatal("tasks_work_management_parity must not appear in public flags")
	}
	agents, ok := out.Flags["agents_assignee"]
	if !ok || agents {
		t.Fatalf("agents_assignee = %v present=%v, want false", agents, ok)
	}
	want := workcapability.Catalogue()
	if len(out.WorkManagementCapabilities) != len(want) {
		t.Fatalf("capabilities = %d, want %d", len(out.WorkManagementCapabilities), len(want))
	}
	for key, entry := range want {
		got, ok := out.WorkManagementCapabilities[key]
		if !ok || got != entry {
			t.Fatalf("%s = %+v, want %+v", key, got, entry)
		}
	}
}
