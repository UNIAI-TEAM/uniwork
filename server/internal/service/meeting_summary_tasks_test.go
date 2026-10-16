package service

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// seedSummary stores a summary of m with these action items, as Summarize
// would after the model answered.
func seedSummary(t *testing.T, s *MeetingService, m db.Meeting, createdBy string, items ...ai.ActionItem) db.MeetingSummary {
	t.Helper()
	raw, err := json.Marshal(items)
	if err != nil {
		t.Fatal(err)
	}
	sum, err := s.q.InsertMeetingSummary(context.Background(), db.InsertMeetingSummaryParams{
		ID: util.NewID(), MeetingID: m.ID, Summary: "Đã chốt.", Decisions: "[]", ActionItems: string(raw),
		Model: "fake", CreatedBy: createdBy, OrganizationID: m.OrganizationID,
	})
	if err != nil {
		t.Fatal(err)
	}
	// created_at orders the summaries; keep the next one strictly later.
	time.Sleep(5 * time.Millisecond)
	return sum
}

func summaryTasksFixture(t *testing.T) (*MeetingService, db.User, db.User, db.Workspace, db.Meeting) {
	t.Helper()
	s, ua, ub, w := meetingFixture(t)
	s.Tasks = NewTaskService(s.pool, s.q, s.ws, nil)
	addOrgMember(t, s.q, w.OrganizationID, ub.ID)
	addMember(t, s, w.ID, ub.ID)
	m, err := s.CreateInstant(context.Background(), ua.ID, w.ID, "Giao ban")
	if err != nil {
		t.Fatal(err)
	}
	return s, ua, ub, w, m
}

func TestCreateTasksFromSummaryIsAtomic(t *testing.T) {
	s, ua, ub, w, m := summaryTasksFixture(t)
	ctx := context.Background()
	sum := seedSummary(t, s, m, ua.ID, ai.ActionItem{Title: "Gửi báo cáo"}, ai.ActionItem{Title: "Đặt phòng"})
	outsider := "01JOUTSIDEROFTHEWORKSPACE0"

	_, err := s.CreateTasksFromSummary(ctx, ua.ID, m.ID, SummaryTasksInput{SummaryID: sum.ID, Items: []MeetingSummaryTaskItem{
		{Index: 0, AssigneeID: &ub.ID},
		{Index: 1, AssigneeID: &outsider},
	}})
	wantCode(t, err, "assignee_not_member")
	if n := countRows(t, s, `SELECT count(*) FROM tasks WHERE workspace_id = $1 AND origin_id = $2`, w.ID, m.ID); n != 0 {
		t.Fatalf("a refused batch left %d tasks", n)
	}
	if n := countRows(t, s, `SELECT count(*) FROM meeting_summary_task_links WHERE summary_id = $1`, sum.ID); n != 0 {
		t.Fatalf("a refused batch left %d links", n)
	}
	if n := countRows(t, s, `SELECT count(*) FROM audit_events WHERE action = $1 AND resource_id = $2`,
		audit.ActionMeetingSummaryTasksCreated, sum.ID); n != 0 {
		t.Fatalf("a refused batch left %d audit rows", n)
	}

	// The same items, fixed, go through in one piece.
	res, err := s.CreateTasksFromSummary(ctx, ua.ID, m.ID, SummaryTasksInput{SummaryID: sum.ID, Items: []MeetingSummaryTaskItem{
		{Index: 0, AssigneeID: &ub.ID},
		{Index: 1},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Tasks) != 2 || res.Links[0].Index != 0 || res.Links[1].Index != 1 ||
		res.Links[0].TaskID != res.Tasks[0].ID || res.Links[1].TaskID != res.Tasks[1].ID {
		t.Fatalf("result: %+v", res.Links)
	}
	// The batch keeps the summary's order on the board: the first item on top.
	if res.Tasks[0].Status == res.Tasks[1].Status && !(res.Tasks[0].Position < res.Tasks[1].Position) {
		t.Fatalf("board order: %v then %v", res.Tasks[0].Position, res.Tasks[1].Position)
	}
	if n := countRows(t, s, `SELECT count(*) FROM audit_events WHERE action = $1 AND resource_id = $2 AND workspace_id = $3`,
		audit.ActionMeetingSummaryTasksCreated, sum.ID, w.ID); n != 1 {
		t.Fatalf("batch audit rows = %d", n)
	}
	var payload string
	if err := s.pool.QueryRow(ctx, `SELECT payload FROM outbox_events WHERE topic = 'summary.tasks_linked' AND workspace_id = $1`, w.ID).Scan(&payload); err != nil {
		t.Fatalf("summary.tasks_linked: %v", err)
	}
	var got map[string]string
	if err := json.Unmarshal([]byte(payload), &got); err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 || got["meeting_id"] != m.ID || got["summary_id"] != sum.ID || got["workspace_id"] != w.ID {
		t.Fatalf("summary.tasks_linked payload carries ids only: %v", got)
	}
}

func TestCreateTasksFromSummaryRefusesASecondConversion(t *testing.T) {
	s, ua, _, w, m := summaryTasksFixture(t)
	ctx := context.Background()
	sum := seedSummary(t, s, m, ua.ID, ai.ActionItem{Title: "Gửi báo cáo"}, ai.ActionItem{Title: "Đặt phòng"})

	first, err := s.CreateTasksFromSummary(ctx, ua.ID, m.ID, SummaryTasksInput{SummaryID: sum.ID, Items: []MeetingSummaryTaskItem{{Index: 0}}})
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.CreateTasksFromSummary(ctx, ua.ID, m.ID, SummaryTasksInput{SummaryID: sum.ID, Items: []MeetingSummaryTaskItem{{Index: 1}, {Index: 0}}})
	ce := wantCode(t, err, "summary_item_already_converted")
	if idx, _ := ce.Fields["indexes"].([]int); !slices.Equal(idx, []int{0}) {
		t.Fatalf("indexes: %v", ce.Fields)
	}
	if n := countRows(t, s, `SELECT count(*) FROM tasks WHERE workspace_id = $1 AND origin_id = $2`, w.ID, m.ID); n != 1 {
		t.Fatalf("the refused retry created tasks: %d", n)
	}

	// Each index once per request, and only the items the summary holds.
	_, err = s.CreateTasksFromSummary(ctx, ua.ID, m.ID, SummaryTasksInput{SummaryID: sum.ID, Items: []MeetingSummaryTaskItem{{Index: 1}, {Index: 1}}})
	var ve ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("duplicate index: %v", err)
	}
	for _, idx := range []int{-1, 2} {
		if _, err := s.CreateTasksFromSummary(ctx, ua.ID, m.ID, SummaryTasksInput{SummaryID: sum.ID, Items: []MeetingSummaryTaskItem{{Index: idx}}}); !errors.As(err, &ve) {
			t.Fatalf("index %d: %v", idx, err)
		}
	}
	if _, err := s.CreateTasksFromSummary(ctx, ua.ID, m.ID, SummaryTasksInput{Items: []MeetingSummaryTaskItem{{Index: 1}}}); !errors.As(err, &ve) {
		t.Fatalf("missing summary_id: %v", err)
	}

	// Deleting the task frees its item again.
	if err := s.Tasks.Delete(ctx, ua.ID, first.Tasks[0].ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateTasksFromSummary(ctx, ua.ID, m.ID, SummaryTasksInput{SummaryID: sum.ID, Items: []MeetingSummaryTaskItem{{Index: 0}}}); err != nil {
		t.Fatalf("item of a deleted task: %v", err)
	}
}

func TestCreateTasksFromSummaryRefusesASupersededSummary(t *testing.T) {
	s, ua, _, w, m := summaryTasksFixture(t)
	ctx := context.Background()
	old := seedSummary(t, s, m, ua.ID, ai.ActionItem{Title: "Gửi báo cáo"})
	seedSummary(t, s, m, ua.ID, ai.ActionItem{Title: "Gửi báo cáo bản mới"})

	_, err := s.CreateTasksFromSummary(ctx, ua.ID, m.ID, SummaryTasksInput{SummaryID: old.ID, Items: []MeetingSummaryTaskItem{{Index: 0}}})
	wantCode(t, err, "summary_superseded")
	// A summary of another meeting is not this meeting's latest either.
	other, err := s.CreateInstant(ctx, ua.ID, w.ID, "Khác")
	if err != nil {
		t.Fatal(err)
	}
	foreign := seedSummary(t, s, other, ua.ID, ai.ActionItem{Title: "x"})
	_, err = s.CreateTasksFromSummary(ctx, ua.ID, m.ID, SummaryTasksInput{SummaryID: foreign.ID, Items: []MeetingSummaryTaskItem{{Index: 0}}})
	wantCode(t, err, "summary_superseded")
	if n := countRows(t, s, `SELECT count(*) FROM tasks WHERE workspace_id = $1`, w.ID); n != 0 {
		t.Fatalf("superseded conversions created %d tasks", n)
	}
}

func TestCreateTasksFromSummaryKeepsTheHostsChoice(t *testing.T) {
	s, ua, ub, w, _ := summaryTasksFixture(t)
	ctx := context.Background()
	project, err := s.Tasks.CreateProject(ctx, Human(ua.ID), w.ID, CreateProjectInput{Title: "Dự án họp"})
	if err != nil {
		t.Fatal(err)
	}
	start := time.Now().Add(time.Hour).Truncate(time.Second)
	m, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{
		Title: "Họp dự án", StartsAt: start, EndsAt: start.Add(time.Hour), ProjectID: project.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	// "B" names ub exactly and "ngày mai" parses, yet the host chose nobody
	// and no due date: the server does not guess them back.
	sum := seedSummary(t, s, m, ua.ID,
		ai.ActionItem{Title: "Gửi báo cáo", Owner: "B", Due: "ngày mai"},
		ai.ActionItem{Title: "Đặt phòng", Owner: "B", Due: "ngày mai"},
	)
	none := ""
	res, err := s.CreateTasksFromSummary(ctx, ua.ID, m.ID, SummaryTasksInput{SummaryID: sum.ID, Items: []MeetingSummaryTaskItem{
		{Index: 0, Title: "  "},
		{Index: 1, Title: "Đặt phòng họp lớn", Description: "Tầng 3", AssigneeID: &ub.ID, DueDate: strPtr("2026-12-01"), ProjectID: &none, Priority: "high"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	a, b := res.Tasks[0], res.Tasks[1]
	if a.AssigneeID.Valid || a.DueDate.Valid {
		t.Fatalf("explicit none was re-resolved: assignee=%v due=%v", a.AssigneeID, a.DueDate)
	}
	if a.Title != "Gửi báo cáo" || a.ProjectID.String != project.ID {
		t.Fatalf("stored title and the meeting's project: %q %v", a.Title, a.ProjectID)
	}
	for _, want := range []string{"Người phụ trách (AI): B", "Hạn (AI): ngày mai", "Từ cuộc họp: Họp dự án"} {
		if !strings.Contains(a.Description, want) {
			t.Fatalf("description %q lacks %q", a.Description, want)
		}
	}
	if b.Title != "Đặt phòng họp lớn" || b.AssigneeID.String != ub.ID || b.ProjectID.Valid || b.Priority != "high" {
		t.Fatalf("host values: %+v", b)
	}
	if b.DueDate.Time.Format("2006-01-02") != "2026-12-01" {
		t.Fatalf("due: %v", b.DueDate)
	}
	if strings.Contains(b.Description, "(AI)") || !strings.HasPrefix(b.Description, "Tầng 3") {
		t.Fatalf("description %q", b.Description)
	}
}

func TestCreateTasksFromSummaryNeedsTheHost(t *testing.T) {
	s, ua, ub, w, m := summaryTasksFixture(t)
	ctx := context.Background()
	sum := seedSummary(t, s, m, ua.ID, ai.ActionItem{Title: "Gửi báo cáo"})
	_, err := s.CreateTasksFromSummary(ctx, ub.ID, m.ID, SummaryTasksInput{SummaryID: sum.ID, Items: []MeetingSummaryTaskItem{{Index: 0}}})
	wantCode(t, err, "not_meeting_host")
	if n := countRows(t, s, `SELECT count(*) FROM tasks WHERE workspace_id = $1`, w.ID); n != 0 {
		t.Fatalf("a member created %d tasks", n)
	}
}

func TestSummaryViewDescribesTheItems(t *testing.T) {
	s, ua, ub, _, m := summaryTasksFixture(t)
	ctx := context.Background()
	if v, err := s.SummaryView(ctx, ua.ID, m.ID); err != nil || v != nil {
		t.Fatalf("no summary yet: %+v %v", v, err)
	}
	sum := seedSummary(t, s, m, ua.ID,
		ai.ActionItem{Title: "Gửi báo cáo", Owner: "B", Due: "ngày mai"},
		ai.ActionItem{Title: "Đặt phòng", Owner: "Zed", Due: "khi nào rảnh"},
	)
	res, err := s.CreateTasksFromSummary(ctx, ua.ID, m.ID, SummaryTasksInput{SummaryID: sum.ID, Items: []MeetingSummaryTaskItem{{Index: 0}}})
	if err != nil {
		t.Fatal(err)
	}
	// Any member reads it, not only the host.
	v, err := s.SummaryView(ctx, ub.ID, m.ID)
	if err != nil || v == nil || v.Summary.ID != sum.ID || len(v.Items) != 2 {
		t.Fatalf("%+v %v", v, err)
	}
	first, second := v.Items[0], v.Items[1]
	if first.Index != 0 || first.Title != "Gửi báo cáo" || first.Owner != "B" || first.Due != "ngày mai" {
		t.Fatalf("stored fields: %+v", first)
	}
	if first.SuggestedAssigneeID == nil || *first.SuggestedAssigneeID != ub.ID {
		t.Fatalf("suggested assignee: %v", first.SuggestedAssigneeID)
	}
	want := parseMeetingDueSpoken("ngày mai", meetingDueAnchor(m))
	if first.DueDate == nil || want == nil || *first.DueDate != *want {
		t.Fatalf("due date: %v want %v", first.DueDate, want)
	}
	if first.TaskID == nil || *first.TaskID != res.Tasks[0].ID {
		t.Fatalf("task id: %v", first.TaskID)
	}
	if second.Index != 1 || second.SuggestedAssigneeID != nil || second.DueDate != nil || second.TaskID != nil {
		t.Fatalf("unmatched item: %+v", second)
	}

	// The summary Summarize just stored is described the same way.
	again, err := s.SummaryViewOf(ctx, ua.ID, sum)
	if err != nil || len(again.Items) != 2 || again.Items[0].TaskID == nil {
		t.Fatalf("%+v %v", again, err)
	}

	// A deleted task frees its item: the view stops naming it.
	if err := s.Tasks.Delete(ctx, ua.ID, res.Tasks[0].ID); err != nil {
		t.Fatal(err)
	}
	v, err = s.SummaryView(ctx, ua.ID, m.ID)
	if err != nil || v.Items[0].TaskID != nil {
		t.Fatalf("deleted task still linked: %+v %v", v, err)
	}
}

// UNI-1853 review: a batch that would trip the active-duplicate guard is
// refused once, before any insert, naming every item that would: an item
// whose title matches an open task in its project, and every repeat of a
// title earlier in the same batch. The open task of the lowest such item is
// named the way the guard names it.
func TestCreateTasksFromSummaryNamesEveryDuplicateItem(t *testing.T) {
	s, ua, _, w, m := summaryTasksFixture(t)
	ctx := context.Background()
	open, err := s.Tasks.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "Gửi  báo cáo"})
	if err != nil {
		t.Fatal(err)
	}
	sum := seedSummary(t, s, m, ua.ID,
		ai.ActionItem{Title: "Đặt phòng"},
		ai.ActionItem{Title: "gửi báo cáo"},
		ai.ActionItem{Title: "Mới"},
		ai.ActionItem{Title: "Đặt phòng"},
	)
	_, err = s.CreateTasksFromSummary(ctx, ua.ID, m.ID, SummaryTasksInput{SummaryID: sum.ID, Items: []MeetingSummaryTaskItem{
		{Index: 3}, {Index: 2}, {Index: 1}, {Index: 0},
	}})
	ce := wantCode(t, err, "active_duplicate_task")
	if idx, _ := ce.Fields["indexes"].([]int); !slices.Equal(idx, []int{0, 1}) {
		t.Fatalf("indexes = %v, want [0 1] (index 0 repeats index 3, index 1 matches an open task)", ce.Fields)
	}
	if ce.Fields["task_id"] != open.ID || ce.Fields["title"] != open.Title {
		t.Fatalf("fields = %v, want the open task %s named", ce.Fields, open.ID)
	}
	if n := countRows(t, s, `SELECT count(*) FROM tasks WHERE workspace_id = $1 AND origin_id = $2`, w.ID, m.ID); n != 0 {
		t.Fatalf("a refused batch created %d tasks", n)
	}

	// The same title under another project is not a duplicate, and leaving
	// the named items out lets the rest through.
	project, err := s.Tasks.CreateProject(ctx, Human(ua.ID), w.ID, CreateProjectInput{Title: "Khác"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.CreateTasksFromSummary(ctx, ua.ID, m.ID, SummaryTasksInput{SummaryID: sum.ID, Items: []MeetingSummaryTaskItem{
		{Index: 3}, {Index: 2}, {Index: 1, ProjectID: &project.ID},
	}}); err != nil {
		t.Fatalf("without the duplicates: %v", err)
	}
}

// UNI-1853 review: an omitted project takes the meeting's project only while
// it still exists; a deleted one leaves the tasks without a project instead
// of refusing the batch with 404.
func TestCreateTasksFromSummaryIgnoresADeletedMeetingProject(t *testing.T) {
	s, ua, _, w, _ := summaryTasksFixture(t)
	ctx := context.Background()
	project, err := s.Tasks.CreateProject(ctx, Human(ua.ID), w.ID, CreateProjectInput{Title: "Dự án cũ"})
	if err != nil {
		t.Fatal(err)
	}
	start := time.Now().Add(time.Hour).Truncate(time.Second)
	m, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{
		Title: "Họp dự án", StartsAt: start, EndsAt: start.Add(time.Hour), ProjectID: project.ID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Tasks.DeleteProject(ctx, Human(ua.ID), w.ID, project.ID); err != nil {
		t.Fatal(err)
	}
	sum := seedSummary(t, s, m, ua.ID, ai.ActionItem{Title: "Gửi báo cáo"})
	res, err := s.CreateTasksFromSummary(ctx, ua.ID, m.ID, SummaryTasksInput{SummaryID: sum.ID, Items: []MeetingSummaryTaskItem{{Index: 0}}})
	if err != nil {
		t.Fatalf("the meeting's deleted project refused the batch: %v", err)
	}
	if res.Tasks[0].ProjectID.Valid {
		t.Fatalf("task took the deleted project %v", res.Tasks[0].ProjectID)
	}
	// A deleted project the host names is still refused.
	gone := project.ID
	sum = seedSummary(t, s, m, ua.ID, ai.ActionItem{Title: "Đặt phòng"})
	_, err = s.CreateTasksFromSummary(ctx, ua.ID, m.ID, SummaryTasksInput{SummaryID: sum.ID, Items: []MeetingSummaryTaskItem{{Index: 0, ProjectID: &gone}}})
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("named deleted project: %v, want not found", err)
	}
}

// UNI-1853 review: a conversion and a regeneration of the same meeting take
// one lock, so a summary that commits while a conversion is under way makes
// the conversion answer summary_superseded instead of linking tasks to a
// summary nobody sees any more. A transaction stands in for Summarize's
// store: it holds the lock and inserts the new summary, and commits only
// after the conversion has had time to reach the lock.
func TestCreateTasksFromSummaryWaitsForARegeneration(t *testing.T) {
	s, ua, _, w, m := summaryTasksFixture(t)
	ctx := context.Background()
	old := seedSummary(t, s, m, ua.ID, ai.ActionItem{Title: "Gửi báo cáo"})

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	if err := q.LockMeetingSummaryChanges(ctx, m.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := q.InsertMeetingSummary(ctx, db.InsertMeetingSummaryParams{
		ID: util.NewID(), MeetingID: m.ID, Summary: "Bản mới", Decisions: "[]", ActionItems: `[{"title":"Khác"}]`,
		Model: "fake", CreatedBy: ua.ID, OrganizationID: m.OrganizationID,
	}); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		_, err := s.CreateTasksFromSummary(ctx, ua.ID, m.ID, SummaryTasksInput{SummaryID: old.ID, Items: []MeetingSummaryTaskItem{{Index: 0}}})
		done <- err
	}()
	select {
	case err := <-done:
		t.Fatalf("the conversion did not wait for the regeneration: %v", err)
	case <-time.After(300 * time.Millisecond):
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	wantCode(t, <-done, "summary_superseded")
	if n := countRows(t, s, `SELECT count(*) FROM tasks WHERE workspace_id = $1`, w.ID); n != 0 {
		t.Fatalf("tasks linked to a superseded summary: %d", n)
	}
}
