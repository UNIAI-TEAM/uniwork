package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestClientMetadataExtractsHeaders(t *testing.T) {
	var gotPlatform, gotVersion, gotOS string
	handler := ClientMetadata(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		gotPlatform, gotVersion, gotOS = ClientMetadataFromContext(r.Context())
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set(HeaderClientPlatform, "desktop")
	req.Header.Set(HeaderClientVersion, "1.2.3")
	req.Header.Set(HeaderClientOS, "macos")

	handler.ServeHTTP(httptest.NewRecorder(), req)

	if gotPlatform != "desktop" {
		t.Errorf("platform: got %q, want desktop", gotPlatform)
	}
	if gotVersion != "1.2.3" {
		t.Errorf("version: got %q, want 1.2.3", gotVersion)
	}
	if gotOS != "macos" {
		t.Errorf("os: got %q, want macos", gotOS)
	}
}

func TestClientMetadataMissingHeadersReturnEmpty(t *testing.T) {
	var gotPlatform, gotVersion, gotOS string
	handler := ClientMetadata(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		gotPlatform, gotVersion, gotOS = ClientMetadataFromContext(r.Context())
	}))

	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/", nil))

	if gotPlatform != "" || gotVersion != "" || gotOS != "" {
		t.Errorf("expected empty metadata, got (%q,%q,%q)", gotPlatform, gotVersion, gotOS)
	}
}

func TestSetClientMetadataAttachesValues(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	ctx := SetClientMetadata(req.Context(), "cli", "0.5.1", "linux")

	platform, version, os := ClientMetadataFromContext(ctx)
	if platform != "cli" || version != "0.5.1" || os != "linux" {
		t.Errorf("got (%q,%q,%q), want (cli,0.5.1,linux)", platform, version, os)
	}
}

// The OTA a mobile build runs reaches the context (and so the access log) only when
// it looks like an update id: the header is the caller's to set.
func TestClientMetadataKeepsAWellFormedUpdateID(t *testing.T) {
	for header, want := range map[string]string{
		"0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b": "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
		"embedded":                             "embedded",
		"":                                     "",
		"id with spaces":                       "",
		"0193a1b2\nlevel=ERROR":                "",
		strings.Repeat("a", 65):                "",
	} {
		var got string
		handler := ClientMetadata(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
			got = ClientUpdateIDFromContext(r.Context())
		}))
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.Header.Set(HeaderClientUpdateID, header)
		handler.ServeHTTP(httptest.NewRecorder(), req)
		if got != want {
			t.Errorf("X-Client-Update-Id %q: got %q, want %q", header, got, want)
		}
	}
}

func TestRequestLoggerNamesTheClientUpdate(t *testing.T) {
	logs := withCapturedLogs(t)
	handler := ClientMetadata(RequestLogger(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	})))
	req := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
	req.Header.Set(HeaderClientPlatform, "mobile")
	req.Header.Set(HeaderClientVersion, "0.3.0")
	req.Header.Set(HeaderClientUpdateID, "0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b")
	handler.ServeHTTP(httptest.NewRecorder(), req)
	if out := logs.String(); !strings.Contains(out, "client_update_id=0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b") || !strings.Contains(out, "client_version=0.3.0") {
		t.Fatalf("access log lacks the client update:\n%s", out)
	}
}
