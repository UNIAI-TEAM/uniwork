package service

// DOC-07 (UNI-1631) manager-side tests: A04 (approve grants the chosen level,
// declines close), A05 (the closed, expired, archived, deactivated and
// self-approval refusals, and two managers racing), A07's approve half (the
// requester reads only after an approval), the cooldown hand-off to w1's
// create path, and the manager's list. The create path is w1's
// (document_access_requests_test.go); this file reuses its fixture.

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// decidedRow is the decision half of a request row: what the tests assert about
// an approve or a decline. DecidedAt is NULL while the row is still pending.
type decidedRow struct {
	ID           string
	Status       string
	GrantedLevel pgtype.Text
	ShareID      pgtype.Text
	DecidedBy    pgtype.Text
	DecidedAt    pgtype.Timestamptz
}

func (f *accessRequestFixture) decided(t *testing.T, requestID string) decidedRow {
	t.Helper()
	var r decidedRow
	if err := f.pool.QueryRow(f.ctx,
		`SELECT id, status, granted_level, share_id, decided_by, decided_at
		   FROM document_access_requests WHERE id = $1`, requestID).
		Scan(&r.ID, &r.Status, &r.GrantedLevel, &r.ShareID, &r.DecidedBy, &r.DecidedAt); err != nil {
		t.Fatal(err)
	}
	return r
}

// countDecidedOutbox counts the document.access_request_decided rows of one
// document.
func (f *accessRequestFixture) countDecidedOutbox(t *testing.T, documentID string) int {
	t.Helper()
	var n int
	if err := f.pool.QueryRow(f.ctx,
		`SELECT count(*) FROM outbox_events WHERE topic = $1 AND payload::jsonb->>'document_id' = $2`,
		topicDocumentAccessRequestDecided, documentID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// decisionAuditMeta returns the metadata of every audit row of one action on
// one document, as text.
func (f *accessRequestFixture) decisionAuditMeta(t *testing.T, action, documentID string) []string {
	t.Helper()
	rs, err := f.pool.Query(f.ctx,
		`SELECT metadata::text FROM audit_events WHERE action = $1 AND resource_id = $2 ORDER BY occurred_at`,
		action, documentID)
	if err != nil {
		t.Fatal(err)
	}
	defer rs.Close()
	var out []string
	for rs.Next() {
		var m string
		if err := rs.Scan(&m); err != nil {
			t.Fatal(err)
		}
		out = append(out, m)
	}
	if err := rs.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

// assertCancelledAudit verifies that one committed
// document.access_request_cancelled audit row exists for the document with the
// status diff and the expected request_id and reason.
func (f *accessRequestFixture) assertCancelledAudit(t *testing.T, documentID, requestID, wantReason string) {
	t.Helper()
	var changesText, metaText string
	if err := f.pool.QueryRow(f.ctx,
		`SELECT changes::text, metadata::text FROM audit_events WHERE action = $1 AND resource_id = $2`,
		audit.ActionDocumentAccessRequestCancelled, documentID).Scan(&changesText, &metaText); err != nil {
		t.Fatalf("cancelled audit row: %v", err)
	}
	if !strings.Contains(changesText, `"status"`) || !strings.Contains(changesText, `"pending"`) || !strings.Contains(changesText, `"cancelled"`) {
		t.Fatalf("cancelled changes = %s, want status pending -> cancelled", changesText)
	}
	if !strings.Contains(metaText, requestID) || !strings.Contains(metaText, wantReason) {
		t.Fatalf("cancelled metadata = %s, want request_id %q and reason %q", metaText, requestID, wantReason)
	}
}

// liveShares counts the live grants of one document, optionally for one
// principal.
func (f *accessRequestFixture) liveShares(t *testing.T, documentID string, principalID string) []db.DocumentShare {
	t.Helper()
	shares, err := f.q.ListDocumentShares(f.ctx, db.ListDocumentSharesParams{
		OrganizationID: f.tn.orgID, WorkspaceID: f.tn.wsA, DocumentID: documentID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if principalID == "" {
		return shares
	}
	var out []db.DocumentShare
	for _, sh := range shares {
		if sh.PrincipalID == principalID {
			out = append(out, sh)
		}
	}
	return out
}

// requestOf is the pending request a member sent for the fixture's restricted
// document: the precondition of every approve and decline test.
func (f *accessRequestFixture) requestOf(t *testing.T, doc db.Document, actor Actor) string {
	t.Helper()
	if _, err := f.svc.CreateDocumentAccessRequest(f.ctx, actor, doc.ID, DocumentAccessRequestInput{
		RequestedLevel: "view", Message: "cần xem để chuẩn bị họp",
	}); err != nil {
		t.Fatal(err)
	}
	rows := f.rows(t, doc.ID)
	if len(rows) != 1 {
		t.Fatalf("rows = %d, want the one pending request", len(rows))
	}
	return rows[0].ID
}

// TestDocumentAccessRequestApprove is A04's approve half: the manager picks a
// level below or above the requested one, the grant lands at exactly that
// level, and both events and the audit row go out with the decision.
func TestDocumentAccessRequestApprove(t *testing.T) {
	f := newAccessRequestFixture(t, "ar04a")
	manager := Human(f.tn.aclOwner.ID)

	for _, tc := range []struct {
		name      string
		requested string
		granted   string
		want      string
	}{
		{"lower than requested", "edit", "view", "view"},
		{"higher than requested", "view", "edit", "edit"},
		{"the default is the requested level", "comment", "", "comment"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			doc := f.restrictedDoc(t)
			if _, err := f.svc.CreateDocumentAccessRequest(f.ctx, Human(f.tn.member.ID), doc.ID, DocumentAccessRequestInput{
				RequestedLevel: tc.requested,
			}); err != nil {
				t.Fatal(err)
			}
			reqID := f.rows(t, doc.ID)[0].ID

			got, err := f.svc.ApproveDocumentAccessRequest(f.ctx, manager, doc.ID, reqID, tc.granted)
			if err != nil {
				t.Fatal(err)
			}
			if got.ID != reqID || got.Status != AccessRequestStatusApproved || got.ShareID == "" {
				t.Fatalf("decision = %+v, want an approval with a share", got)
			}
			row := f.decided(t, reqID)
			if row.Status != AccessRequestStatusApproved {
				t.Fatalf("status = %q, want approved", row.Status)
			}
			if !row.GrantedLevel.Valid || row.GrantedLevel.String != tc.want {
				t.Fatalf("granted_level = %+v, want %q", row.GrantedLevel, tc.want)
			}
			if !row.ShareID.Valid || row.ShareID.String != got.ShareID {
				t.Fatalf("share_id = %+v, want %q", row.ShareID, got.ShareID)
			}
			if !row.DecidedBy.Valid || row.DecidedBy.String != f.tn.aclOwner.ID {
				t.Fatalf("decided_by = %+v, want the manager", row.DecidedBy)
			}
			if !row.DecidedAt.Valid || !row.DecidedAt.Time.Equal(f.now) {
				t.Fatalf("decided_at = %+v, want the service clock %s", row.DecidedAt, f.now)
			}
			shares := f.liveShares(t, doc.ID, f.tn.member.ID)
			if len(shares) != 1 || shares[0].Level != tc.want || shares[0].ID != got.ShareID {
				t.Fatalf("shares = %+v, want one at %q", shares, tc.want)
			}
			// The grant is the share path's: the document.shared event is the
			// same one ShareDocument emits, plus the decided frame.
			if n := countOutbox(t, f.docPermFixture, "document.shared", doc.ID); n != 1 {
				t.Fatalf("document.shared outbox rows = %d, want 1", n)
			}
			if n := f.countDecidedOutbox(t, doc.ID); n != 1 {
				t.Fatalf("decided outbox rows = %d, want 1", n)
			}
			metas := f.decisionAuditMeta(t, audit.ActionDocumentAccessRequestApproved, doc.ID)
			if len(metas) != 1 {
				t.Fatalf("approved audit rows = %d, want 1", len(metas))
			}
			for _, want := range []string{reqID, tc.want, got.ShareID} {
				if !strings.Contains(metas[0], want) {
					t.Fatalf("approved metadata %s is missing %q", metas[0], want)
				}
			}
			if n := len(f.decisionAuditMeta(t, audit.ActionDocumentAccessRequestDeclined, doc.ID)); n != 0 {
				t.Fatalf("declined audit rows = %d, want none", n)
			}
		})
	}
}

// TestDocumentAccessRequestApproveOnlyRaises is A04's only-raise half: a
// requester who already holds the granted level is approved with no share at
// all, and the audit row records the level that was granted with no share id.
func TestDocumentAccessRequestApproveOnlyRaises(t *testing.T) {
	f := newAccessRequestFixture(t, "ar04r")
	doc := f.restrictedDoc(t)
	manager := Human(f.tn.aclOwner.ID)

	reqID := f.requestOf(t, doc, Human(f.tn.member.ID))
	// Somebody shares the document with the requester while the request waits.
	sh := f.share(t, doc, DocumentPrincipalUser, f.tn.member.ID, DocumentLevelEdit, f.tn.aclOwner.ID)

	got, err := f.svc.ApproveDocumentAccessRequest(f.ctx, manager, doc.ID, reqID, "view")
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != AccessRequestStatusApproved {
		t.Fatalf("status = %q, want approved", got.Status)
	}
	if got.ShareID != "" {
		t.Fatalf("share_id = %q, want empty: the requester already held edit", got.ShareID)
	}
	row := f.decided(t, reqID)
	if !row.GrantedLevel.Valid || row.GrantedLevel.String != "view" {
		t.Fatalf("granted_level = %+v, want view", row.GrantedLevel)
	}
	if row.ShareID.Valid {
		t.Fatalf("share_id column = %+v, want NULL", row.ShareID)
	}
	shares := f.liveShares(t, doc.ID, f.tn.member.ID)
	if len(shares) != 1 || shares[0].ID != sh.ID {
		t.Fatalf("shares = %+v, want only the pre-existing grant %s", shares, sh.ID)
	}
	if n := countOutbox(t, f.docPermFixture, "document.shared", doc.ID); n != 0 {
		t.Fatalf("document.shared rows = %d, want none: no grant was written", n)
	}
	metas := f.decisionAuditMeta(t, audit.ActionDocumentAccessRequestApproved, doc.ID)
	if len(metas) != 1 || strings.Contains(metas[0], "share_id") {
		t.Fatalf("approved metadata = %v, want one row without share_id", metas)
	}
}

// TestDocumentAccessRequestDecline is A04's decline half: the request closes as
// declined with its audit row and its decided frame, no share is written, and
// nothing is sent to the requester.
func TestDocumentAccessRequestDecline(t *testing.T) {
	f := newAccessRequestFixture(t, "ar04d")
	doc := f.restrictedDoc(t)
	reqID := f.requestOf(t, doc, Human(f.tn.member.ID))

	got, err := f.svc.DeclineDocumentAccessRequest(f.ctx, Human(f.tn.aclOwner.ID), doc.ID, reqID)
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != reqID || got.Status != AccessRequestStatusDeclined || got.ShareID != "" {
		t.Fatalf("decision = %+v, want a plain decline", got)
	}
	row := f.decided(t, reqID)
	if row.Status != AccessRequestStatusDeclined || !row.DecidedAt.Valid || !row.DecidedAt.Time.Equal(f.now) {
		t.Fatalf("row = %+v, want declined at the service clock", row)
	}
	if len(f.liveShares(t, doc.ID, "")) != 0 {
		t.Fatal("a decline wrote a share")
	}
	if n := f.countDecidedOutbox(t, doc.ID); n != 1 {
		t.Fatalf("decided outbox rows = %d, want 1", n)
	}
	if n := len(f.decisionAuditMeta(t, audit.ActionDocumentAccessRequestDeclined, doc.ID)); n != 1 {
		t.Fatalf("declined audit rows = %d, want 1", n)
	}
	if n := len(f.decisionAuditMeta(t, audit.ActionDocumentAccessRequestApproved, doc.ID)); n != 0 {
		t.Fatalf("approved audit rows = %d, want none", n)
	}
}

// TestDocumentAccessRequestDecisionClosed is A05's closed half: a request that
// is no longer pending, has expired, or whose document is in the trash answers
// 409 access_request_closed - and the archived case records the row cancelled
// and COMMITS it before the refusal goes out.
func TestDocumentAccessRequestDecisionClosed(t *testing.T) {
	f := newAccessRequestFixture(t, "ar05c")
	manager := Human(f.tn.aclOwner.ID)

	t.Run("a request already answered is 409 and changes nothing", func(t *testing.T) {
		doc := f.restrictedDoc(t)
		reqID := f.requestOf(t, doc, Human(f.tn.member.ID))
		if _, err := f.svc.DeclineDocumentAccessRequest(f.ctx, manager, doc.ID, reqID); err != nil {
			t.Fatal(err)
		}
		before := f.decided(t, reqID)
		for _, approve := range []bool{true, false} {
			_, err := f.decideAs(t, approve, manager, doc.ID, reqID, "view")
			ce := wantCode(t, err, "access_request_closed")
			if ce.Status != 409 {
				t.Fatalf("approve=%v: status = %d, want 409", approve, ce.Status)
			}
		}
		if after := f.decided(t, reqID); after != before {
			t.Fatalf("row changed: %+v -> %+v", before, after)
		}
	})

	t.Run("an expired request is 409 and stays pending in the column", func(t *testing.T) {
		doc := f.restrictedDoc(t)
		reqID := f.seedPending(t, doc, f.tn.member.ID, "view", "cũ", f.now.Add(-time.Minute))
		wantCode(t, f.approveErr(t, manager, doc.ID, reqID, "view"), "access_request_closed")
		if row := f.decided(t, reqID); row.Status != AccessRequestStatusPending {
			t.Fatalf("status = %q, want it untouched: expired is derived", row.Status)
		}
	})

	t.Run("a request that expires while waiting on the request lock is 409 and grants nothing", func(t *testing.T) {
		var clockMu sync.Mutex
		clockNow := f.now
		f.svc.SetClock(func() time.Time {
			clockMu.Lock()
			defer clockMu.Unlock()
			return clockNow
		})
		defer f.svc.SetClock(func() time.Time { return f.now })

		doc := f.restrictedDoc(t)
		reqID := f.seedPending(t, doc, f.tn.member.ID, "view", "sắp hết hạn", clockNow.Add(time.Minute))

		tx, err := f.pool.Begin(f.ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = tx.Rollback(f.ctx) }()
		if _, err := f.q.WithTx(tx).GetDocumentAccessRequestForUpdate(f.ctx, db.GetDocumentAccessRequestForUpdateParams{
			OrganizationID: doc.OrganizationID, DocumentID: doc.ID, ID: reqID,
		}); err != nil {
			t.Fatal(err)
		}

		done := make(chan struct{})
		var approveErr error
		go func() {
			defer close(done)
			_, approveErr = f.svc.ApproveDocumentAccessRequest(context.Background(), manager, doc.ID, reqID, "view")
		}()
		f.waitLockOrDone(t, done)
		clockMu.Lock()
		clockNow = clockNow.Add(2 * time.Minute)
		clockMu.Unlock()
		if err := tx.Rollback(f.ctx); err != nil {
			t.Fatal(err)
		}
		<-done

		ce := wantCode(t, approveErr, "access_request_closed")
		if ce.Status != 409 {
			t.Fatalf("status = %d, want 409", ce.Status)
		}
		if row := f.decided(t, reqID); row.Status != AccessRequestStatusPending {
			t.Fatalf("status = %q, want pending", row.Status)
		}
		if len(f.liveShares(t, doc.ID, "")) != 0 {
			t.Fatal("an expired request gained a share")
		}
		if n := len(f.decisionAuditMeta(t, audit.ActionDocumentAccessRequestApproved, doc.ID)); n != 0 {
			t.Fatalf("approved audit rows = %d, want none", n)
		}
		if n := f.countDecidedOutbox(t, doc.ID); n != 0 {
			t.Fatalf("decided outbox rows = %d, want none", n)
		}
	})

	t.Run("an archived document records cancelled and commits before the 409", func(t *testing.T) {
		doc := f.treeDoc(t, f.tn, treeDocSpec{
			ws: f.tn.wsA, visibility: "restricted", aclOwner: f.tn.aclOwner.ID, createdBy: f.tn.aclOwner.ID,
			archived: true,
		})
		reqID := f.seedPending(t, doc, f.tn.member.ID, "view", "", f.now.Add(time.Hour))
		wantCode(t, f.approveErr(t, manager, doc.ID, reqID, "view"), "access_request_closed")
		// The cancel survives the refusal: it was committed before the answer.
		if row := f.decided(t, reqID); row.Status != AccessRequestStatusCancelled {
			t.Fatalf("status = %q, want cancelled", row.Status)
		}
		if len(f.liveShares(t, doc.ID, "")) != 0 {
			t.Fatal("an archived document gained a share")
		}
		f.assertCancelledAudit(t, doc.ID, reqID, "archived")
		if n := f.countDecidedOutbox(t, doc.ID); n != 0 {
			t.Fatalf("decided outbox rows = %d, want none: a cancel emits no frame", n)
		}
	})
}

// TestDocumentAccessRequestDecisionRefusals is A05's gate half: an
// AdminScope-only manager approving their own request is break_glass_required,
// a reader below manage is forbidden, a stranger is not found, and a request of
// another document under this document's path is not found too.
func TestDocumentAccessRequestDecisionRefusals(t *testing.T) {
	f := newAccessRequestFixture(t, "ar05g")

	t.Run("an AdminScope-only manager approving their own request", func(t *testing.T) {
		doc := f.restrictedDoc(t)
		// The workspace admin holds AdminScope and no read level on a
		// restricted document, so their own request is stored.
		reqID := f.requestOf(t, doc, Human(f.tn.wsAdmin.ID))
		err := f.approveErr(t, Human(f.tn.wsAdmin.ID), doc.ID, reqID, "view")
		ce := wantCode(t, err, "break_glass_required")
		if ce.Status != 403 {
			t.Fatalf("status = %d, want 403", ce.Status)
		}
		if row := f.decided(t, reqID); row.Status != AccessRequestStatusPending {
			t.Fatalf("status = %q, want it left pending", row.Status)
		}
		if len(f.liveShares(t, doc.ID, "")) != 0 {
			t.Fatal("a self-approval wrote a share")
		}
	})

	t.Run("a reader below manage", func(t *testing.T) {
		doc := f.restrictedDoc(t)
		f.share(t, doc, DocumentPrincipalUser, f.tn.creator.ID, DocumentLevelEdit, f.tn.aclOwner.ID)
		reqID := f.requestOf(t, doc, Human(f.tn.member.ID))
		err := f.approveErr(t, Human(f.tn.creator.ID), doc.ID, reqID, "view")
		if !errors.Is(err, ErrForbidden) {
			t.Fatalf("want forbidden, got %v", err)
		}
		if row := f.decided(t, reqID); row.Status != AccessRequestStatusPending {
			t.Fatalf("status = %q, want it left pending", row.Status)
		}
	})

	t.Run("a stranger", func(t *testing.T) {
		doc := f.restrictedDoc(t)
		reqID := f.requestOf(t, doc, Human(f.tn.member.ID))
		if err := f.approveErr(t, Human(f.tn.outsider.ID), doc.ID, reqID, "view"); !errors.Is(err, ErrNotFound) {
			t.Fatalf("want not found, got %v", err)
		}
	})

	t.Run("a request of another document", func(t *testing.T) {
		doc := f.restrictedDoc(t)
		other := f.restrictedDoc(t)
		reqID := f.requestOf(t, other, Human(f.tn.member.ID))
		if err := f.approveErr(t, Human(f.tn.aclOwner.ID), doc.ID, reqID, "view"); !errors.Is(err, ErrNotFound) {
			t.Fatalf("want not found, got %v", err)
		}
		if row := f.decided(t, reqID); row.Status != AccessRequestStatusPending {
			t.Fatalf("status = %q, want the other document's request untouched", row.Status)
		}
	})

	t.Run("a level of manage is refused", func(t *testing.T) {
		doc := f.restrictedDoc(t)
		reqID := f.requestOf(t, doc, Human(f.tn.member.ID))
		var ve ValidationError
		if _, err := f.svc.ApproveDocumentAccessRequest(f.ctx, Human(f.tn.aclOwner.ID), doc.ID, reqID, "manage"); !errors.As(err, &ve) {
			t.Fatalf("want invalid_request, got %v", err)
		}
		if row := f.decided(t, reqID); row.Status != AccessRequestStatusPending {
			t.Fatalf("status = %q, want it left pending", row.Status)
		}
	})
}

// TestDocumentAccessRequestApproveDeactivatedRequester is A05's committed-cancel
// case: a requester who left or was deactivated since asking is answered 422,
// and the cancelled row is committed BEFORE the answer - the assertion reads
// the database after the call returns, which is only true if the transaction
// committed the cancel rather than rolling it back with the error.
func TestDocumentAccessRequestApproveDeactivatedRequester(t *testing.T) {
	f := newAccessRequestFixture(t, "ar05d")
	doc := f.restrictedDoc(t)
	reqID := f.seedPending(t, doc, f.tn.deact.ID, "view", "xin từ lúc còn là thành viên", f.now.Add(time.Hour))

	err := f.approveErr(t, Human(f.tn.aclOwner.ID), doc.ID, reqID, "view")
	ce := wantCode(t, err, "principal_not_in_organization")
	if ce.Status != 422 {
		t.Fatalf("status = %d, want 422", ce.Status)
	}
	row := f.decided(t, reqID)
	if row.Status != AccessRequestStatusCancelled {
		t.Fatalf("status = %q, want cancelled and committed", row.Status)
	}
	if !row.DecidedAt.Valid || !row.DecidedAt.Time.Equal(f.now) {
		t.Fatalf("decided_at = %+v, want the service clock", row.DecidedAt)
	}
	if len(f.liveShares(t, doc.ID, "")) != 0 {
		t.Fatal("a cancelled approval wrote a share")
	}
	if n := f.countDecidedOutbox(t, doc.ID); n != 0 {
		t.Fatalf("decided outbox rows = %d, want none: a cancel emits no frame", n)
	}
	f.assertCancelledAudit(t, doc.ID, reqID, "requester_inactive")
}

// TestDocumentAccessRequestConcurrentApprovers is A05's race: two managers
// approve the same request at once (real Postgres, goroutines). The request row
// lock and the pending re-check inside the transaction leave exactly one
// success, one 409, and exactly one share.
func TestDocumentAccessRequestConcurrentApprovers(t *testing.T) {
	f := newAccessRequestFixture(t, "ar05r")
	doc := f.restrictedDoc(t)
	reqID := f.requestOf(t, doc, Human(f.tn.member.ID))
	// A second manager who may administer the document.
	f.share(t, doc, DocumentPrincipalUser, f.tn.wsAdmin.ID, DocumentLevelManage, f.tn.aclOwner.ID)

	managers := []Actor{Human(f.tn.aclOwner.ID), Human(f.tn.wsAdmin.ID)}
	var wg sync.WaitGroup
	results := make([]DocumentAccessRequestDecision, len(managers))
	errs := make([]error, len(managers))
	start := make(chan struct{})
	for i := range managers {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			results[i], errs[i] = f.svc.ApproveDocumentAccessRequest(context.Background(), managers[i], doc.ID, reqID, "view")
		}(i)
	}
	close(start)
	wg.Wait()

	ok, closed, other := 0, 0, 0
	for _, err := range errs {
		switch {
		case err == nil:
			ok++
		case codedIs(err, "access_request_closed"):
			closed++
		default:
			other++
			t.Errorf("unexpected error: %v", err)
		}
	}
	if ok != 1 || closed != 1 || other != 0 {
		t.Fatalf("ok=%d closed=%d other=%d, want 1/1/0", ok, closed, other)
	}
	if row := f.decided(t, reqID); row.Status != AccessRequestStatusApproved {
		t.Fatalf("status = %q, want approved", row.Status)
	}
	shares := f.liveShares(t, doc.ID, f.tn.member.ID)
	if len(shares) != 1 {
		t.Fatalf("shares = %+v, want exactly one", shares)
	}
	if n := f.countDecidedOutbox(t, doc.ID); n != 1 {
		t.Fatalf("decided outbox rows = %d, want 1", n)
	}
}

// TestDocumentAccessRequestApprovalGrants is A07's approve half: before the
// decision every read path answers not found, and after it the requester reads
// at the level the manager granted.
func TestDocumentAccessRequestApprovalGrants(t *testing.T) {
	f := newAccessRequestFixture(t, "ar07g")
	doc := f.restrictedDoc(t)
	reqID := f.requestOf(t, doc, Human(f.tn.member.ID))

	if _, _, err := f.svc.authorizeDocument(f.ctx, Human(f.tn.member.ID), doc.ID, DocumentLevelView); !errors.Is(err, ErrNotFound) {
		t.Fatalf("read before approval = %v, want not found", err)
	}
	if _, err := f.svc.ApproveDocumentAccessRequest(f.ctx, Human(f.tn.aclOwner.ID), doc.ID, reqID, "comment"); err != nil {
		t.Fatal(err)
	}
	_, access, err := f.svc.authorizeDocument(f.ctx, Human(f.tn.member.ID), doc.ID, DocumentLevelComment)
	if err != nil {
		t.Fatalf("read after approval = %v, want comment", err)
	}
	if access.Level != DocumentLevelComment {
		t.Fatalf("level = %q, want comment", access.Level)
	}
	if _, _, err := f.svc.authorizeDocument(f.ctx, Human(f.tn.member.ID), doc.ID, DocumentLevelEdit); !errors.Is(err, ErrForbidden) {
		t.Fatalf("edit after a comment grant = %v, want forbidden", err)
	}
}

// TestDocumentAccessRequestCooldownHandOff proves the decision clock is the
// service's: a decline at T makes w1's create path answer 429 at T+59m and 202
// at T+1h, because the cooldown reads decided_at against s.now().
func TestDocumentAccessRequestCooldownHandOff(t *testing.T) {
	f := newAccessRequestFixture(t, "ar09h")
	doc := f.restrictedDoc(t)
	actor := Human(f.tn.member.ID)
	reqID := f.requestOf(t, doc, actor)

	if _, err := f.svc.DeclineDocumentAccessRequest(f.ctx, Human(f.tn.aclOwner.ID), doc.ID, reqID); err != nil {
		t.Fatal(err)
	}
	declinedAt := f.now

	f.now = declinedAt.Add(59 * time.Minute)
	ce := wantCode(t, f.createErr(t, actor, doc.ID), "access_request_cooldown")
	if secs, _ := ce.Fields["retry_after_seconds"].(int); secs != 60 {
		t.Fatalf("retry_after_seconds = %#v, want 60", ce.Fields["retry_after_seconds"])
	}

	f.now = declinedAt.Add(time.Hour)
	if _, err := f.svc.CreateDocumentAccessRequest(f.ctx, actor, doc.ID, DocumentAccessRequestInput{}); err != nil {
		t.Fatalf("want sent an hour after the decline, got %v", err)
	}
	rows := f.rows(t, doc.ID)
	if len(rows) != 2 || rows[0].Status != AccessRequestStatusDeclined || rows[1].Status != AccessRequestStatusPending {
		t.Fatalf("rows = %+v, want the declined row plus a new pending one", rows)
	}
}

// TestDocumentAccessRequestList is the manager's list: only this document's
// pending, unexpired requests; a reader who cannot administer the document gets
// an empty list rather than a refusal; an archived document has none; and the
// source title is filled only for a manager who reads that task.
func TestDocumentAccessRequestList(t *testing.T) {
	f := newAccessRequestFixture(t, "ar05l")
	tasks := NewTaskService(f.pool, f.q, f.svc.ws, newMemStorage())
	f.svc.SetAccessRequestSources(tasks, nil)
	doc := f.restrictedDoc(t)

	seedTask := func(t *testing.T, title string) string {
		t.Helper()
		id := util.NewID()
		if _, err := f.pool.Exec(f.ctx,
			`INSERT INTO tasks (id, workspace_id, organization_id, number, title, description, created_by, creator_type, creator_id, last_activity_at)
			 VALUES ($1, $2, $3, (SELECT COALESCE(max(number), 0) + 1 FROM tasks WHERE workspace_id = $2), $4, '', $5, 'member', $5, now())`,
			id, f.tn.wsA, f.tn.orgID, title, f.tn.owner.ID); err != nil {
			t.Fatal(err)
		}
		return id
	}
	// A request with a readable source, one whose row has expired, and one on
	// another document of the same tenant.
	task := seedTask(t, "Chuẩn bị họp")
	f.seedRequestWithSource(t, doc, f.tn.member.ID, "edit", "xin sửa", AccessRequestSourceKindTask, task, f.now.Add(time.Hour))
	f.seedPending(t, doc, f.tn.creator.ID, "view", "đã hết hạn", f.now.Add(-time.Minute))
	other := f.restrictedDoc(t)
	f.seedPending(t, other, f.tn.bMember.ID, "view", "tài liệu khác", f.now.Add(time.Hour))

	got, err := f.svc.ListDocumentAccessRequests(f.ctx, Human(f.tn.aclOwner.ID), doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 {
		t.Fatalf("list = %+v, want only the live request of this document", got)
	}
	v := got[0]
	if v.RequesterID != f.tn.member.ID || v.RequestedLevel != "edit" || v.Message != "xin sửa" {
		t.Fatalf("view = %+v", v)
	}
	if v.RequesterName == "" {
		t.Fatalf("view = %+v, want the requester's display name", v)
	}
	if !v.CreatedAt.Equal(f.now) || !v.ExpiresAt.Equal(f.now.Add(time.Hour)) {
		t.Fatalf("timestamps = %s/%s, want the service clock", v.CreatedAt, v.ExpiresAt)
	}
	if v.Source == nil || v.Source.Kind != AccessRequestSourceKindTask || v.Source.ID != task || v.Source.Title != "Chuẩn bị họp" {
		t.Fatalf("source = %+v, want the readable task with its title", v.Source)
	}

	// The same list for a manager who cannot read that task: the source is
	// null entirely, not an id with an empty title (§4.3: `source.title` chỉ
	// có khi người gọi đọc được nguồn; ngược lại `source` = `null`). bMember
	// administers the document through a manage share but is only in wsB, so
	// the wsA task is not readable to them.
	f.share(t, doc, DocumentPrincipalUser, f.tn.bMember.ID, DocumentLevelManage, f.tn.aclOwner.ID)
	got, err = f.svc.ListDocumentAccessRequests(f.ctx, Human(f.tn.bMember.ID), doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Source != nil {
		t.Fatalf("list for a manager who cannot read the task = %+v, want one request with a null source", got)
	}

	t.Run("a reader who cannot administer gets an empty list", func(t *testing.T) {
		f.share(t, doc, DocumentPrincipalUser, f.tn.creator.ID, DocumentLevelView, f.tn.aclOwner.ID)
		list, err := f.svc.ListDocumentAccessRequests(f.ctx, Human(f.tn.creator.ID), doc.ID)
		if err != nil {
			t.Fatalf("want an empty list, got %v", err)
		}
		if len(list) != 0 {
			t.Fatalf("list = %+v, want empty", list)
		}
		n, err := f.svc.CountPendingDocumentAccessRequests(f.ctx, Human(f.tn.creator.ID), doc, DocumentAccess{Level: DocumentLevelView})
		if err != nil || n != 0 {
			t.Fatalf("count = %d, %v; want 0", n, err)
		}
	})

	t.Run("a stranger is not found", func(t *testing.T) {
		if _, err := f.svc.ListDocumentAccessRequests(f.ctx, Human(f.tn.outsider.ID), doc.ID); !errors.Is(err, ErrNotFound) {
			t.Fatalf("want not found, got %v", err)
		}
	})

	t.Run("an archived document has none", func(t *testing.T) {
		arch := f.treeDoc(t, f.tn, treeDocSpec{
			ws: f.tn.wsA, visibility: "restricted", aclOwner: f.tn.aclOwner.ID, createdBy: f.tn.aclOwner.ID,
			archived: true,
		})
		f.seedPending(t, arch, f.tn.member.ID, "view", "", f.now.Add(time.Hour))
		list, err := f.svc.ListDocumentAccessRequests(f.ctx, Human(f.tn.aclOwner.ID), arch.ID)
		if err != nil || len(list) != 0 {
			t.Fatalf("list = %+v, %v; want empty for an archived document", list, err)
		}
	})

	t.Run("the count matches the list", func(t *testing.T) {
		n, err := f.svc.CountPendingDocumentAccessRequests(f.ctx, Human(f.tn.aclOwner.ID), doc, DocumentAccess{Level: DocumentLevelManage})
		if err != nil {
			t.Fatal(err)
		}
		if n != 1 {
			t.Fatalf("count = %d, want 1", n)
		}
		// The shares handler reads the same number off DocumentAccessList,
		// because it holds no db.Document of its own (lead, 2026-10-19).
		overview, err := f.svc.DocumentAccessList(f.ctx, Human(f.tn.aclOwner.ID), doc.ID)
		if err != nil {
			t.Fatal(err)
		}
		if overview.PendingAccessRequests != 1 {
			t.Fatalf("overview pending = %d, want 1", overview.PendingAccessRequests)
		}
		reader, err := f.svc.DocumentAccessList(f.ctx, Human(f.tn.creator.ID), doc.ID)
		if err != nil {
			t.Fatal(err)
		}
		if reader.PendingAccessRequests != 0 {
			t.Fatalf("reader pending = %d, want 0", reader.PendingAccessRequests)
		}
	})
}

// TestFilterDocumentAdministrators is the delivery-time check the request rule
// filters through: manage shares and the ACL owner pass, an AdminScope caller
// with no read level passes (they are the fallback recipient), and a revoked
// manager, a reader below manage and a stranger do not.
func TestFilterDocumentAdministrators(t *testing.T) {
	f := newAccessRequestFixture(t, "ar05f")
	doc := f.restrictedDoc(t)
	manageShare := f.share(t, doc, DocumentPrincipalUser, f.tn.creator.ID, DocumentLevelManage, f.tn.aclOwner.ID)
	f.share(t, doc, DocumentPrincipalUser, f.tn.member.ID, DocumentLevelEdit, f.tn.aclOwner.ID)
	f.revoke(t, manageShare, f.tn.aclOwner.ID)

	ids := []string{f.tn.aclOwner.ID, f.tn.wsAdmin.ID, f.tn.creator.ID, f.tn.member.ID, f.tn.outsider.ID}
	got, err := f.svc.FilterDocumentAdministrators(f.ctx, doc.ID, ids)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]bool{f.tn.aclOwner.ID: true, f.tn.wsAdmin.ID: true}
	if len(got) != len(want) {
		t.Fatalf("filtered = %v, want the ACL owner and the AdminScope admin", got)
	}
	for _, id := range got {
		if !want[id] {
			t.Fatalf("filtered = %v, want the ACL owner and the AdminScope admin", got)
		}
	}

	t.Run("a document that is gone keeps nobody", func(t *testing.T) {
		got, err := f.svc.FilterDocumentAdministrators(f.ctx, util.NewID(), ids)
		if err != nil || len(got) != 0 {
			t.Fatalf("filtered = %v, %v; want empty", got, err)
		}
	})
}

// approveErr runs an approve and returns its error.
func (f *accessRequestFixture) approveErr(t *testing.T, actor Actor, documentID, requestID, level string) error {
	t.Helper()
	_, err := f.svc.ApproveDocumentAccessRequest(f.ctx, actor, documentID, requestID, level)
	return err
}

// decideAs runs an approve or a decline.
func (f *accessRequestFixture) decideAs(t *testing.T, approve bool, actor Actor, documentID, requestID, level string) (DocumentAccessRequestDecision, error) {
	t.Helper()
	if approve {
		return f.svc.ApproveDocumentAccessRequest(f.ctx, actor, documentID, requestID, level)
	}
	return f.svc.DeclineDocumentAccessRequest(f.ctx, actor, documentID, requestID)
}

// createErr runs w1's create path and returns its error.
func (f *accessRequestFixture) createErr(t *testing.T, actor Actor, documentID string) error {
	t.Helper()
	_, err := f.svc.CreateDocumentAccessRequest(f.ctx, actor, documentID, DocumentAccessRequestInput{})
	return err
}

// seedRequestWithSource writes a pending row carrying a source pair directly:
// the create path keeps a source only when the requester reads it, and these
// tests need a request whose source the MANAGER may or may not read.
func (f *accessRequestFixture) seedRequestWithSource(t *testing.T, doc db.Document, requesterID, level, message, kind, sourceID string, expiresAt time.Time) string {
	t.Helper()
	id := util.NewID()
	if _, err := f.pool.Exec(f.ctx,
		`INSERT INTO document_access_requests (
			id, organization_id, workspace_id, document_id, created_by, created_by_kind,
			requested_level, message, source_kind, source_id, status, expires_at, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, 'human', $6, $7, $8, $9, 'pending', $10, $11, $11)`,
		id, doc.OrganizationID, doc.WorkspaceID, doc.ID, requesterID, level, message, kind, sourceID, expiresAt, f.now); err != nil {
		t.Fatal(err)
	}
	return id
}
