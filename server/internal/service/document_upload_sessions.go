package service

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
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

const (
	UploadSessionThresholdBytes      int64 = 20 << 20
	UploadSessionPartSizeBytes       int64 = 8 << 20
	UploadSessionMaxOpenPerActor     int64 = 4
	UploadSessionTTL                       = 24 * time.Hour
	UploadSessionPartURLTTL                = time.Hour
	UploadSessionValidationLeaseTTL        = 10 * time.Minute
	UploadSessionMaxProbeHeadBytes         = 64 << 10
	UploadSessionMaxProbeCentralSize       = 1 << 20

	idempotencyScopeUploadSessionOpen = "documents.upload_sessions.open"
)

type UploadSessionProbeInput struct {
	HeadB64       string
	CentralDirB64 string
	CDOffset      int64
	CDSize        int64
}

type OpenUploadSessionInput struct {
	Filename       string
	SizeBytes      int64
	Title          string
	ParentID       *string
	Visibility     string
	Probe          UploadSessionProbeInput
	IdempotencyKey string
}

type UploadSessionPartURL struct {
	PartNumber int
	Method     string
	URL        string
	Headers    map[string][]string
	ExpiresAt  time.Time
}

type UploadSessionCompletedPart struct {
	PartNumber int
	ETag       string
	SizeBytes  int64
}

type UploadSessionView struct {
	SessionID      string
	FileID         string
	Status         string
	PartSize       int64
	TotalParts     int
	ExpiresAt      time.Time
	CompletedParts []UploadSessionCompletedPart
	Parts          []UploadSessionPartURL
}

type CompleteUploadPartInput struct {
	PartNumber int
	ETag       string
}

type CompleteUploadSessionInput struct {
	Parts []CompleteUploadPartInput
}

type UploadSessionCompleteResult struct {
	OpenedVia string
	Document  *DocumentFileResult
	Upload    *DocumentUpload
}

// SupportsChunkedUpload reports whether the active object store supports both
// multipart uploads and presigned URLs (Contract §1).
func (s *FileService) SupportsChunkedUpload() bool {
	if s == nil || s.store == nil {
		return false
	}
	caps := s.store.Capabilities()
	return caps.Multipart && caps.Presign
}

// SupportsChunkedUpload reports whether DocumentService is wired to a
// FileService whose backend supports chunked multipart uploads.
func (s *DocumentService) SupportsChunkedUpload() bool {
	if s == nil || s.files == nil {
		return false
	}
	if fs, ok := s.files.(*FileService); ok {
		return fs.SupportsChunkedUpload()
	}
	if capProvider, ok := s.files.(interface{ SupportsChunkedUpload() bool }); ok {
		return capProvider.SupportsChunkedUpload()
	}
	return false
}

func (s *DocumentService) multipartFileService() (*FileService, error) {
	if s == nil || s.files == nil {
		return nil, errDocumentStoreMissing
	}
	fs, ok := s.files.(*FileService)
	if !ok || !fs.SupportsChunkedUpload() {
		return nil, documentFileError(files.StorageUnavailable(storage.ErrCapabilityUnsupported))
	}
	return fs, nil
}

type preparedMultipartUpload struct {
	file            db.File
	fileSession     db.FileUploadSession
	storageUploadID string
	leaseOwner      string
}

func (s *FileService) prepareMultipartUpload(
	ctx context.Context,
	actor Actor,
	scope files.Scope,
	filename string,
	contentType string,
	sizeBytes int64,
	quotaOverride FileQuotaHook,
) (preparedMultipartUpload, error) {
	spec, err := s.registry.Lookup(files.DocumentFile)
	if err != nil {
		return preparedMultipartUpload{}, err
	}
	if err := spec.ValidateScope(scope); err != nil {
		return preparedMultipartUpload{}, err
	}

	var file db.File
	var sess db.FileUploadSession
	var owner string
	err = s.inTx(ctx, func(q *db.Queries) error {
		now := s.now()
		var txErr error
		file, txErr = s.insertIntentFile(ctx, q, spec, scope, filename, now)
		if txErr != nil {
			return txErr
		}
		idemKey := "multipart:" + file.ID
		sess, txErr = q.InsertUploadSession(ctx, db.InsertUploadSessionParams{
			ID:                 s.newID(),
			FileID:             file.ID,
			CreatedBy:          actor.ID,
			CreatedByKind:      string(actor.Kind),
			Purpose:            string(spec.Purpose),
			OrganizationID:     fileText(scope.OrganizationID),
			WorkspaceID:        fileText(scope.WorkspaceID),
			UserID:             fileText(scope.UserID),
			IdempotencyKey:     idemKey,
			CommandFingerprint: idemKey,
		})
		if txErr != nil {
			return fmt.Errorf("files: record multipart session: %w", txErr)
		}
		owner, txErr = s.takeLease(ctx, q, sess.ID, "multipart:"+s.newID(), now.Add(UploadSessionTTL+time.Hour), now)
		return txErr
	})
	if err != nil {
		return preparedMultipartUpload{}, err
	}

	quota := s.quota
	if quota == nil {
		quota = quotaOverride
	}
	if quota != nil && scope.OrganizationID != "" {
		if err := quota.ReserveFileBytes(ctx, scope.OrganizationID, files.FileID(file.ID), sizeBytes); err != nil {
			s.cancelMultipartFileSession(ctx, file.ID, sess.ID, false)
			return preparedMultipartUpload{}, err
		}
	}

	loc := locator(file)
	uploadID, err := s.store.CreateMultipart(ctx, loc, storage.WriteInfo{
		ContentType: contentType,
		SizeBytes:   sizeBytes,
		Filename:    file.OriginalFilename,
	})
	if err != nil {
		s.cancelMultipartFileSession(ctx, file.ID, sess.ID, false)
		return preparedMultipartUpload{}, files.StorageUnavailable(err)
	}

	return preparedMultipartUpload{
		file:            file,
		fileSession:     sess,
		storageUploadID: uploadID,
		leaseOwner:      owner,
	}, nil
}

func (s *FileService) cancelMultipartFileSession(ctx context.Context, fileID, fileSessionID string, enqueueCleanup bool) {
	ctx = context.WithoutCancel(ctx)
	_ = s.inTx(ctx, func(q *db.Queries) error {
		now := s.now()
		file, err := q.GetFileByID(ctx, fileID)
		if err != nil {
			return err
		}
		_, _ = q.CancelUploadSession(ctx, db.CancelUploadSessionParams{
			ID:       fileSessionID,
			ClosedAt: fileTime(now),
		})
		_, _ = q.MarkFileFailed(ctx, fileID)
		_, _ = q.CancelPendingFileJobs(ctx, db.CancelPendingFileJobsParams{
			FileID:     fileID,
			Operation:  fileJobReconcile,
			FinishedAt: fileTime(now),
		})
		if enqueueCleanup {
			return s.enqueueJob(ctx, q, file, fileJobCleanup, now)
		}
		return nil
	})
}

func (s *FileService) signMultipartParts(ctx context.Context, objectKey, storageUploadID string, partNumbers []int) ([]UploadSessionPartURL, error) {
	loc := storage.ObjectLocator{Storage: s.backend, Bucket: s.bucket, Key: objectKey}
	out := make([]UploadSessionPartURL, 0, len(partNumbers))
	for _, num := range partNumbers {
		signed, err := s.store.SignUploadPart(ctx, loc, storageUploadID, int32(num), storage.SignOptions{
			TTL: UploadSessionPartURLTTL,
		})
		if err != nil {
			return nil, files.StorageUnavailable(err)
		}
		var hdrs map[string][]string
		if len(signed.Headers) > 0 {
			hdrs = make(map[string][]string, len(signed.Headers))
			for k, v := range signed.Headers {
				hdrs[k] = []string{v}
			}
		}
		out = append(out, UploadSessionPartURL{
			PartNumber: num,
			Method:     signed.Method,
			URL:        signed.URL,
			Headers:    hdrs,
			ExpiresAt:  signed.ExpiresAt,
		})
	}
	return out, nil
}

func (s *FileService) stageMultipartUpload(
	ctx context.Context,
	fileID, fileSessionID, contentType string,
	sizeBytes int64,
	checksum, version string,
) (files.Upload, error) {
	var result files.Upload
	ctx = context.WithoutCancel(ctx)
	err := s.inTx(ctx, func(q *db.Queries) error {
		now := s.now()
		claimExpires := now.Add(files.ClaimTTL)
		if _, err := q.LockFilesInIDOrder(ctx, []string{fileID}); err != nil {
			return err
		}
		if _, err := q.GetUploadSessionByIDForUpdate(ctx, fileSessionID); err != nil {
			return err
		}
		if _, err := q.MarkUploadSessionStaged(ctx, db.MarkUploadSessionStagedParams{
			ID:             fileSessionID,
			ClaimExpiresAt: fileTime(claimExpires),
		}); err != nil {
			return err
		}
		if _, err := q.MarkFileReady(ctx, db.MarkFileReadyParams{
			ID:             fileID,
			ContentType:    fileText(contentType),
			SizeBytes:      pgtype.Int8{Int64: sizeBytes, Valid: true},
			ChecksumSha256: fileText(checksum),
			Metadata:       []byte("{}"),
			ObjectVersion:  fileText(version),
			ReadyAt:        fileTime(now),
		}); err != nil {
			return err
		}
		file, err := q.GetFileByID(ctx, fileID)
		if err != nil {
			return err
		}
		result = files.Upload{
			File:            fileView(file),
			UploadSessionID: fileSessionID,
			ClaimExpiresAt:  claimExpires,
		}
		return nil
	})
	return result, err
}

// OpenWorkspaceUploadSession opens a multipart upload session for creating a
// new file document (> 20 MiB) in workspaceID.
func (s *DocumentService) OpenWorkspaceUploadSession(ctx context.Context, actor Actor, workspaceID string, in OpenUploadSessionInput) (UploadSessionView, error) {
	if actor.Kind != audit.KindHuman || !validActor(actor) {
		return UploadSessionView{}, ErrForbidden
	}
	var parentID string
	if in.ParentID != nil {
		parentID = strings.TrimSpace(*in.ParentID)
	}
	if in.Visibility != "" {
		if err := validDocumentVisibility(in.Visibility); err != nil {
			return UploadSessionView{}, err
		}
	}
	ws, err := s.ws.RequireMember(ctx, workspaceID, actor.ID)
	if err != nil {
		return UploadSessionView{}, err
	}
	orgID, err := s.workspaceOrganization(ctx, ws.WorkspaceID)
	if err != nil {
		return UploadSessionView{}, err
	}
	rawTitle := strings.TrimSpace(in.Title)
	if rawTitle == "" {
		rawTitle = files.SanitizeFilename(in.Filename)
	}
	normTitle, err := normalizeDocumentTitle(DocumentKindFile, rawTitle)
	if err != nil {
		return UploadSessionView{}, err
	}
	if parentID != "" {
		if _, err := s.lockPageParent(ctx, s.q, actor, parentID, orgID, workspaceID, DocumentKindFile); err != nil {
			return UploadSessionView{}, err
		}
	}
	return s.openUploadSession(ctx, actor, openSessionTarget{
		openedVia:   "workspace",
		orgID:       orgID,
		workspaceID: workspaceID,
		targetID:    workspaceID,
		title:       normTitle,
		parentID:    parentID,
		visibility:  in.Visibility,
	}, in)
}

// OpenVersionUploadSession opens a multipart upload session for uploading a
// new version (> 20 MiB) of an existing file document.
func (s *DocumentService) OpenVersionUploadSession(ctx context.Context, actor Actor, documentID string, in OpenUploadSessionInput) (UploadSessionView, error) {
	if actor.Kind != audit.KindHuman || !validActor(actor) {
		return UploadSessionView{}, ErrForbidden
	}
	doc, access, err := s.preflightDocument(ctx, actor, documentID)
	if err != nil {
		return UploadSessionView{}, err
	}
	if err := decideFileSave(doc, access); err != nil {
		return UploadSessionView{}, err
	}
	return s.openUploadSession(ctx, actor, openSessionTarget{
		openedVia:   "version",
		orgID:       doc.OrganizationID,
		workspaceID: doc.WorkspaceID,
		documentID:  doc.ID,
		targetID:    doc.ID,
	}, in)
}

// OpenFrameUploadSession opens a multipart upload session from an Office
// frame token bound to documentID.
func (s *DocumentService) OpenFrameUploadSession(ctx context.Context, claims OfficeFrameClaims, documentID string, in OpenUploadSessionInput) (UploadSessionView, error) {
	if claims.UserID == "" || claims.DocumentID == "" || claims.DocumentID != documentID {
		return UploadSessionView{}, ErrNotFound
	}
	actor := Human(claims.UserID)
	doc, access, err := s.preflightDocument(ctx, actor, documentID)
	if err != nil {
		return UploadSessionView{}, err
	}
	if doc.WorkspaceID != claims.WorkspaceID || doc.OrganizationID != claims.OrganizationID {
		return UploadSessionView{}, ErrNotFound
	}
	if err := decideFileSave(doc, access); err != nil {
		return UploadSessionView{}, err
	}
	return s.openUploadSession(ctx, actor, openSessionTarget{
		openedVia:       "frame",
		orgID:           doc.OrganizationID,
		workspaceID:     doc.WorkspaceID,
		documentID:      doc.ID,
		tokenDocumentID: claims.DocumentID,
		targetID:        doc.ID,
	}, in)
}

type openSessionTarget struct {
	openedVia       string
	orgID           string
	workspaceID     string
	documentID      string
	tokenDocumentID string
	targetID        string
	title           string
	parentID        string
	visibility      string
}

func (s *DocumentService) openUploadSession(ctx context.Context, actor Actor, tgt openSessionTarget, in OpenUploadSessionInput) (UploadSessionView, error) {
	// Step 2: size bounds (<= 20 MiB -> 422 upload_session_too_small; > cap -> 413 file_too_large).
	if in.SizeBytes <= UploadSessionThresholdBytes {
		return UploadSessionView{}, CodedError{
			Code:   "upload_session_too_small",
			Status: http.StatusUnprocessableEntity,
			Msg:    "tệp từ 20 MiB trở xuống phải dùng đường tải lên một lượt",
		}
	}
	maxBytes := s.documentFileMaxBytes()
	if in.SizeBytes > maxBytes {
		return UploadSessionView{}, CodedError{
			Code:   "file_too_large",
			Status: http.StatusRequestEntityTooLarge,
			Msg:    "tệp vượt quá dung lượng cho phép",
			Fields: map[string]any{"max_bytes": maxBytes},
		}
	}

	// Step 3: extension allowlist check.
	sanitizedFilename := files.SanitizeFilename(in.Filename)
	expectedMIME, ok := document.ExpectedMIMEForExtension(sanitizedFilename)
	if !ok {
		return UploadSessionView{}, CodedError{
			Code:   document.ErrCodeUnsupportedMedia,
			Status: http.StatusUnsupportedMediaType,
			Msg:    "định dạng tệp không được hỗ trợ",
			Fields: map[string]any{"reason": files.CodeTypeRejected},
		}
	}

	// Step 4: decode and validate probe (head_b64 + central_dir_b64).
	head, err := decodeBase64Probe(in.Probe.HeadB64)
	if err != nil || len(head) > UploadSessionMaxProbeHeadBytes || int64(len(head)) > in.SizeBytes {
		return UploadSessionView{}, Invalid("probe.head_b64 không hợp lệ hoặc vượt quá 64 KiB")
	}
	var centralDir []byte
	if strings.TrimSpace(in.Probe.CentralDirB64) != "" {
		centralDir, err = decodeBase64Probe(in.Probe.CentralDirB64)
		if err != nil || len(centralDir) > UploadSessionMaxProbeCentralSize || in.Probe.CDSize > UploadSessionMaxProbeCentralSize {
			return UploadSessionView{}, Invalid("probe.central_dir_b64 không hợp lệ hoặc vượt quá 1 MiB")
		}
	}
	if err := document.ValidateUploadProbe(expectedMIME, in.SizeBytes, head, centralDir, in.Probe.CDOffset, in.Probe.CDSize, s.fileLimits()); err != nil {
		return UploadSessionView{}, documentValidationError(err)
	}
	probeHeadSHA := sha256Hex(head)
	var probeTailSHA string
	if len(centralDir) > 0 {
		probeTailSHA = sha256Hex(centralDir)
	}

	fs, err := s.multipartFileService()
	if err != nil {
		return UploadSessionView{}, err
	}

	// Step 5: Idempotency pre-check before touching storage or quota.
	fp := uploadSessionOpenFingerprint(
		tgt.openedVia, tgt.targetID, sanitizedFilename, in.SizeBytes,
		tgt.parentID, tgt.title, tgt.visibility,
		probeHeadSHA, probeTailSHA, in.Probe.CDOffset, in.Probe.CDSize,
	)
	if strings.TrimSpace(in.IdempotencyKey) != "" {
		replayView, found, err := s.checkOpenSessionIdempotency(ctx, fs, tgt.orgID, tgt.workspaceID, actor.ID, in.IdempotencyKey, fp)
		if err != nil {
			return UploadSessionView{}, err
		}
		if found {
			return replayView, nil
		}
	}

	// Step 6 (fast check before S3): per-user open session limit (< 4).
	openCount, err := s.q.CountOpenFileMultipartUploadsByActor(ctx, actor.ID)
	if err != nil {
		return UploadSessionView{}, err
	}
	if openCount >= UploadSessionMaxOpenPerActor {
		return UploadSessionView{}, errUploadSessionsExhausted()
	}

	// Step 7 & 8: FileService session receiving + ReserveFileBytes + CreateMultipart.
	scope := documentScope(tgt.orgID, tgt.workspaceID)
	prep, err := fs.prepareMultipartUpload(ctx, actor, scope, sanitizedFilename, expectedMIME, in.SizeBytes, s.entitlements)
	if err != nil {
		return UploadSessionView{}, documentFileError(err)
	}

	abortPrepared := func() {
		loc := locator(prep.file)
		_ = fs.store.AbortMultipart(context.Background(), loc, prep.storageUploadID)
		fs.cancelMultipartFileSession(context.Background(), prep.file.ID, prep.fileSession.ID, false)
	}

	// Step 6 (locked in tx), Step 9 (insert file_multipart_uploads), Step 10 (audit).
	now := s.now().UTC().Truncate(time.Microsecond)
	expiresAt := now.Add(UploadSessionTTL)
	totalParts := int((in.SizeBytes + UploadSessionPartSizeBytes - 1) / UploadSessionPartSizeBytes)
	sessionID := util.NewID()

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		abortPrepared()
		return UploadSessionView{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)

	replay, commitIdem, err := BeginIdempotent(
		ctx, q, tgt.orgID, tgt.workspaceID,
		idempotencyScopeUploadSessionOpen, in.IdempotencyKey, actor.ID,
		IdempotencyOptions{Fingerprint: fp, RequireFingerprint: true},
	)
	if err != nil {
		abortPrepared()
		return UploadSessionView{}, NormalizeIdempotencyError(err)
	}
	if replay != nil {
		abortPrepared()
		return s.loadOpenSessionReplay(ctx, fs, string(replay.Body))
	}

	if err := q.LockUserMembership(ctx, actor.ID); err != nil {
		abortPrepared()
		return UploadSessionView{}, err
	}
	lockedCount, err := q.CountOpenFileMultipartUploadsByActor(ctx, actor.ID)
	if err != nil {
		abortPrepared()
		return UploadSessionView{}, err
	}
	if lockedCount >= UploadSessionMaxOpenPerActor {
		abortPrepared()
		return UploadSessionView{}, errUploadSessionsExhausted()
	}

	var cdOffsetPg, cdSizePg pgtype.Int8
	if len(centralDir) > 0 {
		cdOffsetPg = pgtype.Int8{Int64: in.Probe.CDOffset, Valid: true}
		cdSizePg = pgtype.Int8{Int64: in.Probe.CDSize, Valid: true}
	}
	row, err := q.InsertFileMultipartUpload(ctx, db.InsertFileMultipartUploadParams{
		ID:                  sessionID,
		OrganizationID:      tgt.orgID,
		WorkspaceID:         tgt.workspaceID,
		DocumentID:          nullText(tgt.documentID),
		FileID:              prep.file.ID,
		FileUploadSessionID: prep.fileSession.ID,
		CreatedBy:           actor.ID,
		CreatedByKind:       string(actor.Kind),
		OpenedVia:           tgt.openedVia,
		TokenDocumentID:     nullText(tgt.tokenDocumentID),
		StorageUploadID:     prep.storageUploadID,
		ObjectKey:           prep.file.ObjectKey,
		Filename:            sanitizedFilename,
		SizeBytes:           in.SizeBytes,
		PartSize:            UploadSessionPartSizeBytes,
		TotalParts:          int32(totalParts),
		Title:               nullText(tgt.title),
		ParentID:            nullText(tgt.parentID),
		Visibility:          nullText(tgt.visibility),
		ProbeHeadSha256:     probeHeadSHA,
		ProbeTailSha256:     nullText(probeTailSHA),
		CdOffset:            cdOffsetPg,
		CdSize:              cdSizePg,
		ExpiresAt:           pgtype.Timestamptz{Time: expiresAt, Valid: true},
		CreatedAt:           pgtype.Timestamptz{Time: now, Valid: true},
	})
	if err != nil {
		abortPrepared()
		return UploadSessionView{}, err
	}

	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: tgt.orgID,
		WorkspaceID:    tgt.workspaceID,
		Actor:          actor,
		Action:         audit.ActionDocumentUploadSessionOpened,
		ResourceType:   "upload_session",
		ResourceID:     row.ID,
		Changes: audit.Diff(nil, map[string]any{
			"session_id": row.ID,
			"file_id":    row.FileID,
			"size_bytes": row.SizeBytes,
		}),
		Metadata: map[string]any{
			"session_id": row.ID,
			"file_id":    row.FileID,
			"size_bytes": row.SizeBytes,
		},
	}); err != nil {
		abortPrepared()
		return UploadSessionView{}, err
	}

	if err := commitIdem(http.StatusCreated, []byte(row.ID)); err != nil {
		abortPrepared()
		return UploadSessionView{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		abortPrepared()
		return UploadSessionView{}, err
	}

	// Step 11: sign all part URLs (TTL 1h).
	partNums := make([]int, totalParts)
	for i := 0; i < totalParts; i++ {
		partNums[i] = i + 1
	}
	parts, err := fs.signMultipartParts(ctx, row.ObjectKey, row.StorageUploadID, partNums)
	if err != nil {
		return UploadSessionView{}, documentFileError(err)
	}

	return UploadSessionView{
		SessionID:  row.ID,
		FileID:     row.FileID,
		Status:     row.Status,
		PartSize:   row.PartSize,
		TotalParts: int(row.TotalParts),
		ExpiresAt:  row.ExpiresAt.Time.UTC(),
		Parts:      parts,
	}, nil
}

func (s *DocumentService) checkOpenSessionIdempotency(
	ctx context.Context,
	fs *FileService,
	orgID, wsID, actorID, rawKey, fingerprint string,
) (UploadSessionView, bool, error) {
	replay, err := PeekIdempotent(ctx, s.q, orgID, wsID, idempotencyScopeUploadSessionOpen, strings.TrimSpace(rawKey), actorID, IdempotencyOptions{
		Fingerprint:        fingerprint,
		RequireFingerprint: true,
	})
	if err != nil {
		return UploadSessionView{}, false, NormalizeIdempotencyError(err)
	}
	if replay != nil && len(replay.Body) > 0 {
		view, err := s.loadOpenSessionReplay(ctx, fs, string(replay.Body))
		if err != nil {
			return UploadSessionView{}, false, err
		}
		return view, true, nil
	}
	return UploadSessionView{}, false, nil
}

func (s *DocumentService) loadOpenSessionReplay(ctx context.Context, fs *FileService, sessionID string) (UploadSessionView, error) {
	row, err := s.q.GetFileMultipartUploadByID(ctx, strings.TrimSpace(sessionID))
	if errors.Is(err, pgx.ErrNoRows) {
		return UploadSessionView{}, ErrNotFound
	}
	if err != nil {
		return UploadSessionView{}, err
	}
	partNums := make([]int, int(row.TotalParts))
	for i := 0; i < int(row.TotalParts); i++ {
		partNums[i] = i + 1
	}
	parts, err := fs.signMultipartParts(ctx, row.ObjectKey, row.StorageUploadID, partNums)
	if err != nil {
		return UploadSessionView{}, documentFileError(err)
	}
	return UploadSessionView{
		SessionID:  row.ID,
		FileID:     row.FileID,
		Status:     row.Status,
		PartSize:   row.PartSize,
		TotalParts: int(row.TotalParts),
		ExpiresAt:  row.ExpiresAt.Time.UTC(),
		Parts:      parts,
	}, nil
}

// GetUploadSession returns the status, completed parts, and presigned URLs
// for missing parts of a workspace or version upload session.
func (s *DocumentService) GetUploadSession(ctx context.Context, actor Actor, sessionID string) (UploadSessionView, error) {
	row, err := s.authorizeNonFrameUploadSession(ctx, actor, sessionID)
	if err != nil {
		return UploadSessionView{}, err
	}
	return s.getUploadSessionView(ctx, row)
}

// GetFrameUploadSession returns the status, completed parts, and presigned
// URLs for missing parts of an Office frame upload session.
func (s *DocumentService) GetFrameUploadSession(ctx context.Context, claims OfficeFrameClaims, documentID, sessionID string) (UploadSessionView, error) {
	row, err := s.authorizeFrameUploadSession(ctx, claims, documentID, sessionID)
	if err != nil {
		return UploadSessionView{}, err
	}
	return s.getUploadSessionView(ctx, row)
}

func (s *DocumentService) getUploadSessionView(ctx context.Context, row db.FileMultipartUpload) (UploadSessionView, error) {
	fs, err := s.multipartFileService()
	if err != nil {
		return UploadSessionView{}, err
	}
	now := s.now()
	if row.Status == "expired" || row.Status == "aborted" || (row.Status == "open" && !now.Before(row.ExpiresAt.Time)) {
		return UploadSessionView{}, errUploadSessionExpired()
	}

	view := UploadSessionView{
		SessionID:  row.ID,
		FileID:     row.FileID,
		Status:     row.Status,
		PartSize:   row.PartSize,
		TotalParts: int(row.TotalParts),
		ExpiresAt:  row.ExpiresAt.Time.UTC(),
	}
	if row.Status != "open" {
		return view, nil
	}

	loc := storage.ObjectLocator{Storage: fs.backend, Bucket: fs.bucket, Key: row.ObjectKey}
	uploaded, err := fs.store.ListParts(ctx, loc, row.StorageUploadID)
	if err != nil {
		if errors.Is(err, storage.ErrMultipartNotFound) {
			return UploadSessionView{}, errUploadSessionExpired()
		}
		return UploadSessionView{}, documentFileError(files.StorageUnavailable(err))
	}

	doneParts := make(map[int]bool, len(uploaded))
	view.CompletedParts = make([]UploadSessionCompletedPart, 0, len(uploaded))
	for _, p := range uploaded {
		num := int(p.PartNumber)
		doneParts[num] = true
		view.CompletedParts = append(view.CompletedParts, UploadSessionCompletedPart{
			PartNumber: num,
			ETag:       p.ETag,
			SizeBytes:  p.SizeBytes,
		})
	}

	missingNums := make([]int, 0, int(row.TotalParts))
	for num := 1; num <= int(row.TotalParts); num++ {
		if !doneParts[num] {
			missingNums = append(missingNums, num)
		}
	}
	if len(missingNums) > 0 {
		signed, err := fs.signMultipartParts(ctx, row.ObjectKey, row.StorageUploadID, missingNums)
		if err != nil {
			return UploadSessionView{}, documentFileError(err)
		}
		view.Parts = signed
	}
	return view, nil
}

// CompleteUploadSession assembles, validates, and commits (or stages) a
// workspace or version upload session.
func (s *DocumentService) CompleteUploadSession(ctx context.Context, actor Actor, sessionID string, in CompleteUploadSessionInput) (UploadSessionCompleteResult, error) {
	row, err := s.authorizeNonFrameUploadSession(ctx, actor, sessionID)
	if err != nil {
		return UploadSessionCompleteResult{}, err
	}
	return s.completeUploadSession(ctx, actor, row, in)
}

// CompleteFrameUploadSession assembles, validates, and stages an Office frame
// upload session.
func (s *DocumentService) CompleteFrameUploadSession(ctx context.Context, claims OfficeFrameClaims, documentID, sessionID string, in CompleteUploadSessionInput) (UploadSessionCompleteResult, error) {
	row, err := s.authorizeFrameUploadSession(ctx, claims, documentID, sessionID)
	if err != nil {
		return UploadSessionCompleteResult{}, err
	}
	return s.completeUploadSession(ctx, Human(claims.UserID), row, in)
}

func (s *DocumentService) completeUploadSession(ctx context.Context, actor Actor, row db.FileMultipartUpload, in CompleteUploadSessionInput) (UploadSessionCompleteResult, error) {
	fs, err := s.multipartFileService()
	if err != nil {
		return UploadSessionCompleteResult{}, err
	}
	now := s.now().UTC().Truncate(time.Microsecond)

	// Step 3: terminal / idempotent state checks.
	if res, handled, err := s.handleTerminalCompleteState(ctx, actor, row, now); handled || err != nil {
		return res, err
	}

	// Step 4: acquire lease -> status = 'validating'.
	leaseOwner := "complete:" + util.NewID()
	leased, err := s.q.LeaseFileMultipartUploadForValidation(ctx, db.LeaseFileMultipartUploadForValidationParams{
		ID:             row.ID,
		LeaseOwner:     leaseOwner,
		LeaseExpiresAt: pgtype.Timestamptz{Time: now.Add(UploadSessionValidationLeaseTTL), Valid: true},
		Now:            pgtype.Timestamptz{Time: now, Valid: true},
	})
	if errors.Is(err, pgx.ErrNoRows) {
		fresh, rerr := s.q.GetFileMultipartUploadByID(ctx, row.ID)
		if rerr != nil {
			return UploadSessionCompleteResult{}, rerr
		}
		if res, handled, terr := s.handleTerminalCompleteState(ctx, actor, fresh, now); handled || terr != nil {
			return res, terr
		}
		return UploadSessionCompleteResult{}, CodedError{
			Code:   "upload_session_busy",
			Status: http.StatusConflict,
			Msg:    "phiên tải lên đang được xác thực; hãy thử lại sau",
			Fields: map[string]any{"retry_after": 5},
		}
	}
	if err != nil {
		return UploadSessionCompleteResult{}, err
	}

	releaseLease := func() {
		_, _ = s.q.ReleaseFileMultipartUploadLease(context.Background(), db.ReleaseFileMultipartUploadLeaseParams{
			ID:         leased.ID,
			LeaseOwner: leaseOwner,
			Now:        pgtype.Timestamptz{Time: s.now().UTC(), Valid: true},
		})
	}

	loc := storage.ObjectLocator{Storage: fs.backend, Bucket: fs.bucket, Key: leased.ObjectKey}

	// Step 5: ListParts and compare 1..total_parts + ETag against client input.
	uploadedParts, err := fs.store.ListParts(ctx, loc, leased.StorageUploadID)
	if err != nil {
		releaseLease()
		if errors.Is(err, storage.ErrMultipartNotFound) {
			return UploadSessionCompleteResult{}, errUploadPartsInvalid()
		}
		return UploadSessionCompleteResult{}, documentFileError(files.StorageUnavailable(err))
	}
	completeParts, valid := matchMultipartParts(int(leased.TotalParts), in.Parts, uploadedParts)
	if !valid {
		releaseLease()
		return UploadSessionCompleteResult{}, errUploadPartsInvalid()
	}

	// Step 6: CompleteMultipart + Stat size check.
	putRes, err := fs.store.CompleteMultipart(ctx, loc, leased.StorageUploadID, completeParts)
	if err != nil {
		releaseLease()
		if errors.Is(err, storage.ErrMultipartPartsInvalid) || errors.Is(err, storage.ErrMultipartNotFound) {
			return UploadSessionCompleteResult{}, errUploadPartsInvalid()
		}
		return UploadSessionCompleteResult{}, documentFileError(files.StorageUnavailable(err))
	}

	statInfo, err := fs.store.Stat(ctx, loc)
	if err != nil {
		releaseLease()
		return UploadSessionCompleteResult{}, documentFileError(files.StorageUnavailable(err))
	}
	if statInfo.SizeBytes != leased.SizeBytes {
		s.failMultipartSession(ctx, fs, leased, putRes.VersionID, "upload_size_mismatch")
		return UploadSessionCompleteResult{}, errUploadSizeMismatch()
	}

	// Step 7: Range re-read head and (if present) central_dir, compare sha256.
	headLen := min(leased.SizeBytes, int64(UploadSessionMaxProbeHeadBytes))
	headSHA, err := readObjectRangeSHA256(ctx, fs.store, loc, 0, headLen)
	if err != nil {
		releaseLease()
		return UploadSessionCompleteResult{}, documentFileError(files.StorageUnavailable(err))
	}
	if headSHA != leased.ProbeHeadSha256 {
		s.failMultipartSession(ctx, fs, leased, putRes.VersionID, "upload_probe_mismatch")
		return UploadSessionCompleteResult{}, errUploadProbeMismatch()
	}
	if leased.ProbeTailSha256.Valid && leased.ProbeTailSha256.String != "" && leased.CdOffset.Valid && leased.CdSize.Valid && leased.CdSize.Int64 > 0 {
		tailSHA, err := readObjectRangeSHA256(ctx, fs.store, loc, leased.CdOffset.Int64, leased.CdSize.Int64)
		if err != nil {
			releaseLease()
			return UploadSessionCompleteResult{}, documentFileError(files.StorageUnavailable(err))
		}
		if tailSHA != leased.ProbeTailSha256.String {
			s.failMultipartSession(ctx, fs, leased, putRes.VersionID, "upload_probe_mismatch")
			return UploadSessionCompleteResult{}, errUploadProbeMismatch()
		}
	}

	// Step 8: Single streamed read for full checksum_sha256 + document.ValidateFile.
	contentType, checksumSHA256, valErr := s.streamValidateAssembledObject(ctx, fs, loc, leased.Filename, leased.SizeBytes)
	if valErr != nil {
		var fe *document.FileError
		var ce CodedError
		switch {
		case errors.As(valErr, &fe):
			s.failMultipartSession(ctx, fs, leased, putRes.VersionID, document.ErrCodeUnsupportedMedia+":"+fe.Reason)
			return UploadSessionCompleteResult{}, documentValidationError(valErr)
		case errors.As(valErr, &ce) && ce.Status == http.StatusUnsupportedMediaType:
			reason, _ := ce.Fields["reason"].(string)
			s.failMultipartSession(ctx, fs, leased, putRes.VersionID, document.ErrCodeUnsupportedMedia+":"+reason)
			return UploadSessionCompleteResult{}, ce
		default:
			releaseLease()
			return UploadSessionCompleteResult{}, valErr
		}
	}

	// Step 9: Stage the FileService upload and finalize the session.
	stagedUp, err := fs.stageMultipartUpload(ctx, leased.FileID, leased.FileUploadSessionID, contentType, leased.SizeBytes, checksumSHA256, putRes.VersionID)
	if err != nil {
		releaseLease()
		return UploadSessionCompleteResult{}, documentFileError(err)
	}

	if leased.OpenedVia == "workspace" {
		return s.completeWorkspaceUploadSessionInTx(ctx, fs, actor, leased, leaseOwner, stagedUp)
	}
	return s.completeVersionOrFrameUploadSessionInTx(ctx, actor, leased, leaseOwner, stagedUp)
}

// CreateFileDocumentFromUploadInput is the variant of CreateFileDocumentInput
// that claims an already staged FileService upload (UploadID) instead of
// streaming a request body.
type CreateFileDocumentFromUploadInput struct {
	UploadID   string
	Filename   string
	Title      string
	ParentID   string
	Visibility string
}

// CreateFileDocumentFromUpload claims a staged upload (UploadID) and creates a
// file document and its first version in a single transaction.
func (s *DocumentService) CreateFileDocumentFromUpload(ctx context.Context, actor Actor, workspaceID string, in CreateFileDocumentFromUploadInput) (DocumentFileResult, error) {
	fs, err := s.fileService()
	if err != nil {
		return DocumentFileResult{}, err
	}
	if actor.Kind != audit.KindHuman || !validActor(actor) {
		return DocumentFileResult{}, ErrForbidden
	}
	if in.Visibility != "" {
		if err := validDocumentVisibility(in.Visibility); err != nil {
			return DocumentFileResult{}, err
		}
	}
	ws, err := s.ws.RequireMember(ctx, workspaceID, actor.ID)
	if err != nil {
		return DocumentFileResult{}, err
	}
	orgID, err := s.workspaceOrganization(ctx, ws.WorkspaceID)
	if err != nil {
		return DocumentFileResult{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return DocumentFileResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)

	docRes, _, err := s.createFileDocumentFromStagedUploadInTx(
		ctx, q, fs, actor, orgID, workspaceID,
		files.FileID(strings.TrimSpace(in.UploadID)),
		in.Filename, in.Title, strings.TrimSpace(in.ParentID), in.Visibility,
	)
	if err != nil {
		return DocumentFileResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return DocumentFileResult{}, err
	}
	return docRes, nil
}

func (s *DocumentService) createFileDocumentFromStagedUploadInTx(
	ctx context.Context,
	q *db.Queries,
	fs files.Service,
	actor Actor,
	orgID, workspaceID string,
	fileID files.FileID,
	fallbackFilename, rawTitle, parentID, rawVisibility string,
) (DocumentFileResult, files.File, error) {
	if _, err := s.ws.RequireMemberQ(ctx, q, workspaceID, actor.ID); err != nil {
		return DocumentFileResult{}, files.File{}, err
	}
	scope := documentScope(orgID, workspaceID)
	claimed, err := fs.ClaimInTx(ctx, q, files.ClaimInput{
		Actor:   actor,
		Purpose: files.DocumentFile,
		Scope:   scope,
		FileIDs: []files.FileID{fileID},
	})
	if err != nil {
		return DocumentFileResult{}, files.File{}, documentFileError(err)
	}
	file := claimed[0]

	if err := q.LockDocumentTree(ctx, workspaceID); err != nil {
		return DocumentFileResult{}, files.File{}, err
	}
	var parent *db.Document
	if parentID != "" {
		p, err := s.lockPageParent(ctx, q, actor, parentID, orgID, workspaceID, DocumentKindFile)
		if err != nil {
			return DocumentFileResult{}, files.File{}, err
		}
		parent = &p
	}
	visibility, workspaceLevel := createHomeRow(rawVisibility, parent)
	if err := s.consumeStorage(ctx, q, actor, orgID, workspaceID, file); err != nil {
		return DocumentFileResult{}, files.File{}, err
	}

	now := s.now().UTC().Truncate(time.Microsecond)
	docID, versionID := util.NewID(), util.NewID()
	title := strings.TrimSpace(rawTitle)
	if title == "" {
		title = files.SanitizeFilename(fallbackFilename)
	}
	if title == "" {
		title = files.SanitizeFilename(file.Filename)
	}
	normTitle, err := normalizeDocumentTitle(DocumentKindFile, title)
	if err != nil {
		return DocumentFileResult{}, files.File{}, err
	}
	doc, err := q.InsertDocument(ctx, db.InsertDocumentParams{
		ID:             docID,
		OrganizationID: orgID,
		WorkspaceID:    workspaceID,
		ParentID:       nullText(parentID),
		Kind:           DocumentKindFile,
		Title:          normTitle,
		Visibility:     visibility,
		WorkspaceLevel: workspaceLevel,
		SearchText:     documentSearchText(normTitle, ""),
		CurrentVersion: 1,
		FileVersionID:  pgtype.Text{String: versionID, Valid: true},
		Revision:       1,
		AclOwnerID:     aclOwnerFor(actor),
		CreatedBy:      actor.ID,
		CreatedByKind:  string(actor.Kind),
		UpdatedBy:      actor.ID,
		UpdatedByKind:  string(actor.Kind),
		LastVersionAt:  pgtype.Timestamptz{Time: now, Valid: true},
	})
	if err != nil {
		return DocumentFileResult{}, files.File{}, err
	}
	version, err := q.InsertDocumentVersion(ctx, fileVersionParams(doc, versionID, 1, "upload", actor, file, DocumentEngineInfo{}, pgtype.Int4{}))
	if err != nil {
		return DocumentFileResult{}, files.File{}, err
	}
	created := map[string]any{
		"title": doc.Title, "kind": doc.Kind, "visibility": doc.Visibility, "version_id": version.ID, "file_id": string(file.ID),
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID,
		WorkspaceID:    workspaceID,
		Actor:          actor,
		Action:         audit.ActionDocumentCreated,
		ResourceType:   "document",
		ResourceID:     doc.ID,
		Changes:        audit.Diff(nil, created),
	}, audit.Event{Topic: "document.created", Payload: map[string]string{
		"document_id": doc.ID, "workspace_id": workspaceID,
	}}); err != nil {
		return DocumentFileResult{}, files.File{}, err
	}
	access, err := s.effectiveLevel(ctx, q, actor, doc)
	if err != nil {
		return DocumentFileResult{}, files.File{}, err
	}
	return DocumentFileResult{
		Document: doc,
		Version:  version,
		File:     fileInfoOf(version, file.Filename),
		Access:   access,
	}, file, nil
}

func (s *DocumentService) completeWorkspaceUploadSessionInTx(
	ctx context.Context,
	fs *FileService,
	actor Actor,
	sess db.FileMultipartUpload,
	leaseOwner string,
	stagedUp files.Upload,
) (UploadSessionCompleteResult, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return UploadSessionCompleteResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)

	docRes, file, err := s.createFileDocumentFromStagedUploadInTx(
		ctx, q, fs, actor, sess.OrganizationID, sess.WorkspaceID,
		stagedUp.File.ID, sess.Filename, sess.Title.String, sess.ParentID.String, sess.Visibility.String,
	)
	if err != nil {
		return UploadSessionCompleteResult{}, err
	}

	now := s.now().UTC().Truncate(time.Microsecond)
	if _, err := q.CompleteFileMultipartUpload(ctx, db.CompleteFileMultipartUploadParams{
		ID:                    sess.ID,
		LeaseOwner:            leaseOwner,
		ResultDocumentID:      pgtype.Text{String: docRes.Document.ID, Valid: true},
		ResultVersionUploadID: pgtype.Text{},
		ClosedAt:              pgtype.Timestamptz{Time: now, Valid: true},
	}); err != nil {
		return UploadSessionCompleteResult{}, err
	}

	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: sess.OrganizationID,
		WorkspaceID:    sess.WorkspaceID,
		Actor:          actor,
		Action:         audit.ActionDocumentUploadSessionCompleted,
		ResourceType:   "upload_session",
		ResourceID:     sess.ID,
		Changes: audit.Diff(nil, map[string]any{
			"session_id":      sess.ID,
			"file_id":         string(file.ID),
			"size_bytes":      file.SizeBytes,
			"checksum_sha256": file.ChecksumSHA256,
		}),
		Metadata: map[string]any{
			"session_id":      sess.ID,
			"file_id":         string(file.ID),
			"size_bytes":      file.SizeBytes,
			"checksum_sha256": file.ChecksumSHA256,
		},
	}); err != nil {
		return UploadSessionCompleteResult{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return UploadSessionCompleteResult{}, err
	}
	return UploadSessionCompleteResult{
		OpenedVia: "workspace",
		Document:  &docRes,
	}, nil
}

func (s *DocumentService) completeVersionOrFrameUploadSessionInTx(
	ctx context.Context,
	actor Actor,
	sess db.FileMultipartUpload,
	leaseOwner string,
	stagedUp files.Upload,
) (UploadSessionCompleteResult, error) {
	now := s.now().UTC().Truncate(time.Microsecond)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return UploadSessionCompleteResult{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)

	if _, err := q.CompleteFileMultipartUpload(ctx, db.CompleteFileMultipartUploadParams{
		ID:                    sess.ID,
		LeaseOwner:            leaseOwner,
		ResultDocumentID:      pgtype.Text{},
		ResultVersionUploadID: pgtype.Text{String: string(stagedUp.File.ID), Valid: true},
		ClosedAt:              pgtype.Timestamptz{Time: now, Valid: true},
	}); err != nil {
		return UploadSessionCompleteResult{}, err
	}

	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: sess.OrganizationID,
		WorkspaceID:    sess.WorkspaceID,
		Actor:          actor,
		Action:         audit.ActionDocumentUploadSessionCompleted,
		ResourceType:   "upload_session",
		ResourceID:     sess.ID,
		Changes: audit.Diff(nil, map[string]any{
			"session_id":      sess.ID,
			"file_id":         string(stagedUp.File.ID),
			"size_bytes":      stagedUp.File.SizeBytes,
			"checksum_sha256": stagedUp.File.ChecksumSHA256,
		}),
		Metadata: map[string]any{
			"session_id":      sess.ID,
			"file_id":         string(stagedUp.File.ID),
			"size_bytes":      stagedUp.File.SizeBytes,
			"checksum_sha256": stagedUp.File.ChecksumSHA256,
		},
	}); err != nil {
		return UploadSessionCompleteResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return UploadSessionCompleteResult{}, err
	}

	up := DocumentUpload{
		UploadID:       string(stagedUp.File.ID),
		Filename:       stagedUp.File.Filename,
		MimeType:       stagedUp.File.ContentType,
		SizeBytes:      stagedUp.File.SizeBytes,
		ChecksumSHA256: stagedUp.File.ChecksumSHA256,
		ClaimExpiresAt: stagedUp.ClaimExpiresAt,
	}
	return UploadSessionCompleteResult{
		OpenedVia: sess.OpenedVia,
		Upload:    &up,
	}, nil
}

func (s *DocumentService) handleTerminalCompleteState(
	ctx context.Context,
	actor Actor,
	row db.FileMultipartUpload,
	now time.Time,
) (UploadSessionCompleteResult, bool, error) {
	switch row.Status {
	case "completed":
		res, err := s.loadCompletedUploadSessionResult(ctx, actor, row)
		return res, true, err
	case "failed":
		return UploadSessionCompleteResult{}, true, mapStoredUploadSessionFailure(row.FailureCode.String)
	case "expired", "aborted":
		return UploadSessionCompleteResult{}, true, errUploadSessionExpired()
	case "open":
		if !now.Before(row.ExpiresAt.Time) {
			return UploadSessionCompleteResult{}, true, errUploadSessionExpired()
		}
	}
	return UploadSessionCompleteResult{}, false, nil
}

func (s *DocumentService) loadCompletedUploadSessionResult(
	ctx context.Context,
	actor Actor,
	row db.FileMultipartUpload,
) (UploadSessionCompleteResult, error) {
	if row.OpenedVia == "workspace" {
		docID := row.ResultDocumentID.String
		doc, err := s.q.GetDocument(ctx, db.GetDocumentParams{
			ID:             docID,
			OrganizationID: row.OrganizationID,
			WorkspaceID:    row.WorkspaceID,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return UploadSessionCompleteResult{}, ErrNotFound
		}
		if err != nil {
			return UploadSessionCompleteResult{}, err
		}
		ver, err := s.q.GetDocumentVersionByID(ctx, db.GetDocumentVersionByIDParams{
			ID:             doc.FileVersionID.String,
			DocumentID:     doc.ID,
			OrganizationID: doc.OrganizationID,
			WorkspaceID:    doc.WorkspaceID,
		})
		if err != nil {
			return UploadSessionCompleteResult{}, err
		}
		access, err := s.effectiveLevel(ctx, s.q, actor, doc)
		if err != nil {
			return UploadSessionCompleteResult{}, err
		}
		docRes := DocumentFileResult{
			Document: doc,
			Version:  ver,
			File:     fileInfoOf(ver, row.Filename),
			Access:   access,
		}
		return UploadSessionCompleteResult{
			OpenedVia: "workspace",
			Document:  &docRes,
		}, nil
	}

	fileRow, err := s.q.GetFileByID(ctx, row.FileID)
	if err != nil {
		return UploadSessionCompleteResult{}, err
	}
	sessRow, err := s.q.GetUploadSessionByID(ctx, row.FileUploadSessionID)
	if err != nil {
		return UploadSessionCompleteResult{}, err
	}
	up := DocumentUpload{
		UploadID:       fileRow.ID,
		Filename:       fileRow.OriginalFilename,
		MimeType:       fileRow.ContentType.String,
		SizeBytes:      fileRow.SizeBytes.Int64,
		ChecksumSHA256: fileRow.ChecksumSha256.String,
		ClaimExpiresAt: sessRow.ClaimExpiresAt.Time.UTC(),
	}
	return UploadSessionCompleteResult{
		OpenedVia: row.OpenedVia,
		Upload:    &up,
	}, nil
}

func (s *DocumentService) failMultipartSession(
	ctx context.Context,
	fs *FileService,
	row db.FileMultipartUpload,
	objectVersion string,
	failureCode string,
) {
	ctx = context.WithoutCancel(ctx)
	loc := storage.ObjectLocator{
		Storage: fs.backend,
		Bucket:  fs.bucket,
		Key:     row.ObjectKey,
		Version: objectVersion,
	}
	_ = fs.store.Delete(ctx, loc)
	fs.cancelMultipartFileSession(ctx, row.FileID, row.FileUploadSessionID, true)
	now := s.now().UTC().Truncate(time.Microsecond)
	_, _ = s.q.FailFileMultipartUpload(ctx, db.FailFileMultipartUploadParams{
		ID:          row.ID,
		FailureCode: failureCode,
		ClosedAt:    pgtype.Timestamptz{Time: now, Valid: true},
	})
}

func (s *DocumentService) streamValidateAssembledObject(
	ctx context.Context,
	fs *FileService,
	loc storage.ObjectLocator,
	filename string,
	expectedSize int64,
) (string, string, error) {
	obj, err := fs.store.Open(ctx, loc, storage.ReadOptions{})
	if err != nil {
		return "", "", documentFileError(files.StorageUnavailable(err))
	}
	defer func() { _ = obj.Body.Close() }()

	spool, err := os.CreateTemp(s.store.spoolDir, "uniwork-mp-validate-*")
	if err != nil {
		return "", "", documentFileError(files.StorageUnavailable(err))
	}
	_ = os.Remove(spool.Name())
	defer func() { _ = spool.Close() }()

	hasher := sha256.New()
	headBuf := &headBuffer{limit: files.DetectHeadBytes}
	n, err := io.Copy(io.MultiWriter(spool, hasher, headBuf), io.LimitReader(obj.Body, expectedSize+1))
	if err != nil {
		return "", "", documentFileError(files.StorageUnavailable(err))
	}
	if n != expectedSize {
		return "", "", errUploadSizeMismatch()
	}

	spec, err := fs.registry.Lookup(files.DocumentFile)
	if err != nil {
		return "", "", err
	}
	detected := spec.Policy.Canonical(files.DetectBodyContentType(headBuf.buf.Bytes(), filename, spool, n))
	if !spec.Policy.Allows(detected) {
		return "", "", CodedError{
			Code:   document.ErrCodeUnsupportedMedia,
			Status: http.StatusUnsupportedMediaType,
			Msg:    "định dạng tệp không được hỗ trợ",
			Fields: map[string]any{"reason": files.CodeTypeRejected},
		}
	}
	if _, err := document.ValidateFile(spool, n, detected, s.fileLimits()); err != nil {
		return "", "", err
	}
	return detected, hex.EncodeToString(hasher.Sum(nil)), nil
}

// AbortUploadSession aborts an open workspace or version upload session,
// discarding parts in S3 and releasing reserved quota.
func (s *DocumentService) AbortUploadSession(ctx context.Context, actor Actor, sessionID string) error {
	row, err := s.authorizeNonFrameUploadSession(ctx, actor, sessionID)
	if err != nil {
		return err
	}
	return s.abortUploadSession(ctx, actor, row)
}

// AbortFrameUploadSession aborts an open Office frame upload session.
func (s *DocumentService) AbortFrameUploadSession(ctx context.Context, claims OfficeFrameClaims, documentID, sessionID string) error {
	row, err := s.authorizeFrameUploadSession(ctx, claims, documentID, sessionID)
	if err != nil {
		return err
	}
	return s.abortUploadSession(ctx, Human(claims.UserID), row)
}

func (s *DocumentService) abortUploadSession(ctx context.Context, actor Actor, row db.FileMultipartUpload) error {
	fs, err := s.multipartFileService()
	if err != nil {
		return err
	}
	switch row.Status {
	case "completed":
		return CodedError{
			Code:   "upload_session_completed",
			Status: http.StatusConflict,
			Msg:    "phiên tải lên đã hoàn tất, không thể hủy",
		}
	case "aborted", "expired", "failed":
		return nil
	case "validating":
		now := s.now()
		if row.LeaseExpiresAt.Valid && now.Before(row.LeaseExpiresAt.Time) {
			return CodedError{
				Code:   "upload_session_busy",
				Status: http.StatusConflict,
				Msg:    "phiên tải lên đang được xác thực; hãy thử lại sau",
				Fields: map[string]any{"retry_after": 5},
			}
		}
	}

	loc := storage.ObjectLocator{Storage: fs.backend, Bucket: fs.bucket, Key: row.ObjectKey}
	if err := fs.store.AbortMultipart(ctx, loc, row.StorageUploadID); err != nil && !errors.Is(err, storage.ErrMultipartNotFound) {
		return documentFileError(files.StorageUnavailable(err))
	}
	fs.cancelMultipartFileSession(ctx, row.FileID, row.FileUploadSessionID, true)

	now := s.now().UTC().Truncate(time.Microsecond)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)

	n, err := q.AbortFileMultipartUpload(ctx, db.AbortFileMultipartUploadParams{
		ID:       row.ID,
		ClosedAt: pgtype.Timestamptz{Time: now, Valid: true},
	})
	if err != nil {
		return err
	}
	if n > 0 {
		if err := auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: row.OrganizationID,
			WorkspaceID:    row.WorkspaceID,
			Actor:          actor,
			Action:         audit.ActionDocumentUploadSessionAborted,
			ResourceType:   "upload_session",
			ResourceID:     row.ID,
			Changes: audit.Diff(nil, map[string]any{
				"session_id": row.ID,
				"file_id":    row.FileID,
			}),
			Metadata: map[string]any{
				"session_id": row.ID,
				"file_id":    row.FileID,
			},
		}); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// ExpireMultipartUploads sweeps expired multipart upload sessions, aborts
// their S3 multipart uploads, cancels their FileService sessions (releasing
// quota), marks them expired, and records document.upload_session_expired.
func (s *DocumentService) ExpireMultipartUploads(ctx context.Context, now time.Time) (int, error) {
	if s == nil || s.q == nil || s.pool == nil {
		return 0, nil
	}
	fs, _ := s.files.(*FileService)
	now = now.UTC().Truncate(time.Microsecond)
	rows, err := s.q.ListExpiredFileMultipartUploads(ctx, db.ListExpiredFileMultipartUploadsParams{
		Now:    pgtype.Timestamptz{Time: now, Valid: true},
		LimitN: 100,
	})
	if err != nil {
		return 0, err
	}

	sys := audit.System("documents.upload_session_gc")
	expiredCount := 0
	for _, row := range rows {
		if ctx.Err() != nil {
			return expiredCount, ctx.Err()
		}
		if fs != nil && fs.store != nil {
			loc := storage.ObjectLocator{Storage: fs.backend, Bucket: fs.bucket, Key: row.ObjectKey}
			_ = fs.store.AbortMultipart(ctx, loc, row.StorageUploadID)
			fs.cancelMultipartFileSession(ctx, row.FileID, row.FileUploadSessionID, true)
		}

		tx, err := s.pool.Begin(ctx)
		if err != nil {
			return expiredCount, err
		}
		q := s.q.WithTx(tx)
		n, err := q.MarkFileMultipartUploadExpired(ctx, db.MarkFileMultipartUploadExpiredParams{
			ID:       row.ID,
			ClosedAt: pgtype.Timestamptz{Time: now, Valid: true},
		})
		if err != nil {
			_ = tx.Rollback(ctx)
			return expiredCount, err
		}
		if n > 0 {
			if err := auditRecorder.Record(ctx, q, audit.Entry{
				OrganizationID: row.OrganizationID,
				WorkspaceID:    row.WorkspaceID,
				Actor:          sys,
				Action:         audit.ActionDocumentUploadSessionExpired,
				ResourceType:   "upload_session",
				ResourceID:     row.ID,
				Changes: audit.Diff(nil, map[string]any{
					"session_id": row.ID,
					"file_id":    row.FileID,
				}),
				Metadata: map[string]any{
					"session_id": row.ID,
					"file_id":    row.FileID,
				},
			}); err != nil {
				_ = tx.Rollback(ctx)
				return expiredCount, err
			}
			expiredCount++
		}
		if err := tx.Commit(ctx); err != nil {
			return expiredCount, err
		}
	}
	return expiredCount, nil
}

func (s *DocumentService) authorizeNonFrameUploadSession(ctx context.Context, actor Actor, sessionID string) (db.FileMultipartUpload, error) {
	if actor.Kind != audit.KindHuman || !validActor(actor) {
		return db.FileMultipartUpload{}, ErrNotFound
	}
	row, err := s.q.GetFileMultipartUploadByID(ctx, strings.TrimSpace(sessionID))
	if errors.Is(err, pgx.ErrNoRows) {
		return db.FileMultipartUpload{}, ErrNotFound
	}
	if err != nil {
		return db.FileMultipartUpload{}, err
	}
	if row.OpenedVia == "frame" || row.CreatedBy != actor.ID || row.CreatedByKind != string(actor.Kind) {
		return db.FileMultipartUpload{}, ErrNotFound
	}
	switch row.OpenedVia {
	case "workspace":
		if _, err := s.ws.RequireMember(ctx, row.WorkspaceID, actor.ID); err != nil {
			return db.FileMultipartUpload{}, err
		}
	case "version":
		doc, access, err := s.preflightDocument(ctx, actor, row.DocumentID.String)
		if err != nil {
			return db.FileMultipartUpload{}, err
		}
		if err := decideFileSave(doc, access); err != nil {
			return db.FileMultipartUpload{}, err
		}
	default:
		return db.FileMultipartUpload{}, ErrNotFound
	}
	return row, nil
}

func (s *DocumentService) authorizeFrameUploadSession(ctx context.Context, claims OfficeFrameClaims, documentID, sessionID string) (db.FileMultipartUpload, error) {
	if claims.UserID == "" || claims.DocumentID == "" || claims.DocumentID != documentID {
		return db.FileMultipartUpload{}, ErrNotFound
	}
	row, err := s.q.GetFileMultipartUploadByID(ctx, strings.TrimSpace(sessionID))
	if errors.Is(err, pgx.ErrNoRows) {
		return db.FileMultipartUpload{}, ErrNotFound
	}
	if err != nil {
		return db.FileMultipartUpload{}, err
	}
	if row.OpenedVia != "frame" ||
		row.CreatedBy != claims.UserID ||
		row.CreatedByKind != string(audit.KindHuman) ||
		!row.TokenDocumentID.Valid ||
		row.TokenDocumentID.String != claims.DocumentID ||
		!row.DocumentID.Valid ||
		row.DocumentID.String != documentID {
		return db.FileMultipartUpload{}, ErrNotFound
	}
	actor := Human(claims.UserID)
	doc, access, err := s.preflightDocument(ctx, actor, documentID)
	if err != nil {
		return db.FileMultipartUpload{}, err
	}
	if doc.WorkspaceID != claims.WorkspaceID || doc.OrganizationID != claims.OrganizationID {
		return db.FileMultipartUpload{}, ErrNotFound
	}
	if err := decideFileSave(doc, access); err != nil {
		return db.FileMultipartUpload{}, err
	}
	return row, nil
}

func matchMultipartParts(totalParts int, clientParts []CompleteUploadPartInput, storageParts []storage.MultipartPart) ([]storage.MultipartPart, bool) {
	if len(clientParts) != totalParts || len(storageParts) != totalParts {
		return nil, false
	}
	storageByNum := make(map[int]storage.MultipartPart, len(storageParts))
	for _, sp := range storageParts {
		storageByNum[int(sp.PartNumber)] = sp
	}
	clientByNum := make(map[int]string, len(clientParts))
	for _, cp := range clientParts {
		if cp.PartNumber < 1 || cp.PartNumber > totalParts {
			return nil, false
		}
		if _, dup := clientByNum[cp.PartNumber]; dup {
			return nil, false
		}
		etag := strings.TrimSpace(cp.ETag)
		if etag == "" {
			return nil, false
		}
		clientByNum[cp.PartNumber] = etag
	}
	out := make([]storage.MultipartPart, 0, totalParts)
	for num := 1; num <= totalParts; num++ {
		cETag, cok := clientByNum[num]
		sp, sok := storageByNum[num]
		if !cok || !sok {
			return nil, false
		}
		if normalizeETag(cETag) == "" || normalizeETag(cETag) != normalizeETag(sp.ETag) {
			return nil, false
		}
		out = append(out, sp)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].PartNumber < out[j].PartNumber })
	return out, true
}

func normalizeETag(etag string) string {
	return strings.Trim(strings.TrimSpace(etag), `"`)
}

func readObjectRangeSHA256(ctx context.Context, store storage.ObjectStore, loc storage.ObjectLocator, offset, length int64) (string, error) {
	obj, err := store.Open(ctx, loc, storage.ReadOptions{Offset: offset, Length: length})
	if err != nil {
		return "", err
	}
	defer func() { _ = obj.Body.Close() }()
	h := sha256.New()
	if _, err := io.Copy(h, io.LimitReader(obj.Body, length)); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func decodeBase64Probe(raw string) ([]byte, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return nil, errors.New("empty base64 probe")
	}
	if b, err := base64.StdEncoding.DecodeString(s); err == nil {
		return b, nil
	}
	return base64.RawStdEncoding.DecodeString(s)
}

func sha256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func uploadSessionOpenFingerprint(
	openedVia, targetID, filename string,
	sizeBytes int64,
	parentID, title, visibility string,
	probeHeadSHA, probeTailSHA string,
	cdOffset, cdSize int64,
) string {
	return IdempotencyFingerprint(
		idempotencyScopeUploadSessionOpen,
		openedVia,
		targetID,
		filename,
		strconv.FormatInt(sizeBytes, 10),
		parentID,
		title,
		visibility,
		probeHeadSHA,
		probeTailSHA,
		strconv.FormatInt(cdOffset, 10),
		strconv.FormatInt(cdSize, 10),
	)
}

func errUploadSessionsExhausted() error {
	return CodedError{
		Code:   "upload_sessions_exhausted",
		Status: http.StatusTooManyRequests,
		Msg:    "bạn đang có tối đa 4 phiên tải lên đang mở; hãy hoàn tất hoặc hủy bớt",
		Fields: map[string]any{"retry_after": 60},
	}
}

func errUploadSessionExpired() error {
	return CodedError{
		Code:   "upload_session_expired",
		Status: http.StatusGone,
		Msg:    "phiên tải lên đã hết hạn hoặc đã bị hủy",
	}
}

func errUploadPartsInvalid() error {
	return CodedError{
		Code:   "upload_parts_invalid",
		Status: http.StatusUnprocessableEntity,
		Msg:    "danh sách phần tải lên chưa đủ hoặc ETag không khớp",
	}
}

func errUploadSizeMismatch() error {
	return CodedError{
		Code:   "upload_size_mismatch",
		Status: http.StatusUnprocessableEntity,
		Msg:    "dung lượng tệp sau khi ghép không khớp với khai báo",
	}
}

func errUploadProbeMismatch() error {
	return CodedError{
		Code:   "upload_probe_mismatch",
		Status: http.StatusUnprocessableEntity,
		Msg:    "nội dung đầu/cuối tệp không khớp với dữ liệu kiểm tra ban đầu",
	}
}

func mapStoredUploadSessionFailure(code string) error {
	switch {
	case code == "upload_size_mismatch":
		return errUploadSizeMismatch()
	case code == "upload_probe_mismatch":
		return errUploadProbeMismatch()
	case strings.HasPrefix(code, document.ErrCodeUnsupportedMedia+":"):
		reason := strings.TrimPrefix(code, document.ErrCodeUnsupportedMedia+":")
		return CodedError{
			Code:   document.ErrCodeUnsupportedMedia,
			Status: http.StatusUnsupportedMediaType,
			Msg:    "tệp không mở được bằng trình soạn thảo cho định dạng này",
			Fields: map[string]any{"reason": reason},
		}
	default:
		return CodedError{
			Code:   document.ErrCodeUnsupportedMedia,
			Status: http.StatusUnsupportedMediaType,
			Msg:    "tệp không hợp lệ",
		}
	}
}
