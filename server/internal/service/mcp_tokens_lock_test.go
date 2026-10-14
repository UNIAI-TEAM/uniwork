package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The token tests below hold a raw transaction open to stand for another
// request that is half way through a change, start the operation under test
// against it, wait until the database shows it blocked on a lock, and only then
// let the raw transaction commit. The service serializes everything that
// changes a grant's tokens on the grant row (lock order: attempt, then grant,
// then token), so each operation must queue behind the open transaction and
// then see all of it.

// grantTx opens a raw transaction that holds the grant row of the world's
// organization FOR UPDATE.
func (w *mcpWorld) grantTx(t *testing.T) (pgx.Tx, db.McpGrant) {
	t.Helper()
	tx, err := w.pool.Begin(w.ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tx.Rollback(context.Background()) })
	var id string
	if err := w.pool.QueryRow(w.ctx, `SELECT id FROM mcp_grants WHERE organization_id = $1`, w.org.ID).Scan(&id); err != nil {
		t.Fatal(err)
	}
	grant, err := w.q.WithTx(tx).GetMcpGrantForUpdate(w.ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	return tx, grant
}

// rotationInFlight stands for a Refresh that is mid-rotation on pair, in the
// order the service takes its locks: the grant row, then the newest refresh
// token row, then the next pair inserted (live, same family), uncommitted.
func (w *mcpWorld) rotationInFlight(t *testing.T, pair McpTokenPair) pgx.Tx {
	t.Helper()
	newest, err := w.q.GetMcpTokenByDigest(w.ctx, digest(pair.RefreshToken))
	if err != nil {
		t.Fatal(err)
	}
	tx, grant := w.grantTx(t)
	q := w.q.WithTx(tx)
	if _, err := q.GetMcpTokenByDigestForUpdate(w.ctx, newest.Digest); err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"access", "refresh"} {
		raw, err := randomToken(32)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := q.CreateMcpToken(w.ctx, db.CreateMcpTokenParams{
			ID: util.NewID(), OrganizationID: grant.OrganizationID, GrantID: grant.ID, FamilyID: newest.FamilyID,
			Kind: kind, Digest: digest("in-flight-" + raw), ExpiresAt: mcpTime(time.Now().Add(time.Hour)),
		}); err != nil {
			t.Fatal(err)
		}
	}
	return tx
}

// grantRevokeInFlight stands for a grant revocation that has marked the grant
// revoked and not yet committed.
func (w *mcpWorld) grantRevokeInFlight(t *testing.T) pgx.Tx {
	t.Helper()
	tx, grant := w.grantTx(t)
	if _, err := w.q.WithTx(tx).RevokeMcpGrant(w.ctx, db.RevokeMcpGrantParams{ID: grant.ID}); err != nil {
		t.Fatal(err)
	}
	return tx
}

// waitForLockWait reports whether some MCP statement shows up blocked on a
// lock within a few seconds.
func (w *mcpWorld) waitForLockWait(t *testing.T) bool {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if w.countRows(t, `SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE '%mcp_%'`) > 0 {
			return true
		}
		time.Sleep(20 * time.Millisecond)
	}
	return false
}

func inBackground(f func() error) <-chan error {
	done := make(chan error, 1)
	go func() { done <- f() }()
	return done
}

// raceAfterLock runs op, waits for it to block on the open transaction, commits
// that transaction and returns what op answered.
func (w *mcpWorld) raceAfterLock(t *testing.T, open pgx.Tx, op func() error) error {
	t.Helper()
	done := inBackground(op)
	if !w.waitForLockWait(t) {
		t.Errorf("the operation never waited on the transaction in flight: it ran past a change it could not see")
	}
	if err := open.Commit(w.ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		return err
	case <-time.After(10 * time.Second):
		t.Fatal("the operation did not finish after the transaction in flight committed")
		return nil
	}
}

// Important 1: a family revocation that starts while a rotation is in flight
// must wait for it and then revoke the pair it minted. Without the grant lock
// the revoke blocks on the old refresh token row, resumes after the commit,
// and never sees the new rows: the audit row says the family is closed while a
// live pair remains.
func TestMcpCodeReplayWaitsForRotationInFlight(t *testing.T) {
	w := newMcpWorld(t)
	w.enable(t)
	c := w.publicClient(t, "https://x.test/cb")
	code := w.approve(t, c, "https://x.test/cb")
	in := McpExchangeInput{ClientID: c.ClientID, Code: code, CodeVerifier: mcpTestVerifier, RedirectURI: "https://x.test/cb"}
	pair, err := w.svc.Exchange(w.ctx, in)
	if err != nil {
		t.Fatal(err)
	}
	rotation := w.rotationInFlight(t, pair)

	err = w.raceAfterLock(t, rotation, func() error { _, err := w.svc.Exchange(w.ctx, in); return err })
	wantOAuth(t, err, "invalid_grant")
	if n := w.liveTokens(t); n != 0 {
		t.Fatalf("live tokens = %d: the pair minted by the rotation in flight survived the family revocation", n)
	}
	if rows := w.familyRevokedRows(t); rows != 1 {
		t.Fatalf("family_revoked audit rows = %d, want 1", rows)
	}
}

func TestMcpStaleRefreshWaitsForRotationInFlight(t *testing.T) {
	w := newMcpWorld(t)
	c, pair0 := w.issue(t)
	pair1, err := w.svc.Refresh(w.ctx, McpRefreshInput{ClientID: c.ClientID, RefreshToken: pair0.RefreshToken})
	if err != nil {
		t.Fatal(err)
	}
	rotation := w.rotationInFlight(t, pair1)
	w.svc.now = func() time.Time { return time.Now().Add(mcpReuseGrace + time.Second) }

	err = w.raceAfterLock(t, rotation, func() error {
		_, err := w.svc.Refresh(w.ctx, McpRefreshInput{ClientID: c.ClientID, RefreshToken: pair0.RefreshToken})
		return err
	})
	wantOAuth(t, err, "invalid_grant")
	if n := w.liveTokens(t); n != 0 {
		t.Fatalf("live tokens = %d: the pair minted by the rotation in flight survived the reuse revocation", n)
	}
}

func TestMcpRevokeTokenWaitsForRotationInFlight(t *testing.T) {
	w := newMcpWorld(t)
	c, pair := w.issue(t)
	rotation := w.rotationInFlight(t, pair)

	err := w.raceAfterLock(t, rotation, func() error { return w.svc.RevokeToken(w.ctx, c.ClientID, "", pair.RefreshToken) })
	if err != nil {
		t.Fatal(err)
	}
	if n := w.liveTokens(t); n != 0 {
		t.Fatalf("live tokens = %d: revoking a refresh token must close the pair minted by the rotation in flight too", n)
	}
}

// A grant revocation in flight (it will also close the grant's tokens, in
// Task 5's transaction) must not be overtaken by a mint: neither a code
// exchange nor a refresh may issue a pair for a grant that is being revoked.
func TestMcpExchangeWaitsForGrantRevokeInFlight(t *testing.T) {
	w := newMcpWorld(t)
	c, _ := w.issue(t)
	code := w.approve(t, c, "https://x.test/cb")
	revoke := w.grantRevokeInFlight(t)

	err := w.raceAfterLock(t, revoke, func() error {
		_, err := w.svc.Exchange(w.ctx, McpExchangeInput{ClientID: c.ClientID, Code: code, CodeVerifier: mcpTestVerifier, RedirectURI: "https://x.test/cb"})
		return err
	})
	wantOAuth(t, err, "invalid_grant")
	if n := w.countRows(t, `SELECT count(*) FROM mcp_tokens WHERE organization_id = $1`, w.org.ID); n != 2 {
		t.Fatalf("token rows = %d, want only the first session's pair: a pair was minted for a revoked grant", n)
	}
}

func TestMcpRefreshWaitsForGrantRevokeInFlight(t *testing.T) {
	w := newMcpWorld(t)
	c, pair := w.issue(t)
	revoke := w.grantRevokeInFlight(t)

	err := w.raceAfterLock(t, revoke, func() error {
		_, err := w.svc.Refresh(w.ctx, McpRefreshInput{ClientID: c.ClientID, RefreshToken: pair.RefreshToken})
		return err
	})
	wantOAuth(t, err, "invalid_grant")
	if n := w.countRows(t, `SELECT count(*) FROM mcp_tokens WHERE organization_id = $1`, w.org.ID); n != 2 {
		t.Fatalf("token rows = %d, want 2: a pair was minted for a revoked grant", n)
	}
}

// mcpFaultDB fails every query whose SQL contains match, as a broken database
// would; everything else reaches the real one.
type mcpFaultDB struct {
	db.DBTX
	match string
	err   error
}

func (f mcpFaultDB) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	if strings.Contains(sql, f.match) {
		return mcpErrRow{f.err}
	}
	return f.DBTX.QueryRow(ctx, sql, args...)
}

type mcpErrRow struct{ err error }

func (r mcpErrRow) Scan(...any) error { return r.err }

// Only "no such row" is a quiet answer; a database fault is the server's, so
// it surfaces unchanged and the code stays valid.
func TestMcpCodeReplayPropagatesDatabaseErrors(t *testing.T) {
	w := newMcpWorld(t)
	w.enable(t)
	c := w.publicClient(t, "https://x.test/cb")
	code := w.approve(t, c, "https://x.test/cb")
	in := McpExchangeInput{ClientID: c.ClientID, Code: code, CodeVerifier: mcpTestVerifier, RedirectURI: "https://x.test/cb"}
	if _, err := w.svc.Exchange(w.ctx, in); err != nil {
		t.Fatal(err)
	}
	boom := errors.New("database is down")
	w.svc.q = db.New(mcpFaultDB{DBTX: w.pool, match: "-- name: GetMcpAuthAttemptByCodeDigest", err: boom})

	_, err := w.svc.Exchange(w.ctx, in)
	var oe OAuthError
	if errors.As(err, &oe) || !errors.Is(err, boom) {
		t.Fatalf("err = %v, want the database error, not an OAuth answer", err)
	}
	if n := w.liveTokens(t); n != 2 {
		t.Fatalf("a database fault changed the family: live = %d", n)
	}
}

// serviceWithLockTimeout is a second service on a pool whose sessions give up
// on a lock after 300ms, so a held lock reads as a database error.
func (w *mcpWorld) serviceWithLockTimeout(t *testing.T) *McpAuthService {
	t.Helper()
	cfg := w.pool.Config()
	params := map[string]string{}
	for k, v := range cfg.ConnConfig.RuntimeParams {
		params[k] = v
	}
	params["lock_timeout"] = "300"
	cfg.ConnConfig.RuntimeParams = params
	pool, err := pgxpool.NewWithConfig(w.ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	svc := NewMcpAuthService(pool, db.New(pool), w.orgs, config.Config{APIPublicURL: mcpTestAPI + "/", FrontendOrigin: "https://app.example.test"})
	svc.SetFlags(mcpFlags(true))
	return svc
}

func TestMcpRevokeTokenPropagatesDatabaseErrors(t *testing.T) {
	w := newMcpWorld(t)
	c, pair := w.issue(t)
	short := w.serviceWithLockTimeout(t)
	holder, _ := w.grantTx(t)
	defer func() { _ = holder.Rollback(w.ctx) }()

	err := short.RevokeToken(w.ctx, c.ClientID, "", pair.RefreshToken)
	var pe *pgconn.PgError
	if !errors.As(err, &pe) || pe.Code != "55P03" {
		t.Fatalf("err = %v, want the lock timeout propagated, not a quiet success", err)
	}
	if n := w.liveTokens(t); n != 2 {
		t.Fatalf("a failed revoke changed the family: live = %d", n)
	}
}
