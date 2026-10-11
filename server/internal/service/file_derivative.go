package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/outbox"
	"github.com/unicomhub/uniwork/server/internal/storage"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// File derivatives (spec 2026-09-22 §276, H15/UNI-1088). A derivative is an
// ordinary files row, uploaded under its source's purpose and scope and
// claimed in the same transaction that writes its file_derivatives link. It is
// read through Open with OpenInput.Variant, authorized as its source, and the
// collector keeps it exactly as long as the source is not deleted.

// thumbProcessorVersion is bumped when makeThumbnail changes its output.
const thumbProcessorVersion = 1

// fileDerivativeActor stages derived files; no person asked for them.
var fileDerivativeActor = audit.Actor{Kind: audit.KindSystem, ID: "file-derivatives"}

// topicFileThumbnailRequested asks the slow lane for a thumbnail.
const topicFileThumbnailRequested = "file.thumbnail_requested"

// requestFileThumbnail queues a thumbnail for a just-claimed file, in the
// caller's transaction. Types makeThumbnail cannot improve ask for nothing.
func requestFileThumbnail(ctx context.Context, q *db.Queries, actor audit.Actor, file files.File, scope files.Scope) error {
	if !fileThumbnailable(file.ContentType) || scope.OrganizationID == "" {
		return nil
	}
	return auditRecorder.Emit(ctx, q, actor, audit.Event{
		Topic:          topicFileThumbnailRequested,
		OrganizationID: scope.OrganizationID,
		WorkspaceID:    scope.WorkspaceID,
		Payload:        map[string]string{"file_id": string(file.ID), "organization_id": scope.OrganizationID},
	})
}

// CreateThumbnail makes the thumb derivative of a ready, claimed file in
// organizationID. Anything that makes a thumbnail pointless or impossible -
// an unknown id, another tenant, a type or size with nothing to gain - is a
// permanent no-op so the outbox does not retry it; only storage and database
// failures return an error.
func (s *FileService) CreateThumbnail(ctx context.Context, organizationID string, id files.FileID) error {
	if organizationID == "" || id == "" {
		return nil
	}
	if _, err := s.q.GetFileDerivative(ctx, db.GetFileDerivativeParams{
		SourceFileID: string(id), Variant: string(files.VariantThumb), OrganizationID: organizationID,
	}); err == nil {
		return nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("files: derivative lookup: %w", err)
	}
	rows, err := s.q.ListOrgFilesWithSessionsByIDs(ctx, db.ListOrgFilesWithSessionsByIDsParams{
		OrganizationID: fileText(organizationID), FileIds: []string{string(id)},
	})
	if err != nil {
		return fmt.Errorf("files: derivative source: %w", err)
	}
	if len(rows) != 1 || fileState(rows[0].File) != nil ||
		files.SessionStatus(rows[0].FileUploadSession.Status) != files.SessionClaimed ||
		!fileThumbnailable(rows[0].File.ContentType.String) {
		return nil
	}
	src, sess := rows[0].File, rows[0].FileUploadSession
	obj, err := s.store.Open(ctx, locator(src), storage.ReadOptions{})
	if err != nil {
		return files.StorageUnavailable(err)
	}
	raw, err := io.ReadAll(obj.Body)
	_ = obj.Body.Close()
	if err != nil {
		return files.StorageUnavailable(err)
	}
	thumb, contentType, ok := makeThumbnail(raw, src.ContentType.String)
	if !ok {
		return nil
	}
	scope := sessionScope(sess)
	purpose := files.UploadPurpose(sess.Purpose)
	up, err := s.Upload(ctx, files.UploadInput{
		Actor:          fileDerivativeActor,
		Purpose:        purpose,
		Scope:          scope,
		IdempotencyKey: fmt.Sprintf("derivative/%s/%s/v%d", id, files.VariantThumb, thumbProcessorVersion),
		Filename:       "thumb." + strings.TrimPrefix(contentType, "image/"),
		Body:           bytes.NewReader(thumb),
	})
	if err != nil {
		return err
	}
	return s.inTx(ctx, func(q *db.Queries) error {
		if _, err := s.ClaimInTx(ctx, q, files.ClaimInput{
			Actor: fileDerivativeActor, Purpose: purpose, Scope: scope, FileIDs: []files.FileID{up.File.ID},
		}); err != nil {
			return err
		}
		n, err := q.InsertFileDerivative(ctx, db.InsertFileDerivativeParams{
			SourceFileID: string(id), Variant: string(files.VariantThumb), FileID: string(up.File.ID),
			ProcessorVersion: thumbProcessorVersion, OrganizationID: organizationID,
		})
		if err != nil {
			return fmt.Errorf("files: derivative link: %w", err)
		}
		if n == 0 {
			// A concurrent delivery linked its own copy first; this one goes
			// back to the collector.
			return s.ReleaseInTx(ctx, q, []files.FileID{up.File.ID})
		}
		return nil
	})
}

// derivativeRecord is the derived file Open should stream instead of the
// source, if one exists in the same scope and can be served.
func (s *FileService) derivativeRecord(ctx context.Context, in files.OpenInput) (fileRecord, bool, error) {
	if in.Variant == "" || in.Scope.OrganizationID == "" {
		return fileRecord{}, false, nil
	}
	id, err := s.q.GetFileDerivative(ctx, db.GetFileDerivativeParams{
		SourceFileID: string(in.FileID), Variant: string(in.Variant), OrganizationID: in.Scope.OrganizationID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return fileRecord{}, false, nil
	}
	if err != nil {
		return fileRecord{}, false, fmt.Errorf("files: derivative lookup: %w", err)
	}
	records, err := s.loadResolvable(ctx, in.Scope, []files.FileID{files.FileID(id)})
	if err != nil {
		return fileRecord{}, false, err
	}
	rec, ok := records[files.FileID(id)]
	if !ok || fileState(rec.file) != nil || sessionGrant(rec.session, s.now()) != nil {
		return fileRecord{}, false, nil
	}
	return rec, true, nil
}

// fileDerivativeProvider holds a derived file while its source is not
// deleted. FileService registers it itself: the link table is its own, so no
// module catalogue row names it.
type fileDerivativeProvider struct{}

func (fileDerivativeProvider) Name() string                    { return "files.derivatives" }
func (fileDerivativeProvider) Purposes() []files.UploadPurpose { return nil }

func (fileDerivativeProvider) HeldBy(ctx context.Context, q *db.Queries, ids []files.FileID) (map[files.FileID]files.HoldReason, error) {
	out := make(map[files.FileID]files.HoldReason, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	want := make([]string, len(ids))
	for i, id := range ids {
		want[i] = string(id)
	}
	held, err := q.ListHeldFileDerivatives(ctx, want)
	if err != nil {
		return nil, err
	}
	for _, id := range held {
		out[files.FileID(id)] = files.HoldActive
	}
	return out, nil
}

// FileThumbnailConsumer makes thumbnails on the slow lane: decoding a 25 MiB
// photo is CPU work no request should wait for.
type FileThumbnailConsumer struct {
	files *FileService
}

func NewFileThumbnailConsumer(f *FileService) *FileThumbnailConsumer {
	return &FileThumbnailConsumer{files: f}
}

func (*FileThumbnailConsumer) Name() string     { return "file_thumbnail" }
func (*FileThumbnailConsumer) Topics() []string { return []string{topicFileThumbnailRequested} }

// DeliveryTimeout leaves room to read and decode a 25 MiB original.
func (*FileThumbnailConsumer) DeliveryTimeout() time.Duration { return 60 * time.Second }

func (c *FileThumbnailConsumer) Handle(ctx context.Context, ev outbox.Row) error {
	payload := map[string]string{}
	if err := json.Unmarshal([]byte(ev.Payload), &payload); err != nil {
		return fmt.Errorf("file_thumbnail: payload of %s: %w", ev.ID, err)
	}
	org := strings.TrimSpace(payload["organization_id"])
	if org == "" && ev.OrganizationID.Valid {
		org = ev.OrganizationID.String
	}
	return c.files.CreateThumbnail(ctx, org, files.FileID(strings.TrimSpace(payload["file_id"])))
}
