package service

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
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

// Document bytes (C-01 §14.2; G1-03, UNI-677). Every byte goes through
// FileService (FS-C1): Documents stores file_id only, never builds a key,
// never trusts a client or engine length or checksum, never deletes bytes.
// Upload and Open stream outside any transaction; claim, quota, the version
// row, audit and outbox commit together (document_commit.go).

// documentStore is the G1-03 part of DocumentService beyond the FileService
// and the quota gate (SetFiles / SetEntitlements live with the read path in
// document_access.go, G1-02b): the validation limits, the spool directory
// of the format check, and a test seam.
type documentStore struct {
	limits   document.FileLimits
	spoolDir string
	// afterClaim is a test seam: it runs inside the commit transaction right
	// after ClaimInTx, so a test can fail the transaction after the bytes
	// are stored and the file is claimed. nil in production.
	afterClaim func() error
}

var errDocumentStoreMissing = errors.New("documents: FileService is not wired")

func (s *DocumentService) fileService() (files.Service, error) {
	if s.files == nil {
		return nil, errDocumentStoreMissing
	}
	return s.files, nil
}

func (s *DocumentService) fileLimits() document.FileLimits {
	if s.store.limits.MaxEntries == 0 {
		return document.DefaultFileLimits
	}
	return s.store.limits
}

func documentScope(organizationID, workspaceID string) files.Scope {
	return files.Scope{OrganizationID: organizationID, WorkspaceID: workspaceID}
}

// DocumentFileInfo is the "file" block of a file document or version
// (docs/parity/documents-api samples): the FileService id, the version that
// holds it and the snapshot taken from the ready file.
type DocumentFileInfo struct {
	FileID         string `json:"file_id"`
	VersionID      string `json:"version_id"`
	Version        int32  `json:"version"`
	Filename       string `json:"filename"`
	MimeType       string `json:"mime_type"`
	SizeBytes      int64  `json:"size_bytes"`
	ChecksumSHA256 string `json:"checksum_sha256"`
}

func fileInfoOf(v db.DocumentVersion, filename string) DocumentFileInfo {
	return DocumentFileInfo{
		FileID:         v.FileID.String,
		VersionID:      v.ID,
		Version:        v.Version,
		Filename:       filename,
		MimeType:       v.MimeType.String,
		SizeBytes:      v.SizeBytes,
		ChecksumSHA256: v.ChecksumSha256.String,
	}
}

// DocumentUpload is a staged upload (POST /documents/{id}/uploads).
// UploadID is the FileService file_id; nothing is committed yet.
type DocumentUpload struct {
	UploadID       string
	Filename       string
	MimeType       string
	SizeBytes      int64
	ChecksumSHA256 string
	ClaimExpiresAt time.Time
}

// DocumentUploadInput is one streamed file. IdempotencyKey is the request's
// key; the FileService key is derived from it, so a retried request finds the
// same upload instead of storing the bytes twice.
type DocumentUploadInput struct {
	Filename       string
	Body           io.Reader
	IdempotencyKey string
}

// fileUploadKey scopes the request key per command and target, so the same
// client key on two documents or two commands never collides in FileService.
func fileUploadKey(command, target, key string) string {
	if strings.TrimSpace(key) == "" {
		key = util.NewID()
	}
	return command + ":" + target + ":" + key
}

// UploadDocumentFile stages bytes for a later versions/commit (C-01 §14.4):
// edit on the document now, bytes into FileService, format check, and the
// staged file_id back as upload_id. The permission is checked again at
// commit - this one only stops a stranger from filling storage.
func (s *DocumentService) UploadDocumentFile(ctx context.Context, actor Actor, documentID string, in DocumentUploadInput) (DocumentUpload, error) {
	fs, err := s.fileService()
	if err != nil {
		return DocumentUpload{}, err
	}
	doc, _, err := s.authorizeDocument(ctx, actor, documentID, DocumentLevelEdit)
	if err != nil {
		return DocumentUpload{}, err
	}
	if doc.Kind != DocumentKindFile {
		return DocumentUpload{}, Invalid("chỉ tài liệu file nhận phiên bản tải lên")
	}
	up, _, err := s.uploadChecked(ctx, fs, actor, files.DocumentFile, documentScope(doc.OrganizationID, doc.WorkspaceID),
		fileUploadKey("documents.upload", doc.ID, in.IdempotencyKey), in)
	if err != nil {
		return DocumentUpload{}, err
	}
	return DocumentUpload{
		UploadID:       string(up.File.ID),
		Filename:       up.File.Filename,
		MimeType:       up.File.ContentType,
		SizeBytes:      up.File.SizeBytes,
		ChecksumSHA256: up.File.ChecksumSHA256,
		ClaimExpiresAt: up.ClaimExpiresAt,
	}, nil
}

// uploadChecked streams one upload into FileService and runs the editor
// format check on the stored bytes. A file that fails the check is canceled
// so it can never be committed, and the refusal names the reason.
func (s *DocumentService) uploadChecked(
	ctx context.Context, fs files.Service, actor Actor, purpose files.UploadPurpose, scope files.Scope, key string, in DocumentUploadInput,
) (files.Upload, document.FileFacts, error) {
	if in.Body == nil {
		return files.Upload{}, document.FileFacts{}, Invalid("thiếu nội dung tệp")
	}
	up, err := fs.Upload(ctx, files.UploadInput{
		Actor:          actor,
		Purpose:        purpose,
		Scope:          scope,
		IdempotencyKey: key,
		Filename:       in.Filename,
		Body:           in.Body,
	})
	if err != nil {
		err = documentFileError(err)
		s.recordDocumentUploadQuota(purpose, err)
		return files.Upload{}, document.FileFacts{}, err
	}
	facts, err := s.checkStoredFile(ctx, fs, scope, up.File)
	if err != nil {
		if codedIs(err, document.ErrCodeUnsupportedMedia) {
			if cerr := fs.CancelUpload(ctx, files.CancelInput{Actor: actor, Scope: scope, FileID: up.File.ID}); cerr != nil &&
				!errors.Is(filesError(cerr), ErrConflict) {
				return files.Upload{}, document.FileFacts{}, documentFileError(cerr)
			}
		}
		return files.Upload{}, document.FileFacts{}, err
	}
	return up, facts, nil
}

// checkStoredFile reads the stored bytes back through Open into a temporary
// spool and validates them (internal/document). It runs after FileService
// reported the file ready, outside any transaction.
func (s *DocumentService) checkStoredFile(ctx context.Context, fs files.Service, scope files.Scope, f files.File) (document.FileFacts, error) {
	rd, err := fs.Open(ctx, files.OpenInput{Scope: scope, FileID: f.ID})
	if err != nil {
		return document.FileFacts{}, documentFileError(err)
	}
	defer func() { _ = rd.Close() }()
	spool, err := os.CreateTemp(s.store.spoolDir, "uniwork-document-*")
	if err != nil {
		return document.FileFacts{}, fmt.Errorf("documents: spool: %w", err)
	}
	defer func() {
		_ = spool.Close()
		_ = os.Remove(spool.Name())
	}()
	n, err := io.Copy(spool, io.LimitReader(rd.Body, f.SizeBytes+1))
	if err != nil {
		return document.FileFacts{}, files.StorageUnavailable(err)
	}
	if n != f.SizeBytes {
		// FileService measured one size and served another: never validate
		// or commit bytes that do not match the ready record.
		return document.FileFacts{}, fmt.Errorf("documents: file %s served %d bytes, recorded %d", f.ID, n, f.SizeBytes)
	}
	facts, err := document.ValidateFile(spool, n, f.ContentType, s.fileLimits())
	if err != nil {
		return document.FileFacts{}, documentValidationError(err)
	}
	return facts, nil
}

// documentValidationError maps a refused file onto the C-01 §5.5 code.
func documentValidationError(err error) error {
	var fe *document.FileError
	if !errors.As(err, &fe) {
		return err
	}
	return CodedError{
		Code: document.ErrCodeUnsupportedMedia, Status: http.StatusUnsupportedMediaType,
		Msg:    "tệp không mở được bằng trình soạn thảo cho định dạng này",
		Fields: map[string]any{"reason": fe.Reason},
	}
}

// documentFileError wraps a FileService refusal in the Documents vocabulary
// (C-01 §14.5): the client never sees a file_* code. purpose/scope refusals
// are server bugs - Documents builds both from an authorized context - so
// they stay plain errors and render as 500.
func documentFileError(err error) error {
	var fe *files.Error
	if !errors.As(err, &fe) {
		return err
	}
	switch fe.Code {
	case files.CodeTypeRejected:
		return CodedError{Code: document.ErrCodeUnsupportedMedia, Status: http.StatusUnsupportedMediaType,
			Msg: "định dạng tệp không được hỗ trợ", Fields: map[string]any{"reason": fe.Code}}
	case files.CodeTooLarge:
		return CodedError{Code: "file_too_large", Status: http.StatusRequestEntityTooLarge,
			Msg: "tệp vượt quá dung lượng cho phép"}
	case files.CodeNotFound:
		return ErrNotFound
	case files.CodeNotReady, files.CodeClaimExpired, files.CodeUploadCanceled, files.CodeDeleting:
		return CodedError{Code: "document_upload_invalid", Status: http.StatusConflict, Err: ErrConflict,
			Msg: "bản tải lên không còn dùng được; hãy tải lên lại", Fields: map[string]any{"reason": fe.Code}}
	case files.CodeAlreadyClaimed:
		return errUploadAlreadyCommitted()
	case files.CodeIdempotencyConflict:
		return errIdempotencyPayloadMismatch()
	case files.CodeStorageUnavailable:
		return CodedError{Code: files.CodeStorageUnavailable, Status: http.StatusServiceUnavailable, Err: fe.Err,
			Msg: "kho lưu trữ tạm thời không sẵn sàng; hãy thử lại"}
	default:
		return fmt.Errorf("documents: file service refused %s: %w", fe.Code, fe)
	}
}

func errUploadAlreadyCommitted() error {
	return CodedError{Code: "upload_already_committed", Status: http.StatusConflict, Err: ErrConflict,
		Msg: "bản tải lên này đã được lưu vào một phiên bản khác"}
}

// DocumentFileResult is what a create, commit or restore of a file document
// answers: the document, the version it now points at and that version's
// file block, with the caller's access for my_level/via. It is also the body
// the idempotency ledger stores, so a replay answers exactly the same.
type DocumentFileResult struct {
	Document db.Document        `json:"document"`
	Version  db.DocumentVersion `json:"version"`
	File     DocumentFileInfo   `json:"file"`
	Access   DocumentAccess     `json:"access"`
}

// CreateFileDocumentInput is POST /workspaces/{ws}/documents/files
// (C-01 §5.1 as amended by §14.2).
type CreateFileDocumentInput struct {
	ParentID       string
	Title          string
	Filename       string
	Body           io.Reader
	IdempotencyKey string
	// engine is the provenance of bytes the Office engine produced (blank
	// create); set only inside the service, never from a request.
	engine DocumentEngineInfo
}

const idempotencyScopeDocumentFileCreate = "documents.files.create"

// CreateFileDocument uploads the bytes (outside any transaction), checks
// them, then in one transaction: membership again, the files claim, the
// tree and parent locks with the parent check, quota, the document and its
// first version, audit and outbox. A failed transaction leaves the file
// staged and unclaimed; FileService collects it after the 24 hour claim
// window. Documents deletes nothing.
func (s *DocumentService) CreateFileDocument(ctx context.Context, actor Actor, workspaceID string, in CreateFileDocumentInput) (DocumentFileResult, error) {
	fs, err := s.fileService()
	if err != nil {
		return DocumentFileResult{}, err
	}
	if actor.Kind != audit.KindHuman || !validActor(actor) {
		// Agents never write documents directly (ADR 0010).
		return DocumentFileResult{}, ErrForbidden
	}
	ws, err := s.ws.RequireMember(ctx, workspaceID, actor.ID)
	if err != nil {
		return DocumentFileResult{}, err
	}
	title := strings.TrimSpace(in.Title)
	if title == "" {
		title = strings.TrimSpace(files.SanitizeFilename(in.Filename))
	}
	if title == "" {
		return DocumentFileResult{}, Invalid("tên tài liệu không được để trống")
	}
	if len([]rune(title)) > 500 {
		return DocumentFileResult{}, Invalid("tên tài liệu tối đa 500 ký tự")
	}
	orgID, err := s.workspaceOrganization(ctx, ws.WorkspaceID)
	if err != nil {
		return DocumentFileResult{}, err
	}
	scope := documentScope(orgID, workspaceID)
	up, _, err := s.uploadChecked(ctx, fs, actor, files.DocumentFile, scope,
		fileUploadKey("documents.create", workspaceID, in.IdempotencyKey), DocumentUploadInput{Filename: in.Filename, Body: in.Body})
	if err != nil {
		return DocumentFileResult{}, err
	}
	fingerprint := IdempotencyFingerprint("documents.files.create", workspaceID, in.ParentID, title, up.File.ChecksumSHA256)
	opts := IdempotencyOptions{Fingerprint: fingerprint, RequireFingerprint: true}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return DocumentFileResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)

	replay, commit, err := BeginIdempotent(ctx, q, orgID, workspaceID, idempotencyScopeDocumentFileCreate, in.IdempotencyKey, actor.ID, opts)
	if err != nil {
		return DocumentFileResult{}, NormalizeIdempotencyError(err)
	}
	if replay != nil {
		return s.replayCreatedFile(ctx, q, actor, replay.Body)
	}
	// Re-check inside the transaction: a revoke between the upload and here
	// must win (DOC-005 §3).
	if _, err := s.ws.RequireMemberQ(ctx, q, workspaceID, actor.ID); err != nil {
		return DocumentFileResult{}, err
	}
	// FS-C1 §5.4: the files rows lock before this module's own rows - the
	// claim comes first, then the workspace tree lock and the parent row
	// lock follow (the idempotency ledger claim still precedes everything,
	// N-01). A retried key replays above without ever touching the parent:
	// losing access to it after the commit does not strand the replay.
	claimed, err := fs.ClaimInTx(ctx, q, files.ClaimInput{
		Actor: actor, Purpose: files.DocumentFile, Scope: scope, FileIDs: []files.FileID{up.File.ID},
	})
	if err != nil {
		return DocumentFileResult{}, documentFileError(err)
	}
	file := claimed[0]
	// A file create is a tree write like a page create (N-01): the workspace
	// tree lock, then the parent row lock - an archive or move of the
	// parent waits for this, so a new file can never slip under a subtree
	// that just left.
	if err := q.LockDocumentTree(ctx, workspaceID); err != nil {
		return DocumentFileResult{}, err
	}
	visibility := documentVisibilityWorkspace
	if in.ParentID != "" {
		parent, err := s.lockPageParent(ctx, q, actor, in.ParentID, orgID, workspaceID)
		if err != nil {
			return DocumentFileResult{}, err
		}
		// A file child inherits its parent's visibility like a page child
		// does: a restricted page never gains a workspace-visible file.
		visibility = parent.Visibility
	}
	if err := s.consumeStorage(ctx, q, actor, orgID, workspaceID, file); err != nil {
		return DocumentFileResult{}, err
	}
	docID, versionID := util.NewID(), util.NewID()
	params := db.InsertDocumentParams{
		ID:             docID,
		OrganizationID: orgID,
		WorkspaceID:    workspaceID,
		ParentID:       nullText(in.ParentID),
		Kind:           DocumentKindFile,
		Title:          title,
		Visibility:     visibility,
		SearchText:     documentSearchText(title, ""),
		CurrentVersion: 1,
		FileVersionID:  pgtype.Text{String: versionID, Valid: true},
		Revision:       1,
		AclOwnerID:     aclOwnerFor(actor),
		CreatedBy:      actor.ID,
		CreatedByKind:  string(actor.Kind),
		UpdatedBy:      actor.ID,
		UpdatedByKind:  string(actor.Kind),
		LastVersionAt:  pgtype.Timestamptz{Time: time.Now(), Valid: true},
	}
	doc, err := q.InsertDocument(ctx, params)
	if err != nil {
		return DocumentFileResult{}, err
	}
	version, err := q.InsertDocumentVersion(ctx, fileVersionParams(doc, versionID, 1, "upload", actor, file, in.engine, pgtype.Int4{}))
	if err != nil {
		return DocumentFileResult{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID,
		WorkspaceID:    workspaceID,
		Actor:          actor,
		Action:         audit.ActionDocumentCreated,
		ResourceType:   "document",
		ResourceID:     doc.ID,
		Changes: audit.Diff(nil, map[string]any{
			"title": doc.Title, "kind": doc.Kind, "visibility": doc.Visibility, "version_id": version.ID, "file_id": string(file.ID),
		}),
	}, audit.Event{Topic: "document.created", Payload: map[string]string{
		"document_id": doc.ID, "workspace_id": workspaceID,
	}}); err != nil {
		return DocumentFileResult{}, err
	}
	access, err := s.effectiveLevel(ctx, q, actor, doc)
	if err != nil {
		return DocumentFileResult{}, err
	}
	res := DocumentFileResult{Document: doc, Version: version, File: fileInfoOf(version, file.Filename), Access: access}
	if err := storeDocumentFileResult(commit, http.StatusCreated, res); err != nil {
		return DocumentFileResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return DocumentFileResult{}, err
	}
	return res, nil
}

// replayCreatedFile answers a replayed create with the access the caller
// holds on the document as it is now: a caller who can no longer see it (or
// a document purged since) gets not_found, never the stored snapshot.
func (s *DocumentService) replayCreatedFile(ctx context.Context, q *db.Queries, actor Actor, body []byte) (DocumentFileResult, error) {
	res, err := decodeDocumentFileResult(body)
	if err != nil {
		return DocumentFileResult{}, err
	}
	doc, err := q.GetDocument(ctx, db.GetDocumentParams{
		ID: res.Document.ID, OrganizationID: res.Document.OrganizationID, WorkspaceID: res.Document.WorkspaceID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return DocumentFileResult{}, ErrNotFound
	}
	if err != nil {
		return DocumentFileResult{}, err
	}
	access, err := s.effectiveLevel(ctx, q, actor, doc)
	if err != nil {
		return DocumentFileResult{}, err
	}
	if err := decideDocumentAccess(doc, access, DocumentLevelView); err != nil {
		return DocumentFileResult{}, ErrNotFound
	}
	res.Access = access
	return res, nil
}

func (s *DocumentService) workspaceOrganization(ctx context.Context, workspaceID string) (string, error) {
	w, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	return w.OrganizationID, nil
}

// consumeStorage meters a newly held file on storage.bytes inside the
// caller's transaction (the subscription lock always follows the files
// claim). The claim already ended the upload reservation, so the file's
// bytes are the delta. Without a wired EntitlementService there is no quota
// to enforce.
func (s *DocumentService) consumeStorage(ctx context.Context, q *db.Queries, actor Actor, orgID, workspaceID string, f files.File) error {
	if s.entitlements == nil || f.SizeBytes == 0 {
		return nil
	}
	return s.entitlements.Consume(ctx, q, ConsumeInput{
		OrganizationID: orgID,
		WorkspaceID:    workspaceID,
		Meter:          FeatureStorageBytes,
		Delta:          f.SizeBytes,
		Actor:          actor,
		RefType:        "document_file",
		RefID:          string(f.ID),
	})
}

// DocumentEngineInfo records which build produced the bytes (C-01 §14.3);
// empty for a straight upload.
type DocumentEngineInfo struct {
	Name            string `json:"engine_name,omitempty"`
	Version         string `json:"engine_version,omitempty"`
	ContractVersion string `json:"contract_version,omitempty"`
	ProtocolVersion string `json:"protocol_version,omitempty"`
}

func (e DocumentEngineInfo) empty() bool {
	return e.Name == "" && e.Version == "" && e.ContractVersion == "" && e.ProtocolVersion == ""
}

// fileVersionParams snapshots mime/size/checksum from the claimed, ready
// FileService record - never from the client or the engine.
func fileVersionParams(doc db.Document, id string, version int32, reason string, actor Actor, f files.File, eng DocumentEngineInfo, restoredFrom pgtype.Int4) db.InsertDocumentVersionParams {
	return db.InsertDocumentVersionParams{
		ID:              id,
		OrganizationID:  doc.OrganizationID,
		WorkspaceID:     doc.WorkspaceID,
		DocumentID:      doc.ID,
		Version:         version,
		Kind:            DocumentKindFile,
		Reason:          reason,
		FileID:          pgtype.Text{String: string(f.ID), Valid: true},
		MimeType:        pgtype.Text{String: f.ContentType, Valid: f.ContentType != ""},
		SizeBytes:       f.SizeBytes,
		ChecksumSha256:  pgtype.Text{String: f.ChecksumSHA256, Valid: f.ChecksumSHA256 != ""},
		RestoredFrom:    restoredFrom,
		EngineName:      nullText(eng.Name),
		EngineVersion:   nullText(eng.Version),
		ContractVersion: nullText(eng.ContractVersion),
		ProtocolVersion: nullText(eng.ProtocolVersion),
		CreatedBy:       actor.ID,
		CreatedByKind:   string(actor.Kind),
	}
}

// UploadDocumentAsset stores an image pasted into a page (C-01 §3.3 as
// amended by §14.2): edit on the page, bytes into FileService under
// document_asset, the image check (width/height come from the decoded
// header), then in the mutation transaction: claim, quota, the asset row and
// its audit row.
func (s *DocumentService) UploadDocumentAsset(ctx context.Context, actor Actor, documentID string, in DocumentUploadInput) (db.DocumentAsset, error) {
	return s.uploadDocumentAsset(ctx, actor, documentID, in, func(doc db.Document) bool { return doc.Kind == DocumentKindPage })
}

// uploadDocumentAsset is UploadDocumentAsset with the document kinds the
// caller accepts: pages through the Documents route, DOCX file documents
// through the Office Docs frame (OfficeFrameService.UploadAsset).
func (s *DocumentService) uploadDocumentAsset(ctx context.Context, actor Actor, documentID string, in DocumentUploadInput, accepts func(db.Document) bool) (db.DocumentAsset, error) {
	fs, err := s.fileService()
	if err != nil {
		return db.DocumentAsset{}, err
	}
	doc, _, err := s.authorizeDocument(ctx, actor, documentID, DocumentLevelEdit)
	if err != nil {
		return db.DocumentAsset{}, err
	}
	if !accepts(doc) {
		return db.DocumentAsset{}, Invalid("chỉ trang nhận ảnh chèn")
	}
	scope := documentScope(doc.OrganizationID, doc.WorkspaceID)
	up, facts, err := s.uploadChecked(ctx, fs, actor, files.DocumentAsset, scope,
		fileUploadKey("documents.asset", doc.ID, in.IdempotencyKey), in)
	if err != nil {
		return db.DocumentAsset{}, err
	}
	var asset db.DocumentAsset
	err = s.withDocumentMutation(ctx, actor, doc.ID, DocumentLevelEdit, func(q *db.Queries, locked db.Document, _ DocumentAccess) error {
		claimed, err := fs.ClaimInTx(ctx, q, files.ClaimInput{
			Actor: actor, Purpose: files.DocumentAsset, Scope: scope, FileIDs: []files.FileID{up.File.ID},
		})
		if err != nil {
			return documentFileError(err)
		}
		inUse, err := q.DocumentFileInUse(ctx, db.DocumentFileInUseParams{
			OrganizationID: locked.OrganizationID, WorkspaceID: locked.WorkspaceID,
			FileID: pgtype.Text{String: string(up.File.ID), Valid: true},
		})
		if err != nil {
			return err
		}
		if inUse {
			// A retried request with the same key replays the FileService
			// upload; hand back the asset it already produced.
			existing, err := assetByFile(ctx, q, locked, up.File.ID)
			if err != nil {
				return err
			}
			asset = existing
			return nil
		}
		f := claimed[0]
		if err := s.consumeStorage(ctx, q, actor, locked.OrganizationID, locked.WorkspaceID, f); err != nil {
			return err
		}
		asset, err = q.InsertDocumentAsset(ctx, db.InsertDocumentAssetParams{
			ID:             util.NewID(),
			OrganizationID: locked.OrganizationID,
			WorkspaceID:    locked.WorkspaceID,
			DocumentID:     locked.ID,
			FileID:         string(f.ID),
			MimeType:       f.ContentType,
			SizeBytes:      f.SizeBytes,
			Width:          pgtype.Int4{Int32: int32(facts.Width), Valid: facts.Width > 0},
			Height:         pgtype.Int4{Int32: int32(facts.Height), Valid: facts.Height > 0},
			CreatedBy:      actor.ID,
			CreatedByKind:  string(actor.Kind),
		})
		if err != nil {
			return err
		}
		return auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: locked.OrganizationID,
			WorkspaceID:    locked.WorkspaceID,
			Actor:          actor,
			Action:         audit.ActionDocumentAssetUploaded,
			ResourceType:   "document",
			ResourceID:     locked.ID,
			Changes: audit.Diff(nil, map[string]any{
				"asset_id": asset.ID, "file_id": asset.FileID, "size_bytes": asset.SizeBytes,
			}),
		})
	})
	if err != nil {
		return db.DocumentAsset{}, err
	}
	return asset, nil
}

func assetByFile(ctx context.Context, q *db.Queries, doc db.Document, fileID files.FileID) (db.DocumentAsset, error) {
	assets, err := q.ListDocumentAssetsByDocument(ctx, db.ListDocumentAssetsByDocumentParams{
		OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
	})
	if err != nil {
		return db.DocumentAsset{}, err
	}
	for _, a := range assets {
		if a.FileID == string(fileID) {
			return a, nil
		}
	}
	// Claimed by another document or a file version: the upload is spent.
	return db.DocumentAsset{}, errUploadAlreadyCommitted()
}
