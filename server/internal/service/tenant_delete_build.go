package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/outbox"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const privacyDeleteActor = "privacy-delete"

// PrivacyDeletionConsumer erases one organization on the slow outbox lane.
// graphForget is projector.ForgetOrganization, wired from main. This package
// cannot import projector: the projector tests already import service.
type PrivacyDeletionConsumer struct {
	pool        *pgxpool.Pool
	q           *db.Queries
	files       files.Service
	graphForget func(ctx context.Context, q *db.Queries, organizationID string) error
}

func NewPrivacyDeletionConsumer(pool *pgxpool.Pool, q *db.Queries) *PrivacyDeletionConsumer {
	return &PrivacyDeletionConsumer{pool: pool, q: q}
}

func (c *PrivacyDeletionConsumer) SetFileService(fs files.Service) { c.files = fs }

// SetGraphForget wires the Work Graph wipe. main passes projector.ForgetOrganization.
func (c *PrivacyDeletionConsumer) SetGraphForget(fn func(ctx context.Context, q *db.Queries, organizationID string) error) {
	c.graphForget = fn
}

func (*PrivacyDeletionConsumer) Name() string { return "privacy-deletion" }

// DeliveryTimeout matches the outbox lease. A longer value is capped, and the
// delivery context is cancelled at the deadline while this call may still be
// rolling back. The next attempt has to finish the erasure.
func (*PrivacyDeletionConsumer) DeliveryTimeout() time.Duration { return 2 * time.Minute }

func (*PrivacyDeletionConsumer) Topics() []string { return []string{"privacy.deletion_requested"} }

func (c *PrivacyDeletionConsumer) Handle(ctx context.Context, ev outbox.Row) error {
	if c.files == nil || c.pool == nil {
		return fmt.Errorf("privacy delete: file service is not wired")
	}
	var payload map[string]string
	if err := json.Unmarshal([]byte(ev.Payload), &payload); err != nil {
		return fmt.Errorf("privacy delete: payload of %s: %w", ev.ID, err)
	}
	requestID, orgID := payload["request_id"], payload["organization_id"]
	if requestID == "" || orgID == "" {
		return nil
	}
	row, err := c.q.GetDataSubjectRequest(ctx, db.GetDataSubjectRequestParams{ID: requestID, OrganizationID: orgID})
	if err != nil {
		return err
	}
	if privacyDeletionSettled(row) {
		return nil
	}
	started, err := c.q.StartDataSubjectDeletion(ctx, requestID)
	if err != nil {
		return err
	}
	if started == 0 {
		// Zero rows means the claim lost to a cancel, or an earlier attempt
		// already set started_at and then rolled the erasure back. A cancel
		// is finished. An open claim has to be erased again: treating it as
		// success leaves the organization locked, with no way to cancel.
		row, err = c.q.GetDataSubjectRequest(ctx, db.GetDataSubjectRequestParams{ID: requestID, OrganizationID: orgID})
		if err != nil {
			return err
		}
		if privacyDeletionSettled(row) || !row.StartedAt.Valid {
			return nil
		}
	}
	err = c.erase(ctx, row)
	if err == nil || errors.Is(err, context.Canceled) {
		return err
	}
	if ev.Attempts+1 < outbox.MaxAttempts {
		return err
	}
	// The lease will park the event after this attempt. Record the failure
	// and unlock the organization. The erasure transaction has rolled back,
	// so the content is still there and the owner can ask again.
	if gerr := c.giveUp(context.WithoutCancel(ctx), row); gerr != nil {
		return errors.Join(err, gerr)
	}
	return nil
}

func privacyDeletionSettled(row db.DataSubjectRequest) bool {
	return row.CompletedAt.Valid || row.FailedAt.Valid || row.CancelledAt.Valid
}

func (c *PrivacyDeletionConsumer) giveUp(ctx context.Context, row db.DataSubjectRequest) error {
	fresh, err := c.q.GetDataSubjectRequest(ctx, db.GetDataSubjectRequestParams{
		ID: row.ID, OrganizationID: row.OrganizationID,
	})
	if err != nil {
		return err
	}
	if privacyDeletionSettled(fresh) {
		return nil
	}
	tx, err := c.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := c.q.WithTx(tx)
	if err := q.FailDataSubjectRequest(ctx, db.FailDataSubjectRequestParams{
		ID:    row.ID,
		Error: pgtype.Text{String: "xóa tổ chức không xong sau nhiều lần thử", Valid: true},
	}); err != nil {
		return err
	}
	if err := q.ClearOrganizationDeletionSchedule(ctx, row.OrganizationID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (c *PrivacyDeletionConsumer) erase(ctx context.Context, row db.DataSubjectRequest) error {
	tx, err := c.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := c.q.WithTx(tx)
	removed, err := deleteTenantTables(ctx, tx, row.OrganizationID)
	if err != nil {
		return err
	}
	if err := q.ClearDataSubjectRequestFiles(ctx, row.OrganizationID); err != nil {
		return err
	}
	if err := q.ClearAuditExportFiles(ctx, row.OrganizationID); err != nil {
		return err
	}
	if err := q.ScrubOrganizationMemberProfiles(ctx, row.OrganizationID); err != nil {
		return err
	}
	if err := q.DeactivateOrganizationMembersForPrivacy(ctx, db.DeactivateOrganizationMembersForPrivacyParams{
		OrganizationID: row.OrganizationID,
		DeactivatedBy:  pgtype.Text{String: row.RequestedBy, Valid: true},
	}); err != nil {
		return err
	}
	if err := q.CancelOrganizationSubscriptions(ctx, db.CancelOrganizationSubscriptionsParams{
		OrganizationID: row.OrganizationID, UpdatedBy: privacyDeleteActor, UpdatedByKind: string(audit.KindSystem),
	}); err != nil {
		return err
	}
	if err := q.AnonymizeOrganization(ctx, db.AnonymizeOrganizationParams{
		ID: row.OrganizationID, Name: deletedOrganizationName, Slug: deletedOrganizationSlug(row.OrganizationID),
	}); err != nil {
		return err
	}
	ids, err := q.ListOrganizationFileIDs(ctx, pgtype.Text{String: row.OrganizationID, Valid: true})
	if err != nil {
		return err
	}
	if err := releaseOrganizationFiles(ctx, c.files, q, ids); err != nil {
		return err
	}
	if c.graphForget == nil {
		return fmt.Errorf("privacy delete: graph forget is not wired")
	}
	if err := c.graphForget(ctx, q, row.OrganizationID); err != nil {
		return err
	}
	count := int32(removed)
	if removed > math.MaxInt32 {
		count = math.MaxInt32
	}
	if _, err := q.CompleteDataSubjectDeletion(ctx, db.CompleteDataSubjectDeletionParams{
		ID: row.ID, RowCount: count,
	}); errors.Is(err, pgx.ErrNoRows) {
		fresh, ferr := q.GetDataSubjectRequest(ctx, db.GetDataSubjectRequestParams{
			ID: row.ID, OrganizationID: row.OrganizationID,
		})
		if ferr != nil {
			return ferr
		}
		if privacyDeletionSettled(fresh) {
			return nil
		}
		return fmt.Errorf("privacy delete: request %s did not complete", row.ID)
	} else if err != nil {
		return err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: row.OrganizationID,
		Actor:          audit.System(privacyDeleteActor),
		Action:         audit.ActionPrivacyOrganizationDeleted,
		ResourceType:   "organization", ResourceID: row.OrganizationID,
	}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func deleteTenantTables(ctx context.Context, tx pgx.Tx, orgID string) (int64, error) {
	allowed := map[string]bool{}
	for _, name := range tenantDeleteTables() {
		allowed[name] = true
	}
	var removed int64
	for _, table := range tenantDeleteTables() {
		if !tenantTableIdent.MatchString(table) || !allowed[table] {
			return 0, fmt.Errorf("privacy delete: refused table %q", table)
		}
		tag, err := tx.Exec(ctx, fmt.Sprintf(`DELETE FROM %s WHERE organization_id = $1`, table), orgID)
		if err != nil {
			return 0, fmt.Errorf("privacy delete: %s: %w", table, err)
		}
		removed += tag.RowsAffected()
	}
	return removed, nil
}

func releaseOrganizationFiles(ctx context.Context, fs files.Service, q *db.Queries, ids []string) error {
	const batch = 100
	buf := make([]files.FileID, 0, batch)
	for _, id := range ids {
		buf = append(buf, files.FileID(id))
		if len(buf) == batch {
			if err := releaseFilesInTx(ctx, fs, q, buf); err != nil {
				return err
			}
			buf = buf[:0]
		}
	}
	return releaseFilesInTx(ctx, fs, q, buf)
}
