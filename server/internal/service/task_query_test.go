package service

import (
	"context"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestQueryTasksFiltersByStatusAndPaginates(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)

	todo1, err := s.Create(ctx, actor, w.ID, CreateTaskInput{Title: "Todo A"})
	if err != nil {
		t.Fatal(err)
	}
	todo2, err := s.Create(ctx, actor, w.ID, CreateTaskInput{Title: "Todo B"})
	if err != nil {
		t.Fatal(err)
	}
	st := "in_progress"
	progress, err := s.Create(ctx, actor, w.ID, CreateTaskInput{Title: "Doing"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Update(ctx, actor, progress.ID, UpdateTaskInput{Status: &st}); err != nil {
		t.Fatal(err)
	}

	page, err := s.QueryTasks(ctx, actor, w.ID, TaskQuery{Status: "todo", Limit: 1, Offset: 0})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 2 {
		t.Fatalf("total = %d, want 2 todo tasks", page.Total)
	}
	if len(page.Tasks) != 1 {
		t.Fatalf("page size = %d, want 1", len(page.Tasks))
	}
	if page.Tasks[0].ID != todo1.ID && page.Tasks[0].ID != todo2.ID {
		t.Fatalf("unexpected task %s", page.Tasks[0].ID)
	}

	page2, err := s.QueryTasks(ctx, actor, w.ID, TaskQuery{Status: "todo", Limit: 1, Offset: 1})
	if err != nil {
		t.Fatal(err)
	}
	if len(page2.Tasks) != 1 {
		t.Fatalf("second page size = %d, want 1", len(page2.Tasks))
	}
	if page2.Tasks[0].ID == page.Tasks[0].ID {
		t.Fatal("offset did not advance")
	}
	ids := map[string]bool{todo1.ID: true, todo2.ID: true}
	if !ids[page.Tasks[0].ID] || !ids[page2.Tasks[0].ID] {
		t.Fatalf("pages should cover both todos: %s %s", page.Tasks[0].ID, page2.Tasks[0].ID)
	}
}

// Two projects in one workspace: QueryTasks / TableGroups with a project
// filter must return only that project's tasks.
func TestQueryTasksFilterByProjectID(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)

	projectA, err := s.CreateProject(ctx, actor, w.ID, CreateProjectInput{Title: "Project A"})
	if err != nil {
		t.Fatal(err)
	}
	projectB, err := s.CreateProject(ctx, actor, w.ID, CreateProjectInput{Title: "Project B"})
	if err != nil {
		t.Fatal(err)
	}

	taskA, err := s.Create(ctx, actor, w.ID, CreateTaskInput{Title: "In A"})
	if err != nil {
		t.Fatal(err)
	}
	taskB, err := s.Create(ctx, actor, w.ID, CreateTaskInput{Title: "In B"})
	if err != nil {
		t.Fatal(err)
	}
	linkTask := func(taskID, projectID string) {
		t.Helper()
		if _, err := s.pool.Exec(ctx,
			`UPDATE tasks SET project_id = $1 WHERE id = $2 AND organization_id = $3 AND workspace_id = $4`,
			projectID, taskID, w.OrganizationID, w.ID,
		); err != nil {
			t.Fatal(err)
		}
	}
	linkTask(taskA.ID, projectA.ID)
	linkTask(taskB.ID, projectB.ID)

	page, err := s.QueryTasks(ctx, actor, w.ID, TaskQuery{ProjectID: projectA.ID})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 {
		t.Fatalf("QueryTasks total = %d, want 1", page.Total)
	}
	if len(page.Tasks) != 1 || page.Tasks[0].ID != taskA.ID {
		t.Fatalf("QueryTasks = %+v, want only task A %s", page.Tasks, taskA.ID)
	}
}

func TestGetTaskByIdentifier(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)

	task, err := s.Create(ctx, actor, w.ID, CreateTaskInput{Title: "By ref"})
	if err != nil {
		t.Fatal(err)
	}
	if w.TaskPrefix == "" {
		t.Fatal("fixture workspace missing task_prefix")
	}
	ref := w.TaskPrefix + "-" + strconv.FormatInt(task.Number, 10)

	got, err := s.GetByRef(ctx, actor, ref)
	if err != nil {
		t.Fatalf("GetByRef(%q): %v", ref, err)
	}
	if got.ID != task.ID {
		t.Fatalf("id = %s, want %s", got.ID, task.ID)
	}

	// Prefix match is case-insensitive (documented: PREFIX-N).
	lower := strings.ToLower(w.TaskPrefix) + "-" + strconv.FormatInt(task.Number, 10)
	got2, err := s.GetByRef(ctx, actor, lower)
	if err != nil || got2.ID != task.ID {
		t.Fatalf("case-insensitive GetByRef(%q): err=%v id=%s", lower, err, got2.ID)
	}

	byID, err := s.GetByRef(ctx, actor, task.ID)
	if err != nil || byID.ID != task.ID {
		t.Fatalf("GetByRef(ULID): err=%v id=%s", err, byID.ID)
	}
}

// Colliding PREFIX-N across two membership-visible workspaces must not
// arbitrarily pick one task — GetByRef returns ErrNotFound.
func TestGetTaskByIdentifierAmbiguousAcrossWorkspaces(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	orgs := NewOrganizationService(pool, q)
	ws := NewWorkspaceService(pool, q, orgs, mail.Renderer{AppURL: "http://localhost:3000"}, &fakeOutbox{})
	s := NewTaskService(pool, q, ws, nil)
	ctx := context.Background()

	ua := registerVerified(t, q, as, "ambig@example.com", "Ambig")
	actor := Human(ua.ID)

	org1, err := orgs.Create(ctx, ua.ID, "Org One", "org-one")
	if err != nil {
		t.Fatal(err)
	}
	// The same person in a second organization (pre-ADR 0032 account).
	org2 := createLegacyOrganization(t, orgs, ua.ID, "Org Two", "org-two")
	// Slug "alpha" → task_prefix ALP in both orgs (prefix unique only per workspace).
	v1, err := ws.CreateInOrg(ctx, ua.ID, org1.ID, "Alpha", "alpha")
	if err != nil {
		t.Fatal(err)
	}
	v2, err := ws.CreateInOrg(ctx, ua.ID, org2.ID, "Alpha", "alpha")
	if err != nil {
		t.Fatal(err)
	}
	if v1.TaskPrefix != v2.TaskPrefix || v1.TaskPrefix == "" {
		t.Fatalf("prefixes = %q / %q, want same non-empty", v1.TaskPrefix, v2.TaskPrefix)
	}

	t1, err := s.Create(ctx, actor, v1.ID, CreateTaskInput{Title: "In org1"})
	if err != nil {
		t.Fatal(err)
	}
	t2, err := s.Create(ctx, actor, v2.ID, CreateTaskInput{Title: "In org2"})
	if err != nil {
		t.Fatal(err)
	}
	if t1.Number != t2.Number {
		t.Fatalf("numbers = %d / %d, want same for colliding ref", t1.Number, t2.Number)
	}
	ref := v1.TaskPrefix + "-" + strconv.FormatInt(t1.Number, 10)

	got, err := s.GetByRef(ctx, actor, ref)
	if err != ErrNotFound {
		t.Fatalf("GetByRef(%q) = id=%s err=%v, want ErrNotFound", ref, got.ID, err)
	}
}

func TestGetTaskByIdentifierAfterPrefixChange(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)
	task, err := s.Create(ctx, actor, w.ID, CreateTaskInput{Title: "Old ref"})
	if err != nil {
		t.Fatal(err)
	}
	n := strconv.FormatInt(task.Number, 10)
	oldRef := w.TaskPrefix + "-" + n
	next := "ZQX"
	if _, err := s.ws.Update(ctx, ua.ID, w.ID, UpdateWorkspaceInput{TaskPrefix: &next}); err != nil {
		t.Fatal(err)
	}
	for _, ref := range []string{"ZQX-" + n, oldRef, strings.ToLower(oldRef)} {
		got, err := s.GetByRef(ctx, actor, ref)
		if err != nil || got.ID != task.ID {
			t.Fatalf("GetByRef(%q) after the change: err=%v id=%s", ref, err, got.ID)
		}
	}
	// Taking the old prefix back keeps both refs working, each matching once.
	back := w.TaskPrefix
	if _, err := s.ws.Update(ctx, ua.ID, w.ID, UpdateWorkspaceInput{TaskPrefix: &back}); err != nil {
		t.Fatal(err)
	}
	for _, ref := range []string{oldRef, "zqx-" + n} {
		got, err := s.GetByRef(ctx, actor, ref)
		if err != nil || got.ID != task.ID {
			t.Fatalf("GetByRef(%q) after going back: err=%v id=%s", ref, err, got.ID)
		}
	}
}

// A prefix one workspace gave up and another took now names the new owner's
// tasks; the old owner's alias answers only while nobody uses it currently.
func TestGetTaskByIdentifierPrefersCurrentPrefixOverAlias(t *testing.T) {
	s, _, ua, _, w1 := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)
	w2, err := s.ws.CreateInOrg(ctx, ua.ID, w1.OrganizationID, "Beta", "beta")
	if err != nil {
		t.Fatal(err)
	}
	t1, err := s.Create(ctx, actor, w1.ID, CreateTaskInput{Title: "In W1"})
	if err != nil {
		t.Fatal(err)
	}
	old := w1.TaskPrefix
	ref := old + "-" + strconv.FormatInt(t1.Number, 10)
	moved := "MKT"
	if _, err := s.ws.Update(ctx, ua.ID, w1.ID, UpdateWorkspaceInput{TaskPrefix: &moved}); err != nil {
		t.Fatal(err)
	}
	// Nobody uses the old prefix today: the alias still resolves W1's task.
	if got, err := s.GetByRef(ctx, actor, ref); err != nil || got.ID != t1.ID {
		t.Fatalf("GetByRef(%q) via alias: err=%v id=%s, want %s", ref, err, got.ID, t1.ID)
	}
	if _, err := s.ws.Update(ctx, ua.ID, w2.ID, UpdateWorkspaceInput{TaskPrefix: &old}); err != nil {
		t.Fatal(err)
	}
	t2, err := s.Create(ctx, actor, w2.ID, CreateTaskInput{Title: "In W2"})
	if err != nil {
		t.Fatal(err)
	}
	if t2.Number != t1.Number {
		t.Fatalf("numbers = %d / %d, want the same for a colliding ref", t1.Number, t2.Number)
	}
	if got, err := s.GetByRef(ctx, actor, ref); err != nil || got.ID != t2.ID {
		t.Fatalf("GetByRef(%q) after W2 took the prefix: err=%v id=%s, want W2's %s", ref, err, got.ID, t2.ID)
	}
	movedRef := moved + "-" + strconv.FormatInt(t1.Number, 10)
	if got, err := s.GetByRef(ctx, actor, movedRef); err != nil || got.ID != t1.ID {
		t.Fatalf("GetByRef(%q): err=%v id=%s, want %s", movedRef, err, got.ID, t1.ID)
	}
}

// taskTitles lists the titles of a page in a stable order for comparison.
func taskTitles(tasks []db.Task) string {
	out := make([]string, 0, len(tasks))
	for _, t := range tasks {
		out = append(out, t.Title)
	}
	slices.Sort(out)
	return strings.Join(out, ",")
}

func TestQueryTasksFiltersByAssigneePriorityAndDue(t *testing.T) {
	s, _, ua, ub, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)
	addOrgMember(t, s.q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, s.q, w.ID, ub.ID)
	d1, d2, d3 := "2026-10-01", "2026-10-10", "2026-10-20"
	mk := func(title, prio string, assignee *string, due *string) {
		t.Helper()
		if _, err := s.Create(ctx, actor, w.ID, CreateTaskInput{Title: title, Priority: prio, AssigneeID: assignee, DueDate: due}); err != nil {
			t.Fatal(err)
		}
	}
	mk("a-high-d1", "high", &ua.ID, &d1)
	mk("a-low-d2", "low", &ua.ID, &d2)
	mk("b-high-d3", "high", &ub.ID, &d3)
	mk("none-undated", "low", nil, nil)

	for name, tc := range map[string]struct {
		q    TaskQuery
		want string
	}{
		"assignee": {TaskQuery{AssigneeID: ua.ID}, "a-high-d1,a-low-d2"},
		"priority": {TaskQuery{Priority: "high"}, "a-high-d1,b-high-d3"},
		"due from": {TaskQuery{DueFrom: "2026-10-10"}, "a-low-d2,b-high-d3"},
		"due to":   {TaskQuery{DueTo: "2026-10-10"}, "a-high-d1,a-low-d2"},
		"combined": {TaskQuery{AssigneeID: ua.ID, Priority: "high", DueFrom: "2026-10-01", DueTo: "2026-10-05"}, "a-high-d1"},
	} {
		page, err := s.QueryTasks(ctx, actor, w.ID, tc.q)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if got := taskTitles(page.Tasks); got != tc.want || page.Total != int64(len(page.Tasks)) {
			t.Errorf("%s: tasks = %q (total %d), want %q", name, got, page.Total, tc.want)
		}
	}
}

func TestQueryTasksOverdueSkipsClosedCategories(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)
	if _, err := s.pool.Exec(ctx, `INSERT INTO task_statuses (id, organization_id, workspace_id, key, name, category, color, created_by)
		VALUES ('st-shipped-q', $1, $2, 'shipped', 'Shipped', 'done', '#00aa00', $3)`, w.OrganizationID, w.ID, ua.ID); err != nil {
		t.Fatal(err)
	}
	past, today := "2026-10-01", "2026-10-19"
	mk := func(title, status, due string) {
		t.Helper()
		if _, err := s.Create(ctx, actor, w.ID, CreateTaskInput{Title: title, Status: status, DueDate: &due}); err != nil {
			t.Fatal(err)
		}
	}
	mk("shipped-overdue", "shipped", past)
	mk("todo-overdue", "todo", past)
	mk("todo-due-today", "todo", today)
	page, err := s.QueryTasks(ctx, actor, w.ID, TaskQuery{Overdue: true, Today: time.Date(2026, 10, 19, 0, 0, 0, 0, time.UTC)})
	if err != nil {
		t.Fatal(err)
	}
	if got := taskTitles(page.Tasks); got != "todo-overdue" || page.Total != 1 {
		t.Fatalf("overdue = %q (total %d), want only todo-overdue", got, page.Total)
	}
}

func TestCountOpenTasksByAssignee(t *testing.T) {
	s, _, ua, ub, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)
	addOrgMember(t, s.q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, s.q, w.ID, ub.ID)
	past, future := "2026-10-01", "2026-12-01"
	mk := func(assignee *string, status string, due *string) {
		t.Helper()
		if _, err := s.Create(ctx, actor, w.ID, CreateTaskInput{Title: "t", Status: status, AssigneeID: assignee, DueDate: due, AllowDuplicate: true}); err != nil {
			t.Fatal(err)
		}
	}
	mk(&ua.ID, "todo", &past)
	mk(&ua.ID, "todo", &future)
	mk(&ua.ID, "done", &past)
	mk(&ub.ID, "in_progress", nil)
	mk(&ub.ID, "cancelled", nil)
	mk(nil, "todo", &past)

	rows, err := s.q.CountOpenTasksByAssignee(ctx, db.CountOpenTasksByAssigneeParams{
		OrganizationID: w.OrganizationID, WorkspaceID: w.ID,
		Today: pgtype.Date{Time: time.Date(2026, 10, 19, 0, 0, 0, 0, time.UTC), Valid: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	got := map[string][2]int64{}
	for _, r := range rows {
		got[r.AssigneeID] = [2]int64{r.OpenCount, r.OverdueCount}
	}
	if len(got) != 2 || got[ua.ID] != [2]int64{2, 1} || got[ub.ID] != [2]int64{1, 0} {
		t.Fatalf("counts = %v, want A {2 open, 1 overdue}, B {1, 0}, no unassigned row", got)
	}
}
