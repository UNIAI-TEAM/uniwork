package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type normalizedResource struct {
	Type     string
	Ref      []byte
	Label    *string
	Position int32
}

func (s *TaskService) ListProjectResources(ctx context.Context, actor Actor, workspaceID, projectID string) ([]db.ProjectResource, error) {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return nil, err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	if _, err := s.loadProject(ctx, s.q, ws.OrganizationID, workspaceID, projectID); err != nil {
		return nil, err
	}
	return s.q.ListProjectResources(ctx, db.ListProjectResourcesParams{
		ProjectID: projectID, OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
	})
}

func (s *TaskService) CreateProjectResource(ctx context.Context, actor Actor, workspaceID, projectID string, in CreateProjectResourceInput) (db.ProjectResource, error) {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return db.ProjectResource{}, err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return db.ProjectResource{}, err
	}
	if _, err := s.loadProject(ctx, s.q, ws.OrganizationID, workspaceID, projectID); err != nil {
		return db.ProjectResource{}, err
	}
	nr, err := normalizeResourceInput(in)
	if err != nil {
		return db.ProjectResource{}, Invalid(err.Error())
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.ProjectResource{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	row, err := q.CreateProjectResource(ctx, db.CreateProjectResourceParams{
		ID: util.NewID(), OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		ProjectID: projectID, ResourceType: nr.Type, ResourceRef: nr.Ref,
		Label: optText(nr.Label), Position: nr.Position,
		CreatedBy: actor.ID, CreatedByKind: string(actor.Kind),
	})
	if err != nil {
		return db.ProjectResource{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		Actor: actor, Action: audit.ActionProjectResourceCreated,
		ResourceType: "project_resource", ResourceID: row.ID,
	}, audit.Event{Topic: "project_resource.created", Payload: map[string]string{
		"resource_id": row.ID, "project_id": projectID, "workspace_id": workspaceID,
	}}); err != nil {
		return db.ProjectResource{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.ProjectResource{}, err
	}
	return row, nil
}

func (s *TaskService) UpdateProjectResource(ctx context.Context, actor Actor, workspaceID, projectID, resourceID string, in UpdateProjectResourceInput) (db.ProjectResource, error) {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return db.ProjectResource{}, err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return db.ProjectResource{}, err
	}
	existing, err := s.loadProjectResource(ctx, s.q, ws.OrganizationID, workspaceID, projectID, resourceID)
	if err != nil {
		return db.ProjectResource{}, err
	}
	var ref []byte
	if len(in.ResourceRef) > 0 {
		normalized, err := validateAndNormalizeResourceRef(existing.ResourceType, in.ResourceRef)
		if err != nil {
			return db.ProjectResource{}, Invalid(err.Error())
		}
		ref = normalized
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.ProjectResource{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	updated, err := q.UpdateProjectResource(ctx, db.UpdateProjectResourceParams{
		ID: resourceID, ProjectID: projectID,
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		ResourceRef: ref, Label: optText(in.Label), Position: optInt32(in.Position),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.ProjectResource{}, ErrNotFound
	}
	if err != nil {
		return db.ProjectResource{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		Actor: actor, Action: audit.ActionProjectResourceUpdated,
		ResourceType: "project_resource", ResourceID: resourceID,
	}, audit.Event{Topic: "project_resource.updated", Payload: map[string]string{
		"resource_id": resourceID, "project_id": projectID, "workspace_id": workspaceID,
	}}); err != nil {
		return db.ProjectResource{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.ProjectResource{}, err
	}
	return updated, nil
}

func (s *TaskService) DeleteProjectResource(ctx context.Context, actor Actor, workspaceID, projectID, resourceID string) error {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return err
	}
	if _, err := s.loadProjectResource(ctx, s.q, ws.OrganizationID, workspaceID, projectID, resourceID); err != nil {
		return err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	n, err := q.DeleteProjectResource(ctx, db.DeleteProjectResourceParams{
		ID: resourceID, ProjectID: projectID,
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
	})
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		Actor: actor, Action: audit.ActionProjectResourceDeleted,
		ResourceType: "project_resource", ResourceID: resourceID,
	}, audit.Event{Topic: "project_resource.deleted", Payload: map[string]string{
		"resource_id": resourceID, "project_id": projectID, "workspace_id": workspaceID,
	}}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *TaskService) loadProjectResource(ctx context.Context, q *db.Queries, orgID, workspaceID, projectID, resourceID string) (db.ProjectResource, error) {
	row, err := q.GetProjectResource(ctx, db.GetProjectResourceParams{
		ID: resourceID, ProjectID: projectID, OrganizationID: orgID, WorkspaceID: workspaceID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.ProjectResource{}, ErrNotFound
	}
	return row, err
}

func normalizeResourceInput(in CreateProjectResourceInput) (normalizedResource, error) {
	typ := strings.TrimSpace(in.ResourceType)
	if typ == "" {
		return normalizedResource{}, errors.New("resource_type is required")
	}
	ref, err := validateAndNormalizeResourceRef(typ, in.ResourceRef)
	if err != nil {
		return normalizedResource{}, err
	}
	pos := int32(0)
	if in.Position != nil {
		pos = *in.Position
	}
	return normalizedResource{Type: typ, Ref: ref, Label: in.Label, Position: pos}, nil
}

func validateAndNormalizeResourceRef(resourceType string, ref json.RawMessage) ([]byte, error) {
	if len(ref) == 0 {
		return nil, errors.New("resource_ref is required")
	}
	switch resourceType {
	case "github_repo":
		return validateGithubRepoRef(ref)
	case "local_directory":
		return validateLocalDirectoryRef(ref)
	default:
		if !containsStr(validResourceTypes, resourceType) {
			return nil, fmt.Errorf("unknown resource_type %q", resourceType)
		}
		return nil, fmt.Errorf("unknown resource_type %q", resourceType)
	}
}

type githubRepoRef struct {
	URL               string `json:"url"`
	DefaultBranchHint string `json:"default_branch_hint,omitempty"`
	Ref               string `json:"ref,omitempty"`
}

func validateGithubRepoRef(ref json.RawMessage) ([]byte, error) {
	var payload githubRepoRef
	if err := json.Unmarshal(ref, &payload); err != nil {
		return nil, fmt.Errorf("invalid github_repo payload: %w", err)
	}
	payload.URL = strings.TrimSpace(payload.URL)
	if payload.URL == "" {
		return nil, errors.New("github_repo: url is required")
	}
	if !isValidGitRepoURL(payload.URL) {
		return nil, errors.New("github_repo: url must be a valid http(s) or ssh git URL")
	}
	payload.DefaultBranchHint = strings.TrimSpace(payload.DefaultBranchHint)
	payload.Ref = strings.TrimSpace(payload.Ref)
	return json.Marshal(payload)
}

type localDirectoryRef struct {
	LocalPath     string `json:"local_path"`
	DaemonID      string `json:"daemon_id"`
	Label         string `json:"label,omitempty"`
	ExecutionMode string `json:"execution_mode,omitempty"`
}

func validateLocalDirectoryRef(ref json.RawMessage) ([]byte, error) {
	var payload localDirectoryRef
	if err := json.Unmarshal(ref, &payload); err != nil {
		return nil, fmt.Errorf("invalid local_directory payload: %w", err)
	}
	payload.LocalPath = strings.TrimSpace(payload.LocalPath)
	payload.DaemonID = strings.TrimSpace(payload.DaemonID)
	if payload.LocalPath == "" {
		return nil, errors.New("local_directory: local_path is required")
	}
	if payload.DaemonID == "" {
		return nil, errors.New("local_directory: daemon_id is required")
	}
	payload.Label = strings.TrimSpace(payload.Label)
	payload.ExecutionMode = strings.TrimSpace(payload.ExecutionMode)
	if payload.ExecutionMode == "" {
		payload.ExecutionMode = "in_place"
	}
	if payload.ExecutionMode != "in_place" && payload.ExecutionMode != "worktree" {
		return nil, errors.New("local_directory: execution_mode must be in_place or worktree")
	}
	return json.Marshal(payload)
}

func isValidGitRepoURL(raw string) bool {
	if strings.HasPrefix(raw, "git@") {
		return strings.Contains(raw, ":")
	}
	u, err := url.Parse(raw)
	if err != nil {
		return false
	}
	if u.Scheme != "http" && u.Scheme != "https" && u.Scheme != "ssh" {
		return false
	}
	return u.Host != ""
}

func optInt32(v *int32) pgtype.Int4 {
	if v == nil {
		return pgtype.Int4{}
	}
	return pgtype.Int4{Int32: *v, Valid: true}
}
