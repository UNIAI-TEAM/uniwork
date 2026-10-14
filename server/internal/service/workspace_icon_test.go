package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
)

// workspaceIconPNG is a 1x1 PNG: the smallest file the image allowlist takes.
var workspaceIconPNG = func() []byte {
	b, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PzWvWQAAAABJRU5ErkJggg==")
	if err != nil {
		panic(err)
	}
	return b
}()

func iconFixture(t *testing.T) (wsFix, WorkspaceView) {
	t.Helper()
	f := wsFixture(t)
	f.ws.SetFiles(filesfake.New(filesfake.Options{}))
	w, err := f.ws.CreateInOrg(context.Background(), f.ua.ID, f.org.ID, "Đội Alpha", "doi-alpha")
	if err != nil {
		t.Fatal(err)
	}
	return f, w
}

func TestWorkspaceUploadIconReplacesEmojiAndOldFile(t *testing.T) {
	f, w := iconFixture(t)
	ctx := context.Background()
	emoji := "🚀"
	if _, err := f.ws.Update(ctx, f.ua.ID, w.ID, UpdateWorkspaceInput{IconEmoji: &emoji}); err != nil {
		t.Fatal(err)
	}
	first, err := f.ws.UploadIcon(ctx, f.ua.ID, w.ID, "logo.png", bytes.NewReader(workspaceIconPNG))
	if err != nil {
		t.Fatal(err)
	}
	if first.IconEmoji.Valid || !first.IconFileID.Valid {
		t.Fatalf("after upload: %+v", first.Workspace)
	}
	if first.IconURL != "fake://presign/"+first.IconFileID.String {
		t.Fatalf("icon url = %q", first.IconURL)
	}
	second, err := f.ws.UploadIcon(ctx, f.ua.ID, w.ID, "logo2.png", bytes.NewReader(workspaceIconPNG))
	if err != nil {
		t.Fatal(err)
	}
	oldID, newID := files.FileID(first.IconFileID.String), files.FileID(second.IconFileID.String)
	held, err := WorkspaceIconProvider{}.HeldBy(ctx, f.q, []files.FileID{oldID, newID})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := held[oldID]; ok || len(held) != 1 {
		t.Fatalf("held = %v, want only the current icon %s", held, newID)
	}
}

func TestWorkspaceEmojiReplacesUploadedIcon(t *testing.T) {
	f, w := iconFixture(t)
	ctx := context.Background()
	up, err := f.ws.UploadIcon(ctx, f.ua.ID, w.ID, "logo.png", bytes.NewReader(workspaceIconPNG))
	if err != nil {
		t.Fatal(err)
	}
	emoji := "🎯"
	got, err := f.ws.Update(ctx, f.ua.ID, w.ID, UpdateWorkspaceInput{IconEmoji: &emoji})
	if err != nil {
		t.Fatal(err)
	}
	if got.IconFileID.Valid || got.IconURL != "" || got.IconEmoji.String != "🎯" {
		t.Fatalf("after emoji: %+v url=%q", got.Workspace, got.IconURL)
	}
	held, err := WorkspaceIconProvider{}.HeldBy(ctx, f.q, []files.FileID{files.FileID(up.IconFileID.String)})
	if err != nil || len(held) != 0 {
		t.Fatalf("released file still held: %v %v", held, err)
	}
}

func TestWorkspaceRemoveIcon(t *testing.T) {
	f, w := iconFixture(t)
	ctx := context.Background()
	// Nothing to remove is a no-op, not an error and not an audit row.
	if _, err := f.ws.RemoveIcon(ctx, f.ua.ID, w.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.ws.UploadIcon(ctx, f.ua.ID, w.ID, "logo.png", bytes.NewReader(workspaceIconPNG)); err != nil {
		t.Fatal(err)
	}
	got, err := f.ws.RemoveIcon(ctx, f.ua.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.IconFileID.Valid || got.IconEmoji.Valid {
		t.Fatalf("after remove: %+v", got.Workspace)
	}
	var n int
	if err := f.pool.QueryRow(ctx,
		`SELECT count(*) FROM audit_events WHERE workspace_id = $1 AND action = 'workspace.updated'`, w.ID,
	).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Fatalf("audit rows = %d, want 2 (upload, remove)", n)
	}
}

func TestWorkspaceIconRejectsNonImagesAndNonMembers(t *testing.T) {
	f, w := iconFixture(t)
	ctx := context.Background()
	var ce CodedError
	if _, err := f.ws.UploadIcon(ctx, f.ua.ID, w.ID, "x.png", bytes.NewReader([]byte("not a picture"))); !errors.As(err, &ce) || ce.Status != 415 {
		t.Fatalf("text upload: %v", err)
	}
	if _, err := f.ws.UploadIcon(ctx, f.ub.ID, w.ID, "logo.png", bytes.NewReader(workspaceIconPNG)); err == nil {
		t.Fatal("a non-member uploaded an icon")
	}
}
