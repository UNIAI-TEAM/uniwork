package service

import (
	"context"
	"crypto/tls"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/config"
)

const githubAssetURL = "https://github.com/UNIAI-TEAM/uniwork-office/releases/download/v0.1.0-dev.1/office_0.1.0-dev.1_unsigned_win32_x64-setup.exe"

// fixtureTransport sends every host to one TLS fixture, so the code under
// test sees the real github.com / objects host names in its URLs.
func fixtureTransport(server *httptest.Server) *http.Transport {
	addr := server.Listener.Addr().String()
	return &http.Transport{
		DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
			return (&net.Dialer{}).DialContext(ctx, network, addr)
		},
		TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, //nolint:gosec // test fixture certificate
	}
}

func githubReleaseFixture(t *testing.T, location string, secondHop http.HandlerFunc) *OfficeDesktopDownloadService {
	t.Helper()
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" || r.Header.Get("Cookie") != "" {
			t.Error("credentials forwarded to release server")
		}
		if r.Host == "github.com" {
			w.Header().Set("Location", location)
			w.WriteHeader(http.StatusFound)
			return
		}
		secondHop(w, r)
	}))
	t.Cleanup(server.Close)
	transport := fixtureTransport(server)
	return &OfficeDesktopDownloadService{
		cfg:                config.Config{OfficeInstallerRedirectHosts: []string{"objects.githubusercontent.com", "release-assets.githubusercontent.com"}},
		installerTransport: transport,
		redirectTransport:  transport,
	}
}

func TestOfficeDesktopBundleFollowsOneGitHubRedirect(t *testing.T) {
	installer := []byte("unsigned installer from the objects host")
	svc := githubReleaseFixture(t, "https://release-assets.githubusercontent.com/github-production-release-asset/1?sig=abc", func(w http.ResponseWriter, r *http.Request) {
		if r.Host != "release-assets.githubusercontent.com" || r.URL.RawQuery != "sig=abc" {
			t.Errorf("redirect target changed: %s %s", r.Host, r.URL)
		}
		_, _ = w.Write(installer)
	})
	bundle, err := svc.Bundle(context.Background(), OfficeDesktopDownload{InstallerURL: githubAssetURL, Channel: "dev"})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = bundle.Close() }()
	if bundle.filename != "office_0.1.0-dev.1_unsigned_win32_x64-setup.exe" {
		t.Fatalf("bundle must keep the release file name, got %q", bundle.filename)
	}
	data := make([]byte, len(installer)+1)
	n, _ := bundle.installer.Read(data)
	if string(data[:n]) != string(installer) {
		t.Fatalf("installer body: %q", data[:n])
	}
}

func TestOfficeDesktopBundleRefusesUnsafeGitHubRedirects(t *testing.T) {
	ok := func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("installer")) }
	cases := map[string]struct {
		location  string
		secondHop http.HandlerFunc
	}{
		"second redirect": {"https://objects.githubusercontent.com/blob/1", func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Location", "https://objects.githubusercontent.com/blob/2")
			w.WriteHeader(http.StatusFound)
		}},
		"host not allowlisted":       {"https://objects.example.com/blob/1", ok},
		"allowlisted suffix trick":   {"https://objects.githubusercontent.com.evil.example/blob/1", ok},
		"plain http":                 {"http://objects.githubusercontent.com/blob/1", ok},
		"non-default port":           {"https://objects.githubusercontent.com:8443/blob/1", ok},
		"userinfo":                   {"https://user@objects.githubusercontent.com/blob/1", ok},
		"relative back to github":    {"/UNIAI-TEAM/uniwork-office/releases/download/v1/other.exe", ok},
		"ip literal not allowlisted": {"https://127.0.0.1/blob/1", ok},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			svc := githubReleaseFixture(t, tc.location, tc.secondHop)
			if _, err := svc.Bundle(context.Background(), OfficeDesktopDownload{InstallerURL: githubAssetURL, Channel: "dev"}); err == nil {
				t.Fatal("unsafe redirect accepted")
			}
		})
	}
}

func TestOfficeDesktopBundleRedirectOnlyFromGitHubReleaseAssets(t *testing.T) {
	for _, source := range []string{
		"https://downloads.example/office_unsigned_win32_x64-setup.exe",
		"https://github.com/UNIAI-TEAM/uniwork-office/raw/main/office-setup.exe",
		"https://github.com:8443/UNIAI-TEAM/uniwork-office/releases/download/v1/office-setup.exe",
	} {
		t.Run(source, func(t *testing.T) {
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Location", "https://objects.githubusercontent.com/blob/1")
				w.WriteHeader(http.StatusFound)
			}))
			defer server.Close()
			transport := fixtureTransport(server)
			svc := &OfficeDesktopDownloadService{cfg: config.Config{OfficeInstallerRedirectHosts: []string{"objects.githubusercontent.com"}}, installerTransport: transport, redirectTransport: transport}
			if _, err := svc.Bundle(context.Background(), OfficeDesktopDownload{InstallerURL: source, Channel: "beta"}); err == nil {
				t.Fatal("redirect from a non-release URL accepted")
			}
		})
	}
}

func TestOfficeDesktopRedirectTransportRefusesNonPublicAddresses(t *testing.T) {
	// The real redirect transport: an allowlisted name that resolves to
	// loopback is refused at dial time, before any byte is sent.
	svc := &OfficeDesktopDownloadService{cfg: config.Config{OfficeInstallerRedirectHosts: []string{"localhost"}}}
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Location", "https://localhost/blob/1")
		w.WriteHeader(http.StatusFound)
	}))
	defer server.Close()
	svc.installerTransport = fixtureTransport(server)
	if _, err := svc.Bundle(context.Background(), OfficeDesktopDownload{InstallerURL: githubAssetURL, Channel: "dev"}); err == nil {
		t.Fatal("redirect to loopback accepted")
	}
	for _, addr := range []string{"127.0.0.1:443", "[::1]:443", "10.0.0.5:443", "169.254.169.254:443", "100.64.1.1:443", "[fd00::1]:443", "[::ffff:192.168.1.1]:443"} {
		_, err := publicOnlyTransport().DialContext(context.Background(), "tcp", addr)
		if err == nil || !strings.Contains(err.Error(), "non-public") {
			t.Errorf("%s: dial not refused by the guard: %v", addr, err)
		}
	}
	for _, ip := range []string{"140.82.112.3", "185.199.108.133", "2606:50c0:8000::154"} {
		if !publicAddr(netip.MustParseAddr(ip)) {
			t.Errorf("%s should be public", ip)
		}
	}
}
