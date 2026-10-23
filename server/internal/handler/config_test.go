package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/workcapability"
)

// GET /api/v1/config publishes work-management capabilities (stubs stay
// unavailable) and no longer lists the removed parity flag.
func TestConfigPublishesWorkManagementCapabilities(t *testing.T) {
	h := New(Deps{Cfg: config.Config{
		FrontendOrigin:           "http://localhost:3000",
		APIPublicURL:             "https://api.example.test/",
		OfficeInstallerDevURL:    "https://downloads.test/dev.exe",
		OfficeInstallerBetaURL:   "https://downloads.test/beta.exe",
		OfficeInstallerStableURL: "",
	}, Log: slog.Default()})
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/config", nil)
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	var out struct {
		Flags                      map[string]bool                 `json:"flags"`
		WorkManagementCapabilities map[string]workcapability.Entry `json:"work_management_capabilities"`
		OfficeInstallerURLs        struct {
			Dev    string `json:"dev"`
			Beta   string `json:"beta"`
			Stable string `json:"stable"`
		} `json:"office_installer_urls"`
		OfficeDeploymentID string `json:"office_deployment_id"`
		OfficeAPIOrigin    string `json:"office_api_origin"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	// Reconstruct without embedding the full identifier — scripts/tasks-parity-flag-gone.test.mjs scans for it.
	removedParityFlag := strings.Join([]string{"tasks", "work", "management", "parity"}, "_")
	if _, ok := out.Flags[removedParityFlag]; ok {
		t.Fatal("removed suite parity flag must not appear in public flags")
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
	if out.OfficeInstallerURLs.Dev != "https://downloads.test/dev.exe" || out.OfficeInstallerURLs.Beta != "https://downloads.test/beta.exe" || out.OfficeInstallerURLs.Stable != "" {
		t.Fatalf("installer URLs = %+v, want configured per-channel values", out.OfficeInstallerURLs)
	}
	if out.OfficeDeploymentID != "default" {
		t.Fatalf("office deployment id = %q, want default fallback", out.OfficeDeploymentID)
	}
	if out.OfficeAPIOrigin != "https://api.example.test" {
		t.Fatalf("office api origin = %q, want the bare public origin", out.OfficeAPIOrigin)
	}
}

func TestOfficeAPIOriginOnlyBareOrigins(t *testing.T) {
	for raw, want := range map[string]string{
		"https://api.example.test":      "https://api.example.test",
		"http://localhost:8080/":        "http://localhost:8080",
		"https://api.example.test/v1":   "",
		"https://u:p@api.example.test":  "",
		"https://api.example.test/?x=1": "",
		"ftp://api.example.test":        "",
		"":                              "",
	} {
		if got := officeAPIOrigin(raw); got != want {
			t.Errorf("officeAPIOrigin(%q) = %q, want %q", raw, got, want)
		}
	}
}

func TestConfigPublishesOfficeInstallers(t *testing.T) {
	for _, tc := range []struct {
		name string
		cfg  config.Config
		want map[string][]config.OfficeInstaller
	}{
		{
			name: "channel maps and legacy Windows",
			cfg: config.Config{
				OfficeInstallerDevURL:   "https://downloads.test/legacy.exe",
				OfficeInstallerDevURLs:  `{"linux-x64-deb":"https://downloads.test/dev.deb"}`,
				OfficeInstallerBetaURLs: `{"darwin-x64":"https://downloads.test/beta.dmg"}`,
			},
			want: map[string][]config.OfficeInstaller{
				"dev":    {{Platform: "win32-x64", URL: "https://downloads.test/legacy.exe", Kind: ".exe"}, {Platform: "linux-x64-deb", URL: "https://downloads.test/dev.deb", Kind: ".deb"}},
				"beta":   {{Platform: "darwin-x64", URL: "https://downloads.test/beta.dmg", Kind: ".dmg"}},
				"stable": {},
			},
		},
		{
			name: "invalid map is empty without channel inheritance",
			cfg: config.Config{
				OfficeInstallerDevURLs:    `{"win32-x64":"https://downloads.test/dev.exe"}`,
				OfficeInstallerStableURLs: `{"win32-x64":"javascript:alert(1)"}`,
			},
			want: map[string][]config.OfficeInstaller{
				"dev":  {{Platform: "win32-x64", URL: "https://downloads.test/dev.exe", Kind: ".exe"}},
				"beta": {}, "stable": {},
			},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := New(Deps{Cfg: tc.cfg, Log: slog.Default()})
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/config", nil))
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d", rec.Code)
			}
			var out struct {
				Installers map[string][]config.OfficeInstaller `json:"office_installers"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
				t.Fatal(err)
			}
			for channel, want := range tc.want {
				got, present := out.Installers[channel]
				if !present || got == nil || len(got) != len(want) {
					t.Fatalf("%s = %+v, want non-null array %+v", channel, got, want)
				}
				for i, item := range want {
					if got[i] != item {
						t.Fatalf("%s[%d] = %+v, want %+v", channel, i, got[i], item)
					}
				}
			}
		})
	}
}

// The per-channel maps the installer workflow emits come back from
// GET /api/v1/config as office_installers, links and unsigned labels intact.
func TestConfigPublishesCIJobInstallerURLs(t *testing.T) {
	base := "https://github.com/unicomhub/uniwork/releases/download/office-desktop-v0.1.0-dev.7/"
	h := New(Deps{Cfg: config.Config{
		OfficeInstallerDevURLs: `{"win32-x64":"` + base + `uniwork-office-test_0.1.0-dev.7_unsigned_win32_x64-setup.exe","linux-x64-deb":"` + base + `uniwork-office-test_0.1.0-dev.7_unsigned_linux_x64.deb"}`,
	}, Log: slog.Default()})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/config", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	var out struct {
		Installers map[string][]config.OfficeInstaller `json:"office_installers"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	dev := out.Installers["dev"]
	if len(dev) != 2 || dev[0].Platform != "win32-x64" || dev[1].Platform != "linux-x64-deb" || !dev[0].Unsigned || !dev[1].Unsigned || dev[1].Version != "0.1.0-dev.7" || !strings.HasPrefix(dev[0].URL, base) {
		t.Fatalf("dev installers = %+v", dev)
	}
	if len(out.Installers["beta"]) != 0 || len(out.Installers["stable"]) != 0 {
		t.Fatalf("beta/stable must stay empty: %+v", out.Installers)
	}
}

func TestConfigPublishesDocumentLimits(t *testing.T) {
	for _, tc := range []struct {
		name    string
		cfg     config.Config
		wantMax int64
	}{
		{"default 200 MiB", config.Config{}, 209715200},
		{"configured 100 MiB", config.Config{DocumentMaxBytes: 100 << 20}, 100 << 20},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := New(Deps{Cfg: tc.cfg, Log: slog.Default()})
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/config", nil))
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d", rec.Code)
			}
			var raw map[string]any
			if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
				t.Fatal(err)
			}
			docsObj, ok := raw["documents"].(map[string]any)
			if !ok {
				t.Fatalf("documents missing from /api/v1/config: %v", raw)
			}
			limits, ok := docsObj["limits"].(map[string]any)
			if !ok {
				t.Fatalf("documents.limits missing: %v", docsObj)
			}
			if _, exists := limits["chunked_upload_threshold_bytes"]; exists {
				t.Fatalf("chunked_upload_threshold_bytes must not be present: %v", limits)
			}
			if got := int64(limits["upload_max_bytes"].(float64)); got != tc.wantMax {
				t.Fatalf("upload_max_bytes = %d, want %d", got, tc.wantMax)
			}
			if got := limits["save_warn_ratio"].(float64); got != 0.9 {
				t.Fatalf("save_warn_ratio = %v, want 0.9", got)
			}
			webOpen, ok := limits["web_open"].(map[string]any)
			if !ok {
				t.Fatalf("documents.limits.web_open missing: %v", limits)
			}
			for format, wantWarn := range map[string]int64{
				"docx": 31457280,
				"pptx": 26214400,
				"pdf":  52428800,
				"xlsx": 5242880,
			} {
				entry, ok := webOpen[format].(map[string]any)
				if !ok {
					t.Fatalf("web_open.%s missing: %v", format, webOpen)
				}
				if got := int64(entry["warn_bytes"].(float64)); got != wantWarn {
					t.Fatalf("web_open.%s.warn_bytes = %d, want %d", format, got, wantWarn)
				}
			}
		})
	}
}

// GET /api/v1/config carries the UniChat catalogue beside Office's: arrays per
// channel (never null), store links that are HTTPS or empty, and neither
// product's variables leak into the other's catalogue.
func TestConfigPublishesUniChatCatalogue(t *testing.T) {
	type wire struct {
		Office  map[string][]config.OfficeInstaller `json:"office_installers"`
		UniChat map[string][]config.OfficeInstaller `json:"unichat_installers"`
		Stores  *config.UniChatStoreLinks           `json:"unichat_stores"`
	}
	read := func(cfg config.Config) wire {
		t.Helper()
		rec := httptest.NewRecorder()
		New(Deps{Cfg: cfg, Log: slog.Default()}).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/config", nil))
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d", rec.Code)
		}
		var out wire
		if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
			t.Fatal(err)
		}
		return out
	}

	empty := read(config.Config{OfficeInstallerDevURLs: `{"win32-x64":"https://downloads.test/office.exe"}`})
	for _, channel := range []string{"dev", "beta", "stable"} {
		if got, present := empty.UniChat[channel]; !present || got == nil || len(got) != 0 {
			t.Fatalf("unset UniChat %s = %+v, want an empty array", channel, got)
		}
	}
	if empty.Stores == nil || *empty.Stores != (config.UniChatStoreLinks{}) {
		t.Fatalf("unset stores = %+v, want four empty links", empty.Stores)
	}

	got := read(config.Config{
		UniChatInstallerDevURLs:    `{"darwin-arm64":"https://downloads.test/UniChat_0.1.0-dev.2_unsigned_darwin_arm64.dmg"}`,
		UniChatInstallerStableURLs: `{"win32-x64":"javascript:alert(1)"}`,
		UniChatStoreIOSURL:         "https://apps.apple.com/app/id1234567890",
		UniChatPlayInternalURL:     "http://play.google.com/apps/internaltest/1",
	})
	if dev := got.UniChat["dev"]; len(dev) != 1 || dev[0].Platform != "darwin-arm64" || dev[0].Version != "0.1.0-dev.2" || !dev[0].Unsigned {
		t.Fatalf("UniChat dev = %+v", dev)
	}
	if stable, present := got.UniChat["stable"]; !present || len(stable) != 0 {
		t.Fatalf("an invalid map must publish nothing: %+v", stable)
	}
	if len(got.Office["dev"]) != 0 {
		t.Fatalf("UniChat installers leaked into Office: %+v", got.Office)
	}
	if got.Stores == nil || *got.Stores != (config.UniChatStoreLinks{IOS: "https://apps.apple.com/app/id1234567890"}) {
		t.Fatalf("stores = %+v", got.Stores)
	}
}
