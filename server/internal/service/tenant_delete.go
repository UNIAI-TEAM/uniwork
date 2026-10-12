package service

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const deletedOrganizationName = "Tổ chức đã xóa"

// privacyDeletionDelay is how long a confirmed deletion waits before the
// existing privacy-deletion consumer erases the organization. The outbox
// row's available_at carries the same instant.
const privacyDeletionDelay = 5 * 24 * time.Hour

// RequestDeletion queues erasure of one organization. The owner must type the
// organization's slug. A second privacy request of either kind, while one is
// still open, is a conflict.
func (s *PrivacyExportService) RequestDeletion(ctx context.Context, userID, orgID, confirmSlug string) (db.DataSubjectRequest, error) {
	if err := s.requireOwner(ctx, orgID, userID); err != nil {
		return db.DataSubjectRequest{}, err
	}
	org, err := s.q.GetOrganizationByID(ctx, orgID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.DataSubjectRequest{}, ErrNotFound
	}
	if err != nil {
		return db.DataSubjectRequest{}, err
	}
	if strings.TrimSpace(confirmSlug) != org.Slug {
		return db.DataSubjectRequest{}, coded(http.StatusBadRequest, "privacy_delete_confirm", "nhập đúng định danh tổ chức để xác nhận")
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
	eraseAt := time.Now().UTC().Add(privacyDeletionDelay)
	row, err := q.InsertDataSubjectDeletion(ctx, db.InsertDataSubjectDeletionParams{
		ID: util.NewID(), OrganizationID: orgID,
		RequestedBy: userID, RequestedByKind: string(audit.KindHuman),
		EraseAt: pgtype.Timestamptz{Time: eraseAt, Valid: true},
	})
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return db.DataSubjectRequest{}, errPrivacyExportInFlight()
		}
		return db.DataSubjectRequest{}, err
	}
	if err := q.ScheduleOrganizationDeletion(ctx, db.ScheduleOrganizationDeletionParams{
		ID: orgID, DeletionScheduledAt: pgtype.Timestamptz{Time: eraseAt, Valid: true},
	}); err != nil {
		return db.DataSubjectRequest{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID,
		Actor:          audit.User(userID),
		Action:         audit.ActionPrivacyDeletionRequested,
		ResourceType:   "data_subject_request", ResourceID: row.ID,
	}, audit.Event{
		Topic:          "privacy.deletion_requested",
		Payload:        map[string]string{"request_id": row.ID, "organization_id": orgID},
		OrganizationID: orgID,
		AvailableAt:    eraseAt,
	}); err != nil {
		return db.DataSubjectRequest{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.DataSubjectRequest{}, err
	}
	return row, nil
}

// CancelDeletion stops a deletion that has not started. Members can enter
// again. The outbox row still arrives after the delay; the consumer sees the
// cancelled request and does nothing.
func (s *PrivacyExportService) CancelDeletion(ctx context.Context, userID, orgID string) (db.DataSubjectRequest, error) {
	if err := s.requireOwner(ctx, orgID, userID); err != nil {
		return db.DataSubjectRequest{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.DataSubjectRequest{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	row, err := q.GetOpenDataSubjectDeletion(ctx, orgID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.DataSubjectRequest{}, ErrNotFound
	}
	if err != nil {
		return db.DataSubjectRequest{}, err
	}
	if _, err := q.CancelDataSubjectDeletion(ctx, db.CancelDataSubjectDeletionParams{
		ID: row.ID, OrganizationID: orgID,
	}); errors.Is(err, pgx.ErrNoRows) {
		return db.DataSubjectRequest{}, coded(http.StatusConflict, "privacy_delete_started", "lệnh xóa đã bắt đầu, không hủy được")
	} else if err != nil {
		return db.DataSubjectRequest{}, err
	}
	if err := q.ClearOrganizationDeletionSchedule(ctx, orgID); err != nil {
		return db.DataSubjectRequest{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID,
		Actor:          audit.User(userID),
		Action:         audit.ActionPrivacyDeletionCancelled,
		ResourceType:   "data_subject_request", ResourceID: row.ID,
	}); err != nil {
		return db.DataSubjectRequest{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.DataSubjectRequest{}, err
	}
	row.CancelledAt = pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true}
	return row, nil
}

func deletedOrganizationSlug(orgID string) string {
	return "d-" + strings.ToLower(orgID)
}
