package migrations

// UNI-1999 (meeting follow-through §5.1): before meeting_summary_task_links
// is dropped, every live link whose task no action item carries is copied
// again — onto the pending AI row of its item when there is one, else as a
// new row — and a second run changes nothing.

import (
	"context"
	"fmt"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func TestMeetingActionItemsCatchUp(t *testing.T) {
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
	matches, err := filepath.Glob("*_meeting_action_items_catch_up.up.sql")
	if err != nil || len(matches) != 1 {
		t.Fatalf("want one catch-up migration, found %v (%v)", matches, err)
	}
	catchUp := readMigration(t, matches[0])

	const (
		org      = "01ORGCATCHUPAI000000000001"
		ws       = "01WSPCATCHUPAI000000000001"
		user     = "01USRCATCHUPAI000000000001"
		meeting  = "01MTGCATCHUPAI000000000001"
		older    = "01SUMCATCHUPAI000000000001"
		latest   = "01SUMCATCHUPAI000000000002"
		rowA     = "01ACTCATCHUPAI000000000001" // pending, gets the task of its link
		rowB     = "01ACTCATCHUPAI000000000002" // dismissed, left alone
		rowC     = "01ACTCATCHUPAI000000000003" // converted already
		rowE     = "01ACTCATCHUPAI000000000005" // two same-title rows: the first takes the oldest link
		rowF     = "01ACTCATCHUPAI000000000006"
		rowG     = "01ACTCATCHUPAI000000000007" // its item's title ends in a newline
		taskA    = "01TSKCATCHUPAI000000000001"
		taskB    = "01TSKCATCHUPAI000000000002"
		taskC    = "01TSKCATCHUPAI000000000003"
		taskD    = "01TSKCATCHUPAI000000000004"
		taskOld  = "01TSKCATCHUPAI000000000005"
		taskE1   = "01TSKCATCHUPAI000000000006"
		taskE2   = "01TSKCATCHUPAI000000000007"
		taskG    = "01TSKCATCHUPAI000000000008"
		goneTask = "01TSKCATCHUPAI000000000099"
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
	exec(`SET LOCAL session_replication_role = replica`)
	exec(readMigration(t, "9991792144600001_meeting_summary_task_links.up.sql"))
	exec(`INSERT INTO meetings (id, organization_id, workspace_id, title, starts_at, ends_at, room_name, created_by, host_user_id)
		VALUES ($1, $2, $3, 'Giao ban', now(), now() + interval '1 hour', $1, $4, $4)`, meeting, org, ws, user)
	exec(`INSERT INTO meeting_summaries (id, organization_id, meeting_id, summary, action_items, created_by, created_at)
		VALUES ($1, $2, $3, 'cũ', '[{"title":"Cũ đã giao"},{"title":"Cũ task đã xoá"}]', $4, now() - interval '2 hours')`,
		older, org, meeting, user)
	// Stored by the new server: the blank item made no row, so the rows are
	// numbered 0, 1, 2 while the items sit at 0, 2, 3.
	exec(`INSERT INTO meeting_summaries (id, organization_id, meeting_id, summary, action_items, created_by, created_at)
		VALUES ($1, $2, $3, 'mới', '[{"title":"Gửi báo cáo"},{"title":" "},{"title":"Đặt phòng"},{"title":"In tài liệu"},{"title":"Gọi khách","owner":"An","due":"mai"},{"title":"Họp lại"},{"title":"Họp lại"},{"title":"Chốt lịch\n"}]', $4, now() - interval '1 hour')`,
		latest, org, meeting, user)
	item := func(id string, position int, title, task string, dismissed bool) {
		exec(`INSERT INTO meeting_action_items (id, organization_id, workspace_id, meeting_id, source, summary_id, position, title,
			task_id, dismissed_at, created_by, created_by_kind)
			VALUES ($1, $2, $3, $4, 'AI', $5, $6, $7, NULLIF($8, ''), CASE WHEN $9::boolean THEN now() END, 'meeting_summary', 'system')`,
			id, org, ws, meeting, latest, position, title, task, dismissed)
	}
	item(rowA, 0, "Gửi báo cáo", "", false)
	item(rowB, 1, "Đặt phòng", "", true)
	item(rowC, 2, "In tài liệu", taskC, false)
	// Rows a backfill made from a summary with a repeated title (the new
	// server would have dropped the second).
	item(rowE, 3, "Họp lại", "", false)
	item(rowF, 4, "Họp lại", "", false)
	item(rowG, 5, "Chốt lịch", "", false)
	for i, task := range []string{taskA, taskB, taskC, taskD, taskOld, taskE1, taskE2, taskG} {
		exec(`INSERT INTO tasks (id, organization_id, workspace_id, number, title, created_by, creator_id, creator_type, last_activity_at)
			VALUES ($1, $2, $3, $4, 'task', $5, $5, 'member', now())`, task, org, ws, 910000+i, user)
	}
	linkAt := func(id, summary string, index int, task, ago string) {
		exec(`INSERT INTO meeting_summary_task_links (id, organization_id, workspace_id, meeting_id, summary_id, item_index, task_id, created_by, created_by_kind, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'human', now() - $9::interval)`, id, org, ws, meeting, summary, index, task, user, ago)
	}
	link := func(id, summary string, index int, task string) { linkAt(id, summary, index, task, "0 minutes") }
	link("01LNKCATCHUPAI000000000001", latest, 0, taskA)   // onto pending row A
	link("01LNKCATCHUPAI000000000002", latest, 2, taskB)   // row B is dismissed: a row of its own
	link("01LNKCATCHUPAI000000000003", latest, 3, taskC)   // already carried by row C
	link("01LNKCATCHUPAI000000000004", latest, 4, taskD)   // no row: a new one
	link("01LNKCATCHUPAI000000000005", older, 0, taskOld)  // older summary, no row: a new one
	link("01LNKCATCHUPAI000000000006", older, 1, goneTask) // task deleted: nothing
	// Both "Họp lại" links find row E first; the older link (the larger id,
	// so the order is by time, not id) takes it, the other gets a row.
	linkAt("01LNKCATCHUPAI000000000007", latest, 5, taskE1, "1 minute")
	linkAt("01LNKCATCHUPAI000000000008", latest, 6, taskE2, "2 minutes")
	link("01LNKCATCHUPAI000000000009", latest, 7, taskG) // "Chốt lịch\n" finds row G

	type row struct {
		id, title, owner, due, task string
		position                    int
		dismissed, stamped          bool
	}
	read := func() map[string]row {
		t.Helper()
		rows, err := tx.Query(ctx, `SELECT id, title, owner_text, due_text, COALESCE(task_id, ''), position,
			dismissed_at IS NOT NULL, converted_at IS NOT NULL AND converted_by = $2
			FROM meeting_action_items WHERE meeting_id = $1`, meeting, user)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		out := map[string]row{}
		for rows.Next() {
			var r row
			if err := rows.Scan(&r.id, &r.title, &r.owner, &r.due, &r.task, &r.position, &r.dismissed, &r.stamped); err != nil {
				t.Fatal(err)
			}
			out[r.title+"|"+r.task] = r
		}
		if err := rows.Err(); err != nil {
			t.Fatal(err)
		}
		return out
	}

	exec(catchUp)
	first := read()
	want := map[string]row{
		"Gửi báo cáo|" + taskA:  {id: rowA, title: "Gửi báo cáo", task: taskA, position: 0, stamped: true},
		"Đặt phòng|":            {id: rowB, title: "Đặt phòng", position: 1, dismissed: true},
		"Đặt phòng|" + taskB:    {title: "Đặt phòng", task: taskB, position: 2, stamped: true},
		"In tài liệu|" + taskC:  {id: rowC, title: "In tài liệu", task: taskC, position: 2},
		"Gọi khách|" + taskD:    {title: "Gọi khách", owner: "An", due: "mai", task: taskD, position: 4, stamped: true},
		"Cũ đã giao|" + taskOld: {title: "Cũ đã giao", task: taskOld, position: 0, stamped: true},
		"Họp lại|" + taskE2:     {id: rowE, title: "Họp lại", task: taskE2, position: 3, stamped: true},
		"Họp lại|":              {id: rowF, title: "Họp lại", position: 4},
		"Họp lại|" + taskE1:     {title: "Họp lại", task: taskE1, position: 5, stamped: true},
		"Chốt lịch|" + taskG:    {id: rowG, title: "Chốt lịch", task: taskG, position: 5, stamped: true},
	}
	if len(first) != len(want) {
		t.Fatalf("rows after catch-up = %+v, want %d rows", first, len(want))
	}
	for key, w := range want {
		got, ok := first[key]
		if !ok {
			t.Fatalf("missing row %q in %+v", key, first)
		}
		if w.id == "" {
			w.id = got.id
		}
		if got != w {
			t.Fatalf("row %q = %+v, want %+v", key, got, w)
		}
	}

	exec(catchUp)
	second := read()
	if len(second) != len(first) {
		t.Fatalf("second run changed the rows: %+v", second)
	}
	for key, r := range first {
		if second[key] != r {
			t.Fatalf("second run changed %q: %+v → %+v", key, r, second[key])
		}
	}
}

// Review R1 S1: a summary an old server stored while UNI-1998 rolled out has
// no rows. When it is the meeting's latest, the catch-up gives it its AI
// rows as the backfill would, carrying the task of a live link, and skips
// a title the meeting already has, as storing a summary does.
func TestMeetingActionItemsCatchUpRowsTheLatestBareSummary(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	lockTestDB(t, pool)
	if err := Up(ctx, pool); err != nil {
		t.Fatal(err)
	}
	matches, err := filepath.Glob("*_meeting_action_items_catch_up.up.sql")
	if err != nil || len(matches) != 1 {
		t.Fatalf("want one catch-up migration, found %v (%v)", matches, err)
	}
	catchUp := readMigration(t, matches[0])
	const (
		org      = "01ORGCATCHUPBARE0000000001"
		ws       = "01WSPCATCHUPBARE0000000001"
		user     = "01USRCATCHUPBARE0000000001"
		meeting  = "01MTGCATCHUPBARE0000000001"
		rowed    = "01MTGCATCHUPBARE0000000002" // its latest summary has rows
		older    = "01SUMCATCHUPBARE0000000001"
		bare     = "01SUMCATCHUPBARE0000000002"
		kept     = "01SUMCATCHUPBARE0000000003"
		keptRow  = "01ACTCATCHUPBARE0000000003"
		manual   = "01ACTCATCHUPBARE0000000001"
		task     = "01TSKCATCHUPBARE0000000001"
		linkedID = "01LNKCATCHUPBARE0000000001"
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
	exec(`SET LOCAL session_replication_role = replica`)
	exec(readMigration(t, "9991792144600001_meeting_summary_task_links.up.sql"))
	for _, m := range []string{meeting, rowed} {
		exec(`INSERT INTO meetings (id, organization_id, workspace_id, title, starts_at, ends_at, room_name, created_by, host_user_id)
			VALUES ($1, $2, $3, 'Giao ban', now(), now() + interval '1 hour', $1, $4, $4)`, m, org, ws, user)
	}
	summary := func(id, m, items, ago string) {
		exec(`INSERT INTO meeting_summaries (id, organization_id, meeting_id, summary, action_items, created_by, created_at)
			VALUES ($1, $2, $3, 's', $4, $5, now() - $6::interval)`, id, org, m, items, user, ago)
	}
	summary(older, meeting, `[{"title":"Cũ"}]`, "2 hours")
	summary(bare, meeting, `[{"title":"Gửi báo cáo","owner":"An"},{"title":"đặt  PHÒNG"},{"title":"gửi báo  cáo\n"},{"title":" "},{"title":"In tài liệu"}]`, "1 hour")
	summary(kept, rowed, `[{"title":"Không đổi"},{"title":"Bị bỏ"}]`, "1 hour")
	exec(`INSERT INTO meeting_action_items (id, organization_id, workspace_id, meeting_id, source, position, title, dismissed_at, created_by, created_by_kind)
		VALUES ($1, $2, $3, $4, 'MANUAL', 0, 'Đặt phòng', now(), $5, 'human')`, manual, org, ws, meeting, user)
	exec(`INSERT INTO meeting_action_items (id, organization_id, workspace_id, meeting_id, source, summary_id, position, title, created_by, created_by_kind)
		VALUES ($1, $2, $3, $4, 'AI', $5, 0, 'Không đổi', 'meeting_summary', 'system')`, keptRow, org, ws, rowed, kept)
	exec(`INSERT INTO tasks (id, organization_id, workspace_id, number, title, created_by, creator_id, creator_type, last_activity_at)
		VALUES ($1, $2, $3, 920000, 'task', $4, $4, 'member', now())`, task, org, ws, user)
	exec(`INSERT INTO meeting_summary_task_links (id, organization_id, workspace_id, meeting_id, summary_id, item_index, task_id, created_by, created_by_kind)
		VALUES ($1, $2, $3, $4, $5, 4, $6, $7, 'human')`, linkedID, org, ws, meeting, bare, task, user)

	read := func() []string {
		t.Helper()
		rows, err := tx.Query(ctx, `SELECT m.id = $1, i.source, COALESCE(i.summary_id, ''), i.position, i.title, i.owner_text, COALESCE(i.task_id, '')
			FROM meeting_action_items i JOIN meetings m ON m.id = i.meeting_id
			WHERE i.meeting_id IN ($1, $2) ORDER BY i.meeting_id, i.source, i.position`, meeting, rowed)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		var out []string
		for rows.Next() {
			var first bool
			var source, sum, title, owner, tk string
			var pos int
			if err := rows.Scan(&first, &source, &sum, &pos, &title, &owner, &tk); err != nil {
				t.Fatal(err)
			}
			out = append(out, fmt.Sprintf("%v|%s|%s|%d|%s|%s|%s", first, source, sum, pos, title, owner, tk))
		}
		if err := rows.Err(); err != nil {
			t.Fatal(err)
		}
		return out
	}
	exec(catchUp)
	want := []string{
		"true|AI|" + bare + "|0|Gửi báo cáo|An|",
		"true|AI|" + bare + "|4|In tài liệu||" + task,
		"true|MANUAL||0|Đặt phòng||",
		"false|AI|" + kept + "|0|Không đổi||",
	}
	if got := read(); !slices.Equal(got, want) {
		t.Fatalf("rows after catch-up:\n%s\nwant:\n%s", strings.Join(got, "\n"), strings.Join(want, "\n"))
	}
	exec(catchUp)
	if got := read(); !slices.Equal(got, want) {
		t.Fatalf("second run changed the rows:\n%s", strings.Join(got, "\n"))
	}
}
