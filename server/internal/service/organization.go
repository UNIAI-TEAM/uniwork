package service

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type OrganizationService struct {
	q *db.Queries
}

func NewOrganizationService(q *db.Queries) *OrganizationService {
	return &OrganizationService{q: q}
}

func (s *OrganizationService) Create(ctx context.Context, userID, name, slug string) (db.Organization, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return db.Organization{}, Invalid("tên tổ chức không được để trống")
	}
	if err := ValidateSlug(slug); err != nil {
		return db.Organization{}, err
	}
	o, err := s.q.CreateOrganization(ctx, db.CreateOrganizationParams{
		ID: util.NewID(), Slug: slug, Name: name, CreatedBy: userID,
	})
	if isUniqueViolation(err) {
		return db.Organization{}, ErrConflict
	}
	if err != nil {
		return db.Organization{}, err
	}
	if err := s.q.AddOrganizationMember(ctx, db.AddOrganizationMemberParams{
		OrganizationID: o.ID, UserID: userID, Role: "owner",
	}); err != nil {
		return db.Organization{}, err
	}
	return o, nil
}

func (s *OrganizationService) ListForUser(ctx context.Context, userID string) ([]db.ListOrganizationsForUserRow, error) {
	return s.q.ListOrganizationsForUser(ctx, userID)
}

func (s *OrganizationService) RequireMember(ctx context.Context, orgID, userID string) (db.OrganizationMember, error) {
	m, err := s.q.GetOrganizationMember(ctx, db.GetOrganizationMemberParams{OrganizationID: orgID, UserID: userID})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.OrganizationMember{}, ErrForbidden
	}
	return m, err
}

func (s *OrganizationService) GetBySlug(ctx context.Context, userID, slug string) (db.Organization, db.OrganizationMember, error) {
	o, err := s.q.GetOrganizationBySlug(ctx, slug)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Organization{}, db.OrganizationMember{}, ErrNotFound
	}
	if err != nil {
		return db.Organization{}, db.OrganizationMember{}, err
	}
	m, err := s.RequireMember(ctx, o.ID, userID)
	if err != nil {
		return db.Organization{}, db.OrganizationMember{}, ErrNotFound // không lộ sự tồn tại
	}
	return o, m, nil
}

// ListWorkspaces: owner/admin thấy mọi workspace của org; member chỉ thấy
// workspace mình thuộc.
func (s *OrganizationService) ListWorkspaces(ctx context.Context, userID, orgID string) ([]db.ListWorkspacesInOrgRow, error) {
	m, err := s.RequireMember(ctx, orgID, userID)
	if err != nil {
		return nil, err
	}
	if m.Role == "owner" || m.Role == "admin" {
		return s.q.ListWorkspacesInOrg(ctx, orgID)
	}
	rows, err := s.q.ListMemberWorkspacesInOrg(ctx, db.ListMemberWorkspacesInOrgParams{OrganizationID: orgID, UserID: userID})
	if err != nil {
		return nil, err
	}
	out := make([]db.ListWorkspacesInOrgRow, 0, len(rows))
	for _, r := range rows {
		out = append(out, db.ListWorkspacesInOrgRow(r))
	}
	return out, nil
}
