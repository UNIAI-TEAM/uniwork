package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// orgFlagOff turns one flag off for one organization, read from the
// evaluation context the way the real evaluator reads an override.
type orgFlagOff struct{ key, org string }

func (f orgFlagOff) IsEnabled(ctx context.Context, key string, def bool) bool {
	if key == f.key && featureflag.EvalContextFrom(ctx).OrganizationID == f.org {
		return false
	}
	return def
}

type trashListFixture struct {
	*docPermFixture
	tn    docTenant
	w     db.Workspace
	tasks *TaskService
	svc   *TrashService
}

// newTrashListFixture is one tenant with the three trash sources wired on the
// same database; flags nil means every flag at its default.
func newTrashListFixture(t *testing.T, flags McpFlags) trashListFixture {
	t.Helper()
	f := newDocPermFixture(t)
	tn := f.tenant(t, "tl1")
	w, err := f.q.GetWorkspaceByID(f.ctx, tn.wsA)
	if err != nil {
		t.Fatal(err)
	}
	if flags == nil {
		flags = staticDocFlags{}
	}
	tasks := NewTaskService(f.pool, f.q, f.svc.ws, newMemStorage())
	return trashListFixture{docPermFixture: f, tn: tn, w: w, tasks: tasks, svc: NewTrashService(tasks, f.svc, f.svc.ws, flags)}
}

func (x trashListFixture) trashTask(t *testing.T, by db.User, projectID, title string) string {
	t.Helper()
	task := projectTrashTask(t, x.tasks, by, x.w, projectID, title)
	if _, err := x.tasks.Trash(x.ctx, Human(by.ID), task.ID); err != nil {
		t.Fatal(err)
	}
	return task.ID
}

func (x trashListFixture) project(t *testing.T, by db.User, title string) string {
	t.Helper()
	p, err := x.tasks.CreateProject(x.ctx, Human(by.ID), x.w.ID, CreateProjectInput{Title: title})
	if err != nil {
		t.Fatal(err)
	}
	return p.ID
}

func (x trashListFixture) trashProject(t *testing.T, by db.User, title string) string {
	t.Helper()
	id := x.project(t, by, title)
	if err := x.tasks.TrashProject(x.ctx, Human(by.ID), x.w.ID, id); err != nil {
		t.Fatal(err)
	}
	return id
}

// trashDoc archives a workspace-visible page of aclOwner, archived by by.
func (x trashListFixture) trashDoc(t *testing.T, by db.User, s treeDocSpec) string {
	t.Helper()
	if s.ws == "" {
		s.ws = x.tn.wsA
	}
	if s.visibility == "" {
		s.visibility = "workspace"
	}
	if s.aclOwner == "" {
		s.aclOwner = x.tn.aclOwner.ID
	}
	s.createdBy, s.archived = by.ID, true
	return x.treeDoc(t, x.tn, s).ID
}

func (x trashListFixture) setTrashedAt(t *testing.T, table, column, id string, at time.Time) {
	t.Helper()
	if _, err := x.pool.Exec(x.ctx, `UPDATE `+table+` SET `+column+` = $2 WHERE id = $1`, id, at); err != nil {
		t.Fatal(err)
	}
}

// spreadTrashTimes gives the trashed rows of one table ten distinct times, so
// most of them share their time with rows of the other kinds.
func (x trashListFixture) spreadTrashTimes(t *testing.T, table, column string, base time.Time) {
	t.Helper()
	if _, err := x.pool.Exec(x.ctx, `
		UPDATE `+table+` r SET `+column+` = $2::timestamptz - make_interval(mins => (n.rn % 10)::int)
		FROM (SELECT id, row_number() OVER (ORDER BY id) AS rn FROM `+table+`
		      WHERE workspace_id = $1 AND `+column+` IS NOT NULL) n
		WHERE r.id = n.id`, x.w.ID, base); err != nil {
		t.Fatal(err)
	}
}

func (x trashListFixture) list(t *testing.T, reader db.User, in ListTrashInput) TrashPage[TrashItem] {
	t.Helper()
	page, err := x.svc.List(x.ctx, Human(reader.ID), x.w.ID, in)
	if err != nil {
		t.Fatal(err)
	}
	return page
}

func trashKindsOf(items []TrashItem) []TrashKind {
	out := make([]TrashKind, len(items))
	for i, it := range items {
		out[i] = it.Kind
	}
	return out
}

func TestTrashListMergesKindsNewestFirst(t *testing.T) {
	x := newTrashListFixture(t, nil)
	live := x.project(t, x.tn.owner, "Website mới")
	taskID := x.trashTask(t, x.tn.owner, live, "Soạn hợp đồng")
	projectID := x.trashProject(t, x.tn.owner, "Ra mắt Q4")
	folder := x.treeDoc(t, x.tn, treeDocSpec{
		ws: x.tn.wsA, visibility: "workspace", aclOwner: x.tn.aclOwner.ID, createdBy: x.tn.aclOwner.ID,
		kind: "folder", title: "Pháp chế",
	})
	docID := x.trashDoc(t, x.tn.owner, treeDocSpec{parent: folder.ID, title: "Mẫu hợp đồng"})
	base := time.Now().Add(-time.Hour).Truncate(time.Microsecond)
	x.setTrashedAt(t, "tasks", "trashed_at", taskID, base)
	x.setTrashedAt(t, "projects", "trashed_at", projectID, base.Add(time.Minute))
	x.setTrashedAt(t, "documents", "archived_at", docID, base.Add(2*time.Minute))

	page := x.list(t, x.tn.owner, ListTrashInput{})
	if !slices.Equal(trashKindsOf(page.Items), []TrashKind{TrashKindDocument, TrashKindProject, TrashKindTask}) || page.NextCursor != "" {
		t.Fatalf("kinds = %v, cursor %q; want document, project, task on one page", trashKindsOf(page.Items), page.NextCursor)
	}
	doc, project, task := page.Items[0], page.Items[1], page.Items[2]
	if doc.ID != docID || doc.SubKind != "page" || !slices.Equal(doc.LocationPath, []string{"Pháp chế"}) ||
		doc.TrashedBy != x.tn.owner.ID || doc.PurgeAfter.IsZero() || !doc.CanManage {
		t.Fatalf("document row = %+v", doc)
	}
	if project.ID != projectID || project.LocationTitle != x.w.Name || project.Title != "Ra mắt Q4" || !project.CanManage {
		t.Fatalf("project row = %+v", project)
	}
	if task.ID != taskID || task.Identifier == "" || task.LocationTitle != "Website mới" || task.Count != 0 || !task.CanManage {
		t.Fatalf("task row = %+v", task)
	}
}

func TestTrashListPagesAcrossKindsWithoutGapsOrRepeats(t *testing.T) {
	x := newTrashListFixture(t, nil)
	ids := seedTasks(t, x.tasks, x.tn.owner, x.w, "trashmix", "", 60)
	if _, err := x.tasks.TrashMany(x.ctx, Human(x.tn.owner.ID), x.w.ID, ids); err != nil {
		t.Fatal(err)
	}
	for i := range 30 {
		x.trashProject(t, x.tn.owner, fmt.Sprintf("Dự án %02d", i))
		x.trashDoc(t, x.tn.owner, treeDocSpec{title: fmt.Sprintf("Tài liệu %02d", i)})
	}
	base := time.Now().Add(-time.Hour).Truncate(time.Minute)
	x.spreadTrashTimes(t, "tasks", "trashed_at", base)
	x.spreadTrashTimes(t, "projects", "trashed_at", base)
	x.spreadTrashTimes(t, "documents", "archived_at", base)

	var all []TrashItem
	cursor, pages := "", 0
	for {
		page := x.list(t, x.tn.owner, ListTrashInput{Cursor: cursor})
		pages++
		if len(page.Items) > trashPageSize || (page.NextCursor != "" && len(page.Items) != trashPageSize) {
			t.Fatalf("page %d holds %d rows, cursor %q", pages, len(page.Items), page.NextCursor)
		}
		all = append(all, page.Items...)
		if page.NextCursor == "" {
			break
		}
		if pages > 10 {
			t.Fatal("the list never ends")
		}
		cursor = page.NextCursor
	}
	if pages != 3 || len(all) != 120 {
		t.Fatalf("%d pages, %d rows; want 3 pages of 120 rows", pages, len(all))
	}
	seen := map[string]bool{}
	count := map[TrashKind]int{}
	for i, it := range all {
		key := string(it.Kind) + ":" + it.ID
		if seen[key] {
			t.Fatalf("row %s listed twice", key)
		}
		seen[key] = true
		count[it.Kind]++
		if i == 0 {
			continue
		}
		prev := all[i-1]
		if it.TrashedAt.After(prev.TrashedAt) ||
			(it.TrashedAt.Equal(prev.TrashedAt) && slices.Index(trashKinds, it.Kind) < slices.Index(trashKinds, prev.Kind)) {
			t.Fatalf("row %d (%s %s) is listed after the older %s %s", i, it.Kind, it.TrashedAt, prev.Kind, prev.TrashedAt)
		}
	}
	if count[TrashKindTask] != 60 || count[TrashKindProject] != 30 || count[TrashKindDocument] != 30 {
		t.Fatalf("rows per kind = %v", count)
	}
}

func TestTrashListHidesDocumentsTheViewerCannotRead(t *testing.T) {
	x := newTrashListFixture(t, nil)
	x.trashDoc(t, x.tn.aclOwner, treeDocSpec{visibility: "restricted", title: "Lương bí mật"})

	if got := x.list(t, x.tn.aclOwner, ListTrashInput{}); len(got.Items) != 1 {
		t.Fatalf("ACL owner trash = %+v, want the restricted document", got.Items)
	}
	page := x.list(t, x.tn.member, ListTrashInput{})
	raw, err := json.Marshal(page)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 0 || strings.Contains(string(raw), "Lương bí mật") {
		t.Fatalf("member trash = %s, want no document row", raw)
	}
}

func TestTrashListLocksProjectsForPlainMembers(t *testing.T) {
	x := newTrashListFixture(t, nil)
	x.trashProject(t, x.tn.aclOwner, "Của A")
	x.trashTask(t, x.tn.aclOwner, "", "Việc của A")

	page := x.list(t, x.tn.member, ListTrashInput{})
	if len(page.Items) != 2 {
		t.Fatalf("member trash = %+v, want the project and the task", page.Items)
	}
	for _, it := range page.Items {
		if want := it.Kind == TrashKindTask; it.CanManage != want {
			t.Fatalf("%s row CanManage = %v, want %v", it.Kind, it.CanManage, want)
		}
	}
}

func TestTrashListKindAndFilters(t *testing.T) {
	x := newTrashListFixture(t, nil)
	owner, member := x.tn.owner, x.tn.member
	x.trashTask(t, owner, "", "Báo cáo việc")
	x.trashTask(t, member, "", "Khác việc")
	x.trashProject(t, member, "Báo cáo dự án")
	x.trashProject(t, owner, "Khác dự án")
	x.trashDoc(t, member, treeDocSpec{title: "Báo cáo tài liệu"})
	x.trashDoc(t, owner, treeDocSpec{title: "Khác tài liệu"})

	titles := func(items []TrashItem) []string {
		out := make([]string, len(items))
		for i, it := range items {
			out[i] = it.Title
		}
		slices.Sort(out)
		return out
	}
	projects := x.list(t, owner, ListTrashInput{Kind: TrashKindProject})
	if !slices.Equal(trashKindsOf(projects.Items), []TrashKind{TrashKindProject, TrashKindProject}) {
		t.Fatalf("kind=project = %+v", projects.Items)
	}
	byName := x.list(t, owner, ListTrashInput{Filter: TrashFilter{Query: " báo cáo "}})
	if got := titles(byName.Items); !slices.Equal(got, []string{"Báo cáo dự án", "Báo cáo tài liệu", "Báo cáo việc"}) {
		t.Fatalf("q=báo cáo = %v", got)
	}
	byMember := x.list(t, owner, ListTrashInput{Filter: TrashFilter{TrashedBy: member.ID}})
	if got := titles(byMember.Items); !slices.Equal(got, []string{"Báo cáo dự án", "Báo cáo tài liệu", "Khác việc"}) {
		t.Fatalf("trashed_by=member = %v", got)
	}
	both := x.list(t, owner, ListTrashInput{Kind: TrashKindDocument, Filter: TrashFilter{Query: "khác", TrashedBy: owner.ID}})
	if got := titles(both.Items); !slices.Equal(got, []string{"Khác tài liệu"}) {
		t.Fatalf("kind=document q=khác trashed_by=owner = %v", got)
	}

	for _, bad := range []ListTrashInput{{Kind: "label"}, {Cursor: "garbage"}} {
		if _, err := x.svc.List(x.ctx, Human(owner.ID), x.w.ID, bad); err == nil {
			t.Fatalf("List(%+v) accepted", bad)
		}
	}
	if _, err := x.svc.List(x.ctx, Human(x.tn.outsider.ID), x.w.ID, ListTrashInput{}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("outsider List = %v, want ErrNotFound", err)
	}
}

func TestTrashListSkipsDocumentsWhenTheFlagIsOff(t *testing.T) {
	x := newTrashListFixture(t, nil)
	x.trashTask(t, x.tn.owner, "", "Việc")
	x.trashDoc(t, x.tn.owner, treeDocSpec{title: "Tài liệu"})
	if got := trashKindsOf(x.list(t, x.tn.owner, ListTrashInput{}).Items); len(got) != 2 {
		t.Fatalf("flag on: kinds %v, want the task and the document", got)
	}

	x.svc = NewTrashService(x.tasks, x.svc.docs, x.svc.ws, orgFlagOff{key: "documents", org: x.tn.orgID})
	if got := trashKindsOf(x.list(t, x.tn.owner, ListTrashInput{}).Items); !slices.Equal(got, []TrashKind{TrashKindTask}) {
		t.Fatalf("flag off: kinds %v, want the task only", got)
	}
	if page := x.list(t, x.tn.owner, ListTrashInput{Kind: TrashKindDocument}); len(page.Items) != 0 || page.NextCursor != "" {
		t.Fatalf("flag off, kind=document = %+v", page)
	}
}
