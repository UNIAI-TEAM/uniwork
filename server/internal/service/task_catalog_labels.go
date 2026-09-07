package service

import (
	"context"
	"errors"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const maxLabelNameLen = 64

type CreateTaskLabelInput struct {
	Name, Description, Color string
}

type UpdateTaskLabelInput struct {
	Name, Description, Color *string
}

type TaskLabelView struct {
	db.TaskLabel
	UsageCount int64
}

func validateLabelName(raw string) (string, error) {
	for _, r := range raw {
		if unicode.IsControl(r) {
			return "", Invalid("name cannot contain control characters")
		}
	}
	name := strings.TrimSpace(raw)
	if name == "" {
		return "", Invalid("name is required")
	}
	if utf8.RuneCountInString(name) > maxLabelNameLen {
		return "", Invalid("name must be 64 characters or fewer")
	}
	return name, nil
}

func (s *TaskService) ListTaskLabels(ctx context.Context, actor Actor, workspaceID string, includeArchived bool) ([]TaskLabelView, error) {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return nil, err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListTaskLabels(ctx, db.ListTaskLabelsParams{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID, IncludeArchived: includeArchived,
	})
	if err != nil {
		return nil, err
	}
	out := make([]TaskLabelView, 0, len(rows))
	for _, r := range rows {
		out = append(out, TaskLabelView{
			TaskLabel: db.TaskLabel{
				ID: r.ID, OrganizationID: r.OrganizationID, WorkspaceID: r.WorkspaceID,
				Name: r.Name, Color: r.Color, Description: r.Description, ArchivedAt: r.ArchivedAt,
				CreatedBy: r.CreatedBy, CreatedByKind: r.CreatedByKind,
				CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
			},
			UsageCount: r.UsageCount,
		})
	}
	return out, nil
}

func (s *TaskService) GetTaskLabel(ctx context.Context, actor Actor, workspaceID, labelID string) (db.TaskLabel, error) {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return db.TaskLabel{}, err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return db.TaskLabel{}, err
	}
	label, err := s.q.GetTaskLabelByID(ctx, db.GetTaskLabelByIDParams{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID, ID: labelID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.TaskLabel{}, ErrNotFound
	}
	return label, err
}

func (s *TaskService) CreateTaskLabel(ctx context.Context, actor Actor, workspaceID string, in CreateTaskLabelInput) (db.TaskLabel, error) {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return db.TaskLabel{}, err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return db.TaskLabel{}, err
	}
	name, err := validateLabelName(in.Name)
	if err != nil {
		return db.TaskLabel{}, err
	}
	if utf8.RuneCountInString(in.Description) > 256 {
		return db.TaskLabel{}, Invalid("description must be at most 256 characters")
	}
	color, err := normalizeHexColor(in.Color)
	if err != nil {
		return db.TaskLabel{}, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.TaskLabel{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	label, err := q.CreateTaskLabel(ctx, db.CreateTaskLabelParams{
		ID: util.NewID(), OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		Name: name, Color: color, Description: in.Description,
		CreatedBy: actor.ID, CreatedByKind: string(actor.Kind),
	})
	if err != nil {
		if isUniqueViolation(err) {
			return db.TaskLabel{}, ErrConflict
		}
		return db.TaskLabel{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		Actor:  actor,
		Action: audit.ActionTaskLabelCreated, ResourceType: "task_label", ResourceID: label.ID,
	}, audit.Event{Topic: "task_label.created", Payload: map[string]string{
		"label_id": label.ID, "workspace_id": workspaceID,
	}}); err != nil {
		return db.TaskLabel{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.TaskLabel{}, err
	}
	return label, nil
}

func (s *TaskService) UpdateTaskLabel(ctx context.Context, actor Actor, workspaceID, labelID string, in UpdateTaskLabelInput) (db.TaskLabel, error) {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return db.TaskLabel{}, err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return db.TaskLabel{}, err
	}
	if _, err := s.q.GetTaskLabelByID(ctx, db.GetTaskLabelByIDParams{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID, ID: labelID,
	}); errors.Is(err, pgx.ErrNoRows) {
		return db.TaskLabel{}, ErrNotFound
	} else if err != nil {
		return db.TaskLabel{}, err
	}

	var name *string
	if in.Name != nil {
		n, err := validateLabelName(*in.Name)
		if err != nil {
			return db.TaskLabel{}, err
		}
		name = &n
	}
	if in.Description != nil && utf8.RuneCountInString(*in.Description) > 256 {
		return db.TaskLabel{}, Invalid("description must be at most 256 characters")
	}
	var color *string
	if in.Color != nil {
		c, err := normalizeHexColor(*in.Color)
		if err != nil {
			return db.TaskLabel{}, err
		}
		color = &c
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.TaskLabel{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	label, err := q.UpdateTaskLabel(ctx, db.UpdateTaskLabelParams{
		Name: optText(name), Description: optText(in.Description), Color: optText(color),
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID, ID: labelID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.TaskLabel{}, ErrNotFound
	}
	if err != nil {
		if isUniqueViolation(err) {
			return db.TaskLabel{}, ErrConflict
		}
		return db.TaskLabel{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		Actor:  actor,
		Action: audit.ActionTaskLabelUpdated, ResourceType: "task_label", ResourceID: label.ID,
	}, audit.Event{Topic: "task_label.updated", Payload: map[string]string{
		"label_id": label.ID, "workspace_id": workspaceID,
	}}); err != nil {
		return db.TaskLabel{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.TaskLabel{}, err
	}
	return label, nil
}

func (s *TaskService) DeleteTaskLabel(ctx context.Context, actor Actor, workspaceID, labelID string) error {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return err
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
	if err := q.DeleteTaskLabelLinksByLabel(ctx, db.DeleteTaskLabelLinksByLabelParams{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID, LabelID: labelID,
	}); err != nil {
		return err
	}
	if _, err := q.DeleteTaskLabel(ctx, db.DeleteTaskLabelParams{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID, ID: labelID,
	}); errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	} else if err != nil {
		return err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		Actor:  actor,
		Action: audit.ActionTaskLabelDeleted, ResourceType: "task_label", ResourceID: labelID,
	}, audit.Event{Topic: "task_label.deleted", Payload: map[string]string{
		"label_id": labelID, "workspace_id": workspaceID,
	}}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *TaskService) ListTaskLabelsOnTask(ctx context.Context, actor Actor, taskID string) ([]db.TaskLabel, error) {
	task, err := s.authorizeActor(ctx, actor, taskID)
	if err != nil {
		return nil, err
	}
	return s.q.ListTaskLabelLinks(ctx, db.ListTaskLabelLinksParams{
		OrganizationID: task.OrganizationID, WorkspaceID: task.WorkspaceID, TaskID: task.ID,
	})
}

func (s *TaskService) AttachTaskLabel(ctx context.Context, actor Actor, taskID, labelID string) error {
	task, err := s.authorizeActor(ctx, actor, taskID)
	if err != nil {
		return err
	}
	if _, err := s.q.GetTaskLabelByID(ctx, db.GetTaskLabelByIDParams{
		OrganizationID: task.OrganizationID, WorkspaceID: task.WorkspaceID, ID: labelID,
	}); errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	} else if err != nil {
		return err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	if _, err := q.AttachTaskLabel(ctx, db.AttachTaskLabelParams{
		OrganizationID: task.OrganizationID, WorkspaceID: task.WorkspaceID,
		TaskID: task.ID, LabelID: labelID,
	}); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		// ErrNoRows = already attached (ON CONFLICT DO NOTHING).
		return err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: task.OrganizationID, WorkspaceID: task.WorkspaceID,
		Actor:  actor,
		Action: audit.ActionTaskUpdated, ResourceType: "task", ResourceID: task.ID,
		Metadata: map[string]any{"label_id": labelID, "op": "attach_label"},
	}, audit.Event{Topic: "task.updated", Payload: map[string]string{
		"task_id": task.ID, "workspace_id": task.WorkspaceID,
	}}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *TaskService) DetachTaskLabel(ctx context.Context, actor Actor, taskID, labelID string) error {
	task, err := s.authorizeActor(ctx, actor, taskID)
	if err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	if _, err := q.DetachTaskLabel(ctx, db.DetachTaskLabelParams{
		OrganizationID: task.OrganizationID, WorkspaceID: task.WorkspaceID,
		TaskID: task.ID, LabelID: labelID,
	}); errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	} else if err != nil {
		return err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: task.OrganizationID, WorkspaceID: task.WorkspaceID,
		Actor:  actor,
		Action: audit.ActionTaskUpdated, ResourceType: "task", ResourceID: task.ID,
		Metadata: map[string]any{"label_id": labelID, "op": "detach_label"},
	}, audit.Event{Topic: "task.updated", Payload: map[string]string{
		"task_id": task.ID, "workspace_id": task.WorkspaceID,
	}}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
