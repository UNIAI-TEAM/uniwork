package service

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type DemoRequestPage struct {
	Requests []db.DemoRequest
	Total    int64
}

func (s *AdminService) ListDemoRequests(ctx context.Context, status string, limit, offset int32) (DemoRequestPage, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}
	rows, err := s.q.AdminListDemoRequests(ctx, db.AdminListDemoRequestsParams{Status: nullText(status), Limit: limit, Offset: offset})
	if err != nil {
		return DemoRequestPage{}, err
	}
	total, err := s.q.AdminCountDemoRequests(ctx, nullText(status))
	return DemoRequestPage{Requests: rows, Total: total}, err
}
func (s *AdminService) UpdateDemoRequest(ctx context.Context, adminID, id, status, reason string) (db.DemoRequest, error) {
	if err := checkReason(reason); err != nil {
		return db.DemoRequest{}, err
	}
	if status != "new" && status != "in_progress" && status != "completed" {
		return db.DemoRequest{}, ValidationError{Msg: "status không hợp lệ"}
	}
	ctx, traceID := ensureTrace(ctx)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.DemoRequest{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	before, err := q.AdminGetDemoRequest(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.DemoRequest{}, ErrNotFound
	}
	if err != nil {
		return db.DemoRequest{}, err
	}
	after, err := q.AdminUpdateDemoRequest(ctx, db.AdminUpdateDemoRequestParams{ID: id, Status: status})
	if err != nil {
		return db.DemoRequest{}, err
	}
	old, next := map[string]any{"status": before.Status}, map[string]any{"status": after.Status}
	if err := s.recordAdmin(ctx, q, traceID, adminID, audit.ActionDemoRequestStatusUpdated, "demo_request", id, old, next, reason); err != nil {
		return db.DemoRequest{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{OrganizationID: audit.NoOrganization, Actor: audit.User(adminID), Action: audit.ActionDemoRequestStatusUpdated, ResourceType: "demo_request", ResourceID: id, Changes: audit.Diff(old, next), Metadata: map[string]any{"platform_admin": true, "reason": reason}}); err != nil {
		return db.DemoRequest{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.DemoRequest{}, err
	}
	return after, nil
}
