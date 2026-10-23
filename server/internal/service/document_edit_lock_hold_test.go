package service

import (
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// UNI-1645 §3.3/§3.4: the offline hold (R6/R7), edit requests (R8-R10) and
// the races between the commands that move a document's tenure.

func (w *lockWorld) holdDesktop(t *testing.T, u db.User, docID string) (DocumentEditLockView, string) {
	t.Helper()
	sid := w.device(t, u.ID)
	v, err := w.svc.AcquireDocumentEditLock(w.ctx, human(u), docID, AcquireDocumentEditLockInput{EditorID: "desk-" + u.ID, Client: DocumentEditClientDesktop, SessionID: sid})
	if err != nil {
		t.Fatal(err)
	}
	v, err = w.svc.PutDocumentEditHold(w.ctx, human(u), docID, v.Lock.ID, sid)
	if err != nil {
		t.Fatal(err)
	}
	return v, sid
}

func (w *lockWorld) liveCount(t *testing.T, docID string) int {
	t.Helper()
	var n int
	if err := w.env.f.pool.QueryRow(w.ctx, `SELECT count(*) FROM document_edit_locks WHERE document_id = $1 AND ended_at IS NULL`, docID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestEditHoldExpiryFreesTheLockForOthers(t *testing.T) {
	w := newLockWorld(t)
	d := w.page(t)
	held, _ := w.holdDesktop(t, w.tn.member, d.ID)
	// TTL lapses but the hold keeps the tenure.
	w.exec(t, `UPDATE document_edit_locks SET expires_at = now() - interval '1 second' WHERE id = $1`, held.Lock.ID)
	_, err := w.svc.AcquireDocumentEditLock(w.ctx, human(w.tn.aclOwner), d.ID, AcquireDocumentEditLockInput{EditorID: "x", Client: DocumentEditClientWebPage, SessionID: "s"})
	ce := wantCode(t, err, "document_locked")
	if ce.Fields["offline_hold_until"] == nil {
		t.Fatalf("423 without offline_hold_until: %v", ce.Fields)
	}
	w.expire(t, held.Lock.ID)
	w.acquire(t, w.tn.aclOwner, d.ID, "x")
	w.wantEnded(t, held.Lock.ID, "expired")
}

func TestTakeOverDuringOfflineHold(t *testing.T) {
	w := newLockWorld(t)
	d := w.page(t)
	held, _ := w.holdDesktop(t, w.tn.member, d.ID)
	if _, err := w.svc.TakeOverDocumentEditLock(w.ctx, human(w.tn.aclOwner), d.ID, TakeOverDocumentEditLockInput{
		EditorID: "x", Client: DocumentEditClientWebPage, SessionID: "s", ExpectedLockID: held.Lock.ID,
	}); err != nil {
		t.Fatal(err)
	}
	if meta := w.auditMeta(t, audit.ActionDocumentEditLockTakenOver, d.ID); meta["previous_offline_hold"] != true || meta["previous_lock_id"] != held.Lock.ID {
		t.Fatalf("take-over audit %v", meta)
	}
	w.wantEnded(t, held.Lock.ID, "taken_over")
	// The desktop syncs back with its old id: refused, never merged.
	if err := w.patch(t, human(w.tn.member), d.ID, held.Lock.ID); !errors.Is(err, ErrDocumentLocked) {
		t.Fatalf("old id patch: %v", err)
	}
	_, err := w.svc.HeartbeatDocumentEditLock(w.ctx, human(w.tn.member), d.ID, held.Lock.ID)
	ce := wantCode(t, err, "edit_lock_lost")
	if ce.Fields["reason"] != "taken_over" || ce.Fields["by_id"] != w.tn.aclOwner.ID {
		t.Fatalf("lost fields %v", ce.Fields)
	}
}

func TestEditHoldRenewIsCapped(t *testing.T) {
	w := newLockWorld(t)
	d := w.page(t)
	held, sid := w.holdDesktop(t, w.tn.member, d.ID)
	if held.Lock.HoldRenewals != 0 || !held.Lock.HoldChainStartedAt.Valid {
		t.Fatalf("first hold %+v", held.Lock)
	}
	// The chain started 23h ago: the renewal ends at the 24h cap, not now+8h.
	w.exec(t, `UPDATE document_edit_locks SET hold_chain_started_at = now() - interval '23 hours', offline_hold_until = now() + interval '10 minutes' WHERE id = $1`, held.Lock.ID)
	renewed, err := w.svc.PutDocumentEditHold(w.ctx, human(w.tn.member), d.ID, held.Lock.ID, sid)
	if err != nil {
		t.Fatal(err)
	}
	until := renewed.Lock.OfflineHoldUntil.Time
	capEnd := renewed.Lock.HoldChainStartedAt.Time.Add(24 * time.Hour)
	if renewed.Lock.HoldRenewals != 1 || until.After(capEnd) || until.Before(capEnd.Add(-time.Second)) {
		t.Fatalf("renewal until %v, cap %v, renewals %d", until, capEnd, renewed.Lock.HoldRenewals)
	}
	if n := w.countAudit(t, audit.ActionDocumentEditHoldRenewed, d.ID); n != 1 {
		t.Fatalf("renewed rows %d", n)
	}
	// At the cap a renewal cannot extend the hold.
	_, err = w.svc.PutDocumentEditHold(w.ctx, human(w.tn.member), d.ID, held.Lock.ID, sid)
	wantCode(t, err, "edit_hold_cap_reached")
	// Past the cap (chain older than 24h, TTL still live): refused too.
	w.exec(t, `UPDATE document_edit_locks SET hold_chain_started_at = now() - interval '25 hours', offline_hold_until = NULL WHERE id = $1`, held.Lock.ID)
	_, err = w.svc.PutDocumentEditHold(w.ctx, human(w.tn.member), d.ID, held.Lock.ID, sid)
	wantCode(t, err, "edit_hold_cap_reached")
	// A web session is not a hold device.
	_, err = w.svc.PutDocumentEditHold(w.ctx, human(w.tn.member), d.ID, held.Lock.ID, "sid-web")
	wantCode(t, err, "edit_hold_device_required")
	// R7 is idempotent and audits once.
	for range 2 {
		if _, err := w.svc.ClearDocumentEditHold(w.ctx, human(w.tn.member), d.ID, held.Lock.ID); err != nil {
			t.Fatal(err)
		}
	}
}

func TestEditHoldVisibleToOthers(t *testing.T) {
	w := newLockWorld(t)
	d := w.page(t)
	held, _ := w.holdDesktop(t, w.tn.member, d.ID)
	st, err := w.svc.GetDocumentEditLockState(w.ctx, human(w.tn.owner), d.ID)
	if err != nil {
		t.Fatal(err)
	}
	if st.Lock == nil || st.Lock.OfflineHoldUntil == nil || !st.Lock.OfflineHoldUntil.Equal(held.Lock.OfflineHoldUntil.Time) || st.Lock.HolderID != w.tn.member.ID {
		t.Fatalf("state %+v", st.Lock)
	}
	rows, err := w.svc.DocumentEditLockSummaries(w.ctx, human(w.tn.owner), d.OrganizationID, []string{d.ID})
	if err != nil {
		t.Fatal(err)
	}
	if s, ok := rows[d.ID]; !ok || s.OfflineHoldUntil == nil || s.LockID != "" {
		t.Fatalf("list row %+v", rows[d.ID])
	}
}

// The edit hold and the office offline read lease (G5-D1) are independent:
// revoking the lease leaves the hold, ending the hold leaves the lease.
func TestEditHoldIndependentOfOfflineLease(t *testing.T) {
	w := newLockWorld(t)
	d := w.page(t)
	held, sid := w.holdDesktop(t, w.tn.member, d.ID)
	lease := util.NewID()
	w.exec(t, `INSERT INTO office_offline_leases (id, organization_id, workspace_id, document_id, user_id, device_session_id, deployment_id,
		version, revision, level, policy_epoch, issued_at, expires_at, created_by, created_by_kind)
		VALUES ($1, $2, $3, $4, $5, $6, 'default', 1, 1, 'edit', 1, now(), now() + interval '24 hours', $5, 'human')`,
		lease, d.OrganizationID, d.WorkspaceID, d.ID, w.tn.member.ID, sid)
	revoked := func() bool {
		var at pgtype.Timestamptz
		if err := w.env.f.pool.QueryRow(w.ctx, `SELECT revoked_at FROM office_offline_leases WHERE id = $1`, lease).Scan(&at); err != nil {
			t.Fatal(err)
		}
		return at.Valid
	}
	// Ending the hold leaves the lease.
	if _, err := w.svc.ClearDocumentEditHold(w.ctx, human(w.tn.member), d.ID, held.Lock.ID); err != nil {
		t.Fatal(err)
	}
	if revoked() {
		t.Fatal("clearing the hold revoked the lease")
	}
	// Revoking the lease leaves a hold.
	if _, err := w.svc.PutDocumentEditHold(w.ctx, human(w.tn.member), d.ID, held.Lock.ID, sid); err != nil {
		t.Fatal(err)
	}
	if n, err := revokeOfficeLeasesForDevice(w.ctx, w.env.f.q, w.tn.member.ID, sid); err != nil || n != 1 || !revoked() {
		t.Fatalf("lease revoke %d %v", n, err)
	}
	if got := w.lockRow(t, held.Lock.ID); got.EndedAt.Valid || !got.OfflineHoldUntil.Valid {
		t.Fatalf("hold after lease revoke %+v", got)
	}
}

func TestEditRequestAcceptHandsOver(t *testing.T) {
	w := newLockWorld(t)
	d := w.page(t)
	held := w.acquire(t, w.tn.member, d.ID, "e-member")
	req, err := w.svc.CreateDocumentEditRequest(w.ctx, human(w.tn.owner), d.ID)
	if err != nil || !req.Created {
		t.Fatalf("create %+v %v", req, err)
	}
	again, err := w.svc.CreateDocumentEditRequest(w.ctx, human(w.tn.owner), d.ID)
	if err != nil || again.Created || again.Request.ID != req.Request.ID {
		t.Fatalf("repeat %+v %v", again, err)
	}
	st, err := w.svc.GetDocumentEditLockState(w.ctx, human(w.tn.member), d.ID)
	if err != nil || len(st.PendingRequests) != 1 {
		t.Fatalf("holder state %+v %v", st, err)
	}
	// R9 on a stale lock id: changed.
	_, err = w.svc.AnswerDocumentEditRequest(w.ctx, human(w.tn.member), d.ID, req.Request.ID, AnswerDocumentEditRequestInput{Decision: "accept", LockID: "01ZZZZZZZZZZZZZZZZZZZZZZZZ"})
	wantCode(t, err, "edit_lock_changed")
	ans, err := w.svc.AnswerDocumentEditRequest(w.ctx, human(w.tn.member), d.ID, req.Request.ID, AnswerDocumentEditRequestInput{Decision: "accept", LockID: held.Lock.ID})
	if err != nil || ans.Status != DocumentEditRequestAccepted {
		t.Fatalf("accept %+v %v", ans, err)
	}
	w.wantEnded(t, held.Lock.ID, "handed_over")
	if meta := w.auditMeta(t, audit.ActionDocumentEditRequestAnswered, d.ID); meta["decision"] != "accept" {
		t.Fatalf("answered audit %v", meta)
	}
	// The reserved tenure blocks others and is claimed by the requester (200).
	_, err = w.svc.AcquireDocumentEditLock(w.ctx, human(w.tn.aclOwner), d.ID, AcquireDocumentEditLockInput{EditorID: "x", Client: DocumentEditClientWebPage, SessionID: "s"})
	wantCode(t, err, "document_locked")
	claimed := w.acquire(t, w.tn.owner, d.ID, "e-owner")
	if claimed.Created || claimed.Lock.EditorID != "e-owner" || !claimed.Lock.PreviousLockID.Valid || claimed.Lock.PreviousLockID.String != held.Lock.ID {
		t.Fatalf("claim %+v", claimed)
	}
	_, err = w.svc.HeartbeatDocumentEditLock(w.ctx, human(w.tn.member), d.ID, held.Lock.ID)
	ce := wantCode(t, err, "edit_lock_lost")
	if ce.Fields["reason"] != "handed_over" || ce.Fields["by_id"] != w.tn.owner.ID {
		t.Fatalf("lost fields %v", ce.Fields)
	}
	// Answering again: closed.
	_, err = w.svc.AnswerDocumentEditRequest(w.ctx, human(w.tn.member), d.ID, req.Request.ID, AnswerDocumentEditRequestInput{Decision: "accept", LockID: held.Lock.ID})
	wantCode(t, err, "edit_request_closed")
}

func TestEditRequestDeclineExpiredSelfFreeAndRateLimit(t *testing.T) {
	w := newLockWorld(t)
	cfg := DefaultDocumentEditLockConfig()
	cfg.RequestMaxPerHour = 2
	w.svc.SetEditLockConfig(cfg)
	d := w.page(t)

	_, err := w.svc.CreateDocumentEditRequest(w.ctx, human(w.tn.owner), d.ID)
	wantCode(t, err, "edit_lock_free")

	held := w.acquire(t, w.tn.member, d.ID, "e")
	_, err = w.svc.CreateDocumentEditRequest(w.ctx, human(w.tn.member), d.ID)
	wantCode(t, err, "edit_request_to_self")

	req, err := w.svc.CreateDocumentEditRequest(w.ctx, human(w.tn.owner), d.ID)
	if err != nil {
		t.Fatal(err)
	}
	dec, err := w.svc.AnswerDocumentEditRequest(w.ctx, human(w.tn.member), d.ID, req.Request.ID, AnswerDocumentEditRequestInput{Decision: "decline", LockID: held.Lock.ID})
	if err != nil || dec.Status != DocumentEditRequestDeclined {
		t.Fatalf("decline %+v %v", dec, err)
	}
	w.wantLive(t, held.Lock.ID)

	req2, err := w.svc.CreateDocumentEditRequest(w.ctx, human(w.tn.owner), d.ID)
	if err != nil || !req2.Created {
		t.Fatalf("second request %+v %v", req2, err)
	}
	w.exec(t, `UPDATE document_edit_requests SET expires_at = now() - interval '1 second' WHERE id = $1`, req2.Request.ID)
	_, err = w.svc.AnswerDocumentEditRequest(w.ctx, human(w.tn.member), d.ID, req2.Request.ID, AnswerDocumentEditRequestInput{Decision: "accept", LockID: held.Lock.ID})
	wantCode(t, err, "edit_request_expired")

	// Two in the last hour: the third is 429 with retry_after_s.
	_, err = w.svc.CreateDocumentEditRequest(w.ctx, human(w.tn.owner), d.ID)
	ce := wantCode(t, err, "edit_request_rate_limited")
	if ce.Fields["retry_after_s"] == nil {
		t.Fatalf("429 fields %v", ce.Fields)
	}
	// R10 is idempotent.
	for range 2 {
		if err := w.svc.CancelDocumentEditRequest(w.ctx, human(w.tn.owner), d.ID, req.Request.ID); err != nil {
			t.Fatal(err)
		}
	}
}

func TestEditRequestReplacesExpiredPending(t *testing.T) {
	w := newLockWorld(t)
	d := w.page(t)
	held := w.acquire(t, w.tn.member, d.ID, "e")
	stale := w.insertRequest(t, d, held.Lock, w.tn.owner.ID, "now() - interval '1 second'")
	fresh, err := w.svc.CreateDocumentEditRequest(w.ctx, human(w.tn.owner), d.ID)
	if err != nil || !fresh.Created || fresh.Request.ID == stale {
		t.Fatalf("fresh %+v %v", fresh, err)
	}
	var status string
	if err := w.env.f.pool.QueryRow(w.ctx, `SELECT status FROM document_edit_requests WHERE id = $1`, stale).Scan(&status); err != nil || status != "expired" {
		t.Fatalf("stale status %q %v", status, err)
	}
	st, err := w.svc.GetDocumentEditLockState(w.ctx, human(w.tn.owner), d.ID)
	if err != nil || st.MyRequest == nil || st.MyRequest.Request.ID != fresh.Request.ID || st.CanRequest {
		t.Fatalf("requester state %+v %v", st, err)
	}
}

// raceEditLock runs fns at once behind a barrier and returns their errors.
func raceEditLock(fns ...func() error) []error {
	errs := make([]error, len(fns))
	var ready, done sync.WaitGroup
	start := make(chan struct{})
	for i, fn := range fns {
		ready.Add(1)
		done.Add(1)
		go func() {
			defer done.Done()
			ready.Done()
			<-start
			errs[i] = fn()
		}()
	}
	ready.Wait()
	close(start)
	done.Wait()
	return errs
}

func successes(errs []error) int {
	n := 0
	for _, err := range errs {
		if err == nil {
			n++
		}
	}
	return n
}

func TestEditLockRaceExactlyOneWins(t *testing.T) {
	w := newLockWorld(t)
	acquireBy := func(u db.User, docID string) func() error {
		return func() error {
			_, err := w.svc.AcquireDocumentEditLock(w.ctx, human(u), docID, AcquireDocumentEditLockInput{EditorID: "e-" + u.ID, Client: DocumentEditClientWebPage, SessionID: "s-" + u.ID})
			return err
		}
	}
	takeOverBy := func(u db.User, docID, expected string) func() error {
		return func() error {
			_, err := w.svc.TakeOverDocumentEditLock(w.ctx, human(u), docID, TakeOverDocumentEditLockInput{EditorID: "t-" + u.ID, Client: DocumentEditClientWebPage, SessionID: "s-" + u.ID, ExpectedLockID: expected})
			return err
		}
	}
	accept := func(docID, reqID, lockID string) func() error {
		return func() error {
			_, err := w.svc.AnswerDocumentEditRequest(w.ctx, human(w.tn.member), docID, reqID, AnswerDocumentEditRequestInput{Decision: "accept", LockID: lockID})
			return err
		}
	}
	for i := range 3 {
		t.Run("acquire x acquire", func(t *testing.T) {
			d := w.page(t)
			errs := raceEditLock(acquireBy(w.tn.member, d.ID), acquireBy(w.tn.aclOwner, d.ID))
			if successes(errs) != 1 || w.liveCount(t, d.ID) != 1 {
				t.Fatalf("round %d: %v", i, errs)
			}
			for _, err := range errs {
				if err != nil {
					wantCode(t, err, "document_locked")
				}
			}
		})
		t.Run("take-over x take-over", func(t *testing.T) {
			d := w.page(t)
			held := w.acquire(t, w.tn.member, d.ID, "e")
			errs := raceEditLock(takeOverBy(w.tn.owner, d.ID, held.Lock.ID), takeOverBy(w.tn.aclOwner, d.ID, held.Lock.ID))
			if successes(errs) != 1 || w.liveCount(t, d.ID) != 1 {
				t.Fatalf("round %d: %v", i, errs)
			}
		})
		t.Run("take-over x accept", func(t *testing.T) {
			d := w.page(t)
			held := w.acquire(t, w.tn.member, d.ID, "e")
			req, err := w.svc.CreateDocumentEditRequest(w.ctx, human(w.tn.owner), d.ID)
			if err != nil {
				t.Fatal(err)
			}
			errs := raceEditLock(takeOverBy(w.tn.aclOwner, d.ID, held.Lock.ID), accept(d.ID, req.Request.ID, held.Lock.ID))
			if successes(errs) != 1 || w.liveCount(t, d.ID) != 1 {
				t.Fatalf("round %d: %v", i, errs)
			}
		})
		t.Run("accept x heartbeat", func(t *testing.T) {
			d := w.page(t)
			held := w.acquire(t, w.tn.member, d.ID, "e")
			req, err := w.svc.CreateDocumentEditRequest(w.ctx, human(w.tn.owner), d.ID)
			if err != nil {
				t.Fatal(err)
			}
			errs := raceEditLock(accept(d.ID, req.Request.ID, held.Lock.ID), func() error {
				_, err := w.svc.HeartbeatDocumentEditLock(w.ctx, human(w.tn.member), d.ID, held.Lock.ID)
				return err
			})
			if errs[0] != nil || w.liveCount(t, d.ID) != 1 {
				t.Fatalf("round %d: %v", i, errs)
			}
			if errs[1] != nil {
				wantCode(t, errs[1], "edit_lock_lost")
			}
			w.wantEnded(t, held.Lock.ID, "handed_over")
		})
	}
}
