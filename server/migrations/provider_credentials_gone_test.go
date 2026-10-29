package migrations

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const dropCredentialsVersion = "9991793265480000_drop_ai_provider_credentials"

// UNI-2289: the key store and its plan entitlement are gone once every
// migration has run.
func TestNoProviderCredentialTable(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	lockTestDB(t, pool)
	if err := Up(ctx, pool); err != nil {
		t.Fatal(err)
	}
	var table *string
	if err := pool.QueryRow(ctx, `SELECT to_regclass('public.ai_provider_credentials')::text`).Scan(&table); err != nil {
		t.Fatal(err)
	}
	if table != nil {
		t.Errorf("ai_provider_credentials still exists: %s", *table)
	}
	if f, pf := countByokFeatureRows(t, pool); f != 0 || pf != 0 {
		t.Errorf("office.ai_byok rows: features=%d plan_features=%d, want 0 and 0", f, pf)
	}
}

// credentialsSchema is the shape of ai_provider_credentials: columns with
// type, nullability and default, plus its CHECK constraints.
func credentialsSchema(t *testing.T, pool *pgxpool.Pool) string {
	t.Helper()
	ctx := context.Background()
	var parts []string
	rows, err := pool.Query(ctx, `SELECT column_name, data_type, is_nullable, COALESCE(column_default, '')
		FROM information_schema.columns
		WHERE table_schema = 'public' AND table_name = 'ai_provider_credentials'
		ORDER BY ordinal_position`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var a, b, c, d string
		if err := rows.Scan(&a, &b, &c, &d); err != nil {
			t.Fatal(err)
		}
		parts = append(parts, fmt.Sprintf("col %s %s null=%s default=%s", a, b, c, d))
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	cons, err := pool.Query(ctx, `SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
		WHERE conrelid = to_regclass('public.ai_provider_credentials') ORDER BY conname`)
	if err != nil {
		t.Fatal(err)
	}
	for cons.Next() {
		var a, b string
		if err := cons.Scan(&a, &b); err != nil {
			t.Fatal(err)
		}
		parts = append(parts, fmt.Sprintf("con %s %s", a, b))
	}
	cons.Close()
	if err := cons.Err(); err != nil {
		t.Fatal(err)
	}
	return strings.Join(parts, "\n")
}

// freshDatabase creates an empty database beside the test one and removes it
// at the end, so this test does not touch the shared schema.
func freshDatabase(t *testing.T) *pgxpool.Pool {
	t.Helper()
	ctx := context.Background()
	base := testPool(t).Config().ConnConfig
	admin, err := pgx.ConnectConfig(ctx, base)
	if err != nil {
		t.Skip("no test database:", err)
	}
	name := fmt.Sprintf("uniwork_credgone_%d", time.Now().UnixNano())
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+name); err != nil {
		admin.Close(ctx) //nolint:errcheck
		t.Skip("cannot create a database:", err)
	}
	cfg, err := pgxpool.ParseConfig(base.ConnString())
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.Database = name
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Close()
		_, _ = admin.Exec(ctx, "DROP DATABASE IF EXISTS "+name+" WITH (FORCE)")
		admin.Close(ctx) //nolint:errcheck
	})
	return pool
}

// upBefore applies every migration that sorts before stop, the way Up does.
func upBefore(t *testing.T, pool *pgxpool.Pool, stop string) {
	t.Helper()
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`); err != nil {
		t.Fatal(err)
	}
	vs, err := versions()
	if err != nil {
		t.Fatal(err)
	}
	for _, v := range vs {
		if !behind(v, stop) {
			break
		}
		sql, err := fsys.ReadFile(v + ".up.sql")
		if err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, string(sql)); err != nil {
			t.Fatalf("migration %s: %v", v, err)
		}
		if _, err := pool.Exec(ctx, `INSERT INTO schema_migrations (version) VALUES ($1)`, v); err != nil {
			t.Fatal(err)
		}
	}
}

func countByokFeatureRows(t *testing.T, pool *pgxpool.Pool) (features, planFeatures int) {
	t.Helper()
	ctx := context.Background()
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM features WHERE key = 'office.ai_byok'`).Scan(&features); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM plan_features WHERE feature_key = 'office.ai_byok'`).Scan(&planFeatures); err != nil {
		t.Fatal(err)
	}
	return features, planFeatures
}

// An environment that holds key rows: up drops them cleanly, down rebuilds the
// exact schema (never the keys) so the older down chain still runs, up again.
func TestDropProviderCredentialsUpDownUp(t *testing.T) {
	pool := freshDatabase(t)
	ctx := context.Background()
	upBefore(t, pool, dropCredentialsVersion)
	before := credentialsSchema(t, pool)
	if before == "" {
		t.Fatal("ai_provider_credentials missing before the migration")
	}
	if _, err := pool.Exec(ctx, `INSERT INTO ai_provider_credentials
		(id, organization_id, user_id, provider, secret_ciphertext, key_hint, created_by, created_by_kind)
		VALUES ('01CRED0000000000000000001', 'org', 'user', 'openai', '\x00', 'sk-1234', 'user', 'human')`); err != nil {
		t.Fatal(err)
	}
	// A fresh database may seed no plan carrying ai.tokens; make sure a row exists.
	if _, err := pool.Exec(ctx, `INSERT INTO plan_features (plan_id, feature_key, enabled, quota_limit)
		SELECT id, 'office.ai_byok', true, NULL FROM plans LIMIT 1 ON CONFLICT DO NOTHING`); err != nil {
		t.Fatal(err)
	}
	if f, pf := countByokFeatureRows(t, pool); f != 1 || pf == 0 {
		t.Fatalf("before up: features=%d plan_features=%d, want 1 and >0", f, pf)
	}

	if err := Up(ctx, pool); err != nil {
		t.Fatal("up over key rows:", err)
	}
	var table *string
	if err := pool.QueryRow(ctx, `SELECT to_regclass('public.ai_provider_credentials')::text`).Scan(&table); err != nil {
		t.Fatal(err)
	}
	if table != nil {
		t.Fatal("table survived up")
	}
	if f, pf := countByokFeatureRows(t, pool); f != 0 || pf != 0 {
		t.Errorf("after up: features=%d plan_features=%d, want 0 and 0", f, pf)
	}

	if err := Down(ctx, pool); err != nil {
		t.Fatal("down:", err)
	}
	if after := credentialsSchema(t, pool); after != before {
		t.Errorf("schema after down differs\nbefore:\n%s\nafter:\n%s", before, after)
	}
	var rows int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM ai_provider_credentials`).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 0 {
		t.Errorf("down restored %d key rows, want 0", rows)
	}
	if f, pf := countByokFeatureRows(t, pool); f != 1 || pf == 0 {
		t.Errorf("after down: features=%d plan_features=%d, want 1 and >0", f, pf)
	}

	if err := Up(ctx, pool); err != nil {
		t.Fatal("second up:", err)
	}
}
