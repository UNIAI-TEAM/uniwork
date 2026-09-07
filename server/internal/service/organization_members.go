package service

import (
	"context"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/mail"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Organization roles. Exactly one owner exists at a time (spec F-03 §2
// decision 3); the unique index in migration 108 is the other half of that
// promise.
const (
	OrgRoleOwner  = "owner"
	OrgRoleAdmin  = "admin"
	OrgRoleMember = "member"
)

// defaultMemberPageSize / maxMemberPageSize bound the keyset page. The
// directory is read by every member, so an unbounded limit is a cheap way to
// make one request expensive for everyone.
const (
	defaultMemberPageSize = 50
	maxMemberPageSize     = 100
)

// MemberStatusFilter selects which memberships a listing returns.
const (
	MemberStatusActive      = "active"
	MemberStatusDeactivated = "deactivated"
	MemberStatusAll         = "all"
)

// OrganizationMemberService owns the membership lifecycle: who is in the
// organization, in what role, and whether they may still enter it. The
// decisions live here and the handlers only decode (spec F-03 §4.1).
type OrganizationMemberService struct {
	pool *pgxpool.Pool
	q    *db.Queries
	orgs *OrganizationService
	ent  *EntitlementService
	// render and out are only needed by the invitation path; SetMail wires
	// them after main has built the mail stack.
	render mail.Renderer
	out    mail.Enqueuer
}

func NewOrganizationMemberService(pool *pgxpool.Pool, q *db.Queries, orgs *OrganizationService) *OrganizationMemberService {
	return &OrganizationMemberService{pool: pool, q: q, orgs: orgs, ent: NewEntitlementService(pool, q)}
}

// MemberPage is one keyset page of the organization's membership.
type MemberPage struct {
	Members    []db.ListOrganizationMembersRow
	NextCursor string
}

// Members lists the organization's people. Every member may read it: the
// directory is the point of the feature, and it carries no content.
func (s *OrganizationMemberService) Members(ctx context.Context, actorID, orgID, status, cursor string, limit int32) (MemberPage, error) {
	if _, err := s.orgs.RequireMember(ctx, orgID, actorID); err != nil {
		return MemberPage{}, err
	}
	switch status {
	case "":
		status = MemberStatusActive
	case MemberStatusActive, MemberStatusDeactivated, MemberStatusAll:
	default:
		return MemberPage{}, Invalid("status phải là active, deactivated hoặc all")
	}
	if limit <= 0 {
		limit = defaultMemberPageSize
	}
	if limit > maxMemberPageSize {
		limit = maxMemberPageSize
	}
	name, userID, err := decodeMemberCursor(cursor)
	if err != nil {
		return MemberPage{}, err
	}
	// One row over the page size answers "is there another page" without a
	// second count query.
	rows, err := s.q.ListOrganizationMembers(ctx, db.ListOrganizationMembersParams{
		OrganizationID: orgID,
		Status:         status,
		CursorName:     name,
		CursorUserID:   userID,
		RowLimit:       limit + 1,
	})
	if err != nil {
		return MemberPage{}, err
	}
	page := MemberPage{Members: rows}
	if int32(len(rows)) > limit {
		page.Members = rows[:limit]
		last := page.Members[len(page.Members)-1]
		page.NextCursor = encodeMemberCursor(last.DisplayName, last.UserID)
	}
	return page, nil
}

// Membership is the caller's own row, read by slug and returned even when the
// membership is deactivated: that is exactly the state the client needs in
// order to draw the blocked screen instead of an empty workspace (spec F-03
// §6.3). A non-member still gets 404 — the slug stays unconfirmed.
func (s *OrganizationMemberService) Membership(ctx context.Context, actorID, orgSlug string) (db.Organization, db.OrganizationMember, error) {
	o, err := s.q.GetOrganizationBySlug(ctx, orgSlug)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Organization{}, db.OrganizationMember{}, ErrNotFound
	}
	if err != nil {
		return db.Organization{}, db.OrganizationMember{}, err
	}
	m, err := s.member(ctx, o.ID, actorID)
	if err != nil {
		return db.Organization{}, db.OrganizationMember{}, ErrNotFound
	}
	return o, m, nil
}

// UpdateRole moves a member between admin and member. Ownership is not a role
// change: it goes through TransferOwnership so the organization is never
// without an owner, and never has two.
func (s *OrganizationMemberService) UpdateRole(ctx context.Context, actorID, orgID, targetID, role string) (db.OrganizationMember, error) {
	// An admin may move a peer between admin and member; only ownership is
	// reserved to the owner (spec F-03 §4.1).
	if _, err := s.requireAdmin(ctx, orgID, actorID); err != nil {
		return db.OrganizationMember{}, err
	}
	if role != OrgRoleAdmin && role != OrgRoleMember {
		return db.OrganizationMember{}, Invalid("role phải là admin hoặc member")
	}
	target, err := s.member(ctx, orgID, targetID)
	if err != nil {
		return db.OrganizationMember{}, err
	}
	if target.Role == OrgRoleOwner {
		return db.OrganizationMember{}, errLastOwner()
	}
	if actorID == targetID {
		return db.OrganizationMember{}, coded(http.StatusBadRequest, "cannot_change_own_role", "không thể tự đổi vai trò của mình")
	}
	if target.Role == role {
		return target, nil
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.OrganizationMember{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	updated, err := q.UpdateOrganizationMemberRole(ctx, db.UpdateOrganizationMemberRoleParams{
		OrganizationID: orgID, UserID: targetID, Role: role,
	})
	if err != nil {
		return db.OrganizationMember{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID,
		Actor:          audit.User(actorID),
		Action:         audit.ActionMemberRoleChanged,
		ResourceType:   "organization_member", ResourceID: targetID,
		Changes: audit.Diff(map[string]any{"role": target.Role}, map[string]any{"role": role}),
	}, audit.Event{Topic: "member.role_changed", Payload: map[string]string{
		"organization_id": orgID, "user_id": targetID,
	}}); err != nil {
		return db.OrganizationMember{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.OrganizationMember{}, err
	}
	return updated, nil
}

// Deactivate closes the organization to a member without erasing them. Their
// workspace rows and authored content stay; every membership gate refuses
// them from the next request on. The seat goes back to the plan
// (OPEN_QUESTIONS P1), and their sessions end only if this was the last
// organization they could still enter.
func (s *OrganizationMemberService) Deactivate(ctx context.Context, actorID, orgID, targetID string) (db.OrganizationMember, error) {
	actor, err := s.requireAdmin(ctx, orgID, actorID)
	if err != nil {
		return db.OrganizationMember{}, err
	}
	if actorID == targetID {
		return db.OrganizationMember{}, errCannotDeactivateSelf()
	}
	target, err := s.member(ctx, orgID, targetID)
	if err != nil {
		return db.OrganizationMember{}, err
	}
	if target.Role == OrgRoleOwner {
		return db.OrganizationMember{}, errLastOwner()
	}
	// OPEN_QUESTIONS P6: an admin cannot switch off a peer, only the owner can.
	if target.Role == OrgRoleAdmin && actor.Role != OrgRoleOwner {
		return db.OrganizationMember{}, ErrForbidden
	}
	if target.DeactivatedAt.Valid {
		return target, nil
	}
	othersLeft, err := s.q.CountActiveOrganizationsForUser(ctx, db.CountActiveOrganizationsForUserParams{
		UserID: targetID, OrganizationID: orgID,
	})
	if err != nil {
		return db.OrganizationMember{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.OrganizationMember{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	updated, err := q.SetOrganizationMemberDeactivated(ctx, db.SetOrganizationMemberDeactivatedParams{
		OrganizationID: orgID, UserID: targetID,
		DeactivatedBy: pgtype.Text{String: actorID, Valid: true},
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.OrganizationMember{}, ErrConflict
	}
	if err != nil {
		return db.OrganizationMember{}, err
	}
	if err := s.ent.RecordUsage(ctx, q, ConsumeInput{
		OrganizationID: orgID, Meter: FeatureMembersMax, Delta: -1, Actor: Human(actorID),
	}); err != nil {
		return db.OrganizationMember{}, err
	}
	// Sessions are per user, not per organization: revoking them while the
	// person still belongs somewhere else would sign them out of a tenant that
	// never asked for it.
	if othersLeft == 0 {
		if err := q.RevokeAllRefreshTokensForUser(ctx, targetID); err != nil {
			return db.OrganizationMember{}, err
		}
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID,
		Actor:          audit.User(actorID),
		Action:         audit.ActionMemberDeactivated,
		ResourceType:   "organization_member", ResourceID: targetID,
		Changes:  audit.Diff(map[string]any{"status": MemberStatusActive}, map[string]any{"status": MemberStatusDeactivated}),
		Metadata: map[string]any{"sessions_revoked": othersLeft == 0},
	}, audit.Event{Topic: "member.deactivated", Payload: map[string]string{
		"organization_id": orgID, "user_id": targetID,
	}}); err != nil {
		return db.OrganizationMember{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.OrganizationMember{}, err
	}
	return updated, nil
}

// Reactivate lets a deactivated member back in, and takes a seat back from the
// plan before it does — otherwise an organization over its limit could grow by
// switching people off and on.
func (s *OrganizationMemberService) Reactivate(ctx context.Context, actorID, orgID, targetID string) (db.OrganizationMember, error) {
	actor, err := s.requireAdmin(ctx, orgID, actorID)
	if err != nil {
		return db.OrganizationMember{}, err
	}
	target, err := s.member(ctx, orgID, targetID)
	if err != nil {
		return db.OrganizationMember{}, err
	}
	if !target.DeactivatedAt.Valid {
		return target, nil
	}
	if target.Role == OrgRoleAdmin && actor.Role != OrgRoleOwner {
		return db.OrganizationMember{}, ErrForbidden
	}
	if err := s.ent.CheckQuota(ctx, orgID, FeatureMembersMax, 1); err != nil {
		return db.OrganizationMember{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.OrganizationMember{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	updated, err := q.ClearOrganizationMemberDeactivated(ctx, db.ClearOrganizationMemberDeactivatedParams{
		OrganizationID: orgID, UserID: targetID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.OrganizationMember{}, ErrConflict
	}
	if err != nil {
		return db.OrganizationMember{}, err
	}
	if err := s.ent.Consume(ctx, q, ConsumeInput{
		OrganizationID: orgID, Meter: FeatureMembersMax, Delta: 1, Actor: Human(actorID),
	}); err != nil {
		return db.OrganizationMember{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID,
		Actor:          audit.User(actorID),
		Action:         audit.ActionMemberReactivated,
		ResourceType:   "organization_member", ResourceID: targetID,
		Changes: audit.Diff(map[string]any{"status": MemberStatusDeactivated}, map[string]any{"status": MemberStatusActive}),
	}, audit.Event{Topic: "member.reactivated", Payload: map[string]string{
		"organization_id": orgID, "user_id": targetID,
	}}); err != nil {
		return db.OrganizationMember{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.OrganizationMember{}, err
	}
	return updated, nil
}

// Leave is the voluntary exit, so it removes rather than deactivates: the
// organization row and every workspace row inside it go in one transaction.
// The owner cannot leave — they hand the organization over first.
func (s *OrganizationMemberService) Leave(ctx context.Context, actorID, orgID string) error {
	m, err := s.orgs.RequireMember(ctx, orgID, actorID)
	if err != nil {
		return err
	}
	if m.Role == OrgRoleOwner {
		return errLastOwner()
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	if err := q.DeleteWorkspaceMembershipsInOrg(ctx, db.DeleteWorkspaceMembershipsInOrgParams{
		OrganizationID: orgID, UserID: actorID,
	}); err != nil {
		return err
	}
	if err := q.DeleteOrganizationMember(ctx, db.DeleteOrganizationMemberParams{
		OrganizationID: orgID, UserID: actorID,
	}); err != nil {
		return err
	}
	if err := s.ent.RecordUsage(ctx, q, ConsumeInput{
		OrganizationID: orgID, Meter: FeatureMembersMax, Delta: -1, Actor: Human(actorID),
	}); err != nil {
		return err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID,
		Actor:          audit.User(actorID),
		Action:         audit.ActionMemberLeft,
		ResourceType:   "organization_member", ResourceID: actorID,
		Changes: audit.Diff(map[string]any{"role": m.Role}, nil),
	}, audit.Event{Topic: "member.left", Payload: map[string]string{
		"organization_id": orgID, "user_id": actorID,
	}}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// requireAdmin is the gate every administrative command starts with.
func (s *OrganizationMemberService) requireAdmin(ctx context.Context, orgID, actorID string) (db.OrganizationMember, error) {
	m, err := s.orgs.RequireMember(ctx, orgID, actorID)
	if err != nil {
		return db.OrganizationMember{}, err
	}
	if m.Role != OrgRoleOwner && m.Role != OrgRoleAdmin {
		return db.OrganizationMember{}, ErrForbidden
	}
	return m, nil
}

// member reads a target row without the deactivated check RequireMember
// applies: administering a deactivated person is the whole point of
// reactivation.
func (s *OrganizationMemberService) member(ctx context.Context, orgID, userID string) (db.OrganizationMember, error) {
	row, err := s.q.GetOrganizationMember(ctx, db.GetOrganizationMemberParams{OrganizationID: orgID, UserID: userID})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.OrganizationMember{}, ErrNotFound
	}
	if err != nil {
		return db.OrganizationMember{}, err
	}
	return db.OrganizationMember{
		OrganizationID: row.OrganizationID, UserID: row.UserID, Role: row.Role,
		CreatedAt: row.CreatedAt, DeactivatedAt: row.DeactivatedAt,
		DeactivatedBy: row.DeactivatedBy, InvitedBy: row.InvitedBy, UpdatedAt: row.UpdatedAt,
	}, nil
}
