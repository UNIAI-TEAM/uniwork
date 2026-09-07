package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	maxActivePropertiesPerWorkspace = 20
	maxPropertyNameLen              = 64
	maxPropertyDescriptionLen       = 500
)

var validPropertyTypes = map[string]bool{
	"text": true, "number": true, "select": true, "multi_select": true,
	"date": true, "checkbox": true, "url": true,
}

var reservedPropertyNames = map[string]struct{}{
	"status": {}, "priority": {}, "assignee": {}, "project": {}, "parent": {},
	"stage": {}, "label": {}, "labels": {}, "start_date": {}, "due_date": {},
	"title": {}, "description": {}, "creator": {}, "created_at": {}, "updated_at": {},
	"metadata": {}, "properties": {},
}

type CreateTaskPropertyInput struct {
	Name, Type, Description string
	Config                  json.RawMessage
}

type UpdateTaskPropertyInput struct {
	Name, Description *string
	Config            json.RawMessage
	Archived          *bool
}

type TaskPropertyView struct {
	db.TaskProperty
	UsageCount int64
}

func normalizePropertyName(raw string) (string, error) {
	name := strings.TrimSpace(raw)
	if name == "" || utf8.RuneCountInString(name) > maxPropertyNameLen {
		return "", Invalid("name must be 1-64 characters")
	}
	key := strings.ToLower(strings.ReplaceAll(name, " ", "_"))
	if _, reserved := reservedPropertyNames[key]; reserved {
		return "", Invalid("name is reserved")
	}
	return name, nil
}

func (s *TaskService) ListTaskProperties(ctx context.Context, actor Actor, workspaceID string, includeArchived bool) ([]TaskPropertyView, error) {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return nil, err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.ListTaskProperties(ctx, db.ListTaskPropertiesParams{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID, IncludeArchived: includeArchived,
	})
	if err != nil {
		return nil, err
	}
	out := make([]TaskPropertyView, 0, len(rows))
	for _, r := range rows {
		out = append(out, TaskPropertyView{
			TaskProperty: db.TaskProperty{
				ID: r.ID, OrganizationID: r.OrganizationID, WorkspaceID: r.WorkspaceID,
				Name: r.Name, Type: r.Type, Description: r.Description, Config: r.Config,
				Position: r.Position, ArchivedAt: r.ArchivedAt,
				CreatedBy: r.CreatedBy, CreatedByKind: r.CreatedByKind,
				CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
			},
			UsageCount: r.UsageCount,
		})
	}
	return out, nil
}

func (s *TaskService) CreateTaskProperty(ctx context.Context, actor Actor, workspaceID string, in CreateTaskPropertyInput) (db.TaskProperty, error) {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return db.TaskProperty{}, err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return db.TaskProperty{}, err
	}
	name, err := normalizePropertyName(in.Name)
	if err != nil {
		return db.TaskProperty{}, err
	}
	if !validPropertyTypes[in.Type] {
		return db.TaskProperty{}, Invalid("type không hợp lệ")
	}
	if utf8.RuneCountInString(in.Description) > maxPropertyDescriptionLen {
		return db.TaskProperty{}, Invalid("description too long")
	}
	cfg := in.Config
	if len(cfg) == 0 {
		cfg = json.RawMessage(`{}`)
	}
	if !json.Valid(cfg) {
		return db.TaskProperty{}, Invalid("config must be a JSON object")
	}
	var obj map[string]any
	if err := json.Unmarshal(cfg, &obj); err != nil {
		return db.TaskProperty{}, Invalid("config must be a JSON object")
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.TaskProperty{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	count, err := q.CountActiveTaskProperties(ctx, db.CountActiveTaskPropertiesParams{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
	})
	if err != nil {
		return db.TaskProperty{}, err
	}
	if count >= maxActivePropertiesPerWorkspace {
		return db.TaskProperty{}, coded(http.StatusUnprocessableEntity, "property_limit", "tối đa 20 thuộc tính mỗi workspace")
	}
	maxPos, err := q.MaxTaskPropertyPosition(ctx, db.MaxTaskPropertyPositionParams{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
	})
	if err != nil {
		return db.TaskProperty{}, err
	}
	prop, err := q.CreateTaskProperty(ctx, db.CreateTaskPropertyParams{
		ID: util.NewID(), OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		Name: name, Type: in.Type, Description: in.Description, Config: cfg,
		Position: maxPos + 1, CreatedBy: actor.ID, CreatedByKind: string(actor.Kind),
	})
	if err != nil {
		return db.TaskProperty{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		Actor:  actor,
		Action: audit.ActionTaskPropertyCreated, ResourceType: "task_property", ResourceID: prop.ID,
	}, audit.Event{Topic: "task_property.created", Payload: map[string]string{
		"property_id": prop.ID, "workspace_id": workspaceID,
	}}); err != nil {
		return db.TaskProperty{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.TaskProperty{}, err
	}
	return prop, nil
}

func (s *TaskService) UpdateTaskProperty(ctx context.Context, actor Actor, workspaceID, propertyID string, in UpdateTaskPropertyInput) (db.TaskProperty, error) {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return db.TaskProperty{}, err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return db.TaskProperty{}, err
	}
	if _, err := s.q.GetTaskPropertyByID(ctx, db.GetTaskPropertyByIDParams{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID, ID: propertyID,
	}); errors.Is(err, pgx.ErrNoRows) {
		return db.TaskProperty{}, ErrNotFound
	} else if err != nil {
		return db.TaskProperty{}, err
	}

	var name *string
	if in.Name != nil {
		n, err := normalizePropertyName(*in.Name)
		if err != nil {
			return db.TaskProperty{}, err
		}
		name = &n
	}
	if in.Description != nil && utf8.RuneCountInString(*in.Description) > maxPropertyDescriptionLen {
		return db.TaskProperty{}, Invalid("description too long")
	}
	var cfg []byte
	if in.Config != nil {
		if !json.Valid(in.Config) {
			return db.TaskProperty{}, Invalid("config must be a JSON object")
		}
		var obj map[string]any
		if err := json.Unmarshal(in.Config, &obj); err != nil {
			return db.TaskProperty{}, Invalid("config must be a JSON object")
		}
		cfg = in.Config
	}

	archivedSet := in.Archived != nil
	var archivedAt pgtype.Timestamptz
	if in.Archived != nil && *in.Archived {
		archivedAt = pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true}
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.TaskProperty{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	prop, err := q.UpdateTaskProperty(ctx, db.UpdateTaskPropertyParams{
		Name: optText(name), Description: optText(in.Description),
		Config: cfg, ArchivedSet: archivedSet, ArchivedAt: archivedAt,
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID, ID: propertyID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.TaskProperty{}, ErrNotFound
	}
	if err != nil {
		return db.TaskProperty{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		Actor:  actor,
		Action: audit.ActionTaskPropertyUpdated, ResourceType: "task_property", ResourceID: prop.ID,
	}, audit.Event{Topic: "task_property.updated", Payload: map[string]string{
		"property_id": prop.ID, "workspace_id": workspaceID,
	}}); err != nil {
		return db.TaskProperty{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.TaskProperty{}, err
	}
	return prop, nil
}

func (s *TaskService) SetTaskPropertyValue(ctx context.Context, actor Actor, taskID, propertyID string, value json.RawMessage) (db.Task, error) {
	task, err := s.authorizeActor(ctx, actor, taskID)
	if err != nil {
		return db.Task{}, err
	}
	prop, err := s.q.GetTaskPropertyByID(ctx, db.GetTaskPropertyByIDParams{
		OrganizationID: task.OrganizationID, WorkspaceID: task.WorkspaceID, ID: propertyID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Task{}, ErrNotFound
	}
	if err != nil {
		return db.Task{}, err
	}
	if prop.ArchivedAt.Valid {
		return db.Task{}, Invalid("archived property rejects new values")
	}
	if len(value) == 0 || !json.Valid(value) {
		return db.Task{}, Invalid("value must be valid JSON")
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.Task{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	updated, err := q.SetTaskPropertyValue(ctx, db.SetTaskPropertyValueParams{
		PropertyID: propertyID, Value: value, TaskID: task.ID,
		OrganizationID: task.OrganizationID, WorkspaceID: task.WorkspaceID,
	})
	if err != nil {
		return db.Task{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: task.OrganizationID, WorkspaceID: task.WorkspaceID,
		Actor:  actor,
		Action: audit.ActionTaskUpdated, ResourceType: "task", ResourceID: task.ID,
		Metadata: map[string]any{"property_id": propertyID, "op": "set_property"},
	}, audit.Event{Topic: "task.updated", Payload: map[string]string{
		"task_id": task.ID, "workspace_id": task.WorkspaceID,
	}}); err != nil {
		return db.Task{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.Task{}, err
	}
	return updated, nil
}

func (s *TaskService) DeleteTaskPropertyValue(ctx context.Context, actor Actor, taskID, propertyID string) (db.Task, error) {
	task, err := s.authorizeActor(ctx, actor, taskID)
	if err != nil {
		return db.Task{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.Task{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	updated, err := q.DeleteTaskPropertyValue(ctx, db.DeleteTaskPropertyValueParams{
		PropertyID: propertyID, TaskID: task.ID,
		OrganizationID: task.OrganizationID, WorkspaceID: task.WorkspaceID,
	})
	if err != nil {
		return db.Task{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: task.OrganizationID, WorkspaceID: task.WorkspaceID,
		Actor:  actor,
		Action: audit.ActionTaskUpdated, ResourceType: "task", ResourceID: task.ID,
		Metadata: map[string]any{"property_id": propertyID, "op": "delete_property"},
	}, audit.Event{Topic: "task.updated", Payload: map[string]string{
		"task_id": task.ID, "workspace_id": task.WorkspaceID,
	}}); err != nil {
		return db.Task{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.Task{}, err
	}
	return updated, nil
}
