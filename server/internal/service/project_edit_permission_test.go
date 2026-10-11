package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func requireNotProjectEditor(t *testing.T, what string, err error) {
	t.Helper()
	var ce CodedError
	if !errors.As(err, &ce) || ce.Code != "not_project_editor" || ce.Status != http.StatusForbidden {
		t.Fatalf("%s: want not_project_editor 403, got %v", what, err)
	}
}

// projectEditFixture is an organization whose owner (ua) is a workspace admin
// and two plain members, ub and uc, who are peers of each other.
func projectEditFixture(t *testing.T) (*TaskService, db.User, db.User, db.User, db.Workspace) {
	t.Helper()
	s, _, ua, ub, w := taskFixture(t)
	as := NewAuthService(s.pool, s.q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	uc := registerVerified(t, s.q, as, "c@example.com", "C")
	for _, u := range []db.User{ub, uc} {
		addOrgMember(t, s.q, w.OrganizationID, u.ID)
		addWorkspaceMember(t, s.q, w.ID, u.ID)
	}
	return s, ua, ub, uc, w
}

// UNI-898: membership lets a peer read another member's project, not rewrite
// or delete it.
func TestPlainMemberCannotEditAnotherMembersProject(t *testing.T) {
	s, _, ub, uc, w := projectEditFixture(t)
	ctx := context.Background()

	proj, err := s.CreateProject(ctx, Human(ub.ID), w.ID, CreateProjectInput{Title: "B's project"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetProject(ctx, Human(uc.ID), w.ID, proj.ID); err != nil {
		t.Fatalf("a peer still reads the project: %v", err)
	}

	_, err = s.UpdateProject(ctx, Human(uc.ID), w.ID, proj.ID, UpdateProjectInput{
		ExpectedRevision: proj.Revision, Title: strPtr("Taken over"),
	})
	requireNotProjectEditor(t, "update", err)
	_, err = s.CreateProjectResource(ctx, Human(uc.ID), w.ID, proj.ID, CreateProjectResourceInput{
		ResourceType: "github_repo",
		ResourceRef:  json.RawMessage(`{"url":"https://github.com/acme/app.git"}`),
	})
	requireNotProjectEditor(t, "create resource", err)

	res, err := s.CreateProjectResource(ctx, Human(ub.ID), w.ID, proj.ID, CreateProjectResourceInput{
		ResourceType: "github_repo",
		ResourceRef:  json.RawMessage(`{"url":"https://github.com/acme/app.git"}`),
	})
	if err != nil {
		t.Fatalf("the creator adds a resource: %v", err)
	}
	_, err = s.UpdateProjectResource(ctx, Human(uc.ID), w.ID, proj.ID, res.ID, UpdateProjectResourceInput{Label: strPtr("x")})
	requireNotProjectEditor(t, "update resource", err)
	requireNotProjectEditor(t, "delete resource", s.DeleteProjectResource(ctx, Human(uc.ID), w.ID, proj.ID, res.ID))
	requireNotProjectEditor(t, "delete", s.DeleteProject(ctx, Human(uc.ID), w.ID, proj.ID))

	unchanged, err := s.GetProject(ctx, Human(ub.ID), w.ID, proj.ID)
	if err != nil {
		t.Fatal(err)
	}
	if unchanged.Title != proj.Title {
		t.Fatalf("refused update changed the project: %+v", unchanged)
	}

	updated, err := s.UpdateProject(ctx, Human(ub.ID), w.ID, proj.ID, UpdateProjectInput{
		ExpectedRevision: unchanged.Revision, Title: strPtr("Still B's"),
	})
	if err != nil {
		t.Fatalf("the creator edits their own project: %v", err)
	}
	if err := s.DeleteProjectResource(ctx, Human(ub.ID), w.ID, proj.ID, res.ID); err != nil {
		t.Fatalf("the creator deletes their resource: %v", err)
	}
	if err := s.DeleteProject(ctx, Human(ub.ID), w.ID, updated.ID); err != nil {
		t.Fatalf("the creator deletes their own project: %v", err)
	}
}

// The lead a project is assigned to edits it like its creator; a peer who is
// neither still may not, and a workspace admin edits every project.
func TestProjectLeadAndWorkspaceAdminMayEdit(t *testing.T) {
	s, ua, ub, uc, w := projectEditFixture(t)
	ctx := context.Background()

	leadType, leadID := "member", uc.ID
	proj, err := s.CreateProject(ctx, Human(ua.ID), w.ID, CreateProjectInput{
		Title: "Assigned to C", LeadType: &leadType, LeadID: &leadID,
	})
	if err != nil {
		t.Fatal(err)
	}

	byLead, err := s.UpdateProject(ctx, Human(uc.ID), w.ID, proj.ID, UpdateProjectInput{
		ExpectedRevision: proj.Revision, Status: strPtr("in_progress"),
	})
	if err != nil {
		t.Fatalf("the lead edits the project: %v", err)
	}
	_, err = s.UpdateProject(ctx, Human(ub.ID), w.ID, proj.ID, UpdateProjectInput{
		ExpectedRevision: byLead.Revision, Status: strPtr("paused"),
	})
	requireNotProjectEditor(t, "peer update", err)

	mine, err := s.CreateProject(ctx, Human(ub.ID), w.ID, CreateProjectInput{Title: "B's own"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.UpdateProject(ctx, Human(ua.ID), w.ID, mine.ID, UpdateProjectInput{
		ExpectedRevision: mine.Revision, Priority: strPtr("high"),
	}); err != nil {
		t.Fatalf("a workspace admin edits a member's project: %v", err)
	}
	if err := s.DeleteProject(ctx, Human(ua.ID), w.ID, mine.ID); err != nil {
		t.Fatalf("a workspace admin deletes a member's project: %v", err)
	}
}
