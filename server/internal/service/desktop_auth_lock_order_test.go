package service

import (
	"context"
	"errors"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
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

// Revoking every session but the caller's takes the same locks in the same
// order as RevokeAll (revokeOtherUserSessions), so it races a device logout
// without a deadlock either. The kept session here is a browser session
// that does not exist, so everything else ends.
func TestDesktopConcurrentRevokeOthersAndLogoutNeverDeadlock(t *testing.T) {
	ctx := context.Background()
	svc, authSvc := newDesktopTestServices(t)
	for i := range 8 {
		owner, sess := desktopTestSession(t, svc, authSvc, fmt.Sprintf("desktop-others-race-%d@example.com", i))
		start := make(chan struct{})
		var wg sync.WaitGroup
		errs := make([]error, 2)
		wg.Add(2)
		go func() {
			defer wg.Done()
			<-start
			_, errs[0] = authSvc.RevokeOtherSessions(ctx, owner, "web-session-kept")
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
				t.Fatalf("round %d: deadlock between RevokeOtherSessions and Logout: %v", i, err)
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

// The two halves of a user-wide revoke are referenced only by their helper -
// once each, device sessions first - so no caller can take refresh_tokens
// first or leave the device sessions live. There are two such revokes, each
// with its own helper and halves: every session of the user
// (revokeAllUserSessions), and every one but the caller's
// (revokeOtherUserSessions, ADR 0047). The scan is on the syntax tree: any
// identifier with a half's name counts, so a method value
// (f := q.RevokeAllDeviceSessions), a method expression, an alias or a call
// through a struct field escapes no more than a plain call does.
type userWideRevoke struct {
	helper string
	halves [2]string // device sessions first, then refresh tokens
}

var userWideRevokes = []userWideRevoke{
	{helper: "revokeAllUserSessions", halves: [2]string{"RevokeAllDeviceSessions", "RevokeAllRefreshTokensForUser"}},
	{helper: "revokeOtherUserSessions", halves: [2]string{"RevokeOtherDeviceSessions", "RevokeOtherSessionsForUser"}},
}

// userWideRevokeViolations returns one line per reference to a half that sits
// outside its helper, plus any way a helper itself breaks the order.
func userWideRevokeViolations(fset *token.FileSet, file *ast.File) []string {
	var found []string
	for _, rv := range userWideRevokes {
		found = append(found, rv.violations(fset, file)...)
	}
	return found
}

func (rv userWideRevoke) violations(fset *token.FileSet, file *ast.File) []string {
	var found []string
	positions := map[string][]token.Pos{}
	helperDefined := false
	var inspect func(n ast.Node, inHelper bool)
	inspect = func(n ast.Node, inHelper bool) {
		ast.Inspect(n, func(node ast.Node) bool {
			switch node := node.(type) {
			case *ast.FuncDecl:
				if node.Recv == nil && node.Name.Name == rv.helper {
					helperDefined = true
					inspect(node.Body, true)
					return false
				}
			case *ast.Ident:
				for _, half := range rv.halves {
					if node.Name != half {
						continue
					}
					if inHelper {
						positions[half] = append(positions[half], node.Pos())
					} else {
						found = append(found, fset.Position(node.Pos()).String()+": "+half+" referenced outside "+rv.helper)
					}
				}
			}
			return true
		})
	}
	inspect(file, false)
	// Keyed on the helper being defined here, not on a half being seen: a helper that
	// references neither half is as broken as one that references only one.
	if helperDefined {
		for _, half := range rv.halves {
			if len(positions[half]) != 1 {
				found = append(found, fmt.Sprintf("%s: %s referenced %d times in %s; want once", fset.Position(file.Pos()).Filename, half, len(positions[half]), rv.helper))
			}
		}
		devices, tokens := positions[rv.halves[0]], positions[rv.halves[1]]
		if len(devices) == 1 && len(tokens) == 1 && devices[0] > tokens[0] {
			found = append(found, rv.helper+" takes refresh_tokens before the device session rows")
		}
	}
	return found
}

func TestUserWideRevokeGoesThroughOneHelper(t *testing.T) {
	root := filepath.Join("..", "..") // server/; the generated queries (pkg/db) define the halves
	helpers := map[string]int{}
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if filepath.ToSlash(path) == "../../pkg/db" {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		fset := token.NewFileSet()
		file, err := parser.ParseFile(fset, path, nil, parser.SkipObjectResolution)
		if err != nil {
			return err
		}
		for _, line := range userWideRevokeViolations(fset, file) {
			t.Errorf("%s; a user-wide revoke goes through its helper", line)
		}
		for _, decl := range file.Decls {
			if fn, ok := decl.(*ast.FuncDecl); ok && fn.Recv == nil {
				helpers[fn.Name.Name]++
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, rv := range userWideRevokes {
		if helpers[rv.helper] != 1 {
			t.Errorf("found %d definitions of %s; want exactly 1", helpers[rv.helper], rv.helper)
		}
	}
}

// The guard itself: calls, method values, aliases and method expressions of a
// half outside its helper are all reported, and each helper's order is
// checked; one helper's halves inside the other's helper count as outside.
func TestUserWideRevokeGuardSeesMethodValuesAndAliases(t *testing.T) {
	check := func(src string) []string {
		fset := token.NewFileSet()
		file, err := parser.ParseFile(fset, "x.go", "package x;"+src, parser.SkipObjectResolution)
		if err != nil {
			t.Fatal(err)
		}
		return userWideRevokeViolations(fset, file)
	}
	all := `func revokeAllUserSessions(q *Q) { _ = q.RevokeAllDeviceSessions(); _ = q.RevokeAllRefreshTokensForUser() }`
	others := `func revokeOtherUserSessions(q *Q) { _ = q.RevokeOtherDeviceSessions(); _ = q.RevokeOtherSessionsForUser() }`
	clean := all + "; " + others
	if got := check(clean); len(got) != 0 {
		t.Fatalf("the helpers alone must pass, got %v", got)
	}
	for name, src := range map[string]string{
		"call":                 clean + `; func f(q *Q) { _ = q.RevokeAllRefreshTokensForUser() }`,
		"method value":         clean + `; func f(q *Q) { g := q.RevokeAllDeviceSessions; _ = g }`,
		"alias var":            clean + `; var alias = (*Q).RevokeAllRefreshTokensForUser`,
		"passed as a value":    clean + `; func f(q *Q) { run(q.RevokeAllDeviceSessions) }`,
		"helper order":         others + `; func revokeAllUserSessions(q *Q) { _ = q.RevokeAllRefreshTokensForUser(); _ = q.RevokeAllDeviceSessions() }`,
		"helper twice":         others + `; func revokeAllUserSessions(q *Q) { _ = q.RevokeAllDeviceSessions(); _ = q.RevokeAllDeviceSessions(); _ = q.RevokeAllRefreshTokensForUser() }`,
		"helper missing one":   others + `; func revokeAllUserSessions(q *Q) { _ = q.RevokeAllDeviceSessions() }`,
		"helper missing both":  others + `; func revokeAllUserSessions(q *Q) {}`,
		"others call":          clean + `; func f(q *Q) { _ = q.RevokeOtherSessionsForUser() }`,
		"others method value":  clean + `; func f(q *Q) { g := q.RevokeOtherDeviceSessions; _ = g }`,
		"others order":         all + `; func revokeOtherUserSessions(q *Q) { _ = q.RevokeOtherSessionsForUser(); _ = q.RevokeOtherDeviceSessions() }`,
		"others missing one":   all + `; func revokeOtherUserSessions(q *Q) { _ = q.RevokeOtherDeviceSessions() }`,
		"all's half in others": all + `; func revokeOtherUserSessions(q *Q) { _ = q.RevokeOtherDeviceSessions(); _ = q.RevokeOtherSessionsForUser(); _ = q.RevokeAllRefreshTokensForUser() }`,
		"others' half in all":  others + `; func revokeAllUserSessions(q *Q) { _ = q.RevokeAllDeviceSessions(); _ = q.RevokeAllRefreshTokensForUser(); _ = q.RevokeOtherSessionsForUser() }`,
	} {
		if got := check(src); len(got) == 0 {
			t.Errorf("%s: the guard let it through", name)
		}
	}
}
