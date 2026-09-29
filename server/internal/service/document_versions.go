package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/document"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Page versions and restore (C-01 §5.2; G1-04a, UNI-678). Versions are
// append-only: a manual version snapshots the working copy when it changed
// since the last version; restore appends a `restore` version carrying the
// old content, writes it into the working copy and bumps the revision - the
// restored-from row is never touched. A file version is restored through
// G1-03's RestoreFileVersion (it points back at the existing file_id).

const (
	idempotencyScopeDocumentPageCreate    = "documents.pages.create"
	idempotencyScopeDocumentVersionCreate = "documents.versions.create"

	maxDocumentVersionLabel    = 200
	defaultDocumentVersionPage = 50
	maxDocumentVersionPage     = 100
)

// emptyPageContent stands in for a page that was never written: a version
// always carries content (document_versions_payload_check).
var emptyPageContent = []byte(`{"type":"doc","content":[]}`)

func errDocumentVersionUnchanged() error {
	return coded(http.StatusConflict, "document_version_unchanged", "bản làm việc chưa đổi so với phiên bản gần nhất")
}

// CreateDocumentVersionInput is POST /documents/{id}/versions.
type CreateDocumentVersionInput struct {
	Label          string
	IdempotencyKey string
}

// CreateDocumentVersion takes a manual version of a page's working copy.
// Nothing changed since the latest version -> document_version_unchanged; a
// retry with the same Idempotency-Key replays the version it created.
func (s *DocumentService) CreateDocumentVersion(ctx context.Context, actor Actor, documentID string, in CreateDocumentVersionInput) (db.DocumentVersion, error) {
	label := strings.TrimSpace(in.Label)
	if len([]rune(label)) > maxDocumentVersionLabel {
		return db.DocumentVersion{}, Invalid("nhãn phiên bản tối đa 200 ký tự")
	}
	var out db.DocumentVersion
	err := s.withDocumentMutation(ctx, actor, documentID, DocumentLevelEdit, func(q *db.Queries, doc db.Document, access DocumentAccess) error {
		if doc.ArchivedAt.Valid {
			return errDocumentDeleted()
		}
		if doc.Kind != DocumentKindPage {
			return Invalid("phiên bản tệp đi qua versions/commit")
		}
		opts := IdempotencyOptions{
			Fingerprint:        IdempotencyFingerprint(idempotencyScopeDocumentVersionCreate, doc.ID, label),
			RequireFingerprint: true,
		}
		replay, commit, err := BeginIdempotent(ctx, q, doc.OrganizationID, doc.WorkspaceID, idempotencyScopeDocumentVersionCreate, in.IdempotencyKey, actor.ID, opts)
		if err != nil {
			return NormalizeIdempotencyError(err)
		}
		if replay != nil {
			out, err = replayedVersion(ctx, q, doc, replay.Body)
			return err
		}
		// The row holds jsonb's own spelling of the content; the version
		// stores (and size_bytes measures) the sanitizer's, like
		// content_bytes does.
		raw := doc.Content
		if len(raw) == 0 {
			raw = emptyPageContent
		}
		content, _, err := document.Sanitize(raw)
		if err != nil {
			return documentServiceError(err)
		}
		latest, err := q.GetLatestDocumentVersion(ctx, db.GetLatestDocumentVersionParams{
			OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
		})
		switch {
		case err == nil:
			if latest.Kind == DocumentKindPage && sameJSON(latest.Content, content) {
				return errDocumentVersionUnchanged()
			}
		case errors.Is(err, pgx.ErrNoRows):
		default:
			return err
		}
		if err := s.consumePageBytes(ctx, q, actor, doc, int64(len(content))); err != nil {
			return err
		}
		v, err := q.InsertDocumentVersion(ctx, db.InsertDocumentVersionParams{
			ID:             util.NewID(),
			OrganizationID: doc.OrganizationID,
			WorkspaceID:    doc.WorkspaceID,
			DocumentID:     doc.ID,
			Version:        doc.CurrentVersion + 1,
			Kind:           DocumentKindPage,
			Reason:         "manual",
			Label:          pgtype.Text{String: label, Valid: label != ""},
			Content:        content,
			SizeBytes:      int64(len(content)),
			CreatedBy:      actor.ID,
			CreatedByKind:  string(actor.Kind),
		})
		if err != nil {
			return err
		}
		if _, err := q.MarkDocumentVersioned(ctx, db.MarkDocumentVersionedParams{
			CurrentVersion: v.Version, ID: doc.ID, OrganizationID: doc.OrganizationID,
			WorkspaceID: doc.WorkspaceID, ExpectedVersion: doc.CurrentVersion,
		}); err != nil {
			return err
		}
		if err := auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: doc.OrganizationID,
			WorkspaceID:    doc.WorkspaceID,
			Actor:          actor,
			Action:         audit.ActionDocumentVersionCreated,
			ResourceType:   "document",
			ResourceID:     doc.ID,
			Changes: audit.Diff(nil, map[string]any{
				"version": v.Version, "version_id": v.ID, "reason": v.Reason, "size_bytes": v.SizeBytes,
			}),
		}, versionCreatedEvent(doc, v)); err != nil {
			return err
		}
		if err := storeVersionReplay(commit, http.StatusCreated, v); err != nil {
			return err
		}
		out = v
		return nil
	})
	return out, err
}

func versionCreatedEvent(doc db.Document, v db.DocumentVersion) audit.Event {
	return audit.Event{Topic: "document.version_created", Payload: map[string]string{
		"document_id": doc.ID, "version_id": v.ID, "workspace_id": doc.WorkspaceID,
	}}
}

// versionReplay is what the idempotency ledger keeps for a page version
// command: the ids, never the content - a replay re-reads the rows.
type versionReplay struct {
	Version int32 `json:"version"`
}

func storeVersionReplay(commit func(int, []byte) error, status int, v db.DocumentVersion) error {
	body, err := json.Marshal(versionReplay{Version: v.Version})
	if err != nil {
		return err
	}
	return commit(status, body)
}

func replayedVersion(ctx context.Context, q *db.Queries, doc db.Document, body []byte) (db.DocumentVersion, error) {
	var r versionReplay
	if err := json.Unmarshal(body, &r); err != nil {
		return db.DocumentVersion{}, err
	}
	v, err := q.GetDocumentVersion(ctx, db.GetDocumentVersionParams{
		OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID, Version: r.Version,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.DocumentVersion{}, ErrNotFound
	}
	return v, err
}

// consumePageBytes meters page bytes on storage.bytes inside the caller's
// transaction, after the document row lock (the shared order: document row
// -> files rows -> subscription). Only growth is checked: a save that
// shrinks the page, or costs nothing, always passes. Without a wired
// EntitlementService there is no quota to enforce.
func (s *DocumentService) consumePageBytes(ctx context.Context, q *db.Queries, actor Actor, doc db.Document, delta int64) error {
	if s.entitlements == nil || delta <= 0 {
		return nil
	}
	err := s.entitlements.Consume(ctx, q, ConsumeInput{
		OrganizationID: doc.OrganizationID,
		WorkspaceID:    doc.WorkspaceID,
		Meter:          FeatureStorageBytes,
		Delta:          delta,
		Actor:          actor,
		RefType:        "document_page",
		RefID:          doc.ID,
	})
	if errors.Is(err, ErrQuotaExceeded) {
		s.metrics.IncDocumentQuotaRejected(documentMetricKindPage)
	}
	return err
}

// ListDocumentVersionsInput is GET /documents/{id}/versions.
type ListDocumentVersionsInput struct {
	Cursor string
	Limit  int
}

// DocumentVersionPage is one page of history, newest first. Versions carry
// no content; NextCursor is empty on the last page.
type DocumentVersionPage struct {
	Versions   []db.DocumentVersion
	NextCursor string
}

type versionCursor struct {
	V *int32 `json:"v"`
}

func encodeVersionCursor(v int32) string {
	raw, _ := json.Marshal(versionCursor{V: &v})
	return base64.RawURLEncoding.EncodeToString(raw)
}

func decodeVersionCursor(s string) (pgtype.Int4, error) {
	if s == "" {
		return pgtype.Int4{}, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return pgtype.Int4{}, Invalid("cursor không hợp lệ")
	}
	var c versionCursor
	if err := json.Unmarshal(raw, &c); err != nil || c.V == nil || *c.V <= 0 {
		return pgtype.Int4{}, Invalid("cursor không hợp lệ")
	}
	return pgtype.Int4{Int32: *c.V, Valid: true}, nil
}

// ListDocumentVersions pages a document's history for any reader.
func (s *DocumentService) ListDocumentVersions(ctx context.Context, actor Actor, documentID string, in ListDocumentVersionsInput) (DocumentVersionPage, error) {
	before, err := decodeVersionCursor(in.Cursor)
	if err != nil {
		return DocumentVersionPage{}, err
	}
	limit := in.Limit
	if limit <= 0 {
		limit = defaultDocumentVersionPage
	}
	if limit > maxDocumentVersionPage {
		limit = maxDocumentVersionPage
	}
	doc, _, err := s.authorizeDocument(ctx, actor, documentID, DocumentLevelView)
	if err != nil {
		return DocumentVersionPage{}, err
	}
	rows, err := s.q.ListDocumentVersionsPage(ctx, db.ListDocumentVersionsPageParams{
		OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
		BeforeVersion: before, MaxRows: int32(limit + 1),
	})
	if err != nil {
		return DocumentVersionPage{}, err
	}
	page := DocumentVersionPage{Versions: make([]db.DocumentVersion, 0, len(rows))}
	for i, r := range rows {
		if i == limit {
			page.NextCursor = encodeVersionCursor(page.Versions[limit-1].Version)
			break
		}
		page.Versions = append(page.Versions, db.DocumentVersion{
			ID: r.ID, OrganizationID: r.OrganizationID, WorkspaceID: r.WorkspaceID, DocumentID: r.DocumentID,
			Version: r.Version, Kind: r.Kind, Reason: r.Reason, Label: r.Label, FileID: r.FileID,
			MimeType: r.MimeType, SizeBytes: r.SizeBytes, ChecksumSha256: r.ChecksumSha256,
			RestoredFrom: r.RestoredFrom, EngineName: r.EngineName, EngineVersion: r.EngineVersion,
			ContractVersion: r.ContractVersion, ProtocolVersion: r.ProtocolVersion,
			CreatedBy: r.CreatedBy, CreatedByKind: r.CreatedByKind, CreatedAt: r.CreatedAt,
		})
	}
	return page, nil
}

// GetDocumentVersion reads one version (page content included) and logs a
// view of that version (C-01 §5.2).
func (s *DocumentService) GetDocumentVersion(ctx context.Context, actor Actor, documentID string, versionNo int32) (db.DocumentVersion, error) {
	doc, v, access, err := s.authorizeDocumentVersion(ctx, actor, documentID, versionNo, DocumentLevelView)
	if err != nil {
		return db.DocumentVersion{}, err
	}
	s.RecordDocumentRead(ctx, actor, doc, access, DocumentAccessView, &v.Version)
	return v, nil
}

// RestoreDocumentVersionInput is POST /documents/{id}/versions/{n}/restore.
// BaseRevision 0 restores over whatever the page holds (the contract's
// restore carries no body); a file restore always checks it (G1-03,
// document_version_conflict).
type RestoreDocumentVersionInput struct {
	Version        int32
	BaseRevision   int64
	IdempotencyKey string
}

// DocumentVersionResult is DocumentVersionResultSDO: the document after the
// command and the version it appended. File is set for file documents.
type DocumentVersionResult struct {
	View    DocumentView
	Version db.DocumentVersion
	File    *DocumentFileInfo
}

// RestoreDocumentVersion restores a page or a file version as a new version.
func (s *DocumentService) RestoreDocumentVersion(ctx context.Context, actor Actor, documentID string, in RestoreDocumentVersionInput) (DocumentVersionResult, error) {
	if !validActor(actor) || documentID == "" {
		return DocumentVersionResult{}, ErrNotFound
	}
	doc, err := s.q.GetDocumentByID(ctx, documentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return DocumentVersionResult{}, ErrNotFound
	}
	if err != nil {
		return DocumentVersionResult{}, err
	}
	// The kind never changes, so reading it before the gate only picks the
	// path; both paths gate the caller themselves and answer not found to
	// anyone who cannot read the document.
	if doc.Kind == DocumentKindFile {
		return s.restoreFileDocumentVersion(ctx, actor, documentID, in)
	}
	var out DocumentVersionResult
	err = s.withDocumentMutation(ctx, actor, documentID, DocumentLevelEdit, func(q *db.Queries, locked db.Document, access DocumentAccess) error {
		if locked.ArchivedAt.Valid {
			return errDocumentDeleted()
		}
		opts := IdempotencyOptions{
			Fingerprint: IdempotencyFingerprint(idempotencyScopeDocumentVersionRestore, locked.ID,
				strconv.FormatInt(in.BaseRevision, 10), strconv.Itoa(int(in.Version))),
			RequireFingerprint: true,
		}
		replay, commit, err := BeginIdempotent(ctx, q, locked.OrganizationID, locked.WorkspaceID, idempotencyScopeDocumentVersionRestore, in.IdempotencyKey, actor.ID, opts)
		if err != nil {
			return NormalizeIdempotencyError(err)
		}
		if replay != nil {
			v, err := replayedVersion(ctx, q, locked, replay.Body)
			if err != nil {
				return err
			}
			view, err := s.documentView(ctx, q, actor, locked)
			out = DocumentVersionResult{View: view, Version: v}
			return err
		}
		if in.BaseRevision != 0 && in.BaseRevision != locked.Revision {
			return errRevisionConflict(locked.Revision)
		}
		src, err := q.GetDocumentVersion(ctx, db.GetDocumentVersionParams{
			OrganizationID: locked.OrganizationID, WorkspaceID: locked.WorkspaceID, DocumentID: locked.ID, Version: in.Version,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if src.Kind != DocumentKindPage || len(src.Content) == 0 {
			return Invalid("phiên bản này không phải phiên bản trang")
		}
		// The version was sanitized when it was taken; running the current
		// schema over it again also rebuilds the text columns.
		content, text, err := document.Sanitize(src.Content)
		if err != nil {
			return documentServiceError(err)
		}
		size := int64(len(content))
		if err := s.consumePageBytes(ctx, q, actor, locked, size+size-int64(locked.ContentBytes)); err != nil {
			return err
		}
		v, err := q.InsertDocumentVersion(ctx, db.InsertDocumentVersionParams{
			ID:             util.NewID(),
			OrganizationID: locked.OrganizationID,
			WorkspaceID:    locked.WorkspaceID,
			DocumentID:     locked.ID,
			Version:        locked.CurrentVersion + 1,
			Kind:           DocumentKindPage,
			Reason:         "restore",
			Content:        content,
			SizeBytes:      size,
			RestoredFrom:   pgtype.Int4{Int32: src.Version, Valid: true},
			CreatedBy:      actor.ID,
			CreatedByKind:  string(actor.Kind),
		})
		if err != nil {
			return err
		}
		updated, err := q.RestoreDocumentPage(ctx, db.RestoreDocumentPageParams{
			Content:          content,
			ContentText:      text,
			SearchText:       documentSearchText(locked.Title, text),
			ContentBytes:     int32(size),
			CurrentVersion:   v.Version,
			UpdatedBy:        actor.ID,
			UpdatedByKind:    string(actor.Kind),
			ID:               locked.ID,
			OrganizationID:   locked.OrganizationID,
			WorkspaceID:      locked.WorkspaceID,
			ExpectedRevision: locked.Revision,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return errRevisionConflict(locked.Revision)
		}
		if err != nil {
			return err
		}
		// C-01 §14.2: every asset the restored content references loses its
		// orphan mark in this transaction, so a restore never shows a broken
		// image; the ones it no longer references are stamped.
		if err := syncDocumentAssetRefs(ctx, q, updated); err != nil {
			return err
		}
		if err := auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: locked.OrganizationID,
			WorkspaceID:    locked.WorkspaceID,
			Actor:          actor,
			Action:         audit.ActionDocumentVersionRestored,
			ResourceType:   "document",
			ResourceID:     locked.ID,
			Changes: audit.Diff(map[string]any{"revision": strconv.FormatInt(locked.Revision, 10)}, map[string]any{
				"revision": strconv.FormatInt(updated.Revision, 10), "version": v.Version, "version_id": v.ID,
				"reason": v.Reason, "restored_from": src.Version,
			}),
		}, versionCreatedEvent(locked, v)); err != nil {
			return err
		}
		if err := storeVersionReplay(commit, http.StatusOK, v); err != nil {
			return err
		}
		view, err := s.documentView(ctx, q, actor, updated)
		out = DocumentVersionResult{View: view, Version: v}
		return err
	})
	return out, err
}

// restoreFileDocumentVersion is G1-03's binary restore with the page view
// around it (breadcrumbs; the level it already re-derived).
func (s *DocumentService) restoreFileDocumentVersion(ctx context.Context, actor Actor, documentID string, in RestoreDocumentVersionInput) (DocumentVersionResult, error) {
	res, err := s.RestoreFileVersion(ctx, actor, documentID, RestoreFileVersionInput(in))
	if err != nil {
		return DocumentVersionResult{}, err
	}
	crumbs, err := s.documentBreadcrumbs(ctx, s.q, actor, res.Document)
	if err != nil {
		return DocumentVersionResult{}, err
	}
	file := res.File
	return DocumentVersionResult{
		View:    DocumentView{Document: res.Document, Access: res.Access, Breadcrumbs: crumbs, File: &file},
		Version: res.Version,
		File:    &file,
	}, nil
}
