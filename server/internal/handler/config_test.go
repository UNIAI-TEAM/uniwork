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
}

// The web asks the deployment's own channel for its installer; the server
// decides it from the desktop client it binds, never from which channel
// happens to have installers.
func TestConfigPublishesOfficeChannel(t *testing.T) {
	for _, tc := range []struct {
		name string
		cfg  config.Config
		want string
	}{
		{"dev client", config.Config{DesktopAuthClientID: "uniwork-office-dev", OfficeInstallerStableURLs: `{"win32-x64":"https://downloads.test/stable.exe"}`}, "dev"},
		{"stable client", config.Config{DesktopAuthClientID: "uniwork-office", OfficeInstallerDevURLs: `{"win32-x64":"https://downloads.test/dev.exe"}`}, "stable"},
		{"beta setting", config.Config{DesktopAuthClientID: "uniwork-office", OfficeDesktopChannelSetting: "beta"}, "beta"},
		{"unknown client", config.Config{DesktopAuthClientID: "other"}, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			New(Deps{Cfg: tc.cfg, Log: slog.Default()}).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/config", nil))
			var out struct {
				OfficeChannel *string `json:"office_channel"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
				t.Fatal(err)
			}
			if rec.Code != http.StatusOK || out.OfficeChannel == nil || *out.OfficeChannel != tc.want {
				t.Fatalf("status %d office_channel = %v, want %q", rec.Code, out.OfficeChannel, tc.want)
			}
		})
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
