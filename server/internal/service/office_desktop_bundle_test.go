package service

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
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
	if len(files) != 2 || !bytes.Equal(files["UniWork-Office-Setup.exe"], installer) {
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
