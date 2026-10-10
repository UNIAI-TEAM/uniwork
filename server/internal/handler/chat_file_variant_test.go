package handler

import (
	"bytes"
	"net/http"
	"testing"
)

// ?variant=thumb is the same authorized route as the original: a room
// outsider is refused exactly as for the original, and a file without a
// thumbnail (the in-memory FileService never makes one) serves the original.
// Images may sit in the private browser cache for a minute; anything else
// stays no-store and downloads as an attachment.
func TestStreamChatFileVariantAndCachingFS(t *testing.T) {
	t.Setenv("LOCAL_UPLOAD_DIR", t.TempDir())
	t.Setenv("LOCAL_UPLOAD_BASE_URL", "")
	f := setupChatFixtureFiles(t, "fsvariant")

	_, out := uploadChatFile(t, f.srv.URL, f.tokens["a"], f.wsID, f.dmRoomID,
		"anh.png", "image/png", "variant-photo-1", tinyPNG)
	photoID := chatMessageDTO(t, out)["id"].(string)
	_, out = uploadChatFile(t, f.srv.URL, f.tokens["a"], f.wsID, f.dmRoomID,
		"ke-hoach.pdf", "application/pdf", "variant-doc-1", tinyPDF)
	docID := chatMessageDTO(t, out)["id"].(string)

	photo := fileStreamPath(f.wsID, f.dmRoomID, photoID)
	for _, path := range []string{photo, photo + "?variant=thumb"} {
		res, raw := getChatAttachment(t, f.srv, path, f.tokens["b"])
		if res.StatusCode != http.StatusOK || !bytes.Equal(raw, tinyPNG) {
			t.Fatalf("%s = %d (%d bytes), want the original", path, res.StatusCode, len(raw))
		}
		for header, want := range map[string]string{
			"Content-Type":           "image/png",
			"Cache-Control":          "private, max-age=60",
			"Content-Disposition":    `inline; filename="anh.png"`,
			"X-Content-Type-Options": "nosniff",
		} {
			if got := res.Header.Get(header); got != want {
				t.Fatalf("%s %s = %q, want %q", path, header, got, want)
			}
		}

		outsider, _ := getChatAttachment(t, f.srv, path, f.tokens["c"])
		original, _ := getChatAttachment(t, f.srv, photo, f.tokens["c"])
		if outsider.StatusCode != original.StatusCode || outsider.StatusCode < 400 {
			t.Fatalf("outsider %s = %d, original = %d; want the same refusal", path, outsider.StatusCode, original.StatusCode)
		}
	}

	if res, _ := getChatAttachment(t, f.srv, photo+"?variant=huge", f.tokens["b"]); res.StatusCode != http.StatusBadRequest {
		t.Fatalf("unknown variant = %d, want 400", res.StatusCode)
	}

	res, raw := getChatAttachment(t, f.srv, fileStreamPath(f.wsID, f.dmRoomID, docID), f.tokens["b"])
	if res.StatusCode != http.StatusOK || !bytes.Equal(raw, tinyPDF) {
		t.Fatalf("pdf = %d (%d bytes)", res.StatusCode, len(raw))
	}
	if got := res.Header.Get("Cache-Control"); got != "private, no-store" {
		t.Fatalf("pdf Cache-Control = %q, want private, no-store", got)
	}
	if got := res.Header.Get("Content-Disposition"); got != `attachment; filename="ke-hoach.pdf"` {
		t.Fatalf("pdf Content-Disposition = %q", got)
	}
}
