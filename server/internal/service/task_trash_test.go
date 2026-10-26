package service

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// trashTestTask creates a task under parentID ("" for a root).
func trashTestTask(t *testing.T, s *TaskService, ua db.User, w db.Workspace, parentID, title string) db.Task {
	t.Helper()
	in := CreateTaskInput{Title: title, AllowDuplicate: true}
	if parentID != "" {
		in.ParentTaskID = &parentID
	}
	task, err := s.Create(context.Background(), Human(ua.ID), w.ID, in)
	if err != nil {
		t.Fatal(err)
	}
	return task
}

// rawTask reads a row whether or not it is in the trash.
func rawTask(t *testing.T, s *TaskService, id string) db.Task {
	t.Helper()
	task, err := s.q.GetTaskByIDIncludingTrashed(context.Background(), id)
	if err != nil {
		t.Fatalf("read %s: %v", id, err)
	}
	return task
}

func auditRows(t *testing.T, s *TaskService, action string, ids ...string) int {
	t.Helper()
	var n int
	if err := s.pool.QueryRow(context.Background(),
		`SELECT count(*) FROM audit_events WHERE action = $1 AND resource_id = ANY($2)`, action, ids).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func taskEvents(evs []Event, topic string, ids ...string) int {
	n := 0
	for _, e := range evs {
		if e.Type != topic {
			continue
		}
		for _, id := range ids {
			if e.Payload["task_id"] == id {
				n++
			}
		}
	}
	return n
}

// seedTasks inserts n tasks straight into the table (a 1000-row tree through
// Create would take minutes); parentID "" makes them roots.
func seedTasks(t *testing.T, s *TaskService, ua db.User, w db.Workspace, prefix, parentID string, n int) []string {
	t.Helper()
	parent := &parentID
	if parentID == "" {
		parent = nil
	}
	if _, err := s.pool.Exec(context.Background(), `
		INSERT INTO tasks (id, workspace_id, organization_id, number, title, description, created_by, creator_type, creator_id, last_activity_at, parent_task_id)
		SELECT $1 || lpad(g::text, 5, '0'), $2, $3,
		       (SELECT COALESCE(max(number), 0) FROM tasks WHERE workspace_id = $2) + g,
		       'seed ' || g, '', $4, 'member', $4, now(), $5
		FROM generate_series(1, $6::int) g`, prefix, w.ID, w.OrganizationID, ua.ID, parent, n); err != nil {
		t.Fatal(err)
	}
	ids := make([]string, n)
	for i := range ids {
		ids[i] = fmt.Sprintf("%s%05d", prefix, i+1)
	}
	return ids
}

func TestTrashTaskMovesItsSubtreeInOneBatch(t *testing.T) {
	s, events, ua, _, w := taskFixture(t)
	ctx := context.Background()
	parent := trashTestTask(t, s, ua, w, "", "Gốc 1")
	c1 := trashTestTask(t, s, ua, w, parent.ID, "Con 1")
	c2 := trashTestTask(t, s, ua, w, parent.ID, "Con 2")

	res, err := s.Trash(ctx, Human(ua.ID), parent.ID)
	if err != nil {
		t.Fatal(err)
	}
	ids := []string{parent.ID, c1.ID, c2.ID}
	if res.BatchID == "" || len(res.IDs) != 3 {
		t.Fatalf("result = %+v, want one batch of three", res)
	}
	for _, id := range ids {
		row := rawTask(t, s, id)
		if row.TrashBatchID.String != res.BatchID || !row.TrashedAt.Valid || row.TrashedBy.String != ua.ID {
			t.Fatalf("row %s = batch %q at %v by %q", id, row.TrashBatchID.String, row.TrashedAt, row.TrashedBy.String)
		}
		if d := row.PurgeAfter.Time.Sub(row.TrashedAt.Time) - trashRetention; d < -time.Minute || d > time.Minute {
			t.Fatalf("row %s purge_after %v is not trashed_at + 30 days (%v)", id, row.PurgeAfter.Time, row.TrashedAt.Time)
		}
		if _, err := s.Get(ctx, ua.ID, id); !errors.Is(err, ErrNotFound) {
			t.Fatalf("Get %s after trash = %v, want ErrNotFound", id, err)
		}
	}
	if n := auditRows(t, s, "task.trashed", ids...); n != 3 {
		t.Fatalf("task.trashed audit rows = %d, want 3", n)
	}
	if n := taskEvents(events.drain(t), "task.trashed", ids...); n != 3 {
		t.Fatalf("task.trashed events = %d, want 3", n)
	}
}

func TestRestoreTaskRestoresTheWholeBatch(t *testing.T) {
	s, events, ua, ub, w := taskFixture(t)
	ctx := context.Background()
	parent := trashTestTask(t, s, ua, w, "", "Gốc 2")
	child := trashTestTask(t, s, ua, w, parent.ID, "Con")
	trashed, err := s.Trash(ctx, Human(ua.ID), parent.ID)
	if err != nil {
		t.Fatal(err)
	}

	if _, err := s.Restore(ctx, Human(ub.ID), child.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("non-member restore = %v, want ErrForbidden", err)
	}
	// Restoring any member of the batch brings back the whole batch.
	res, err := s.Restore(ctx, Human(ua.ID), child.ID)
	if err != nil {
		t.Fatal(err)
	}
	if res.BatchID != trashed.BatchID || len(res.IDs) != 2 {
		t.Fatalf("restore = %+v, want batch %s with two rows", res, trashed.BatchID)
	}
	got, err := s.Get(ctx, ua.ID, child.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.ParentTaskID.String != parent.ID || got.TrashBatchID.Valid || got.PurgeAfter.Valid {
		t.Fatalf("restored child = parent %q batch %v purge %v", got.ParentTaskID.String, got.TrashBatchID, got.PurgeAfter)
	}
	if _, err := s.Get(ctx, ua.ID, parent.ID); err != nil {
		t.Fatalf("parent after restore: %v", err)
	}
	if n := auditRows(t, s, "task.restored", parent.ID, child.ID); n != 2 {
		t.Fatalf("task.restored audit rows = %d, want 2", n)
	}
	if n := taskEvents(events.drain(t), "task.restored", parent.ID, child.ID); n != 2 {
		t.Fatalf("task.restored events = %d, want 2", n)
	}
	if _, err := s.Restore(ctx, Human(ua.ID), parent.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("restore of a live task = %v, want ErrNotFound", err)
	}
}

func TestRestoreChildWhoseParentStaysTrashedBecomesRoot(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	parent := trashTestTask(t, s, ua, w, "", "Gốc 3")
	child := trashTestTask(t, s, ua, w, parent.ID, "Con")
	grandchild := trashTestTask(t, s, ua, w, child.ID, "Cháu")
	first, err := s.Trash(ctx, Human(ua.ID), child.ID)
	if err != nil {
		t.Fatal(err)
	}
	// The parent leaves in its own batch; the child already sits in another.
	second, err := s.Trash(ctx, Human(ua.ID), parent.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(second.IDs) != 1 || first.BatchID == second.BatchID {
		t.Fatalf("parent batch = %+v, child batch = %+v", second, first)
	}

	if _, err := s.Restore(ctx, Human(ua.ID), child.ID); err != nil {
		t.Fatal(err)
	}
	got, err := s.Get(ctx, ua.ID, child.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.ParentTaskID.Valid {
		t.Fatalf("restored child still points at trashed parent %s", got.ParentTaskID.String)
	}
	// A member whose parent came back in the same batch keeps it.
	gc, err := s.Get(ctx, ua.ID, grandchild.ID)
	if err != nil || gc.ParentTaskID.String != child.ID {
		t.Fatalf("grandchild = %+v %v, want parent %s", gc.ParentTaskID, err, child.ID)
	}
	if _, err := s.Get(ctx, ua.ID, parent.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("parent = %v, want still trashed", err)
	}
}

func TestBatchTrashIsOneBatchAndRestoresTogether(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	parent := trashTestTask(t, s, ua, w, "", "Gốc 4")
	child := trashTestTask(t, s, ua, w, parent.ID, "Con")
	other := trashTestTask(t, s, ua, w, "", "Gốc 5")
	ids := []string{parent.ID, child.ID, other.ID}

	if _, err := s.TrashMany(ctx, Human(ua.ID), w.ID, append(append([]string{}, ids...), "01JNOTATASK000000000000000")); err == nil {
		t.Fatal("expected an unknown id to fail the whole batch")
	}
	for _, id := range ids {
		if _, err := s.Get(ctx, ua.ID, id); err != nil {
			t.Fatalf("task %s trashed by a failed batch: %v", id, err)
		}
	}

	res, err := s.TrashMany(ctx, Human(ua.ID), w.ID, ids)
	if err != nil {
		t.Fatal(err)
	}
	if res.BatchID == "" || len(res.IDs) != 3 {
		t.Fatalf("batch = %+v, want three rows (the child once)", res)
	}
	for _, id := range ids {
		if row := rawTask(t, s, id); row.TrashBatchID.String != res.BatchID {
			t.Fatalf("row %s in batch %q, want %s", id, row.TrashBatchID.String, res.BatchID)
		}
	}
	restored, err := s.Restore(ctx, Human(ua.ID), other.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(restored.IDs) != 3 {
		t.Fatalf("restore = %+v, want all three back", restored)
	}
	for _, id := range ids {
		if _, err := s.Get(ctx, ua.ID, id); err != nil {
			t.Fatalf("task %s after restore: %v", id, err)
		}
	}
}

func TestTrashTooLargeIsRefused(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	root := trashTestTask(t, s, ua, w, "", "Gốc 6")
	seedTasks(t, s, ua, w, "bigtree", root.ID, taskTrashMaxNodes)

	_, err := s.Trash(ctx, Human(ua.ID), root.ID)
	var coded CodedError
	if !errors.As(err, &coded) || coded.Code != "trash_too_large" || coded.Status != 422 {
		t.Fatalf("trash of %d nodes = %v, want 422 trash_too_large", taskTrashMaxNodes+1, err)
	}
	if _, err := s.Get(ctx, ua.ID, root.ID); err != nil {
		t.Fatalf("refused trash moved the root: %v", err)
	}
}

func TestPurgeTaskDeletesTheRow(t *testing.T) {
	s, fake, pool, ua, ub, w := taskFixtureWithFiles(t)
	spy := &releaseSpy{Service: fake}
	s.SetFiles(spy)
	ctx := context.Background()
	task := trashTestTask(t, s, ua, w, "", "Gốc 7")
	child := trashTestTask(t, s, ua, w, task.ID, "Con")
	sibling := trashTestTask(t, s, ua, w, "", "Gốc 8")
	att, err := s.UploadTaskAttachment(ctx, Human(ua.ID), task.ID, "", "a.txt", "text/plain", 2, strings.NewReader("a\n"))
	if err != nil {
		t.Fatal(err)
	}

	if err := s.Purge(ctx, Human(ua.ID), task.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("purge of a live task = %v, want ErrNotFound", err)
	}
	if _, err := s.TrashMany(ctx, Human(ua.ID), w.ID, []string{task.ID, sibling.ID}); err != nil {
		t.Fatal(err)
	}
	if got := spy.releasedIDs(); len(got) != 0 {
		t.Fatalf("trash released files %v; only a purge may", got)
	}
	if err := s.Purge(ctx, Human(ub.ID), task.ID); !errors.Is(err, ErrForbidden) {
		t.Fatalf("non-member purge = %v, want ErrForbidden", err)
	}

	if err := s.Purge(ctx, Human(ua.ID), task.ID); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{task.ID, child.ID} {
		if _, err := s.q.GetTaskByIDIncludingTrashed(ctx, id); !errors.Is(err, pgx.ErrNoRows) {
			t.Fatalf("row %s after purge: %v, want gone", id, err)
		}
	}
	// A batch sibling that is a root of its own stays in the trash.
	if row := rawTask(t, s, sibling.ID); !row.TrashedAt.Valid {
		t.Fatalf("sibling = %+v, want still trashed", row)
	}
	if got := spy.releasedIDs(); len(got) != 1 || string(got[0]) != att.FileID.String {
		t.Fatalf("released = %v, want the attachment file %s", got, att.FileID.String)
	}
	if n := auditRows(t, s, "task.deleted", task.ID, child.ID); n != 2 {
		t.Fatalf("task.deleted audit rows = %d, want 2", n)
	}
	if n := len(topicsLike(t, pool, w.OrganizationID, "task.deleted")); n != 2 {
		t.Fatalf("task.deleted events = %d, want 2", n)
	}
	if err := s.Purge(ctx, Human(ua.ID), task.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second purge = %v, want ErrNotFound", err)
	}
}

func TestTrashListShowsBatchRootsWithSize(t *testing.T) {
	s, _, ua, ub, w := taskFixture(t)
	ctx := context.Background()
	parent := trashTestTask(t, s, ua, w, "", "Gốc 9")
	trashTestTask(t, s, ua, w, parent.ID, "Con 1")
	trashTestTask(t, s, ua, w, parent.ID, "Con 2")
	if _, err := s.Trash(ctx, Human(ua.ID), parent.ID); err != nil {
		t.Fatal(err)
	}
	// 51 roots in one batch share one trashed_at: the page boundary falls
	// inside a tie, which only the id half of the cursor can resolve.
	roots := seedTasks(t, s, ua, w, "trashroot", "", trashPageSize+1)
	if _, err := s.TrashMany(ctx, Human(ua.ID), w.ID, roots); err != nil {
		t.Fatal(err)
	}

	first, err := s.ListTrash(ctx, ua.ID, w.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Items) != trashPageSize || first.NextCursor == "" {
		t.Fatalf("first page = %d items, cursor %q", len(first.Items), first.NextCursor)
	}
	second, err := s.ListTrash(ctx, ua.ID, w.ID, first.NextCursor)
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Items) != 2 || second.NextCursor != "" {
		t.Fatalf("second page = %+v", second)
	}
	seen := map[string]TaskTrashRow{}
	for _, it := range append(first.Items, second.Items...) {
		if _, dup := seen[it.ID]; dup {
			t.Fatalf("%s listed twice", it.ID)
		}
		seen[it.ID] = it
	}
	got, ok := seen[parent.ID]
	if !ok || got.BatchSize != 3 || got.Title != parent.Title || got.TrashedBy != ua.ID ||
		got.Identifier != fmt.Sprintf("%s-%d", w.TaskPrefix, parent.Number) || got.PurgeAfter.Before(got.TrashedAt) {
		t.Fatalf("parent row = %+v", got)
	}
	want := append([]string{parent.ID}, roots...)
	sort.Strings(want)
	var have []string
	for id, it := range seen {
		if id != parent.ID && it.BatchSize != 1 {
			t.Fatalf("root %s batch size %d, want 1", id, it.BatchSize)
		}
		have = append(have, id)
	}
	sort.Strings(have)
	if strings.Join(have, ",") != strings.Join(want, ",") {
		t.Fatalf("listed %v, want only the batch roots %v", have, want)
	}

	if _, err := s.ListTrash(ctx, ub.ID, w.ID, ""); !errors.Is(err, ErrForbidden) {
		t.Fatalf("non-member list = %v, want ErrForbidden", err)
	}
	if _, err := s.ListTrash(ctx, ua.ID, w.ID, "not-a-cursor"); err == nil {
		t.Fatal("a forged cursor was accepted")
	}
}

func TestTrashedTaskRefusesWrites(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	task := trashTestTask(t, s, ua, w, "", "Gốc 10")
	if _, err := s.Trash(ctx, Human(ua.ID), task.ID); err != nil {
		t.Fatal(err)
	}
	title := "đổi tên"
	if _, err := s.Update(ctx, Human(ua.ID), task.ID, UpdateTaskInput{Title: &title}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("Update of a trashed task = %v, want ErrNotFound", err)
	}
	if _, err := s.Trash(ctx, Human(ua.ID), task.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("second Trash = %v, want ErrNotFound", err)
	}
}
