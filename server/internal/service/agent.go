package service

import (
	"context"
	"errors"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Agents belong to an organization and join workspaces through
// workspace_agent_members (OPEN_QUESTIONS AG1). This service owns their
// identity only; runs, proposals and the executor are A-01.
type AgentService struct {
	pool *pgxpool.Pool
	q    *db.Queries
	orgs *OrganizationService
	ws   *WorkspaceService
}

func NewAgentService(pool *pgxpool.Pool, q *db.Queries, orgs *OrganizationService, ws *WorkspaceService) *AgentService {
	return &AgentService{pool: pool, q: q, orgs: orgs, ws: ws}
}

// DefaultAgentHandle is the organization's built-in agent (OPEN_QUESTIONS AG6),
// seeded when the organization is created and renameable by its admins.
const DefaultAgentHandle = "uni"

// defaultAutonomyPolicy: everything waits for a person (spec §5.4).
const defaultAutonomyPolicy = `{"low":"approve","medium":"approve","high":"approve","critical":"deny"}`

var agentHandlePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{1,31}$`)

type CreateAgentInput struct {
	Name        string
	Handle      string
	Description string
	AvatarURL   *string
}

type UpdateAgentInput struct {
	Name        *string
	Description *string
	AvatarURL   *string
	Status      *string
}

var validAgentStatus = map[string]bool{"active": true, "paused": true, "archived": true}

func (s *AgentService) requireOrgAdmin(ctx context.Context, orgID, userID string) error {
	m, err := s.orgs.RequireMember(ctx, orgID, userID)
	if err != nil {
		return err
	}
	if !adminLikeRole(m.Role) {
		return ErrForbidden
	}
	return nil
}

// Create: organization owner/admin only (OPEN_QUESTIONS AG2).
func (s *AgentService) Create(ctx context.Context, userID, orgID string, in CreateAgentInput) (db.Agent, error) {
	if err := s.requireOrgAdmin(ctx, orgID, userID); err != nil {
		return db.Agent{}, err
	}
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return db.Agent{}, Invalid("tên agent không được để trống")
	}
	if !agentHandlePattern.MatchString(in.Handle) {
		return db.Agent{}, Invalid("handle chỉ gồm chữ thường, số, '-' hoặc '_', 2–32 ký tự")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.Agent{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	a, err := createAgent(ctx, q, orgID, name, in.Handle, in.Description, in.AvatarURL, userID, Human(userID))
	if err != nil {
		return db.Agent{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.Agent{}, err
	}
	return a, nil
}

// createAgent inserts the row and its audit entry on the caller's transaction.
// OrganizationService.Create uses it to seed the default agent.
func createAgent(ctx context.Context, q *db.Queries, orgID, name, handle, description string, avatarURL *string, ownerUserID string, actor Actor) (db.Agent, error) {
	a, err := q.CreateAgent(ctx, db.CreateAgentParams{
		ID: util.NewID(), OrganizationID: orgID, Name: name, Handle: handle,
		Description: description, AvatarUrl: optText(avatarURL), OwnerUserID: ownerUserID,
		AutonomyPolicy: defaultAutonomyPolicy,
		CreatedBy:      actor.ID, CreatedByKind: string(actor.Kind),
	})
	if isUniqueViolation(err) {
		return db.Agent{}, ErrConflict
	}
	if err != nil {
		return db.Agent{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID,
		Actor:          actor,
		Action:         audit.ActionAgentCreated,
		ResourceType:   "agent", ResourceID: a.ID,
		Changes: audit.Diff(nil, agentAuditFields(a)),
	}); err != nil {
		return db.Agent{}, err
	}
	return a, nil
}

func agentAuditFields(a db.Agent) map[string]any {
	return map[string]any{
		"name": a.Name, "handle": a.Handle, "status": a.Status, "owner_user_id": a.OwnerUserID,
	}
}

// List: any organization member sees the organization's agents.
func (s *AgentService) List(ctx context.Context, userID, orgID string) ([]db.Agent, error) {
	if _, err := s.orgs.RequireMember(ctx, orgID, userID); err != nil {
		return nil, err
	}
	return s.q.ListAgentsInOrg(ctx, orgID)
}

// Update: organization admin or the agent's owner.
func (s *AgentService) Update(ctx context.Context, userID, agentID string, in UpdateAgentInput) (db.Agent, error) {
	before, err := s.q.GetAgent(ctx, agentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Agent{}, ErrNotFound
	}
	if err != nil {
		return db.Agent{}, err
	}
	m, err := s.orgs.RequireMember(ctx, before.OrganizationID, userID)
	if err != nil {
		return db.Agent{}, ErrNotFound // do not reveal the agent to a non-member
	}
	if !adminLikeRole(m.Role) && before.OwnerUserID != userID {
		return db.Agent{}, ErrForbidden
	}
	if in.Name != nil && strings.TrimSpace(*in.Name) == "" {
		return db.Agent{}, Invalid("tên agent không được để trống")
	}
	if in.Status != nil && !validAgentStatus[*in.Status] {
		return db.Agent{}, Invalid("status không hợp lệ")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.Agent{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	a, err := q.UpdateAgent(ctx, db.UpdateAgentParams{
		ID: agentID, Name: optText(in.Name), Description: optText(in.Description),
		AvatarUrl: optText(in.AvatarURL), Status: optText(in.Status),
	})
	if err != nil {
		return db.Agent{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: a.OrganizationID,
		Actor:          Human(userID),
		Action:         audit.ActionAgentUpdated,
		ResourceType:   "agent", ResourceID: a.ID,
		Changes: audit.Diff(agentAuditFields(before), agentAuditFields(a)),
	}); err != nil {
		return db.Agent{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.Agent{}, err
	}
	return a, nil
}

// AddToWorkspace: workspace admin-like caller; the agent must be active and
// belong to the workspace's organization.
func (s *AgentService) AddToWorkspace(ctx context.Context, userID, workspaceID, agentID string) error {
	m, err := s.ws.RequireMember(ctx, workspaceID, userID)
	if err != nil {
		return err
	}
	if !adminLikeRole(m.Role) {
		return ErrForbidden
	}
	w, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return err
	}
	a, err := s.q.GetAgent(ctx, agentID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && a.OrganizationID != w.OrganizationID) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if a.Status != "active" {
		return Invalid("agent không ở trạng thái active")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	if err := addAgentToWorkspace(ctx, q, w, a.ID, Human(userID)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func addAgentToWorkspace(ctx context.Context, q *db.Queries, w db.Workspace, agentID string, actor Actor) error {
	if err := q.AddWorkspaceAgentMember(ctx, db.AddWorkspaceAgentMemberParams{
		WorkspaceID: w.ID, AgentID: agentID, OrganizationID: w.OrganizationID,
		CreatedBy: actor.ID, CreatedByKind: string(actor.Kind),
	}); err != nil {
		return err
	}
	return auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: w.OrganizationID, WorkspaceID: w.ID,
		Actor:        actor,
		Action:       audit.ActionWorkspaceAgentAdded,
		ResourceType: "workspace_agent_member", ResourceID: agentID,
		Changes: audit.Diff(nil, map[string]any{"role": "agent"}),
	}, audit.Event{Topic: "workspace_agent.added", Payload: map[string]string{
		"workspace_id": w.ID, "agent_id": agentID,
	}})
}

// ListInWorkspace: what a member sees in the assignee picker.
func (s *AgentService) ListInWorkspace(ctx context.Context, userID, workspaceID string) ([]db.ListWorkspaceAgentsRow, error) {
	if _, err := s.ws.RequireMember(ctx, workspaceID, userID); err != nil {
		return nil, err
	}
	return s.q.ListWorkspaceAgents(ctx, workspaceID)
}
