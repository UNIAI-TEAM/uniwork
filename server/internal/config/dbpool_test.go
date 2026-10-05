package config

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPoolConfigFillsDefaultsTheDSNLeavesOut(t *testing.T) {
	cfg, err := PoolConfig("postgres://u:p@localhost:5432/db?sslmode=disable")
	if err != nil {
		t.Fatal(err)
	}
	if cfg.MaxConns != defaultPoolMaxConns {
		t.Fatalf("MaxConns = %d, want %d", cfg.MaxConns, defaultPoolMaxConns)
	}
	// Never a startup parameter: PgBouncer refuses the connection outright
	// for one it does not know.
	if got, set := cfg.ConnConfig.RuntimeParams[idleInTxParam]; set {
		t.Fatalf("%s sent as a startup parameter (%q)", idleInTxParam, got)
	}
	if cfg.AfterConnect == nil {
		t.Fatalf("no AfterConnect to set %s", idleInTxParam)
	}
}

func TestPoolConfigKeepsWhatTheDSNSets(t *testing.T) {
	for _, dsn := range []string{
		"postgres://u:p@localhost:5432/db?pool_max_conns=7&idle_in_transaction_session_timeout=5s",
		"host=localhost dbname=db pool_max_conns=7 idle_in_transaction_session_timeout=5s",
	} {
		cfg, err := PoolConfig(dsn)
		if err != nil {
			t.Fatal(err)
		}
		if cfg.MaxConns != 7 {
			t.Fatalf("%s: MaxConns = %d, want 7", dsn, cfg.MaxConns)
		}
		if got := cfg.ConnConfig.RuntimeParams[idleInTxParam]; got != "5s" {
			t.Fatalf("%s: %s = %q, want 5s", dsn, idleInTxParam, got)
		}
		if cfg.AfterConnect != nil {
			t.Fatalf("%s: default SET runs beside the DSN's own value", dsn)
		}
	}
	// Inside options=-c the parameter never reaches RuntimeParams; the
	// default must not be sent beside it.
	cfg, err := PoolConfig("postgres://u:p@localhost:5432/db?options=-c%20idle_in_transaction_session_timeout%3D0")
	if err != nil {
		t.Fatal(err)
	}
	if got, set := cfg.ConnConfig.RuntimeParams[idleInTxParam]; set {
		t.Fatalf("default sent beside options: %q", got)
	}
	if cfg.AfterConnect != nil {
		t.Fatal("default SET runs beside options")
	}
}

// The default reaches the session on a real connection.
func TestPoolConfigSetsIdleInTxTimeoutOnConnect(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		url = "postgres://uniwork:uniwork@localhost:5432/uniwork_test?sslmode=disable"
	}
	cfg, err := PoolConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Skip("no test database:", err)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		t.Skip("no test database:", err)
	}
	var got string
	if err := pool.QueryRow(ctx, "SHOW "+idleInTxParam).Scan(&got); err != nil {
		t.Fatal(err)
	}
	if got != "1min" {
		t.Fatalf("%s = %q, want 1min", idleInTxParam, got)
	}
}

func TestPoolConfigRejectsBadDSN(t *testing.T) {
	if _, err := PoolConfig("postgres://u:p@localhost:notaport/db"); err == nil {
		t.Fatal("want an error for a malformed DSN")
	}
}
