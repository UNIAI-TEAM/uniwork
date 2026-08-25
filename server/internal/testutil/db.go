// Package testutil provides shared test helpers. DB returns a pool on the
// test database with migrations applied and all business tables truncated,
// so each test starts from a clean slate.
package testutil

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/migrations"
)

func DB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		url = "postgres://uniwork:uniwork@localhost:5433/uniwork_test?sslmode=disable"
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Skip("no test database:", err)
	}
	if err := pool.Ping(ctx); err != nil {
		t.Skip("no test database:", err)
	}
	if err := migrations.Up(ctx, pool); err != nil {
		t.Fatal("migrate:", err)
	}
	_, err = pool.Exec(ctx, `TRUNCATE users, workspaces, workspace_members,
		invitations, refresh_tokens CASCADE`)
	if err != nil {
		t.Fatal("truncate:", err)
	}
	t.Cleanup(pool.Close)
	return pool
}
