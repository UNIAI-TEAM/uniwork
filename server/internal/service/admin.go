package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/telemetry"
	"github.com/unicomhub/uniwork/server/internal/util"
	"github.com/unicomhub/uniwork/server/migrations"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Platform roles (users.platform_role). support reads; admin also writes.
const (
	PlatformRoleAdmin   = "admin"
	PlatformRoleSupport = "support"
)

// CLIActor is the actor id admin_actions records for uniwork-admin, which
// runs on the host with no session behind it.
const CLIActor = "cli"

const minReasonRunes = 10

// AdminService is the only door to the platform-admin operations (spec F-11
// §5). It never reads content tables: task bodies, messages and files stay
// behind the workspace services, and arch_test.go keeps admin.sql the only
// query set it calls.
type AdminService struct {
	pool    *pgxpool.Pool
	q       *db.Queries
	billing *BillingService
	ent     *EntitlementService
	// Readiness and realtime are optional views for /admin/system.
	readiness  *Readiness
	connsCount func() int64
	flagChain  []string
}

func NewAdminService(pool *pgxpool.Pool, q *db.Queries, billing *BillingService, ent *EntitlementService) *AdminService {
	return &AdminService{pool: pool, q: q, billing: billing, ent: ent}
}

// SetSystemSources attaches the live views /admin/system reports.
func (s *AdminService) SetSystemSources(r *Readiness, conns func() int64, flagChain []string) {
	s.readiness, s.connsCount, s.flagChain = r, conns, flagChain
}

// PlatformRole answers the middleware: "" when the user holds none.
func (s *AdminService) PlatformRole(ctx context.Context, userID string) (string, error) {
	u, err := s.q.GetUserByID(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	if !u.PlatformRole.Valid {
		return "", nil
	}
	return u.PlatformRole.String, nil
}

// ErrReasonTooShort: every admin write carries a reason a reader can act on.
var ErrReasonTooShort = ValidationError{Msg: "reason phải có ít nhất 10 ký tự"}

func checkReason(reason string) error {
	if len([]rune(strings.TrimSpace(reason))) < minReasonRunes {
		return ErrReasonTooShort
	}
	return nil
}

// Sort orders accepted by the organizations screen. Anything else falls back
// to the newest first, so a stale client can never ask for an unknown column.
const (
	SortOrganizationsCreated      = "created_desc"
	SortOrganizationsActivityDesc = "activity_desc"
	SortOrganizationsActivityAsc  = "activity_asc"
)

// ListOrganizationsInput filters the console's organizations screen.
type ListOrganizationsInput struct {
	Query  string
	Status string
	Sort   string
	Limit  int32
	Offset int32
}

// OrganizationPage is one page of the list plus the size of the whole
// filtered set, so the console can say "1-50 of 128" and disable Next.
type OrganizationPage struct {
	Organizations []db.AdminListOrganizationsRow
	Total         int64
	Limit         int32
	Offset        int32
}

func normalizeOrganizationSort(sort string) string {
	switch sort {
	case SortOrganizationsActivityDesc, SortOrganizationsActivityAsc:
		return sort
	default:
		return SortOrganizationsCreated
	}
}

func (s *AdminService) ListOrganizations(ctx context.Context, in ListOrganizationsInput) (OrganizationPage, error) {
	if in.Limit <= 0 || in.Limit > 200 {
		in.Limit = 50
	}
	if in.Offset < 0 {
		in.Offset = 0
	}
	rows, err := s.q.AdminListOrganizations(ctx, db.AdminListOrganizationsParams{
		Limit: in.Limit, Offset: in.Offset, Sort: normalizeOrganizationSort(in.Sort),
		Status: nullText(in.Status), Q: nullText(strings.TrimSpace(in.Query)),
	})
	if err != nil {
		return OrganizationPage{}, err
	}
	out := OrganizationPage{Organizations: rows, Limit: in.Limit, Offset: in.Offset}
	if len(rows) > 0 {
		out.Total = rows[0].TotalCount
		return out, nil
	}
	// An offset past the end returns no row to carry the window count, and a
	// console that lost its total cannot draw the pager it needs to get back.
	out.Total, err = s.q.AdminCountOrganizations(ctx, db.AdminCountOrganizationsParams{
		Status: nullText(in.Status), Q: nullText(strings.TrimSpace(in.Query)),
	})
	if err != nil {
		return OrganizationPage{}, err
	}
	return out, nil
}

// OrganizationDetail is the detail screen: metadata, the entitlement snapshot
// (usage against quota) and the last admin actions on this target.
type OrganizationDetail struct {
	Organization db.AdminGetOrganizationRow
	Entitlements []Entitlement
	Actions      []db.AdminAction
}

func (s *AdminService) GetOrganization(ctx context.Context, orgID string) (OrganizationDetail, error) {
	o, err := s.q.AdminGetOrganization(ctx, orgID)
	if errors.Is(err, pgx.ErrNoRows) {
		return OrganizationDetail{}, ErrNotFound
	}
	if err != nil {
		return OrganizationDetail{}, err
	}
	out := OrganizationDetail{Organization: o}
	if s.ent != nil {
		if snap, err := s.ent.Snapshot(ctx, orgID); err == nil {
			out.Entitlements = snap.Entitlements
		}
	}
	out.Actions, err = s.q.ListAdminActionsByTarget(ctx, db.ListAdminActionsByTargetParams{TargetType: "organization", TargetID: orgID, Limit: 20})
	if err != nil {
		return OrganizationDetail{}, err
	}
	return out, nil
}

// SetOrganizationStatus suspends or unsuspends. Same transaction: the row,
// admin_actions, audit_events and the owner-facing event.
func (s *AdminService) SetOrganizationStatus(ctx context.Context, adminID, orgID, status, reason string) (db.Organization, error) {
	if err := checkReason(reason); err != nil {
		return db.Organization{}, err
	}
	if status != OrganizationActive && status != OrganizationSuspended {
		return db.Organization{}, Invalid("status không hợp lệ")
	}
	ctx, traceID := ensureTrace(ctx)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.Organization{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	before, err := q.GetOrganizationByID(ctx, orgID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Organization{}, ErrNotFound
	}
	if err != nil {
		return db.Organization{}, err
	}
	if before.Status == status {
		return before, nil
	}
	params := db.AdminSetOrganizationStatusParams{ID: orgID, Status: status}
	action, topic := audit.ActionOrganizationUnsuspended, "organization.unsuspended"
	if status == OrganizationSuspended {
		params.SuspendedAt = pgtype.Timestamptz{Time: time.Now(), Valid: true}
		params.SuspendedReason = nullText(reason)
		action, topic = audit.ActionOrganizationSuspended, "organization.suspended"
	}
	after, err := q.AdminSetOrganizationStatus(ctx, params)
	if err != nil {
		return db.Organization{}, err
	}
	changes := map[string]any{"status": status}
	if err := s.recordAdmin(ctx, q, traceID, adminID, action, "organization", orgID, map[string]any{"status": before.Status}, changes, reason); err != nil {
		return db.Organization{}, err
	}
	owners, err := q.ListOrgAdminUserIDs(ctx, orgID)
	if err != nil {
		return db.Organization{}, err
	}
	events := make([]audit.Event, 0, len(owners))
	for _, uid := range owners {
		events = append(events, audit.Event{Topic: topic, Payload: map[string]string{"organization_id": orgID, "user_id": uid}})
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID,
		Actor:          audit.User(adminID),
		Action:         action,
		ResourceType:   "organization", ResourceID: orgID,
		Changes:  audit.Diff(map[string]any{"status": before.Status}, changes),
		Metadata: map[string]any{"reason": reason, "platform_admin": true},
	}, events...); err != nil {
		return db.Organization{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.Organization{}, err
	}
	return after, nil
}

// ChangePlan is the manual plan switch (pilots, partners). The subscription
// change itself, its audit row and event come from BillingService with the
// admin as actor; admin_actions adds the reason.
func (s *AdminService) ChangePlan(ctx context.Context, adminID, orgID, planCode, reason string) (EntitlementSnapshot, error) {
	if err := checkReason(reason); err != nil {
		return EntitlementSnapshot{}, err
	}
	cur, err := s.ent.Snapshot(ctx, orgID)
	if err != nil {
		return EntitlementSnapshot{}, err
	}
	snap, err := s.billing.ChangePlan(ctx, adminID, orgID, planCode, cur.Subscription.RowVersion)
	if err != nil {
		return EntitlementSnapshot{}, err
	}
	_, traceID := ensureTrace(ctx)
	err = s.recordAdmin(ctx, s.q, traceID, adminID, "organization.plan_changed", "organization", orgID,
		map[string]any{"plan_code": cur.Plan.Code}, map[string]any{"plan_code": snap.Plan.Code}, reason)
	return snap, err
}

// Trace is the support view of one trace id: audit rows, outbox rows and
// admin actions that carry it. No log backend proxy at F (plan decision 9).
type Trace struct {
	TraceID string
	Audit   []db.AdminListAuditEventsByCorrelationRow
	Outbox  []db.AdminListOutboxEventsByCorrelationRow
	Actions []db.AdminAction
}

func (s *AdminService) Trace(ctx context.Context, traceID string) (Trace, error) {
	if !audit.ValidCorrelationID(traceID) {
		return Trace{}, Invalid("trace id không hợp lệ")
	}
	out := Trace{TraceID: traceID}
	var err error
	if out.Audit, err = s.q.AdminListAuditEventsByCorrelation(ctx, traceID); err != nil {
		return Trace{}, err
	}
	if out.Outbox, err = s.q.AdminListOutboxEventsByCorrelation(ctx, nullText(traceID)); err != nil {
		return Trace{}, err
	}
	if out.Actions, err = s.q.ListAdminActionsByTrace(ctx, nullText(traceID)); err != nil {
		return Trace{}, err
	}
	return out, nil
}

// System is /admin/system: versions, readiness, outbox and realtime health.
type System struct {
	Version           string
	Commit            string
	MigrationEmbedded string
	Readiness         ReadinessReport
	OutboxPending     int64
	OutboxDead        int64
	OutboxOldestAge   float64
	RealtimeConns     int64
	FlagProviders     []string
}

func (s *AdminService) System(ctx context.Context, version, commit string) (System, error) {
	out := System{Version: version, Commit: commit, MigrationEmbedded: migrations.Latest(), FlagProviders: s.flagChain}
	if s.readiness != nil {
		out.Readiness = s.readiness.Check(ctx)
	}
	if s.connsCount != nil {
		out.RealtimeConns = s.connsCount()
	}
	sum, err := s.q.AdminOutboxSummary(ctx)
	if err != nil {
		return System{}, err
	}
	out.OutboxPending, out.OutboxDead, out.OutboxOldestAge = sum.Pending, sum.Dead, sum.OldestPendingAgeSeconds
	return out, nil
}

// SetPlatformRole grants (role admin|support) or revokes (role "") by email.
// actorID is a platform admin's user id, or CLIActor from uniwork-admin.
func (s *AdminService) SetPlatformRole(ctx context.Context, actorID, email, role, reason string) (db.User, error) {
	if err := checkReason(reason); err != nil {
		return db.User{}, err
	}
	if role != "" && role != PlatformRoleAdmin && role != PlatformRoleSupport {
		return db.User{}, Invalid("role phải là admin, support hoặc rỗng")
	}
	u, err := s.q.GetUserByEmail(ctx, strings.ToLower(strings.TrimSpace(email)))
	if errors.Is(err, pgx.ErrNoRows) {
		return db.User{}, ErrNotFound
	}
	if err != nil {
		return db.User{}, err
	}
	ctx, traceID := ensureTrace(ctx)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.User{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	before := ""
	if u.PlatformRole.Valid {
		before = u.PlatformRole.String
	}
	after, err := q.SetUserPlatformRole(ctx, db.SetUserPlatformRoleParams{ID: u.ID, PlatformRole: nullText(role), PlatformRoleGrantedBy: nullText(actorID)})
	if err != nil {
		return db.User{}, err
	}
	action := audit.ActionPlatformRoleGranted
	if role == "" {
		action = audit.ActionPlatformRoleRevoked
	}
	if err := s.recordAdmin(ctx, q, traceID, actorID, action, "user", u.ID, map[string]any{"platform_role": before}, map[string]any{"platform_role": role}, reason); err != nil {
		return db.User{}, err
	}
	actor := audit.User(actorID)
	if actorID == CLIActor {
		actor = audit.System(CLIActor)
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: audit.NoOrganization,
		Actor:          actor,
		Action:         action,
		ResourceType:   "user", ResourceID: u.ID,
		Changes:  audit.Diff(map[string]any{"platform_role": before}, map[string]any{"platform_role": role}),
		Metadata: map[string]any{"reason": reason},
	}); err != nil {
		return db.User{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.User{}, err
	}
	return after, nil
}

func (s *AdminService) ListPlatformRoles(ctx context.Context) ([]db.ListPlatformRoleUsersRow, error) {
	return s.q.ListPlatformRoleUsers(ctx)
}

// recordAdmin writes the admin_actions row with the request's trace id.
// nullText is "" → NULL, the shape every optional admin.sql column takes.
func nullText(v string) pgtype.Text {
	if v == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: v, Valid: true}
}

// ensureTrace returns the id admin_actions and audit_events share: the OTel
// trace id under HTTP, else the request correlation id, else a fresh one put
// on the context so the audit recorder picks up the same value (CLI, tests).
func ensureTrace(ctx context.Context) (context.Context, string) {
	if id := telemetry.TraceID(ctx); id != "" {
		return ctx, id
	}
	if id := audit.CorrelationID(ctx); id != "" {
		return ctx, id
	}
	id := util.NewID()
	return audit.WithRequest(ctx, audit.RequestInfo{CorrelationID: id}), id
}

// recordAdmin writes the admin_actions row with the request's trace id.
func (s *AdminService) recordAdmin(ctx context.Context, q *db.Queries, traceID, actorID, action, targetType, targetID string, before, after map[string]any, reason string) error {
	b, _ := json.Marshal(before)
	a, _ := json.Marshal(after)
	return q.InsertAdminAction(ctx, db.InsertAdminActionParams{
		ID: util.NewID(), ActorID: actorID, Action: action,
		TargetType: targetType, TargetID: targetID,
		Before: b, After: a, Reason: strings.TrimSpace(reason), TraceID: nullText(traceID),
	})
}
