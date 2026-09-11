package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// fixture: owner A with org + workspace, outsider B with their own org.
func agentFixture(t *testing.T) (*AgentService, *TaskService, *WorkspaceService, db.User, db.User, db.Organization, db.Workspace) {
	t.Helper()
	pool := testutil.DB(t)
	q := db.New(pool)
	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	orgs := NewOrganizationService(pool, q)
	ws := NewWorkspaceService(pool, q, orgs, mail.Renderer{AppURL: "http://localhost:3000"}, &fakeOutbox{})
	ctx := context.Background()
	ua := registerVerified(t, q, as, "agent-a@example.com", "A")
	ub := registerVerified(t, q, as, "agent-b@example.com", "B")
	org, err := orgs.Create(ctx, ua.ID, "Org", "org-agents")
	if err != nil {
		t.Fatal(err)
	}
	v, err := ws.CreateInOrg(ctx, ua.ID, org.ID, "Alpha", "alpha")
	if err != nil {
		t.Fatal(err)
	}
	return NewAgentService(pool, q, orgs, ws), NewTaskService(pool, q, ws, nil), ws, ua, ub, org, v.Workspace
}

func TestDefaultAgentSeededAndJoinsWorkspaces(t *testing.T) {
	agents, _, ws, ua, ub, org, w := agentFixture(t)
	ctx := context.Background()

	list, err := agents.List(ctx, ua.ID, org.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].Handle != DefaultAgentHandle || list[0].OwnerUserID != ua.ID {
		t.Fatalf("default agent: %+v", list)
	}
	uni := list[0]
	if uni.CreatedByKind != string(audit.KindSystem) {
		t.Fatalf("seeded agent is created by the system, got %q", uni.CreatedByKind)
	}
	if _, err := ws.RequireAgentMember(ctx, w.ID, uni.ID); err != nil {
		t.Fatalf("UNI joins the first workspace: %v", err)
	}
	inWS, err := agents.ListInWorkspace(ctx, ua.ID, w.ID)
	if err != nil || len(inWS) != 1 {
		t.Fatalf("ListInWorkspace: %v %+v", err, inWS)
	}
	// An outsider sees nothing: not the organization's agents, not the workspace's.
	if _, err := agents.List(ctx, ub.ID, org.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("other org lists agents: %v", err)
	}
	if _, err := agents.ListInWorkspace(ctx, ub.ID, w.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("other org lists workspace agents: %v", err)
	}
}

func TestAgentCreateUpdateGates(t *testing.T) {
	agents, _, _, ua, ub, org, _ := agentFixture(t)
	ctx := context.Background()

	if _, err := agents.Create(ctx, ub.ID, org.ID, CreateAgentInput{Name: "X", Handle: "x-bot"}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("non-member creates: %v", err)
	}
	if _, err := agents.Create(ctx, ua.ID, org.ID, CreateAgentInput{Name: "X", Handle: "Bad Handle"}); err == nil {
		t.Fatal("invalid handle accepted")
	}
	a, err := agents.Create(ctx, ua.ID, org.ID, CreateAgentInput{Name: "Reviewer", Handle: "reviewer"})
	if err != nil {
		t.Fatal(err)
	}
	if a.Status != "active" || a.CreatedByKind != string(audit.KindHuman) || a.AutonomyPolicy != defaultAutonomyPolicy {
		t.Fatalf("defaults: %+v", a)
	}
	if _, err := agents.Create(ctx, ua.ID, org.ID, CreateAgentInput{Name: "Dup", Handle: "reviewer"}); !errors.Is(err, ErrConflict) {
		t.Fatalf("duplicate handle: %v", err)
	}
	// Outsider: the agent does not exist for them.
	name := "Hacked"
	if _, err := agents.Update(ctx, ub.ID, a.ID, UpdateAgentInput{Name: &name}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("other org updates: %v", err)
	}
	paused := "paused"
	up, err := agents.Update(ctx, ua.ID, a.ID, UpdateAgentInput{Status: &paused})
	if err != nil || up.Status != "paused" {
		t.Fatalf("pause: %v %+v", err, up)
	}
	bad := "running"
	if _, err := agents.Update(ctx, ua.ID, a.ID, UpdateAgentInput{Status: &bad}); err == nil {
		t.Fatal("invalid status accepted")
	}
}

func TestAddAgentToWorkspaceAndAssignTask(t *testing.T) {
	agents, tasks, ws, ua, _, org, w := agentFixture(t)
	ctx := context.Background()

	// A new agent is not in the workspace until an admin adds it.
	a, err := agents.Create(ctx, ua.ID, org.ID, CreateAgentInput{Name: "Reviewer", Handle: "reviewer"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ws.RequireAgentMember(ctx, w.ID, a.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("not a member yet: %v", err)
	}
	if _, err := tasks.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "T", AssigneeID: &a.ID, AssigneeKind: "agent"}); err == nil {
		t.Fatal("assigning to a non-member agent must fail")
	}
	if err := agents.AddToWorkspace(ctx, ua.ID, w.ID, a.ID); err != nil {
		t.Fatal(err)
	}
	task, err := tasks.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "T", AssigneeID: &a.ID, AssigneeKind: "agent"})
	if err != nil {
		t.Fatal(err)
	}
	if task.AssigneeKind != "agent" || task.AssigneeID.String != a.ID || task.CreatedByKind != "human" {
		t.Fatalf("assignee pair: %+v", task)
	}
	// Reassign to a person: kind falls back to human.
	uid := ua.ID
	ptr := &uid
	up, err := tasks.Update(ctx, Human(ua.ID), task.ID, UpdateTaskInput{AssigneeID: &ptr})
	if err != nil || up.AssigneeKind != "human" {
		t.Fatalf("reassign to human: %v %+v", err, up)
	}
	// Clearing the assignee resets the kind too.
	var nilStr *string
	cleared, err := tasks.Update(ctx, Human(ua.ID), task.ID, UpdateTaskInput{AssigneeID: &nilStr, AssigneeKind: "agent"})
	if err != nil || cleared.AssigneeID.Valid || cleared.AssigneeKind != "human" {
		t.Fatalf("clear: %v %+v", err, cleared)
	}
	if _, err := tasks.Update(ctx, Human(ua.ID), task.ID, UpdateTaskInput{AssigneeID: &ptr, AssigneeKind: "robot"}); err == nil {
		t.Fatal("unknown kind accepted")
	}
	// A paused agent cannot be added to another workspace.
	paused := "paused"
	if _, err := agents.Update(ctx, ua.ID, a.ID, UpdateAgentInput{Status: &paused}); err != nil {
		t.Fatal(err)
	}
	v2, err := ws.CreateInOrg(ctx, ua.ID, org.ID, "Beta", "beta")
	if err != nil {
		t.Fatal(err)
	}
	if err := agents.AddToWorkspace(ctx, ua.ID, v2.Workspace.ID, a.ID); err == nil {
		t.Fatal("paused agent added")
	}
	// Comments carry the author's kind, and the resolver names both kinds.
	c, err := tasks.AddComment(ctx, Human(ua.ID), task.ID, "ok")
	if err != nil || c.AuthorKind != "human" {
		t.Fatalf("comment kind: %v %+v", err, c)
	}
	got, err := NewActorService(tasks.q).Resolve(ctx, []ActorRef{{Kind: audit.KindHuman, ID: ua.ID}, {Kind: audit.KindAgent, ID: a.ID}, {Kind: audit.KindAgent, ID: "missing"}})
	if err != nil || len(got) != 2 {
		t.Fatalf("resolve: %v %+v", err, got)
	}
	if got[ActorRef{Kind: audit.KindAgent, ID: a.ID}].DisplayName != "Reviewer" || got[ActorRef{Kind: audit.KindHuman, ID: ua.ID}].DisplayName != "A" {
		t.Fatalf("resolve names: %+v", got)
	}
}
