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
// A conversion engine is not bound yet (Q7 blocker), so a lossy or
// cross-format copy has nothing to run: the same-format copy is the path this
// endpoint implements, and the Office job routes refuse convert/export with
// unsupported_operation until an engine lane binds them.

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
}

func errCopyConsentRequired() error {
	return coded(http.StatusConflict, "copy_consent_required", "bản sao cần consent: \"copy\"")
}

func errOwnerRequiresCopy() error {
	return coded(http.StatusConflict, "owner_requires_copy",
		"tài liệu thuộc sở hữu (C-14); tạo bản sao qua owner service hoặc dùng chức năng sao chép khác")
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
	current, err := s.currentFileVersion(ctx, s.q, src)
	if err != nil {
		return DocumentFileResult{}, err
	}
	if current == nil || !current.FileID.Valid {
		return DocumentFileResult{}, ErrNotFound
	}
	title := strings.TrimSpace(in.Title)
	if title == "" {
		title = copyTitle(src.Title)
	}
	if len([]rune(title)) > 500 {
		return DocumentFileResult{}, Invalid("tên tài liệu tối đa 500 ký tự")
	}
	if in.ParentID != "" {
		if _, _, err := s.authorizeDocument(ctx, actor, in.ParentID, DocumentLevelEdit); err != nil {
			return DocumentFileResult{}, err
		}
	}
	scope := documentScope(src.OrganizationID, src.WorkspaceID)
	file, err := resolveUpload(ctx, fs, scope, current.FileID.String)
	if err != nil {
		return DocumentFileResult{}, err
	}
	opts := IdempotencyOptions{
		Fingerprint:        IdempotencyFingerprint(idempotencyScopeDocumentCopy, src.ID, current.ID, title, in.ParentID),
		RequireFingerprint: true,
	}
	replay, err := PeekIdempotent(ctx, s.q, src.OrganizationID, src.WorkspaceID, idempotencyScopeDocumentCopy, in.IdempotencyKey, actor.ID, opts)
	if err != nil {
		return DocumentFileResult{}, NormalizeIdempotencyError(err)
	}
	if replay != nil {
		return replayWithAccess(replay.Body, access)
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
		if locked.FileVersionID.String != current.ID {
			// A version landed between the read and the lock: the file, the
			// source version and the source revision must describe one
			// snapshot, so the caller retries against the new version.
			return errDocumentVersionConflict(locked.Revision)
		}
		if in.ParentID != "" {
			// Root (G1-04b) replaced requireParentInTx with lockPageParent:
			// the parent must be a live page of the same tenant pair the caller
			// may edit, with room for one more level (locked for the create).
			if _, err := s.lockPageParent(ctx, q, actor, in.ParentID, locked.OrganizationID, locked.WorkspaceID); err != nil {
				return err
			}
		}
		// Claim the same file for the copy: FileService counts the bytes once
		// per file_id (T1-Q9), so a copy adds references, not storage, and no
		// quota is consumed again.
		claimed, err := fs.ClaimInTx(ctx, q, files.ClaimInput{
			Actor: actor, Purpose: files.DocumentFile, Scope: scope, FileIDs: []files.FileID{file.ID},
		})
		if err != nil {
			return documentFileError(err)
		}
		copied := claimed[0]
		docID, versionID := util.NewID(), util.NewID()
		doc, err := q.InsertDocument(ctx, db.InsertDocumentParams{
			ID: docID, OrganizationID: locked.OrganizationID, WorkspaceID: locked.WorkspaceID,
			ParentID: nullText(in.ParentID), Kind: DocumentKindFile, Title: title,
			Visibility:     locked.Visibility,
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
			TargetFormat:         current.MimeType,
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
