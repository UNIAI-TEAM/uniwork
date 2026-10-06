package handler

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/config"
)

func TestOfficeDesktopDownloadRoute(t *testing.T) {
	d, pool := newTestDeps(t, nil, discardOutbox{})
	d.Cfg.APIPublicURL = "https://api.example.test"
	d.Cfg.OfficeInstallerStableURL = "https://downloads.example.test/office.exe"
	d.Cfg.OfficeInstallerStableURLs = `{"linux-x64-deb":"https://downloads.example.test/office.deb","darwin-arm64":"https://downloads.example.test/office.dmg"}`
	d.Cfg.DesktopAuthClientID = "uniwork-office"
	d.Cfg.DesktopAuthDeploymentIDs = []string{"default"}
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)
	token, userID := filesRegister(t, srv, "desktop-download-owner@example.test")
	outsider, _ := filesRegister(t, srv, "desktop-download-outsider@example.test")
	res, body := doJSON(t, srv, "POST", "/api/v1/orgs", token, map[string]string{"name": "Download", "slug": "download"})
	if res.StatusCode != 201 {
		t.Fatalf("org: %d %v", res.StatusCode, body)
	}
	orgID := body["organization"].(map[string]any)["id"].(string)
	path := "/api/v1/office/desktop/download?organization_id=" + orgID
	for _, test := range []struct {
		token, path string
		status      int
	}{
		{"", path, 401}, {outsider, path, 403}, {outsider, path + "&channel=beta", 403},
		{token, path + "&channel=beta", 404}, {token, path + "&channel=invalid", 400},
		{token, path + "&platform=unknown", 400}, {token, path + "&platform=darwin-x64", 404},
		{token, "/api/v1/office/desktop/download", 400},
	} {
		r, b := doJSON(t, srv, "GET", test.path, test.token, nil)
		if r.StatusCode != test.status {
			t.Fatalf("GET %s: %d want %d: %v", test.path, r.StatusCode, test.status, b)
		}
	}
	res, body = doJSON(t, srv, "GET", path, token, nil)
	if res.StatusCode != 200 || body["channel"] != "stable" || body["client_id"] != "uniwork-office" || body["server_origin"] != "https://api.example.test" {
		t.Fatalf("profile: %d %v", res.StatusCode, body)
	}
	if res.Header.Get("Cache-Control") != "no-store" {
		t.Fatal("profile must not be cached")
	}
	items, ok := body["installers"].([]any)
	if !ok || len(items) != 3 || items[2].(map[string]any)["platform"] != "linux-x64-deb" {
		t.Fatalf("installer list: %v", body)
	}
	var count int
	if err := pool.QueryRow(context.Background(), "SELECT count(*) FROM audit_events WHERE action='office.desktop_downloaded' AND actor_id=$1 AND organization_id=$2", userID, orgID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("audits: %d want 1", count)
	}
}

func TestOfficeDesktopDownloadPlatformBundle(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/office_unsigned.deb" {
			t.Errorf("wrong selected installer: %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" {
			t.Error("account credentials sent to release provider")
		}
		_, _ = w.Write([]byte("unsigned deb fixture"))
	}))
	defer provider.Close()
	d, _ := newTestDeps(t, nil, discardOutbox{})
	d.Cfg.APIPublicURL = "http://localhost:18584"
	d.Cfg.DesktopAuthClientID = "uniwork-office-dev"
	d.Cfg.DesktopAuthDeploymentIDs = []string{"default"}
	d.Cfg.OfficeInstallerDevURLs = fmt.Sprintf(`{"linux-x64-deb":%q}`, provider.URL+"/office_unsigned.deb")
	srv := httptest.NewServer(New(d))
	defer srv.Close()
	token, _ := filesRegister(t, srv, "desktop-download-deb@example.test")
	res, body := doJSON(t, srv, "POST", "/api/v1/orgs", token, map[string]string{"name": "Platform", "slug": "platform"})
	if res.StatusCode != 201 {
		t.Fatalf("org: %d %v", res.StatusCode, body)
	}
	orgID := body["organization"].(map[string]any)["id"].(string)
	request, err := http.NewRequest(http.MethodGet, srv.URL+"/api/v1/office/desktop/download?organization_id="+orgID+"&channel=dev&platform=linux-x64-deb&bundle=true", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Authorization", "Bearer "+token)
	response, err := srv.Client().Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != 200 || response.Header.Get("Content-Type") != "application/zip" {
		t.Fatalf("bundle response: %d %s", response.StatusCode, data)
	}
	archive, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil || len(archive.File) != 2 || archive.File[0].Name != "office_unsigned.deb" || archive.File[1].Name != "deployment-profile.json" {
		t.Fatalf("platform bundle: %+v %v", archive, err)
	}
}

func TestOfficeDesktopDownloadOpenAPI(t *testing.T) {
	h := New(Deps{Cfg: config.Config{FrontendOrigin: "http://localhost:3000", EnableSwagger: true}, Log: slog.Default()})
	r := httptest.NewRecorder()
	h.ServeHTTP(r, httptest.NewRequest(http.MethodGet, "/swagger/doc.json", nil))
	var spec struct {
		Paths map[string]struct {
			Get struct {
				Parameters []struct {
					Name string `json:"name"`
				} `json:"parameters"`
			} `json:"get"`
		} `json:"paths"`
	}
	if err := json.Unmarshal(r.Body.Bytes(), &spec); err != nil {
		t.Fatal(err)
	}
	params := map[string]bool{}
	for _, p := range spec.Paths["/api/v1/office/desktop/download"].Get.Parameters {
		params[p.Name] = true
	}
	for _, name := range []string{"organization_id", "channel", "bundle", "platform"} {
		if !params[name] {
			t.Errorf("missing query parameter %s", name)
		}
	}
}
