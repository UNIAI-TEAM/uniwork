package service

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const projectTitleMaxLen = 200

var (
	validProjectStatuses   = []string{"planned", "in_progress", "paused", "completed", "cancelled"}
	validProjectPriorities = []string{"urgent", "high", "medium", "low", "none"}
	validProjectLeadTypes  = []string{"member", "agent"}
	validResourceTypes     = []string{"github_repo", "local_directory"}
)

type CreateProjectInput struct {
	Title       string
	Description *string
	Icon        *string
	Status      string
	Priority    string
	LeadType    *string
	LeadID      *string
	StartDate   *string
	DueDate     *string
	Resources   []CreateProjectResourceInput
}

type UpdateProjectInput struct {
	Title       *string
	Description *string
	Icon        *string
	Status      *string
	Priority    *string
	LeadType    *string
	LeadID      *string
	StartDate   *string
	DueDate     *string
}

type ListProjectsFilter struct {
	Status   *string
	Priority *string
}

type SearchProjectsInput struct {
	Q             string
	IncludeClosed bool
	Limit         int32
	Offset        int32
}

type CreateProjectResourceInput struct {
	ResourceType string
	ResourceRef  json.RawMessage
	Label        *string
	Position     *int32
}

type UpdateProjectResourceInput struct {
	ResourceRef json.RawMessage
	Label       *string
	Position    *int32
}

type ProjectView struct {
	Project       db.Project
	TaskCount     int64
	DoneCount     int64
	ResourceCount int64
}

func (s *TaskService) CreateProject(ctx context.Context, actor Actor, workspaceID string, in CreateProjectInput) (db.Project, error) {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return db.Project{}, err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return db.Project{}, err
	}
	title := strings.TrimSpace(in.Title)
	if n := utf8.RuneCountInString(title); n < 1 || n > projectTitleMaxLen {
		return db.Project{}, Invalid("title must be between 1 and 200 characters")
	}
	status := in.Status
	if status == "" {
		status = "planned"
	}
	if !containsStr(validProjectStatuses, status) {
		return db.Project{}, Invalid("invalid status")
	}
	priority := in.Priority
	if priority == "" {
		priority = "none"
	}
	if !containsStr(validProjectPriorities, priority) {
		return db.Project{}, Invalid("invalid priority")
	}
	leadType, leadID, err := normalizeProjectLead(in.LeadType, in.LeadID)
	if err != nil {
		return db.Project{}, err
	}
	startDate, err := parseProjectDate(in.StartDate, "start_date")
	if err != nil {
		return db.Project{}, err
	}
	dueDate, err := parseProjectDate(in.DueDate, "due_date")
	if err != nil {
		return db.Project{}, err
	}
	desc := ""
	if in.Description != nil {
		desc = *in.Description
	}
	normalizedResources := make([]normalizedResource, 0, len(in.Resources))
	for i, res := range in.Resources {
		nr, err := normalizeResourceInput(res)
		if err != nil {
			return db.Project{}, Invalid("resources[" + strconv.Itoa(i) + "]: " + err.Error())
		}
		normalizedResources = append(normalizedResources, nr)
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.Project{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	project, err := q.CreateProject(ctx, db.CreateProjectParams{
		ID: util.NewID(), OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		Title: title, Description: desc, Icon: optText(in.Icon), Status: status, Priority: priority,
		LeadType: leadType, LeadID: leadID, StartDate: startDate, DueDate: dueDate,
		Revision: 1, CreatedBy: actor.ID, CreatedByKind: string(actor.Kind),
	})
	if err != nil {
		return db.Project{}, err
	}
	for _, res := range normalizedResources {
		if _, err := q.CreateProjectResource(ctx, db.CreateProjectResourceParams{
			ID: util.NewID(), OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
			ProjectID: project.ID, ResourceType: res.Type, ResourceRef: res.Ref,
			Label: optText(res.Label), Position: res.Position,
			CreatedBy: actor.ID, CreatedByKind: string(actor.Kind),
		}); err != nil {
			return db.Project{}, err
		}
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		Actor: actor, Action: audit.ActionProjectCreated,
		ResourceType: "project", ResourceID: project.ID,
	}, audit.Event{Topic: "project.created", Payload: map[string]string{
		"project_id": project.ID, "workspace_id": workspaceID,
	}}); err != nil {
		return db.Project{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.Project{}, err
	}
	return project, nil
}

func (s *TaskService) ListProjects(ctx context.Context, actor Actor, workspaceID string, filter ListProjectsFilter) ([]db.Project, error) {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return nil, err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	if filter.Status != nil && !containsStr(validProjectStatuses, *filter.Status) {
		return nil, Invalid("invalid status")
	}
	if filter.Priority != nil && !containsStr(validProjectPriorities, *filter.Priority) {
		return nil, Invalid("invalid priority")
	}
	return s.q.ListProjects(ctx, db.ListProjectsParams{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		Status: optText(filter.Status), Priority: optText(filter.Priority),
	})
}

func (s *TaskService) SearchProjects(ctx context.Context, actor Actor, workspaceID string, in SearchProjectsInput) ([]db.Project, error) {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return nil, err
	}
	q := strings.TrimSpace(in.Q)
	if q == "" {
		return nil, Invalid("q parameter is required")
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	limit := in.Limit
	if limit <= 0 {
		limit = 20
	}
	if limit > 50 {
		limit = 50
	}
	offset := in.Offset
	if offset < 0 {
		offset = 0
	}
	return s.q.SearchProjects(ctx, db.SearchProjectsParams{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		Q: pgtype.Text{String: q, Valid: true}, IncludeClosed: in.IncludeClosed,
		LimitCount: limit, OffsetCount: offset,
	})
}

func (s *TaskService) GetProject(ctx context.Context, actor Actor, workspaceID, projectID string) (db.Project, error) {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return db.Project{}, err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return db.Project{}, err
	}
	return s.loadProject(ctx, s.q, ws.OrganizationID, workspaceID, projectID)
}

func (s *TaskService) UpdateProject(ctx context.Context, actor Actor, workspaceID, projectID string, in UpdateProjectInput) (db.Project, error) {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return db.Project{}, err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return db.Project{}, err
	}
	if _, err := s.loadProject(ctx, s.q, ws.OrganizationID, workspaceID, projectID); err != nil {
		return db.Project{}, err
	}
	var title pgtype.Text
	if in.Title != nil {
		t := strings.TrimSpace(*in.Title)
		if n := utf8.RuneCountInString(t); n < 1 || n > projectTitleMaxLen {
			return db.Project{}, Invalid("title must be between 1 and 200 characters")
		}
		title = pgtype.Text{String: t, Valid: true}
	}
	if in.Status != nil && !containsStr(validProjectStatuses, *in.Status) {
		return db.Project{}, Invalid("invalid status")
	}
	if in.Priority != nil && !containsStr(validProjectPriorities, *in.Priority) {
		return db.Project{}, Invalid("invalid priority")
	}
	leadType, leadID, err := normalizeProjectLead(in.LeadType, in.LeadID)
	if err != nil {
		return db.Project{}, err
	}
	// Only touch lead columns when the caller sent either field.
	var leadTypeArg, leadIDArg pgtype.Text
	if in.LeadType != nil || in.LeadID != nil {
		leadTypeArg, leadIDArg = leadType, leadID
	}
	startDate, err := parseProjectDate(in.StartDate, "start_date")
	if err != nil {
		return db.Project{}, err
	}
	dueDate, err := parseProjectDate(in.DueDate, "due_date")
	if err != nil {
		return db.Project{}, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.Project{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	updated, err := q.UpdateProject(ctx, db.UpdateProjectParams{
		ID: projectID, OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		Title: title, Description: optText(in.Description), Icon: optText(in.Icon),
		Status: optText(in.Status), Priority: optText(in.Priority),
		LeadType: leadTypeArg, LeadID: leadIDArg, StartDate: startDate, DueDate: dueDate,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Project{}, ErrNotFound
	}
	if err != nil {
		return db.Project{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		Actor: actor, Action: audit.ActionProjectUpdated,
		ResourceType: "project", ResourceID: projectID,
	}, audit.Event{Topic: "project.updated", Payload: map[string]string{
		"project_id": projectID, "workspace_id": workspaceID,
	}}); err != nil {
		return db.Project{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.Project{}, err
	}
	return updated, nil
}

func (s *TaskService) DeleteProject(ctx context.Context, actor Actor, workspaceID, projectID string) error {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return err
	}
	if _, err := s.loadProject(ctx, s.q, ws.OrganizationID, workspaceID, projectID); err != nil {
		return err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	if err := q.DeleteProjectResourcesByProject(ctx, db.DeleteProjectResourcesByProjectParams{
		ProjectID: projectID, OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
	}); err != nil {
		return err
	}
	if err := q.ClearTasksProjectID(ctx, db.ClearTasksProjectIDParams{
		ProjectID:      pgtype.Text{String: projectID, Valid: true},
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
	}); err != nil {
		return err
	}
	if err := q.DeleteTaskViewsByProjectScope(ctx, db.DeleteTaskViewsByProjectScopeParams{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		ScopeID: pgtype.Text{String: projectID, Valid: true},
	}); err != nil {
		return err
	}
	if err := q.DeleteTaskPinsByItem(ctx, db.DeleteTaskPinsByItemParams{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		ItemType: "project", ItemID: projectID,
	}); err != nil {
		return err
	}
	n, err := q.DeleteProject(ctx, db.DeleteProjectParams{
		ID: projectID, OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
	})
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		Actor: actor, Action: audit.ActionProjectDeleted,
		ResourceType: "project", ResourceID: projectID,
	}, audit.Event{Topic: "project.deleted", Payload: map[string]string{
		"project_id": projectID, "workspace_id": workspaceID,
	}}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *TaskService) ProjectStats(ctx context.Context, actor Actor, workspaceID string, projects []db.Project) (map[string]ProjectView, error) {
	out := make(map[string]ProjectView, len(projects))
	for _, p := range projects {
		out[p.ID] = ProjectView{Project: p}
	}
	if len(projects) == 0 {
		return out, nil
	}
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return nil, err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	ids := make([]string, len(projects))
	for i, p := range projects {
		ids[i] = p.ID
	}
	stats, err := s.q.GetProjectTaskStats(ctx, db.GetProjectTaskStatsParams{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID, ProjectIds: ids,
	})
	if err != nil {
		return nil, err
	}
	for _, row := range stats {
		if !row.ProjectID.Valid {
			continue
		}
		v := out[row.ProjectID.String]
		v.TaskCount = row.TotalCount
		v.DoneCount = row.DoneCount
		out[row.ProjectID.String] = v
	}
	counts, err := s.q.GetProjectResourceCounts(ctx, db.GetProjectResourceCountsParams{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID, ProjectIds: ids,
	})
	if err != nil {
		return nil, err
	}
	for _, row := range counts {
		v := out[row.ProjectID]
		v.ResourceCount = row.ResourceCount
		out[row.ProjectID] = v
	}
	return out, nil
}

func (s *TaskService) loadProject(ctx context.Context, q *db.Queries, orgID, workspaceID, projectID string) (db.Project, error) {
	p, err := q.GetProject(ctx, db.GetProjectParams{
		ID: projectID, OrganizationID: orgID, WorkspaceID: workspaceID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Project{}, ErrNotFound
	}
	return p, err
}

func normalizeProjectLead(leadType, leadID *string) (pgtype.Text, pgtype.Text, error) {
	lt := ""
	if leadType != nil {
		lt = strings.TrimSpace(*leadType)
	}
	lid := ""
	if leadID != nil {
		lid = strings.TrimSpace(*leadID)
	}
	if lt == "" && lid == "" {
		return pgtype.Text{}, pgtype.Text{}, nil
	}
	if lt == "" || lid == "" {
		return pgtype.Text{}, pgtype.Text{}, Invalid("lead_type and lead_id must both be set or both empty")
	}
	if !containsStr(validProjectLeadTypes, lt) {
		return pgtype.Text{}, pgtype.Text{}, Invalid("invalid lead_type")
	}
	return pgtype.Text{String: lt, Valid: true}, pgtype.Text{String: lid, Valid: true}, nil
}

func parseProjectDate(raw *string, field string) (pgtype.Date, error) {
	if raw == nil || strings.TrimSpace(*raw) == "" {
		return pgtype.Date{}, nil
	}
	d, err := util.ParseCalendarDate(strings.TrimSpace(*raw))
	if err != nil {
		return pgtype.Date{}, Invalid(field + " must be YYYY-MM-DD")
	}
	return d, nil
}
