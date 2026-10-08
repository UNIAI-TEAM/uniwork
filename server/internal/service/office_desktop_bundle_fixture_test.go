package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"
)

// TestOfficeDesktopBundleWriteFixture is the macOS smoke's bundle builder, not
// a unit test: it runs the production Bundle/WriteZipTo path against a real
// installer served by httptest and writes the zip a browser download would
// receive. It skips unless OFFICE_BUNDLE_INSTALLER (the installer file) and
// OFFICE_BUNDLE_OUT (the zip to write) are set; OFFICE_BUNDLE_ORIGIN overrides
// the stub https origin. The profile holds only public, made-up identity.
func TestOfficeDesktopBundleWriteFixture(t *testing.T) {
	installer, out := os.Getenv("OFFICE_BUNDLE_INSTALLER"), os.Getenv("OFFICE_BUNDLE_OUT")
	if installer == "" || out == "" {
		t.Skip("set OFFICE_BUNDLE_INSTALLER and OFFICE_BUNDLE_OUT to write a smoke bundle")
	}
	origin := os.Getenv("OFFICE_BUNDLE_ORIGIN")
	if origin == "" {
		origin = "https://uniwork-smoke.example.test:8443"
	}
	name := filepath.Base(installer)
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/"+name {
			http.NotFound(w, r)
			return
		}
		http.ServeFile(w, r, installer)
	}))
	defer provider.Close()
	profile := OfficeDesktopDownload{InstallerURL: provider.URL + "/" + url.PathEscape(name), ServerOrigin: origin, Channel: "dev", ClientID: "uniwork-office-dev", DeploymentID: "macos-smoke"}
	bundle, err := (&OfficeDesktopDownloadService{}).Bundle(context.Background(), profile)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := bundle.Close(); err != nil {
			t.Error(err)
		}
	}()
	file, err := os.Create(out)
	if err != nil {
		t.Fatal(err)
	}
	if err := bundle.WriteZipTo(file); err != nil {
		_ = file.Close()
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	t.Logf("wrote %s (installer %s, origin %s)", out, name, origin)
}
