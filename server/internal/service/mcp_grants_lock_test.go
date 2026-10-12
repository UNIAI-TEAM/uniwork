package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Revoking a person's grants (Leave, DeleteAccount) follows the lock order of
// mcp_tokens.go: grant rows first, token rows after. A raw transaction stands
// for an Exchange or a Refresh that is half way through, the revocation starts
// against it and waits, and only then does the raw transaction go on and
// commit. Two things can go wrong with the other order (tokens first, grants
// after): the revocation misses the pair the request in flight inserted, and a
// Refresh that takes its token row while the revocation holds it deadlocks.

// insertLivePair is the tail of a mint: a live access and refresh token for
// grant, in the family, inside q's transaction.
func (w *mcpWorld) insertLivePair(t *testing.T, q *db.Queries, grant db.McpGrant, familyID string) {
	t.Helper()
	for _, kind := range []string{"access", "refresh"} {
		raw, err := randomToken(32)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := q.CreateMcpToken(w.ctx, db.CreateMcpTokenParams{
			ID: util.NewID(), OrganizationID: grant.OrganizationID, GrantID: grant.ID, FamilyID: familyID,
			Kind: kind, Digest: digest("in-flight-" + raw), ExpiresAt: mcpTime(time.Now().Add(time.Hour)),
		}); err != nil {
			t.Fatal(err)
		}
	}
}

// mintInFlight stands for an Exchange that has locked the grant and inserted a
// new session's pair, uncommitted.
func (w *mcpWorld) mintInFlight(t *testing.T) pgx.Tx {
	t.Helper()
	tx, grant := w.grantTx(t)
	w.insertLivePair(t, w.q.WithTx(tx), grant, util.NewID())
	return tx
}

// inTx runs f in a transaction of its own and commits it, as Leave and
// DeleteAccount run the helpers.
func (w *mcpWorld) inTx(f func(q *db.Queries) error) error {
	tx, err := w.pool.Begin(w.ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(w.ctx)
	if err := f(w.q.WithTx(tx)); err != nil {
		return err
	}
	return tx.Commit(w.ctx)
}

// inFlight is a request half way through a change: the open transaction, and
// the step it takes once the revocation is queued behind it (nil: none).
type inFlight struct {
	tx     pgx.Tx
	finish func()
}

// raceWith starts op, waits for it to block on the lock the request in flight
// holds, lets that request finish its change, commits it and returns what op
// answered.
func (w *mcpWorld) raceWith(t *testing.T, f inFlight, op func() error) error {
	t.Helper()
	done := inBackground(op)
	if !w.waitForLockWait(t) {
		t.Errorf("the revocation never waited on the request in flight: it ran past a change it could not see")
	}
	if f.finish != nil {
		f.finish()
	}
	if err := f.tx.Commit(w.ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		return err
	case <-time.After(10 * time.Second):
		t.Fatal("the revocation did not finish after the request in flight committed")
		return nil
	}
}

func isDeadlock(err error) bool {
	var pe *pgconn.PgError
	return errors.As(err, &pe) && pe.Code == "40P01"
}

func TestMcpGrantRevocationWaitsForRequestsInFlight(t *testing.T) {
	scenarios := map[string]func(t *testing.T, w *mcpWorld, pair McpTokenPair) inFlight{
		// A Refresh that locked the grant and the token row and inserted the next pair.
		"refresh in flight": func(t *testing.T, w *mcpWorld, pair McpTokenPair) inFlight {
			return inFlight{tx: w.rotationInFlight(t, pair)}
		},
		// An Exchange that locked the grant and inserted a new session's pair.
		"exchange in flight": func(t *testing.T, w *mcpWorld, _ McpTokenPair) inFlight {
			return inFlight{tx: w.mintInFlight(t)}
		},
		// A Refresh that has the grant and reaches for its token row only after
		// the revocation is queued. A revocation that already holds token rows
		// while it waits for the grant makes the two wait on each other.
		"refresh takes its token after the revocation queued": func(t *testing.T, w *mcpWorld, pair McpTokenPair) inFlight {
			tx, grant := w.grantTx(t)
			return inFlight{tx: tx, finish: func() {
				lockCtx, cancel := context.WithTimeout(w.ctx, 8*time.Second)
				defer cancel()
				q := w.q.WithTx(tx)
				tok, err := q.GetMcpTokenByDigestForUpdate(lockCtx, digest(pair.RefreshToken))
				if isDeadlock(err) {
					t.Fatalf("deadlock: the revocation took token rows before the grant row: %v", err)
				}
				if err != nil {
					t.Fatal(err)
				}
				w.insertLivePair(t, q, grant, tok.FamilyID)
			}}
		},
	}
	operations := map[string]func(w *mcpWorld, member db.User) error{
		"Leave": func(w *mcpWorld, member db.User) error {
			return NewOrganizationMemberService(w.pool, w.q, w.orgs).Leave(w.ctx, member.ID, w.org.ID)
		},
		"revokeMcpGrantsForUserInOrg": func(w *mcpWorld, member db.User) error {
			return w.inTx(func(q *db.Queries) error { return revokeMcpGrantsForUserInOrg(w.ctx, q, w.org.ID, member.ID) })
		},
		"revokeAllMcpGrantsForUser": func(w *mcpWorld, member db.User) error {
			return w.inTx(func(q *db.Queries) error { return revokeAllMcpGrantsForUser(w.ctx, q, member.ID) })
		},
	}
	for opName, op := range operations {
		for scnName, scn := range scenarios {
			t.Run(opName+"/"+scnName, func(t *testing.T) {
				w := newMcpWorld(t)
				member := registerVerified(t, w.q, w.auth, "mcp-race@example.com", "Racer")
				addOrgMember(t, w.q, w.org.ID, member.ID)
				_, pair := w.issueAs(t, member)
				flight := scn(t, w, pair)

				err := w.raceWith(t, flight, func() error { return op(w, member) })
				if err != nil {
					t.Fatalf("revocation: %v (a deadlock victim reads as 40P01: %v)", err, isDeadlock(err))
				}
				if n := w.liveTokensOf(t, member.ID); n != 0 {
					t.Fatalf("live tokens = %d: the pair the request in flight inserted survived the revocation", n)
				}
				if n := w.countRows(t, `SELECT count(*) FROM mcp_grants WHERE user_id = $1 AND revoked_at IS NULL`, member.ID); n != 0 {
					t.Fatalf("live grants = %d", n)
				}
			})
		}
	}
}

// One person, two grants in one organization (two clients): both close with
// all their tokens, and a concurrent revocation of the same person from the
// other side (Leave and DeleteAccount can overlap) finishes without a deadlock.
func TestMcpGrantRevocationClosesEveryGrantOfThePerson(t *testing.T) {
	w := newMcpWorld(t)
	member := registerVerified(t, w.q, w.auth, "mcp-two@example.com", "Two Grants")
	addOrgMember(t, w.q, w.org.ID, member.ID)
	_, _ = w.issueAs(t, member)
	_, _ = w.issueAs(t, member)
	if n := w.liveTokensOf(t, member.ID); n != 4 {
		t.Fatalf("setup: live tokens = %d, want 4", n)
	}

	errs := make(chan error, 2)
	go func() {
		errs <- w.inTx(func(q *db.Queries) error { return revokeMcpGrantsForUserInOrg(w.ctx, q, w.org.ID, member.ID) })
	}()
	go func() {
		errs <- w.inTx(func(q *db.Queries) error { return revokeAllMcpGrantsForUser(w.ctx, q, member.ID) })
	}()
	for range 2 {
		if err := <-errs; err != nil {
			t.Fatalf("overlapping revocations: %v (deadlock: %v)", err, isDeadlock(err))
		}
	}
	if n := w.liveTokensOf(t, member.ID); n != 0 {
		t.Fatalf("live tokens = %d", n)
	}
	if n := w.countRows(t, `SELECT count(*) FROM mcp_grants WHERE user_id = $1 AND revoked_at IS NULL`, member.ID); n != 0 {
		t.Fatalf("live grants = %d", n)
	}
}

// An admin switching the connector on while another admin's switch-on is in
// flight records nothing: SetPolicy reads the value it changes under the row
// lock, so it sees the other change once that commits and has none left to make.
func TestMcpSetPolicyWaitsForAChangeInFlight(t *testing.T) {
	w := newMcpWorld(t)
	tx, err := w.pool.Begin(w.ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tx.Rollback(context.Background()) })
	if _, err := w.q.WithTx(tx).SetOrganizationMcpPolicy(w.ctx, db.SetOrganizationMcpPolicyParams{ID: w.org.ID, Enabled: true, ActorID: w.owner.ID}); err != nil {
		t.Fatal(err)
	}

	err = w.raceAfterLock(t, tx, func() error { _, err := w.svc.SetPolicy(w.ctx, w.owner.ID, w.org.ID, true); return err })
	if err != nil {
		t.Fatal(err)
	}
	if n := auditCount(t, w, audit.ActionOrganizationMcpPolicyChanged); n != 0 {
		t.Fatalf("policy audit rows = %d, want 0: the switch was already on when SetPolicy took its turn, yet it recorded a change", n)
	}
}

// Revoking a grant that is being revoked elsewhere (the person and an admin,
// a double click) closes it once: the second request waits on the grant row,
// finds it revoked and answers success without a second audit row.
func TestMcpRevokeWaitsForARevocationInFlight(t *testing.T) {
	w := newMcpWorld(t)
	_, _ = w.issue(t)
	grants, err := w.svc.ListMyGrants(w.ctx, w.owner.ID)
	if err != nil || len(grants) != 1 {
		t.Fatalf("grants = %+v, %v", grants, err)
	}
	revoke := w.grantRevokeInFlight(t)

	err = w.raceAfterLock(t, revoke, func() error { return w.svc.RevokeMyGrant(w.ctx, w.owner.ID, grants[0].ID) })
	if err != nil {
		t.Fatal(err)
	}
	if n := auditCount(t, w, audit.ActionMcpGrantRevoked); n != 0 {
		t.Fatalf("revoked audit rows = %d, want 0: the grant was already revoked when this request took its turn", n)
	}
}
