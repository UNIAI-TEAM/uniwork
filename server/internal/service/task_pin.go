package service

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type CreatePinInput struct {
	ItemType string
	ItemID   string
}

type ReorderPinItem struct {
	ID       string
	Position float64
}

func (s *TaskService) ListPins(ctx context.Context, actor Actor, workspaceID string, includeTaskViews bool) ([]db.TaskPin, error) {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return nil, err
	}
	if actor.Kind != audit.KindHuman {
		return nil, ErrForbidden
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	pins, err := s.q.ListTaskPins(ctx, db.ListTaskPinsParams{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID, UserID: actor.ID,
	})
	if err != nil {
		return nil, err
	}
	if includeTaskViews {
		return pins, nil
	}
	out := make([]db.TaskPin, 0, len(pins))
	for _, p := range pins {
		if p.ItemType == "task_view" {
			continue
		}
		out = append(out, p)
	}
	return out, nil
}

func (s *TaskService) CreatePin(ctx context.Context, actor Actor, workspaceID string, in CreatePinInput) (db.TaskPin, error) {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return db.TaskPin{}, err
	}
	if actor.Kind != audit.KindHuman {
		return db.TaskPin{}, ErrForbidden
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return db.TaskPin{}, err
	}
	if in.ItemID == "" {
		return db.TaskPin{}, Invalid("item_id is required")
	}
	switch in.ItemType {
	case "task":
		if _, err := s.q.GetTaskInWorkspace(ctx, db.GetTaskInWorkspaceParams{
			ID: in.ItemID, OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return db.TaskPin{}, ErrNotFound
			}
			return db.TaskPin{}, err
		}
	case "project":
		if _, err := s.q.GetProject(ctx, db.GetProjectParams{
			ID: in.ItemID, OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return db.TaskPin{}, ErrNotFound
			}
			return db.TaskPin{}, err
		}
	case "task_view":
		if _, err := s.loadReadableTaskView(ctx, s.q, ws.OrganizationID, workspaceID, in.ItemID, actor.ID); err != nil {
			return db.TaskPin{}, err
		}
	default:
		return db.TaskPin{}, Invalid("item_type must be task, project or task_view")
	}

	maxPos, err := s.q.GetMaxTaskPinPosition(ctx, db.GetMaxTaskPinPositionParams{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID, UserID: actor.ID,
	})
	if err != nil {
		return db.TaskPin{}, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.TaskPin{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	pin, err := q.CreateTaskPin(ctx, db.CreateTaskPinParams{
		ID: util.NewID(), OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		UserID: actor.ID, ItemType: in.ItemType, ItemID: in.ItemID, Position: maxPos + 1,
	})
	if err != nil {
		if isUniqueViolation(err) {
			return db.TaskPin{}, ErrConflict
		}
		return db.TaskPin{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		Actor: actor, Action: audit.ActionTaskPinCreated,
		ResourceType: "task_pin", ResourceID: pin.ID,
	}, audit.Event{Topic: "task_pin.created", Payload: map[string]string{
		"pin_id": pin.ID, "workspace_id": workspaceID,
	}}); err != nil {
		return db.TaskPin{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.TaskPin{}, err
	}
	return pin, nil
}

func (s *TaskService) DeletePin(ctx context.Context, actor Actor, workspaceID, itemType, itemID string) error {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return err
	}
	if actor.Kind != audit.KindHuman {
		return ErrForbidden
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return err
	}
	switch itemType {
	case "task", "project", "task_view":
	default:
		return Invalid("item_type must be task, project or task_view")
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	pin, err := q.DeleteTaskPin(ctx, db.DeleteTaskPinParams{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		UserID: actor.ID, ItemType: itemType, ItemID: itemID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		Actor: actor, Action: audit.ActionTaskPinDeleted,
		ResourceType: "task_pin", ResourceID: pin.ID,
	}, audit.Event{Topic: "task_pin.deleted", Payload: map[string]string{
		"pin_id": pin.ID, "workspace_id": workspaceID,
	}}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *TaskService) ReorderPins(ctx context.Context, actor Actor, workspaceID string, items []ReorderPinItem) error {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return err
	}
	if actor.Kind != audit.KindHuman {
		return ErrForbidden
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return err
	}
	if len(items) == 0 {
		return nil
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	for _, it := range items {
		if it.ID == "" {
			return Invalid("pin id is required")
		}
		n, err := q.UpdateTaskPinPosition(ctx, db.UpdateTaskPinPositionParams{
			Position: it.Position, ID: it.ID,
			OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID, UserID: actor.ID,
		})
		if err != nil {
			return err
		}
		if n == 0 {
			return ErrNotFound
		}
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		Actor: actor, Action: audit.ActionTaskPinReordered,
		ResourceType: "task_pin", ResourceID: workspaceID,
	}, audit.Event{Topic: "task_pin.reordered", Payload: map[string]string{
		"workspace_id": workspaceID, "user_id": actor.ID,
	}}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
