package service

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/document"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Document copies (G2-07 / UNI-690; C-01 §14): POST /documents/{documentID}/copies
// with consent: "copy". A copy is a new standalone document whose first version
// references the source's bytes (no byte is copied - FileService counts one
// file_id once, T1-Q9) and whose ACL is the source's snapshot: the copy keeps
// the source's acl_owner_id, visibility and live share rows, so copying never
// hands the copier manage over content someone else owns and never widens
// access. Provenance (source document/version/revision/checksum/format) is
// recorded on the copy row; the source and its history are untouched.
//
// A cross-format copy is the Q7 accept (G2-07b): with a job id the copy's
// first version is a completed convert job's output
// (document_copy_convert.go); without one it is the same-format copy below.

const (
	idempotencyScopeDocumentCopy = "documents.copy"
	// documentCopyConsent is the only accepted consent value (C-01 §14.4).
	documentCopyConsent = "copy"
)

// CopyDocumentInput is one explicit copy command.
type CopyDocumentInput struct {
	Consent        string
	Title          string
	ParentID       string
	IdempotencyKey string
	// JobID, when set, accepts a completed Q7 convert job of this document:
	// the copy's first version is the job's OOXML output
	// (document_copy_convert.go) instead of the source's own bytes.
	JobID string
	// UploadID, when set, creates the copy's first version from a staged
	// upload of this document by the same actor instead of the source's head.
	UploadID string
}

func errCopyConsentRequired() error {
	return coded(http.StatusConflict, "copy_consent_required", "bản sao cần consent: \"copy\"")
}

func errOwnerRequiresCopy() error {
	return coded(http.StatusConflict, "owner_requires_copy",
		"tài liệu thuộc sở hữu (C-14); tạo bản sao qua owner service hoặc dùng chức năng sao chép khác")
}

// requireCopySeat is the workspace seat the copy and the Q7 accept need, read
// through q. Only the missing seat (RequireMemberQ's plain ErrForbidden)
// becomes workspace_seat_required; a suspended organization, a deactivated
// member and a database error pass through as they are.
func (s *DocumentService) requireCopySeat(ctx context.Context, q *db.Queries, workspaceID, userID string) error {
	_, err := s.ws.RequireMemberQ(ctx, q, workspaceID, userID)
	if errors.Is(err, ErrForbidden) {
		return errWorkspaceSeatRequired()
	}
	return err
}

// CopyDocument creates the standalone copy. The caller needs edit on the
// source: the copy carries the source's ACL, so copy is a write on content,
// not a re-publication of it.
func (s *DocumentService) CopyDocument(ctx context.Context, actor Actor, documentID string, in CopyDocumentInput) (DocumentFileResult, error) {
	fs, err := s.fileService()
	if err != nil {
		return DocumentFileResult{}, err
	}
	if actor.Kind != audit.KindHuman || !validActor(actor) {
		return DocumentFileResult{}, ErrForbidden
	}
	if strings.TrimSpace(in.Consent) != documentCopyConsent {
		return DocumentFileResult{}, errCopyConsentRequired()
	}
	src, access, err := s.authorizeDocument(ctx, actor, documentID, DocumentLevelEdit)
	if err != nil {
		return DocumentFileResult{}, err
	}
	if src.ArchivedAt.Valid {
		return DocumentFileResult{}, errDocumentDeleted()
	}
	if err := refuseFolder(src); err != nil {
		return DocumentFileResult{}, err
	}
	if src.Kind != DocumentKindFile {
		return DocumentFileResult{}, CodedError{Code: document.ErrCodeInvalid, Status: http.StatusBadRequest,
			Msg: "chỉ tài liệu tệp được sao chép ở endpoint này", Fields: map[string]any{"reason": "page_copy_not_supported"}}
	}
	// §13.5: an owned (work-product) document copies only through the owner
	// seam. This endpoint has no delegation path (C-14 is not implemented), so
	// a caller who passed the edit gate is refused by name instead of getting
	// a standalone copy that could not carry the owner - and never widens the
	// audience. Authorization ran first, so an outsider still learns nothing.
	if src.OwnerID.Valid {
		return DocumentFileResult{}, errOwnerRequiresCopy()
	}
	// The copy is a create in the source's workspace, so it needs the seat
	// every create needs (CreateFileDocument, CreatePage): edit through a
	// share is not one (G5-12).
	if err := s.requireCopySeat(ctx, s.q, src.WorkspaceID, actor.ID); err != nil {
		return DocumentFileResult{}, err
	}
	in.JobID = strings.TrimSpace(in.JobID)
	in.UploadID = strings.TrimSpace(in.UploadID)
	if in.JobID != "" && in.UploadID != "" {
		return DocumentFileResult{}, Invalid("upload_id và job_id loại trừ lẫn nhau")
	}
	if in.JobID != "" {
		return s.acceptConversion(ctx, fs, actor, src, access, in)
	}
	current, err := s.currentFileVersion(ctx, s.q, src)
	if err != nil {
		return DocumentFileResult{}, err
	}
	if current == nil || !current.FileID.Valid {
		return DocumentFileResult{}, ErrNotFound
	}
	raw := in.Title
	if strings.TrimSpace(raw) == "" {
		raw = copyTitle(src.Title)
	}
	title, err := normalizeDocumentTitle(DocumentKindFile, raw)
	if err != nil {
		return DocumentFileResult{}, err
	}
	if in.ParentID != "" {
		if err := s.authorizeParentIn(ctx, actor, in.ParentID, src.WorkspaceID); err != nil {
			return DocumentFileResult{}, err
		}
	}
	fpSource := current.ID
	if in.UploadID != "" {
		fpSource = "upload:" + in.UploadID
	}
	opts := IdempotencyOptions{
		Fingerprint:        IdempotencyFingerprint(idempotencyScopeDocumentCopy, src.ID, fpSource, title, in.ParentID),
		RequireFingerprint: true,
	}
	replay, err := PeekIdempotent(ctx, s.q, src.OrganizationID, src.WorkspaceID, idempotencyScopeDocumentCopy, in.IdempotencyKey, actor.ID, opts)
	if err != nil {
		return DocumentFileResult{}, NormalizeIdempotencyError(err)
	}
	if replay != nil {
		return replayWithAccess(replay.Body, access)
	}
	scope := documentScope(src.OrganizationID, src.WorkspaceID)
	targetFileID := current.FileID.String
	if in.UploadID != "" {
		if err := s.verifyCopyUpload(ctx, s.q, fs, actor, src, in.UploadID); err != nil {
			return DocumentFileResult{}, err
		}
		targetFileID = in.UploadID
	}
	file, err := resolveUpload(ctx, fs, scope, targetFileID)
	if err != nil {
		return DocumentFileResult{}, err
	}
	if in.UploadID != "" {
		if maxBytes := s.documentFileMaxBytes(); maxBytes > 0 && file.SizeBytes > maxBytes {
			return DocumentFileResult{}, documentFileError(files.TooLarge(maxBytes))
		}
	}

	var res DocumentFileResult
	err = s.withDocumentMutation(ctx, actor, src.ID, DocumentLevelEdit, func(q *db.Queries, locked db.Document, lockedAccess DocumentAccess) error {
		if locked.ArchivedAt.Valid {
			return errDocumentDeleted()
		}
		replay, commit, err := BeginIdempotent(ctx, q, locked.OrganizationID, locked.WorkspaceID, idempotencyScopeDocumentCopy, in.IdempotencyKey, actor.ID, opts)
		if err != nil {
			return NormalizeIdempotencyError(err)
		}
		if replay != nil {
			res, err = replayWithAccess(replay.Body, lockedAccess)
			return err
		}
		// Membership again, through the transaction: a removal that
		// committed since the pre-flight wins.
		if err := s.requireCopySeat(ctx, q, locked.WorkspaceID, actor.ID); err != nil {
			return err
		}
		if locked.FileVersionID.String != current.ID {
			if in.UploadID == "" {
				// A version landed between the read and the lock: the file, the
				// source version and the source revision must describe one
				// snapshot, so the caller retries against the new version.
				return errDocumentVersionConflict(locked.Revision)
			}
			current, err = s.currentFileVersion(ctx, q, locked)
			if err != nil {
				return err
			}
			if current == nil || !current.FileID.Valid {
				return ErrNotFound
			}
		}
		if in.ParentID != "" {
			// Root (G1-04b) replaced requireParentInTx with lockPageParent:
			// the parent must be a live page or folder of the same tenant pair the caller
			// may edit, with room for one more level (locked for the create).
			if _, err := s.lockPageParent(ctx, q, actor, in.ParentID, locked.OrganizationID, locked.WorkspaceID, DocumentKindFile); err != nil {
				return err
			}
		}
		// Claim the file for the copy: for a head copy FileService counts the
		// bytes once per file_id (T1-Q9); for a staged upload_id (UNI-1872) the
		// upload is claimed once and consumes storage for the new document.
		claimed, err := fs.ClaimInTx(ctx, q, files.ClaimInput{
			Actor: actor, Purpose: files.DocumentFile, Scope: scope, FileIDs: []files.FileID{file.ID},
		})
		if err != nil {
			return documentFileError(err)
		}
		if s.store.afterClaim != nil {
			if err := s.store.afterClaim(); err != nil {
				return err
			}
		}
		copied := claimed[0]
		targetFormat := current.MimeType
		if in.UploadID != "" {
			inUse, err := q.DocumentFileInUse(ctx, db.DocumentFileInUseParams{
				OrganizationID: locked.OrganizationID, WorkspaceID: locked.WorkspaceID,
				FileID: pgtype.Text{String: string(file.ID), Valid: true},
			})
			if err != nil {
				return err
			}
			if inUse {
				return errUploadAlreadyCommitted()
			}
			if current.MimeType.String != copied.ContentType {
				return CodedError{Code: document.ErrCodeUnsupportedMedia, Status: http.StatusUnsupportedMediaType,
					Msg:    "phiên bản mới phải cùng định dạng với tài liệu",
					Fields: map[string]any{"reason": "format_changed"}}
			}
			if err := s.consumeStorage(ctx, q, actor, locked.OrganizationID, locked.WorkspaceID, copied); err != nil {
				return err
			}
			targetFormat = pgtype.Text{String: copied.ContentType, Valid: true}
		}
		docID, versionID := util.NewID(), util.NewID()
		doc, err := q.InsertDocument(ctx, db.InsertDocumentParams{
			ID: docID, OrganizationID: locked.OrganizationID, WorkspaceID: locked.WorkspaceID,
			ParentID: nullText(in.ParentID), Kind: DocumentKindFile, Title: title,
			Visibility:     locked.Visibility,
			WorkspaceLevel: locked.WorkspaceLevel,
			SearchText:     documentSearchText(title, ""),
			CurrentVersion: 1, FileVersionID: pgtype.Text{String: versionID, Valid: true},
			Revision:   1,
			AclOwnerID: locked.AclOwnerID,
			// Provenance of the copy (C-01 §14.3, DOC-005 §7.1). The reason
			// column stays NULL: this is a standalone copy, not a conversion.
			SourceDocumentID:     pgtype.Text{String: locked.ID, Valid: true},
			SourceVersionID:      pgtype.Text{String: current.ID, Valid: true},
			SourceRevision:       pgtype.Int8{Int64: locked.Revision, Valid: true},
			SourceFormat:         current.MimeType,
			TargetFormat:         targetFormat,
			SourceChecksumSha256: current.ChecksumSha256,
			CreatedBy:            actor.ID, CreatedByKind: string(actor.Kind),
			UpdatedBy: actor.ID, UpdatedByKind: string(actor.Kind),
			LastVersionAt: pgtype.Timestamptz{Time: time.Now(), Valid: true},
		})
		if err != nil {
			return err
		}
		version, err := q.InsertDocumentVersion(ctx, fileVersionParams(doc, versionID, 1, "upload", actor, copied, DocumentEngineInfo{}, pgtype.Int4{}))
		if err != nil {
			return err
		}
		if err := copyDocumentShares(ctx, q, locked, doc, actor); err != nil {
			return err
		}
		if err := auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: locked.OrganizationID, WorkspaceID: locked.WorkspaceID, Actor: actor,
			Action: audit.ActionDocumentCreated, ResourceType: "document", ResourceID: doc.ID,
			Changes: audit.Diff(nil, map[string]any{
				"title": doc.Title, "kind": doc.Kind, "version_id": version.ID, "file_id": string(copied.ID),
				"source_document_id": locked.ID, "source_version_id": current.ID, "reason": "copy",
			}),
		}, audit.Event{Topic: "document.created", Payload: map[string]string{
			"document_id": doc.ID, "workspace_id": locked.WorkspaceID,
		}}); err != nil {
			return err
		}
		access, err := s.effectiveLevel(ctx, q, actor, doc)
		if err != nil {
			return err
		}
		res = DocumentFileResult{Document: doc, Version: version, File: fileInfoOf(version, copied.Filename), Access: access}
		return storeDocumentFileResult(commit, http.StatusCreated, res)
	})
	if err != nil {
		return DocumentFileResult{}, err
	}
	return res, nil
}

type uploadOriginProvider interface {
	UploadOrigin(id files.FileID) (files.UploadPurpose, files.Scope, audit.Actor, string, bool)
}

// verifyCopyUpload enforces that uploadID was staged on src by actor in src's
// organization and workspace via UploadDocumentFile ("documents.upload:<docID>:...").
// Any mismatch (unknown id, head/create file, asset, another document, another
// actor, or another organization/workspace) fails closed as 404 (ErrNotFound).
func (s *DocumentService) verifyCopyUpload(ctx context.Context, q *db.Queries, fs files.Service, actor Actor, src db.Document, uploadID string) error {
	prefix := "documents.upload:" + src.ID + ":"
	sess, err := q.GetUploadSessionByFile(ctx, uploadID)
	if err == nil {
		if !sess.OrganizationID.Valid || sess.OrganizationID.String != src.OrganizationID ||
			!sess.WorkspaceID.Valid || sess.WorkspaceID.String != src.WorkspaceID ||
			sess.Purpose != string(files.DocumentFile) ||
			sess.CreatedByKind != string(actor.Kind) || sess.CreatedBy != actor.ID ||
			!strings.HasPrefix(sess.IdempotencyKey, prefix) {
			return ErrNotFound
		}
		return nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	for {
		if u, ok := fs.(interface{ Unwrap() files.Service }); ok {
			fs = u.Unwrap()
			continue
		}
		break
	}
	if origin, ok := fs.(uploadOriginProvider); ok {
		purpose, scope, upActor, idemKey, found := origin.UploadOrigin(files.FileID(uploadID))
		if found &&
			purpose == files.DocumentFile &&
			scope.OrganizationID == src.OrganizationID &&
			scope.WorkspaceID == src.WorkspaceID &&
			upActor == actor &&
			strings.HasPrefix(idemKey, prefix) {
			return nil
		}
	}
	return ErrNotFound
}

// copyDocumentShares snapshots the source's live grants onto the copy: the
// copy starts with exactly the audience the source had, minus nothing and
// plus nothing.
func copyDocumentShares(ctx context.Context, q *db.Queries, src, dst db.Document, actor Actor) error {
	shares, err := q.ListDocumentShares(ctx, db.ListDocumentSharesParams{
		OrganizationID: src.OrganizationID, WorkspaceID: src.WorkspaceID, DocumentID: src.ID,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return err
	}
	for _, share := range shares {
		if _, err := q.InsertDocumentShare(ctx, db.InsertDocumentShareParams{
			ID: util.NewID(), OrganizationID: dst.OrganizationID, WorkspaceID: dst.WorkspaceID,
			DocumentID: dst.ID, PrincipalType: share.PrincipalType, PrincipalID: share.PrincipalID,
			Level: share.Level, GrantedBy: actor.ID, GrantedByKind: string(actor.Kind),
		}); err != nil {
			return err
		}
	}
	return nil
}

// copyTitle names a copy without inventing a new title when the caller sent
// one.
func copyTitle(source string) string {
	title := strings.TrimSpace(source)
	if title == "" {
		return "Bản sao"
	}
	return title + " (bản sao)"
}
