package migrations

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// --- ADR 0008 against a migrated database -------------------------------------
//
// lint_test.go proves from the files that every business table has
// organization_id; these tests prove what the files cannot: that the column is
// NOT NULL once every migration has run, and that the backfill copies each
// row's tenant from its parent.

// Tables whose organization_id may hold NULL beside the ADR 0023 file tables
// (nullableTenantTables in lint_test.go). Each entry names the rows that need
// the NULL; an entry for a column that is NOT NULL fails the test, so the list
// only shrinks.
var nullableTenantColumns = map[string]string{
	"outbox_events":       "the event bus: Recorder.Emit writes provider.* instructions that carry a workspace but no organization (062 added the column nullable)",
	"file_backfill_items": "files-backfill ledger exempt from ADR 0008: the column records the tenant a source row resolved, NULL for avatar items and rows that never resolved (977)",
}

func TestTenantColumnIsNotNull(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	lockTestDB(t, pool)
	if err := Up(ctx, pool); err != nil {
		t.Fatal(err)
	}
	allowed := map[string]string{}
	for table, reason := range nullableTenantTables {
		allowed[table] = reason
	}
	for table, reason := range nullableTenantColumns {
		allowed[table] = reason
	}

	rows, err := pool.Query(ctx, `
		SELECT c.table_name, c.is_nullable = 'YES'
		FROM information_schema.columns c
		JOIN information_schema.tables t
		  ON t.table_schema = c.table_schema AND t.table_name = c.table_name
		WHERE c.table_schema = 'public' AND c.column_name = 'organization_id'
		  AND t.table_type = 'BASE TABLE'
		ORDER BY c.table_name`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	seen := map[string]bool{}
	for rows.Next() {
		var table string
		var nullable bool
		if err := rows.Scan(&table, &nullable); err != nil {
			t.Fatal(err)
		}
		seen[table] = true
		_, listed := allowed[table]
		switch {
		case nullable && !listed:
			t.Errorf("%s.organization_id accepts NULL (ADR 0008): backfill it from the parent row and SET NOT NULL, or list the table in nullableTenantColumns with the rows that need NULL", table)
		case !nullable && listed:
			t.Errorf("%s.organization_id is NOT NULL but listed as nullable; drop it from the list", table)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	for table := range allowed {
		if !seen[table] {
			t.Errorf("%s is listed as a nullable tenant table but has no organization_id column", table)
		}
	}

	// The file lint reads CREATE TABLE with a regex; the schema is the
	// answer. A table that has no organization_id at all - created in a form
	// the regex misses, or whose column a later migration dropped or renamed -
	// must be exempted by name with a reason, like in the file lint.
	missing, err := pool.Query(ctx, `
		SELECT t.table_name FROM information_schema.tables t
		WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
		  AND NOT EXISTS (
		    SELECT 1 FROM information_schema.columns c
		    WHERE c.table_schema = t.table_schema AND c.table_name = t.table_name
		      AND c.column_name = 'organization_id')
		ORDER BY t.table_name`)
	if err != nil {
		t.Fatal(err)
	}
	defer missing.Close()
	for missing.Next() {
		var table string
		if err := missing.Scan(&table); err != nil {
			t.Fatal(err)
		}
		if _, exempt := tenantExemptTables[table]; exempt || table == "schema_migrations" {
			continue
		}
		t.Errorf("%s has no organization_id column (ADR 0008): add it, or exempt the table by name with a reason in tenantExemptTables", table)
	}
	if err := missing.Err(); err != nil {
		t.Fatal(err)
	}
}

// The backfill migrations, rehearsed: roll them back, write rows the way the
// code did before (no organization_id; a room predating 052 with none either),
// and migrate again. Every row takes its parent's organization. A row whose
// parent is gone fails its migration loudly and leaves nothing of that file
// applied - the runner sends a file as one implicit transaction.
func TestTenantBackfillCopiesTheParentOrganization(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	lockTestDB(t, pool)
	if err := Up(ctx, pool); err != nil {
		t.Fatal(err)
	}
	const backfill = "9991790915600001_tenant_backfill_organization_id"
	rollBackThrough(t, pool, backfill)
	// Whatever Up is left with, later tests need the schema whole.
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM meeting_participants WHERE id = 'tb-orphan'`)
		if err := Up(ctx, pool); err != nil {
			t.Errorf("re-up in cleanup: %v", err)
		}
	})
	if _, err := pool.Exec(ctx, `TRUNCATE users, organizations, organization_members, workspaces, workspace_members CASCADE`); err != nil {
		t.Fatal(err)
	}
	truncateTenantBackfillTables(t, pool)

	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	exec(`INSERT INTO users (id, email, password_hash, display_name) VALUES ('tb-user', 'tb@example.com', 'x', 'TB')`)
	exec(`INSERT INTO organizations (id, slug, name, created_by) VALUES
		('tb-org-a', 'tb-org-a', 'A', 'tb-user'), ('tb-org-b', 'tb-org-b', 'B', 'tb-user')`)
	exec(`INSERT INTO workspaces (id, slug, name, created_by, organization_id) VALUES
		('tb-ws-a', 'a', 'A', 'tb-user', 'tb-org-a'), ('tb-ws-b', 'b', 'B', 'tb-user', 'tb-org-b')`)
	exec(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES
		('tb-ws-a', 'tb-user', 'owner'), ('tb-ws-b', 'tb-user', 'owner')`)
	// tb-room-old has no organization, as rooms written before 052 did.
	exec(`INSERT INTO chat_rooms (id, kind, workspace_id, organization_id, livekit_room_name, created_by) VALUES
		('tb-room-a', 'channel', 'tb-ws-a', 'tb-org-a', 'lk-a', 'tb-user'),
		('tb-room-old', 'channel', 'tb-ws-b', NULL, 'lk-old', 'tb-user')`)
	for _, room := range []string{"tb-room-a", "tb-room-old"} {
		exec(`INSERT INTO chat_room_members (id, room_id, workspace_id, user_id)
			SELECT 'mem-' || r.id, r.id, r.workspace_id, 'tb-user' FROM chat_rooms r WHERE r.id = $1`, room)
		exec(`INSERT INTO chat_messages (id, room_id, workspace_id, sender_id)
			SELECT 'msg-' || r.id, r.id, r.workspace_id, 'tb-user' FROM chat_rooms r WHERE r.id = $1`, room)
	}
	for _, m := range [][2]string{{"tb-meeting-a", "tb-ws-a"}, {"tb-meeting-b", "tb-ws-b"}} {
		exec(`INSERT INTO meetings (id, workspace_id, title, starts_at, ends_at, room_name, created_by, host_user_id)
			VALUES ($1, $2, 'M', now(), now() + interval '1 hour', $1, 'tb-user', 'tb-user')`, m[0], m[1])
		for _, child := range meetingChildFixtures {
			exec(child, m[0])
		}
	}
	// A participant whose meeting is gone: corruption the migration must refuse.
	exec(`INSERT INTO meeting_participants (id, meeting_id, principal_type, added_by)
		VALUES ('tb-orphan', 'tb-meeting-gone', 'USER', 'tb-user')`)

	err := Up(ctx, pool)
	if err == nil || !strings.Contains(err.Error(), backfill) {
		t.Fatalf("up with an orphan meeting child: err = %v, want the %s migration to fail", err, backfill)
	}
	// Nothing of the backfill may stay: not the meeting column next to the
	// orphan, and not the workspace and chat columns earlier in the same file,
	// whose NOT NULL would break the running binary's inserts.
	var leftover []string
	for _, table := range []string{"workspace_members", "chat_messages", "meetings"} {
		var has bool
		if err := pool.QueryRow(ctx, `SELECT EXISTS (
			SELECT 1 FROM information_schema.columns
			WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'organization_id')`, table).Scan(&has); err != nil {
			t.Fatal(err)
		}
		if has {
			leftover = append(leftover, table+".organization_id")
		}
	}
	var recorded bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1)`, backfill).Scan(&recorded); err != nil {
		t.Fatal(err)
	}
	if len(leftover) > 0 || recorded {
		t.Fatalf("a failed backfill must leave nothing applied: left %v, version recorded=%v", leftover, recorded)
	}

	exec(`DELETE FROM meeting_participants WHERE id = 'tb-orphan'`)
	if err := Up(ctx, pool); err != nil {
		t.Fatal("re-up:", err)
	}

	expect := func(sql string, want []string) {
		t.Helper()
		rows, err := pool.Query(ctx, sql)
		if err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		defer rows.Close()
		var got []string
		for rows.Next() {
			var id, org string
			if err := rows.Scan(&id, &org); err != nil {
				t.Fatal(err)
			}
			got = append(got, id+"="+org)
		}
		sort.Strings(got)
		if strings.Join(got, " ") != strings.Join(want, " ") {
			t.Errorf("%s\n got: %v\nwant: %v", sql, got, want)
		}
	}
	expect(`SELECT workspace_id, organization_id FROM workspace_members`,
		[]string{"tb-ws-a=tb-org-a", "tb-ws-b=tb-org-b"})
	expect(`SELECT id, organization_id FROM chat_rooms`,
		[]string{"tb-room-a=tb-org-a", "tb-room-old=tb-org-b"})
	expect(`SELECT room_id, organization_id FROM chat_room_members`,
		[]string{"tb-room-a=tb-org-a", "tb-room-old=tb-org-b"})
	expect(`SELECT room_id, organization_id FROM chat_messages`,
		[]string{"tb-room-a=tb-org-a", "tb-room-old=tb-org-b"})
	for _, table := range append([]string{"meetings"}, meetingChildTables...) {
		key := "meeting_id"
		if table == "meetings" {
			key = "id"
		}
		expect(fmt.Sprintf(`SELECT %s, organization_id FROM %s`, key, table),
			[]string{"tb-meeting-a=tb-org-a", "tb-meeting-b=tb-org-b"})
	}
}

// meetingChildTables are the tables the backfill fills from their meeting.
var meetingChildTables = []string{
	"meeting_attendees", "meeting_notes", "meeting_participants", "meeting_invitations",
	"meeting_access_grants", "meeting_invite_links", "meeting_join_requests",
	"meeting_conference_sessions", "meeting_attendance_sessions", "meeting_audit_logs",
	"meeting_chat_messages", "meeting_transcript_segments", "meeting_summaries", "meeting_recordings",
}

// meetingChildFixtures write one row per child table for meeting $1, in the
// shape the code wrote before the backfill (no organization_id).
var meetingChildFixtures = []string{
	`INSERT INTO meeting_attendees (meeting_id, user_id) VALUES ($1::text, 'tb-user')`,
	`INSERT INTO meeting_notes (id, meeting_id, author_id, body) VALUES ('n-' || $1::text, $1::text, 'tb-user', 'x')`,
	`INSERT INTO meeting_participants (id, meeting_id, principal_type, user_id, added_by) VALUES ('p-' || $1::text, $1::text, 'USER', 'tb-user', 'tb-user')`,
	`INSERT INTO meeting_invitations (id, meeting_id, participant_id, invited_by) VALUES ('i-' || $1::text, $1::text, 'p-' || $1::text, 'tb-user')`,
	`INSERT INTO meeting_access_grants (id, meeting_id, participant_id, source_type, granted_by) VALUES ('g-' || $1::text, $1::text, 'p-' || $1::text, 'CREATOR', 'tb-user')`,
	`INSERT INTO meeting_invite_links (id, meeting_id, secret_hash, access_mode, expires_at, created_by) VALUES ('l-' || $1::text, $1::text, 'h-' || $1::text, 'AUTO_ADMIT', now(), 'tb-user')`,
	`INSERT INTO meeting_join_requests (id, meeting_id) VALUES ('j-' || $1::text, $1::text)`,
	`INSERT INTO meeting_conference_sessions (id, meeting_id, provider_key, provider_room_name) VALUES ('c-' || $1::text, $1::text, 'livekit', $1::text)`,
	`INSERT INTO meeting_attendance_sessions (id, meeting_id, conference_session_id, participant_id, provider_participant_identity, joined_at) VALUES ('a-' || $1::text, $1::text, 'c-' || $1::text, 'p-' || $1::text, 'x', now())`,
	`INSERT INTO meeting_audit_logs (id, meeting_id, event_type, actor_type, actor_id) VALUES ('al-' || $1::text, $1::text, 'MEETING_CREATED', 'USER', 'tb-user')`,
	`INSERT INTO meeting_chat_messages (id, meeting_id, sender_identity, message, sent_at) VALUES ('mc-' || $1::text, $1::text, 'x', 'hi', now())`,
	`INSERT INTO meeting_transcript_segments (id, meeting_id, text, spoken_at) VALUES ('ts-' || $1::text, $1::text, 'hi', now())`,
	`INSERT INTO meeting_summaries (id, meeting_id, summary, created_by) VALUES ('s-' || $1::text, $1::text, 'sum', 'tb-user')`,
	`INSERT INTO meeting_recordings (id, meeting_id, started_by) VALUES ('r-' || $1::text, $1::text, 'tb-user')`,
}

// truncateTenantBackfillTables empties the tables the organization_id
// backfills read. A test that rolls the schema back past them and migrates
// again must call it after its own TRUNCATE: rows other tests left behind, or
// children whose parents a TRUNCATE … CASCADE just removed (post-004 tables
// carry no foreign key), would otherwise reach the backfill without a parent
// and fail it, as it should on real data.
func truncateTenantBackfillTables(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	tables := append([]string{"chat_rooms", "chat_room_members", "chat_messages", "meetings"}, meetingChildTables...)
	if _, err := pool.Exec(context.Background(), "TRUNCATE "+strings.Join(tables, ", ")+" CASCADE"); err != nil {
		t.Fatal(err)
	}
}

// rollBackThrough runs Down until version is no longer applied.
func rollBackThrough(t *testing.T, pool *pgxpool.Pool, version string) {
	t.Helper()
	ctx := context.Background()
	for {
		var applied bool
		if err := pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1)`, version).Scan(&applied); err != nil {
			t.Fatal(err)
		}
		if !applied {
			return
		}
		if err := Down(ctx, pool); err != nil {
			t.Fatal(err)
		}
	}
}

// lockTestDB holds the advisory lock testutil.DB takes, for the rest of the
// test: these tests migrate, roll back and truncate the shared test database.
func lockTestDB(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	lock, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := WaitAdvisoryLock(ctx, lock, 727273); err != nil {
		lock.Release()
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = lock.Exec(ctx, "SELECT pg_advisory_unlock($1)", 727273); lock.Release() })
}
