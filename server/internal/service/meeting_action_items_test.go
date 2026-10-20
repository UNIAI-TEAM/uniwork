package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// seedSummary stores a summary of m with these action items the way
// Summarize does once the model answered, and returns the summary.
func seedSummary(t *testing.T, s *MeetingService, m db.Meeting, createdBy string, items ...ai.ActionItem) db.MeetingSummary {
	t.Helper()
	if items == nil {
		items = []ai.ActionItem{}
	}
	sum, err := s.storeSummary(context.Background(), m, createdBy,
		ai.MeetingSummary{Summary: "Đã chốt.", Decisions: []ai.Decision{}, ActionItems: items}, ai.Response{Model: "fake"}, newSummaryLabels(), false)
	if err != nil {
		t.Fatal(err)
	}
	// created_at orders the summaries; keep the next one strictly later.
	time.Sleep(5 * time.Millisecond)
	return sum
}

// itemsByTitle reads the meeting's action items by title.
func itemsByTitle(t *testing.T, s *MeetingService, userID string, m db.Meeting) map[string]ActionItemView {
	t.Helper()
	v, err := s.ActionItems(context.Background(), userID, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	out := make(map[string]ActionItemView, len(v.Items))
	for _, it := range v.Items {
		out[it.Item.Title] = it
	}
	return out
}

func mustErr[T any](_ T, err error) error { return err }

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

func TestConvertActionItemsIsAtomic(t *testing.T) {
	s, ua, ub, w, m := summaryTasksFixture(t)
	ctx := context.Background()
	seedSummary(t, s, m, ua.ID, ai.ActionItem{Title: "Gửi báo cáo"}, ai.ActionItem{Title: "Đặt phòng"})
	items := itemsByTitle(t, s, ua.ID, m)
	report, room := items["Gửi báo cáo"].Item.ID, items["Đặt phòng"].Item.ID
	outsider := "01JOUTSIDEROFTHEWORKSPACE0"

	_, err := s.ConvertActionItems(ctx, ua.ID, m.ID, []ConvertActionItem{
		{ActionItemID: report, AssigneeID: &ub.ID},
		{ActionItemID: room, AssigneeID: &outsider},
	})
	wantCode(t, err, "assignee_not_member")
	if n := countRows(t, s, `SELECT count(*) FROM tasks WHERE workspace_id = $1 AND origin_id = $2`, w.ID, m.ID); n != 0 {
		t.Fatalf("a refused batch left %d tasks", n)
	}
	if n := countRows(t, s, `SELECT count(*) FROM meeting_action_items WHERE meeting_id = $1 AND task_id IS NOT NULL`, m.ID); n != 0 {
		t.Fatalf("a refused batch marked %d items", n)
	}

	// The same items, fixed, go through in one piece.
	links, err := s.ConvertActionItems(ctx, ua.ID, m.ID, []ConvertActionItem{
		{ActionItemID: report, AssigneeID: &ub.ID},
		{ActionItemID: room},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(links) != 2 || links[0].ActionItemID != report || links[1].ActionItemID != room {
		t.Fatalf("links: %+v", links)
	}
	first, err := s.q.GetTask(ctx, links[0].TaskID)
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.q.GetTask(ctx, links[1].TaskID)
	if err != nil {
		t.Fatal(err)
	}
	// The batch keeps the items' order on the board: the first one on top.
	if first.Status == second.Status && !(first.Position < second.Position) {
		t.Fatalf("board order: %v then %v", first.Position, second.Position)
	}
	if n := countRows(t, s, `SELECT count(*) FROM meeting_action_items WHERE meeting_id = $1 AND task_id IS NOT NULL
		AND converted_by = $2 AND converted_at IS NOT NULL`, m.ID, ua.ID); n != 2 {
		t.Fatalf("converted items = %d", n)
	}
	var metadata string
	if err := s.pool.QueryRow(ctx, `SELECT metadata::text FROM audit_events WHERE action = $1 AND resource_id = $2 AND workspace_id = $3`,
		audit.ActionMeetingActionItemsConverted, m.ID, w.ID).Scan(&metadata); err != nil {
		t.Fatalf("batch audit row: %v", err)
	}
	if !strings.Contains(metadata, report) || !strings.Contains(metadata, links[1].TaskID) {
		t.Fatalf("audit metadata names the items and tasks: %s", metadata)
	}
	var payload string
	if err := s.pool.QueryRow(ctx, `SELECT payload FROM outbox_events WHERE topic = 'action_item.converted' AND workspace_id = $1`, w.ID).Scan(&payload); err != nil {
		t.Fatalf("action_item.converted: %v", err)
	}
	var got map[string]string
	if err := json.Unmarshal([]byte(payload), &got); err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got["meeting_id"] != m.ID || got["workspace_id"] != w.ID {
		t.Fatalf("action_item.converted payload carries ids only: %v", got)
	}
}

func TestConvertActionItemsRefusesHandledItems(t *testing.T) {
	s, ua, _, w, m := summaryTasksFixture(t)
	ctx := context.Background()
	seedSummary(t, s, m, ua.ID, ai.ActionItem{Title: "Gửi báo cáo"}, ai.ActionItem{Title: "Đặt phòng"}, ai.ActionItem{Title: "In tài liệu"})
	items := itemsByTitle(t, s, ua.ID, m)
	report, room, print := items["Gửi báo cáo"].Item.ID, items["Đặt phòng"].Item.ID, items["In tài liệu"].Item.ID

	first, err := s.ConvertActionItems(ctx, ua.ID, m.ID, []ConvertActionItem{{ActionItemID: report}})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.DismissActionItem(ctx, ua.ID, m.ID, print, ""); err != nil {
		t.Fatal(err)
	}
	_, err = s.ConvertActionItems(ctx, ua.ID, m.ID, []ConvertActionItem{{ActionItemID: room}, {ActionItemID: print}, {ActionItemID: report}})
	ce := wantCode(t, err, "action_item_not_pending")
	want := []string{print, report}
	slices.Sort(want)
	if ids, _ := ce.Fields["action_item_ids"].([]string); !slices.Equal(ids, want) {
		t.Fatalf("action_item_ids = %v, want %v", ce.Fields, want)
	}
	if n := countRows(t, s, `SELECT count(*) FROM tasks WHERE workspace_id = $1 AND origin_id = $2`, w.ID, m.ID); n != 1 {
		t.Fatalf("the refused retry created tasks: %d", n)
	}

	var ve ValidationError
	if _, err := s.ConvertActionItems(ctx, ua.ID, m.ID, []ConvertActionItem{{ActionItemID: room}, {ActionItemID: room}}); !errors.As(err, &ve) {
		t.Fatalf("duplicate id: %v", err)
	}
	if _, err := s.ConvertActionItems(ctx, ua.ID, m.ID, []ConvertActionItem{{ActionItemID: " "}}); !errors.As(err, &ve) {
		t.Fatalf("blank id: %v", err)
	}
	// An item of another meeting is not this meeting's.
	other, err := s.CreateInstant(ctx, ua.ID, w.ID, "Khác")
	if err != nil {
		t.Fatal(err)
	}
	seedSummary(t, s, other, ua.ID, ai.ActionItem{Title: "Việc khác"})
	foreign := itemsByTitle(t, s, ua.ID, other)["Việc khác"].Item.ID
	ce = wantCode(t, mustErr(s.ConvertActionItems(ctx, ua.ID, m.ID, []ConvertActionItem{{ActionItemID: room}, {ActionItemID: foreign}})), "action_item_not_found")
	if ids, _ := ce.Fields["action_item_ids"].([]string); !slices.Equal(ids, []string{foreign}) {
		t.Fatalf("not found ids = %v", ce.Fields)
	}

	// Deleting the task frees its item again.
	if err := s.Tasks.Delete(ctx, ua.ID, first[0].TaskID); err != nil {
		t.Fatal(err)
	}
	if got := itemsByTitle(t, s, ua.ID, m)["Gửi báo cáo"]; got.Status != ActionItemPending || got.Task != nil {
		t.Fatalf("item of a deleted task: %+v", got)
	}
	if _, err := s.ConvertActionItems(ctx, ua.ID, m.ID, []ConvertActionItem{{ActionItemID: report}}); err != nil {
		t.Fatalf("item of a deleted task: %v", err)
	}
}

func TestConvertActionItemsKeepsTheClerksChoice(t *testing.T) {
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
	// "B" names ub exactly and "ngày mai" parses, yet the clerk chose nobody
	// and no due date: the server does not guess them back.
	seedSummary(t, s, m, ua.ID,
		ai.ActionItem{Title: "Gửi báo cáo", Owner: "B", Due: "ngày mai"},
		ai.ActionItem{Title: "Đặt phòng", Owner: "B", Due: "ngày mai"},
	)
	items := itemsByTitle(t, s, ua.ID, m)
	none := ""
	links, err := s.ConvertActionItems(ctx, ua.ID, m.ID, []ConvertActionItem{
		{ActionItemID: items["Gửi báo cáo"].Item.ID, Title: "  "},
		{ActionItemID: items["Đặt phòng"].Item.ID, Title: "Đặt phòng họp lớn", Description: "Tầng 3", AssigneeID: &ub.ID,
			DueDate: strPtr("2026-12-01"), ProjectID: &none, Priority: "high"},
	})
	if err != nil {
		t.Fatal(err)
	}
	a, err := s.q.GetTask(ctx, links[0].TaskID)
	if err != nil {
		t.Fatal(err)
	}
	b, err := s.q.GetTask(ctx, links[1].TaskID)
	if err != nil {
		t.Fatal(err)
	}
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
		t.Fatalf("clerk values: %+v", b)
	}
	if b.DueDate.Time.Format("2006-01-02") != "2026-12-01" {
		t.Fatalf("due: %v", b.DueDate)
	}
	if strings.Contains(b.Description, "(AI)") || !strings.HasPrefix(b.Description, "Tầng 3") {
		t.Fatalf("description %q", b.Description)
	}
}

// Spec §4, D3: the host, a secretary and a workspace admin clerk the action
// items and the summary; any other member only reads them.
func TestActionItemsNeedAClerk(t *testing.T) {
	s, ua, ub, m, memberPID := governanceFixture(t)
	ctx := context.Background()
	s.Tasks = NewTaskService(s.pool, s.q, s.ws, nil)
	s.AI = ai.NewGateway(s.q, &provider.Fake{Reply: func(provider.CompletionRequest) provider.CompletionResponse {
		return provider.CompletionResponse{Text: `{"summary":"Đã chốt.","decisions":[],"action_items":[{"title":"Gửi báo cáo","owner":"","due":""}]}`, Model: "fake"}
	}}, NewAIQuota(s.ent), nil, ai.Options{})
	if _, err := s.AddNote(ctx, ua.ID, m.ID, "Chốt lịch"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Summarize(ctx, ub.ID, m.ID, "vi"); !codedIs(err, "not_meeting_clerk") {
		t.Fatalf("member summarizes: %v", err)
	}
	if _, err := s.AddActionItem(ctx, ub.ID, m.ID, AddActionItemInput{Title: "x"}); !codedIs(err, "not_meeting_clerk") {
		t.Fatalf("member adds: %v", err)
	}
	seedSummary(t, s, m, ua.ID, ai.ActionItem{Title: "Đặt phòng"})
	room := itemsByTitle(t, s, ub.ID, m)["Đặt phòng"].Item.ID
	if err := s.DismissActionItem(ctx, ub.ID, m.ID, room, ""); !codedIs(err, "not_meeting_clerk") {
		t.Fatalf("member dismisses: %v", err)
	}
	if err := s.RestoreActionItem(ctx, ub.ID, m.ID, room); !codedIs(err, "not_meeting_clerk") {
		t.Fatalf("member restores: %v", err)
	}
	if _, err := s.ConvertActionItems(ctx, ub.ID, m.ID, []ConvertActionItem{{ActionItemID: room}}); !codedIs(err, "not_meeting_clerk") {
		t.Fatalf("member converts: %v", err)
	}

	yes := true
	if _, err := s.UpdateParticipantDuties(ctx, ua.ID, m.ID, memberPID, ParticipantDutiesInput{IsSecretary: &yes}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Summarize(ctx, ub.ID, m.ID, "vi"); err != nil {
		t.Fatalf("secretary summarizes: %v", err)
	}
	added, err := s.AddActionItem(ctx, ub.ID, m.ID, AddActionItemInput{Title: "In tài liệu"})
	if err != nil {
		t.Fatalf("secretary adds: %v", err)
	}
	if err := s.DismissActionItem(ctx, ub.ID, m.ID, added.Item.ID, ""); err != nil {
		t.Fatalf("secretary dismisses: %v", err)
	}
	if err := s.RestoreActionItem(ctx, ub.ID, m.ID, added.Item.ID); err != nil {
		t.Fatalf("secretary restores: %v", err)
	}
	if _, err := s.ConvertActionItems(ctx, ub.ID, m.ID, []ConvertActionItem{{ActionItemID: added.Item.ID}}); err != nil {
		t.Fatalf("secretary converts: %v", err)
	}
}

func TestActionItemLifecycle(t *testing.T) {
	s, ua, ub, w, m := summaryTasksFixture(t)
	ctx := context.Background()

	var ve ValidationError
	if _, err := s.AddActionItem(ctx, ua.ID, m.ID, AddActionItemInput{Title: "  "}); !errors.As(err, &ve) {
		t.Fatalf("blank title: %v", err)
	}
	if _, err := s.AddActionItem(ctx, ua.ID, m.ID, AddActionItemInput{Title: strings.Repeat("a", 501)}); !errors.As(err, &ve) {
		t.Fatalf("long title: %v", err)
	}
	// A scheduled meeting has nothing to follow through yet.
	start := time.Now().Add(time.Hour).Truncate(time.Second)
	later, err := s.Create(ctx, ua.ID, w.ID, CreateMeetingInput{Title: "Sau", StartsAt: start, EndsAt: start.Add(time.Hour)})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.AddActionItem(ctx, ua.ID, later.ID, AddActionItemInput{Title: "Sớm"}); !codedIs(err, "invalid_meeting_state") {
		t.Fatalf("scheduled meeting: %v", err)
	}

	seedSummary(t, s, m, ua.ID, ai.ActionItem{Title: "Gửi báo cáo"})
	added, err := s.AddActionItem(ctx, ua.ID, m.ID, AddActionItemInput{Title: " Đặt phòng ", OwnerText: "B", DueText: "ngày mai"})
	if err != nil {
		t.Fatal(err)
	}
	it := added.Item
	if it.Source != ActionItemSourceManual || it.Title != "Đặt phòng" || it.CreatedBy != ua.ID || it.CreatedByKind != "human" ||
		it.SummaryID.Valid || added.Status != ActionItemPending || it.Position != 1 {
		t.Fatalf("added = %+v", added)
	}
	if added.SuggestedAssigneeID == nil || *added.SuggestedAssigneeID != ub.ID || added.SuggestedDueDate == nil {
		t.Fatalf("suggestions for a typed item: %+v", added)
	}

	if err := s.DismissActionItem(ctx, ua.ID, m.ID, it.ID, strings.Repeat("x", 501)); !errors.As(err, &ve) {
		t.Fatalf("long reason: %v", err)
	}
	if err := s.DismissActionItem(ctx, ua.ID, m.ID, it.ID, " Đã có người làm "); err != nil {
		t.Fatal(err)
	}
	got := itemsByTitle(t, s, ub.ID, m)["Đặt phòng"]
	if got.Status != ActionItemDismissed || got.Item.DismissReason != "Đã có người làm" || got.Item.DismissedBy.String != ua.ID ||
		got.SuggestedAssigneeID != nil {
		t.Fatalf("dismissed = %+v", got)
	}
	var changes string
	if err := s.pool.QueryRow(ctx, `SELECT changes::text FROM audit_events WHERE action = $1 AND resource_id = $2`,
		audit.ActionMeetingActionItemDismissed, it.ID).Scan(&changes); err != nil || !strings.Contains(changes, "Đã có người làm") {
		t.Fatalf("dismiss audit: %s %v", changes, err)
	}
	for _, topic := range []string{"action_item.created", "action_item.dismissed"} {
		if n := countRows(t, s, `SELECT count(*) FROM outbox_events WHERE topic = $1 AND payload::jsonb->>'action_item_id' = $2`, topic, it.ID); n != 1 {
			t.Fatalf("%s events = %d", topic, n)
		}
	}
	if err := s.DismissActionItem(ctx, ua.ID, m.ID, it.ID, ""); !codedIs(err, "action_item_not_pending") {
		t.Fatalf("dismiss twice: %v", err)
	}
	if _, err := s.ConvertActionItems(ctx, ua.ID, m.ID, []ConvertActionItem{{ActionItemID: it.ID}}); !codedIs(err, "action_item_not_pending") {
		t.Fatalf("convert a dismissed item: %v", err)
	}
	if err := s.RestoreActionItem(ctx, ua.ID, m.ID, it.ID); err != nil {
		t.Fatal(err)
	}
	if got := itemsByTitle(t, s, ua.ID, m)["Đặt phòng"]; got.Status != ActionItemPending || got.Item.DismissReason != "" || got.Item.DismissedBy.Valid {
		t.Fatalf("restored = %+v", got)
	}
	if err := s.RestoreActionItem(ctx, ua.ID, m.ID, it.ID); !codedIs(err, "action_item_not_dismissed") {
		t.Fatalf("restore a pending item: %v", err)
	}
	if err := s.DismissActionItem(ctx, ua.ID, m.ID, "01JNOSUCHITEM0000000000000", ""); !codedIs(err, "action_item_not_found") {
		t.Fatalf("unknown item: %v", err)
	}
	report := itemsByTitle(t, s, ua.ID, m)["Gửi báo cáo"].Item.ID
	if _, err := s.ConvertActionItems(ctx, ua.ID, m.ID, []ConvertActionItem{{ActionItemID: report}}); err != nil {
		t.Fatal(err)
	}
	if err := s.DismissActionItem(ctx, ua.ID, m.ID, report, ""); !codedIs(err, "action_item_not_pending") {
		t.Fatalf("dismiss a converted item: %v", err)
	}
}

func TestActionItemsDescribeTheirTasks(t *testing.T) {
	s, ua, ub, _, m := summaryTasksFixture(t)
	ctx := context.Background()
	seedSummary(t, s, m, ua.ID,
		ai.ActionItem{Title: "Gửi báo cáo", Owner: "B", Due: "ngày mai"},
		ai.ActionItem{Title: "Đặt phòng", Owner: "Zed", Due: "khi nào rảnh"},
		ai.ActionItem{Title: "In tài liệu"},
		ai.ActionItem{Title: "Gọi khách"},
	)
	items := itemsByTitle(t, s, ub.ID, m)
	first := items["Gửi báo cáo"]
	if first.Item.OwnerText != "B" || first.Item.DueText != "ngày mai" || first.Item.Source != ActionItemSourceAI {
		t.Fatalf("stored fields: %+v", first)
	}
	if first.SuggestedAssigneeID == nil || *first.SuggestedAssigneeID != ub.ID {
		t.Fatalf("suggested assignee: %v", first.SuggestedAssigneeID)
	}
	want := parseMeetingDueSpoken("ngày mai", meetingDueAnchor(m))
	if first.SuggestedDueDate == nil || want == nil || *first.SuggestedDueDate != *want {
		t.Fatalf("due date: %v want %v", first.SuggestedDueDate, want)
	}
	if second := items["Đặt phòng"]; second.SuggestedAssigneeID != nil || second.SuggestedDueDate != nil || second.Task != nil {
		t.Fatalf("unmatched item: %+v", second)
	}

	past, future := "2020-01-02", "2999-01-02"
	links, err := s.ConvertActionItems(ctx, ua.ID, m.ID, []ConvertActionItem{
		{ActionItemID: first.Item.ID, AssigneeID: &ub.ID, DueDate: &past},
		{ActionItemID: items["In tài liệu"].Item.ID, DueDate: &past},
		{ActionItemID: items["Gọi khách"].Item.ID, DueDate: &future},
	})
	if err != nil {
		t.Fatal(err)
	}
	// One overdue task is done: it is no longer overdue.
	if _, err := s.pool.Exec(ctx, `UPDATE tasks SET status = 'done' WHERE id = $1`, links[1].TaskID); err != nil {
		t.Fatal(err)
	}
	if err := s.DismissActionItem(ctx, ua.ID, m.ID, items["Đặt phòng"].Item.ID, ""); err != nil {
		t.Fatal(err)
	}
	v, err := s.ActionItems(ctx, ub.ID, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	if v.Counts != (ActionItemCounts{Pending: 0, Converted: 3, Dismissed: 1, TasksDone: 1, TasksOverdue: 1}) {
		t.Fatalf("counts = %+v", v.Counts)
	}
	got := itemsByTitle(t, s, ub.ID, m)["Gửi báo cáo"]
	if got.Status != ActionItemConverted || got.Task == nil || got.Task.ID != links[0].TaskID || got.Task.Title != "Gửi báo cáo" ||
		!got.Task.Overdue || got.Task.Done || got.Task.AssigneeID == nil || *got.Task.AssigneeID != ub.ID ||
		got.Task.DueDate == nil || *got.Task.DueDate != past || got.SuggestedAssigneeID != nil {
		t.Fatalf("converted item = %+v task %+v", got, got.Task)
	}
}

// UNI-1853 review, kept for the items table: a batch that would trip the
// active-duplicate guard is refused once, before any insert, naming every
// item that would.
func TestConvertActionItemsNamesEveryDuplicateItem(t *testing.T) {
	s, ua, _, w, m := summaryTasksFixture(t)
	ctx := context.Background()
	open, err := s.Tasks.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "Gửi  báo cáo"})
	if err != nil {
		t.Fatal(err)
	}
	seedSummary(t, s, m, ua.ID, ai.ActionItem{Title: "Đặt phòng"}, ai.ActionItem{Title: "gửi báo cáo"}, ai.ActionItem{Title: "Mới"})
	extra, err := s.AddActionItem(ctx, ua.ID, m.ID, AddActionItemInput{Title: "Mới 2"})
	if err != nil {
		t.Fatal(err)
	}
	items := itemsByTitle(t, s, ua.ID, m)
	room, report, fresh := items["Đặt phòng"].Item.ID, items["gửi báo cáo"].Item.ID, items["Mới"].Item.ID
	_, err = s.ConvertActionItems(ctx, ua.ID, m.ID, []ConvertActionItem{
		{ActionItemID: extra.Item.ID, Title: "Đặt phòng"}, {ActionItemID: fresh}, {ActionItemID: report}, {ActionItemID: room},
	})
	ce := wantCode(t, err, "active_duplicate_task")
	want := []string{room, report}
	slices.Sort(want)
	if ids, _ := ce.Fields["action_item_ids"].([]string); !slices.Equal(ids, want) {
		t.Fatalf("action_item_ids = %v, want %v (room repeats the first, report matches an open task)", ce.Fields, want)
	}
	if ce.Fields["task_id"] != open.ID {
		t.Fatalf("fields = %v, want the open task %s named", ce.Fields, open.ID)
	}
	if n := countRows(t, s, `SELECT count(*) FROM tasks WHERE workspace_id = $1 AND origin_id = $2`, w.ID, m.ID); n != 0 {
		t.Fatalf("a refused batch created %d tasks", n)
	}
	project, err := s.Tasks.CreateProject(ctx, Human(ua.ID), w.ID, CreateProjectInput{Title: "Khác"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.ConvertActionItems(ctx, ua.ID, m.ID, []ConvertActionItem{
		{ActionItemID: extra.Item.ID, Title: "Đặt phòng"}, {ActionItemID: fresh}, {ActionItemID: report, ProjectID: &project.ID},
	}); err != nil {
		t.Fatalf("without the duplicates: %v", err)
	}
}

func TestConvertActionItemsIgnoresADeletedMeetingProject(t *testing.T) {
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
	seedSummary(t, s, m, ua.ID, ai.ActionItem{Title: "Gửi báo cáo"}, ai.ActionItem{Title: "Đặt phòng"})
	items := itemsByTitle(t, s, ua.ID, m)
	links, err := s.ConvertActionItems(ctx, ua.ID, m.ID, []ConvertActionItem{{ActionItemID: items["Gửi báo cáo"].Item.ID}})
	if err != nil {
		t.Fatalf("the meeting's deleted project refused the batch: %v", err)
	}
	if task, err := s.q.GetTask(ctx, links[0].TaskID); err != nil || task.ProjectID.Valid {
		t.Fatalf("task took the deleted project %v (%v)", task.ProjectID, err)
	}
	gone := project.ID
	_, err = s.ConvertActionItems(ctx, ua.ID, m.ID, []ConvertActionItem{{ActionItemID: items["Đặt phòng"].Item.ID, ProjectID: &gone}})
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("named deleted project: %v, want not found", err)
	}
}

// Spec §13.1: twenty conversions of the same item running at once make one
// task. The titles differ, so the duplicate-title guard cannot be what stops
// the others; only the item lock and the state re-read can.
func TestConvertActionItemsConcurrentConversionsMakeOneTask(t *testing.T) {
	s, ua, _, w, m := summaryTasksFixture(t)
	ctx := context.Background()
	seedSummary(t, s, m, ua.ID, ai.ActionItem{Title: "Gửi báo cáo"})
	id := itemsByTitle(t, s, ua.ID, m)["Gửi báo cáo"].Item.ID
	const n = 20
	errs := make([]error, n)
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, errs[i] = s.ConvertActionItems(ctx, ua.ID, m.ID, []ConvertActionItem{{ActionItemID: id, Title: fmt.Sprintf("Gửi báo cáo bản %d", i)}})
		}()
	}
	close(start)
	wg.Wait()
	ok, refused := 0, 0
	for _, err := range errs {
		switch {
		case err == nil:
			ok++
		case codedIs(err, "action_item_not_pending"):
			refused++
		default:
			t.Fatalf("unexpected error: %v", err)
		}
	}
	if ok != 1 || refused != n-1 {
		t.Fatalf("succeeded %d, refused %d; want 1 and %d", ok, refused, n-1)
	}
	if got := countRows(t, s, `SELECT count(*) FROM tasks WHERE workspace_id = $1 AND origin_id = $2`, w.ID, m.ID); got != 1 {
		t.Fatalf("tasks = %d, want 1", got)
	}
}

// Spec §13.1: a conversion and a regeneration of the same meeting take one
// lock, so a summary that commits while a conversion waits replaces the
// pending items, and the conversion answers not found instead of pointing a
// task at an item that is gone. A transaction stands in for Summarize's
// store: it holds the lock and replaces the items, and commits only after
// the conversion has had time to reach the lock.
func TestConvertActionItemsWaitsForARegeneration(t *testing.T) {
	s, ua, _, w, m := summaryTasksFixture(t)
	ctx := context.Background()
	seedSummary(t, s, m, ua.ID, ai.ActionItem{Title: "Gửi báo cáo"})
	old := itemsByTitle(t, s, ua.ID, m)["Gửi báo cáo"].Item.ID

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	if err := q.LockMeetingSummaryChanges(ctx, m.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := replaceSummaryActionItems(ctx, q, m, db.MeetingSummary{ID: "01JNEWSUMMARY000000000000"}, []ai.ActionItem{{Title: "Khác"}}, newSummaryLabels()); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		_, err := s.ConvertActionItems(ctx, ua.ID, m.ID, []ConvertActionItem{{ActionItemID: old}})
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
	wantCode(t, <-done, "action_item_not_found")
	if n := countRows(t, s, `SELECT count(*) FROM tasks WHERE workspace_id = $1`, w.ID); n != 0 {
		t.Fatalf("tasks pointing at a replaced item: %d", n)
	}
}

// Spec §7.1, D6: a regenerated summary replaces only the AI items nobody has
// handled; converted, dismissed and manual items stay, an item whose task was
// deleted counts as pending, and a new item repeating a kept title (a
// dismissed one included) is skipped.
func TestStoreSummaryKeepsHandledItems(t *testing.T) {
	s, ua, _, _, m := summaryTasksFixture(t)
	ctx := context.Background()
	seedSummary(t, s, m, ua.ID,
		ai.ActionItem{Title: "Gửi báo cáo"}, ai.ActionItem{Title: "Đặt phòng"},
		ai.ActionItem{Title: "Chờ xử lý"}, ai.ActionItem{Title: "Task đã xoá"},
	)
	items := itemsByTitle(t, s, ua.ID, m)
	links, err := s.ConvertActionItems(ctx, ua.ID, m.ID, []ConvertActionItem{
		{ActionItemID: items["Gửi báo cáo"].Item.ID}, {ActionItemID: items["Task đã xoá"].Item.ID},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Tasks.Delete(ctx, ua.ID, links[1].TaskID); err != nil {
		t.Fatal(err)
	}
	if err := s.DismissActionItem(ctx, ua.ID, m.ID, items["Đặt phòng"].Item.ID, "không cần"); err != nil {
		t.Fatal(err)
	}
	manual, err := s.AddActionItem(ctx, ua.ID, m.ID, AddActionItemInput{Title: "Việc tay"})
	if err != nil {
		t.Fatal(err)
	}

	sum := seedSummary(t, s, m, ua.ID,
		ai.ActionItem{Title: "đặt  phòng"}, ai.ActionItem{Title: "Việc mới", Owner: "B"}, ai.ActionItem{Title: "GỬI BÁO CÁO"},
		ai.ActionItem{Title: "Việc mới"}, ai.ActionItem{Title: " "},
	)
	after := itemsByTitle(t, s, ua.ID, m)
	if len(after) != 4 {
		t.Fatalf("items after regeneration = %v", after)
	}
	if got := after["Gửi báo cáo"]; got.Item.ID != items["Gửi báo cáo"].Item.ID || got.Status != ActionItemConverted {
		t.Fatalf("converted item = %+v", got)
	}
	if got := after["Đặt phòng"]; got.Item.ID != items["Đặt phòng"].Item.ID || got.Status != ActionItemDismissed {
		t.Fatalf("dismissed item = %+v", got)
	}
	if got := after["Việc tay"]; got.Item.ID != manual.Item.ID {
		t.Fatalf("manual item = %+v", got)
	}
	if got := after["Việc mới"]; got.Item.SummaryID.String != sum.ID || got.Item.OwnerText != "B" || got.Item.Position != 0 ||
		got.Item.CreatedBy != "meeting_summary" || got.Item.CreatedByKind != "system" {
		t.Fatalf("new item = %+v", got)
	}
	var metadata string
	if err := s.pool.QueryRow(ctx, `SELECT metadata::text FROM audit_events WHERE action = $1 AND metadata::jsonb->>'summary_id' = $2`,
		audit.ActionMeetingSummaryCreated, sum.ID).Scan(&metadata); err != nil {
		t.Fatal(err)
	}
	var meta map[string]any
	if err := json.Unmarshal([]byte(metadata), &meta); err != nil {
		t.Fatal(err)
	}
	if meta["replaced_pending"] != float64(2) || meta["kept"] != float64(3) || meta["skipped_duplicates"] != float64(3) {
		t.Fatalf("audit metadata = %v", meta)
	}
}

// Spec §7.1: Summarize tells the model which items the meeting already
// handled, and leaves out the pending AI ones it is about to replace.
func TestSummarizeListsHandledItems(t *testing.T) {
	fake := &provider.Fake{Reply: func(provider.CompletionRequest) provider.CompletionResponse {
		return provider.CompletionResponse{Text: `{"summary":"Đã chốt.","decisions":[],"action_items":[]}`, Model: "fake"}
	}}
	s, ua, m, _ := summaryFixture(t, fake, ai.Options{})
	ctx := context.Background()
	seedSummary(t, s, m, ua.ID, ai.ActionItem{Title: "Chờ AI"}, ai.ActionItem{Title: "Bỏ qua AI"})
	if err := s.DismissActionItem(ctx, ua.ID, m.ID, itemsByTitle(t, s, ua.ID, m)["Bỏ qua AI"].Item.ID, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AddActionItem(ctx, ua.ID, m.ID, AddActionItemInput{Title: "Việc tay"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Summarize(ctx, ua.ID, m.ID, "vi"); err != nil {
		t.Fatal(err)
	}
	prompt := fake.Last.Messages[len(fake.Last.Messages)-1].Content
	if !strings.Contains(prompt, "<untrusted source=\"existing_action_items\">\n- Bỏ qua AI\n- Việc tay\n</untrusted>") || strings.Contains(prompt, "Chờ AI") {
		t.Fatalf("prompt lists the handled items only:\n%s", prompt)
	}
}
