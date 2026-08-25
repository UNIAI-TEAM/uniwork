// Package migrations embeds SQL migrations and applies them in order,
// tracked in schema_migrations, serialized by a Postgres advisory lock
// so concurrent instances don't race (same model as usf). Files run outside
// a transaction so concurrent index builds are possible; see Up.
package migrations

import (
	"context"
	"embed"
	"fmt"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed *.sql
var fsys embed.FS

const lockKey = 727272

func versions() ([]string, error) {
	entries, err := fsys.ReadDir(".")
	if err != nil {
		return nil, err
	}
	var vs []string
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".up.sql") {
			vs = append(vs, strings.TrimSuffix(e.Name(), ".up.sql"))
		}
	}
	sort.Strings(vs)
	return vs, nil
}

func Up(ctx context.Context, pool *pgxpool.Pool) error {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()
	if _, err := conn.Exec(ctx, "SELECT pg_advisory_lock($1)", lockKey); err != nil {
		return err
	}
	defer conn.Exec(ctx, "SELECT pg_advisory_unlock($1)", lockKey)

	if _, err := conn.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`); err != nil {
		return err
	}
	vs, err := versions()
	if err != nil {
		return err
	}
	for _, v := range vs {
		var exists bool
		if err := conn.QueryRow(ctx,
			"SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=$1)", v).Scan(&exists); err != nil {
			return err
		}
		if exists {
			continue
		}
		sql, err := fsys.ReadFile(v + ".up.sql")
		if err != nil {
			return err
		}
		// Applied OUTSIDE a transaction on purpose. CREATE INDEX CONCURRENTLY —
		// the only kind of index build allowed from migration 005 on — is
		// rejected by PostgreSQL inside a transaction block, and the advisory
		// lock above already serializes runners. The cost is that a failing
		// multi-statement file can leave earlier statements applied; the file
		// is then fixed forward, which is the convention anyway.
		if _, err := conn.Exec(ctx, string(sql)); err != nil {
			return fmt.Errorf("migration %s: %w", v, err)
		}
		if _, err := conn.Exec(ctx, "INSERT INTO schema_migrations (version) VALUES ($1)", v); err != nil {
			return err
		}
	}
	return nil
}

// Down rolls back the single most recent applied migration.
func Down(ctx context.Context, pool *pgxpool.Pool) error {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()
	var v string
	err = conn.QueryRow(ctx, "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1").Scan(&v)
	if err != nil {
		return fmt.Errorf("nothing to roll back: %w", err)
	}
	sql, err := fsys.ReadFile(v + ".down.sql")
	if err != nil {
		return err
	}
	// Same reasoning as Up: DROP INDEX CONCURRENTLY cannot run in a transaction.
	if _, err := conn.Exec(ctx, string(sql)); err != nil {
		return fmt.Errorf("rollback %s: %w", v, err)
	}
	_, err = conn.Exec(ctx, "DELETE FROM schema_migrations WHERE version=$1", v)
	return err
}
