package service

import (
	"context"
	"slices"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/audit"
)

// The undo bar (spec 2026-10-29 G) takes back only what the caller just did:
// an item they converted within the window into a task nobody touched since.
// Everything else is skipped without an error, and only the restored ids
// come back, so the client reopens exactly those rows.
func TestUndoConvertRestoresOnlyFreshUntouchedItemsOfTheCaller(t *testing.T) {
	s, ua, ub, w, m := summaryTasksFixture(t)
	ctx := context.Background()
	titles := []string{"Mới", "Cũ", "Đã sửa", "Người khác", "Đã nối"}
	var seed []ai.ActionItem
	for _, title := range titles {
		seed = append(seed, ai.ActionItem{Title: title})
	}
	seedSummary(t, s, m, ua.ID, seed...)
	items := itemsByTitle(t, s, ua.ID, m)
	id := func(title string) string { return items[title].Item.ID }
	links, err := s.ConvertActionItems(ctx, ua.ID, m.ID, "vi", []ConvertActionItem{
		{ActionItemID: id("Mới")}, {ActionItemID: id("Cũ")}, {ActionItemID: id("Đã sửa")}, {ActionItemID: id("Người khác")},
	})
	if err != nil {
		t.Fatal(err)
	}
	task := map[string]string{}
	for i, title := range titles[:4] {
		task[title] = links[i].TaskID
	}
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := s.pool.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	// Converted three minutes ago: past the window.
	exec(`UPDATE meeting_action_items SET converted_at = converted_at - interval '3 minutes' WHERE id = $1`, id("Cũ"))
	exec(`UPDATE tasks SET created_at = created_at - interval '3 minutes', updated_at = updated_at - interval '3 minutes' WHERE id = $1`, task["Cũ"])
	// Someone changed the task after it was made.
	exec(`UPDATE tasks SET title = 'Đã sửa xong', updated_at = now() + interval '1 second', revision = revision + 1 WHERE id = $1`, task["Đã sửa"])
	// Another clerk converted it.
	exec(`UPDATE meeting_action_items SET converted_by = $1 WHERE id = $2`, ub.ID, id("Người khác"))
	// Linked to a task that already existed: undo never deletes that one.
	existing, err := s.Tasks.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "Báo cáo tuần"})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.LinkActionItem(ctx, ua.ID, m.ID, id("Đã nối"), existing.ID); err != nil {
		t.Fatal(err)
	}
	task["Đã nối"] = existing.ID

	all := []string{"01JNOSUCHACTIONITEM0000000"}
	for _, title := range titles {
		all = append(all, id(title))
	}
	restored, err := s.UndoConvertActionItems(ctx, ua.ID, m.ID, all)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(restored, []string{id("Mới")}) {
		t.Fatalf("restored = %v, want only the fresh item %s", restored, id("Mới"))
	}
	// The task goes to the trash, never straight out of the database.
	if n := countRows(t, s, `SELECT count(*) FROM tasks WHERE id = $1 AND trashed_at IS NOT NULL AND trashed_by = $2`, task["Mới"], ua.ID); n != 1 {
		t.Fatal("the fresh item's task is not in the trash")
	}
	after := itemsByTitle(t, s, ua.ID, m)
	if it := after["Mới"]; it.Status != ActionItemPending || it.Item.TaskID.Valid || it.Item.ConvertedBy.Valid || it.Item.ConvertedAt.Valid {
		t.Fatalf("fresh item = %s task=%v by=%v", it.Status, it.Item.TaskID, it.Item.ConvertedBy)
	}
	for _, title := range titles[1:] {
		if after[title].Status != ActionItemConverted {
			t.Errorf("%s: status %s, want it left converted", title, after[title].Status)
		}
		if n := countRows(t, s, `SELECT count(*) FROM tasks WHERE id = $1 AND trashed_at IS NULL`, task[title]); n != 1 {
			t.Errorf("%s: its task is gone", title)
		}
	}
	if n := countRows(t, s, `SELECT count(*) FROM audit_events WHERE action = $1 AND resource_id = $2 AND metadata::jsonb->'action_item_ids' ? $3`,
		audit.ActionMeetingActionItemsUnconverted, m.ID, id("Mới")); n != 1 {
		t.Fatalf("batch audit rows = %d", n)
	}
	if n := countRows(t, s, `SELECT count(*) FROM audit_events WHERE action = $1 AND resource_id = $2`, audit.ActionTaskTrashed, task["Mới"]); n != 1 {
		t.Fatalf("task.trashed audit rows = %d", n)
	}
	if n := countRows(t, s, `SELECT count(*) FROM outbox_events WHERE topic = 'action_item.restored' AND payload::jsonb->>'action_item_id' = $1`, id("Mới")); n != 1 {
		t.Fatalf("action_item.restored events = %d", n)
	}

	// Nothing left to undo is an empty answer, not an error.
	again, err := s.UndoConvertActionItems(ctx, ua.ID, m.ID, []string{id("Mới")})
	if err != nil || len(again) != 0 {
		t.Fatalf("second undo = %v, %v", again, err)
	}
}

// A task someone already used is not the clerk's to take back: a comment, an
// attachment, a dependency on either side or another item linked to it never
// bumps tasks.updated_at, so each is checked on its own and the item stays
// converted with its task live.
func TestUndoConvertSkipsATaskSomeoneElseUsed(t *testing.T) {
	s, ua, ub, w, m := summaryTasksFixture(t)
	ctx := context.Background()
	titles := []string{"Mới", "Bình luận", "Đính kèm", "Phụ thuộc", "Nối thêm", "Việc khác"}
	var seed []ai.ActionItem
	for _, title := range titles {
		seed = append(seed, ai.ActionItem{Title: title})
	}
	seedSummary(t, s, m, ua.ID, seed...)
	items := itemsByTitle(t, s, ua.ID, m)
	id := func(title string) string { return items[title].Item.ID }
	converted := titles[:5]
	in := make([]ConvertActionItem, 0, len(converted))
	for _, title := range converted {
		in = append(in, ConvertActionItem{ActionItemID: id(title)})
	}
	links, err := s.ConvertActionItems(ctx, ua.ID, m.ID, "vi", in)
	if err != nil {
		t.Fatal(err)
	}
	task := map[string]string{}
	for i, title := range converted {
		task[title] = links[i].TaskID
	}
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := s.pool.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.Tasks.AddComment(ctx, Human(ub.ID), task["Bình luận"], "Mình nhận việc này"); err != nil {
		t.Fatal(err)
	}
	exec(`INSERT INTO attachments (id, organization_id, workspace_id, task_id, uploader_type, uploader_id, object_key, filename, content_type, size_bytes)
		VALUES ('att-undo-convert', $1, $2, $3, 'member', $4, 'k/undo.txt', 'undo.txt', 'text/plain', 5)`, w.OrganizationID, w.ID, task["Đính kèm"], ub.ID)
	other, err := s.Tasks.Create(ctx, Human(ub.ID), w.ID, CreateTaskInput{Title: "Việc đang chờ"})
	if err != nil {
		t.Fatal(err)
	}
	// The converted task is the far side: another task waits on it.
	exec(`INSERT INTO task_dependencies (id, organization_id, workspace_id, task_id, depends_on_task_id, type)
		VALUES ('dep-undo-convert', $1, $2, $3, $4, 'blocked_by')`, w.OrganizationID, w.ID, other.ID, task["Phụ thuộc"])
	if err := s.LinkActionItem(ctx, ua.ID, m.ID, id("Việc khác"), task["Nối thêm"]); err != nil {
		t.Fatal(err)
	}

	restored, err := s.UndoConvertActionItems(ctx, ua.ID, m.ID, []string{
		id("Mới"), id("Bình luận"), id("Đính kèm"), id("Phụ thuộc"), id("Nối thêm"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(restored, []string{id("Mới")}) {
		t.Fatalf("restored = %v, want only %s", restored, id("Mới"))
	}
	after := itemsByTitle(t, s, ua.ID, m)
	for _, title := range converted[1:] {
		if after[title].Status != ActionItemConverted {
			t.Errorf("%s: status %s, want it left converted", title, after[title].Status)
		}
		if n := countRows(t, s, `SELECT count(*) FROM tasks WHERE id = $1 AND trashed_at IS NULL`, task[title]); n != 1 {
			t.Errorf("%s: its task left the live list", title)
		}
	}
	if n := countRows(t, s, `SELECT count(*) FROM task_comments WHERE task_id = $1`, task["Bình luận"]); n != 1 {
		t.Fatalf("comments = %d, want the one An wrote", n)
	}
}

func TestUndoConvertNeedsTheConvertGate(t *testing.T) {
	s, ua, ub, m, _ := governanceFixture(t)
	ctx := context.Background()
	s.Tasks = NewTaskService(s.pool, s.q, s.ws, nil)
	seedSummary(t, s, m, ua.ID, ai.ActionItem{Title: "Đặt phòng"})
	room := itemsByTitle(t, s, ua.ID, m)["Đặt phòng"].Item.ID
	if _, err := s.ConvertActionItems(ctx, ua.ID, m.ID, "vi", []ConvertActionItem{{ActionItemID: room}}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UndoConvertActionItems(ctx, ub.ID, m.ID, []string{room}); !codedIs(err, "not_meeting_clerk") {
		t.Fatalf("member undoes: %v", err)
	}
	if _, err := s.UndoConvertActionItems(ctx, ua.ID, m.ID, nil); err == nil {
		t.Fatal("an empty list must be refused")
	}
	many := make([]string, maxActionItemsPerConvert+1)
	for i := range many {
		many[i] = room
	}
	if _, err := s.UndoConvertActionItems(ctx, ua.ID, m.ID, many); err == nil {
		t.Fatal("more than 50 ids must be refused")
	}
	if got, err := s.UndoConvertActionItems(ctx, ua.ID, m.ID, []string{room}); err != nil || !slices.Equal(got, []string{room}) {
		t.Fatalf("host undoes = %v, %v", got, err)
	}
}
