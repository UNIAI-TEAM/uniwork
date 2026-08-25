package service

import (
	"context"
	"errors"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

var slugRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$`)

type WorkspaceService struct {
	q *db.Queries
}

func NewWorkspaceService(q *db.Queries) *WorkspaceService {
	return &WorkspaceService{q: q}
}

func (s *WorkspaceService) Create(ctx context.Context, userID, name, slug string) (db.Workspace, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return db.Workspace{}, Invalid("tên workspace không được để trống")
	}
	if !slugRe.MatchString(slug) {
		return db.Workspace{}, Invalid("slug chỉ gồm a-z, 0-9 và dấu gạch ngang (3-40 ký tự)")
	}
	w, err := s.q.CreateWorkspace(ctx, db.CreateWorkspaceParams{
		ID: util.NewID(), Slug: slug, Name: name, CreatedBy: userID,
	})
	if isUniqueViolation(err) {
		return db.Workspace{}, ErrConflict
	}
	if err != nil {
		return db.Workspace{}, err
	}
	if err := s.q.AddWorkspaceMember(ctx, db.AddWorkspaceMemberParams{
		WorkspaceID: w.ID, UserID: userID, Role: "owner",
	}); err != nil {
		return db.Workspace{}, err
	}
	return w, nil
}

func (s *WorkspaceService) ListForUser(ctx context.Context, userID string) ([]db.Workspace, error) {
	return s.q.ListWorkspacesForUser(ctx, userID)
}

func (s *WorkspaceService) GetBySlug(ctx context.Context, userID, slug string) (db.Workspace, error) {
	w, err := s.q.GetWorkspaceBySlug(ctx, slug)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Workspace{}, ErrNotFound
	}
	if err != nil {
		return db.Workspace{}, err
	}
	if _, err := s.RequireMember(ctx, w.ID, userID); err != nil {
		return db.Workspace{}, ErrNotFound // không lộ sự tồn tại của workspace
	}
	return w, nil
}

func (s *WorkspaceService) RequireMember(ctx context.Context, workspaceID, userID string) (db.WorkspaceMember, error) {
	m, err := s.q.GetWorkspaceMember(ctx, db.GetWorkspaceMemberParams{
		WorkspaceID: workspaceID, UserID: userID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.WorkspaceMember{}, ErrForbidden
	}
	return m, err
}

func (s *WorkspaceService) Members(ctx context.Context, userID, workspaceID string) ([]db.ListWorkspaceMembersRow, error) {
	if _, err := s.RequireMember(ctx, workspaceID, userID); err != nil {
		return nil, err
	}
	return s.q.ListWorkspaceMembers(ctx, workspaceID)
}

func (s *WorkspaceService) Invite(ctx context.Context, userID, workspaceID, email, role string) (db.Invitation, error) {
	m, err := s.RequireMember(ctx, workspaceID, userID)
	if err != nil {
		return db.Invitation{}, err
	}
	if m.Role != "owner" && m.Role != "admin" {
		return db.Invitation{}, ErrForbidden
	}
	if role != "admin" && role != "member" {
		return db.Invitation{}, Invalid("role phải là admin hoặc member")
	}
	email = strings.ToLower(strings.TrimSpace(email))
	if !strings.Contains(email, "@") {
		return db.Invitation{}, Invalid("email không hợp lệ")
	}
	return s.q.CreateInvitation(ctx, db.CreateInvitationParams{
		ID: util.NewID(), WorkspaceID: workspaceID, Email: email, Role: role,
		Token:     util.NewID() + util.NewID(),
		ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(7 * 24 * time.Hour), Valid: true},
	})
}

func (s *WorkspaceService) AcceptInvite(ctx context.Context, userID, token string) (db.Workspace, error) {
	inv, err := s.q.GetInvitationByToken(ctx, token)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Workspace{}, ErrNotFound
	}
	if err != nil {
		return db.Workspace{}, err
	}
	if err := s.q.AddWorkspaceMember(ctx, db.AddWorkspaceMemberParams{
		WorkspaceID: inv.WorkspaceID, UserID: userID, Role: inv.Role,
	}); err != nil {
		return db.Workspace{}, err
	}
	if err := s.q.MarkInvitationAccepted(ctx, inv.ID); err != nil {
		return db.Workspace{}, err
	}
	return s.q.GetWorkspaceByID(ctx, inv.WorkspaceID)
}
