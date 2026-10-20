package migrations

// UNI-1998 (meeting follow-through §5.1) data migration: every item of a
// meeting's latest summary becomes an action item carrying the task of its
// oldest live link, and every live link of an older summary becomes one too.
// The file runs inside a transaction that first drops the table, so its
// CREATE and its INSERT both run over rows this test seeds; the rollback
// restores the table as it was.

import (
	"context"
	"path/filepath"
	"testing"
)

func TestMeetingActionItemsBackfill(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	lock, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := WaitAdvisoryLock(ctx, lock, 727273); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = lock.Exec(ctx, "SELECT pg_advisory_unlock($1)", 727273); lock.Release() })
	if err := Up(ctx, pool); err != nil {
		t.Fatal(err)
	}
	matches, err := filepath.Glob("*_meeting_action_items.up.sql")
	if err != nil || len(matches) != 1 {
		t.Fatalf("want one meeting_action_items migration, found %v (%v)", matches, err)
	}
	backfill := readMigration(t, matches[0])

	const (
		org     = "01ORGBACKFILLAI00000000001"
		ws      = "01WSPBACKFILLAI00000000001"
		user    = "01USRBACKFILLAI00000000001"
		meeting = "01MTGBACKFILLAI00000000001"
		broken  = "01MTGBACKFILLAI00000000002"
		invalid = "01MTGBACKFILLAI00000000003"
		older   = "01SUMBACKFILLAI00000000001"
		latest  = "01SUMBACKFILLAI00000000002"
		junk    = "01SUMBACKFILLAI00000000003"
		notJSON = "01SUMBACKFILLAI00000000004"
		taskOld = "01TSKBACKFILLAI00000000001" // older summary, item 0
		taskA   = "01TSKBACKFILLAI00000000002" // latest, item 0
		taskB   = "01TSKBACKFILLAI00000000003" // latest, item 1, second conversion
		goneOld = "01TSKBACKFILLAI00000000098" // older summary, item 1, deleted
		goneB   = "01TSKBACKFILLAI00000000099" // latest, item 1, first conversion, deleted
	)

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := tx.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	// The meetings and tasks of migrations before 005 still carry foreign
	// keys to organizations, workspaces and users; this exercise is about
	// summaries and links only, so their triggers are off for the transaction.
	exec(`SET LOCAL session_replication_role = replica`)
	// UNI-1999 dropped the link table this backfill reads; bring it back,
	// empty, inside the transaction.
	exec(readMigration(t, "9991792144600001_meeting_summary_task_links.up.sql"))
	for _, m := range []string{meeting, broken, invalid} {
		exec(`INSERT INTO meetings (id, organization_id, workspace_id, title, starts_at, ends_at, room_name, created_by, host_user_id)
			VALUES ($1, $2, $3, 'Giao ban', now(), now() + interval '1 hour', $1, $4, $4)`, m, org, ws, user)
	}
	exec(`INSERT INTO meeting_summaries (id, organization_id, meeting_id, summary, action_items, created_by, created_at)
		VALUES ($1, $2, $3, 'cũ', $4, $5, now() - interval '2 hours')`, older, org, meeting,
		`[{"title":"Cũ đã giao","owner":"An","due":"mai"},{"title":"Cũ task đã xoá"},{"title":"Cũ đang chờ"}]`, user)
	exec(`INSERT INTO meeting_summaries (id, organization_id, meeting_id, summary, action_items, created_by, created_at)
		VALUES ($1, $2, $3, 'mới', $4, $5, now() - interval '1 hour')`, latest, org, meeting,
		`[{"title":"Gửi báo cáo","owner":"Bình","due":"thứ sáu"},{"title":"Đặt phòng"},{"title":"Chờ"},{"title":"  "}]`, user)
	exec(`INSERT INTO meeting_summaries (id, organization_id, meeting_id, summary, action_items, created_by)
		VALUES ($1, $2, $3, 'hỏng', '{"not":"an array"}', $4)`, junk, org, broken, user)
	// Not JSON at all: the migration must skip it, not abort.
	exec(`INSERT INTO meeting_summaries (id, organization_id, meeting_id, summary, action_items, created_by)
		VALUES ($1, $2, $3, 'hỏng hẳn', '[{"title": "cắt ngang', $4)`, notJSON, org, invalid, user)
	for i, task := range []string{taskOld, taskA, taskB} {
		exec(`INSERT INTO tasks (id, organization_id, workspace_id, number, title, created_by, creator_id, creator_type, last_activity_at)
			VALUES ($1, $2, $3, $4, 'task', $5, $5, 'member', now())`, task, org, ws, 900000+i, user)
	}
	link := func(id, summary string, index int, task, ago string) {
		exec(`INSERT INTO meeting_summary_task_links (id, organization_id, workspace_id, meeting_id, summary_id, item_index, task_id, created_by, created_by_kind, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'human', now() - $9::interval)`, id, org, ws, meeting, summary, index, task, user, ago)
	}
	link("01LNKBACKFILLAI00000000001", older, 0, taskOld, "100 minutes")
	link("01LNKBACKFILLAI00000000002", older, 1, goneOld, "100 minutes")
	link("01LNKBACKFILLAI00000000003", latest, 0, taskA, "50 minutes")
	link("01LNKBACKFILLAI00000000004", latest, 1, goneB, "40 minutes")
	link("01LNKBACKFILLAI00000000005", latest, 1, taskB, "30 minutes")

	exec(`DROP TABLE meeting_action_items`)
	exec(backfill)

	rows, err := tx.Query(ctx, `SELECT summary_id, position, title, owner_text, due_text, COALESCE(task_id, ''),
		converted_by IS NOT NULL AND converted_at IS NOT NULL, source, created_by, created_by_kind, workspace_id
		FROM meeting_action_items WHERE meeting_id IN ($1, $2, $3) ORDER BY summary_id, position`, meeting, broken, invalid)
	if err != nil {
		t.Fatal(err)
	}
	type row struct {
		summary  string
		position int
		title    string
		owner    string
		due      string
		task     string
		stamped  bool
	}
	var got []row
	for rows.Next() {
		var r row
		var source, createdBy, kind, workspace string
		if err := rows.Scan(&r.summary, &r.position, &r.title, &r.owner, &r.due, &r.task, &r.stamped, &source, &createdBy, &kind, &workspace); err != nil {
			t.Fatal(err)
		}
		if source != "AI" || createdBy != "meeting_summary" || kind != "system" || workspace != ws {
			t.Fatalf("row %+v: source %q, created_by %q/%q, workspace %q", r, source, createdBy, kind, workspace)
		}
		got = append(got, r)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	want := []row{
		{summary: older, position: 0, title: "Cũ đã giao", owner: "An", due: "mai", task: taskOld, stamped: true},
		{summary: latest, position: 0, title: "Gửi báo cáo", owner: "Bình", due: "thứ sáu", task: taskA, stamped: true},
		{summary: latest, position: 1, title: "Đặt phòng", task: taskB, stamped: true},
		{summary: latest, position: 2, title: "Chờ"},
	}
	if len(got) != len(want) {
		t.Fatalf("rows = %+v, want %+v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("row %d = %+v, want %+v", i, got[i], want[i])
		}
	}
}
