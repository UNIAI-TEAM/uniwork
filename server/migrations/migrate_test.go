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
