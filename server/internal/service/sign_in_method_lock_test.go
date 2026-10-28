package service

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// inFlight opens a transaction that holds uid's row lock and has made change
// in it, uncommitted: a reclaim or a credential change on its way.
func (f *identityFixture) inFlight(t *testing.T, uid string, change func(q *db.Queries) error) pgx.Tx {
	t.Helper()
	tx, err := f.pool.Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tx.Rollback(context.Background()) })
	q := f.q.WithTx(tx)
	if _, err := q.GetUserForUpdate(f.ctx, uid); err != nil {
		t.Fatal(err)
	}
	if err := change(q); err != nil {
		t.Fatal(err)
	}
	return tx
}

// afterTheLock starts op, waits for it to queue on a row the transaction in
// flight holds, commits that transaction and answers what op did once it got
// the row.
func (f *identityFixture) afterTheLock(t *testing.T, open pgx.Tx, op func() error) error {
	t.Helper()
	done := inBackground(op)
	waited := false
	for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline) && !waited; time.Sleep(20 * time.Millisecond) {
		// A row lock wait (other packages queue on an advisory lock).
		waited = f.count(t, `SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()
			AND wait_event_type = 'Lock' AND wait_event IN ('transactionid', 'tuple')`) > 0
	}
	if !waited {
		t.Error("the command never queued on the account's row lock: it ran past a change it could not see")
	}
	if err := open.Commit(f.ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		return err
	case <-time.After(10 * time.Second):
		t.Fatal("the command did not finish after the change in flight committed")
		return nil
	}
}

// A sign-in method command judges its bearer under the account's row lock
// (ADR 0049 §2, §5): a reclaim, a password change or an unlink takes that lock
// first and commits its revocations under it, so a command that passed its
// gates while one was on its way must not then write into the account it
// left behind. The squatter's ticket link and password, and a stolen
// session's unlink and second factor, are 401 invalid_token once the change
// they queued behind commits, and write nothing.
func TestSignInMethodCommandsJudgeTheBearerUnderTheLock(t *testing.T) {
	t.Run("a ticket link while a reclaim commits", func(t *testing.T) {
		f := newIdentityFixture(t)
		reg, err := f.auth.Register(f.ctx, "race-link@gmail.com", "squatter-pass", "Kẻ chiếm", "vi")
		if err != nil {
			t.Fatal(err)
		}
		ticket := f.googleTicket(t, GoogleClaims{Sub: "g-race-squatter", Email: "race.squatter@outlook.com", EmailVerified: true}, TicketKindUnmatched)
		sess, err := f.auth.Login(f.ctx, "race-link@gmail.com", "squatter-pass")
		if err != nil {
			t.Fatal(err)
		}
		bearer := f.bearer(t, sess)
		if _, err := f.tickets().Link(bearer, ticket, WebTicket(), TicketLink{}); !errors.Is(err, ErrEmailUnverified) {
			t.Fatalf("the squatter's account takes no link: %v", err)
		}
		open := f.inFlight(t, reg.User.ID, func(q *db.Queries) error { _, err := reclaimMailbox(f.ctx, q, reg.User.ID); return err })
		err = f.afterTheLock(t, open, func() error {
			_, err := f.tickets().Link(bearer, ticket, WebTicket(), TicketLink{})
			return err
		})
		wantStatusCode(t, err, "invalid_token", http.StatusUnauthorized)
		if u := f.user(t, reg.User.ID); u.GoogleID.Valid {
			t.Fatalf("the squatter's Google joined the reclaimed account: %+v", u)
		}
	})

	t.Run("a password set while a reclaim commits", func(t *testing.T) {
		f := newIdentityFixture(t)
		reg, err := f.auth.Register(f.ctx, "race-password@gmail.com", "squatter-pass", "Kẻ chiếm", "vi")
		if err != nil {
			t.Fatal(err)
		}
		bearer := f.bearer(t, reg)
		g, err := f.auth.StepUp(bearer, reg.User.ID, StepUpProof{Password: "squatter-pass"})
		if err != nil {
			t.Fatal(err)
		}
		open := f.inFlight(t, reg.User.ID, func(q *db.Queries) error { _, err := reclaimMailbox(f.ctx, q, reg.User.ID); return err })
		err = f.afterTheLock(t, open, func() error {
			_, err := NewSignInMethodsService(f.pool, f.q, f.auth).SetPassword(bearer, reg.User.ID, PasswordInput{New: "squatters-new-pass", StepUpToken: g.Token})
			return err
		})
		wantStatusCode(t, err, "invalid_token", http.StatusUnauthorized)
		if u := f.user(t, reg.User.ID); u.PasswordHash.Valid {
			t.Fatal("the squatter set a password on the reclaimed account")
		}
	})

	// A stolen session with a step-up token of its own, while the owner
	// changes the password from theirs.
	ownerChanges := func(t *testing.T, f *identityFixture, uid string) (thief context.Context, grant string, change func(q *db.Queries) error) {
		t.Helper()
		owner, _ := f.browser(t, uid)
		thief, _ = f.browser(t, uid)
		g, err := f.auth.StepUp(thief, uid, StepUpProof{Password: "password123"})
		if err != nil {
			t.Fatal(err)
		}
		return thief, g.Token, func(q *db.Queries) error {
			_, err := signOthersOut(owner, q, uid, "password_changed")
			return err
		}
	}

	t.Run("an unlink while the owner changes the password", func(t *testing.T) {
		f := newIdentityFixture(t)
		u := registerVerified(t, f.q, f.auth, "race-unlink@gmail.com", "Chủ")
		if _, err := linkIdentity(f.ctx, f.q, u.ID, ProviderIdentity{Provider: ProviderGoogle, Subject: "g-race-owner", Email: "race-unlink@gmail.com"}); err != nil {
			t.Fatal(err)
		}
		thief, grant, change := ownerChanges(t, f, u.ID)
		err := f.afterTheLock(t, f.inFlight(t, u.ID, change), func() error {
			_, err := NewSignInMethodsService(f.pool, f.q, f.auth).Unlink(thief, u.ID, ProviderGoogle, grant)
			return err
		})
		wantStatusCode(t, err, "invalid_token", http.StatusUnauthorized)
		if !f.user(t, u.ID).GoogleID.Valid {
			t.Fatal("the stolen session unlinked the owner's Google")
		}
	})

	t.Run("a second factor turned on while the owner changes the password", func(t *testing.T) {
		f := newIdentityFixture(t)
		u := registerVerified(t, f.q, f.auth, "race-mfa@example.com", "Chủ")
		thief, grant, change := ownerChanges(t, f, u.ID)
		setup, err := f.auth.SetupTOTP(thief, u.ID, grant)
		if err != nil {
			t.Fatal(err)
		}
		err = f.afterTheLock(t, f.inFlight(t, u.ID, change), func() error {
			_, err := f.auth.ConfirmTOTP(thief, u.ID, totpNow(t, setup.Secret), grant)
			return err
		})
		wantStatusCode(t, err, "invalid_token", http.StatusUnauthorized)
		if f.user(t, u.ID).MfaEnabledAt.Valid {
			t.Fatal("the stolen session locked the owner out behind its own second factor")
		}
	})
}

// A session is never born into an account a revocation is ending (ADR 0049
// §2, §5): opening one holds the account's row FOR SHARE, which a reclaim (or
// a password change, a reset, an unlink) takes FOR UPDATE before it revokes.
// A squatter's browser refresh and password sign-in, on the web or in the
// app, that run while the owner's reclaim commits are invalid_credentials,
// and leave no live session behind. A desktop code exchange that issued its
// device session first already holds the account's row (its refresh token
// row references it), so the reclaim waits for it and ends that session with
// the rest; the last case keeps it so.
func TestSessionsOpenedDuringARevocationDoNotOutliveIt(t *testing.T) {
	squat := func(t *testing.T, f *identityFixture, email string) Session {
		t.Helper()
		reg, err := f.auth.Register(f.ctx, email, "squatter-pass", "Kẻ chiếm", "vi")
		if err != nil {
			t.Fatal(err)
		}
		return reg
	}
	reclaim := func(f *identityFixture, uid string) func(q *db.Queries) error {
		return func(q *db.Queries) error { _, err := reclaimMailbox(f.ctx, q, uid); return err }
	}
	liveSessions := func(t *testing.T, f *identityFixture, uid string) int {
		t.Helper()
		return f.count(t, `SELECT count(*) FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL`, uid) +
			f.count(t, `SELECT count(*) FROM device_sessions WHERE user_id = $1 AND revoked_at IS NULL`, uid)
	}

	t.Run("a browser refresh", func(t *testing.T) {
		f := newIdentityFixture(t)
		reg := squat(t, f, "race-refresh@gmail.com")
		err := f.afterTheLock(t, f.inFlight(t, reg.User.ID, reclaim(f, reg.User.ID)), func() error {
			_, err := f.auth.Refresh(f.ctx, reg.RefreshToken)
			return err
		})
		if !errors.Is(err, ErrInvalidCredentials) {
			t.Fatalf("a refresh racing the reclaim: %v", err)
		}
		if n := liveSessions(t, f, reg.User.ID); n != 0 {
			t.Fatalf("%d sessions outlived the reclaim", n)
		}
	})

	t.Run("a password sign-in", func(t *testing.T) {
		f := newIdentityFixture(t)
		reg := squat(t, f, "race-login@gmail.com")
		err := f.afterTheLock(t, f.inFlight(t, reg.User.ID, reclaim(f, reg.User.ID)), func() error {
			_, err := f.auth.Login(f.ctx, "race-login@gmail.com", "squatter-pass")
			return err
		})
		if !errors.Is(err, ErrInvalidCredentials) {
			t.Fatalf("a sign-in racing the reclaim: %v", err)
		}
		if n := liveSessions(t, f, reg.User.ID); n != 0 {
			t.Fatalf("%d sessions outlived the reclaim", n)
		}
	})

	t.Run("the app's password sign-in", func(t *testing.T) {
		f := newIdentityFixture(t)
		reg := squat(t, f, "race-app@gmail.com")
		doors := NewNativeSignInService(f.pool, f.q, f.auth, f.desktop, f.tickets())
		err := f.afterTheLock(t, f.inFlight(t, reg.User.ID, reclaim(f, reg.User.ID)), func() error {
			_, err := doors.Password(f.ctx, "race-app@gmail.com", "squatter-pass", app)
			return err
		})
		if !errors.Is(err, ErrInvalidCredentials) {
			t.Fatalf("the app's sign-in racing the reclaim: %v", err)
		}
		if n := liveSessions(t, f, reg.User.ID); n != 0 {
			t.Fatalf("%d sessions outlived the reclaim", n)
		}
	})

	t.Run("a desktop code exchange", func(t *testing.T) {
		f := newIdentityFixture(t)
		reg := squat(t, f, "race-exchange@gmail.com")
		code, err := f.approveFrom(t, f.ctx, reg.User.ID, "exchange")
		if err != nil {
			t.Fatal(err)
		}
		// The exchange in flight: its consent redeemed and its device
		// session issued, uncommitted.
		exchange, err := f.pool.Begin(f.ctx)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = exchange.Rollback(context.Background()) })
		if _, err := exchange.Exec(f.ctx, `UPDATE desktop_auth_attempts SET used_at = now() WHERE code_digest = $1`, digest(code)); err != nil {
			t.Fatal(err)
		}
		d, err := f.desktop.issueDeviceSession(f.ctx, f.q.WithTx(exchange), reg.User.ID, nativeDevice{ClientID: "uniwork-office", DeploymentID: "default", Label: "Laptop", Platform: "windows", Build: "1.0"})
		if err != nil {
			t.Fatal(err)
		}
		err = f.afterTheLock(t, exchange, func() error {
			res, err := f.google.SignIn(f.ctx, GoogleClaims{Sub: "g-race-exchange", Email: "race-exchange@gmail.com", EmailVerified: true}, "vi", SignInIntentSignIn)
			if err == nil && !res.Reclaimed {
				t.Errorf("the owner's sign-in reclaimed nothing: %+v", res)
			}
			return err
		})
		if err != nil {
			t.Fatal(err)
		}
		if f.live(t, "device_sessions", d.DeviceSessionID) {
			t.Fatal("the device session an exchange opened while the reclaim ran outlived it")
		}
	})
}
