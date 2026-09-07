package service

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// A department may have a parent, and that parent may not: two levels is what a
// 1,000-person company needs and what a picker can show without turning into a
// tree widget (OPEN_QUESTIONS P4). resolveParent is where the rule lives.
func errDepartmentDepth() error {
	return coded(http.StatusBadRequest, "department_depth_exceeded", "phòng ban chỉ được lồng tối đa 2 cấp")
}

func errDepartmentHasChildren() error {
	return coded(http.StatusConflict, "department_has_children", "phòng ban còn phòng ban con; lưu trữ các phòng con trước")
}

// DepartmentService owns the organization's structure: a shallow tree of
// departments and which of them a person belongs to.
type DepartmentService struct {
	pool *pgxpool.Pool
	q    *db.Queries
	orgs *OrganizationService
}

func NewDepartmentService(pool *pgxpool.Pool, q *db.Queries, orgs *OrganizationService) *DepartmentService {
	return &DepartmentService{pool: pool, q: q, orgs: orgs}
}

// DepartmentInput is a partial write; nil leaves the column as it was.
type DepartmentInput struct {
	Name       *string
	Code       *string
	ParentID   *string
	HeadUserID *string
}

// List returns the whole tree flat, with parent_id and a live member count.
// Every member may read it: the picker needs it and it carries no content.
func (s *DepartmentService) List(ctx context.Context, actorID, orgID string, includeArchived bool) ([]db.ListDepartmentsRow, error) {
	if _, err := s.orgs.RequireMember(ctx, orgID, actorID); err != nil {
		return nil, err
	}
	return s.q.ListDepartments(ctx, db.ListDepartmentsParams{OrganizationID: orgID, IncludeArchived: includeArchived})
}

// Create adds a department. Owner and admin only: the structure is a statement
// the company makes about itself.
func (s *DepartmentService) Create(ctx context.Context, actorID, orgID string, in DepartmentInput) (db.Department, error) {
	if err := s.requireAdmin(ctx, orgID, actorID); err != nil {
		return db.Department{}, err
	}
	name := ""
	if in.Name != nil {
		name = strings.TrimSpace(*in.Name)
	}
	if name == "" {
		return db.Department{}, Invalid("tên phòng ban không được để trống")
	}
	parent, err := s.resolveParent(ctx, orgID, in.ParentID, "")
	if err != nil {
		return db.Department{}, err
	}
	head, err := s.resolveHead(ctx, orgID, in.HeadUserID)
	if err != nil {
		return db.Department{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.Department{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	d, err := q.CreateDepartment(ctx, db.CreateDepartmentParams{
		ID: util.NewID(), OrganizationID: orgID, ParentID: parent,
		Name: name, Code: normalizedCode(in.Code), HeadUserID: head,
		CreatedBy: actorID, CreatedByKind: string(audit.KindHuman),
	})
	if isUniqueViolation(err) {
		return db.Department{}, coded(http.StatusConflict, "department_code_taken", "mã phòng ban đã được dùng trong tổ chức")
	}
	if err != nil {
		return db.Department{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID,
		Actor:          audit.User(actorID),
		Action:         audit.ActionDepartmentCreated,
		ResourceType:   "department", ResourceID: d.ID,
		Changes: audit.Diff(nil, map[string]any{"name": d.Name, "code": textOrEmpty(d.Code), "parent_id": textOrEmpty(d.ParentID)}),
	}, audit.Event{Topic: "department.created", Payload: map[string]string{
		"organization_id": orgID, "department_id": d.ID,
	}}); err != nil {
		return db.Department{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.Department{}, err
	}
	return d, nil
}

// Update renames or re-parents a department. A rename rewrites the search text
// of everyone in it, because the directory searches department names too.
func (s *DepartmentService) Update(ctx context.Context, actorID, orgID, id string, in DepartmentInput) (db.Department, error) {
	if err := s.requireAdmin(ctx, orgID, actorID); err != nil {
		return db.Department{}, err
	}
	before, err := s.get(ctx, orgID, id)
	if err != nil {
		return db.Department{}, err
	}
	p := db.UpdateDepartmentParams{ID: id, OrganizationID: orgID}
	if in.Name != nil {
		name := strings.TrimSpace(*in.Name)
		if name == "" {
			return db.Department{}, Invalid("tên phòng ban không được để trống")
		}
		p.Name = pgtype.Text{String: name, Valid: true}
	}
	if in.Code != nil {
		p.SetCode = true
		p.Code = normalizedCode(in.Code)
	}
	if in.ParentID != nil {
		p.SetParent = true
		parent, err := s.resolveParent(ctx, orgID, in.ParentID, id)
		if err != nil {
			return db.Department{}, err
		}
		p.ParentID = parent
		// Re-parenting is only legal while this department has no children of
		// its own; otherwise the tree would become three levels deep.
		if parent.Valid {
			children, err := s.q.CountChildDepartments(ctx, db.CountChildDepartmentsParams{
				OrganizationID: orgID, ParentID: pgtype.Text{String: id, Valid: true},
			})
			if err != nil {
				return db.Department{}, err
			}
			if children > 0 {
				return db.Department{}, errDepartmentDepth()
			}
		}
	}
	if in.HeadUserID != nil {
		p.SetHead = true
		head, err := s.resolveHead(ctx, orgID, in.HeadUserID)
		if err != nil {
			return db.Department{}, err
		}
		p.HeadUserID = head
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.Department{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	d, err := q.UpdateDepartment(ctx, p)
	if isUniqueViolation(err) {
		return db.Department{}, coded(http.StatusConflict, "department_code_taken", "mã phòng ban đã được dùng trong tổ chức")
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Department{}, ErrNotFound
	}
	if err != nil {
		return db.Department{}, err
	}
	if d.Name != before.Name {
		if err := refreshSearchText(ctx, q, RefreshSearchTextInput{DepartmentID: id}); err != nil {
			return db.Department{}, err
		}
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID,
		Actor:          audit.User(actorID),
		Action:         audit.ActionDepartmentUpdated,
		ResourceType:   "department", ResourceID: d.ID,
		Changes: audit.Diff(
			map[string]any{"name": before.Name, "code": textOrEmpty(before.Code), "parent_id": textOrEmpty(before.ParentID)},
			map[string]any{"name": d.Name, "code": textOrEmpty(d.Code), "parent_id": textOrEmpty(d.ParentID)}),
	}, audit.Event{Topic: "department.updated", Payload: map[string]string{
		"organization_id": orgID, "department_id": d.ID,
	}}); err != nil {
		return db.Department{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.Department{}, err
	}
	return d, nil
}

// Archive retires a department. Its people are not retired with it: they are
// moved out of it in the same transaction, so nobody ends up pointing at a
// department that is no longer listed.
func (s *DepartmentService) Archive(ctx context.Context, actorID, orgID, id string) (db.Department, error) {
	if err := s.requireAdmin(ctx, orgID, actorID); err != nil {
		return db.Department{}, err
	}
	if _, err := s.get(ctx, orgID, id); err != nil {
		return db.Department{}, err
	}
	children, err := s.q.CountChildDepartments(ctx, db.CountChildDepartmentsParams{
		OrganizationID: orgID, ParentID: pgtype.Text{String: id, Valid: true},
	})
	if err != nil {
		return db.Department{}, err
	}
	if children > 0 {
		return db.Department{}, errDepartmentHasChildren()
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.Department{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	d, err := q.ArchiveDepartment(ctx, db.ArchiveDepartmentParams{ID: id, OrganizationID: orgID})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Department{}, ErrConflict
	}
	if err != nil {
		return db.Department{}, err
	}
	// Rebuild the search text before the link is cut: afterwards the join has
	// nothing left to read the old name from.
	if err := refreshSearchTextAfterDepartmentRemoval(ctx, q, orgID, id); err != nil {
		return db.Department{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID,
		Actor:          audit.User(actorID),
		Action:         audit.ActionDepartmentArchived,
		ResourceType:   "department", ResourceID: d.ID,
		Changes: audit.Diff(map[string]any{"archived": false}, map[string]any{"archived": true}),
	}, audit.Event{Topic: "department.archived", Payload: map[string]string{
		"organization_id": orgID, "department_id": d.ID,
	}}); err != nil {
		return db.Department{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.Department{}, err
	}
	return d, nil
}

// Reorder writes the display order the settings screen dragged into place.
func (s *DepartmentService) Reorder(ctx context.Context, actorID, orgID string, ids []string) ([]db.ListDepartmentsRow, error) {
	if err := s.requireAdmin(ctx, orgID, actorID); err != nil {
		return nil, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	for i, id := range ids {
		if err := q.SetDepartmentOrder(ctx, db.SetDepartmentOrderParams{
			ID: id, OrganizationID: orgID, SortOrder: int32(i),
		}); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.q.ListDepartments(ctx, db.ListDepartmentsParams{OrganizationID: orgID})
}

// refreshSearchTextAfterDepartmentRemoval rewrites the search text of the
// department's members without its name, then unlinks them.
func refreshSearchTextAfterDepartmentRemoval(ctx context.Context, q *db.Queries, orgID, id string) error {
	rows, err := q.ListProfileSearchSources(ctx, db.ListProfileSearchSourcesParams{
		DepartmentID:   pgtype.Text{String: id, Valid: true},
		OrganizationID: pgtype.Text{String: orgID, Valid: true},
	})
	if err != nil {
		return err
	}
	if err := q.ClearDepartmentFromProfiles(ctx, db.ClearDepartmentFromProfilesParams{
		OrganizationID: orgID, DepartmentID: pgtype.Text{String: id, Valid: true},
	}); err != nil {
		return err
	}
	for _, r := range rows {
		if err := q.SetMemberProfileSearchText(ctx, db.SetMemberProfileSearchTextParams{
			OrganizationID: r.OrganizationID, UserID: r.UserID,
			SearchText: buildSearchText(r.DisplayName, r.Email, r.Title, ""),
		}); err != nil {
			return err
		}
	}
	return nil
}

func (s *DepartmentService) requireAdmin(ctx context.Context, orgID, actorID string) error {
	m, err := s.orgs.RequireMember(ctx, orgID, actorID)
	if err != nil {
		return err
	}
	if m.Role != OrgRoleOwner && m.Role != OrgRoleAdmin {
		return ErrForbidden
	}
	return nil
}

func (s *DepartmentService) get(ctx context.Context, orgID, id string) (db.Department, error) {
	d, err := s.q.GetDepartment(ctx, db.GetDepartmentParams{ID: id, OrganizationID: orgID})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Department{}, ErrNotFound
	}
	return d, err
}

// resolveParent validates the parent link and the depth rule in one place.
// selfID is the department being edited, so it cannot become its own parent.
func (s *DepartmentService) resolveParent(ctx context.Context, orgID string, parentID *string, selfID string) (pgtype.Text, error) {
	if parentID == nil {
		return pgtype.Text{}, nil
	}
	id := strings.TrimSpace(*parentID)
	if id == "" {
		return pgtype.Text{}, nil
	}
	if id == selfID {
		return pgtype.Text{}, Invalid("phòng ban không thể là cấp trên của chính nó")
	}
	parent, err := s.get(ctx, orgID, id)
	if err != nil {
		return pgtype.Text{}, err
	}
	if parent.ParentID.Valid {
		return pgtype.Text{}, errDepartmentDepth()
	}
	return pgtype.Text{String: id, Valid: true}, nil
}

func (s *DepartmentService) resolveHead(ctx context.Context, orgID string, headID *string) (pgtype.Text, error) {
	if headID == nil {
		return pgtype.Text{}, nil
	}
	id := strings.TrimSpace(*headID)
	if id == "" {
		return pgtype.Text{}, nil
	}
	if _, err := s.q.GetPerson(ctx, db.GetPersonParams{OrganizationID: orgID, UserID: id}); errors.Is(err, pgx.ErrNoRows) {
		return pgtype.Text{}, Invalid("trưởng phòng phải là thành viên của tổ chức")
	} else if err != nil {
		return pgtype.Text{}, err
	}
	return pgtype.Text{String: id, Valid: true}, nil
}

func normalizedCode(code *string) pgtype.Text {
	if code == nil {
		return pgtype.Text{}
	}
	v := strings.ToUpper(strings.TrimSpace(*code))
	if v == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: v, Valid: true}
}
