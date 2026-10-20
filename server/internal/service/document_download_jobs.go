package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Multi-document zip download (UNI-2045 SV-9). The request validates the ids,
// refuses a selection past 1 GiB, and writes the job row with its audit and
// outbox rows in one transaction; DocumentDownloadConsumer builds the zip on
// the slow lane. Files only: pages and folders are reported as skipped, never
// exported (Advisor decision Q1 = A).

// DocumentDownloadTopic is the outbox topic the slow-lane consumer reads.
const DocumentDownloadTopic = "document.download_job_requested"

const (
	documentDownloadMaxIDs = 100
	// documentDownloadMaxBytes caps the current-version bytes of the files one
	// job zips; a var-free constant, the 422 reports it as max_bytes.
	documentDownloadMaxBytes int64 = 1 << 30
	// documentDownloadWindow is how long a ready zip stays downloadable. After
	// it the sweep releases the object (releaseExpiredDocumentDownloads).
	documentDownloadWindow = time.Hour
)

// Skip reasons. A document the caller cannot read, from another workspace or
// organization, or that does not exist answers one reason with no title.
const (
	downloadSkipNotFound  = "not_found"
	downloadSkipNotAFile  = "not_a_file"
	downloadSkipTooLarge  = "too_large"
	downloadErrNothing    = "nothing_to_download"
	downloadErrBuildFails = "build_failed"
)

var downloadIDPattern = regexp.MustCompile(`^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$`)

// DocumentDownloadSkip is one requested document the zip does not carry.
type DocumentDownloadSkip struct {
	DocumentID string `json:"document_id"`
	Reason     string `json:"reason"`
}

// DocumentDownloadJob is the creator's view of one job. Status is queued,
// running, ready, failed, or expired (derived from ExpiresAt, never stored).
type DocumentDownloadJob struct {
	ID            string
	Status        string
	CreatedAt     time.Time
	ExpiresAt     *time.Time
	FileCount     *int
	Skipped       []DocumentDownloadSkip
	Error         string
	DownloadReady bool
}

// DocumentDownloadZip is the stream the download route copies to the client.
type DocumentDownloadZip struct {
	Reader      files.Reader
	Filename    string
	ContentType string
}

func errDownloadTooLarge() error {
	return CodedError{
		Status: http.StatusUnprocessableEntity, Code: "download_too_large",
		Msg:    "các tệp đã chọn vượt 1 GiB: hãy chọn ít tệp hơn",
		Fields: map[string]any{"max_bytes": documentDownloadMaxBytes},
	}
}

func errDownloadExpired() error {
	return coded(http.StatusGone, "document_download_expired", "bản tải đã hết hạn: hãy tạo lại")
}

func validateDownloadIDs(ids []string) error {
	if len(ids) == 0 {
		return Invalid("document_ids phải có ít nhất một id")
	}
	if len(ids) > documentDownloadMaxIDs {
		return Invalid("document_ids tối đa 100 id")
	}
	seen := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		if !downloadIDPattern.MatchString(id) {
			return Invalid("document_ids chứa id không hợp lệ")
		}
		if _, dup := seen[id]; dup {
			return Invalid("document_ids chứa id trùng")
		}
		seen[id] = struct{}{}
	}
	return nil
}

// downloadTarget is one requested document that passed the download gate.
type downloadTarget struct {
	doc db.Document
	ver db.DocumentVersion
}

// classifyDownload applies the single-file download gate (authorizeDocument at
// view level, the same call OpenDocumentFile makes) without opening a byte and
// without its access-log side effect. reason is "" when the file may go in the
// zip; a gate refusal, a foreign workspace and a missing row all answer
// not_found so a skip never tells a title or an existence.
func (s *DocumentService) classifyDownload(ctx context.Context, q *db.Queries, actor Actor, workspaceID, documentID string) (downloadTarget, string, error) {
	doc, _, err := s.authorizeDocumentQ(ctx, q, actor, documentID, DocumentLevelView)
	switch {
	case err == nil:
	case isGateRefusal(err):
		return downloadTarget{}, downloadSkipNotFound, nil
	default:
		return downloadTarget{}, "", err
	}
	if doc.WorkspaceID != workspaceID {
		return downloadTarget{}, downloadSkipNotFound, nil
	}
	if doc.Kind != DocumentKindFile || !doc.FileVersionID.Valid {
		return downloadTarget{}, downloadSkipNotAFile, nil
	}
	v, err := q.GetDocumentVersionByID(ctx, db.GetDocumentVersionByIDParams{
		ID: doc.FileVersionID.String, OrganizationID: doc.OrganizationID,
		WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
	})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (v.Kind != DocumentKindFile || !v.FileID.Valid)) {
		return downloadTarget{}, downloadSkipNotFound, nil
	}
	if err != nil {
		return downloadTarget{}, "", err
	}
	return downloadTarget{doc: doc, ver: v}, "", nil
}

// CreateDocumentDownloadJob queues one zip of the named files. The caller's
// own gates decide what is downloadable: unreadable, foreign and missing ids
// are not refused here (that would be an existence oracle), they only stop
// counting toward the 1 GiB cap and are skipped by the build.
func (s *DocumentService) CreateDocumentDownloadJob(ctx context.Context, actor Actor, workspaceID string, ids []string) (DocumentDownloadJob, error) {
	if err := validateDownloadIDs(ids); err != nil {
		return DocumentDownloadJob{}, err
	}
	scope, err := s.documentListScope(ctx, actor, workspaceID)
	if err != nil {
		return DocumentDownloadJob{}, err
	}
	var total int64
	// accepted are the ids the caller may download now: the audit row names
	// only those, so a foreign id a caller typed never lands in an audit row.
	accepted := make([]string, 0, len(ids))
	for _, id := range ids {
		t, reason, err := s.classifyDownload(ctx, s.q, actor, workspaceID, id)
		if err != nil {
			return DocumentDownloadJob{}, err
		}
		if reason != "" {
			continue
		}
		accepted = append(accepted, id)
		total += t.ver.SizeBytes
		if total > documentDownloadMaxBytes {
			return DocumentDownloadJob{}, errDownloadTooLarge()
		}
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return DocumentDownloadJob{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	row, err := q.InsertDocumentDownloadJob(ctx, db.InsertDocumentDownloadJobParams{
		ID: util.NewID(), OrganizationID: scope.organizationID, WorkspaceID: workspaceID,
		CreatedBy: actor.ID, CreatedByKind: string(actor.Kind), DocumentIds: ids,
	})
	if err != nil {
		return DocumentDownloadJob{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: scope.organizationID, WorkspaceID: workspaceID,
		Actor: actor, Action: audit.ActionDocumentsDownloadJobCreated,
		ResourceType: "document_download_job", ResourceID: row.ID,
		Metadata: map[string]any{"workspace_id": workspaceID, "document_ids": accepted, "requested_count": len(ids)},
	}, audit.Event{
		Topic: DocumentDownloadTopic,
		Payload: map[string]string{
			"job_id": row.ID, "organization_id": scope.organizationID, "workspace_id": workspaceID,
		},
	}); err != nil {
		return DocumentDownloadJob{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return DocumentDownloadJob{}, err
	}
	return s.downloadJobView(row), nil
}

// downloadJobRow reads one job for its creator. Everyone else - another
// workspace member, an administrator, a person of another organization - and
// a creator who lost the gates since get ErrNotFound.
func (s *DocumentService) downloadJobRow(ctx context.Context, actor Actor, workspaceID, jobID string) (db.DocumentDownloadJob, error) {
	if !validActor(actor) || workspaceID == "" || jobID == "" {
		return db.DocumentDownloadJob{}, ErrNotFound
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.DocumentDownloadJob{}, ErrNotFound
	}
	if err != nil {
		return db.DocumentDownloadJob{}, err
	}
	row, err := s.q.GetDocumentDownloadJob(ctx, db.GetDocumentDownloadJobParams{
		ID: jobID, OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.DocumentDownloadJob{}, ErrNotFound
	}
	if err != nil {
		return db.DocumentDownloadJob{}, err
	}
	if row.CreatedBy != actor.ID || row.CreatedByKind != string(actor.Kind) {
		return db.DocumentDownloadJob{}, ErrNotFound
	}
	if _, err := s.documentListScopeForWorkspace(ctx, s.q, actor, workspaceID, ws); err != nil {
		if isGateRefusal(err) {
			return db.DocumentDownloadJob{}, ErrNotFound
		}
		return db.DocumentDownloadJob{}, err
	}
	return row, nil
}

// GetDocumentDownloadJob is the poll the web makes until the job settles.
func (s *DocumentService) GetDocumentDownloadJob(ctx context.Context, actor Actor, workspaceID, jobID string) (DocumentDownloadJob, error) {
	row, err := s.downloadJobRow(ctx, actor, workspaceID, jobID)
	if err != nil {
		return DocumentDownloadJob{}, err
	}
	return s.downloadJobView(row), nil
}

func (s *DocumentService) downloadJobView(row db.DocumentDownloadJob) DocumentDownloadJob {
	out := DocumentDownloadJob{
		ID: row.ID, Status: row.Status, CreatedAt: row.CreatedAt.Time.UTC(),
		Skipped: []DocumentDownloadSkip{}, Error: row.Error.String,
	}
	if row.ExpiresAt.Valid {
		t := row.ExpiresAt.Time.UTC()
		out.ExpiresAt = &t
		if row.Status == "ready" && !s.now().Before(t) {
			out.Status = "expired"
		}
	}
	if row.FileCount.Valid {
		n := int(row.FileCount.Int32)
		out.FileCount = &n
	}
	if len(row.Skipped) > 0 {
		var skipped []DocumentDownloadSkip
		if err := json.Unmarshal(row.Skipped, &skipped); err == nil && skipped != nil {
			out.Skipped = skipped
		}
	}
	out.DownloadReady = out.Status == "ready" && row.FileID.Valid
	return out
}

// OpenDocumentDownloadJob streams the ready zip. The creator, the job's
// workspace and the one hour window are re-checked on every call, as the
// privacy export download does.
func (s *DocumentService) OpenDocumentDownloadJob(ctx context.Context, actor Actor, workspaceID, jobID string) (DocumentDownloadZip, error) {
	row, err := s.downloadJobRow(ctx, actor, workspaceID, jobID)
	if err != nil {
		return DocumentDownloadZip{}, err
	}
	view := s.downloadJobView(row)
	if view.Status == "expired" {
		return DocumentDownloadZip{}, errDownloadExpired()
	}
	if view.Status != "ready" || !row.FileID.Valid || s.files == nil {
		return DocumentDownloadZip{}, ErrNotFound
	}
	reader, err := s.files.Open(ctx, files.OpenInput{
		Scope:  files.Scope{OrganizationID: row.OrganizationID, WorkspaceID: row.WorkspaceID},
		FileID: files.FileID(row.FileID.String),
	})
	if err != nil {
		return DocumentDownloadZip{}, documentFileError(err)
	}
	name := "documents-" + row.CreatedAt.Time.UTC().Format("20060102T1504Z") + ".zip"
	return DocumentDownloadZip{Reader: reader, Filename: name, ContentType: "application/zip"}, nil
}

// releaseExpiredDocumentDownloads drops the file reference of every zip whose
// window has closed. It rides the audit retention tick beside the privacy
// export release: the download route is what enforces the window, and this
// only lets the collector see the unlink.
func releaseExpiredDocumentDownloads(ctx context.Context, pool *pgxpool.Pool, q *db.Queries, fs files.Service) {
	if fs == nil || pool == nil {
		return
	}
	rows, err := q.ListExpiredDocumentDownloadFiles(ctx)
	if err != nil {
		return
	}
	for _, row := range rows {
		tx, err := pool.Begin(ctx)
		if err != nil {
			return
		}
		qq := q.WithTx(tx)
		n, err := qq.ReleaseDocumentDownloadFile(ctx, db.ReleaseDocumentDownloadFileParams(row))
		if err != nil || n == 0 {
			_ = tx.Rollback(ctx)
			continue
		}
		if err := releaseFilesInTx(ctx, fs, qq, []files.FileID{files.FileID(row.FileID.String)}); err != nil {
			_ = tx.Rollback(ctx)
			continue
		}
		_ = tx.Commit(ctx)
	}
}

// documentDownloadReferenceProvider tells the collector which zips a job
// still points at.
type documentDownloadReferenceProvider struct{}

func DocumentDownloadReferenceProvider() files.ReferenceProvider {
	return documentDownloadReferenceProvider{}
}

func (documentDownloadReferenceProvider) Name() string { return "documents.download_jobs" }

func (documentDownloadReferenceProvider) Purposes() []files.UploadPurpose {
	return []files.UploadPurpose{files.DocumentDownload}
}

func (documentDownloadReferenceProvider) HeldBy(ctx context.Context, q *db.Queries, ids []files.FileID) (map[files.FileID]files.HoldReason, error) {
	raw := make([]string, len(ids))
	for i, id := range ids {
		raw[i] = string(id)
	}
	rows, err := q.DocumentDownloadHeldFileIDs(ctx, raw)
	if err != nil {
		return nil, err
	}
	held := make(map[files.FileID]files.HoldReason, len(rows))
	for _, id := range rows {
		if id.Valid {
			held[files.FileID(id.String)] = files.HoldActive
		}
	}
	return held, nil
}
