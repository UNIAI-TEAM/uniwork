package service

import (
	"context"
	"errors"
	netmail "net/mail"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/telemetry"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// inviteTTL is both the invitation row's expiry and the number the mail quotes.
const inviteTTL = 7 * 24 * time.Hour

const maxInviteBatch = 50

// WorkspaceView = workspace + định danh org, đủ cho FE dựng URL /{org}/{ws}.
type WorkspaceView struct {
	db.Workspace
	OrganizationSlug string
	OrganizationName string
}

type WorkspaceService struct {
	pool   *pgxpool.Pool
	q      *db.Queries
	orgs   *OrganizationService
	render mail.Renderer
	out    mail.Enqueuer
	// ent is the quota gate (F-02). Built here rather than injected so there
	// is no nil path that skips the gate.
	ent *EntitlementService
}

func NewWorkspaceService(pool *pgxpool.Pool, q *db.Queries, orgs *OrganizationService, r mail.Renderer, out mail.Enqueuer) *WorkspaceService {
	return &WorkspaceService{pool: pool, q: q, orgs: orgs, render: r, out: out, ent: NewEntitlementService(pool, q)}
}

func viewFromInOrgRow(r db.ListWorkspacesInOrgRow) WorkspaceView {
	return WorkspaceView{Workspace: db.Workspace{ID: r.ID, OrganizationID: r.OrganizationID, Slug: r.Slug, Name: r.Name,
		CreatedBy: r.CreatedBy, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt},
		OrganizationSlug: r.OrganizationSlug, OrganizationName: r.OrganizationName}
}

func (s *WorkspaceService) CreateInOrg(ctx context.Context, userID, orgID, name, slug string) (WorkspaceView, error) {
	if _, err := s.orgs.RequireMember(ctx, orgID, userID); err != nil {
		return WorkspaceView{}, err
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return WorkspaceView{}, Invalid("tên workspace không được để trống")
	}
	if err := ValidateSlug(slug); err != nil {
		return WorkspaceView{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return WorkspaceView{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	// workspaces.max: refused here means the workspace row below is never
	// written (spec F-02 §4.3).
	if err := s.ent.Consume(ctx, q, ConsumeInput{OrganizationID: orgID, Meter: FeatureWorkspacesMax, Delta: 1, Actor: Human(userID)}); err != nil {
		return WorkspaceView{}, err
	}
	w, err := q.CreateWorkspace(ctx, db.CreateWorkspaceParams{
		ID: util.NewID(), OrganizationID: orgID, Slug: slug, Name: name, CreatedBy: userID,
	})
	if isUniqueViolation(err) {
		return WorkspaceView{}, ErrConflict
	}
	if err != nil {
		return WorkspaceView{}, err
	}
	if err := q.AddWorkspaceMember(ctx, db.AddWorkspaceMemberParams{WorkspaceID: w.ID, UserID: userID, Role: "owner"}); err != nil {
		return WorkspaceView{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID, WorkspaceID: w.ID,
		Actor:        audit.User(userID),
		Action:       audit.ActionWorkspaceCreated,
		ResourceType: "workspace", ResourceID: w.ID,
		Changes: audit.Diff(nil, map[string]any{"name": w.Name, "slug": w.Slug}),
	}, audit.Event{Topic: "workspace.created", Payload: map[string]string{
		"workspace_id": w.ID, "organization_id": orgID,
	}}); err != nil {
		return WorkspaceView{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID, WorkspaceID: w.ID,
		Actor:        audit.User(userID),
		Action:       audit.ActionWorkspaceMemberAdded,
		ResourceType: "workspace_member", ResourceID: userID,
		Changes: audit.Diff(nil, map[string]any{"role": "owner"}),
	}, audit.Event{Topic: "member.joined", Payload: map[string]string{
		"organization_id": orgID, "workspace_id": w.ID, "user_id": userID,
	}}); err != nil {
		return WorkspaceView{}, err
	}
	// The organization's active agents join every new workspace so a task can
	// be handed to UNI from the first day (OPEN_QUESTIONS AG6). Admins can
	// pause an agent to stop this.
	agents, err := q.ListActiveAgentsInOrg(ctx, orgID)
	if err != nil {
		return WorkspaceView{}, err
	}
	for _, a := range agents {
		if err := addAgentToWorkspace(ctx, q, w, a.ID, audit.System("workspace.created")); err != nil {
			return WorkspaceView{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return WorkspaceView{}, err
	}
	return s.GetView(ctx, userID, w.ID)
}

func (s *WorkspaceService) GetView(ctx context.Context, userID, workspaceID string) (WorkspaceView, error) {
	if _, err := s.RequireMember(ctx, workspaceID, userID); err != nil {
		return WorkspaceView{}, err
	}
	r, err := s.q.GetWorkspaceWithOrg(ctx, workspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return WorkspaceView{}, ErrNotFound
	}
	if err != nil {
		return WorkspaceView{}, err
	}
	return viewFromInOrgRow(db.ListWorkspacesInOrgRow(r)), nil
}

func (s *WorkspaceService) ListForUser(ctx context.Context, userID string) ([]WorkspaceView, error) {
	rows, err := s.q.ListWorkspacesForUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	out := make([]WorkspaceView, 0, len(rows))
	for _, r := range rows {
		out = append(out, viewFromInOrgRow(db.ListWorkspacesInOrgRow(r)))
	}
	return out, nil
}

// ResolveSlugs maps the URL pair to a workspace id WITHOUT a membership check.
// It exists for the WebSocket upgrade, which resolves the workspace before it
// has authenticated the caller and checks membership immediately after; every
// HTTP path keeps using GetBySlugs, which does both.
func (s *WorkspaceService) ResolveSlugs(ctx context.Context, orgSlug, wsSlug string) (string, error) {
	r, err := s.q.GetWorkspaceBySlugs(ctx, db.GetWorkspaceBySlugsParams{Slug: orgSlug, Slug_2: wsSlug})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	return r.ID, nil
}

func (s *WorkspaceService) GetBySlugs(ctx context.Context, userID, orgSlug, wsSlug string) (WorkspaceView, error) {
	r, err := s.q.GetWorkspaceBySlugs(ctx, db.GetWorkspaceBySlugsParams{Slug: orgSlug, Slug_2: wsSlug})
	if errors.Is(err, pgx.ErrNoRows) {
		return WorkspaceView{}, ErrNotFound
	}
	if err != nil {
		return WorkspaceView{}, err
	}
	if _, err := s.RequireMember(ctx, r.ID, userID); err != nil {
		// A suspended tenant answers its own members honestly (they already
		// know it exists); everything else is 404 so nothing leaks.
		if errors.Is(err, ErrOrganizationSuspended) {
			return WorkspaceView{}, err
		}
		return WorkspaceView{}, ErrNotFound // không lộ sự tồn tại
	}
	return viewFromInOrgRow(db.ListWorkspacesInOrgRow(r)), nil
}

// RequireMember: quyền workspace = dòng workspace_members HOẶC owner/admin của
// org chứa workspace (khi đó role hiệu lực là "admin"). Đây là nơi DUY NHẤT
// quyết định quyền workspace — service khác không tự query workspace_members.
func (s *WorkspaceService) RequireMember(ctx context.Context, workspaceID, userID string) (db.WorkspaceMember, error) {
	access, err := s.q.GetWorkspaceAccess(ctx, db.GetWorkspaceAccessParams{ID: workspaceID, UserID: userID})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && access.Role == "") {
		return db.WorkspaceMember{}, ErrForbidden
	}
	if err != nil {
		return db.WorkspaceMember{}, err
	}
	// A suspended tenant is closed to its members on every route (F-11 §4);
	// platform admins reach it through /api/v1/admin, which never comes here.
	if access.OrganizationStatus != OrganizationActive {
		return db.WorkspaceMember{}, errOrganizationSuspended()
	}
	// The one place every workspace request passes through, so the span and
	// the log lines of this request learn their tenant here (spec F-11 §6.1).
	telemetry.SetTenant(ctx, access.OrganizationID, workspaceID)
	return db.WorkspaceMember{WorkspaceID: workspaceID, UserID: userID, Role: access.Role}, nil
}

// RequireAgentMember is the agent counterpart of RequireMember: an agent is
// in a workspace only through its own workspace_agent_members row, never
// implicitly through the organization.
func (s *WorkspaceService) RequireAgentMember(ctx context.Context, workspaceID, agentID string) (db.WorkspaceAgentMember, error) {
	m, err := s.q.GetWorkspaceAgentMember(ctx, db.GetWorkspaceAgentMemberParams{WorkspaceID: workspaceID, AgentID: agentID})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.WorkspaceAgentMember{}, ErrForbidden
	}
	return m, err
}

// requireActorMember routes a command's actor to the right membership gate.
func (s *WorkspaceService) requireActorMember(ctx context.Context, workspaceID string, actor Actor) error {
	switch actor.Kind {
	case audit.KindHuman:
		_, err := s.RequireMember(ctx, workspaceID, actor.ID)
		return err
	case audit.KindAgent:
		_, err := s.RequireAgentMember(ctx, workspaceID, actor.ID)
		return err
	default:
		return ErrForbidden
	}
}

type UpdateWorkspaceInput struct {
	Name *string
}

const maxWorkspaceNameRunes = 100

// Update changes workspace settings the caller is allowed to edit. v1: name only.
func (s *WorkspaceService) Update(ctx context.Context, userID, workspaceID string, in UpdateWorkspaceInput) (WorkspaceView, error) {
	m, err := s.RequireMember(ctx, workspaceID, userID)
	if err != nil {
		return WorkspaceView{}, err
	}
	if m.Role != "owner" && m.Role != "admin" {
		return WorkspaceView{}, ErrForbidden
	}
	if in.Name == nil {
		return WorkspaceView{}, Invalid("name is required")
	}
	name := strings.TrimSpace(*in.Name)
	if name == "" {
		return WorkspaceView{}, Invalid("tên workspace không được để trống")
	}
	if utf8.RuneCountInString(name) > maxWorkspaceNameRunes {
		return WorkspaceView{}, Invalid("tên workspace quá dài")
	}
	before, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return WorkspaceView{}, ErrNotFound
	}
	if err != nil {
		return WorkspaceView{}, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return WorkspaceView{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	if _, err := q.UpdateWorkspaceName(ctx, db.UpdateWorkspaceNameParams{ID: workspaceID, Name: name}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return WorkspaceView{}, ErrNotFound
		}
		return WorkspaceView{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: before.OrganizationID, WorkspaceID: workspaceID,
		Actor:        audit.User(userID),
		Action:       audit.ActionWorkspaceUpdated,
		ResourceType: "workspace", ResourceID: workspaceID,
		Changes: audit.Diff(map[string]any{"name": before.Name}, map[string]any{"name": name}),
	}, audit.Event{Topic: "workspace.updated", Payload: map[string]string{
		"workspace_id": workspaceID, "organization_id": before.OrganizationID,
	}}); err != nil {
		return WorkspaceView{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return WorkspaceView{}, err
	}
	return s.GetView(ctx, userID, workspaceID)
}

func (s *WorkspaceService) Members(ctx context.Context, userID, workspaceID string) ([]db.ListWorkspaceMembersRow, error) {
	if _, err := s.RequireMember(ctx, workspaceID, userID); err != nil {
		return nil, err
	}
	return s.q.ListWorkspaceMembers(ctx, workspaceID)
}

const (
	MembershipSourceMembership MembershipSource = "membership"
	MembershipSourceOrgAdmin   MembershipSource = "org_admin"
)

// MembershipSource distinguishes an explicit workspace_members row from an
// org owner/admin who only has effective access via GetWorkspaceAccess.
type MembershipSource string

// CurrentMembership is the caller's effective workspace role and how it was derived.
type CurrentMembership struct {
	UserID string
	Role   string
	Source MembershipSource
}

func (s *WorkspaceService) CurrentMembership(ctx context.Context, userID, workspaceID string) (CurrentMembership, error) {
	eff, err := s.RequireMember(ctx, workspaceID, userID)
	if err != nil {
		return CurrentMembership{}, err
	}
	_, err = s.q.GetWorkspaceMember(ctx, db.GetWorkspaceMemberParams{
		WorkspaceID: workspaceID, UserID: userID,
	})
	source := MembershipSourceOrgAdmin
	if err == nil {
		source = MembershipSourceMembership
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return CurrentMembership{}, err
	}
	return CurrentMembership{UserID: userID, Role: eff.Role, Source: source}, nil
}

func adminLikeRole(role string) bool {
	return role == "owner" || role == "admin"
}

// UpdateMemberRole changes a non-owner member's role to admin or member.
func (s *WorkspaceService) UpdateMemberRole(ctx context.Context, actorID, workspaceID, targetUserID, role string) (db.WorkspaceMember, error) {
	actor, err := s.RequireMember(ctx, workspaceID, actorID)
	if err != nil {
		return db.WorkspaceMember{}, err
	}
	if !adminLikeRole(actor.Role) {
		return db.WorkspaceMember{}, ErrForbidden
	}
	if role != "admin" && role != "member" {
		return db.WorkspaceMember{}, Invalid("role phải là admin hoặc member")
	}
	target, err := s.q.GetWorkspaceMember(ctx, db.GetWorkspaceMemberParams{
		WorkspaceID: workspaceID, UserID: targetUserID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.WorkspaceMember{}, ErrNotFound
	}
	if err != nil {
		return db.WorkspaceMember{}, err
	}
	if target.Role == "owner" {
		return db.WorkspaceMember{}, ErrForbidden
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return db.WorkspaceMember{}, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.WorkspaceMember{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	updated, err := q.UpdateWorkspaceMemberRole(ctx, db.UpdateWorkspaceMemberRoleParams{
		WorkspaceID: workspaceID, UserID: targetUserID, Role: role,
	})
	if err != nil {
		return db.WorkspaceMember{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		Actor:        audit.User(actorID),
		Action:       audit.ActionWorkspaceMemberRoleChanged,
		ResourceType: "workspace_member", ResourceID: targetUserID,
		Changes: audit.Diff(map[string]any{"role": target.Role}, map[string]any{"role": role}),
	}, audit.Event{Topic: "member.role_changed", Payload: map[string]string{
		"organization_id": ws.OrganizationID, "workspace_id": workspaceID, "user_id": targetUserID,
	}}); err != nil {
		return db.WorkspaceMember{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.WorkspaceMember{}, err
	}
	return updated, nil
}

// RemoveMember deletes an explicit workspace_members row. Explicit owners cannot
// be removed. Any effective member may leave themselves; otherwise the actor
// must be admin-like.
func (s *WorkspaceService) RemoveMember(ctx context.Context, actorID, workspaceID, targetUserID string) error {
	actor, err := s.RequireMember(ctx, workspaceID, actorID)
	if err != nil {
		return err
	}
	target, err := s.q.GetWorkspaceMember(ctx, db.GetWorkspaceMemberParams{
		WorkspaceID: workspaceID, UserID: targetUserID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if target.Role == "owner" {
		return ErrForbidden
	}
	if actorID != targetUserID && !adminLikeRole(actor.Role) {
		return ErrForbidden
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	if err := q.DeleteWorkspaceMember(ctx, db.DeleteWorkspaceMemberParams{
		WorkspaceID: workspaceID, UserID: targetUserID,
	}); err != nil {
		return err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		Actor:        audit.User(actorID),
		Action:       audit.ActionWorkspaceMemberRemoved,
		ResourceType: "workspace_member", ResourceID: targetUserID,
		Metadata: map[string]any{"role": target.Role, "self_service": actorID == targetUserID},
	}, audit.Event{Topic: "member.removed", Payload: map[string]string{
		"organization_id": ws.OrganizationID, "workspace_id": workspaceID, "user_id": targetUserID,
	}}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// InviteMany: dedupe + lowercase; email sai hoặc đã là thành viên → skipped.
func (s *WorkspaceService) InviteMany(ctx context.Context, userID, workspaceID string, emails []string, role string) ([]db.Invitation, []string, error) {
	m, err := s.RequireMember(ctx, workspaceID, userID)
	if err != nil {
		return nil, nil, err
	}
	if m.Role != "owner" && m.Role != "admin" {
		return nil, nil, ErrForbidden
	}
	if err := requireVerifiedEmail(ctx, s.q, userID); err != nil {
		return nil, nil, err
	}
	if role != "admin" && role != "member" {
		return nil, nil, Invalid("role phải là admin hoặc member")
	}
	if len(emails) == 0 {
		return nil, nil, Invalid("cần ít nhất một email")
	}
	if len(emails) > maxInviteBatch {
		return nil, nil, Invalid("tối đa 50 email mỗi lần")
	}
	inviter, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return nil, nil, err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return nil, nil, err
	}
	members, err := s.q.ListWorkspaceMembers(ctx, workspaceID)
	if err != nil {
		return nil, nil, err
	}
	isMember := map[string]bool{}
	for _, mm := range members {
		isMember[strings.ToLower(mm.Email)] = true
	}
	seen := map[string]bool{}
	var invs []db.Invitation
	var skipped []string

	// One transaction for the whole batch: an invitation whose mail was never
	// queued, or whose audit row is missing, is worse than the batch failing.
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	for _, raw := range emails {
		email := strings.ToLower(strings.TrimSpace(raw))
		if email == "" || seen[email] {
			continue
		}
		seen[email] = true
		if _, perr := netmail.ParseAddress(email); perr != nil || isMember[email] {
			skipped = append(skipped, email)
			continue
		}
		inv, err := q.CreateInvitation(ctx, db.CreateInvitationParams{
			ID: util.NewID(), WorkspaceID: workspaceID, Email: email, Role: role,
			Token:     util.NewID() + util.NewID(),
			ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(inviteTTL), Valid: true},
		})
		if err != nil {
			return nil, nil, err
		}
		invs = append(invs, inv)
		msg, err := s.render.Invite(email, inviter.Locale, mail.InviteData{
			InviterName: inviter.DisplayName, WorkspaceName: ws.Name,
			AcceptURL: s.render.AppURL + "/invite/" + inv.Token, Expires: inviteTTL,
		})
		if err != nil {
			return nil, nil, err
		}
		if _, err := s.out.Enqueue(ctx, q, msg); err != nil {
			return nil, nil, err
		}
		// The invitee has no user id yet, so the audited resource is the
		// invitation row; the email lives there and stays out of a table that
		// can never be edited.
		if err := auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
			Actor:        audit.User(userID),
			Action:       audit.ActionMemberInvited,
			ResourceType: "invitation", ResourceID: inv.ID,
			Changes: audit.Diff(nil, map[string]any{"role": role}),
		}, audit.Event{Topic: "member.invited", Payload: map[string]string{
			"organization_id": ws.OrganizationID, "workspace_id": workspaceID, "invitation_id": inv.ID,
		}}); err != nil {
			return nil, nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, nil, err
	}
	if len(invs) > 0 {
		s.out.Kick()
	}
	return invs, skipped, nil
}

func (s *WorkspaceService) PendingInvitations(ctx context.Context, userID string) ([]db.ListInvitationsForEmailRow, error) {
	u, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	return s.q.ListInvitationsForEmail(ctx, u.Email)
}

// AcceptInvite: một transaction — org member (nếu chưa) + workspace member +
// đánh dấu lời mời + MarkUserOnboarded. Không bao giờ có trạng thái "là thành
// viên nhưng chưa onboard".
func (s *WorkspaceService) AcceptInvite(ctx context.Context, userID, token string) (WorkspaceView, error) {
	inv, err := s.q.GetInvitationByToken(ctx, token)
	if errors.Is(err, pgx.ErrNoRows) {
		return WorkspaceView{}, ErrNotFound
	}
	if err != nil {
		return WorkspaceView{}, err
	}
	w, err := s.q.GetWorkspaceByID(ctx, inv.WorkspaceID)
	if err != nil {
		return WorkspaceView{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return WorkspaceView{}, err
	}
	defer tx.Rollback(ctx)
	qtx := s.q.WithTx(tx)
	// members.max counts organization members, so only a person new to the
	// organization consumes a seat; an existing member joining another
	// workspace does not (spec F-02 §4.3).
	if _, err := s.orgs.RequireMember(ctx, w.OrganizationID, userID); errors.Is(err, ErrForbidden) {
		if err := s.ent.Consume(ctx, qtx, ConsumeInput{OrganizationID: w.OrganizationID, Meter: FeatureMembersMax, Delta: 1, Actor: Human(userID)}); err != nil {
			return WorkspaceView{}, err
		}
	} else if err != nil {
		return WorkspaceView{}, err
	}
	if err := qtx.AddOrganizationMember(ctx, db.AddOrganizationMemberParams{OrganizationID: w.OrganizationID, UserID: userID, Role: "member"}); err != nil {
		return WorkspaceView{}, err
	}
	joiner, err := qtx.GetUserByID(ctx, userID)
	if err != nil {
		return WorkspaceView{}, err
	}
	if err := ensureMemberProfile(ctx, qtx, w.OrganizationID, userID, joiner.DisplayName, joiner.Email); err != nil {
		return WorkspaceView{}, err
	}
	if err := qtx.AddWorkspaceMember(ctx, db.AddWorkspaceMemberParams{WorkspaceID: w.ID, UserID: userID, Role: inv.Role}); err != nil {
		return WorkspaceView{}, err
	}
	if err := qtx.MarkInvitationAccepted(ctx, inv.ID); err != nil {
		return WorkspaceView{}, err
	}
	if _, err := qtx.MarkUserOnboarded(ctx, userID); err != nil {
		return WorkspaceView{}, err
	}
	if err := auditRecorder.Record(ctx, qtx, audit.Entry{
		OrganizationID: w.OrganizationID, WorkspaceID: w.ID,
		Actor:        audit.User(userID),
		Action:       audit.ActionMemberJoined,
		ResourceType: "workspace_member", ResourceID: userID,
		Changes:  audit.Diff(nil, map[string]any{"role": inv.Role}),
		Metadata: map[string]any{"invitation_id": inv.ID},
	}, audit.Event{Topic: "member.joined", Payload: map[string]string{
		"organization_id": w.OrganizationID, "workspace_id": w.ID, "user_id": userID,
	}}); err != nil {
		return WorkspaceView{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return WorkspaceView{}, err
	}
	return s.GetView(ctx, userID, w.ID)
}

// OrganizationOf names the organization a workspace belongs to. The realtime
// hub uses it to put a connection into its organization scope without the
// client having to say which organization it is in.
func (s *WorkspaceService) OrganizationOf(ctx context.Context, workspaceID string) (string, error) {
	w, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return "", err
	}
	return w.OrganizationID, nil
}
