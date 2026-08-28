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

	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

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
}

func NewWorkspaceService(pool *pgxpool.Pool, q *db.Queries, orgs *OrganizationService, r mail.Renderer, out mail.Enqueuer) *WorkspaceService {
	return &WorkspaceService{pool: pool, q: q, orgs: orgs, render: r, out: out}
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
	w, err := s.q.CreateWorkspace(ctx, db.CreateWorkspaceParams{
		ID: util.NewID(), OrganizationID: orgID, Slug: slug, Name: name, CreatedBy: userID,
	})
	if isUniqueViolation(err) {
		return WorkspaceView{}, ErrConflict
	}
	if err != nil {
		return WorkspaceView{}, err
	}
	if err := s.q.AddWorkspaceMember(ctx, db.AddWorkspaceMemberParams{WorkspaceID: w.ID, UserID: userID, Role: "owner"}); err != nil {
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
		return WorkspaceView{}, ErrNotFound // không lộ sự tồn tại
	}
	return viewFromInOrgRow(db.ListWorkspacesInOrgRow(r)), nil
}

// RequireMember: quyền workspace = dòng workspace_members HOẶC owner/admin của
// org chứa workspace (khi đó role hiệu lực là "admin"). Đây là nơi DUY NHẤT
// quyết định quyền workspace — service khác không tự query workspace_members.
func (s *WorkspaceService) RequireMember(ctx context.Context, workspaceID, userID string) (db.WorkspaceMember, error) {
	role, err := s.q.GetWorkspaceAccess(ctx, db.GetWorkspaceAccessParams{ID: workspaceID, UserID: userID})
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && role == "") {
		return db.WorkspaceMember{}, ErrForbidden
	}
	if err != nil {
		return db.WorkspaceMember{}, err
	}
	return db.WorkspaceMember{WorkspaceID: workspaceID, UserID: userID, Role: role}, nil
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
	if _, err := s.q.UpdateWorkspaceName(ctx, db.UpdateWorkspaceNameParams{ID: workspaceID, Name: name}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return WorkspaceView{}, ErrNotFound
		}
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
	return s.q.UpdateWorkspaceMemberRole(ctx, db.UpdateWorkspaceMemberRoleParams{
		WorkspaceID: workspaceID, UserID: targetUserID, Role: role,
	})
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
	return s.q.DeleteWorkspaceMember(ctx, db.DeleteWorkspaceMemberParams{
		WorkspaceID: workspaceID, UserID: targetUserID,
	})
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
		inv, err := s.q.CreateInvitation(ctx, db.CreateInvitationParams{
			ID: util.NewID(), WorkspaceID: workspaceID, Email: email, Role: role,
			Token:     util.NewID() + util.NewID(),
			ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(7 * 24 * time.Hour), Valid: true},
		})
		if err != nil {
			return nil, nil, err
		}
		invs = append(invs, inv)
		msg, err := s.render.Invite(email, inviter.Locale, mail.InviteData{
			InviterName: inviter.DisplayName, WorkspaceName: ws.Name,
			AcceptURL: s.render.AppURL + "/invite/" + inv.Token, ExpiresInDays: 7,
		})
		if err != nil {
			return nil, nil, err
		}
		if _, err := s.out.Enqueue(ctx, s.q, msg); err != nil {
			return nil, nil, err
		}
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
	if err := qtx.AddOrganizationMember(ctx, db.AddOrganizationMemberParams{OrganizationID: w.OrganizationID, UserID: userID, Role: "member"}); err != nil {
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
	if err := tx.Commit(ctx); err != nil {
		return WorkspaceView{}, err
	}
	return s.GetView(ctx, userID, w.ID)
}
