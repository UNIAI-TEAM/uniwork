package handler

import (
	"bytes"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Step 0 regression tests for the avatar module (UNI-744, plan T6): set,
// replace, and which file the replacement actually serves.

// avatarPNG renders a real PNG, so the replace case uploads two files whose
// bytes differ instead of the same file twice.
func avatarPNG(t *testing.T, c color.NRGBA) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, 1, 1))
	img.SetNRGBA(0, 0, c)
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func uploadAvatarAndReadURL(t *testing.T, srv *httptest.Server, token, filename string, content []byte) string {
	t.Helper()
	res := uploadAvatar(t, srv, token, filename, "image/png", content)
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(res.Body)
		t.Fatalf("avatar upload %s = %d %s", filename, res.StatusCode, raw)
	}
	var out struct {
		User struct {
			AvatarURL string `json:"avatar_url"`
		} `json:"user"`
	}
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	if out.User.AvatarURL == "" {
		t.Fatalf("avatar upload %s returned no avatar_url", filename)
	}
	return out.User.AvatarURL
}

func meAvatarURL(t *testing.T, srv *httptest.Server, token string) string {
	t.Helper()
	req, err := http.NewRequest(http.MethodGet, srv.URL+"/api/v1/me", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(res.Body)
		t.Fatalf("GET /me = %d %s", res.StatusCode, raw)
	}
	var out struct {
		User struct {
			AvatarURL string `json:"avatar_url"`
		} `json:"user"`
	}
	if err := json.NewDecoder(res.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	return out.User.AvatarURL
}

func TestUploadAvatarReplacesPreviousAvatar(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("LOCAL_UPLOAD_DIR", dir)
	t.Setenv("LOCAL_UPLOAD_BASE_URL", "")
	srv := newTestServer(t)
	token := registerAndToken(t, srv, "replace@example.com")

	first := avatarPNG(t, color.NRGBA{R: 0x11, G: 0x22, B: 0x33, A: 0xff})
	second := avatarPNG(t, color.NRGBA{R: 0xcc, G: 0x88, B: 0x44, A: 0xff})

	firstURL := uploadAvatarAndReadURL(t, srv, token, "one.png", first)
	secondURL := uploadAvatarAndReadURL(t, srv, token, "two.png", second)
	if firstURL == secondURL {
		t.Fatalf("replace reused the previous avatar url %q", firstURL)
	}

	if got := meAvatarURL(t, srv, token); got != secondURL {
		t.Fatalf("/me avatar_url = %q, want the replacement %q", got, secondURL)
	}

	served, err := os.ReadFile(filepath.Join(dir, strings.TrimPrefix(secondURL, "/uploads/")))
	if err != nil {
		t.Fatalf("replacement bytes missing on disk: %v", err)
	}
	if !bytes.Equal(served, second) {
		t.Fatalf("replacement serves %d bytes, want the second upload (%d)", len(served), len(second))
	}

	// Today the replaced object stays on disk: the handler writes the new
	// file and updates the row, and nothing unlinks the old key. T6 moves the
	// orchestration into the service and unlinks it, so this assertion is the
	// visible marker of that change - edit it in the T6 PR, do not delete it.
	if _, err := os.Stat(filepath.Join(dir, strings.TrimPrefix(firstURL, "/uploads/"))); err != nil {
		t.Fatalf("replaced avatar object is gone (%v); if T6 unlinks it, update this assertion", err)
	}
}
