package config

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Pool defaults for DATABASE_URL, applied only where the DSN is silent: an
// operator's pool_max_conns=… or idle_in_transaction_session_timeout=… in the
// URL always wins. There is no statement_timeout default on purpose: the
// office engine, audit exports and backfills run long statements on this pool.
const (
	// pgxpool's own default is max(4, NumCPU) — four connections on a small
	// node, fewer than the background workers can hold at once (outbox, mail,
	// webhook fan-out of MEETING_WEBHOOK_CONCURRENCY). Twenty leaves room for
	// requests while five replicas still fit Postgres' default
	// max_connections of 100.
	defaultPoolMaxConns = 20
	// A transaction idle this long between statements is a stuck request or a
	// leak; Postgres ends the session so its locks and pool slot come back.
	// The longest legitimate gap is the mail outbox's SMTP send inside its
	// claim transaction, capped at 40s (10s dial + 30s session).
	defaultIdleInTxTimeout = "60s"
	idleInTxParam          = "idle_in_transaction_session_timeout"
)

// PoolConfig parses DATABASE_URL for the server's pool and fills in the
// defaults above for whatever the DSN does not set.
func PoolConfig(dsn string) (*pgxpool.Config, error) {
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, err
	}
	if !strings.Contains(dsn, "pool_max_conns") {
		cfg.MaxConns = defaultPoolMaxConns
	}
	// Set as a URL parameter it lands in RuntimeParams; inside options=-c… it
	// does not, so the DSN text is checked too.
	if _, set := cfg.ConnConfig.RuntimeParams[idleInTxParam]; !set && !strings.Contains(dsn, idleInTxParam) {
		cfg.AfterConnect = setIdleInTxTimeout
	}
	return cfg, nil
}

// setIdleInTxTimeout applies the default with SET once a connection opens,
// not as a startup parameter: production reaches Postgres through PgBouncer,
// which refuses a connection carrying a startup parameter outside its
// ignore_startup_parameters list. Behind a transaction-mode pooler the SET
// lands on whichever server connection answers it, so the durable form there
// is ALTER ROLE … SET idle_in_transaction_session_timeout.
func setIdleInTxTimeout(ctx context.Context, conn *pgx.Conn) error {
	_, err := conn.Exec(ctx, "SET "+idleInTxParam+" = '"+defaultIdleInTxTimeout+"'")
	return err
}
