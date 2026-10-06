package service

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// RB-3: a user-wide revoke (RevokeAll, account deletion, password reset,
// member deactivation) and a device logout of the same user take their locks
// in one order - device_sessions rows, then the family key, then
// refresh_tokens - so neither can be chosen as a deadlock victim (40P01).
// The test plays the logout by hand up to the point where it holds its device
// row and the family key, starts the real RevokeAll, waits (from a connection
// of its own) until RevokeAll is blocked, then lets the logout touch
// refresh_tokens and commit. With refresh_tokens taken first by RevokeAll the
// two would wait on each other.
func TestDesktopUserWideRevokeAndLogoutTakeLocksInOneOrder(t *testing.T) {
	ctx := context.Background()
	svc, authSvc := newDesktopTestServices(t)
	owner, sess := desktopTestSession(t, svc, authSvc, "desktop-lock-order@example.com")

	watch, err := pgx.ConnectConfig(ctx, svc.pool.Config().ConnConfig.Copy())
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = watch.Close(ctx) }()

	tx, err := svc.pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := svc.q.WithTx(tx)
	if _, err := q.GetDeviceSessionForUpdate(ctx, sess.DeviceSessionID); err != nil {
		t.Fatal(err)
	}
	if err := q.LockDeviceSessionFamily(ctx, sess.SessionID); err != nil {
		t.Fatal(err)
	}
	var logoutPID uint32
	if err := tx.QueryRow(ctx, `SELECT pg_backend_pid()`).Scan(&logoutPID); err != nil {
		t.Fatal(err)
	}

	done := make(chan error, 1)
	go func() { done <- svc.RevokeAll(ctx, owner) }()
	waitForDesktopLockWaiter(t, watch, logoutPID, done)

	if _, err := q.RevokeDeviceSession(ctx, db.RevokeDeviceSessionParams{ID: sess.DeviceSessionID, UserID: owner}); err != nil {
		t.Fatalf("logout revoke: %v", err)
	}
	if _, err := closeOrphanFamilyTokens(ctx, q, owner, sess.SessionID); err != nil {
		t.Fatalf("logout closing the family token: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("logout commit: %v", err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("RevokeAll: %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("RevokeAll did not finish after the logout committed")
	}
	assertUserFullyRevoked(t, svc, owner)
}

// The same pair through the real entry points, started together many times:
// whichever wins, neither fails and nothing is left live.
func TestDesktopConcurrentRevokeAllAndLogoutNeverDeadlock(t *testing.T) {
	ctx := context.Background()
	svc, authSvc := newDesktopTestServices(t)
	for i := range 8 {
		owner, sess := desktopTestSession(t, svc, authSvc, fmt.Sprintf("desktop-lock-race-%d@example.com", i))
		start := make(chan struct{})
		var wg sync.WaitGroup
		errs := make([]error, 2)
		wg.Add(2)
		go func() {
			defer wg.Done()
			<-start
			errs[0] = svc.RevokeAll(ctx, owner)
		}()
		go func() {
			defer wg.Done()
			<-start
			errs[1] = svc.Logout(ctx, owner, sess.DeviceSessionID, "default", "device")
		}()
		close(start)
		wg.Wait()
		for j, err := range errs {
			if err == nil || (j == 1 && errors.Is(err, ErrDesktopDeviceRevoked)) {
				continue
			}
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "40P01" {
				t.Fatalf("round %d: deadlock between RevokeAll and Logout: %v", i, err)
			}
			t.Fatalf("round %d call %d: %v", i, j, err)
		}
		assertUserFullyRevoked(t, svc, owner)
	}
}

// waitForDesktopLockWaiter returns once some backend other than holder (and this
// watcher) is blocked on a lock, or fails if the call under test returned
// first: it must queue behind the logout, not run past it.
func waitForDesktopLockWaiter(t *testing.T, watch *pgx.Conn, holder uint32, done <-chan error) {
	t.Helper()
	ctx := context.Background()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		select {
		case err := <-done:
			t.Fatalf("RevokeAll finished (%v) while the logout held the device row", err)
		default:
		}
		var n int
		if err := watch.QueryRow(ctx, `SELECT count(*) FROM pg_stat_activity
			WHERE datname = current_database() AND wait_event_type = 'Lock'
			  AND pid <> pg_backend_pid() AND pid <> $1`, holder).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if n > 0 {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("RevokeAll never blocked behind the logout")
}

func assertUserFullyRevoked(t *testing.T, svc *DesktopAuthService, owner string) {
	t.Helper()
	ctx := context.Background()
	var liveDevices, liveTokens int
	if err := svc.pool.QueryRow(ctx, `SELECT
		(SELECT count(*) FROM device_sessions WHERE user_id = $1 AND revoked_at IS NULL),
		(SELECT count(*) FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL)`, owner).Scan(&liveDevices, &liveTokens); err != nil {
		t.Fatal(err)
	}
	if liveDevices != 0 || liveTokens != 0 {
		t.Fatalf("after the revoke: %d live device sessions, %d live refresh tokens; want 0 and 0", liveDevices, liveTokens)
	}
}

// The two halves of a user-wide revoke are called only by
// revokeAllUserSessions, so no caller can take refresh_tokens first or leave
// the device sessions live.
func TestUserWideRevokeGoesThroughOneHelper(t *testing.T) {
	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range files {
		if strings.HasSuffix(f, "_test.go") {
			continue
		}
		src, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		for _, call := range []string{".RevokeAllRefreshTokensForUser(", ".RevokeAllDeviceSessions("} {
			if n := strings.Count(string(src), call); n > 0 && (f != "desktop_auth.go" || n != 1) {
				t.Errorf("%s calls %s %d time(s); a user-wide revoke goes through revokeAllUserSessions", f, call, n)
			}
		}
	}
}
