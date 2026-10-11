package service

import (
	"bytes"
	"context"
	"image"
	"io"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/files"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// chatPhoto uploads and claims a chat image the way a chat send does.
func chatPhoto(t *testing.T, h *fileHarness, key string, body []byte) files.FileID {
	t.Helper()
	up, err := t3Upload(t, h, files.ChatAttachment, t3Scope, key, "photo.jpg", body)
	if err != nil {
		t.Fatalf("upload %s: %v", key, err)
	}
	if err := h.inTx(t, func(q *db.Queries) error {
		_, err := h.svc.ClaimInTx(context.Background(), q, files.ClaimInput{
			Actor: t3Actor, Purpose: files.ChatAttachment, Scope: t3Scope, FileIDs: []files.FileID{up.File.ID},
		})
		return err
	}); err != nil {
		t.Fatalf("claim %s: %v", key, err)
	}
	return up.File.ID
}

func openBytes(t *testing.T, h *fileHarness, in files.OpenInput) (files.File, []byte, error) {
	t.Helper()
	rd, err := h.svc.Open(context.Background(), in)
	if err != nil {
		return files.File{}, nil, err
	}
	defer rd.Close()
	raw, err := io.ReadAll(rd.Body)
	if err != nil {
		t.Fatal(err)
	}
	return rd.File, raw, nil
}

func TestFileThumbnailIsServedAsAVariantOfItsSource(t *testing.T) {
	h := newFileHarness(t, localFileBackend(), nil)
	ctx := context.Background()
	original := encodeJPEG(t, testPhoto(1600, 1200))
	id := chatPhoto(t, h, "thumb-src", original)

	// Before the derivative exists the variant is the original.
	if _, raw, err := openBytes(t, h, files.OpenInput{Scope: t3Scope, FileID: id, Variant: files.VariantThumb}); err != nil || !bytes.Equal(raw, original) {
		t.Fatalf("variant before generation = %d bytes, err %v; want the original", len(raw), err)
	}

	if err := h.svc.CreateThumbnail(ctx, t3Org, id); err != nil {
		t.Fatalf("CreateThumbnail: %v", err)
	}
	// A redelivered request is a no-op: still one derivative.
	if err := h.svc.CreateThumbnail(ctx, t3Org, id); err != nil {
		t.Fatalf("CreateThumbnail replay: %v", err)
	}
	if n := fileCountRows(t, h.pool, `SELECT count(*) FROM file_derivatives WHERE source_file_id = $1`, string(id)); n != 1 {
		t.Fatalf("derivatives = %d, want 1", n)
	}

	view, raw, err := openBytes(t, h, files.OpenInput{Scope: t3Scope, FileID: id, Variant: files.VariantThumb})
	if err != nil {
		t.Fatalf("open thumb: %v", err)
	}
	if view.ContentType != "image/jpeg" || view.SizeBytes != int64(len(raw)) || len(raw) >= len(original) {
		t.Fatalf("thumb view = %+v (%d bytes), original %d bytes", view, len(raw), len(original))
	}
	img, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil || img.Bounds().Dx() != 640 || img.Bounds().Dy() != 480 {
		t.Fatalf("thumb decodes to %v (err %v), want 640x480", img.Bounds(), err)
	}

	// No variant: the original, byte for byte.
	if _, raw, err := openBytes(t, h, files.OpenInput{Scope: t3Scope, FileID: id}); err != nil || !bytes.Equal(raw, original) {
		t.Fatalf("original = %d bytes, err %v", len(raw), err)
	}

	// The variant authorizes like the original: another tenant, or the same
	// tenant from another workspace, does not see that the file exists.
	for _, scope := range []files.Scope{
		{OrganizationID: t3OrgB, WorkspaceID: t3WS},
		{OrganizationID: t3Org},
	} {
		_, _, err := openBytes(t, h, files.OpenInput{Scope: scope, FileID: id, Variant: files.VariantThumb})
		t3Code(t, err, files.CodeNotFound)
	}
}

func TestFileThumbnailSkipsFilesItCannotImprove(t *testing.T) {
	h := newFileHarness(t, localFileBackend(), nil)
	ctx := context.Background()
	small := encodePNG(t, testPhoto(200, 100))
	id := chatPhoto(t, h, "thumb-small", small)
	if err := h.svc.CreateThumbnail(ctx, t3Org, id); err != nil {
		t.Fatalf("CreateThumbnail: %v", err)
	}
	if n := fileCountRows(t, h.pool, `SELECT count(*) FROM file_derivatives WHERE source_file_id = $1`, string(id)); n != 0 {
		t.Fatalf("derivatives = %d, want none for a small image", n)
	}
	// Unknown ids and other tenants are permanent no-ops, not retries.
	for _, c := range []struct {
		org string
		id  files.FileID
	}{{t3Org, "01J8ZQ0K7V9W1Y2X3Z4A5B6C99"}, {t3OrgB, id}} {
		if err := h.svc.CreateThumbnail(ctx, c.org, c.id); err != nil {
			t.Fatalf("CreateThumbnail(%s, %s) = %v, want nil", c.org, c.id, err)
		}
	}
	if _, raw, err := openBytes(t, h, files.OpenInput{Scope: t3Scope, FileID: id, Variant: files.VariantThumb}); err != nil || !bytes.Equal(raw, small) {
		t.Fatalf("variant without a derivative = %d bytes, err %v; want the original", len(raw), err)
	}
}

// A derivative lives exactly as long as its source: the collector keeps it
// while the source is live and takes it once the source is gone.
func TestFileThumbnailIsCollectedAfterItsSource(t *testing.T) {
	h := newGCHarness(t, FileGCDestructive)
	ctx := context.Background()
	src := chatPhoto(t, h.fileHarness, "gc-thumb-src", encodeJPEG(t, testPhoto(1600, 1200)))
	h.mem.hold(src, files.HoldActive)
	if err := h.svc.CreateThumbnail(ctx, t3Org, src); err != nil {
		t.Fatalf("CreateThumbnail: %v", err)
	}
	var thumb string
	if err := h.pool.QueryRow(ctx, `SELECT file_id FROM file_derivatives WHERE source_file_id = $1`, string(src)).Scan(&thumb); err != nil {
		t.Fatalf("derivative row: %v", err)
	}

	h.clock.Advance(25 * time.Hour)
	h.sweep(t)
	h.wantStatus(t, files.FileID(thumb), files.StatusReady)

	h.mem.release(src)
	h.releaseT3(t, src)
	h.sweep(t)
	h.wantStatus(t, src, files.StatusDeleted)
	h.sweep(t)
	h.wantStatus(t, files.FileID(thumb), files.StatusDeleted)
}
