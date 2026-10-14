package service

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"slices"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// workspaceIconPNG is a 1x1 PNG: the smallest file the image allowlist takes.
var workspaceIconPNG = func() []byte {
	b, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PzWvWQAAAABJRU5ErkJggg==")
	if err != nil {
		panic(err)
	}
	return b
}()

// recordingFiles wraps the fake and records the calls that decide whether a
// file is kept or dropped; claimErr makes ClaimInTx fail on demand.
type recordingFiles struct {
	*filesfake.Fake
	claims   []files.ClaimInput
	releases [][]files.FileID
	cancels  []files.FileID
	claimErr error
}

func (r *recordingFiles) ClaimInTx(ctx context.Context, q *db.Queries, in files.ClaimInput) ([]files.File, error) {
	r.claims = append(r.claims, in)
	if r.claimErr != nil {
		return nil, r.claimErr
	}
	return r.Fake.ClaimInTx(ctx, q, in)
}

func (r *recordingFiles) ReleaseInTx(ctx context.Context, q *db.Queries, ids []files.FileID) error {
	r.releases = append(r.releases, slices.Clone(ids))
	return r.Fake.ReleaseInTx(ctx, q, ids)
}

func (r *recordingFiles) CancelUpload(ctx context.Context, in files.CancelInput) error {
	r.cancels = append(r.cancels, in.FileID)
	return r.Fake.CancelUpload(ctx, in)
}

func (r *recordingFiles) reset() { r.claims, r.releases, r.cancels = nil, nil, nil }

func iconFixture(t *testing.T) (wsFix, WorkspaceView) {
	t.Helper()
	f, w, _ := iconRecorderFixture(t)
	return f, w
}

func iconRecorderFixture(t *testing.T) (wsFix, WorkspaceView, *recordingFiles) {
	t.Helper()
	f := wsFixture(t)
	rec := &recordingFiles{Fake: filesfake.New(filesfake.Options{})}
	f.ws.SetFiles(rec)
	w, err := f.ws.CreateInOrg(context.Background(), f.ua.ID, f.org.ID, "Đội Alpha", "doi-alpha")
	if err != nil {
		t.Fatal(err)
	}
	return f, w, rec
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

func TestWorkspaceIconClaimsAndReleasesTheFiles(t *testing.T) {
	f, w, rec := iconRecorderFixture(t)
	ctx := context.Background()
	first, err := f.ws.UploadIcon(ctx, f.ua.ID, w.ID, "a.png", bytes.NewReader(workspaceIconPNG))
	if err != nil {
		t.Fatal(err)
	}
	firstID := files.FileID(first.IconFileID.String)
	if len(rec.claims) != 1 || len(rec.claims[0].Replaces) != 0 || len(rec.releases) != 0 {
		t.Fatalf("first upload: claims=%v releases=%v", rec.claims, rec.releases)
	}

	// Replacing an upload claims the new file with the old one as Replaces and
	// releases the old one.
	rec.reset()
	second, err := f.ws.UploadIcon(ctx, f.ua.ID, w.ID, "b.png", bytes.NewReader(workspaceIconPNG))
	if err != nil {
		t.Fatal(err)
	}
	secondID := files.FileID(second.IconFileID.String)
	if len(rec.claims) != 1 || !slices.Equal(rec.claims[0].FileIDs, []files.FileID{secondID}) || !slices.Equal(rec.claims[0].Replaces, []files.FileID{firstID}) {
		t.Fatalf("replace claim = %+v", rec.claims)
	}
	if len(rec.releases) != 1 || !slices.Equal(rec.releases[0], []files.FileID{firstID}) {
		t.Fatalf("replace releases = %v, want [[%s]]", rec.releases, firstID)
	}
	if len(rec.cancels) != 0 {
		t.Fatalf("a successful upload cancelled %v", rec.cancels)
	}

	// An emoji over an upload releases the file.
	rec.reset()
	emoji := "🎯"
	if _, err := f.ws.Update(ctx, f.ua.ID, w.ID, UpdateWorkspaceInput{IconEmoji: &emoji}); err != nil {
		t.Fatal(err)
	}
	if len(rec.releases) != 1 || !slices.Equal(rec.releases[0], []files.FileID{secondID}) {
		t.Fatalf("emoji releases = %v, want [[%s]]", rec.releases, secondID)
	}

	// An emoji over an emoji has no file to release.
	rec.reset()
	other := "🚀"
	if _, err := f.ws.Update(ctx, f.ua.ID, w.ID, UpdateWorkspaceInput{IconEmoji: &other}); err != nil {
		t.Fatal(err)
	}
	if len(rec.releases) != 0 {
		t.Fatalf("emoji over emoji released %v", rec.releases)
	}

	// RemoveIcon releases the file of an upload.
	third, err := f.ws.UploadIcon(ctx, f.ua.ID, w.ID, "c.png", bytes.NewReader(workspaceIconPNG))
	if err != nil {
		t.Fatal(err)
	}
	rec.reset()
	if _, err := f.ws.RemoveIcon(ctx, f.ua.ID, w.ID); err != nil {
		t.Fatal(err)
	}
	if len(rec.releases) != 1 || !slices.Equal(rec.releases[0], []files.FileID{files.FileID(third.IconFileID.String)}) {
		t.Fatalf("remove releases = %v", rec.releases)
	}
}

func TestWorkspaceUploadIconCancelsWhenTheTransactionStepFails(t *testing.T) {
	f, w, rec := iconRecorderFixture(t)
	ctx := context.Background()
	rec.claimErr = errors.New("claim refused")
	if _, err := f.ws.UploadIcon(ctx, f.ua.ID, w.ID, "a.png", bytes.NewReader(workspaceIconPNG)); err == nil {
		t.Fatal("upload succeeded with a refused claim")
	}
	if len(rec.cancels) != 1 {
		t.Fatalf("cancels = %v, want the staged file cancelled once", rec.cancels)
	}
	got, err := f.ws.GetView(ctx, f.ua.ID, w.ID)
	if err != nil || got.IconFileID.Valid {
		t.Fatalf("icon after a failed upload: %+v %v", got.Workspace, err)
	}

	// A refusal before anything is staged has nothing to cancel.
	rec.reset()
	rec.claimErr = nil
	if _, err := f.ws.UploadIcon(ctx, f.ua.ID, w.ID, "x.png", bytes.NewReader([]byte("not a picture"))); err == nil {
		t.Fatal("a text file was accepted")
	}
	if len(rec.cancels) != 0 || len(rec.claims) != 0 {
		t.Fatalf("rejected upload: claims=%v cancels=%v", rec.claims, rec.cancels)
	}
}

func TestWorkspaceMemberCannotChangeTheIcon(t *testing.T) {
	f, w := iconFixture(t)
	ctx := context.Background()
	if err := f.q.AddWorkspaceMember(ctx, db.AddWorkspaceMemberParams{WorkspaceID: w.ID, OrganizationID: w.OrganizationID, UserID: f.ub.ID, Role: "member"}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.ws.UploadIcon(ctx, f.ub.ID, w.ID, "logo.png", bytes.NewReader(workspaceIconPNG)); err != ErrForbidden {
		t.Fatalf("member upload: %v", err)
	}
	if _, err := f.ws.RemoveIcon(ctx, f.ub.ID, w.ID); err != ErrForbidden {
		t.Fatalf("member remove: %v", err)
	}
}

// A swap that commits after a caller read the workspace must not be undone
// by that caller: what is released is the file current inside the transaction
// (here B, though the caller last saw A), and a missing workspace is not found.
func TestReleaseIconFileInTxReleasesTheCurrentFile(t *testing.T) {
	f, w, rec := iconRecorderFixture(t)
	ctx := context.Background()
	if _, err := f.ws.UploadIcon(ctx, f.ua.ID, w.ID, "a.png", bytes.NewReader(workspaceIconPNG)); err != nil {
		t.Fatal(err)
	}
	b, err := f.ws.UploadIcon(ctx, f.ua.ID, w.ID, "b.png", bytes.NewReader(workspaceIconPNG))
	if err != nil {
		t.Fatal(err)
	}
	rec.reset()
	tx, err := f.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := f.ws.releaseIconFileInTx(ctx, f.q.WithTx(tx), w.ID, w.OrganizationID); err != nil {
		t.Fatal(err)
	}
	if len(rec.releases) != 1 || !slices.Equal(rec.releases[0], []files.FileID{files.FileID(b.IconFileID.String)}) {
		t.Fatalf("released %v, want only the current file %s", rec.releases, b.IconFileID.String)
	}
	if _, err := f.ws.releaseIconFileInTx(ctx, f.q.WithTx(tx), "no-such-workspace", w.OrganizationID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing workspace: %v", err)
	}
}
