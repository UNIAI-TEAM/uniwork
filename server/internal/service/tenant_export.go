package service

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// PrivacyExportService is the owner-facing dossier of organization exports.
type PrivacyExportService struct {
	pool  *pgxpool.Pool
	q     *db.Queries
	orgs  *OrganizationService
	files files.Service
}

func NewPrivacyExportService(pool *pgxpool.Pool, q *db.Queries, orgs *OrganizationService) *PrivacyExportService {
	return &PrivacyExportService{pool: pool, q: q, orgs: orgs}
}

// SetFileService wires the download and the expiry release. Nil keeps both
// unable to open a file; the request route still records the job.
func (s *PrivacyExportService) SetFileService(fs files.Service) { s.files = fs }

func (s *PrivacyExportService) requireOwner(ctx context.Context, orgID, userID string) error {
	m, err := s.orgs.RequireMember(ctx, orgID, userID)
	if err != nil {
		return err
	}
	if m.Role != "owner" {
		return ErrForbidden
	}
	return nil
}

// RequestExport queues one organization export. A second request while one
// is still open is a conflict, including the race the partial unique index
// closes.
func (s *PrivacyExportService) RequestExport(ctx context.Context, userID, orgID string) (db.DataSubjectRequest, error) {
	if err := s.requireOwner(ctx, orgID, userID); err != nil {
		return db.DataSubjectRequest{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.DataSubjectRequest{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	running, err := q.CountOpenDataSubjectRequests(ctx, orgID)
	if err != nil {
		return db.DataSubjectRequest{}, err
	}
	if running > 0 {
		return db.DataSubjectRequest{}, errPrivacyExportInFlight()
	}
	row, err := q.InsertDataSubjectRequest(ctx, db.InsertDataSubjectRequestParams{
		ID: util.NewID(), OrganizationID: orgID,
		RequestedBy: userID, RequestedByKind: string(audit.KindHuman),
	})
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return db.DataSubjectRequest{}, errPrivacyExportInFlight()
		}
		return db.DataSubjectRequest{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID,
		Actor:          audit.User(userID),
		Action:         audit.ActionPrivacyExportRequested,
		ResourceType:   "data_subject_request", ResourceID: row.ID,
	}, audit.Event{
		Topic:          "privacy.export_requested",
		Payload:        map[string]string{"request_id": row.ID, "organization_id": orgID},
		OrganizationID: orgID,
	}); err != nil {
		return db.DataSubjectRequest{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.DataSubjectRequest{}, err
	}
	return row, nil
}

// Export returns one request the caller owns the organization of.
func (s *PrivacyExportService) Export(ctx context.Context, userID, orgID, requestID string) (db.DataSubjectRequest, error) {
	if err := s.requireOwner(ctx, orgID, userID); err != nil {
		return db.DataSubjectRequest{}, err
	}
	row, err := s.q.GetDataSubjectRequest(ctx, db.GetDataSubjectRequestParams{ID: requestID, OrganizationID: orgID})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.DataSubjectRequest{}, ErrNotFound
	}
	return row, err
}

// Exports lists recent requests.
func (s *PrivacyExportService) Exports(ctx context.Context, userID, orgID string) ([]db.DataSubjectRequest, error) {
	if err := s.requireOwner(ctx, orgID, userID); err != nil {
		return nil, err
	}
	return s.q.ListDataSubjectRequests(ctx, db.ListDataSubjectRequestsParams{OrganizationID: orgID, Limit: 20})
}

// PrivacyExportFile is the stream the download route copies to the client.
type PrivacyExportFile struct {
	Reader      files.Reader
	Filename    string
	ContentType string
}

// DownloadExport re-checks the owner and the 24 hour window on every call.
func (s *PrivacyExportService) DownloadExport(ctx context.Context, userID, orgID, requestID string) (PrivacyExportFile, error) {
	if err := s.requireOwner(ctx, orgID, userID); err != nil {
		return PrivacyExportFile{}, err
	}
	row, err := s.q.GetDataSubjectRequest(ctx, db.GetDataSubjectRequestParams{ID: requestID, OrganizationID: orgID})
	if errors.Is(err, pgx.ErrNoRows) {
		return PrivacyExportFile{}, ErrNotFound
	}
	if err != nil {
		return PrivacyExportFile{}, err
	}
	if !row.CompletedAt.Valid || !row.ExpiresAt.Valid || !row.FileID.Valid || s.files == nil {
		return PrivacyExportFile{}, ErrNotFound
	}
	if !time.Now().Before(row.ExpiresAt.Time) {
		return PrivacyExportFile{}, coded(http.StatusGone, "privacy_export_expired", "bản xuất đã hết hạn tải")
	}
	reader, err := s.files.Open(ctx, files.OpenInput{
		Scope:  files.Scope{OrganizationID: orgID},
		FileID: files.FileID(row.FileID.String),
	})
	if err != nil {
		return PrivacyExportFile{}, filesError(err)
	}
	return PrivacyExportFile{Reader: reader, Filename: reader.File.Filename, ContentType: "application/zip"}, nil
}

func errPrivacyExportInFlight() error {
	return coded(http.StatusConflict, "privacy_export_in_flight", "đã có một bản xuất dữ liệu đang chạy")
}

// releaseExpiredPrivacyExports drops file references whose download window
// has closed. It rides the audit retention tick: the download route is what
// enforces the window, and this only lets the collector see the unlink.
func releaseExpiredPrivacyExports(ctx context.Context, pool *pgxpool.Pool, q *db.Queries, fs files.Service) {
	if fs == nil || pool == nil {
		return
	}
	rows, err := q.ListExpiredDataSubjectRequestFiles(ctx)
	if err != nil {
		return
	}
	for _, row := range rows {
		tx, err := pool.Begin(ctx)
		if err != nil {
			return
		}
		qq := q.WithTx(tx)
		n, err := qq.ReleaseDataSubjectRequestFile(ctx, db.ReleaseDataSubjectRequestFileParams(row))
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

// privacyExportReferenceProvider tells the collector which zips a request
// still points at.
type privacyExportReferenceProvider struct{}

func PrivacyExportReferenceProvider() files.ReferenceProvider {
	return privacyExportReferenceProvider{}
}

func (privacyExportReferenceProvider) Name() string { return "privacy.exports" }

func (privacyExportReferenceProvider) Purposes() []files.UploadPurpose {
	return []files.UploadPurpose{files.TenantExport}
}

func (privacyExportReferenceProvider) HeldBy(ctx context.Context, q *db.Queries, ids []files.FileID) (map[files.FileID]files.HoldReason, error) {
	raw := make([]string, len(ids))
	for i, id := range ids {
		raw[i] = string(id)
	}
	rows, err := q.DataSubjectRequestHeldFileIDs(ctx, raw)
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
