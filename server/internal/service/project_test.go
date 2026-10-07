package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sync"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/mail"
	"golang.org/x/text/unicode/norm"
)

func requireDuplicateProjectTitle(t *testing.T, err error) {
	t.Helper()
	var ce CodedError
	if !errors.As(err, &ce) || ce.Code != "duplicate_project_title" || ce.Status != http.StatusConflict {
		t.Fatalf("want duplicate_project_title 409, got %v", err)
	}
}

func TestCreateProjectRejectsNormalizedDuplicateTitleWithinWorkspace(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)

	if _, err := s.CreateProject(ctx, actor, w.ID, CreateProjectInput{Title: "Alpha roadmap"}); err != nil {
		t.Fatal(err)
	}
	_, err := s.CreateProject(ctx, actor, w.ID, CreateProjectInput{Title: "  alpha   roadmap  "})
	requireDuplicateProjectTitle(t, err)

	orgs := NewOrganizationService(s.pool, s.q)
	wsSvc := NewWorkspaceService(s.pool, s.q, orgs, mail.Renderer{AppURL: "http://localhost:3000"}, &fakeOutbox{})
	other, err := wsSvc.CreateInOrg(ctx, ua.ID, w.OrganizationID, "Other", "project-duplicate-other")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateProject(ctx, actor, other.Workspace.ID, CreateProjectInput{Title: " alpha roadmap "}); err != nil {
		t.Fatalf("same normalized title in another workspace: %v", err)
	}
}

func TestCreateProjectRejectsUnicodeEquivalentDuplicateTitle(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)

	composed := "Kế\u00a0hoạch"
	if _, err := s.CreateProject(ctx, actor, w.ID, CreateProjectInput{Title: composed}); err != nil {
		t.Fatal(err)
	}
	decomposed := norm.NFD.String("kế hoạch")
	_, err := s.CreateProject(ctx, actor, w.ID, CreateProjectInput{Title: decomposed})
	requireDuplicateProjectTitle(t, err)
}

func TestUpdateProjectRejectsNormalizedDuplicateTitle(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)

	if _, err := s.CreateProject(ctx, actor, w.ID, CreateProjectInput{Title: "Product launch"}); err != nil {
		t.Fatal(err)
	}
	second, err := s.CreateProject(ctx, actor, w.ID, CreateProjectInput{Title: "Other project"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.UpdateProject(ctx, actor, w.ID, second.ID, UpdateProjectInput{
		ExpectedRevision: second.Revision,
		Title:            strPtr(" product   LAUNCH "),
	})
	requireDuplicateProjectTitle(t, err)

	unchanged, err := s.GetProject(ctx, actor, w.ID, second.ID)
	if err != nil {
		t.Fatal(err)
	}
	if unchanged.Title != second.Title || unchanged.Revision != second.Revision {
		t.Fatalf("project changed after duplicate rename: got %+v, want title=%q revision=%d", unchanged, second.Title, second.Revision)
	}
}

func TestCreateProjectSerializesConcurrentDuplicateTitles(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)

	start := make(chan struct{})
	errs := make(chan error, 2)
	var ready sync.WaitGroup
	ready.Add(2)
	for range 2 {
		go func() {
			ready.Done()
			<-start
			_, err := s.CreateProject(ctx, actor, w.ID, CreateProjectInput{Title: "Concurrent roadmap"})
			errs <- err
		}()
	}
	ready.Wait()
	close(start)

	successes, duplicates := 0, 0
	for range 2 {
		err := <-errs
		if err == nil {
			successes++
			continue
		}
		var ce CodedError
		if errors.As(err, &ce) && ce.Code == "duplicate_project_title" && ce.Status == http.StatusConflict {
			duplicates++
			continue
		}
		t.Fatalf("unexpected concurrent create error: %v", err)
	}
	if successes != 1 || duplicates != 1 {
		t.Fatalf("concurrent creates: successes=%d duplicates=%d, want 1 each", successes, duplicates)
	}
}

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
	sB := NewTaskService(s.pool, s.q, wsSvc, nil)

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

	found, total, err := s.SearchProjects(ctx, Human(ua.ID), w.ID, SearchProjectsInput{Q: "roadmap"})
	if err != nil || len(found) != 1 || found[0].ID != projA.ID || total != 1 {
		t.Fatalf("search = %+v total=%d err=%v", found, total, err)
	}
	leak, leakTotal, err := s.SearchProjects(ctx, Human(ua.ID), w.ID, SearchProjectsInput{Q: "Beta"})
	if err != nil || len(leak) != 0 || leakTotal != 0 {
		t.Fatalf("search leak = %+v total=%d err=%v", leak, leakTotal, err)
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

func TestSearchProjectsTotalIsMatchCount(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)
	for i := 0; i < 3; i++ {
		if _, err := s.CreateProject(ctx, actor, w.ID, CreateProjectInput{
			Title: fmt.Sprintf("Alpha match %d", i),
		}); err != nil {
			t.Fatal(err)
		}
	}
	page, total, err := s.SearchProjects(ctx, actor, w.ID, SearchProjectsInput{
		Q: "Alpha", Limit: 1, Offset: 0,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(page) != 1 {
		t.Fatalf("page len = %d, want 1", len(page))
	}
	if total != 3 {
		t.Fatalf("total = %d, want 3 (match count, not page length)", total)
	}
}

func TestUpdateProjectRevisionConflictAndBump(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)
	proj, err := s.CreateProject(ctx, actor, w.ID, CreateProjectInput{Title: "Rev"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.UpdateProject(ctx, actor, w.ID, proj.ID, UpdateProjectInput{
		ExpectedRevision: 1, Title: strPtr("Rev v2"),
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.UpdateProject(ctx, actor, w.ID, proj.ID, UpdateProjectInput{
		ExpectedRevision: 1, Title: strPtr("stale"),
	})
	var ce CodedError
	if !errors.As(err, &ce) || ce.Code != "revision_conflict" || ce.Status != http.StatusUnprocessableEntity {
		t.Fatalf("want revision_conflict 422, got %v", err)
	}
	got, err := s.GetProject(ctx, actor, w.ID, proj.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Revision != 2 || got.Title != "Rev v2" {
		t.Fatalf("after conflict = %+v", got)
	}
	ok, err := s.UpdateProject(ctx, actor, w.ID, proj.ID, UpdateProjectInput{
		ExpectedRevision: 2, Title: strPtr("Rev v3"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if ok.Revision != 3 || ok.Title != "Rev v3" {
		t.Fatalf("bump = %+v", ok)
	}
}

func TestUpdateProjectClearsLeadAndDates(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)
	leadType, leadID := "member", ua.ID
	start, due := "2026-09-01", "2026-09-30"
	proj, err := s.CreateProject(ctx, actor, w.ID, CreateProjectInput{
		Title: "Clearable", LeadType: &leadType, LeadID: &leadID,
		StartDate: &start, DueDate: &due,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !proj.LeadID.Valid || !proj.StartDate.Valid || !proj.DueDate.Valid {
		t.Fatalf("seed = %+v", proj)
	}
	var clear *string
	updated, err := s.UpdateProject(ctx, actor, w.ID, proj.ID, UpdateProjectInput{
		ExpectedRevision: proj.Revision,
		LeadType:         &clear, LeadID: &clear,
		StartDate: &clear, DueDate: &clear,
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.LeadType.Valid || updated.LeadID.Valid || updated.StartDate.Valid || updated.DueDate.Valid {
		t.Fatalf("cleared = %+v", updated)
	}
	kept, err := s.UpdateProject(ctx, actor, w.ID, proj.ID, UpdateProjectInput{
		ExpectedRevision: updated.Revision,
		Title:            strPtr("Still clearable"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if kept.LeadType.Valid || kept.LeadID.Valid || kept.StartDate.Valid || kept.DueDate.Valid {
		t.Fatalf("omit must keep cleared nulls = %+v", kept)
	}
}

func TestDeleteProjectEmitsTaskUpdated(t *testing.T) {
	s, events, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)
	proj, err := s.CreateProject(ctx, actor, w.ID, CreateProjectInput{Title: "With tasks"})
	if err != nil {
		t.Fatal(err)
	}
	task, err := s.Create(ctx, actor, w.ID, CreateTaskInput{Title: "Linked"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx,
		`UPDATE tasks SET project_id = $1 WHERE id = $2 AND organization_id = $3 AND workspace_id = $4`,
		proj.ID, task.ID, w.OrganizationID, w.ID,
	); err != nil {
		t.Fatal(err)
	}
	events.drain(t)

	if err := s.DeleteProject(ctx, actor, w.ID, proj.ID); err != nil {
		t.Fatal(err)
	}
	row, err := s.q.GetTask(ctx, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if row.ProjectID.Valid {
		t.Fatalf("project_id still set: %+v", row.ProjectID)
	}
	if row.Revision != task.Revision+1 {
		t.Fatalf("revision = %d, want %d", row.Revision, task.Revision+1)
	}
	drained := events.drain(t)
	var sawTaskUpdated bool
	for _, e := range drained {
		if e.Type == "task.updated" {
			sawTaskUpdated = true
			if e.Payload["task_id"] != task.ID {
				t.Fatalf("task.updated payload = %#v", e.Payload)
			}
		}
	}
	if !sawTaskUpdated {
		t.Fatalf("missing task.updated in %#v", drained)
	}
}

func strPtr(s string) *string { return &s }
