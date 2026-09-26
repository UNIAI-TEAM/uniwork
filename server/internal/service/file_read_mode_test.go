package service

import (
	"context"
	"io"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/files"
)

// ReadMode governs what ResolveMany hands out (a URL or none); Open is the
// module-authorized proxy read and serves any purpose. Chat streams voice
// (ChatVoice, a presign purpose) through Open for its per-request ACL, so the
// real service must keep answering it (T7 flag 4, integration decision).
func TestOpenServesAPresignPurpose(t *testing.T) {
	h := newFileHarness(t, localFileBackend(), nil)
	ctx := context.Background()
	scope := files.Scope{UserID: t3User}
	spec, err := h.svc.Registry().Lookup(files.UserAvatar)
	if err != nil || spec.Policy.ReadMode != files.ReadPresign {
		t.Fatalf("fixture: avatar spec %+v, %v; want a presign purpose", spec.Policy, err)
	}
	up, err := t3Upload(t, h, files.UserAvatar, scope, "presign-open", "me.png", t3PNG)
	if err != nil {
		t.Fatalf("upload: %v", err)
	}
	rd, err := h.svc.Open(ctx, files.OpenInput{Scope: scope, FileID: up.File.ID})
	if err != nil {
		t.Fatalf("open on a presign purpose: %v", err)
	}
	defer rd.Close()
	b, _ := io.ReadAll(rd.Body)
	if string(b) != string(t3PNG) {
		t.Fatalf("open returned %d bytes, want the uploaded %d", len(b), len(t3PNG))
	}
}
