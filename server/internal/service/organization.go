package service

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type OrganizationService struct {
	pool *pgxpool.Pool
	q    *db.Queries
}

func NewOrganizationService(pool *pgxpool.Pool, q *db.Queries) *OrganizationService {
	return &OrganizationService{pool: pool, q: q}
}

func (s *OrganizationService) Create(ctx context.Context, userID, name, slug string) (db.Organization, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return db.Organization{}, Invalid("tên tổ chức không được để trống")
	}
	if err := ValidateSlug(slug); err != nil {
		return db.Organization{}, err
	}
	if err := requireVerifiedEmail(ctx, s.q, userID); err != nil {
		return db.Organization{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.Organization{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	o, err := q.CreateOrganization(ctx, db.CreateOrganizationParams{
		ID: util.NewID(), Slug: slug, Name: name, CreatedBy: userID,
	})
	if isUniqueViolation(err) {
		return db.Organization{}, ErrConflict
	}
	if err != nil {
		return db.Organization{}, err
	}
	if err := q.AddOrganizationMember(ctx, db.AddOrganizationMemberParams{
		OrganizationID: o.ID, UserID: userID, Role: "owner",
	}); err != nil {
		return db.Organization{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: o.ID,
		Actor:          audit.User(userID),
		Action:         audit.ActionOrganizationCreated,
		ResourceType:   "organization", ResourceID: o.ID,
		Changes: audit.Diff(nil, map[string]any{"name": o.Name, "slug": o.Slug}),
	}, audit.Event{
		Topic:   "organization.created",
		Payload: map[string]string{"organization_id": o.ID, "user_id": userID},
	}); err != nil {
		return db.Organization{}, err
	}
	// The founder is an owner from this moment; record the membership as its
	// own action so the member.* timeline is complete from row one.
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: o.ID,
		Actor:          audit.User(userID),
		Action:         audit.ActionMemberJoined,
		ResourceType:   "organization_member", ResourceID: userID,
		Changes: audit.Diff(nil, map[string]any{"role": "owner"}),
	}, audit.Event{
		Topic:   "member.joined",
		Payload: map[string]string{"organization_id": o.ID, "user_id": userID},
	}); err != nil {
		return db.Organization{}, err
	}
	// Every organization is on the default plan from its first transaction;
	// the entitlement gate has nothing to fall back on otherwise (F-02).
	if _, err := createDefaultSubscription(ctx, q, o.ID, audit.System("organization.created")); err != nil {
		return db.Organization{}, err
	}
	// Every organization starts with its built-in agent (OPEN_QUESTIONS AG6);
	// the founder is its owner and can rename it.
	if _, err := createAgent(ctx, q, o.ID, "UNI", DefaultAgentHandle,
		"Đồng nghiệp AI mặc định của tổ chức", nil, userID, audit.System("organization.created")); err != nil {
		return db.Organization{}, err
	}
	if err := tx.Commit(ctx); err != nil {
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
	if err != nil {
		return db.OrganizationMember{}, err
	}
	if m.OrganizationStatus != OrganizationActive {
		return db.OrganizationMember{}, errOrganizationSuspended()
	}
	// A deactivated member is refused here, so every gate that goes through
	// this one — WorkspaceService.RequireMember included — refuses too, and no
	// caller has to remember the check (spec F-03 §4.1).
	if m.DeactivatedAt.Valid {
		return db.OrganizationMember{}, errMemberDeactivated()
	}
	return db.OrganizationMember{
		OrganizationID: m.OrganizationID, UserID: m.UserID, Role: m.Role,
		CreatedAt: m.CreatedAt, DeactivatedAt: m.DeactivatedAt,
		DeactivatedBy: m.DeactivatedBy, InvitedBy: m.InvitedBy, UpdatedAt: m.UpdatedAt,
	}, nil
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
	// A deactivated member already knows this organization exists, so they get
	// the honest answer and the client can show the blocked screen; everyone
	// else gets 404 rather than a hint that the slug is taken.
	if errors.Is(err, ErrMemberDeactivated) || errors.Is(err, ErrOrganizationSuspended) {
		return db.Organization{}, db.OrganizationMember{}, err
	}
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
