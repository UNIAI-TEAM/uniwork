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

// afterTheLock starts op, waits for it to queue on the account row the
// transaction in flight holds, commits that transaction and answers what op
// did once it got the row.
func (f *identityFixture) afterTheLock(t *testing.T, open pgx.Tx, op func() error) error {
	t.Helper()
	done := inBackground(op)
	waited := false
	for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline) && !waited; time.Sleep(20 * time.Millisecond) {
		waited = f.count(t, `SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()
			AND wait_event_type = 'Lock' AND query ILIKE '%users%'`) > 0
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
// (ADR 0047 §2, §5): a reclaim, a password change or an unlink takes that lock
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
