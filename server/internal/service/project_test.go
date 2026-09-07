package service

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/mail"
)

func TestCreateListProjectTenantIsolation(t *testing.T) {
	s, events, ua, ub, w := taskFixture(t)
	ctx := context.Background()

	orgs := NewOrganizationService(s.pool, s.q)
	wsSvc := NewWorkspaceService(s.pool, s.q, orgs, mail.Renderer{AppURL: "http://localhost:3000"}, &fakeOutbox{})
	orgB, err := orgs.Create(ctx, ub.ID, "Org B Projects", "proj-org-b")
	if err != nil {
		t.Fatal(err)
	}
	wsB, err := wsSvc.CreateInOrg(ctx, ub.ID, orgB.ID, "Beta", "proj-beta")
	if err != nil {
		t.Fatal(err)
	}
	sB := NewTaskService(s.pool, s.q, wsSvc)

	projA, err := s.CreateProject(ctx, Human(ua.ID), w.ID, CreateProjectInput{
		Title: "Alpha roadmap",
	})
	if err != nil {
		t.Fatal(err)
	}
	if projA.Title != "Alpha roadmap" || projA.OrganizationID != w.OrganizationID || projA.WorkspaceID != w.ID {
		t.Fatalf("create = %+v", projA)
	}
	if projA.Status != "planned" || projA.Priority != "none" || projA.Revision != 1 {
		t.Fatalf("defaults = %+v", projA)
	}

	projB, err := sB.CreateProject(ctx, Human(ub.ID), wsB.Workspace.ID, CreateProjectInput{
		Title: "Beta secret",
	})
	if err != nil {
		t.Fatal(err)
	}

	listed, err := s.ListProjects(ctx, Human(ua.ID), w.ID, ListProjectsFilter{})
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range listed {
		if p.ID == projB.ID {
			t.Fatal("ListProjects leaked tenant B project")
		}
	}
	if len(listed) != 1 || listed[0].ID != projA.ID {
		t.Fatalf("list A = %+v", listed)
	}

	_, err = s.GetProject(ctx, Human(ua.ID), w.ID, projB.ID)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-tenant get: %v", err)
	}

	_, err = s.CreateProjectResource(ctx, Human(ua.ID), w.ID, projA.ID, CreateProjectResourceInput{
		ResourceType: "github_repo",
		ResourceRef:  json.RawMessage(`{"url":"https://github.com/acme/app.git"}`),
		Label:        strPtr("app"),
	})
	if err != nil {
		t.Fatal(err)
	}
	resources, err := s.ListProjectResources(ctx, Human(ua.ID), w.ID, projA.ID)
	if err != nil || len(resources) != 1 {
		t.Fatalf("resources = %+v err=%v", resources, err)
	}

	_, err = s.CreateProjectResource(ctx, Human(ua.ID), w.ID, projB.ID, CreateProjectResourceInput{
		ResourceType: "github_repo",
		ResourceRef:  json.RawMessage(`{"url":"https://github.com/acme/leak.git"}`),
	})
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("resource on foreign project: %v", err)
	}

	found, err := s.SearchProjects(ctx, Human(ua.ID), w.ID, SearchProjectsInput{Q: "roadmap"})
	if err != nil || len(found) != 1 || found[0].ID != projA.ID {
		t.Fatalf("search = %+v err=%v", found, err)
	}
	leak, err := s.SearchProjects(ctx, Human(ua.ID), w.ID, SearchProjectsInput{Q: "Beta"})
	if err != nil || len(leak) != 0 {
		t.Fatalf("search leak = %+v err=%v", leak, err)
	}

	if err := s.DeleteProject(ctx, Human(ua.ID), w.ID, projA.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetProject(ctx, Human(ua.ID), w.ID, projA.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("after delete: %v", err)
	}

	drained := events.drain(t)
	want := map[string]bool{
		"project.created": true, "project.deleted": true,
		"project_resource.created": true,
	}
	for _, e := range drained {
		delete(want, e.Type)
	}
	for topic := range want {
		t.Fatalf("missing outbox topic %s in %#v", topic, drained)
	}
}

func strPtr(s string) *string { return &s }
