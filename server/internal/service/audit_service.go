package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	// AuditPageMax caps a page of the audit log. A tenant with a year of
	// history is expected; a request that could return all of it is not.
	// Exported because the handler decides whether to hand back a cursor by
	// comparing the page size against it.
	AuditPageMax int32 = 100

	// retention bounds. The floor keeps a tenant from making its own log
	// useless by accident; the ceiling is what the archive job (not yet built)
	// is being designed for.
	retentionMinDays     = 30
	retentionMaxDays     = 730
	retentionDefaultDays = 90

	// exportMaxRows is the point at which the caller is asked to narrow the
	// range instead. Past it the file stops being something a person opens.
	exportMaxRows int32 = 500_000
)

// AuditService reads the audit log for an organization and owns the two
// tenant-facing controls around it: export and retention.
//
// Visibility is decided here, never in a handler: the organization gate is
// this service's RequireOrgAdmin, and resource history goes through
// WorkspaceService.RequireMember like every other workspace read.
type AuditService struct {
	pool *pgxpool.Pool
	q    *db.Queries
	orgs *OrganizationService
	ws   *WorkspaceService
}

func NewAuditService(pool *pgxpool.Pool, q *db.Queries, orgs *OrganizationService, ws *WorkspaceService) *AuditService {
	return &AuditService{pool: pool, q: q, orgs: orgs, ws: ws}
}

// AuditFilter narrows a page of the log. Every field is optional; Before is a
// cursor, not an offset, so paging stays stable while rows arrive.
type AuditFilter struct {
	Before       string
	ActorID      string
	Action       string
	ResourceType string
	ResourceID   string
	WorkspaceID  string
	From         *time.Time
	To           *time.Time
	Limit        int32
}

// AuditEventView is one row as a reader sees it: JSON columns parsed, and the
// IP address present only for an organization owner.
type AuditEventView struct {
	db.AuditEvent
	ChangesParsed  map[string]any
	MetadataParsed map[string]any
	IP             *string
}

// RequireOrgAdmin is the one gate for the organization-wide log. Owners and
// admins read it; everyone else gets ErrForbidden, and a non-member cannot
// tell an organization apart from one that does not exist.
func (s *AuditService) RequireOrgAdmin(ctx context.Context, orgID, userID string) (db.OrganizationMember, error) {
	m, err := s.orgs.RequireMember(ctx, orgID, userID)
	if err != nil {
		return db.OrganizationMember{}, err
	}
	if m.Role != "owner" && m.Role != "admin" {
		return db.OrganizationMember{}, ErrForbidden
	}
	return m, nil
}

// List returns a page of the organization's log, newest first.
func (s *AuditService) List(ctx context.Context, userID, orgID string, f AuditFilter) ([]AuditEventView, error) {
	m, err := s.RequireOrgAdmin(ctx, orgID, userID)
	if err != nil {
		return nil, err
	}
	limit := f.Limit
	if limit <= 0 || limit > AuditPageMax {
		limit = AuditPageMax
	}
	rows, err := s.q.ListAuditEvents(ctx, db.ListAuditEventsParams{
		OrganizationID: orgID,
		Before:         optNullText(f.Before),
		ActorID:        optNullText(f.ActorID),
		Action:         optNullText(f.Action),
		ResourceType:   optNullText(f.ResourceType),
		ResourceID:     optNullText(f.ResourceID),
		WorkspaceID:    optNullText(f.WorkspaceID),
		FromAt:         optNullTime(f.From),
		ToAt:           optNullTime(f.To),
		LimitN:         limit,
	})
	if err != nil {
		return nil, err
	}
	return viewsFor(rows, m.Role), nil
}

// Get returns one row of the organization's log.
func (s *AuditService) Get(ctx context.Context, userID, orgID, eventID string) (AuditEventView, error) {
	m, err := s.RequireOrgAdmin(ctx, orgID, userID)
	if err != nil {
		return AuditEventView{}, err
	}
	row, err := s.q.GetAuditEvent(ctx, db.GetAuditEventParams{ID: eventID, OrganizationID: orgID})
	if errors.Is(err, pgx.ErrNoRows) {
		return AuditEventView{}, ErrNotFound
	}
	if err != nil {
		return AuditEventView{}, err
	}
	return viewsFor([]db.AuditEvent{row}, m.Role)[0], nil
}

// ResourceHistory is the "Activity" list on a task or meeting. It is a
// workspace read, so any effective member sees it — and the IP address is not
// part of it at all: a colleague's address is not activity, it is surveillance.
func (s *AuditService) ResourceHistory(ctx context.Context, userID, workspaceID, resourceType, resourceID string, limit int32) ([]AuditEventView, error) {
	if _, err := s.ws.RequireMember(ctx, workspaceID, userID); err != nil {
		return nil, err
	}
	if limit <= 0 || limit > AuditPageMax {
		limit = AuditPageMax
	}
	rows, err := s.q.ListResourceAuditEvents(ctx, db.ListResourceAuditEventsParams{
		ResourceType: resourceType,
		ResourceID:   resourceID,
		WorkspaceID:  pgtype.Text{String: workspaceID, Valid: true},
		Limit:        limit,
	})
	if err != nil {
		return nil, err
	}
	return viewsFor(rows, "member"), nil
}

// Retention returns the organization's retention window in days, falling back
// to the default when no row has been written.
func (s *AuditService) Retention(ctx context.Context, userID, orgID string) (int32, error) {
	if _, err := s.RequireOrgAdmin(ctx, orgID, userID); err != nil {
		return 0, err
	}
	p, err := s.q.GetAuditRetentionPolicy(ctx, orgID)
	if errors.Is(err, pgx.ErrNoRows) {
		return retentionDefaultDays, nil
	}
	if err != nil {
		return 0, err
	}
	return p.RetainDays, nil
}

// SetRetention changes the window. Owner only: shortening it is the one
// setting on this screen that destroys evidence later.
func (s *AuditService) SetRetention(ctx context.Context, userID, orgID string, days int32) (int32, error) {
	m, err := s.RequireOrgAdmin(ctx, orgID, userID)
	if err != nil {
		return 0, err
	}
	if m.Role != "owner" {
		return 0, ErrForbidden
	}
	if days < retentionMinDays || days > retentionMaxDays {
		return 0, Invalid("retain_days phải từ 30 đến 730")
	}
	before, err := s.Retention(ctx, userID, orgID)
	if err != nil {
		return 0, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	p, err := q.UpsertAuditRetentionPolicy(ctx, db.UpsertAuditRetentionPolicyParams{
		OrganizationID: orgID, RetainDays: days,
		UpdatedBy: userID, UpdatedByKind: string(audit.KindHuman),
	})
	if err != nil {
		return 0, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID,
		Actor:          audit.User(userID),
		Action:         audit.ActionAuditRetentionSet,
		ResourceType:   "audit_retention_policy", ResourceID: orgID,
		Changes: audit.Diff(map[string]any{"retain_days": int(before)}, map[string]any{"retain_days": int(days)}),
	}); err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return p.RetainDays, nil
}

// RequestExport queues an export job. One at a time per organization: the job
// reads the whole window, and two of them racing would double the load for a
// file nobody asked for twice.
func (s *AuditService) RequestExport(ctx context.Context, userID, orgID, format string, from, to time.Time) (db.AuditExport, error) {
	m, err := s.RequireOrgAdmin(ctx, orgID, userID)
	if err != nil {
		return db.AuditExport{}, err
	}
	if m.Role != "owner" {
		return db.AuditExport{}, ErrForbidden
	}
	if format != "csv" && format != "json" {
		return db.AuditExport{}, Invalid("format phải là csv hoặc json")
	}
	if !to.After(from) {
		return db.AuditExport{}, Invalid("khoảng thời gian không hợp lệ")
	}
	running, err := s.q.CountRunningAuditExports(ctx, orgID)
	if err != nil {
		return db.AuditExport{}, err
	}
	if running > 0 {
		return db.AuditExport{}, errExportInFlight()
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.AuditExport{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	exp, err := q.InsertAuditExport(ctx, db.InsertAuditExportParams{
		ID: util.NewID(), OrganizationID: orgID,
		RequestedBy: userID, RequestedByKind: string(audit.KindHuman),
		Format: format,
		FromAt: pgtype.Timestamptz{Time: from, Valid: true},
		ToAt:   pgtype.Timestamptz{Time: to, Valid: true},
	})
	if err != nil {
		return db.AuditExport{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID,
		Actor:          audit.User(userID),
		Action:         audit.ActionAuditExportRequested,
		ResourceType:   "audit_export", ResourceID: exp.ID,
		Metadata: map[string]any{"format": format},
	}, audit.Event{
		Topic:          "audit.export_requested",
		Payload:        map[string]string{"export_id": exp.ID, "organization_id": orgID},
		OrganizationID: orgID,
	}); err != nil {
		return db.AuditExport{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.AuditExport{}, err
	}
	return exp, nil
}

// Export returns one export job's status.
func (s *AuditService) Export(ctx context.Context, userID, orgID, exportID string) (db.AuditExport, error) {
	if _, err := s.RequireOrgAdmin(ctx, orgID, userID); err != nil {
		return db.AuditExport{}, err
	}
	exp, err := s.q.GetAuditExport(ctx, db.GetAuditExportParams{ID: exportID, OrganizationID: orgID})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.AuditExport{}, ErrNotFound
	}
	return exp, err
}

// Exports lists recent export jobs for the organization.
func (s *AuditService) Exports(ctx context.Context, userID, orgID string) ([]db.AuditExport, error) {
	if _, err := s.RequireOrgAdmin(ctx, orgID, userID); err != nil {
		return nil, err
	}
	return s.q.ListAuditExports(ctx, db.ListAuditExportsParams{OrganizationID: orgID, Limit: 20})
}

// viewsFor parses the JSON columns and drops the IP address for anyone but an
// owner. Admins see who did what and when; the address is personal data under
// Nghị định 13 and is not needed to answer that (OPEN_QUESTIONS A2).
func viewsFor(rows []db.AuditEvent, role string) []AuditEventView {
	out := make([]AuditEventView, 0, len(rows))
	for _, r := range rows {
		v := AuditEventView{AuditEvent: r,
			ChangesParsed:  parseJSONObject(r.Changes),
			MetadataParsed: parseJSONObject(r.Metadata),
		}
		if role == "owner" && r.IpAddress.Valid {
			ip := r.IpAddress.String
			v.IP = &ip
		}
		v.AuditEvent.IpAddress = pgtype.Text{}
		out = append(out, v)
	}
	return out
}

// parseJSONObject decodes a stored JSON column. A column that cannot be parsed
// yields an empty object rather than an error: the row is history and a reader
// should still see who did what, even if one field was written by a version
// that shaped it differently.
func parseJSONObject(raw string) map[string]any {
	if raw == "" {
		return map[string]any{}
	}
	var m map[string]any
	if err := json.Unmarshal([]byte(raw), &m); err != nil || m == nil {
		return map[string]any{}
	}
	return m
}

// errExportInFlight is a 409 rather than a validation error: the caller did
// nothing wrong, the organization is simply already busy.
func errExportInFlight() error {
	return coded(http.StatusConflict, "audit_export_in_flight", "đã có một bản xuất nhật ký đang chạy")
}

func optNullText(s string) pgtype.Text {
	if s == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: s, Valid: true}
}

func optNullTime(t *time.Time) pgtype.Timestamptz {
	if t == nil {
		return pgtype.Timestamptz{}
	}
	return pgtype.Timestamptz{Time: *t, Valid: true}
}
