package service

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func projectTrashTask(t *testing.T, s *TaskService, ua db.User, w db.Workspace, projectID, title string) db.Task {
	t.Helper()
	in := CreateTaskInput{Title: title, AllowDuplicate: true}
	if projectID != "" {
		in.ProjectID = &projectID
	}
	task, err := s.Create(context.Background(), Human(ua.ID), w.ID, in)
	if err != nil {
		t.Fatal(err)
	}
	return task
}

func rawProject(t *testing.T, s *TaskService, w db.Workspace, id string) db.Project {
	t.Helper()
	p, err := s.q.GetProjectIncludingTrashed(context.Background(), db.GetProjectIncludingTrashedParams{
		ID: id, OrganizationID: w.OrganizationID, WorkspaceID: w.ID,
	})
	if err != nil {
		t.Fatalf("read project %s: %v", id, err)
	}
	return p
}

func projectEvents(evs []Event, topic, projectID string) int {
	n := 0
	for _, e := range evs {
		if e.Type == topic && e.Payload["project_id"] == projectID {
			n++
		}
	}
	return n
}

func projectRows(t *testing.T, s *TaskService, query string, args ...any) int {
	t.Helper()
	var n int
	if err := s.pool.QueryRow(context.Background(), query, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestTrashProjectUnlinksItsTasks(t *testing.T) {
	s, events, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)
	p, err := s.CreateProject(ctx, actor, w.ID, CreateProjectInput{Title: "Dự án vào thùng rác"})
	if err != nil {
		t.Fatal(err)
	}
	live := projectTrashTask(t, s, ua, w, p.ID, "Còn sống")
	gone := projectTrashTask(t, s, ua, w, p.ID, "Đã vào thùng rác")
	if _, err := s.Trash(ctx, actor, gone.ID); err != nil {
		t.Fatal(err)
	}
	ids := []string{live.ID, gone.ID}
	before := auditRows(t, s, "task.updated", ids...)
	seen := len(events.drain(t)) // the capture is cumulative

	if err := s.TrashProject(ctx, actor, w.ID, p.ID); err != nil {
		t.Fatal(err)
	}
	for _, id := range ids {
		row := rawTask(t, s, id)
		if row.ProjectID.Valid || row.TrashedProjectID.String != p.ID {
			t.Fatalf("task %s project = %v trashed_project = %v, want unlinked and remembered", id, row.ProjectID, row.TrashedProjectID)
		}
	}
	if _, err := s.Get(ctx, ua.ID, live.ID); err != nil {
		t.Fatalf("a task of a trashed project must stay alive: %v", err)
	}
	if n := auditRows(t, s, "task.updated", ids...) - before; n != 2 {
		t.Fatalf("task.updated audit rows = %d, want one per task", n)
	}
	drained := events.drain(t)[seen:]
	if n := taskEvents(drained, "task.updated", ids...); n != 2 {
		t.Fatalf("task.updated events = %d, want one per task", n)
	}
	if n := auditRows(t, s, "project.trashed", p.ID); n != 1 {
		t.Fatalf("project.trashed audit rows = %d, want 1", n)
	}
	if n := projectEvents(drained, "project.trashed", p.ID); n != 1 {
		t.Fatalf("project.trashed events = %d in %#v", n, drained)
	}
	if n := projectEvents(drained, "project.deleted", p.ID); n != 0 {
		t.Fatal("a trash is not a delete: project.deleted fired")
	}
	row := rawProject(t, s, w, p.ID)
	if !row.TrashedAt.Valid || row.TrashedBy.String != ua.ID {
		t.Fatalf("project trashed_at %v by %q", row.TrashedAt, row.TrashedBy.String)
	}
	if d := row.PurgeAfter.Time.Sub(row.TrashedAt.Time) - trashRetention; d < -time.Minute || d > time.Minute {
		t.Fatalf("purge_after %v is not trashed_at + 30 days (%v)", row.PurgeAfter.Time, row.TrashedAt.Time)
	}
	if _, err := s.GetProject(ctx, actor, w.ID, p.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("GetProject after trash = %v, want ErrNotFound", err)
	}
	if err := s.TrashProject(ctx, actor, w.ID, p.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second trash = %v, want ErrNotFound", err)
	}
}

// Review Focus 2: a task moved to another project while its project sat in
// the trash keeps the new project; the others come back.
func TestRestoreProjectRelinksOnlyTasksStillUnlinked(t *testing.T) {
	s, events, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)
	p, err := s.CreateProject(ctx, actor, w.ID, CreateProjectInput{Title: "Dự án gốc"})
	if err != nil {
		t.Fatal(err)
	}
	other, err := s.CreateProject(ctx, actor, w.ID, CreateProjectInput{Title: "Dự án khác"})
	if err != nil {
		t.Fatal(err)
	}
	stays := projectTrashTask(t, s, ua, w, p.ID, "Ở lại")
	moves := projectTrashTask(t, s, ua, w, p.ID, "Chuyển đi")
	trashed := projectTrashTask(t, s, ua, w, p.ID, "Trong thùng rác")
	if _, err := s.Trash(ctx, actor, trashed.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.TrashProject(ctx, actor, w.ID, p.ID); err != nil {
		t.Fatal(err)
	}
	to := &other.ID
	if _, err := s.Update(ctx, actor, moves.ID, UpdateTaskInput{ProjectID: &to}); err != nil {
		t.Fatal(err)
	}
	seen := len(events.drain(t)) // the capture is cumulative

	if err := s.RestoreProject(ctx, actor, w.ID, p.ID); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		id, project string
	}{{stays.ID, p.ID}, {trashed.ID, p.ID}, {moves.ID, other.ID}} {
		row := rawTask(t, s, c.id)
		if row.ProjectID.String != c.project || row.TrashedProjectID.Valid {
			t.Fatalf("task %s project = %v trashed_project = %v, want %s", c.id, row.ProjectID, row.TrashedProjectID, c.project)
		}
	}
	if !rawTask(t, s, trashed.ID).TrashedAt.Valid {
		t.Fatal("restoring the project must not restore a task trashed on its own")
	}
	drained := events.drain(t)[seen:]
	if n := taskEvents(drained, "task.updated", stays.ID, trashed.ID); n != 2 {
		t.Fatalf("task.updated for the relinked tasks = %d, want 2", n)
	}
	if n := taskEvents(drained, "task.updated", moves.ID); n != 0 {
		t.Fatalf("the moved task was rewritten: %d task.updated", n)
	}
	if n := auditRows(t, s, "project.restored", p.ID); n != 1 {
		t.Fatalf("project.restored audit rows = %d, want 1", n)
	}
	if n := projectEvents(drained, "project.restored", p.ID); n != 1 {
		t.Fatalf("project.restored events = %d", n)
	}
	got, err := s.GetProject(ctx, actor, w.ID, p.ID)
	if err != nil || got.TrashedAt.Valid || got.PurgeAfter.Valid || got.TrashedBy.Valid {
		t.Fatalf("restored project = %+v, %v", got, err)
	}
	if err := s.RestoreProject(ctx, actor, w.ID, p.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("restore of a live project = %v, want ErrNotFound", err)
	}
}

// A person moving a task while its project sits in the trash makes the task
// forget that project: moved to another project it stays there, and moved on
// to no project it stays without one, instead of the restore pulling it back.
func TestRestoreProjectLeavesATaskThePersonMovedMeanwhile(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)
	p, err := s.CreateProject(ctx, actor, w.ID, CreateProjectInput{Title: "Dự án P"})
	if err != nil {
		t.Fatal(err)
	}
	other, err := s.CreateProject(ctx, actor, w.ID, CreateProjectInput{Title: "Dự án Q"})
	if err != nil {
		t.Fatal(err)
	}
	inQ := projectTrashTask(t, s, ua, w, p.ID, "Sang Q")
	unlinked := projectTrashTask(t, s, ua, w, p.ID, "Sang Q rồi bỏ dự án")
	if err := s.TrashProject(ctx, actor, w.ID, p.ID); err != nil {
		t.Fatal(err)
	}
	to := &other.ID
	for _, id := range []string{inQ.ID, unlinked.ID} {
		if _, err := s.Update(ctx, actor, id, UpdateTaskInput{ProjectID: &to}); err != nil {
			t.Fatal(err)
		}
		if row := rawTask(t, s, id); row.TrashedProjectID.Valid {
			t.Fatalf("task %s moved to Q still remembers %s", id, row.TrashedProjectID.String)
		}
	}
	var none *string
	if _, err := s.Update(ctx, actor, unlinked.ID, UpdateTaskInput{ProjectID: &none}); err != nil {
		t.Fatal(err)
	}

	if err := s.RestoreProject(ctx, actor, w.ID, p.ID); err != nil {
		t.Fatal(err)
	}
	if row := rawTask(t, s, inQ.ID); row.ProjectID.String != other.ID {
		t.Fatalf("task moved to Q = project %v, want %s", row.ProjectID, other.ID)
	}
	if row := rawTask(t, s, unlinked.ID); row.ProjectID.Valid {
		t.Fatalf("task moved to Q then to no project = project %s, want none", row.ProjectID.String)
	}
}

// A new project may take a trashed project's title; restoring the trashed one
// then would make two, so the restore is refused until one is renamed.
func TestRestoreProjectRefusesATitleTakenMeanwhile(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)
	p, err := s.CreateProject(ctx, actor, w.ID, CreateProjectInput{Title: "Kế hoạch quý"})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.TrashProject(ctx, actor, w.ID, p.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateProject(ctx, actor, w.ID, CreateProjectInput{Title: "kế hoạch  quý"}); err != nil {
		t.Fatal(err)
	}
	requireDuplicateProjectTitle(t, s.RestoreProject(ctx, actor, w.ID, p.ID))
	if !rawProject(t, s, w, p.ID).TrashedAt.Valid {
		t.Fatal("a refused restore left the trash")
	}
}

func projectWithViewPinResource(t *testing.T, s *TaskService, ua db.User, w db.Workspace, title, viewID string) db.Project {
	t.Helper()
	ctx := context.Background()
	actor := Human(ua.ID)
	p, err := s.CreateProject(ctx, actor, w.ID, CreateProjectInput{Title: title})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreatePin(ctx, actor, w.ID, CreatePinInput{ItemType: "project", ItemID: p.ID}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `INSERT INTO task_views (id, organization_id, workspace_id, owner_id, name, scope_type, scope_id, visibility, definition_version, query, display)
		VALUES ($1, $2, $3, $4, 'Của dự án', 'project', $5, 'workspace', 1, '{}'::jsonb, '{}'::jsonb)`,
		viewID, w.OrganizationID, w.ID, ua.ID, p.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateProjectResource(ctx, actor, w.ID, p.ID, CreateProjectResourceInput{
		ResourceType: "github_repo",
		ResourceRef:  json.RawMessage(`{"url":"https://github.com/acme/app.git"}`),
	}); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestTrashedProjectKeepsViewsAndPinsHidden(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)
	p := projectWithViewPinResource(t, s, ua, w, "Có ghim", "01VIEWPROJECTTRASHKEEP000A")
	scope := p.ID
	visible := func() (int, int) {
		t.Helper()
		pins, err := s.ListPins(ctx, actor, w.ID, false)
		if err != nil {
			t.Fatal(err)
		}
		views, err := s.ListTaskViews(ctx, actor, w.ID, "project", &scope)
		if err != nil {
			t.Fatal(err)
		}
		return len(pins), len(views)
	}
	if pins, views := visible(); pins != 1 || views != 1 {
		t.Fatalf("before trash: %d pins, %d views", pins, views)
	}

	if err := s.TrashProject(ctx, actor, w.ID, p.ID); err != nil {
		t.Fatal(err)
	}
	if pins, views := visible(); pins != 0 || views != 0 {
		t.Fatalf("while trashed: %d pins, %d views shown", pins, views)
	}
	if n := projectRows(t, s, `SELECT count(*) FROM task_pins WHERE item_id = $1`, p.ID); n != 1 {
		t.Fatalf("pin rows while trashed = %d, want kept", n)
	}
	if n := projectRows(t, s, `SELECT count(*) FROM task_views WHERE scope_id = $1`, p.ID); n != 1 {
		t.Fatalf("view rows while trashed = %d, want kept", n)
	}

	if err := s.RestoreProject(ctx, actor, w.ID, p.ID); err != nil {
		t.Fatal(err)
	}
	if pins, views := visible(); pins != 1 || views != 1 {
		t.Fatalf("after restore: %d pins, %d views", pins, views)
	}
	resources, err := s.ListProjectResources(ctx, actor, w.ID, p.ID)
	if err != nil || len(resources) != 1 {
		t.Fatalf("resources after restore = %v, %v", resources, err)
	}
}

func TestPurgeProjectDeletesResourcesViewsPinsAndClearsLinks(t *testing.T) {
	s, events, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)
	p := projectWithViewPinResource(t, s, ua, w, "Xoá hẳn", "01VIEWPROJECTTRASHPURGE00A")
	task := projectTrashTask(t, s, ua, w, p.ID, "Sống sót")

	if err := s.PurgeProject(ctx, actor, w.ID, p.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("purge of a live project = %v, want ErrNotFound", err)
	}
	if err := s.TrashProject(ctx, actor, w.ID, p.ID); err != nil {
		t.Fatal(err)
	}
	events.drain(t)
	if err := s.PurgeProject(ctx, actor, w.ID, p.ID); err != nil {
		t.Fatal(err)
	}

	for table, query := range map[string]string{
		"projects":          `SELECT count(*) FROM projects WHERE id = $1`,
		"project_resources": `SELECT count(*) FROM project_resources WHERE project_id = $1`,
		"task_views":        `SELECT count(*) FROM task_views WHERE scope_id = $1`,
		"task_pins":         `SELECT count(*) FROM task_pins WHERE item_id = $1`,
		"task links":        `SELECT count(*) FROM tasks WHERE project_id = $1 OR trashed_project_id = $1`,
	} {
		if n := projectRows(t, s, query, p.ID); n != 0 {
			t.Fatalf("%s left after purge: %d", table, n)
		}
	}
	if _, err := s.Get(ctx, ua.ID, task.ID); err != nil {
		t.Fatalf("no task is lost with its project: %v", err)
	}
	if n := auditRows(t, s, "project.deleted", p.ID); n != 1 {
		t.Fatalf("project.deleted audit rows = %d, want 1", n)
	}
	if n := projectEvents(events.drain(t), "project.deleted", p.ID); n != 1 {
		t.Fatalf("project.deleted events = %d, want 1", n)
	}
	if err := s.RestoreProject(ctx, actor, w.ID, p.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("restore after purge = %v, want ErrNotFound", err)
	}
}

// A task create or update that checked the project while it was live can
// still commit project_id after the trash; the purge unlinks it too.
func TestPurgeProjectUnlinksATaskLinkedAfterTheTrash(t *testing.T) {
	s, events, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)
	p, err := s.CreateProject(ctx, actor, w.ID, CreateProjectInput{Title: "Liên kết muộn"})
	if err != nil {
		t.Fatal(err)
	}
	late := projectTrashTask(t, s, ua, w, "", "Gắn muộn")
	if err := s.TrashProject(ctx, actor, w.ID, p.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, `UPDATE tasks SET project_id = $1 WHERE id = $2`, p.ID, late.ID); err != nil {
		t.Fatal(err)
	}
	before := rawTask(t, s, late.ID)
	seen := len(events.drain(t)) // the capture is cumulative

	if err := s.PurgeProject(ctx, actor, w.ID, p.ID); err != nil {
		t.Fatal(err)
	}
	row := rawTask(t, s, late.ID)
	if row.ProjectID.Valid || row.Revision != before.Revision+1 {
		t.Fatalf("task after purge: project %v revision %d (was %d)", row.ProjectID, row.Revision, before.Revision)
	}
	if n := taskEvents(events.drain(t)[seen:], "task.updated", late.ID); n != 1 {
		t.Fatalf("task.updated events = %d, want 1", n)
	}
	if n := auditRows(t, s, "task.updated", late.ID); n != 1 {
		t.Fatalf("task.updated audit rows = %d, want 1", n)
	}
}

func TestTrashProjectNeedsEditRights(t *testing.T) {
	s, _, ub, uc, w := projectEditFixture(t)
	ctx := context.Background()
	as := NewAuthService(s.pool, s.q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	outsider := registerVerified(t, s.q, as, "d@example.com", "D")

	p, err := s.CreateProject(ctx, Human(ub.ID), w.ID, CreateProjectInput{Title: "B's project"})
	if err != nil {
		t.Fatal(err)
	}
	live, err := s.CreateProject(ctx, Human(ub.ID), w.ID, CreateProjectInput{Title: "B's live project"})
	if err != nil {
		t.Fatal(err)
	}
	requireNotProjectEditor(t, "peer trash", s.TrashProject(ctx, Human(uc.ID), w.ID, p.ID))
	if err := s.TrashProject(ctx, Human(ub.ID), w.ID, p.ID); err != nil {
		t.Fatalf("the creator trashes their project: %v", err)
	}
	requireNotProjectEditor(t, "peer restore", s.RestoreProject(ctx, Human(uc.ID), w.ID, p.ID))
	requireNotProjectEditor(t, "peer purge", s.PurgeProject(ctx, Human(uc.ID), w.ID, p.ID))

	// A non-member hears about a trashed project exactly what it hears about
	// a live one.
	_, liveErr := s.UpdateProject(ctx, Human(outsider.ID), w.ID, live.ID, UpdateProjectInput{ExpectedRevision: live.Revision})
	if !errors.Is(liveErr, ErrForbidden) {
		t.Fatalf("outsider update of a live project = %v, want ErrForbidden", liveErr)
	}
	for what, err := range map[string]error{
		"trash":   s.TrashProject(ctx, Human(outsider.ID), w.ID, live.ID),
		"restore": s.RestoreProject(ctx, Human(outsider.ID), w.ID, p.ID),
		"purge":   s.PurgeProject(ctx, Human(outsider.ID), w.ID, p.ID),
	} {
		if err == nil || err.Error() != liveErr.Error() {
			t.Fatalf("outsider %s = %v, want %v", what, err, liveErr)
		}
	}
	if _, err := s.ListProjectTrash(ctx, outsider.ID, w.ID, TrashFilter{}, ""); !errors.Is(err, ErrForbidden) {
		t.Fatalf("outsider trash list = %v, want ErrForbidden", err)
	}
	if !rawProject(t, s, w, p.ID).TrashedAt.Valid {
		t.Fatal("a refused command changed the trashed project")
	}
}

func TestTrashedProjectListPagesWithTaskCounts(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)
	// 51 rows sharing one trashed_at put the page boundary inside the tie.
	if _, err := s.pool.Exec(ctx, `
		INSERT INTO projects (id, organization_id, workspace_id, title, description, status, priority, revision, created_by, created_by_kind, trashed_at, trashed_by, purge_after)
		SELECT 'seedproj' || lpad(g::text, 5, '0'), $1, $2, 'seed ' || g, '', 'planned', 'none', 1, $3, 'human',
		       now() - interval '1 hour', $3, now() + interval '29 days'
		FROM generate_series(1, 51) g`, w.OrganizationID, w.ID, ua.ID); err != nil {
		t.Fatal(err)
	}
	p, err := s.CreateProject(ctx, actor, w.ID, CreateProjectInput{Title: "Mới nhất"})
	if err != nil {
		t.Fatal(err)
	}
	projectTrashTask(t, s, ua, w, p.ID, "Sẽ quay lại")
	gone := projectTrashTask(t, s, ua, w, p.ID, "Trong thùng rác")
	if _, err := s.Trash(ctx, actor, gone.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.TrashProject(ctx, actor, w.ID, p.ID); err != nil {
		t.Fatal(err)
	}

	first, err := s.ListProjectTrash(ctx, ua.ID, w.ID, TrashFilter{}, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Items) != trashPageSize || first.NextCursor == "" {
		t.Fatalf("first page = %d rows, cursor %q", len(first.Items), first.NextCursor)
	}
	top := first.Items[0]
	if top.ID != p.ID || top.Title != "Mới nhất" || top.TrashedBy != ua.ID || top.TaskCount != 1 || top.PurgeAfter.IsZero() {
		t.Fatalf("newest row = %+v, want the project with its one live task", top)
	}
	second, err := s.ListProjectTrash(ctx, ua.ID, w.ID, TrashFilter{}, first.NextCursor)
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Items) != 2 || second.NextCursor != "" {
		t.Fatalf("second page = %d rows, cursor %q", len(second.Items), second.NextCursor)
	}
	seen := map[string]bool{}
	for _, r := range append(first.Items, second.Items...) {
		if seen[r.ID] {
			t.Fatalf("row %s on two pages", r.ID)
		}
		seen[r.ID] = true
	}
	if _, err := s.ListProjectTrash(ctx, ua.ID, w.ID, TrashFilter{}, "nope"); err == nil {
		t.Fatal("a forged cursor was accepted")
	}
}

func TestProjectTrashCanManageFollowsRestoreRule(t *testing.T) {
	s, ua, ub, uc, w := projectEditFixture(t)
	ctx := context.Background()
	// A is the organization owner and so an implicit workspace admin; B created
	// the project; C is a plain member.
	p, err := s.CreateProject(ctx, Human(ub.ID), w.ID, CreateProjectInput{Title: "Của B"})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.TrashProject(ctx, Human(ub.ID), w.ID, p.ID); err != nil {
		t.Fatal(err)
	}
	for who, want := range map[string]bool{ub.ID: true, ua.ID: true, uc.ID: false} {
		page, err := s.ListProjectTrash(ctx, who, w.ID, TrashFilter{}, "")
		if err != nil {
			t.Fatal(err)
		}
		if len(page.Items) != 1 || page.Items[0].CanManage != want {
			t.Fatalf("reader %s: items %+v, want CanManage=%v", who, page.Items, want)
		}
	}
	byName, err := s.ListProjectTrash(ctx, uc.ID, w.ID, TrashFilter{Query: "KHÔNG CÓ"}, "")
	if err != nil || len(byName.Items) != 0 {
		t.Fatalf("query with no match = %+v, %v", byName.Items, err)
	}
	byDeleter, err := s.ListProjectTrash(ctx, uc.ID, w.ID, TrashFilter{TrashedBy: []string{ub.ID}, Query: "của b"}, "")
	if err != nil || len(byDeleter.Items) != 1 {
		t.Fatalf("filter by deleter and name = %+v, %v", byDeleter.Items, err)
	}
	byOther, err := s.ListProjectTrash(ctx, uc.ID, w.ID, TrashFilter{TrashedBy: []string{uc.ID}}, "")
	if err != nil || len(byOther.Items) != 0 {
		t.Fatalf("filter by another deleter = %+v, %v", byOther.Items, err)
	}
}
