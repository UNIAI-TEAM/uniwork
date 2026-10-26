package service

import (
	"context"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/audit"
)

// follow-5: an item the duplicate guard refuses because the work is already
// an open task is linked to that task instead: it counts as converted,
// tracks the task, creates nothing, and is audited.
func TestLinkActionItemToTheOpenTask(t *testing.T) {
	s, ua, ub, w, m := summaryTasksFixture(t)
	ctx := context.Background()
	open, err := s.Tasks.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "Gửi báo cáo tuần"})
	if err != nil {
		t.Fatal(err)
	}
	seedSummary(t, s, m, ua.ID, ai.ActionItem{Title: "gửi báo cáo tuần"}, ai.ActionItem{Title: "Đặt phòng"})
	items := itemsByTitle(t, s, ua.ID, m)
	report, room := items["gửi báo cáo tuần"].Item.ID, items["Đặt phòng"].Item.ID
	_, err = s.ConvertActionItems(ctx, ua.ID, m.ID, "vi", []ConvertActionItem{{ActionItemID: report}})
	if ce := wantCode(t, err, "active_duplicate_task"); ce.Fields["task_id"] != open.ID {
		t.Fatalf("guard fields = %v", ce.Fields)
	}

	if err := s.LinkActionItem(ctx, ub.ID, m.ID, report, open.ID); !codedIs(err, "not_meeting_clerk") {
		t.Fatalf("a member links: %v", err)
	}
	before := countRows(t, s, `SELECT count(*) FROM tasks WHERE workspace_id = $1`, w.ID)
	if err := s.LinkActionItem(ctx, ua.ID, m.ID, report, open.ID); err != nil {
		t.Fatal(err)
	}
	view, err := s.ActionItems(ctx, ua.ID, m.ID)
	if err != nil {
		t.Fatal(err)
	}
	var linked ActionItemView
	for _, it := range view.Items {
		if it.Item.ID == report {
			linked = it
		}
	}
	if linked.Status != ActionItemConverted || linked.Task == nil || linked.Task.ID != open.ID || view.Counts.Converted != 1 {
		t.Fatalf("linked item = %+v counts = %+v", linked, view.Counts)
	}
	if after := countRows(t, s, `SELECT count(*) FROM tasks WHERE workspace_id = $1`, w.ID); after != before {
		t.Fatalf("linking created %d tasks", after-before)
	}
	if n := countRows(t, s, `SELECT count(*) FROM audit_events WHERE action = $1 AND resource_id = $2 AND metadata::jsonb->>'task_id' = $3`,
		audit.ActionMeetingActionItemLinked, report, open.ID); n != 1 {
		t.Fatalf("link audit rows = %d", n)
	}

	// A handled item cannot be linked again; a task of another workspace,
	// or none, is not found.
	if err := s.LinkActionItem(ctx, ua.ID, m.ID, report, open.ID); !codedIs(err, "action_item_not_pending") {
		t.Fatalf("linking a converted item: %v", err)
	}
	if err := s.LinkActionItem(ctx, ua.ID, m.ID, room, "01NOSUCHTASK0000000000000"); err != ErrNotFound {
		t.Fatalf("an unknown task: %v", err)
	}
	other, err := s.ws.CreateInOrg(ctx, ua.ID, w.OrganizationID, "Khác", "khac")
	if err != nil {
		t.Fatal(err)
	}
	foreign, err := s.Tasks.Create(ctx, Human(ua.ID), other.Workspace.ID, CreateTaskInput{Title: "Ngoài"})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.LinkActionItem(ctx, ua.ID, m.ID, room, foreign.ID); err != ErrNotFound {
		t.Fatalf("a task of another workspace: %v", err)
	}
}
