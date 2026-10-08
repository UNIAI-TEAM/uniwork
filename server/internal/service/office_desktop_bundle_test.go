package service

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestOfficeDesktopBundleContainsInstallerAndProfile(t *testing.T) {
	installer := []byte("labelled unsigned dev installer fixture")
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" {
			t.Error("credentials forwarded to release server")
		}
		_, _ = w.Write(installer)
	}))
	defer provider.Close()
	profile := OfficeDesktopDownload{InstallerURL: provider.URL + "/setup.exe", ServerOrigin: "http://localhost:18080", Channel: "dev", ClientID: "uniwork-office-dev", DeploymentID: "fixture"}
	svc := &OfficeDesktopDownloadService{}
	bundle, err := svc.Bundle(context.Background(), profile)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := bundle.Close(); err != nil {
			t.Error(err)
		}
	}()
	var body bytes.Buffer
	if err := bundle.WriteZipTo(&body); err != nil {
		t.Fatal(err)
	}
	archive, err := zip.NewReader(bytes.NewReader(body.Bytes()), int64(body.Len()))
	if err != nil {
		t.Fatal(err)
	}
	files := map[string][]byte{}
	for _, file := range archive.File {
		r, err := file.Open()
		if err != nil {
			t.Fatal(err)
		}
		data, err := io.ReadAll(r)
		_ = r.Close()
		if err != nil {
			t.Fatal(err)
		}
		files[file.Name] = data
	}
	if len(files) != 3 || !bytes.Equal(files["setup.exe"], installer) {
		t.Fatalf("wrong bundle entries: %v", files)
	}
	var installed map[string]string
	if err := json.Unmarshal(files["deployment-profile.json"], &installed); err != nil {
		t.Fatal(err)
	}
	if len(installed) != 4 || installed["deploymentId"] != "fixture" || installed["apiOrigin"] != profile.ServerOrigin || installed["clientId"] != profile.ClientID || installed["channel"] != "dev" {
		t.Fatalf("profile incompatible with desktop resolver: %v", installed)
	}
}

func TestOfficeDesktopBundleReadmeExplainsBothPlatforms(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("unsigned installer fixture")) }))
	defer provider.Close()
	bundle, err := (&OfficeDesktopDownloadService{}).Bundle(context.Background(), OfficeDesktopDownload{InstallerURL: provider.URL + "/UniWork-Office.dmg", ServerOrigin: "https://uniwork.example.vn", Channel: "dev", ClientID: "uniwork-office-dev", DeploymentID: "fixture"})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = bundle.Close() }()
	var data bytes.Buffer
	if err := bundle.WriteZipTo(&data); err != nil {
		t.Fatal(err)
	}
	archive, err := zip.NewReader(bytes.NewReader(data.Bytes()), int64(data.Len()))
	if err != nil {
		t.Fatal(err)
	}
	var readme []byte
	for _, file := range archive.File {
		if file.Name != "README.txt" {
			continue
		}
		r, err := file.Open()
		if err != nil {
			t.Fatal(err)
		}
		readme, err = io.ReadAll(r)
		_ = r.Close()
		if err != nil {
			t.Fatal(err)
		}
	}
	text := string(readme)
	if !utf8.Valid(readme) {
		t.Fatal("README is not UTF-8")
	}
	// The labels must match officeDesktop.login.importProfile (vi, en) in
	// packages/core/i18n/locales, or the instructions point at no button.
	for _, want := range []string{"Tiếng Việt", "English", "Windows", "macOS", "deployment-profile.json", "Chọn tệp cấu hình…", "Choose configuration file…", "run Setup"} {
		if !strings.Contains(text, want) {
			t.Errorf("README misses %q:\n%s", want, text)
		}
	}
	if strings.Contains(text, "https://uniwork.example.vn") || strings.Contains(text, "fixture") {
		t.Error("README must stay generic: no origin or deployment id")
	}
}

func TestOfficeDesktopBundleRefusesRedirectEmptyAndOversize(t *testing.T) {
	for _, status := range []string{"redirect", "empty", "oversize"} {
		t.Run(status, func(t *testing.T) {
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch status {
				case "redirect":
					w.Header().Set("Location", "http://localhost/other.exe")
					w.WriteHeader(302)
				case "oversize":
					w.Header().Set("Content-Length", "536870913")
				}
			}))
			defer provider.Close()
			_, err := (&OfficeDesktopDownloadService{}).Bundle(context.Background(), OfficeDesktopDownload{InstallerURL: provider.URL + "/setup.exe", Channel: "dev"})
			if err == nil {
				t.Fatal("unsafe response accepted")
			}
		})
	}
}

func TestOfficeDesktopBundlePlatformExtensions(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("unsigned installer fixture")) }))
	defer provider.Close()
	for _, ext := range []string{".exe", ".zip", ".dmg", ".deb", ".AppImage"} {
		t.Run(ext, func(t *testing.T) {
			filename := "Office_0.1.0_unsigned" + ext
			bundle, err := (&OfficeDesktopDownloadService{}).Bundle(context.Background(), OfficeDesktopDownload{InstallerURL: provider.URL + "/" + filename, Channel: "dev"})
			if err != nil {
				t.Fatal(err)
			}
			defer func() {
				if err := bundle.Close(); err != nil {
					t.Error(err)
				}
			}()
			var data bytes.Buffer
			if err := bundle.WriteZipTo(&data); err != nil {
				t.Fatal(err)
			}
			archive, err := zip.NewReader(bytes.NewReader(data.Bytes()), int64(data.Len()))
			if err != nil || len(archive.File) != 3 || archive.File[0].Name != filename {
				t.Fatalf("platform bundle: %+v %v", archive, err)
			}
		})
	}
	if _, err := (&OfficeDesktopDownloadService{}).Bundle(context.Background(), OfficeDesktopDownload{InstallerURL: provider.URL + "/bad.rpm", Channel: "dev"}); err == nil {
		t.Fatal("unsupported installer format accepted")
	}
}
