package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func trashRow(t *testing.T, x *mcpToolWorld, table, id string) {
	t.Helper()
	if _, err := x.tools.ask.pool.Exec(context.Background(),
		`UPDATE `+table+` SET trashed_at = now(), purge_after = now() + interval '30 days' WHERE id = $1`, id); err != nil {
		t.Fatal(err)
	}
}

func TestTrashedTaskIsHiddenFromEveryReader(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	ts, q := x.tools.ask.tasks, x.tools.q
	actor := Human(x.ua.ID)
	today := time.Now().UTC().Format("2006-01-02")
	live, err := ts.Create(ctx, actor, x.w.ID, CreateTaskInput{Title: "Việc còn sống", DueDate: &today, AssigneeID: &x.ua.ID})
	if err != nil {
		t.Fatal(err)
	}
	child, err := ts.Create(ctx, actor, x.w.ID, CreateTaskInput{Title: "Con của báo cáo", ParentTaskID: &x.taskID})
	if err != nil {
		t.Fatal(err)
	}
	trashRow(t, x, "tasks", x.taskID)

	if _, err := ts.Get(ctx, x.ua.ID, x.taskID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Get = %v, want ErrNotFound", err)
	}
	if got, err := ts.Get(ctx, x.ua.ID, live.ID); err != nil || got.ID != live.ID {
		t.Fatalf("live Get = %v", err)
	}
	newTitle := "đổi tên"
	if _, err := ts.Update(ctx, actor, x.taskID, UpdateTaskInput{Title: &newTitle}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Update of a trashed task = %v, want ErrNotFound", err)
	}
	has := func(name string, ids []string) {
		t.Helper()
		for _, id := range ids {
			if id == x.taskID {
				t.Errorf("%s lists the trashed task", name)
			}
		}
	}
	list, err := ts.List(ctx, x.ua.ID, x.w.ID)
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	for _, tk := range list {
		ids = append(ids, tk.ID)
	}
	has("List", ids)
	if len(ids) != 2 {
		t.Errorf("List = %v, want the live task and the child", ids)
	}
	page, err := ts.QueryTasks(ctx, actor, x.w.ID, TaskQuery{})
	if err != nil {
		t.Fatal(err)
	}
	ids = nil
	for _, tk := range page.Tasks {
		ids = append(ids, tk.ID)
	}
	has("QueryTasks", ids)
	mine, err := ts.ListMyTasks(ctx, actor, x.w.ID, TaskQuery{})
	if err != nil {
		t.Fatal(err)
	}
	ids = nil
	for _, tk := range mine.Tasks {
		ids = append(ids, tk.ID)
	}
	has("ListMyTasks", ids)
	if _, err := ts.GetByRefIn(ctx, actor, x.w.ID, x.taskID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("GetByRefIn = %v, want ErrNotFound", err)
	}

	has("TableRows", rowIDs(allRows(t, ts, actor, x.w.ID, TableRowsInput{})))
	groups, err := ts.TableGroups(ctx, actor, x.w.ID, TableQueryInput{GroupBy: "status"})
	if err != nil {
		t.Fatal(err)
	}
	var total int64
	for _, g := range groups.Groups {
		total += g.Count
	}
	if total != 2 {
		t.Errorf("TableGroups counts %d tasks, want 2", total)
	}

	cal := NewCalendarService(q, x.tools.ws)
	evs, err := cal.ListEvents(ctx, x.w.ID, x.ua.ID, time.Now().AddDate(0, 0, -7), time.Now().AddDate(0, 0, 7), false)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range evs {
		if e.EntityID == x.taskID {
			t.Error("calendar lists the trashed task")
		}
	}
	side, err := cal.ListSidebar(ctx, x.w.ID, x.ua.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, st := range side.Assigned {
		if st.ID == x.taskID {
			t.Error("calendar sidebar lists the trashed task")
		}
	}
	sum, err := NewHomeService(q, x.tools.ws).Summary(ctx, actor, x.w.ID, HomeLimits{Tasks: 20, Meetings: 5})
	if err != nil {
		t.Fatal(err)
	}
	for _, tk := range sum.MyWork {
		if tk.ID == x.taskID {
			t.Error("home lists the trashed task")
		}
	}
	if sum.Counts.Open != 1 {
		t.Errorf("home open = %d, want 1", sum.Counts.Open)
	}

	existing, err := q.ListExistingTaskIDs(ctx, []string{x.taskID, live.ID})
	if err != nil || len(existing) != 1 || existing[0] != live.ID {
		t.Fatalf("ListExistingTaskIDs = %v, %v", existing, err)
	}
	// Trash the child too: neither the parent's child list nor the batch
	// reader may show it.
	trashRow(t, x, "tasks", child.ID)
	byParent, err := q.ListChildrenByParents(ctx, db.ListChildrenByParentsParams{
		OrganizationID: x.w.OrganizationID, WorkspaceID: x.w.ID, ParentIds: []string{x.taskID},
	})
	if err != nil || len(byParent) != 0 {
		t.Fatalf("ListChildrenByParents = %v, %v", byParent, err)
	}
	load, err := q.CountOpenTasksByAssignee(ctx, db.CountOpenTasksByAssigneeParams{
		Today: pgtype.Date{Time: time.Now().UTC(), Valid: true}, OrganizationID: x.w.OrganizationID, WorkspaceID: x.w.ID,
	})
	if err != nil || len(load) != 1 || load[0].OpenCount != 1 {
		t.Fatalf("CountOpenTasksByAssignee = %v, %v", load, err)
	}

	found, err := x.tools.Search(ctx, x.p, x.w.ID, "báo cáo")
	if err != nil {
		t.Fatal(err)
	}
	for _, it := range found {
		if it.ID == x.taskID || strings.Contains(it.Title, "báo cáo") {
			t.Errorf("MCP search finds the trashed task: %+v", it)
		}
	}
	if _, err := x.tools.GetTask(ctx, x.p, x.w.ID, x.taskID); err == nil {
		t.Error("MCP GetTask reads the trashed task")
	}
}

func TestTrashedProjectIsHiddenFromEveryReader(t *testing.T) {
	x := newMcpToolWorld(t)
	ctx := context.Background()
	ts := x.tools.ask.tasks
	actor := Human(x.ua.ID)
	mk := func(title string) db.Project {
		p, err := ts.CreateProject(ctx, actor, x.w.ID, CreateProjectInput{Title: title, Status: "planned", Priority: "none"})
		if err != nil {
			t.Fatal(err)
		}
		return p
	}
	gone, keep := mk("Dự án đã xoá"), mk("Dự án còn")
	pin, err := ts.CreatePin(ctx, actor, x.w.ID, CreatePinInput{ItemType: "project", ItemID: gone.ID})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ts.CreatePin(ctx, actor, x.w.ID, CreatePinInput{ItemType: "project", ItemID: keep.ID}); err != nil {
		t.Fatal(err)
	}
	scope := gone.ID
	if _, err := x.tools.ask.pool.Exec(ctx, `INSERT INTO task_views (id, organization_id, workspace_id, owner_id, name, scope_type, scope_id, visibility, definition_version, query, display)
		VALUES ('01VIEWTRASHPROJECT0000000A', $1, $2, $3, 'Của dự án', 'project', $4, 'workspace', 1, '{}'::jsonb, '{}'::jsonb)`,
		x.w.OrganizationID, x.w.ID, x.ua.ID, gone.ID); err != nil {
		t.Fatal(err)
	}
	trashRow(t, x, "projects", gone.ID)

	if _, err := ts.GetProject(ctx, actor, x.w.ID, gone.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("GetProject = %v, want ErrNotFound", err)
	}
	if _, err := ts.GetProject(ctx, actor, x.w.ID, keep.ID); err != nil {
		t.Fatal(err)
	}
	list, err := ts.ListProjects(ctx, actor, x.w.ID, ListProjectsFilter{})
	if err != nil || len(list) != 1 || list[0].ID != keep.ID {
		t.Fatalf("ListProjects = %v, %v", list, err)
	}
	found, total, err := ts.SearchProjects(ctx, actor, x.w.ID, SearchProjectsInput{Q: "Dự án", IncludeClosed: true, Limit: 20})
	if err != nil || total != 1 || len(found) != 1 || found[0].ID != keep.ID {
		t.Fatalf("SearchProjects = %v (%d), %v", found, total, err)
	}
	pins, err := ts.ListPins(ctx, actor, x.w.ID, false)
	if err != nil || len(pins) != 1 || pins[0].ID == pin.ID {
		t.Fatalf("ListPins = %v, %v", pins, err)
	}
	views, err := ts.ListTaskViews(ctx, actor, x.w.ID, "project", &scope)
	if err != nil || len(views) != 0 {
		t.Fatalf("ListTaskViews of the trashed project = %v, %v", views, err)
	}
	// A new project may reuse the trashed one's title.
	if _, err := ts.CreateProject(ctx, actor, x.w.ID, CreateProjectInput{Title: "Dự án đã xoá", Status: "planned", Priority: "none"}); err != nil {
		t.Fatalf("a trashed project's title still blocks a new one: %v", err)
	}
}

func TestTrashedTasksStillCountForQuota(t *testing.T) {
	x := newMcpToolWorld(t)
	before, err := x.tools.q.CountTasksInOrganization(context.Background(), x.w.OrganizationID)
	if err != nil {
		t.Fatal(err)
	}
	trashRow(t, x, "tasks", x.taskID)
	after, err := x.tools.q.CountTasksInOrganization(context.Background(), x.w.OrganizationID)
	if err != nil || after != before || after == 0 {
		t.Fatalf("quota count %d -> %d, %v; trashed tasks must still count", before, after, err)
	}
}
