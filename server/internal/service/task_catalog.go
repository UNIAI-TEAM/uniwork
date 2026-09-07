package service

import (
	"context"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

var (
	hexColorRE      = regexp.MustCompile(`^#?[0-9a-fA-F]{6}$`)
	statusKeyRE     = regexp.MustCompile(`^[a-z0-9][a-z0-9_]{0,31}$`)
	validCategories = map[string]bool{
		"backlog": true, "todo": true, "in_progress": true, "in_review": true,
		"done": true, "blocked": true, "cancelled": true,
	}
)

func errSystemStatusImmutable() error {
	return coded(http.StatusUnprocessableEntity, "system_status_immutable", "trạng thái hệ thống không thể sửa hoặc xóa")
}

func normalizeHexColor(c string) (string, error) {
	c = strings.TrimSpace(c)
	if !hexColorRE.MatchString(c) {
		return "", Invalid("color must be a 6-digit hex value like #3b82f6")
	}
	if !strings.HasPrefix(c, "#") {
		c = "#" + c
	}
	return strings.ToLower(c), nil
}

func isBuiltInStatusKey(key string) bool {
	for _, st := range builtInTaskStatuses {
		if st.Key == key {
			return true
		}
	}
	return false
}

func slugifyStatusKey(name string) (string, error) {
	var b strings.Builder
	for _, r := range strings.ToLower(strings.TrimSpace(name)) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == ' ' || r == '-' || r == '_':
			if b.Len() > 0 && b.String()[b.Len()-1] != '_' {
				b.WriteByte('_')
			}
		}
	}
	key := strings.Trim(b.String(), "_")
	if key == "" {
		return "", Invalid("không tạo được key từ tên trạng thái")
	}
	if len(key) > 32 {
		key = key[:32]
	}
	if !statusKeyRE.MatchString(key) {
		return "", Invalid("key trạng thái không hợp lệ")
	}
	if isBuiltInStatusKey(key) {
		return "", Invalid("key trùng trạng thái hệ thống")
	}
	return key, nil
}

type CreateTaskStatusInput struct {
	Key, Name, Description, Category, Color string
}

type UpdateTaskStatusInput struct {
	Name, Description, Color *string
	Position                 *float64
}

type ReorderTaskStatusesInput struct {
	Category string
	IDs      []string
}

func (s *TaskService) ListTaskStatuses(ctx context.Context, actor Actor, workspaceID string, includeArchived bool) ([]db.TaskStatus, error) {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return nil, err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	return s.q.ListTaskStatuses(ctx, db.ListTaskStatusesParams{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID, IncludeArchived: includeArchived,
	})
}

func (s *TaskService) CreateTaskStatus(ctx context.Context, actor Actor, workspaceID string, in CreateTaskStatusInput) (db.TaskStatus, error) {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return db.TaskStatus{}, err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return db.TaskStatus{}, err
	}
	name := strings.TrimSpace(in.Name)
	if name == "" || utf8.RuneCountInString(name) > 64 {
		return db.TaskStatus{}, Invalid("name must be 1-64 characters")
	}
	if utf8.RuneCountInString(in.Description) > 256 {
		return db.TaskStatus{}, Invalid("description must be at most 256 characters")
	}
	if !validCategories[in.Category] {
		return db.TaskStatus{}, Invalid("category không hợp lệ")
	}
	color, err := normalizeHexColor(in.Color)
	if err != nil {
		return db.TaskStatus{}, err
	}
	key := strings.TrimSpace(in.Key)
	if key == "" {
		key, err = slugifyStatusKey(name)
	} else {
		key = strings.ToLower(key)
		if !statusKeyRE.MatchString(key) {
			return db.TaskStatus{}, Invalid("key trạng thái không hợp lệ")
		}
		if isBuiltInStatusKey(key) {
			return db.TaskStatus{}, Invalid("key trùng trạng thái hệ thống")
		}
	}
	if err != nil {
		return db.TaskStatus{}, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.TaskStatus{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	maxPos, err := q.MaxTaskStatusPositionInCategory(ctx, db.MaxTaskStatusPositionInCategoryParams{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID, Category: in.Category,
	})
	if err != nil {
		return db.TaskStatus{}, err
	}
	st, err := q.CreateTaskStatus(ctx, db.CreateTaskStatusParams{
		ID: util.NewID(), OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		Key: key, Name: name, Description: in.Description, Category: in.Category,
		Color: color, IsSystem: false, Position: maxPos + 1,
		CreatedBy: actor.ID, CreatedByKind: string(actor.Kind),
	})
	if err != nil {
		if isUniqueViolation(err) {
			return db.TaskStatus{}, ErrConflict
		}
		return db.TaskStatus{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		Actor:  actor,
		Action: audit.ActionTaskStatusCreated, ResourceType: "task_status", ResourceID: st.ID,
	}, audit.Event{Topic: "task_status.created", Payload: map[string]string{
		"status_id": st.ID, "workspace_id": workspaceID,
	}}); err != nil {
		return db.TaskStatus{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.TaskStatus{}, err
	}
	return st, nil
}

func (s *TaskService) UpdateTaskStatus(ctx context.Context, actor Actor, workspaceID, statusID string, in UpdateTaskStatusInput) (db.TaskStatus, error) {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return db.TaskStatus{}, err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return db.TaskStatus{}, err
	}
	existing, err := s.q.GetTaskStatusByID(ctx, db.GetTaskStatusByIDParams{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID, ID: statusID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.TaskStatus{}, ErrNotFound
	}
	if err != nil {
		return db.TaskStatus{}, err
	}
	if existing.IsSystem {
		return db.TaskStatus{}, errSystemStatusImmutable()
	}
	if existing.ArchivedAt.Valid {
		return db.TaskStatus{}, Invalid("archived statuses cannot be modified")
	}

	var name *string
	if in.Name != nil {
		trimmed := strings.TrimSpace(*in.Name)
		if trimmed == "" || utf8.RuneCountInString(trimmed) > 64 {
			return db.TaskStatus{}, Invalid("name must be 1-64 characters")
		}
		name = &trimmed
	}
	if in.Description != nil && utf8.RuneCountInString(*in.Description) > 256 {
		return db.TaskStatus{}, Invalid("description must be at most 256 characters")
	}
	var color *string
	if in.Color != nil {
		normalized, err := normalizeHexColor(*in.Color)
		if err != nil {
			return db.TaskStatus{}, err
		}
		color = &normalized
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.TaskStatus{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	st, err := q.UpdateTaskStatus(ctx, db.UpdateTaskStatusParams{
		Name: optText(name), Description: optText(in.Description), Color: optText(color),
		Position:       optFloat(in.Position),
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID, ID: statusID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.TaskStatus{}, errSystemStatusImmutable()
	}
	if err != nil {
		if isUniqueViolation(err) {
			return db.TaskStatus{}, ErrConflict
		}
		return db.TaskStatus{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		Actor:  actor,
		Action: audit.ActionTaskStatusUpdated, ResourceType: "task_status", ResourceID: st.ID,
	}, audit.Event{Topic: "task_status.updated", Payload: map[string]string{
		"status_id": st.ID, "workspace_id": workspaceID,
	}}); err != nil {
		return db.TaskStatus{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.TaskStatus{}, err
	}
	return st, nil
}

func (s *TaskService) DeleteTaskStatus(ctx context.Context, actor Actor, workspaceID, statusID string) error {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return err
	}
	existing, err := s.q.GetTaskStatusByID(ctx, db.GetTaskStatusByIDParams{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID, ID: statusID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if existing.IsSystem {
		return errSystemStatusImmutable()
	}
	if existing.ArchivedAt.Valid {
		return nil
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	st, err := q.ArchiveTaskStatus(ctx, db.ArchiveTaskStatusParams{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID, ID: statusID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return errSystemStatusImmutable()
	}
	if err != nil {
		return err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		Actor:  actor,
		Action: audit.ActionTaskStatusDeleted, ResourceType: "task_status", ResourceID: st.ID,
		Metadata: map[string]any{"key": st.Key},
	}, audit.Event{Topic: "task_status.deleted", Payload: map[string]string{
		"status_id": st.ID, "workspace_id": workspaceID,
	}}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *TaskService) ReorderTaskStatuses(ctx context.Context, actor Actor, workspaceID string, in ReorderTaskStatusesInput) ([]db.TaskStatus, error) {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return nil, err
	}
	if !validCategories[in.Category] {
		return nil, Invalid("category không hợp lệ")
	}
	if len(in.IDs) == 0 {
		return nil, Invalid("ids must not be empty")
	}
	seen := map[string]struct{}{}
	for _, id := range in.IDs {
		if _, dup := seen[id]; dup {
			return nil, Invalid("duplicate ids")
		}
		seen[id] = struct{}{}
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return nil, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	active, err := q.ListActiveCustomTaskStatusesInCategory(ctx, db.ListActiveCustomTaskStatusesInCategoryParams{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID, Category: in.Category,
	})
	if err != nil {
		return nil, err
	}
	activeIDs := map[string]struct{}{}
	for _, st := range active {
		activeIDs[st.ID] = struct{}{}
	}
	if len(activeIDs) != len(in.IDs) {
		return nil, Invalid("ids must list every active custom status in the category")
	}
	for _, id := range in.IDs {
		if _, ok := activeIDs[id]; !ok {
			// Built-in or wrong category / archived.
			existing, getErr := q.GetTaskStatusByID(ctx, db.GetTaskStatusByIDParams{
				OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID, ID: id,
			})
			if getErr == nil && existing.IsSystem {
				return nil, errSystemStatusImmutable()
			}
			return nil, Invalid("ids must list every active custom status in the category")
		}
	}

	builtIn, err := q.GetTaskStatusByKey(ctx, db.GetTaskStatusByKeyParams{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID, Key: in.Category,
	})
	base := float64(0)
	if err == nil {
		base = builtIn.Position
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}

	for i, id := range in.IDs {
		pos := base + float64(i+1)
		if _, err := q.UpdateTaskStatus(ctx, db.UpdateTaskStatusParams{
			Position:       pgtype.Float8{Float64: pos, Valid: true},
			OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID, ID: id,
		}); err != nil {
			return nil, err
		}
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		Actor:  actor,
		Action: audit.ActionTaskStatusUpdated, ResourceType: "task_status", ResourceID: workspaceID,
		Metadata: map[string]any{"reorder_category": in.Category},
	}, audit.Event{Topic: "task_status.updated", Payload: map[string]string{
		"status_id": workspaceID, "workspace_id": workspaceID,
	}}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.q.ListActiveCustomTaskStatusesInCategory(ctx, db.ListActiveCustomTaskStatusesInCategoryParams{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID, Category: in.Category,
	})
}
