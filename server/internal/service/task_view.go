package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	taskViewNameMaxLen   = 80
	taskViewsPerOwnerMax = 100
)

var (
	validTaskViewScopeTypes        = []string{"workspace", "my", "project"}
	validTaskViewMyVariants        = []string{"assigned", "created", "involved", "any"}
	validTaskViewWorkspaceVariants = []string{"members", "agents"}
	validTaskViewVisibilities      = []string{"private", "workspace"}
)

type CreateTaskViewInput struct {
	Name              string
	ScopeType         string
	ScopeID           *string
	ScopeVariant      *string
	Visibility        string
	DefinitionVersion int32
	Query             json.RawMessage
	Display           json.RawMessage
}

type UpdateTaskViewInput struct {
	Name             *string
	Visibility       *string
	ScopeVariant     *string
	Query            json.RawMessage
	Display          json.RawMessage
	ExpectedRevision int64
}

type PutTaskViewPreferenceInput struct {
	ScopeType string
	ScopeID   *string
	Prefs     json.RawMessage
}

type TaskViewPreferenceView struct {
	OrganizationID string
	WorkspaceID    string
	UserID         string
	ScopeType      string
	ScopeID        string
	Prefs          json.RawMessage
	UpdatedAt      pgtype.Timestamptz
}

func containsStr(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

func isJSONObject(raw json.RawMessage) bool {
	var m map[string]json.RawMessage
	if json.Unmarshal(raw, &m) != nil {
		return false
	}
	return m != nil
}

func validateTaskViewVariant(scopeType string, variant *string) (pgtype.Text, error) {
	switch scopeType {
	case "my":
		if variant == nil || !containsStr(validTaskViewMyVariants, *variant) {
			return pgtype.Text{}, Invalid("invalid scope_variant for this scope_type")
		}
		return pgtype.Text{String: *variant, Valid: true}, nil
	default:
		if variant == nil || *variant == "" || *variant == "all" {
			return pgtype.Text{}, nil
		}
		if !containsStr(validTaskViewWorkspaceVariants, *variant) {
			return pgtype.Text{}, Invalid("invalid scope_variant for this scope_type")
		}
		return pgtype.Text{String: *variant, Valid: true}, nil
	}
}

func canReadTaskView(v db.TaskView, userID string) bool {
	return v.OwnerID == userID || v.Visibility == "workspace"
}

func (s *TaskService) canManageTaskView(ctx context.Context, v db.TaskView, actor Actor) bool {
	if actor.Kind != audit.KindHuman {
		return false
	}
	if v.OwnerID == actor.ID {
		return true
	}
	if v.Visibility != "workspace" {
		return false
	}
	m, err := s.ws.RequireMember(ctx, v.WorkspaceID, actor.ID)
	if err != nil {
		return false
	}
	return m.Role == "owner" || m.Role == "admin"
}

func (s *TaskService) CreateTaskView(ctx context.Context, actor Actor, workspaceID string, in CreateTaskViewInput) (db.TaskView, error) {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return db.TaskView{}, err
	}
	if actor.Kind != audit.KindHuman {
		return db.TaskView{}, ErrForbidden
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return db.TaskView{}, err
	}

	name := strings.TrimSpace(in.Name)
	if n := utf8.RuneCountInString(name); n < 1 || n > taskViewNameMaxLen {
		return db.TaskView{}, Invalid("name must be between 1 and 80 characters")
	}
	if !containsStr(validTaskViewScopeTypes, in.ScopeType) {
		return db.TaskView{}, Invalid("invalid scope_type")
	}
	visibility := in.Visibility
	if visibility == "" {
		visibility = "private"
	}
	if !containsStr(validTaskViewVisibilities, visibility) {
		return db.TaskView{}, Invalid("invalid visibility")
	}
	defVer := in.DefinitionVersion
	if defVer <= 0 {
		defVer = 1
	}
	if len(in.Query) == 0 || !isJSONObject(in.Query) {
		return db.TaskView{}, Invalid("query must be a JSON object")
	}
	display := in.Display
	if len(display) == 0 {
		display = json.RawMessage("{}")
	}
	if !isJSONObject(display) {
		return db.TaskView{}, Invalid("display must be a JSON object")
	}
	scopeVariant, err := validateTaskViewVariant(in.ScopeType, in.ScopeVariant)
	if err != nil {
		return db.TaskView{}, err
	}
	var scopeID pgtype.Text
	switch in.ScopeType {
	case "project":
		if in.ScopeID == nil || strings.TrimSpace(*in.ScopeID) == "" {
			return db.TaskView{}, Invalid("scope_id is required for project views")
		}
		if _, err := s.q.GetProject(ctx, db.GetProjectParams{
			ID: *in.ScopeID, OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return db.TaskView{}, ErrNotFound
			}
			return db.TaskView{}, err
		}
		scopeID = pgtype.Text{String: *in.ScopeID, Valid: true}
	case "my":
		visibility = "private"
	}

	owned, err := s.q.CountTaskViewsByOwner(ctx, db.CountTaskViewsByOwnerParams{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID, OwnerID: actor.ID,
	})
	if err != nil {
		return db.TaskView{}, err
	}
	if owned >= taskViewsPerOwnerMax {
		return db.TaskView{}, Invalid("view limit reached for this workspace")
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.TaskView{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	view, err := q.CreateTaskView(ctx, db.CreateTaskViewParams{
		ID: util.NewID(), OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		OwnerID: actor.ID, Name: name, ScopeType: in.ScopeType, ScopeID: scopeID,
		ScopeVariant: scopeVariant, Visibility: visibility, DefinitionVersion: defVer,
		Query: []byte(in.Query), Display: []byte(display),
	})
	if err != nil {
		return db.TaskView{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		Actor: actor, Action: audit.ActionTaskViewCreated,
		ResourceType: "task_view", ResourceID: view.ID,
	}, audit.Event{Topic: "task_view.created", Payload: map[string]string{
		"view_id": view.ID, "workspace_id": workspaceID,
	}}); err != nil {
		return db.TaskView{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.TaskView{}, err
	}
	return view, nil
}

func (s *TaskService) ListTaskViews(ctx context.Context, actor Actor, workspaceID, scopeType string, scopeID *string) ([]db.TaskView, error) {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return nil, err
	}
	if !containsStr(validTaskViewScopeTypes, scopeType) {
		return nil, Invalid("invalid scope_type")
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	return s.q.ListTaskViewsForUser(ctx, db.ListTaskViewsForUserParams{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		ScopeType: scopeType, OwnerID: actor.ID, ScopeID: optText(scopeID),
	})
}

func (s *TaskService) GetTaskView(ctx context.Context, actor Actor, workspaceID, viewID string) (db.TaskView, error) {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return db.TaskView{}, err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return db.TaskView{}, err
	}
	view, err := s.q.GetTaskView(ctx, db.GetTaskViewParams{
		ID: viewID, OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
	})
	if err != nil || !canReadTaskView(view, actor.ID) {
		return db.TaskView{}, ErrNotFound
	}
	return view, nil
}

func (s *TaskService) UpdateTaskView(ctx context.Context, actor Actor, workspaceID, viewID string, in UpdateTaskViewInput) (db.TaskView, error) {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return db.TaskView{}, err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return db.TaskView{}, err
	}
	view, err := s.q.GetTaskView(ctx, db.GetTaskViewParams{
		ID: viewID, OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
	})
	if err != nil || !canReadTaskView(view, actor.ID) {
		return db.TaskView{}, ErrNotFound
	}
	if !s.canManageTaskView(ctx, view, actor) {
		return db.TaskView{}, ErrForbidden
	}
	if in.ExpectedRevision <= 0 {
		return db.TaskView{}, Invalid("expected_revision is required")
	}

	name := view.Name
	if in.Name != nil {
		n := strings.TrimSpace(*in.Name)
		if rc := utf8.RuneCountInString(n); rc < 1 || rc > taskViewNameMaxLen {
			return db.TaskView{}, Invalid("name must be between 1 and 80 characters")
		}
		name = n
	}
	visibility := view.Visibility
	if in.Visibility != nil {
		if !containsStr(validTaskViewVisibilities, *in.Visibility) {
			return db.TaskView{}, Invalid("invalid visibility")
		}
		if view.ScopeType == "my" && *in.Visibility != "private" {
			return db.TaskView{}, Invalid("my views are always private")
		}
		visibility = *in.Visibility
	}
	query := view.Query
	if len(in.Query) > 0 {
		if !isJSONObject(in.Query) {
			return db.TaskView{}, Invalid("query must be a JSON object")
		}
		query = []byte(in.Query)
	}
	display := view.Display
	if len(in.Display) > 0 {
		if !isJSONObject(in.Display) {
			return db.TaskView{}, Invalid("display must be a JSON object")
		}
		display = []byte(in.Display)
	}
	scopeVariant := view.ScopeVariant
	if in.ScopeVariant != nil {
		next, err := validateTaskViewVariant(view.ScopeType, in.ScopeVariant)
		if err != nil {
			return db.TaskView{}, err
		}
		scopeVariant = next
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.TaskView{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	updated, err := q.UpdateTaskView(ctx, db.UpdateTaskViewParams{
		ID: viewID, OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		Name: name, Visibility: visibility, ScopeVariant: scopeVariant,
		Query: query, Display: display, Revision: in.ExpectedRevision,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.TaskView{}, CheckTaskRevision(in.ExpectedRevision, view.Revision)
	}
	if err != nil {
		return db.TaskView{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		Actor: actor, Action: audit.ActionTaskViewUpdated,
		ResourceType: "task_view", ResourceID: updated.ID,
	}, audit.Event{Topic: "task_view.updated", Payload: map[string]string{
		"view_id": updated.ID, "workspace_id": workspaceID,
	}}); err != nil {
		return db.TaskView{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.TaskView{}, err
	}
	return updated, nil
}

func (s *TaskService) DeleteTaskView(ctx context.Context, actor Actor, workspaceID, viewID string) error {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return err
	}
	view, err := s.q.GetTaskView(ctx, db.GetTaskViewParams{
		ID: viewID, OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
	})
	if err != nil || !canReadTaskView(view, actor.ID) {
		return ErrNotFound
	}
	if !s.canManageTaskView(ctx, view, actor) {
		return ErrForbidden
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	if _, err := q.DeleteTaskView(ctx, db.DeleteTaskViewParams{
		ID: viewID, OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
	}); err != nil {
		return err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		Actor: actor, Action: audit.ActionTaskViewDeleted,
		ResourceType: "task_view", ResourceID: viewID,
	}, audit.Event{Topic: "task_view.deleted", Payload: map[string]string{
		"view_id": viewID, "workspace_id": workspaceID,
	}}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *TaskService) resolvePreferenceScopeID(ctx context.Context, ws db.Workspace, actor Actor, scopeType string, rawScopeID *string) (string, error) {
	switch scopeType {
	case "workspace":
		return ws.ID, nil
	case "my":
		return actor.ID, nil
	case "project":
		if rawScopeID == nil || strings.TrimSpace(*rawScopeID) == "" {
			return "", Invalid("scope_id is required for project scope")
		}
		if _, err := s.q.GetProject(ctx, db.GetProjectParams{
			ID: *rawScopeID, OrganizationID: ws.OrganizationID, WorkspaceID: ws.ID,
		}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return "", ErrNotFound
			}
			return "", err
		}
		return *rawScopeID, nil
	default:
		return "", Invalid("invalid scope_type")
	}
}

func (s *TaskService) GetTaskViewPreference(ctx context.Context, actor Actor, workspaceID, scopeType string, scopeID *string) (TaskViewPreferenceView, error) {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return TaskViewPreferenceView{}, err
	}
	if actor.Kind != audit.KindHuman {
		return TaskViewPreferenceView{}, ErrForbidden
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return TaskViewPreferenceView{}, err
	}
	resolved, err := s.resolvePreferenceScopeID(ctx, ws, actor, scopeType, scopeID)
	if err != nil {
		return TaskViewPreferenceView{}, err
	}
	pref, err := s.q.GetTaskViewPreference(ctx, db.GetTaskViewPreferenceParams{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		UserID: actor.ID, ScopeType: scopeType, ScopeID: resolved,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return TaskViewPreferenceView{
			OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID, UserID: actor.ID,
			ScopeType: scopeType, ScopeID: resolved, Prefs: json.RawMessage("{}"),
		}, nil
	}
	if err != nil {
		return TaskViewPreferenceView{}, err
	}
	return TaskViewPreferenceView{
		OrganizationID: pref.OrganizationID, WorkspaceID: pref.WorkspaceID, UserID: pref.UserID,
		ScopeType: pref.ScopeType, ScopeID: pref.ScopeID, Prefs: json.RawMessage(pref.Prefs),
		UpdatedAt: pref.UpdatedAt,
	}, nil
}

func (s *TaskService) PutTaskViewPreference(ctx context.Context, actor Actor, workspaceID string, in PutTaskViewPreferenceInput) (TaskViewPreferenceView, error) {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return TaskViewPreferenceView{}, err
	}
	if actor.Kind != audit.KindHuman {
		return TaskViewPreferenceView{}, ErrForbidden
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return TaskViewPreferenceView{}, err
	}
	resolved, err := s.resolvePreferenceScopeID(ctx, ws, actor, in.ScopeType, in.ScopeID)
	if err != nil {
		return TaskViewPreferenceView{}, err
	}
	prefs := in.Prefs
	if len(prefs) == 0 {
		prefs = json.RawMessage("{}")
	}
	if !isJSONObject(prefs) {
		return TaskViewPreferenceView{}, Invalid("prefs must be a JSON object")
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return TaskViewPreferenceView{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	pref, err := q.UpsertTaskViewPreference(ctx, db.UpsertTaskViewPreferenceParams{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		UserID: actor.ID, ScopeType: in.ScopeType, ScopeID: resolved, Prefs: []byte(prefs),
	})
	if err != nil {
		return TaskViewPreferenceView{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		Actor: actor, Action: audit.ActionTaskViewPreferenceUpdated,
		ResourceType: "task_view_preference", ResourceID: workspaceID + ":" + actor.ID + ":" + in.ScopeType + ":" + resolved,
	}, audit.Event{Topic: "task_view_preference.updated", Payload: map[string]string{
		"workspace_id": workspaceID, "user_id": actor.ID, "scope_id": resolved,
	}}); err != nil {
		return TaskViewPreferenceView{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return TaskViewPreferenceView{}, err
	}
	return TaskViewPreferenceView{
		OrganizationID: pref.OrganizationID, WorkspaceID: pref.WorkspaceID, UserID: pref.UserID,
		ScopeType: pref.ScopeType, ScopeID: pref.ScopeID, Prefs: json.RawMessage(pref.Prefs),
		UpdatedAt: pref.UpdatedAt,
	}, nil
}
