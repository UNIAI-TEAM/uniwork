package service

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/document"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/storage"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Folder upload, part two (UNI-2052 w2): the server content route a store that
// cannot presign sends the bytes to, and COMPLETE, which turns uploaded files
// into documents. COMPLETE runs one transaction per file, so one failure
// never rolls back a document another file of the same call created. The
// first document of a call carries the call's one document.batch_uploaded
// event in its own transaction; no file of a batch writes document.created.

const (
	folderUploadStatusCanceled  = "canceled"
	folderUploadStatusExpired   = "expired"
	folderUploadStatusCompleted = "completed"
	folderUploadFileDone        = "done"
	folderUploadFileFailed      = "failed"
)

// The per-file codes of a COMPLETE result (§3).
const (
	folderFileUploadMissing    = "upload_missing"
	folderFileSizeMismatch     = "size_mismatch"
	folderFileUnsupported      = "unsupported_media"
	folderFileQuotaExceeded    = "storage_quota_exceeded"
	folderFileNotFound         = "not_found"
	folderFilePartsInvalid     = "parts_invalid"
	folderFileProbeMismatch    = "probe_mismatch"
	folderUploadContentKeyStem = "folder-upload-content:"
)

// CompleteFolderUploadFileInput is one file of a COMPLETE: ETag for a put
// target (the value the PUT answered), Parts for a multipart one.
type CompleteFolderUploadFileInput struct {
	FileKey string
	ETag    string
	Parts   []CompleteUploadPartInput
}

// FolderUploadFileOutcome is one file's result. ErrorCode and Reason are set
// when Status is failed; Reason only for unsupported_media. Retryable means
// the file is still pending (upload_missing, parts_invalid, size_mismatch):
// the client uploads it again, from a fresh GET target, and completes again.
type FolderUploadFileOutcome struct {
	FileKey    string
	Status     string
	DocumentID string
	ErrorCode  string
	Reason     string
	Retryable  bool
}

// FolderUploadCompleteResult answers a COMPLETE: one result per file sent, in
// the order sent, and the batch after the call.
type FolderUploadCompleteResult struct {
	Results []FolderUploadFileOutcome
	Status  string
	Counts  FolderUploadCounts
}

func errFolderUploadCanceled() error {
	return CodedError{
		Status: http.StatusConflict, Code: "folder_upload_canceled", Err: ErrConflict,
		Msg: "lượt tải thư mục đã bị hủy",
	}
}

func errFolderUploadExpired() error {
	return CodedError{
		Status: http.StatusGone, Code: "folder_upload_expired",
		Msg: "lượt tải thư mục đã hết hạn: hãy tải lại thư mục",
	}
}

func errFolderUploadFileSettled() error {
	return CodedError{
		Status: http.StatusConflict, Code: "folder_upload_file_settled", Err: ErrConflict,
		Msg: "tệp này đã xong, không nhận thêm nội dung",
	}
}

func errFolderUploadTargetSigned() error {
	return CodedError{
		Status: http.StatusConflict, Code: "folder_upload_target_signed", Err: ErrConflict,
		Msg: "tệp này tải lên qua đích đã ký, không qua máy chủ",
	}
}

func errFolderUploadContentTooLarge(max int64) error {
	return CodedError{
		Status: http.StatusRequestEntityTooLarge, Code: "file_too_large",
		Msg:    "tệp lớn hơn kích thước đã khai báo hoặc vượt dung lượng cho phép",
		Fields: map[string]any{"max_bytes": max},
	}
}

// folderUploadWritable refuses a batch that takes no more uploads: canceled,
// or past its expiry whether or not the sweep has marked it yet.
func (s *DocumentService) folderUploadWritable(row db.DocumentFolderUpload) error {
	switch {
	case row.Status == folderUploadStatusCanceled:
		return errFolderUploadCanceled()
	case row.Status == folderUploadStatusExpired,
		row.Status == folderUploadStatusOpen && !s.now().Before(row.ExpiresAt.Time):
		return errFolderUploadExpired()
	}
	return nil
}

// folderUploadForWrite gates a batch route: a human member, the batch's own
// creator (anyone else gets ErrNotFound), and a batch still writable.
func (s *DocumentService) folderUploadForWrite(ctx context.Context, actor Actor, workspaceID, batchID string) (db.DocumentFolderUpload, error) {
	if actor.Kind != audit.KindHuman || !validActor(actor) {
		return db.DocumentFolderUpload{}, ErrForbidden
	}
	if _, err := s.ws.RequireMember(ctx, workspaceID, actor.ID); err != nil {
		return db.DocumentFolderUpload{}, err
	}
	orgID, err := s.workspaceOrganization(ctx, workspaceID)
	if err != nil {
		return db.DocumentFolderUpload{}, err
	}
	row, err := s.folderUploadRow(ctx, actor, orgID, workspaceID, batchID)
	if err != nil {
		return db.DocumentFolderUpload{}, err
	}
	return row, s.folderUploadWritable(row)
}

func (s *DocumentService) folderUploadFile(ctx context.Context, q *db.Queries, batch db.DocumentFolderUpload, fileKey string) (db.DocumentFolderUploadFile, error) {
	f, err := q.GetDocumentFolderUploadFileByKey(ctx, db.GetDocumentFolderUploadFileByKeyParams{
		BatchID: batch.ID, FileKey: fileKey, OrganizationID: batch.OrganizationID, WorkspaceID: batch.WorkspaceID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.DocumentFolderUploadFile{}, ErrNotFound
	}
	return f, err
}

// errFolderContentOver stops a content stream at the first byte past the cap.
var errFolderContentOver = errors.New("documents: folder upload content over its cap")

// folderContentReader passes at most left bytes and fails on the next one.
type folderContentReader struct {
	r    io.Reader
	left int64
	over bool
}

func (c *folderContentReader) Read(p []byte) (int, error) {
	if c.over {
		return 0, errFolderContentOver
	}
	if int64(len(p)) > c.left+1 {
		p = p[:c.left+1]
	}
	n, err := c.r.Read(p)
	if int64(n) > c.left {
		c.over = true
		return int(c.left), errFolderContentOver
	}
	c.left -= int64(n)
	return n, err
}

// PutFolderUploadContent is the server content route (§1 #2): the target of
// a pending file when the store cannot presign a write. The body is capped at
// the file's declared size and upload_max_bytes (413 file_too_large), spooled
// and stored through FileService as a staged upload, and recorded on the file
// row with the ETag answered: the quoted SHA-256 of the stored bytes. Every
// PUT is a fresh upload, so a retry after a broken stream starts clean; the
// upload it replaces is canceled. The content is checked at COMPLETE.
func (s *DocumentService) PutFolderUploadContent(ctx context.Context, actor Actor, workspaceID, batchID, fileKey string, body io.Reader) (string, error) {
	fs, err := s.fileService()
	if err != nil {
		return "", err
	}
	batch, err := s.folderUploadForWrite(ctx, actor, workspaceID, batchID)
	if err != nil {
		return "", err
	}
	f, err := s.folderUploadFile(ctx, s.q, batch, fileKey)
	if err != nil {
		return "", err
	}
	if err := folderContentAccepts(f); err != nil {
		return "", err
	}
	if body == nil {
		return "", Invalid("thiếu nội dung tệp")
	}
	limit := min(f.SizeBytes, s.documentFileMaxBytes())
	capped := &folderContentReader{r: body, left: limit}
	scope := documentScope(batch.OrganizationID, batch.WorkspaceID)
	up, err := fs.Upload(ctx, files.UploadInput{
		Actor: actor, Purpose: files.DocumentFile, Scope: scope,
		IdempotencyKey: folderUploadContentKeyStem + f.ID + ":" + util.NewID(),
		Filename:       f.Filename, Body: capped,
	})
	cancel := func(id files.FileID) {
		_ = fs.CancelUpload(context.WithoutCancel(ctx), files.CancelInput{Actor: actor, Scope: scope, FileID: id})
	}
	if capped.over {
		if err == nil {
			cancel(up.File.ID)
		}
		return "", errFolderUploadContentTooLarge(limit)
	}
	if err != nil {
		return "", documentFileError(err)
	}
	etag := `"` + up.File.ChecksumSHA256 + `"`
	replaced, err := s.recordFolderUploadContent(ctx, batch, fileKey, up.File.ID, etag)
	if err != nil {
		cancel(up.File.ID)
		return "", err
	}
	if replaced != "" && replaced != up.File.ID {
		cancel(replaced)
	}
	return etag, nil
}

// folderContentAccepts is the content route's file check: pending, a put
// target, and not a presigned one (a ref without a content ETag).
func folderContentAccepts(f db.DocumentFolderUploadFile) error {
	if f.Status != folderUploadFilePending {
		return errFolderUploadFileSettled()
	}
	if f.TargetKind != folderUploadTargetPut || (f.UploadRef.Valid && !f.ContentEtag.Valid) {
		return errFolderUploadTargetSigned()
	}
	return nil
}

// recordFolderUploadContent points the file at its new upload under the batch
// lock, so a COMPLETE or a cancel running at the same time sees either the
// old upload or the new one. It answers the upload it replaced, if any.
func (s *DocumentService) recordFolderUploadContent(ctx context.Context, batch db.DocumentFolderUpload, fileKey string, fileID files.FileID, etag string) (files.FileID, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	locked, err := s.lockFolderUpload(ctx, q, batch)
	if err != nil {
		return "", err
	}
	if err := s.folderUploadWritable(locked); err != nil {
		return "", err
	}
	f, err := s.folderUploadFile(ctx, q, locked, fileKey)
	if err != nil {
		return "", err
	}
	if err := folderContentAccepts(f); err != nil {
		return "", err
	}
	if _, err := q.SetDocumentFolderUploadFileContent(ctx, db.SetDocumentFolderUploadFileContentParams{
		UploadRef: nullText(string(fileID)), ContentEtag: nullText(etag),
		ID: f.ID, OrganizationID: f.OrganizationID, WorkspaceID: f.WorkspaceID,
	}); err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return files.FileID(f.UploadRef.String), nil
}

func (s *DocumentService) lockFolderUpload(ctx context.Context, q *db.Queries, batch db.DocumentFolderUpload) (db.DocumentFolderUpload, error) {
	locked, err := q.LockDocumentFolderUpload(ctx, db.LockDocumentFolderUploadParams{
		ID: batch.ID, OrganizationID: batch.OrganizationID, WorkspaceID: batch.WorkspaceID,
		CreatedBy: batch.CreatedBy, CreatedByKind: batch.CreatedByKind,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.DocumentFolderUpload{}, ErrNotFound
	}
	return locked, err
}

// folderFileFailure is one file's refusal (contract AMENDMENT 1, Q11). A
// final one (unsupported_media, storage_quota_exceeded) marks the file failed
// for good; any other (upload_missing, parts_invalid, size_mismatch) leaves
// it pending and retryable. reset drops the file's upload as well, because
// those bytes can never complete (a wrong size, an upload that is gone): the
// next GET mints a fresh target.
type folderFileFailure struct {
	code   string
	reason string
	final  bool
	reset  bool
}

func (f folderFileFailure) Error() string { return "folder upload file: " + f.code }

// storedCode is what error_code keeps: the code, and the reason after a colon.
func (f folderFileFailure) storedCode() string {
	if f.reason == "" {
		return f.code
	}
	return f.code + ":" + f.reason
}

// SplitFolderUploadErrorCode splits a stored error_code into its code and
// reason (unsupported_media keeps the validation reason after a colon).
func SplitFolderUploadErrorCode(stored string) (code, reason string) {
	code, reason, _ = strings.Cut(stored, ":")
	return code, reason
}

// unsupportedFailure turns a document validation refusal (415) into a final
// unsupported_media failure; anything else stays an error of the call.
func unsupportedFailure(err error) error {
	var ce CodedError
	if errors.As(err, &ce) && ce.Status == http.StatusUnsupportedMediaType {
		reason, _ := ce.Fields["reason"].(string)
		return folderFileFailure{code: folderFileUnsupported, reason: reason, final: true}
	}
	return err
}

// CompleteFolderUpload is COMPLETE (§2): at most complete_batch files, each
// checked and created on its own (partial success, HTTP 200 whatever the
// per-file results). A file already done answers its document again (the
// call is idempotent per file_key); a file_key outside the batch answers
// not_found. When no file is pending any more the batch is completed.
func (s *DocumentService) CompleteFolderUpload(ctx context.Context, actor Actor, workspaceID, batchID string, in []CompleteFolderUploadFileInput) (FolderUploadCompleteResult, error) {
	if actor.Kind != audit.KindHuman || !validActor(actor) {
		return FolderUploadCompleteResult{}, ErrForbidden
	}
	limits := s.FolderUploadLimits()
	if len(in) == 0 {
		return FolderUploadCompleteResult{}, Invalid("files không được rỗng")
	}
	if len(in) > limits.CompleteBatch {
		return FolderUploadCompleteResult{}, CodedError{
			Status: http.StatusBadRequest, Code: "invalid_request",
			Msg:    "mỗi lần hoàn tất tối đa " + strconv.Itoa(limits.CompleteBatch) + " tệp",
			Fields: map[string]any{"max": limits.CompleteBatch},
		}
	}
	seen := make(map[string]bool, len(in))
	for _, f := range in {
		if seen[f.FileKey] {
			return FolderUploadCompleteResult{}, errFolderUploadPath("file_key", f.FileKey, "file_key bị trùng trong lần hoàn tất")
		}
		seen[f.FileKey] = true
	}
	batch, err := s.folderUploadForWrite(ctx, actor, workspaceID, batchID)
	if err != nil {
		return FolderUploadCompleteResult{}, err
	}
	fs, err := s.fileService()
	if err != nil {
		return FolderUploadCompleteResult{}, err
	}
	out := FolderUploadCompleteResult{Results: make([]FolderUploadFileOutcome, 0, len(in))}
	emitted := false
	for _, f := range in {
		r, err := s.completeFolderUploadFile(ctx, fs, actor, batch, f, &emitted)
		if err != nil {
			return FolderUploadCompleteResult{}, err
		}
		out.Results = append(out.Results, r)
	}
	if _, err := s.q.CompleteSettledDocumentFolderUpload(ctx, db.CompleteSettledDocumentFolderUploadParams{
		ID: batch.ID, OrganizationID: batch.OrganizationID, WorkspaceID: batch.WorkspaceID,
	}); err != nil {
		return FolderUploadCompleteResult{}, err
	}
	view, err := s.folderUploadView(ctx, actor, batch.OrganizationID, batch.WorkspaceID, batch.ID, false)
	if err != nil {
		return FolderUploadCompleteResult{}, err
	}
	out.Status, out.Counts = view.Status, view.Counts
	return out, nil
}

// completeFolderUploadFile answers one file of a COMPLETE. A refusal of the
// file is a result; only a failure of the call itself is an error.
func (s *DocumentService) completeFolderUploadFile(ctx context.Context, fs files.Service, actor Actor, batch db.DocumentFolderUpload, in CompleteFolderUploadFileInput, emitted *bool) (FolderUploadFileOutcome, error) {
	out := FolderUploadFileOutcome{FileKey: in.FileKey}
	f, err := s.folderUploadFile(ctx, s.q, batch, in.FileKey)
	if errors.Is(err, ErrNotFound) {
		out.Status, out.ErrorCode = folderUploadFileFailed, folderFileNotFound
		return out, nil
	}
	if err != nil {
		return out, err
	}
	docID, err := s.settleFolderUploadFile(ctx, fs, actor, batch, f, in, emitted)
	var failure folderFileFailure
	switch {
	case errors.As(err, &failure):
		switch {
		case failure.final && f.Status == folderUploadFilePending:
			if _, err := s.q.MarkDocumentFolderUploadFileFailed(ctx, db.MarkDocumentFolderUploadFileFailedParams{
				ErrorCode: nullText(failure.storedCode()), ID: f.ID, OrganizationID: f.OrganizationID, WorkspaceID: f.WorkspaceID,
			}); err != nil {
				return out, err
			}
		case failure.reset && f.UploadRef.Valid:
			if err := s.resetFolderUploadFile(ctx, fs, actor, batch, f); err != nil {
				return out, err
			}
		}
		out.Status, out.ErrorCode, out.Reason = folderUploadFileFailed, failure.code, failure.reason
		out.Retryable = !failure.final && f.Status == folderUploadFilePending
		return out, nil
	case err != nil:
		return out, err
	}
	out.Status, out.DocumentID = folderUploadFileDone, docID
	return out, nil
}

// folderUploadFileParent is the document a file of the batch lands under; ""
// is the workspace root. A files-mode plan stores its parent_id here, NULL
// for a root upload.
func folderUploadFileParent(f db.DocumentFolderUploadFile) string {
	return f.FolderID.String
}

// resetFolderUploadFile drops a pending file's upload: a put target's staged
// FileService upload is canceled (best effort: an unclaimed upload is
// collected after its claim window anyway) and the row forgets it. A
// multipart session is already failed, aborted or gone when this runs.
func (s *DocumentService) resetFolderUploadFile(ctx context.Context, fs files.Service, actor Actor, batch db.DocumentFolderUpload, f db.DocumentFolderUploadFile) error {
	if f.TargetKind == folderUploadTargetPut {
		_ = fs.CancelUpload(context.WithoutCancel(ctx), files.CancelInput{
			Actor: actor, Scope: documentScope(batch.OrganizationID, batch.WorkspaceID), FileID: files.FileID(f.UploadRef.String),
		})
	}
	_, err := s.q.ResetDocumentFolderUploadFileRef(ctx, db.ResetDocumentFolderUploadFileRefParams{
		ID: f.ID, OrganizationID: f.OrganizationID, WorkspaceID: f.WorkspaceID, UploadRef: f.UploadRef,
	})
	return err
}

// settleFolderUploadFile answers the document of a done file, the stored
// failure of a failed one, and otherwise verifies the upload and creates the
// document.
func (s *DocumentService) settleFolderUploadFile(ctx context.Context, fs files.Service, actor Actor, batch db.DocumentFolderUpload, f db.DocumentFolderUploadFile, in CompleteFolderUploadFileInput, emitted *bool) (string, error) {
	switch f.Status {
	case folderUploadFileDone:
		return f.DocumentID.String, nil
	case folderUploadFileFailed:
		code, reason := SplitFolderUploadErrorCode(f.ErrorCode.String)
		return "", folderFileFailure{code: code, reason: reason}
	}
	if f.TargetKind == folderUploadTargetMulti {
		return s.completeFolderUploadMultipart(ctx, actor, batch, f, in, emitted)
	}
	fileID, err := s.verifyFolderUploadPut(ctx, fs, actor, batch, f, in)
	if err != nil {
		return "", err
	}
	return s.commitFolderUploadFile(ctx, fs, actor, batch, f, emitted,
		func(*db.Queries) (files.FileID, error) { return fileID, nil }, nil)
}

// verifyFolderUploadPut checks a put target's upload outside any transaction:
// the object is there (a content-route upload, or the provider output of a
// presigned PUT, which FileService verifies and stages), its ETag matches
// what the content route answered, its size is the planned one and its
// content passes the editor format check.
func (s *DocumentService) verifyFolderUploadPut(ctx context.Context, fs files.Service, actor Actor, batch db.DocumentFolderUpload, f db.DocumentFolderUploadFile, in CompleteFolderUploadFileInput) (files.FileID, error) {
	if !f.UploadRef.Valid {
		return "", folderFileFailure{code: folderFileUploadMissing}
	}
	scope := documentScope(batch.OrganizationID, batch.WorkspaceID)
	fileID := files.FileID(f.UploadRef.String)
	var file files.File
	if f.ContentEtag.Valid {
		// The content route stored these bytes; the ETag it answered is the
		// one the client must send back.
		if normalizeETag(in.ETag) != normalizeETag(f.ContentEtag.String) {
			return "", folderFileFailure{code: folderFilePartsInvalid}
		}
		res, err := fs.ResolveMany(ctx, files.ResolveInput{Scope: scope, Mode: files.ReadProxy, FileIDs: []files.FileID{fileID}})
		if err != nil {
			return "", documentFileError(err)
		}
		if res[0].Err != nil {
			return "", folderPutFailure(res[0].Err)
		}
		file = res[0].File
	} else {
		// A presigned PUT: the store's ETag is not something FileService
		// records, so the check is that the client sent one; the object
		// itself is verified below.
		if strings.TrimSpace(in.ETag) == "" {
			return "", folderFileFailure{code: folderFilePartsInvalid}
		}
		var err error
		file, err = fs.CompleteProviderOutput(ctx, files.CompleteOutputInput{
			Actor: actor, Scope: scope, FileID: fileID, OperationID: folderUploadOperationID(f),
		})
		if err != nil {
			return "", folderPutFailure(err)
		}
	}
	if file.SizeBytes != f.SizeBytes {
		return "", folderFileFailure{code: folderFileSizeMismatch, reset: true}
	}
	if _, err := s.checkStoredFile(ctx, fs, scope, file); err != nil {
		return "", unsupportedFailure(err)
	}
	return fileID, nil
}

// folderPutFailure maps a FileService refusal of a put target's upload onto a
// per-file result; anything that is not about this file stays an error.
func folderPutFailure(err error) error {
	var fe *files.Error
	if !errors.As(err, &fe) {
		return err
	}
	switch fe.Code {
	case files.CodeNotReady:
		// Not written yet: the client may still be uploading.
		return folderFileFailure{code: folderFileUploadMissing}
	case files.CodeNotFound, files.CodeUploadCanceled, files.CodeClaimExpired:
		return folderFileFailure{code: folderFileUploadMissing, reset: true}
	case files.CodeTooLarge:
		return folderFileFailure{code: folderFileSizeMismatch, reset: true}
	case files.CodeTypeRejected:
		return folderFileFailure{code: folderFileUnsupported, reason: fe.Code, final: true}
	}
	return documentFileError(err)
}

// commitFolderUploadFile creates one file's document in its own transaction:
// membership again, the batch lock (a cancel or another COMPLETE waits), the
// file still pending, stage (the multipart staging, or the file id as is),
// the files claim, the tree lock and the folder row, quota, the document and
// its version under the file's folder, its document.created audit row with
// the batch id, and the file marked done. after runs last, inside the
// transaction (the multipart row's completion). The first document of a call
// carries the call's document.batch_uploaded event.
func (s *DocumentService) commitFolderUploadFile(
	ctx context.Context, fs files.Service, actor Actor, batch db.DocumentFolderUpload, f db.DocumentFolderUploadFile, emitted *bool,
	stage func(*db.Queries) (files.FileID, error), after func(q *db.Queries, documentID string) error,
) (string, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	orgID, workspaceID := batch.OrganizationID, batch.WorkspaceID
	if _, err := s.ws.RequireMemberQ(ctx, q, workspaceID, actor.ID); err != nil {
		return "", err
	}
	locked, err := s.lockFolderUpload(ctx, q, batch)
	if err != nil {
		return "", err
	}
	if err := s.folderUploadWritable(locked); err != nil {
		return "", err
	}
	cur, err := s.folderUploadFile(ctx, q, locked, f.FileKey)
	if err != nil {
		return "", err
	}
	if cur.Status != folderUploadFilePending || cur.UploadRef.String != f.UploadRef.String {
		// Another COMPLETE settled the file, or a new PUT replaced its upload,
		// while this one verified: answer what is there now.
		_ = tx.Rollback(ctx)
		return s.settleFolderUploadFile(ctx, fs, actor, batch, cur, CompleteFolderUploadFileInput{}, emitted)
	}
	fileID, err := stage(q)
	if err != nil {
		return "", err
	}
	scope := documentScope(orgID, workspaceID)
	claimed, err := fs.ClaimInTx(ctx, q, files.ClaimInput{Actor: actor, Purpose: files.DocumentFile, Scope: scope, FileIDs: []files.FileID{fileID}})
	if err != nil {
		return "", folderPutFailure(err)
	}
	file := claimed[0]
	if err := q.LockDocumentTree(ctx, workspaceID); err != nil {
		return "", err
	}
	// The file's folder: the plan's folder, the parent of a files-mode plan,
	// or none (the workspace root), as the single upload files it.
	var parent *db.Document
	parentID := folderUploadFileParent(f)
	if parentID != "" {
		folder, err := s.lockPageParent(ctx, q, actor, parentID, orgID, workspaceID, DocumentKindFile)
		if err != nil {
			if isGateRefusal(err) {
				// The folder is gone or closed to the batch's creator.
				return "", folderFileFailure{code: folderFileNotFound, final: true}
			}
			return "", err
		}
		parent = &folder
	}
	requested := ""
	if locked.ShareWithWorkspace {
		requested = documentVisibilityWorkspace
	}
	visibility, level := createHomeRow(requested, parent)
	if err := s.consumeStorage(ctx, q, actor, orgID, workspaceID, file); err != nil {
		if errors.Is(err, ErrQuotaExceeded) {
			return "", folderFileFailure{code: folderFileQuotaExceeded, final: true}
		}
		return "", err
	}
	title, err := normalizeDocumentTitle(DocumentKindFile, files.SanitizeFilename(f.Filename))
	if err != nil {
		return "", err
	}
	position, err := q.NextDocumentPosition(ctx, db.NextDocumentPositionParams{
		OrganizationID: orgID, WorkspaceID: workspaceID, ParentID: nullText(parentID),
	})
	if err != nil {
		return "", err
	}
	docID, versionID := util.NewID(), util.NewID()
	doc, err := q.InsertDocument(ctx, db.InsertDocumentParams{
		ID: docID, OrganizationID: orgID, WorkspaceID: workspaceID, ParentID: nullText(parentID),
		Kind: DocumentKindFile, Title: title, Visibility: visibility, WorkspaceLevel: level,
		SearchText: documentSearchText(title, ""), CurrentVersion: 1,
		FileVersionID: pgtype.Text{String: versionID, Valid: true}, Revision: 1, Position: position,
		AclOwnerID: aclOwnerFor(actor), CreatedBy: actor.ID, CreatedByKind: string(actor.Kind),
		UpdatedBy: actor.ID, UpdatedByKind: string(actor.Kind),
		LastVersionAt: pgtype.Timestamptz{Time: s.now().UTC().Truncate(time.Microsecond), Valid: true},
	})
	if err != nil {
		return "", err
	}
	version, err := q.InsertDocumentVersion(ctx, fileVersionParams(doc, versionID, 1, "upload", actor, file, DocumentEngineInfo{}, pgtype.Int4{}))
	if err != nil {
		return "", err
	}
	var events []audit.Event
	if !*emitted {
		events = append(events, audit.Event{Topic: DocumentBatchUploadedTopic, Payload: map[string]string{
			"batch_id": batch.ID, "workspace_id": workspaceID, "root_folder_id": batch.RootFolderID,
		}})
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID, WorkspaceID: workspaceID, Actor: actor,
		Action: audit.ActionDocumentCreated, ResourceType: "document", ResourceID: doc.ID,
		Changes: audit.Diff(nil, map[string]any{
			"title": doc.Title, "kind": doc.Kind, "visibility": doc.Visibility, "version_id": version.ID, "file_id": string(file.ID),
		}),
		Metadata: map[string]any{"batch_id": batch.ID},
	}, events...); err != nil {
		return "", err
	}
	if _, err := q.MarkDocumentFolderUploadFileDone(ctx, db.MarkDocumentFolderUploadFileDoneParams{
		DocumentID: nullText(doc.ID), ID: f.ID, OrganizationID: orgID, WorkspaceID: workspaceID,
	}); err != nil {
		return "", err
	}
	if after != nil {
		if err := after(q, doc.ID); err != nil {
			return "", err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	*emitted = true
	return doc.ID, nil
}

// completeFolderUploadMultipart is the BIGUP-S1 complete of a large file
// (opened_via 'folder'): the validation lease, the parts matched against
// ListParts and assembled, the size, the probe hashes and the format check;
// then staging, the document and the multipart row's completion commit in
// one transaction fenced by the lease. A size, probe or content refusal fails
// the session (the object is dropped and the quota released) and the file
// for good; parts that do not match leave both open.
func (s *DocumentService) completeFolderUploadMultipart(ctx context.Context, actor Actor, batch db.DocumentFolderUpload, f db.DocumentFolderUploadFile, in CompleteFolderUploadFileInput, emitted *bool) (string, error) {
	if !f.UploadRef.Valid {
		return "", folderFileFailure{code: folderFileUploadMissing}
	}
	fs, err := s.multipartFileService()
	if err != nil {
		return "", err
	}
	row, err := s.q.GetFileMultipartUploadByID(ctx, f.UploadRef.String)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", folderFileFailure{code: folderFileUploadMissing, reset: true}
	}
	if err != nil {
		return "", err
	}
	now := s.now().UTC().Truncate(time.Microsecond)
	switch row.Status {
	case "failed":
		return "", multipartFailure(mapStoredUploadSessionFailure(row.FailureCode.String))
	case "expired", "aborted":
		return "", folderFileFailure{code: folderFileUploadMissing, reset: true}
	case "completed":
		// The session and the file commit together; a completed session under
		// a pending file is a bug, not a client error.
		return "", ErrConflict
	}
	leaseOwner := "folder-complete:" + util.NewID()
	leased, err := s.q.LeaseFileMultipartUploadForValidation(ctx, db.LeaseFileMultipartUploadForValidationParams{
		ID: row.ID, LeaseOwner: leaseOwner,
		LeaseExpiresAt: pgtype.Timestamptz{Time: now.Add(UploadSessionValidationLeaseTTL), Valid: true},
		Now:            pgtype.Timestamptz{Time: now, Valid: true},
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", errUploadSessionBusy()
	}
	if err != nil {
		return "", err
	}
	release := func(cause error) error {
		_, _ = s.q.ReleaseFileMultipartUploadLease(context.WithoutCancel(ctx), db.ReleaseFileMultipartUploadLeaseParams{
			ID: leased.ID, LeaseOwner: leaseOwner, Now: pgtype.Timestamptz{Time: s.now().UTC().Truncate(time.Microsecond), Valid: true},
		})
		return cause
	}
	fail := func(objectVersion, code string, failErr error, failure folderFileFailure) error {
		if err := s.failMultipartSession(ctx, fs, leased, leaseOwner, objectVersion, code, failErr); !sameCodedError(err, failErr) {
			return err
		}
		return failure
	}
	loc := storage.ObjectLocator{Storage: fs.backend, Bucket: fs.bucket, Key: leased.ObjectKey}
	size, objectVersion, err := s.assembleMultipartObject(ctx, fs, leased, loc, CompleteUploadSessionInput{Parts: in.Parts})
	if err != nil {
		var ce CodedError
		if errors.As(err, &ce) && ce.Code == "upload_parts_invalid" {
			return "", release(folderFileFailure{code: folderFilePartsInvalid})
		}
		return "", release(err)
	}
	if size != leased.SizeBytes || size != f.SizeBytes {
		return "", fail(objectVersion, "upload_size_mismatch", errUploadSizeMismatch(), folderFileFailure{code: folderFileSizeMismatch, reset: true})
	}
	probeMismatch := folderFileFailure{code: folderFileUnsupported, reason: folderFileProbeMismatch, final: true}
	headSHA, err := readObjectRangeSHA256(ctx, fs.store, loc, 0, min(leased.SizeBytes, int64(UploadSessionMaxProbeHeadBytes)))
	if err != nil {
		return "", release(documentFileError(files.StorageUnavailable(err)))
	}
	if headSHA != leased.ProbeHeadSha256 {
		return "", fail(objectVersion, "upload_probe_mismatch", errUploadProbeMismatch(), probeMismatch)
	}
	expectedMIME, _ := document.ExpectedMIMEForExtension(leased.Filename)
	if document.RequiresZipCentralDirectory(expectedMIME) || leased.ProbeTailSha256 != "" || leased.CdOffset.Valid || leased.CdSize.Valid {
		if !leased.CdOffset.Valid || !leased.CdSize.Valid || leased.CdSize.Int64 <= 0 || leased.ProbeTailSha256 == "" {
			return "", fail(objectVersion, "upload_probe_mismatch", errUploadProbeMismatch(), probeMismatch)
		}
		tailSHA, err := readObjectRangeSHA256(ctx, fs.store, loc, leased.CdOffset.Int64, leased.CdSize.Int64)
		if err != nil {
			return "", release(documentFileError(files.StorageUnavailable(err)))
		}
		if tailSHA != leased.ProbeTailSha256 {
			return "", fail(objectVersion, "upload_probe_mismatch", errUploadProbeMismatch(), probeMismatch)
		}
	}
	contentType, checksum, valErr := s.streamValidateAssembledObject(ctx, fs, loc, leased.Filename, leased.SizeBytes)
	if valErr != nil {
		var fe *document.FileError
		var ce CodedError
		switch {
		case errors.As(valErr, &fe):
			return "", fail(objectVersion, document.ErrCodeUnsupportedMedia+":"+fe.Reason, documentValidationError(valErr),
				folderFileFailure{code: folderFileUnsupported, reason: fe.Reason, final: true})
		case errors.As(valErr, &ce) && ce.Status == http.StatusUnsupportedMediaType:
			reason, _ := ce.Fields["reason"].(string)
			return "", fail(objectVersion, document.ErrCodeUnsupportedMedia+":"+reason, ce,
				folderFileFailure{code: folderFileUnsupported, reason: reason, final: true})
		default:
			return "", release(valErr)
		}
	}
	stageIn := multipartStageInput{contentType: contentType, sizeBytes: leased.SizeBytes, checksum: checksum, versionID: objectVersion}
	docID, err := s.commitFolderUploadFile(ctx, fs, actor, batch, f, emitted,
		func(q *db.Queries) (files.FileID, error) {
			if _, err := q.LockFileMultipartUploadForLeaseOwner(ctx, db.LockFileMultipartUploadForLeaseOwnerParams{ID: leased.ID, LeaseOwner: leaseOwner}); err != nil {
				if errors.Is(err, pgx.ErrNoRows) {
					return "", errUploadSessionBusy()
				}
				return "", err
			}
			staged, err := fs.stageMultipartUploadInTx(ctx, q, leased.FileID, leased.FileUploadSessionID, stageIn)
			if err != nil {
				return "", err
			}
			return staged.File.ID, nil
		},
		func(q *db.Queries, documentID string) error {
			_, err := q.CompleteFileMultipartUpload(ctx, db.CompleteFileMultipartUploadParams{
				ID: leased.ID, LeaseOwner: leaseOwner, ResultDocumentID: nullText(documentID),
				ClosedAt: pgtype.Timestamptz{Time: s.now().UTC().Truncate(time.Microsecond), Valid: true},
			})
			if errors.Is(err, pgx.ErrNoRows) {
				return errUploadSessionBusy()
			}
			return err
		})
	if err != nil {
		return "", release(err)
	}
	return docID, nil
}

// multipartFailure maps the stored failure of a multipart session onto the
// file's final failure.
func multipartFailure(err error) error {
	var ce CodedError
	if !errors.As(err, &ce) {
		return err
	}
	switch ce.Code {
	case "upload_size_mismatch":
		return folderFileFailure{code: folderFileSizeMismatch, reset: true}
	case "upload_probe_mismatch":
		return folderFileFailure{code: folderFileUnsupported, reason: folderFileProbeMismatch, final: true}
	}
	reason, _ := ce.Fields["reason"].(string)
	return folderFileFailure{code: folderFileUnsupported, reason: reason, final: true}
}

// sameCodedError reports whether failMultipartSession answered the refusal it
// was given as is, which means the failed row committed.
func sameCodedError(got, want error) bool {
	g, ok := got.(CodedError)
	w, wok := want.(CodedError)
	return ok && wok && g.Code == w.Code
}
