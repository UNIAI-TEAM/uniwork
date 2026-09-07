package migrations

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		url = "postgres://uniwork:uniwork@localhost:5432/uniwork_test?sslmode=disable"
	}
	pool, err := pgxpool.New(context.Background(), url)
	if err != nil {
		t.Skip("no test database:", err)
	}
	if err := pool.Ping(context.Background()); err != nil {
		t.Skip("no test database:", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func TestUpIsIdempotent(t *testing.T) {
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
	if err := Up(ctx, pool); err != nil {
		t.Fatal("second up:", err)
	}
	var n int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM users").Scan(&n); err != nil {
		t.Fatal("users table missing:", err)
	}
}

// Grandfather: workspace + member tạo trước 004 phải có org cùng slug và
// user đã có membership phải được coi là đã onboard.
func TestOrganizationsGrandfather(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	// Cùng khoá advisory 727273 với testutil.DB: test này TRUNCATE + Down,
	// không được chạy chen với test package khác trên cùng DB test.
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
	// Đưa DB về trạng thái sau 003 rồi chèn dữ liệu kiểu cũ. Down lùi một
	// migration mỗi lần, nên lặp cho tới khi 004 đã bị gỡ.
	for {
		var applied bool
		if err := pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version LIKE '004%')`).Scan(&applied); err != nil {
			t.Fatal(err)
		}
		if !applied {
			break
		}
		if err := Down(ctx, pool); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := pool.Exec(ctx, `TRUNCATE users, workspaces, workspace_members CASCADE`); err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO users (id, email, password_hash, display_name) VALUES
		  ('01USER00000000000000000001','old@example.com','x','Old'),
		  ('01USER00000000000000000002','new@example.com','x','New');
		INSERT INTO workspaces (id, slug, name, created_by) VALUES
		  ('01WSPC00000000000000000001','doi-cu','Đội cũ','01USER00000000000000000001');
		INSERT INTO workspace_members (workspace_id, user_id, role) VALUES
		  ('01WSPC00000000000000000001','01USER00000000000000000001','owner');`)
	if err != nil {
		t.Fatal(err)
	}
	if err := Up(ctx, pool); err != nil {
		t.Fatal("re-up:", err)
	}
	var orgSlug, orgID string
	err = pool.QueryRow(ctx, `SELECT o.slug, o.id FROM workspaces w JOIN organizations o ON o.id = w.organization_id WHERE w.id = $1`,
		"01WSPC00000000000000000001").Scan(&orgSlug, &orgID)
	if err != nil || orgSlug != "doi-cu" {
		t.Fatalf("org grandfather: slug=%q err=%v", orgSlug, err)
	}
	var role string
	if err := pool.QueryRow(ctx, `SELECT role FROM organization_members WHERE organization_id=$1 AND user_id=$2`,
		orgID, "01USER00000000000000000001").Scan(&role); err != nil || role != "owner" {
		t.Fatalf("org member grandfather: role=%q err=%v", role, err)
	}
	var oldOnboarded, newOnboarded bool
	_ = pool.QueryRow(ctx, `SELECT onboarded_at IS NOT NULL FROM users WHERE id=$1`, "01USER00000000000000000001").Scan(&oldOnboarded)
	_ = pool.QueryRow(ctx, `SELECT onboarded_at IS NOT NULL FROM users WHERE id=$1`, "01USER00000000000000000002").Scan(&newOnboarded)
	if !oldOnboarded || newOnboarded {
		t.Fatalf("onboarded grandfather: old=%v new=%v", oldOnboarded, newOnboarded)
	}
}

func TestRenamedChatMigrationVersions(t *testing.T) {
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

	if _, err := pool.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM schema_migrations WHERE version = ANY($1)`,
			[]string{"034_chat_core", "046_chat_core"})
	})
	if _, err := pool.Exec(ctx, `DELETE FROM schema_migrations WHERE version = ANY($1)`,
		[]string{"034_chat_core", "046_chat_core"}); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING`,
		"034_chat_core"); err != nil {
		t.Fatal(err)
	}
	if err := reconcileRenamedMigrations(ctx, lock); err != nil {
		t.Fatal(err)
	}
	var renamed bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1)`,
		"046_chat_core").Scan(&renamed); err != nil || !renamed {
		t.Fatalf("expected 046_chat_core after rename, got renamed=%v err=%v", renamed, err)
	}
	var legacy bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1)`,
		"034_chat_core").Scan(&legacy); err != nil || legacy {
		t.Fatalf("legacy 034_chat_core should be gone, legacy=%v err=%v", legacy, err)
	}
}

func TestRenamedChatMigrationVersionsDropsStaleOldRow(t *testing.T) {
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

	if _, err := pool.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM schema_migrations WHERE version = ANY($1)`,
			[]string{"034_chat_core", "046_chat_core"})
	})
	for _, v := range []string{"034_chat_core", "046_chat_core"} {
		if _, err := pool.Exec(ctx,
			`INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING`, v); err != nil {
			t.Fatal(err)
		}
	}
	if err := reconcileRenamedMigrations(ctx, lock); err != nil {
		t.Fatal(err)
	}
	var legacy bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1)`,
		"034_chat_core").Scan(&legacy); err != nil || legacy {
		t.Fatalf("stale 034_chat_core should be removed when 046 exists, legacy=%v err=%v", legacy, err)
	}
}

// TestTasksWorkManagementUpgradeFrom106 rehearses 107–131 against a frozen
// pre-foundation snapshot: same timestamps, deterministic numbering, prefix
// backfill, system status seed, and no fabricated audit history.
func TestTasksWorkManagementUpgradeFrom106(t *testing.T) {
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
	for {
		var applied bool
		if err := pool.QueryRow(ctx, `
			SELECT EXISTS (
			  SELECT 1 FROM schema_migrations
			  WHERE version = '107_tasks_work_management_foundation'
			)`).Scan(&applied); err != nil {
			t.Fatal(err)
		}
		if !applied {
			break
		}
		if err := Down(ctx, pool); err != nil {
			t.Fatal(err)
		}
	}

	if _, err := pool.Exec(ctx, `
		TRUNCATE users, organizations, organization_members,
		  workspaces, workspace_members, tasks, task_comments,
		  audit_events, outbox_events CASCADE`); err != nil {
		t.Fatal(err)
	}

	const (
		userID   = "01USER0000000000000000000A"
		orgAID   = "01ORG00000000000000000000A"
		orgBID   = "01ORG00000000000000000000B"
		wsAID    = "01WSPC0000000000000000000A"
		wsBID    = "01WSPC0000000000000000000B"
		task1ID  = "01TASK00000000000000000001"
		task2ID  = "01TASK00000000000000000002"
		task3ID  = "01TASK00000000000000000003"
		comment1 = "01CMNT00000000000000000001"
		comment2 = "01CMNT00000000000000000002"
		sharedTS = "2026-01-15T10:00:00Z"
	)

	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO users (id, email, password_hash, display_name) VALUES ($1,'rehearsal@example.com','x','Rehearsal')`, userID)
	exec(`INSERT INTO organizations (id, slug, name, created_by) VALUES
		($1,'org-alpha','Org Alpha',$3), ($2,'org-beta','Org Beta',$3)`, orgAID, orgBID, userID)
	exec(`INSERT INTO organization_members (organization_id, user_id, role) VALUES
		($1,$3,'owner'), ($2,$3,'owner')`, orgAID, orgBID, userID)
	exec(`INSERT INTO workspaces (id, slug, name, created_by, organization_id) VALUES
		($1,'alpha','Alpha',$3,$4), ($2,'beta','Beta',$3,$5)`, wsAID, wsBID, userID, orgAID, orgBID)
	exec(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES
		($1,$3,'owner'), ($2,$3,'owner')`, wsAID, wsBID, userID)
	exec(`INSERT INTO tasks (
		  id, workspace_id, title, description, status, priority,
		  created_by, created_by_kind, created_at, updated_at
		) VALUES
		  ($1,$4,'First','Body one','todo','medium',$5,'human',$6::timestamptz,$6::timestamptz),
		  ($2,$4,'Second','Body two','in_progress','high',$5,'human',$6::timestamptz,$6::timestamptz),
		  ($3,$4,'Third','Body three','done','low',$5,'human',$6::timestamptz,$6::timestamptz)`,
		task1ID, task2ID, task3ID, wsAID, userID, sharedTS)
	exec(`INSERT INTO task_comments (id, task_id, author_id, author_kind, body, created_at) VALUES
		($1,$3,$5,'human','Comment on first',$6::timestamptz),
		($2,$4,$5,'human','Comment on second',$6::timestamptz)`,
		comment1, comment2, task1ID, task2ID, userID, sharedTS)

	var auditBefore int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM audit_events`).Scan(&auditBefore); err != nil {
		t.Fatal(err)
	}

	if err := Up(ctx, pool); err != nil {
		t.Fatal("re-up foundation:", err)
	}

	type taskRow struct {
		id, orgID, creatorID, creatorType string
		number                            int64
		title, description                string
		createdAt, updatedAt, lastAct     time.Time
	}
	rows, err := pool.Query(ctx, `
		SELECT id, organization_id, number, creator_id, creator_type,
		       title, description, created_at, updated_at, last_activity_at
		FROM tasks WHERE workspace_id=$1 ORDER BY number`, wsAID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()

	var got []taskRow
	for rows.Next() {
		var r taskRow
		if err := rows.Scan(
			&r.id, &r.orgID, &r.number, &r.creatorID, &r.creatorType,
			&r.title, &r.description, &r.createdAt, &r.updatedAt, &r.lastAct,
		); err != nil {
			t.Fatal(err)
		}
		got = append(got, r)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 {
		t.Fatalf("want 3 tasks, got %d", len(got))
	}

	wantIDs := []string{task1ID, task2ID, task3ID}
	wantTitles := []string{"First", "Second", "Third"}
	wantBodies := []string{"Body one", "Body two", "Body three"}
	shared, err := time.Parse(time.RFC3339, sharedTS)
	if err != nil {
		t.Fatal(err)
	}
	for i, r := range got {
		if r.id != wantIDs[i] || r.number != int64(i+1) {
			t.Fatalf("numbering[%d]: id=%s number=%d", i, r.id, r.number)
		}
		if r.orgID != orgAID {
			t.Fatalf("organization_id[%d]=%q", i, r.orgID)
		}
		if r.creatorID != userID || r.creatorType != "member" {
			t.Fatalf("creator[%d]=%s/%s", i, r.creatorID, r.creatorType)
		}
		if r.title != wantTitles[i] || r.description != wantBodies[i] {
			t.Fatalf("content[%d]=%q/%q", i, r.title, r.description)
		}
		if !r.createdAt.Equal(shared) || !r.updatedAt.Equal(shared) || !r.lastAct.Equal(shared) {
			t.Fatalf("timestamps[%d] created=%v updated=%v last=%v", i, r.createdAt, r.updatedAt, r.lastAct)
		}
	}

	var prefix string
	var counter int64
	if err := pool.QueryRow(ctx,
		`SELECT task_prefix, task_counter FROM workspaces WHERE id=$1`, wsAID,
	).Scan(&prefix, &counter); err != nil {
		t.Fatal(err)
	}
	if prefix != "ALP" || counter != 3 {
		t.Fatalf("prefix/counter = %s/%d, want ALP/3", prefix, counter)
	}

	for _, wsID := range []string{wsAID, wsBID} {
		var n int
		if err := pool.QueryRow(ctx, `
			SELECT count(*) FROM task_statuses
			WHERE workspace_id=$1 AND is_system=true`, wsID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n != 7 {
			t.Fatalf("workspace %s system statuses=%d, want 7", wsID, n)
		}
	}

	var c1, c2 string
	if err := pool.QueryRow(ctx,
		`SELECT body FROM task_comments WHERE id=$1`, comment1,
	).Scan(&c1); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT body FROM task_comments WHERE id=$1`, comment2,
	).Scan(&c2); err != nil {
		t.Fatal(err)
	}
	if c1 != "Comment on first" || c2 != "Comment on second" {
		t.Fatalf("comment bodies: %q %q", c1, c2)
	}

	var auditAfter int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM audit_events`).Scan(&auditAfter); err != nil {
		t.Fatal(err)
	}
	if auditAfter != auditBefore {
		t.Fatalf("migration wrote audit_events: before=%d after=%d", auditBefore, auditAfter)
	}
}
