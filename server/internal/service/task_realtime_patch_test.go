package service

import (
	"context"
	"encoding/json"
	"maps"
	"sort"
	"strconv"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// taskUpdatedFrames reads every task.updated payload written for one task
// straight from outbox_events. It never processes the outbox, so it neither
// races the global drain nor depends on another test's rows. Decoding into
// map[string]string is the realtime consumer's own decode: a non-string value
// fails here exactly as it would fail delivery.
func taskUpdatedFrames(t *testing.T, pool *pgxpool.Pool, taskID string) []map[string]string {
	t.Helper()
	rows, err := pool.Query(context.Background(),
		`SELECT payload FROM outbox_events
		 WHERE topic = 'task.updated' AND payload::jsonb->>'task_id' = $1
		 ORDER BY created_at, id`, taskID)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		t.Fatal(err)
	}
	frames := make([]map[string]string, 0, len(raw))
	for _, r := range raw {
		frame := map[string]string{}
		if err := json.Unmarshal([]byte(r), &frame); err != nil {
			t.Fatalf("payload %s does not decode into map[string]string: %v", r, err)
		}
		frames = append(frames, frame)
	}
	return frames
}

type revisionRange struct {
	before, after int64
	frame         map[string]string
}

// revisionRanges parses the revision pair of every frame and orders them by
// revision, which is the order a client that keeps up would apply them in.
func revisionRanges(t *testing.T, frames []map[string]string) []revisionRange {
	t.Helper()
	out := make([]revisionRange, 0, len(frames))
	for _, f := range frames {
		before, err := strconv.ParseInt(f["revision_before"], 10, 64)
		if err != nil {
			t.Fatalf("revision_before in %v: %v", f, err)
		}
		after, err := strconv.ParseInt(f["revision"], 10, 64)
		if err != nil {
			t.Fatalf("revision in %v: %v", f, err)
		}
		if after <= before {
			t.Fatalf("frame %v: revision must exceed revision_before", f)
		}
		out = append(out, revisionRange{before: before, after: after, frame: f})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].after < out[j].after })
	return out
}

// requireChained fails unless the ranges tile [first, last] back to back: no
// two overlap and no revision between them is unaccounted for.
func requireChained(t *testing.T, ranges []revisionRange, first, last int64) {
	t.Helper()
	at := first
	for i, r := range ranges {
		if r.before != at {
			t.Fatalf("frame %d covers [%d, %d], want it to start at %d; all: %v", i, r.before, r.after, at, ranges)
		}
		at = r.after
	}
	if at != last {
		t.Fatalf("frames end at revision %d, task is at %d; all: %v", at, last, ranges)
	}
}

func TestRealtimePatchCarriesOnlyAWholeChange(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	str := func(v string) *string { return &v }
	nullable := func(v *string) **string { return &v }
	pos := 4096.0
	assignee := ua.ID

	cases := []struct {
		name     string
		create   CreateTaskInput
		update   UpdateTaskInput
		bumps    int64
		patchKey map[string]string // nil: the frame must carry ids and revisions only
	}{
		{
			name:     "title alone",
			update:   UpdateTaskInput{Title: str("Tiêu đề mới")},
			bumps:    1,
			patchKey: map[string]string{"title": "Tiêu đề mới"},
		},
		{
			name:     "status and due date together",
			update:   UpdateTaskInput{Status: str("in_progress"), DueDate: nullable(str("2026-10-01"))},
			bumps:    2,
			patchKey: map[string]string{"status": "in_progress", "due_date": "2026-10-01"},
		},
		{
			name:     "priority alone",
			update:   UpdateTaskInput{Priority: str("urgent")},
			bumps:    1,
			patchKey: map[string]string{"priority": "urgent"},
		},
		{
			name:     "clearing the due date sends an empty string",
			create:   CreateTaskInput{DueDate: str("2026-09-20")},
			update:   UpdateTaskInput{DueDate: nullable(nil)},
			bumps:    2,
			patchKey: map[string]string{"due_date": ""},
		},
		{
			name:   "title beside description",
			update: UpdateTaskInput{Title: str("Đổi cả mô tả"), Description: str("mô tả mới")},
			bumps:  1,
		},
		{
			name:   "position",
			update: UpdateTaskInput{Position: &pos},
			bumps:  1,
		},
		{
			name:   "status beside assignee",
			update: UpdateTaskInput{Status: str("done"), AssigneeID: nullable(&assignee)},
			bumps:  2,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			in := tc.create
			in.Title = "Việc " + tc.name
			task, err := s.Create(ctx, Human(ua.ID), w.ID, in)
			if err != nil {
				t.Fatal(err)
			}
			up, err := s.Update(ctx, Human(ua.ID), task.ID, tc.update)
			if err != nil {
				t.Fatal(err)
			}
			frames := taskUpdatedFrames(t, s.pool, task.ID)
			if len(frames) != 1 {
				t.Fatalf("want one task.updated frame, got %v", frames)
			}
			want := map[string]string{
				"task_id":         task.ID,
				"workspace_id":    w.ID,
				"revision_before": strconv.FormatInt(task.Revision, 10),
				"revision":        strconv.FormatInt(up.Revision, 10),
			}
			maps.Copy(want, tc.patchKey)
			if !maps.Equal(frames[0], want) {
				t.Fatalf("frame:\n got %v\nwant %v", frames[0], want)
			}
			if up.Revision-task.Revision != tc.bumps {
				t.Fatalf("revision moved %d, want %d revision-bumping queries", up.Revision-task.Revision, tc.bumps)
			}
		})
	}
}

// waitForRowLockWaiters polls, on the barrier's own connection so it never
// competes for the pool, until n backends wait on a row lock of an
// UPDATE tasks statement. testutil.DB serialises every database test behind
// an advisory lock, so the only such waiters are this test's. On failure it
// releases the barrier first: a held row lock would leave the updates, and
// with them pool.Close in the test's cleanup, waiting forever.
func waitForRowLockWaiters(t *testing.T, barrier pgx.Tx, n int, done <-chan error) {
	t.Helper()
	ctx := context.Background()
	fail := func(format string, args ...any) {
		t.Helper()
		_ = barrier.Rollback(ctx)
		t.Fatalf(format, args...)
	}
	deadline := time.Now().Add(15 * time.Second)
	for {
		// pg_stat_activity is snapshotted once per transaction; the barrier
		// is one, so drop the snapshot before every look.
		if _, err := barrier.Exec(ctx, `SELECT pg_stat_clear_snapshot()`); err != nil {
			fail("clear stats snapshot: %v", err)
		}
		var waiting int
		if err := barrier.QueryRow(ctx,
			`SELECT count(*) FROM pg_stat_activity
			 WHERE datname = current_database()
			   AND wait_event_type = 'Lock' AND wait_event IN ('transactionid', 'tuple')
			   AND position('UPDATE tasks' in query) > 0`).Scan(&waiting); err != nil {
			fail("count row-lock waiters: %v", err)
		}
		if waiting >= n {
			return
		}
		select {
		case err := <-done:
			fail("an update finished before the barrier was released: %v", err)
		default:
		}
		if time.Now().After(deadline) {
			fail("%d of %d updates reached the row lock", waiting, n)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// Two updates read the task (and its revision) before either takes the row
// lock, then commit one after the other. Each frame must describe only its
// own commit; a revision_before taken from that early read would make the
// second frame claim the first one's change as well.
func TestRealtimePatchConcurrentUpdatesDoNotOverlap(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	task, err := s.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "Đồng thời", Priority: "low"})
	if err != nil {
		t.Fatal(err)
	}
	priorities := []string{"medium", "high", "urgent", "low"}

	const rounds = 10
	for round := range rounds {
		barrier, err := s.pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := barrier.Exec(ctx, `SELECT id FROM tasks WHERE id = $1 FOR UPDATE`, task.ID); err != nil {
			t.Fatal(err)
		}
		title := "Đồng thời " + strconv.Itoa(round)
		priority := priorities[round%len(priorities)]
		done := make(chan error, 2)
		go func() {
			_, err := s.Update(ctx, Human(ua.ID), task.ID, UpdateTaskInput{Title: &title})
			done <- err
		}()
		go func() {
			_, err := s.Update(ctx, Human(ua.ID), task.ID, UpdateTaskInput{Priority: &priority})
			done <- err
		}()
		waitForRowLockWaiters(t, barrier, 2, done)
		if err := barrier.Rollback(ctx); err != nil {
			t.Fatal(err)
		}
		for range 2 {
			if err := <-done; err != nil {
				t.Fatal(err)
			}
		}
	}

	final, err := s.Get(ctx, ua.ID, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	frames := taskUpdatedFrames(t, s.pool, task.ID)
	if len(frames) != 2*rounds {
		t.Fatalf("want %d frames, got %d", 2*rounds, len(frames))
	}
	requireChained(t, revisionRanges(t, frames), task.Revision, final.Revision)
}

// A batch may name one task twice; each call must bound only its own queries,
// so a client that applies the frames in order lands on the server's row.
func TestRealtimePatchBatchRepeatingATaskChainsRanges(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	task, err := s.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "Lô trùng id"})
	if err != nil {
		t.Fatal(err)
	}
	status, due := "in_progress", "2026-10-02"
	dueRef := &due
	n, err := s.BatchUpdateTasks(ctx, Human(ua.ID), w.ID, BatchUpdateTasksInput{
		TaskIDs: []string{task.ID, task.ID},
		Patch:   UpdateTaskInput{Status: &status, DueDate: &dueRef},
	})
	if err != nil || n != 2 {
		t.Fatalf("batch: n=%d err=%v", n, err)
	}
	final, err := s.Get(ctx, ua.ID, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	frames := taskUpdatedFrames(t, s.pool, task.ID)
	if len(frames) != 2 {
		t.Fatalf("want two frames for the repeated id, got %v", frames)
	}
	ranges := revisionRanges(t, frames)
	if ranges[1].before != ranges[0].after {
		t.Fatalf("second frame starts at %d, first ends at %d", ranges[1].before, ranges[0].after)
	}
	requireChained(t, ranges, task.Revision, final.Revision)

	// Replay the frames the way a client that already holds the task would.
	cache := map[string]string{
		"revision": strconv.FormatInt(task.Revision, 10),
		"title":    task.Title, "status": task.Status, "priority": task.Priority, "due_date": "",
	}
	for _, r := range ranges {
		if cache["revision"] != r.frame["revision_before"] {
			t.Fatalf("cache at %s cannot take frame %v", cache["revision"], r.frame)
		}
		for _, key := range []string{"title", "status", "priority", "due_date"} {
			if v, ok := r.frame[key]; ok {
				cache[key] = v
			}
		}
		cache["revision"] = r.frame["revision"]
	}
	want := map[string]string{
		"revision": strconv.FormatInt(final.Revision, 10),
		"title":    final.Title, "status": final.Status, "priority": final.Priority,
		"due_date": final.DueDate.Time.Format("2006-01-02"),
	}
	if !maps.Equal(cache, want) {
		t.Fatalf("replayed cache:\n got %v\nwant %v", cache, want)
	}
}

// The service can compare against nothing but the task it read before taking
// the lock. Another writer committing in between can make a field this call
// wrote look unchanged, so a field in the input counts as changed.
func TestRealtimePatchStaleReadCannotHideAChange(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	original := "mô tả gốc"
	task, err := s.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "Đọc cũ", Description: original})
	if err != nil {
		t.Fatal(err)
	}
	// Another writer holds the row with a different description.
	other, err := s.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = other.Rollback(ctx) }()
	if _, err := other.Exec(ctx,
		`UPDATE tasks SET description = 'mô tả của người khác', revision = revision + 1 WHERE id = $1`, task.ID); err != nil {
		t.Fatal(err)
	}
	title := "Tiêu đề và mô tả gốc"
	done := make(chan error, 1)
	go func() {
		_, err := s.Update(ctx, Human(ua.ID), task.ID, UpdateTaskInput{Title: &title, Description: &original})
		done <- err
	}()
	waitForRowLockWaiters(t, other, 1, done)
	if err := other.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}

	frames := taskUpdatedFrames(t, s.pool, task.ID)
	if len(frames) != 1 {
		t.Fatalf("want one frame, got %v", frames)
	}
	want := map[string]string{
		"task_id": task.ID, "workspace_id": w.ID,
		"revision_before": strconv.FormatInt(task.Revision+1, 10),
		"revision":        strconv.FormatInt(task.Revision+2, 10),
	}
	if !maps.Equal(frames[0], want) {
		t.Fatalf("description went back to %q inside this call, so the frame must not patch:\n got %v\nwant %v",
			original, frames[0], want)
	}
}

func TestRealtimePatchOtherEmittersStayIDsOnly(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	actor := Human(ua.ID)
	label, err := s.CreateTaskLabel(ctx, actor, w.ID, CreateTaskLabelInput{Name: "Bug", Color: "#ef4444"})
	if err != nil {
		t.Fatal(err)
	}
	task, err := s.Create(ctx, actor, w.ID, CreateTaskInput{Title: "Gắn nhãn"})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.AttachTaskLabel(ctx, actor, task.ID, label.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.DetachTaskLabel(ctx, actor, task.ID, label.ID); err != nil {
		t.Fatal(err)
	}
	frames := taskUpdatedFrames(t, s.pool, task.ID)
	if len(frames) != 2 {
		t.Fatalf("want attach and detach frames, got %v", frames)
	}
	want := map[string]string{"task_id": task.ID, "workspace_id": w.ID}
	for _, f := range frames {
		if !maps.Equal(f, want) {
			t.Fatalf("label frame must stay ids-only: got %v", f)
		}
	}
}
