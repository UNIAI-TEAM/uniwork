package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/document"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/office"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// File version commit and binary restore (C-01 §14.4; DOC-005 §3; G1-03,
// UNI-677). A commit takes a staged upload (upload_id = the FileService
// file_id) onto a base revision. Everything that can refuse a save is decided
// here, in DOC-005's order:
//
//  1. session     - the handler (token_expired / unauthorized)
//  2. tombstone   - document_deleted (410); a stranger still gets not_found
//  3. idempotency - idempotency_key_reuse | idempotency_payload_mismatch |
//     idempotency_in_flight, or the stored answer replayed. The fingerprint
//     binds the verified checksum, so the upload is resolved (not claimed)
//     just before this step: an upload_id that no longer resolves answers
//     with its own error (not_found, document_upload_invalid,
//     storage_unavailable) instead of the stored answer. A replay carries
//     the caller's access as it is now, not as it was at the first commit.
//  4. permission  - re-checked inside the mutation (withDocumentMutation),
//     never trusted from the upload
//  5. engine      - engine_incompatible (409)
//  6. base        - document_version_conflict (409)
//  7. quota       - quota_exceeded (403)
//
// then one transaction: ClaimInTx, the version row, the pointer and the
// revision, audit + outbox, and the idempotency answer. A rollback leaves the
// file staged, so the same upload can be committed again. Lock order is the
// same in every Documents command: document row (withDocumentMutation) ->
// files rows (ClaimInTx) -> subscription (Consume). FileService never locks
// a document row and the quota hook locks only the subscription, so no cycle
// exists.
//
// An upload_id minted by RegisterProviderOutput for an office job (G2-02c)
// goes through this same commit: inside the transaction the job row names
// the authoritative base (revision and file_version_id CAS), the output file
// is claimed like any upload, the version is inserted through
// pointAtNewFileVersion, and MarkOfficeJobCommitted flips the job to
// committed - one commit wins, a cancel that landed first refuses the commit
// and rolls back everything.

const (
	idempotencyScopeDocumentVersionCommit  = "documents.versions.commit"
	idempotencyScopeDocumentVersionRestore = "documents.versions.restore"
)

// CommitFileVersionInput is POST /documents/{id}/versions/commit. Engine is
// filled only by the internal Office path (G2): the public body is
// {upload_id, base_revision} and never carries engine metadata.
type CommitFileVersionInput struct {
	UploadID       string
	BaseRevision   int64
	IdempotencyKey string
	Engine         DocumentEngineInfo
}

func errDocumentDeleted() error {
	return CodedError{Code: "document_deleted", Status: http.StatusGone, Err: ErrNotFound,
		Msg: "tài liệu đã bị xóa"}
}

func errDocumentVersionConflict(current int64) error {
	return CodedError{Code: "document_version_conflict", Status: http.StatusConflict, Err: ErrConflict,
		Msg:    "tài liệu đã có phiên bản mới hơn kể từ lần bạn mở nó",
		Fields: map[string]any{"current_revision": strconv.FormatInt(current, 10)}}
}

func errEngineIncompatible() error {
	return CodedError{Code: "engine_incompatible", Status: http.StatusConflict, Err: ErrConflict,
		Msg: "phiên bản trình soạn thảo không tương thích; hãy cập nhật ứng dụng"}
}

// errOfficeUploadInvalid: the staged file is an office output this commit
// cannot take - the job belongs to another document, or it is not committable
// any more (cancelled, failed, timed out, or a cancelled-by-race claim). The
// reason rides in fields.reason like document_upload_invalid's file_* codes.
func errOfficeUploadInvalid(reason string) error {
	return CodedError{Code: "document_upload_invalid", Status: http.StatusConflict, Err: ErrConflict,
		Msg: "bản tải lên không còn dùng được; hãy tải lên lại", Fields: map[string]any{"reason": reason}}
}

// officeEngineInfo is the provenance an office-produced version row stamps:
// the one engine build this server trusts (internal/office), derived on the
// server, never claimed by the caller.
func officeEngineInfo() DocumentEngineInfo {
	return DocumentEngineInfo{
		Name: "genoffice", Version: office.TrustedEngineVersion,
		ContractVersion: office.ContractVersion, ProtocolVersion: strconv.Itoa(office.ProtocolVersion),
	}
}

// officeJobForOutput answers the office_jobs row behind a provider-output
// file_id, or nil for a straight upload. A job bound to another document
// makes the upload_id invalid for the one being committed.
func officeJobForOutput(ctx context.Context, q *db.Queries, doc db.Document, fileID files.FileID) (*db.OfficeJob, error) {
	job, err := q.GetOfficeJobByOutputFile(ctx, db.GetOfficeJobByOutputFileParams{
		OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
		OutputFileID: pgtype.Text{String: string(fileID), Valid: true},
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if job.DocumentID != doc.ID {
		return nil, errOfficeUploadInvalid("office_job_document")
	}
	return &job, nil
}

// checkEngine accepts a straight upload (no engine) or the one engine build,
// contract and protocol this server trusts (internal/office).
func checkEngine(e DocumentEngineInfo) error {
	if e.empty() {
		return nil
	}
	if e.ContractVersion != office.ContractVersion ||
		e.ProtocolVersion != strconv.Itoa(office.ProtocolVersion) ||
		e.Version != office.TrustedEngineVersion || e.Name == "" {
		return errEngineIncompatible()
	}
	return nil
}

// commitFingerprint binds a key to the payload that changes the result
// (C-01 §14.3, DOC-005 §3.1): operation, document, base and the verified
// checksum of the bytes - not the filename, not the upload id - plus the
// engine build that produced them.
func commitFingerprint(documentID string, base int64, checksum string, e DocumentEngineInfo) string {
	return IdempotencyFingerprint(idempotencyScopeDocumentVersionCommit, documentID, strconv.FormatInt(base, 10), checksum,
		e.Name, e.Version, e.ContractVersion, e.ProtocolVersion)
}

// preflightDocument is steps 2 of the order: the row, its tenant, and the
// tombstone. It reads outside any transaction; the mutation decides again.
// A document the actor cannot see at all is not_found (no existence leak);
// an archived one the actor can see is document_deleted.
func (s *DocumentService) preflightDocument(ctx context.Context, actor Actor, documentID string) (db.Document, DocumentAccess, error) {
	if !validActor(actor) || documentID == "" {
		return db.Document{}, DocumentAccess{}, ErrNotFound
	}
	doc, err := s.q.GetDocumentByID(ctx, documentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Document{}, DocumentAccess{}, ErrNotFound
	}
	if err != nil {
		return db.Document{}, DocumentAccess{}, err
	}
	access, err := s.effectiveLevel(ctx, s.q, actor, doc)
	if err != nil {
		return db.Document{}, DocumentAccess{}, err
	}
	if access.Level == DocumentLevelNone {
		return db.Document{}, DocumentAccess{}, ErrNotFound
	}
	if doc.ArchivedAt.Valid {
		return db.Document{}, DocumentAccess{}, errDocumentDeleted()
	}
	if doc.Kind != DocumentKindFile {
		return db.Document{}, DocumentAccess{}, Invalid("chỉ tài liệu file nhận phiên bản tệp")
	}
	return doc, access, nil
}

// replayWithAccess decodes a stored answer and stamps the caller's current
// access on it: the write happened, but my_level must not outlive a
// downgrade.
func replayWithAccess(body []byte, access DocumentAccess) (DocumentFileResult, error) {
	res, err := decodeDocumentFileResult(body)
	if err != nil {
		return DocumentFileResult{}, err
	}
	res.Access = access
	return res, nil
}

// resolveUpload reads the staged file's verified record (checksum, size,
// type) without claiming it.
func resolveUpload(ctx context.Context, fs files.Service, scope files.Scope, uploadID string) (files.File, error) {
	res, err := fs.ResolveMany(ctx, files.ResolveInput{
		Scope: scope, Mode: files.ReadProxy, Disposition: files.DispositionAttachment,
		FileIDs: []files.FileID{files.FileID(uploadID)},
	})
	if err != nil {
		return files.File{}, documentFileError(err)
	}
	if len(res) != 1 {
		return files.File{}, ErrNotFound
	}
	if res[0].Err != nil {
		return files.File{}, documentFileError(res[0].Err)
	}
	return res[0].File, nil
}

// CommitFileVersion is the file save path (see the file comment for the
// order). The answer is the same on a replay of the same key and payload.
func (s *DocumentService) CommitFileVersion(ctx context.Context, actor Actor, documentID string, in CommitFileVersionInput) (DocumentFileResult, error) {
	fs, err := s.fileService()
	if err != nil {
		return DocumentFileResult{}, err
	}
	if in.UploadID == "" {
		return DocumentFileResult{}, Invalid("upload_id bắt buộc")
	}
	doc, current, err := s.preflightDocument(ctx, actor, documentID)
	if err != nil {
		return DocumentFileResult{}, err
	}
	scope := documentScope(doc.OrganizationID, doc.WorkspaceID)
	file, err := resolveUpload(ctx, fs, scope, in.UploadID)
	if err != nil {
		return DocumentFileResult{}, err
	}
	opts := IdempotencyOptions{
		Fingerprint:        commitFingerprint(doc.ID, in.BaseRevision, file.ChecksumSHA256, in.Engine),
		RequireFingerprint: true,
	}
	replay, err := PeekIdempotent(ctx, s.q, doc.OrganizationID, doc.WorkspaceID, idempotencyScopeDocumentVersionCommit, in.IdempotencyKey, actor.ID, opts)
	if err != nil {
		return DocumentFileResult{}, NormalizeIdempotencyError(err)
	}
	if replay != nil {
		return replayWithAccess(replay.Body, current)
	}
	// The editor format check streams the bytes, so it runs before the
	// transaction opens (FS-C1 §5.5).
	if _, err := s.checkStoredFile(ctx, fs, scope, file); err != nil {
		return DocumentFileResult{}, err
	}

	var res DocumentFileResult
	err = s.withDocumentMutation(ctx, actor, doc.ID, DocumentLevelEdit, func(q *db.Queries, locked db.Document, access DocumentAccess) error {
		if locked.ArchivedAt.Valid {
			return errDocumentDeleted()
		}
		replay, commit, err := BeginIdempotent(ctx, q, locked.OrganizationID, locked.WorkspaceID, idempotencyScopeDocumentVersionCommit, in.IdempotencyKey, actor.ID, opts)
		if err != nil {
			return NormalizeIdempotencyError(err)
		}
		if replay != nil {
			res, err = replayWithAccess(replay.Body, access)
			return err
		}
		job, err := officeJobForOutput(ctx, q, locked, file.ID)
		if err != nil {
			return err
		}
		var eng DocumentEngineInfo
		if job != nil {
			// Office output (G2-02c): the job row, not the request, carries
			// the authoritative base and the engine provenance is stamped
			// server-side - the caller's engine field is ignored. A spent
			// output answers upload_already_committed; a settled job is an
			// invalid upload; a document that moved off the job's base is
			// the contract conflict. Exactly one commit marks the job below.
			if job.CommittedVersionID.Valid {
				return errUploadAlreadyCommitted()
			}
			if job.State != string(office.JobCompleted) {
				return errOfficeUploadInvalid("office_job_" + job.State)
			}
			if job.Operation == string(office.OperationConvert) {
				// A conversion never becomes a version of its source: it is
				// accepted only as a new document (POST .../copies, Q7).
				return errOfficeUploadInvalid("office_job_convert_copy_only")
			}
			if locked.Revision != job.BaseRevision || locked.FileVersionID.String != job.BaseVersionID {
				return errDocumentVersionConflict(locked.Revision)
			}
			eng = officeEngineInfo()
		} else {
			if err := checkEngine(in.Engine); err != nil {
				return err
			}
			if locked.Revision != in.BaseRevision {
				return errDocumentVersionConflict(locked.Revision)
			}
			eng = in.Engine
		}
		current, err := s.currentFileVersion(ctx, q, locked)
		if err != nil {
			return err
		}
		claimed, err := fs.ClaimInTx(ctx, q, files.ClaimInput{
			Actor: actor, Purpose: files.DocumentFile, Scope: scope,
			FileIDs: []files.FileID{file.ID}, Replaces: replacedFiles(current, file.ID),
		})
		if err != nil {
			return documentFileError(err)
		}
		if s.store.afterClaim != nil {
			if err := s.store.afterClaim(); err != nil {
				return err
			}
		}
		// FileService lets a tenant reuse a claimed file (T1-Q3); a Documents
		// upload is consumed by the first version or asset that claims it.
		// Checked after ClaimInTx locked the file row, so a concurrent commit
		// of the same upload elsewhere is already visible.
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
		f := claimed[0]
		if current != nil && current.MimeType.String != f.ContentType {
			// A new version keeps the document's format: a different type is
			// a conversion (a copy, C-01 §14.4), never a silent editor switch.
			// An office job output is the one exception: the engine writes
			// through a provider output that carries no filename (FS-C1 §4),
			// so a markdown document's bytes come back sniffed as text/plain.
			// The job's format is the document's own (bound when it started),
			// and the version keeps the document's mime so the format
			// survives the round trip.
			if job == nil || !officeOutputKeepsFormat(job.Format, current.MimeType.String, f.ContentType) {
				return CodedError{Code: document.ErrCodeUnsupportedMedia, Status: http.StatusUnsupportedMediaType,
					Msg:    "phiên bản mới phải cùng định dạng với tài liệu",
					Fields: map[string]any{"reason": "format_changed"}}
			}
			f.ContentType = current.MimeType.String
		}
		if err := s.consumeStorage(ctx, q, actor, locked.OrganizationID, locked.WorkspaceID, f); err != nil {
			return err
		}
		res, err = s.pointAtNewFileVersion(ctx, q, actor, locked, access, f, "upload", eng, pgtype.Int4{})
		if err != nil {
			return err
		}
		if job != nil {
			// Commit wins or loses against cancel here: the CAS matches a
			// completed, uncommitted job only. A rollback keeps the output
			// staged; a lost race refuses this whole transaction.
			if _, err := claimOfficeJobOutputInTx(ctx, q, locked.OrganizationID, locked.WorkspaceID, job.ID, res.Version.ID,
				pgtype.Timestamptz{Time: time.Now(), Valid: true}); err != nil {
				if errors.Is(err, ErrOfficeJobNotCommittable) {
					return errOfficeUploadInvalid("office_job_not_committable")
				}
				return err
			}
		}
		return storeDocumentFileResult(commit, http.StatusOK, res)
	})
	if err != nil {
		return DocumentFileResult{}, err
	}
	return res, nil
}

// RestoreFileVersionInput restores an earlier file version on a base
// revision (C-01 §5.2 restore, for file documents).
type RestoreFileVersionInput struct {
	Version        int32
	BaseRevision   int64
	IdempotencyKey string
}

// RestoreFileVersion appends a restore version pointing back at the earlier
// version's file_id: no byte is copied and no quota is charged, because the
// file is already held (and counted once) by the old version.
func (s *DocumentService) RestoreFileVersion(ctx context.Context, actor Actor, documentID string, in RestoreFileVersionInput) (DocumentFileResult, error) {
	fs, err := s.fileService()
	if err != nil {
		return DocumentFileResult{}, err
	}
	doc, current, err := s.preflightDocument(ctx, actor, documentID)
	if err != nil {
		return DocumentFileResult{}, err
	}
	opts := IdempotencyOptions{
		Fingerprint: IdempotencyFingerprint(idempotencyScopeDocumentVersionRestore, doc.ID,
			strconv.FormatInt(in.BaseRevision, 10), strconv.Itoa(int(in.Version))),
		RequireFingerprint: true,
	}
	replay, err := PeekIdempotent(ctx, s.q, doc.OrganizationID, doc.WorkspaceID, idempotencyScopeDocumentVersionRestore, in.IdempotencyKey, actor.ID, opts)
	if err != nil {
		return DocumentFileResult{}, NormalizeIdempotencyError(err)
	}
	if replay != nil {
		return replayWithAccess(replay.Body, current)
	}
	scope := documentScope(doc.OrganizationID, doc.WorkspaceID)
	var res DocumentFileResult
	err = s.withDocumentMutation(ctx, actor, doc.ID, DocumentLevelEdit, func(q *db.Queries, locked db.Document, access DocumentAccess) error {
		if locked.ArchivedAt.Valid {
			return errDocumentDeleted()
		}
		replay, commit, err := BeginIdempotent(ctx, q, locked.OrganizationID, locked.WorkspaceID, idempotencyScopeDocumentVersionRestore, in.IdempotencyKey, actor.ID, opts)
		if err != nil {
			return NormalizeIdempotencyError(err)
		}
		if replay != nil {
			res, err = replayWithAccess(replay.Body, access)
			return err
		}
		if locked.Revision != in.BaseRevision {
			return errDocumentVersionConflict(locked.Revision)
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
		if src.Kind != DocumentKindFile || !src.FileID.Valid {
			return Invalid("phiên bản này không phải phiên bản tệp")
		}
		current, err := s.currentFileVersion(ctx, q, locked)
		if err != nil {
			return err
		}
		// Re-attach through ClaimInTx: the file row is locked in the shared
		// order and a file the collector has already fenced is refused
		// (file_deleting) instead of becoming a pointer to missing bytes.
		srcFile := files.FileID(src.FileID.String)
		claimed, err := fs.ClaimInTx(ctx, q, files.ClaimInput{
			Actor: actor, Purpose: files.DocumentFile, Scope: scope,
			FileIDs: []files.FileID{srcFile}, Replaces: replacedFiles(current, srcFile),
		})
		if err != nil {
			return documentFileError(err)
		}
		// The snapshot is the restored version's own: the same bytes.
		f := claimed[0]
		f.ContentType, f.SizeBytes, f.ChecksumSHA256 = src.MimeType.String, src.SizeBytes, src.ChecksumSha256.String
		res, err = s.pointAtNewFileVersion(ctx, q, actor, locked, access, f, "restore",
			DocumentEngineInfo{Name: src.EngineName.String, Version: src.EngineVersion.String,
				ContractVersion: src.ContractVersion.String, ProtocolVersion: src.ProtocolVersion.String},
			pgtype.Int4{Int32: src.Version, Valid: true})
		if err != nil {
			return err
		}
		return storeDocumentFileResult(commit, http.StatusOK, res)
	})
	if err != nil {
		return DocumentFileResult{}, err
	}
	return res, nil
}

// currentFileVersion is the version the document points at, or nil for a
// file document that has none yet.
func (s *DocumentService) currentFileVersion(ctx context.Context, q *db.Queries, doc db.Document) (*db.DocumentVersion, error) {
	if !doc.FileVersionID.Valid {
		return nil, nil
	}
	v, err := q.GetDocumentVersionByID(ctx, db.GetDocumentVersionByIDParams{
		ID: doc.FileVersionID.String, OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &v, nil
}

// replacedFiles names the file the command supersedes as the pointer, so
// ClaimInTx locks old and new in one order. The old file stays held as
// version history; nothing is released.
func replacedFiles(current *db.DocumentVersion, next files.FileID) []files.FileID {
	if current == nil || !current.FileID.Valid || files.FileID(current.FileID.String) == next {
		return nil
	}
	return []files.FileID{files.FileID(current.FileID.String)}
}

// pointAtNewFileVersion appends the version, moves the pointer and the
// revision, and writes audit + outbox, all on q.
func (s *DocumentService) pointAtNewFileVersion(
	ctx context.Context, q *db.Queries, actor Actor, doc db.Document, access DocumentAccess,
	f files.File, reason string, eng DocumentEngineInfo, restoredFrom pgtype.Int4,
) (DocumentFileResult, error) {
	versionNo := doc.CurrentVersion + 1
	version, err := q.InsertDocumentVersion(ctx, fileVersionParams(doc, util.NewID(), versionNo, reason, actor, f, eng, restoredFrom))
	if err != nil {
		return DocumentFileResult{}, err
	}
	updated, err := q.SetDocumentFileVersion(ctx, db.SetDocumentFileVersionParams{
		FileVersionID:    pgtype.Text{String: version.ID, Valid: true},
		CurrentVersion:   versionNo,
		UpdatedBy:        actor.ID,
		UpdatedByKind:    string(actor.Kind),
		ID:               doc.ID,
		OrganizationID:   doc.OrganizationID,
		WorkspaceID:      doc.WorkspaceID,
		ExpectedRevision: doc.Revision,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		// The row is locked, so this means the lock was not the one this
		// command believes it holds; refuse rather than overwrite.
		return DocumentFileResult{}, errDocumentVersionConflict(doc.Revision)
	}
	if err != nil {
		return DocumentFileResult{}, err
	}
	action := audit.ActionDocumentVersionCreated
	changes := map[string]any{"version": versionNo, "version_id": version.ID, "file_id": string(f.ID), "reason": reason}
	if reason == "restore" {
		action = audit.ActionDocumentVersionRestored
		changes["restored_from"] = restoredFrom.Int32
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: doc.OrganizationID,
		WorkspaceID:    doc.WorkspaceID,
		Actor:          actor,
		Action:         action,
		ResourceType:   "document",
		ResourceID:     doc.ID,
		Changes:        audit.Diff(map[string]any{"revision": doc.Revision}, mergeMaps(changes, map[string]any{"revision": updated.Revision})),
	}, audit.Event{Topic: "document.version_created", Payload: map[string]string{
		"document_id": doc.ID, "version_id": version.ID, "workspace_id": doc.WorkspaceID,
	}}); err != nil {
		return DocumentFileResult{}, err
	}
	return DocumentFileResult{Document: updated, Version: version, File: fileInfoOf(version, f.Filename), Access: access}, nil
}

func mergeMaps(a, b map[string]any) map[string]any {
	out := make(map[string]any, len(a)+len(b))
	for k, v := range a {
		out[k] = v
	}
	for k, v := range b {
		out[k] = v
	}
	return out
}

// storeDocumentFileResult writes the answer into the idempotency ledger in
// the command's transaction.
func storeDocumentFileResult(commit func(int, []byte) error, status int, res DocumentFileResult) error {
	body, err := json.Marshal(res)
	if err != nil {
		return err
	}
	return commit(status, body)
}

func decodeDocumentFileResult(body []byte) (DocumentFileResult, error) {
	var res DocumentFileResult
	if err := json.Unmarshal(body, &res); err != nil {
		return DocumentFileResult{}, err
	}
	return res, nil
}
