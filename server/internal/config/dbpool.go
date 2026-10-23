package config

import (
	"context"
	"regexp"
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
	// JIT compile costs ~1 s on list and report plans whose permission
	// subplan the planner prices high (an org owner's sorted document list,
	// the report page): the estimate crosses jit_above_cost, so the plan is
	// compiled although it runs in under 60 ms without JIT. This server's
	// queries are short OLTP statements that never earn a compile back.
	defaultJIT = "off"
	jitParam   = "jit"
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
	var defaults []string
	for _, d := range [...]struct{ param, value string }{
		{idleInTxParam, defaultIdleInTxTimeout},
		{jitParam, defaultJIT},
	} {
		if _, set := cfg.ConnConfig.RuntimeParams[d.param]; !set && !dsnNames(dsn, d.param) {
			defaults = append(defaults, "SET "+d.param+" = '"+d.value+"'")
		}
	}
	if len(defaults) > 0 {
		cfg.AfterConnect = setSessionDefaults(defaults)
	}
	return cfg, nil
}

// dsnNames reports whether the DSN text assigns the parameter: as a URL
// parameter, a keyword or inside options=-c… . "jit" is short enough to sit
// inside a password or a host name, so it must be followed by "=" (or its
// URL-encoded form) and not continue a longer name; a digit may precede it
// because a URL-encoded space ends in one (options=-c%20jit%3Don).
func dsnNames(dsn, param string) bool {
	return regexp.MustCompile(`(^|[^A-Za-z_])` + regexp.QuoteMeta(param) + `\s*(=|%3[Dd])`).MatchString(dsn)
}

// setSessionDefaults applies the defaults with SET once a connection opens,
// not as startup parameters: production reaches Postgres through PgBouncer,
// which refuses a connection carrying a startup parameter outside its
// ignore_startup_parameters list. Behind a transaction-mode pooler the SET
// lands on whichever server connection answers it, so the durable form there
// is ALTER ROLE … SET <param>.
func setSessionDefaults(stmts []string) func(context.Context, *pgx.Conn) error {
	return func(ctx context.Context, conn *pgx.Conn) error {
		for _, stmt := range stmts {
			if _, err := conn.Exec(ctx, stmt); err != nil {
				return err
			}
		}
		return nil
	}
}
