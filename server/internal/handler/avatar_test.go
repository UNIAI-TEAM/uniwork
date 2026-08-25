package handler

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A 1×1 transparent PNG — the smallest thing http.DetectContentType calls an
// image, so the test exercises the real sniffing path rather than trusting the
// multipart Content-Type header the client can set to anything.
var tinyPNG = []byte{
	0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
	0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
	0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
	0x42, 0x60, 0x82,
}

func registerAndToken(t *testing.T, srv *httptest.Server, email string) string {
	t.Helper()
	res := postJSON(t, srv, "/api/v1/auth/register", map[string]string{
		"email": email, "password": "password123", "display_name": "Avatar",
	})
	if res.StatusCode != 200 {
		t.Fatalf("register status = %d", res.StatusCode)
	}
	var out struct {
		AccessToken string `json:"access_token"`
	}
	_ = json.NewDecoder(res.Body).Decode(&out)
	return out.AccessToken
}

func uploadAvatar(t *testing.T, srv *httptest.Server, token, filename, declaredType string, content []byte) *http.Response {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	part, err := mw.CreatePart(map[string][]string{
		"Content-Disposition": {`form-data; name="file"; filename="` + filename + `"`},
		"Content-Type":        {declaredType},
	})
	if err != nil {
		t.Fatal(err)
	}
	_, _ = part.Write(content)
	_ = mw.Close()
	req, _ := http.NewRequest("POST", srv.URL+"/api/v1/me/avatar", &body)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func TestUploadAvatarStoresFileAndUpdatesUser(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("LOCAL_UPLOAD_DIR", dir)
	srv := newTestServer(t)
	token := registerAndToken(t, srv, "avatar@example.com")

	res := uploadAvatar(t, srv, token, "me.png", "image/png", tinyPNG)
	if res.StatusCode != 200 {
		t.Fatalf("status = %d, want 200", res.StatusCode)
	}
	var out struct {
		User struct {
			AvatarURL string `json:"avatar_url"`
		} `json:"user"`
	}
	_ = json.NewDecoder(res.Body).Decode(&out)
	if !strings.HasPrefix(out.User.AvatarURL, "/uploads/avatars/") || !strings.HasSuffix(out.User.AvatarURL, ".png") {
		t.Fatalf("avatar_url = %q, want /uploads/avatars/….png", out.User.AvatarURL)
	}

	// The URL must point at a file that actually landed in the upload dir —
	// a URL persisted before the bytes exist is the bug storage exists to avoid.
	key := strings.TrimPrefix(out.User.AvatarURL, "/uploads/")
	if _, err := os.Stat(filepath.Join(dir, key)); err != nil {
		t.Fatalf("uploaded file missing at %s: %v", key, err)
	}

	// And /me reflects it on the next read, not just in the upload response.
	req, _ := http.NewRequest("GET", srv.URL+"/api/v1/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	me, _ := srv.Client().Do(req)
	var meOut struct {
		User struct {
			AvatarURL string `json:"avatar_url"`
		} `json:"user"`
	}
	_ = json.NewDecoder(me.Body).Decode(&meOut)
	if meOut.User.AvatarURL != out.User.AvatarURL {
		t.Fatalf("/me avatar_url = %q, want %q", meOut.User.AvatarURL, out.User.AvatarURL)
	}
}

func TestUploadAvatarRejectsNonImages(t *testing.T) {
	t.Setenv("LOCAL_UPLOAD_DIR", t.TempDir())
	srv := newTestServer(t)
	token := registerAndToken(t, srv, "notimage@example.com")

	// Declared as PNG, but the bytes are text: the sniffed type is what counts.
	res := uploadAvatar(t, srv, token, "me.png", "image/png", []byte("hello, not a picture"))
	if res.StatusCode != 415 {
		t.Fatalf("status = %d, want 415", res.StatusCode)
	}
}

func TestUploadAvatarRejectsOversizedFiles(t *testing.T) {
	t.Setenv("LOCAL_UPLOAD_DIR", t.TempDir())
	srv := newTestServer(t)
	token := registerAndToken(t, srv, "big@example.com")

	big := append(append([]byte{}, tinyPNG...), bytes.Repeat([]byte{0}, maxAvatarBytes)...)
	res := uploadAvatar(t, srv, token, "big.png", "image/png", big)
	if res.StatusCode != 413 {
		t.Fatalf("status = %d, want 413", res.StatusCode)
	}
}

func TestUploadAvatarRequiresAuth(t *testing.T) {
	t.Setenv("LOCAL_UPLOAD_DIR", t.TempDir())
	srv := newTestServer(t)
	res := uploadAvatar(t, srv, "", "me.png", "image/png", tinyPNG)
	if res.StatusCode != 401 {
		t.Fatalf("status = %d, want 401", res.StatusCode)
	}
}
