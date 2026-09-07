package migrations

import (
	"context"
	"os"
	"testing"

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

// 004 grandfathered one organization per legacy workspace and copied every
// workspace owner into it, so an organization can hold several owners. 107
// keeps the earliest and demotes the rest, and only then can 108 build the
// single-owner unique index (spec F-03 §2 decision 3).
func TestSingleOwnerBackfillDemotesLaterOwners(t *testing.T) {
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
	// Roll back to just before 107 so the two owners can be inserted without
	// the unique index refusing them.
	for {
		var applied bool
		if err := pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version LIKE '107%')`).Scan(&applied); err != nil {
			t.Fatal(err)
		}
		if !applied {
			break
		}
		if err := Down(ctx, pool); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := pool.Exec(ctx, `TRUNCATE users, organizations CASCADE`); err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO users (id, email, password_hash, display_name) VALUES
		  ('01USER00000000000000000011','first@example.com','x','First'),
		  ('01USER00000000000000000012','second@example.com','x','Second');
		INSERT INTO organizations (id, slug, name, created_by) VALUES
		  ('01ORGA00000000000000000011','hai-owner','Hai owner','01USER00000000000000000011');
		INSERT INTO organization_members (organization_id, user_id, role, created_at) VALUES
		  ('01ORGA00000000000000000011','01USER00000000000000000011','owner', now() - interval '2 days'),
		  ('01ORGA00000000000000000011','01USER00000000000000000012','owner', now() - interval '1 day');`)
	if err != nil {
		t.Fatal(err)
	}
	if err := Up(ctx, pool); err != nil {
		t.Fatal("re-up:", err)
	}
	var firstRole, secondRole string
	if err := pool.QueryRow(ctx, `SELECT role FROM organization_members WHERE organization_id=$1 AND user_id=$2`,
		"01ORGA00000000000000000011", "01USER00000000000000000011").Scan(&firstRole); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT role FROM organization_members WHERE organization_id=$1 AND user_id=$2`,
		"01ORGA00000000000000000011", "01USER00000000000000000012").Scan(&secondRole); err != nil {
		t.Fatal(err)
	}
	if firstRole != "owner" || secondRole != "admin" {
		t.Fatalf("expected the earliest owner to stay owner and the later one to become admin, got %q and %q", firstRole, secondRole)
	}
	// The unique index is what the demotion exists for: a second owner must be
	// impossible from here on.
	if _, err := pool.Exec(ctx, `UPDATE organization_members SET role='owner' WHERE organization_id=$1 AND user_id=$2`,
		"01ORGA00000000000000000011", "01USER00000000000000000012"); err == nil {
		t.Fatal("expected the single-owner unique index to refuse a second owner")
	}
}
