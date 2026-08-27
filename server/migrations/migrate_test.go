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
		url = "postgres://uniwork:uniwork@localhost:5433/uniwork_test?sslmode=disable"
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
	if _, err := lock.Exec(ctx, "SELECT pg_advisory_lock($1)", 727273); err != nil {
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
