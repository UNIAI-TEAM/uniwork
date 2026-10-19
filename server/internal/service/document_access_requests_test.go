package service

// DOC-07 (UNI-1631) create-path tests: A01 (sent), A02/A10 (the uniform
// answer), A03 (one pending per pair, and the expired row refreshed), A09
// (the 1h cooldown after a decline) and A06 (the source pair). Approve and
// decline are w2's; where a decided row is needed it is seeded with SQL.

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/meetings"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type accessRequestFixture struct {
	*docPermFixture
	tn  docTenant
	now time.Time
}

func newAccessRequestFixture(t *testing.T, slug string) *accessRequestFixture {
	t.Helper()
	f := &accessRequestFixture{docPermFixture: newDocPermFixture(t)}
	f.tn = f.tenant(t, slug)
	f.now = time.Date(2026, 10, 19, 9, 0, 0, 0, time.UTC)
	f.svc.SetClock(func() time.Time { return f.now })
	return f
}

// restrictedDoc is a document tn.member cannot read: restricted, its ACL owner
// someone else.
func (f *accessRequestFixture) restrictedDoc(t *testing.T) db.Document {
	t.Helper()
	return f.doc(t, f.tn, docSpec{
		ws: f.tn.wsA, visibility: "restricted", aclOwner: f.tn.aclOwner.ID, createdBy: f.tn.aclOwner.ID,
	})
}

// arRow is the part of a request row the create-path tests assert on.
type arRow struct {
	ID             string
	RequestedLevel string
	Message        string
	Status         string
	CreatedBy      string
	SourceKind     pgtype.Text
	SourceID       pgtype.Text
	CreatedAt      time.Time
	ExpiresAt      time.Time
}

func (f *accessRequestFixture) rows(t *testing.T, documentID string) []arRow {
	t.Helper()
	rs, err := f.pool.Query(f.ctx,
		`SELECT id, requested_level, message, status, created_by, source_kind, source_id, created_at, expires_at
		   FROM document_access_requests WHERE document_id = $1 ORDER BY created_at, id`, documentID)
	if err != nil {
		t.Fatal(err)
	}
	defer rs.Close()
	var out []arRow
	for rs.Next() {
		var r arRow
		if err := rs.Scan(&r.ID, &r.RequestedLevel, &r.Message, &r.Status, &r.CreatedBy,
			&r.SourceKind, &r.SourceID, &r.CreatedAt, &r.ExpiresAt); err != nil {
			t.Fatal(err)
		}
		out = append(out, r)
	}
	if err := rs.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

func (f *accessRequestFixture) countRows(t *testing.T, documentID string) int {
	t.Helper()
	return len(f.rows(t, documentID))
}

// auditMeta returns the audit metadata of every document.access_requested row
// of one document, as text.
func (f *accessRequestFixture) auditMeta(t *testing.T, documentID string) []string {
	t.Helper()
	rs, err := f.pool.Query(f.ctx,
		`SELECT metadata::text FROM audit_events WHERE action = $1 AND resource_id = $2 ORDER BY occurred_at`,
		audit.ActionDocumentAccessRequested, documentID)
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

func (f *accessRequestFixture) countOutbox(t *testing.T, documentID string) int {
	t.Helper()
	var n int
	if err := f.pool.QueryRow(f.ctx,
		`SELECT count(*) FROM outbox_events WHERE topic = $1 AND payload::jsonb->>'document_id' = $2`,
		topicDocumentAccessRequested, documentID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// seedDecided writes a decided request row directly: approve and decline are
// w2's commands, and A09 only needs their outcome.
func (f *accessRequestFixture) seedDecided(t *testing.T, doc db.Document, requesterID, status string, decidedAt time.Time) string {
	t.Helper()
	id := util.NewID()
	if _, err := f.pool.Exec(f.ctx,
		`INSERT INTO document_access_requests (
			id, organization_id, workspace_id, document_id, created_by, created_by_kind,
			requested_level, status, decided_by, decided_by_kind, decided_at, expires_at, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, 'human', 'view', $6, $7, 'human', $8, $9, $8, $8)`,
		id, doc.OrganizationID, doc.WorkspaceID, doc.ID, requesterID, status, f.tn.aclOwner.ID,
		decidedAt, decidedAt.Add(accessRequestPendingTTL)); err != nil {
		t.Fatal(err)
	}
	return id
}

// seedPending writes a pending row directly, so a test can place one whose
// expires_at is already past (the "expired" state reads from the column).
func (f *accessRequestFixture) seedPending(t *testing.T, doc db.Document, requesterID, level, message string, expiresAt time.Time) string {
	t.Helper()
	id := util.NewID()
	if _, err := f.pool.Exec(f.ctx,
		`INSERT INTO document_access_requests (
			id, organization_id, workspace_id, document_id, created_by, created_by_kind,
			requested_level, message, status, expires_at, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, 'human', $6, $7, 'pending', $8, $9, $9)`,
		id, doc.OrganizationID, doc.WorkspaceID, doc.ID, requesterID, level, message, expiresAt, f.now); err != nil {
		t.Fatal(err)
	}
	return id
}

// TestDocumentAccessRequestSent is A01: a request from a member who cannot
// read the document stores one pending row, one audit row whose metadata
// carries no message text, and one document.access_requested event.
func TestDocumentAccessRequestSent(t *testing.T) {
	f := newAccessRequestFixture(t, "ar01")
	doc := f.restrictedDoc(t)

	got, err := f.svc.CreateDocumentAccessRequest(f.ctx, Human(f.tn.member.ID), doc.ID, DocumentAccessRequestInput{
		RequestedLevel: "edit", Message: "  mình cần xem để chuẩn bị họp thứ Hai  ",
	})
	if err != nil {
		t.Fatal(err)
	}
	if got != (DocumentAccessRequestResult{Status: AccessRequestSent}) {
		t.Fatalf("result = %+v, want sent", got)
	}

	rows := f.rows(t, doc.ID)
	if len(rows) != 1 {
		t.Fatalf("rows = %d, want 1", len(rows))
	}
	r := rows[0]
	if r.Status != AccessRequestStatusPending || r.RequestedLevel != "edit" || r.CreatedBy != f.tn.member.ID {
		t.Fatalf("row = %+v", r)
	}
	if r.Message != "mình cần xem để chuẩn bị họp thứ Hai" {
		t.Fatalf("message = %q, want it trimmed", r.Message)
	}
	if !r.ExpiresAt.Equal(f.now.Add(accessRequestPendingTTL)) {
		t.Fatalf("expires_at = %s, want %s", r.ExpiresAt, f.now.Add(accessRequestPendingTTL))
	}
	if !r.CreatedAt.Equal(f.now) {
		t.Fatalf("created_at = %s, want the service clock %s", r.CreatedAt, f.now)
	}

	metas := f.auditMeta(t, doc.ID)
	if len(metas) != 1 {
		t.Fatalf("audit rows = %d, want 1", len(metas))
	}
	if strings.Contains(metas[0], "họp thứ Hai") {
		t.Fatalf("audit metadata carries the message text: %s", metas[0])
	}
	var meta map[string]any
	if err := json.Unmarshal([]byte(metas[0]), &meta); err != nil {
		t.Fatalf("audit metadata %s is not JSON: %v", metas[0], err)
	}
	if meta["request_id"] == nil || meta["request_id"] == "" {
		t.Fatalf("audit metadata %s is missing request_id", metas[0])
	}
	if meta["requested_level"] != "edit" {
		t.Fatalf("requested_level = %#v, want edit", meta["requested_level"])
	}
	if meta["has_message"] != true {
		t.Fatalf("has_message = %#v, want true", meta["has_message"])
	}
	if _, ok := meta["source_kind"]; ok {
		t.Fatalf("a request with no source carries source_kind: %s", metas[0])
	}
	if n := f.countOutbox(t, doc.ID); n != 1 {
		t.Fatalf("outbox rows = %d, want 1", n)
	}
}

// TestDocumentAccessRequestUniform is A02/A10: every answer that would say
// something about the document collapses into the same result with no row, no
// audit and no event, and a requester who never sent anything never sees a
// 409 or a 429.
func TestDocumentAccessRequestUniform(t *testing.T) {
	f := newAccessRequestFixture(t, "ar02")
	other := f.tenant(t, "ar02x")

	sent := DocumentAccessRequestResult{Status: AccessRequestSent}
	call := func(t *testing.T, actorID, documentID string, in DocumentAccessRequestInput) DocumentAccessRequestResult {
		t.Helper()
		got, err := f.svc.CreateDocumentAccessRequest(f.ctx, Human(actorID), documentID, in)
		if err != nil {
			t.Fatalf("want sent, got %v", err)
		}
		return got
	}

	t.Run("an id that does not exist", func(t *testing.T) {
		got := call(t, f.tn.member.ID, util.NewID(), DocumentAccessRequestInput{})
		if got != sent {
			t.Fatalf("result = %+v, want sent", got)
		}
	})

	t.Run("another organization's document", func(t *testing.T) {
		foreign := f.doc(t, other, docSpec{ws: other.wsA, visibility: "restricted", aclOwner: other.aclOwner.ID, createdBy: other.aclOwner.ID})
		if got := call(t, f.tn.member.ID, foreign.ID, DocumentAccessRequestInput{}); got != sent {
			t.Fatalf("result = %+v, want sent", got)
		}
		if n := f.countRows(t, foreign.ID); n != 0 {
			t.Fatalf("another organization's document gained %d rows", n)
		}
	})

	t.Run("a requester outside the document's organization", func(t *testing.T) {
		doc := f.restrictedDoc(t)
		if got := call(t, other.owner.ID, doc.ID, DocumentAccessRequestInput{}); got != sent {
			t.Fatalf("result = %+v, want sent", got)
		}
		if n := f.countRows(t, doc.ID); n != 0 {
			t.Fatalf("row stored for a non-member: %d", n)
		}
	})

	t.Run("a deactivated member", func(t *testing.T) {
		doc := f.restrictedDoc(t)
		if got := call(t, f.tn.deact.ID, doc.ID, DocumentAccessRequestInput{}); got != sent {
			t.Fatalf("result = %+v, want sent", got)
		}
		if n := f.countRows(t, doc.ID); n != 0 {
			t.Fatalf("row stored for a deactivated member: %d", n)
		}
	})

	t.Run("a Work Product document", func(t *testing.T) {
		doc := f.doc(t, f.tn, docSpec{
			ws: f.tn.wsA, visibility: "restricted", aclOwner: f.tn.aclOwner.ID, createdBy: f.tn.aclOwner.ID,
			ownerID: util.NewID(),
		})
		if got := call(t, f.tn.member.ID, doc.ID, DocumentAccessRequestInput{}); got != sent {
			t.Fatalf("result = %+v, want sent", got)
		}
		if n := f.countRows(t, doc.ID); n != 0 {
			t.Fatalf("row stored for an owned document: %d", n)
		}
	})

	t.Run("an archived document", func(t *testing.T) {
		doc := f.treeDoc(t, f.tn, treeDocSpec{
			ws: f.tn.wsA, visibility: "restricted", aclOwner: f.tn.aclOwner.ID, createdBy: f.tn.aclOwner.ID,
			archived: true,
		})
		if got := call(t, f.tn.member.ID, doc.ID, DocumentAccessRequestInput{}); got != sent {
			t.Fatalf("result = %+v, want sent", got)
		}
		if n := f.countRows(t, doc.ID); n != 0 {
			t.Fatalf("row stored for an archived document: %d", n)
		}
	})

	t.Run("a requester who already reads it", func(t *testing.T) {
		doc := f.doc(t, f.tn, docSpec{ws: f.tn.wsA, visibility: "workspace", aclOwner: f.tn.aclOwner.ID, createdBy: f.tn.aclOwner.ID})
		for _, level := range []string{"view", "edit"} {
			if got := call(t, f.tn.member.ID, doc.ID, DocumentAccessRequestInput{RequestedLevel: level}); got != sent {
				t.Fatalf("level %s: result = %+v, want sent", level, got)
			}
		}
		if n := f.countRows(t, doc.ID); n != 0 {
			t.Fatalf("row stored for a requester who already reads it: %d", n)
		}
	})

	t.Run("a malformed body is still an error, whatever the document", func(t *testing.T) {
		for _, in := range []DocumentAccessRequestInput{
			{RequestedLevel: "manage"},
			{RequestedLevel: "nonsense"},
			{Message: strings.Repeat("x", accessRequestMessageMax+1)},
			{SourceKind: "task"},
			{SourceID: util.NewID()},
			{SourceKind: "chat", SourceID: util.NewID()},
			{SourceKind: "task", SourceID: "not-a-ulid"},
		} {
			var ve ValidationError
			if _, err := f.svc.CreateDocumentAccessRequest(f.ctx, Human(f.tn.member.ID), util.NewID(), in); !errors.As(err, &ve) {
				t.Fatalf("input %+v: want invalid_request, got %v", in, err)
			}
		}
	})

	t.Run("a comment request is accepted", func(t *testing.T) {
		doc := f.restrictedDoc(t)
		if got := call(t, f.tn.member.ID, doc.ID, DocumentAccessRequestInput{RequestedLevel: "comment"}); got != sent {
			t.Fatalf("result = %+v, want sent", got)
		}
		rows := f.rows(t, doc.ID)
		if len(rows) != 1 || rows[0].RequestedLevel != "comment" {
			t.Fatalf("rows = %+v", rows)
		}
	})

	t.Run("an agent is refused", func(t *testing.T) {
		doc := f.restrictedDoc(t)
		_, err := f.svc.CreateDocumentAccessRequest(f.ctx, agentActor(f.tn.agent), doc.ID, DocumentAccessRequestInput{})
		if !errors.Is(err, ErrForbidden) {
			t.Fatalf("want forbidden, got %v", err)
		}
		if n := f.countRows(t, doc.ID); n != 0 {
			t.Fatalf("agent stored %d rows", n)
		}
	})
}

// TestDocumentAccessRequestPending is A03: one live pending request per
// (document, requester). A second send is 409 with nothing changed, two
// concurrent sends leave exactly one row, and once the row has expired the
// next send refreshes it in place as a new request.
func TestDocumentAccessRequestPending(t *testing.T) {
	f := newAccessRequestFixture(t, "ar03")
	doc := f.restrictedDoc(t)
	actor := Human(f.tn.member.ID)

	if _, err := f.svc.CreateDocumentAccessRequest(f.ctx, actor, doc.ID, DocumentAccessRequestInput{
		RequestedLevel: "view", Message: "lần đầu",
	}); err != nil {
		t.Fatal(err)
	}
	first := f.rows(t, doc.ID)[0]

	t.Run("a second send while pending is 409 and changes nothing", func(t *testing.T) {
		_, err := f.svc.CreateDocumentAccessRequest(f.ctx, actor, doc.ID, DocumentAccessRequestInput{
			RequestedLevel: "edit", Message: "lần hai",
		})
		ce := wantCode(t, err, "access_request_pending")
		if ce.Status != 409 {
			t.Fatalf("status = %d, want 409", ce.Status)
		}
		if rows := f.rows(t, doc.ID); len(rows) != 1 || rows[0] != first {
			t.Fatalf("row changed: %+v", rows)
		}
		if n := len(f.auditMeta(t, doc.ID)); n != 1 {
			t.Fatalf("audit rows = %d, want 1", n)
		}
		if n := f.countOutbox(t, doc.ID); n != 1 {
			t.Fatalf("outbox rows = %d, want 1", n)
		}
	})

	t.Run("an expired row is refreshed in place", func(t *testing.T) {
		f.now = f.now.Add(accessRequestPendingTTL + time.Minute)
		if _, err := f.svc.CreateDocumentAccessRequest(f.ctx, actor, doc.ID, DocumentAccessRequestInput{
			RequestedLevel: "edit", Message: "lần ba",
		}); err != nil {
			t.Fatal(err)
		}
		rows := f.rows(t, doc.ID)
		if len(rows) != 1 {
			t.Fatalf("rows = %d, want the expired row refreshed, not a new one", len(rows))
		}
		r := rows[0]
		if r.ID != first.ID {
			t.Fatalf("row id = %s, want the same row %s", r.ID, first.ID)
		}
		if r.RequestedLevel != "edit" || r.Message != "lần ba" {
			t.Fatalf("refreshed row = %+v", r)
		}
		if !r.CreatedAt.Equal(f.now) || !r.ExpiresAt.Equal(f.now.Add(accessRequestPendingTTL)) {
			t.Fatalf("created_at/expires_at = %s/%s, want the new request's", r.CreatedAt, r.ExpiresAt)
		}
		if n := len(f.auditMeta(t, doc.ID)); n != 2 {
			t.Fatalf("audit rows = %d, want 2", n)
		}
		if n := f.countOutbox(t, doc.ID); n != 2 {
			t.Fatalf("outbox rows = %d, want 2", n)
		}
	})

	t.Run("two concurrent sends store exactly one row", func(t *testing.T) {
		fresh := f.restrictedDoc(t)
		var wg sync.WaitGroup
		errs := make([]error, 2)
		start := make(chan struct{})
		for i := range errs {
			wg.Add(1)
			go func(i int) {
				defer wg.Done()
				<-start
				_, errs[i] = f.svc.CreateDocumentAccessRequest(context.Background(), Human(f.tn.member.ID), fresh.ID,
					DocumentAccessRequestInput{RequestedLevel: "view"})
			}(i)
		}
		close(start)
		wg.Wait()

		sent, pending, other := 0, 0, 0
		for _, err := range errs {
			switch {
			case err == nil:
				sent++
			case codedIs(err, "access_request_pending"):
				pending++
			default:
				other++
				t.Errorf("unexpected error: %v", err)
			}
		}
		if sent != 1 || pending != 1 || other != 0 {
			t.Fatalf("sent=%d pending=%d other=%d, want 1/1/0", sent, pending, other)
		}
		if n := f.countRows(t, fresh.ID); n != 1 {
			t.Fatalf("rows = %d, want exactly 1", n)
		}
	})
}

// TestDocumentAccessRequestCooldown is A09: after a decline the same person on
// the same document waits an hour; anyone else, and any other document, does
// not, and the cooldown counts from the latest decline.
func TestDocumentAccessRequestCooldown(t *testing.T) {
	f := newAccessRequestFixture(t, "ar09")
	doc := f.restrictedDoc(t)
	actor := Human(f.tn.member.ID)
	declinedAt := f.now
	f.seedDecided(t, doc, f.tn.member.ID, AccessRequestStatusDeclined, declinedAt)

	t.Run("59 minutes later the send is 429 with the remaining seconds", func(t *testing.T) {
		f.now = declinedAt.Add(59 * time.Minute)
		_, err := f.svc.CreateDocumentAccessRequest(f.ctx, actor, doc.ID, DocumentAccessRequestInput{})
		ce := wantCode(t, err, "access_request_cooldown")
		if ce.Status != 429 {
			t.Fatalf("status = %d, want 429", ce.Status)
		}
		got, ok := ce.Fields["retry_after_seconds"]
		if !ok {
			t.Fatalf("fields = %+v, want retry_after_seconds", ce.Fields)
		}
		if secs, ok := got.(int); !ok || secs != 60 {
			t.Fatalf("retry_after_seconds = %#v, want 60", got)
		}
		if n := f.countRows(t, doc.ID); n != 1 {
			t.Fatalf("rows = %d, want only the declined one", n)
		}
		if n := len(f.auditMeta(t, doc.ID)); n != 0 {
			t.Fatalf("audit rows = %d, want none", n)
		}
	})

	t.Run("another requester is not in cooldown", func(t *testing.T) {
		other := f.restrictedDoc(t)
		if _, err := f.svc.CreateDocumentAccessRequest(f.ctx, Human(f.tn.creator.ID), other.ID, DocumentAccessRequestInput{}); err != nil {
			t.Fatalf("want sent, got %v", err)
		}
	})

	t.Run("another document of the same requester is not in cooldown", func(t *testing.T) {
		other := f.restrictedDoc(t)
		if _, err := f.svc.CreateDocumentAccessRequest(f.ctx, actor, other.ID, DocumentAccessRequestInput{}); err != nil {
			t.Fatalf("want sent, got %v", err)
		}
	})

	t.Run("an hour later the send lands and the declined row is untouched", func(t *testing.T) {
		f.now = declinedAt.Add(time.Hour)
		if _, err := f.svc.CreateDocumentAccessRequest(f.ctx, actor, doc.ID, DocumentAccessRequestInput{}); err != nil {
			t.Fatalf("want sent, got %v", err)
		}
		rows := f.rows(t, doc.ID)
		if len(rows) != 2 {
			t.Fatalf("rows = %d, want the declined one plus a new pending one", len(rows))
		}
		if rows[0].Status != AccessRequestStatusDeclined || rows[1].Status != AccessRequestStatusPending {
			t.Fatalf("rows = %+v", rows)
		}
	})

	t.Run("the cooldown counts from the latest decline", func(t *testing.T) {
		other := f.restrictedDoc(t)
		f.seedDecided(t, other, f.tn.member.ID, AccessRequestStatusDeclined, f.now.Add(-2*time.Hour))
		f.seedDecided(t, other, f.tn.member.ID, AccessRequestStatusDeclined, f.now.Add(-30*time.Minute))
		_, err := f.svc.CreateDocumentAccessRequest(f.ctx, actor, other.ID, DocumentAccessRequestInput{})
		ce := wantCode(t, err, "access_request_cooldown")
		if secs, _ := ce.Fields["retry_after_seconds"].(int); secs != 1800 {
			t.Fatalf("retry_after_seconds = %#v, want 1800 from the latest decline", ce.Fields["retry_after_seconds"])
		}
	})
}

// TestDocumentAccessRequestReSendAfterClosed is A10: a cancelled or approved
// request leaves no cooldown, and an expired row is refreshed rather than
// refused - only a decline does.
func TestDocumentAccessRequestReSendAfterClosed(t *testing.T) {
	f := newAccessRequestFixture(t, "ar10")
	actor := Human(f.tn.member.ID)

	for _, status := range []string{AccessRequestStatusCancelled, AccessRequestStatusApproved} {
		t.Run(status+" leaves no cooldown", func(t *testing.T) {
			doc := f.restrictedDoc(t)
			f.seedDecided(t, doc, f.tn.member.ID, status, f.now.Add(-time.Minute))
			if _, err := f.svc.CreateDocumentAccessRequest(f.ctx, actor, doc.ID, DocumentAccessRequestInput{}); err != nil {
				t.Fatalf("want sent, got %v", err)
			}
			rows := f.rows(t, doc.ID)
			if len(rows) != 2 || rows[0].Status != status || rows[1].Status != AccessRequestStatusPending {
				t.Fatalf("rows = %+v", rows)
			}
		})
	}

	t.Run("an expired row is refreshed, not refused", func(t *testing.T) {
		doc := f.restrictedDoc(t)
		id := f.seedPending(t, doc, f.tn.member.ID, "view", "cũ", f.now.Add(-time.Minute))
		if _, err := f.svc.CreateDocumentAccessRequest(f.ctx, actor, doc.ID, DocumentAccessRequestInput{RequestedLevel: "edit"}); err != nil {
			t.Fatalf("want sent, got %v", err)
		}
		rows := f.rows(t, doc.ID)
		if len(rows) != 1 || rows[0].ID != id || rows[0].RequestedLevel != "edit" {
			t.Fatalf("rows = %+v", rows)
		}
	})

	t.Run("a pending row that has not expired is still refused", func(t *testing.T) {
		doc := f.restrictedDoc(t)
		f.seedPending(t, doc, f.tn.member.ID, "view", "mới", f.now.Add(time.Hour))
		_, err := f.svc.CreateDocumentAccessRequest(f.ctx, actor, doc.ID, DocumentAccessRequestInput{})
		wantCode(t, err, "access_request_pending")
	})
}

// TestDocumentAccessRequestSource is A06: the task/meeting pair survives only
// when the requester reads that row and it belongs to the document's own
// organization; every other answer drops it silently.
func TestDocumentAccessRequestSource(t *testing.T) {
	f := newAccessRequestFixture(t, "ar06")
	other := f.tenant(t, "ar06x")

	tasks := NewTaskService(f.pool, f.q, f.svc.ws, newMemStorage())
	meetingsSvc := NewMeetingService(f.pool, f.q, f.svc.ws, NopPublisher{}, &meetings.FakeProvider{},
		MeetingRuntime{TokenTTL: time.Minute, HMACKey: []byte("t")})
	f.svc.SetAccessRequestSources(tasks, meetingsSvc)

	seedTask := func(t *testing.T, tn docTenant, wsID string) string {
		t.Helper()
		id := util.NewID()
		if _, err := f.pool.Exec(f.ctx,
			`INSERT INTO tasks (id, workspace_id, organization_id, number, title, description, created_by, creator_type, creator_id, last_activity_at)
			 VALUES ($1, $2, $3, (SELECT COALESCE(max(number), 0) + 1 FROM tasks WHERE workspace_id = $2), 'Task', '', $4, 'member', $4, now())`,
			id, wsID, tn.orgID, tn.owner.ID); err != nil {
			t.Fatal(err)
		}
		return id
	}
	seedMeeting := func(t *testing.T, tn docTenant, wsID string) string {
		t.Helper()
		id := util.NewID()
		if _, err := f.pool.Exec(f.ctx,
			`INSERT INTO meetings (id, workspace_id, organization_id, title, starts_at, ends_at, room_name, created_by, host_user_id)
			 VALUES ($1, $2, $3, 'Meeting', now(), now() + interval '1 hour', $4, $5, $5)`,
			id, wsID, tn.orgID, "lk-"+id, tn.owner.ID); err != nil {
			t.Fatal(err)
		}
		return id
	}
	sourceOf := func(t *testing.T, docID string) (pgtype.Text, pgtype.Text) {
		t.Helper()
		rows := f.rows(t, docID)
		if len(rows) != 1 {
			t.Fatalf("rows = %d, want 1", len(rows))
		}
		return rows[0].SourceKind, rows[0].SourceID
	}
	send := func(t *testing.T, kind, id string) (pgtype.Text, pgtype.Text) {
		t.Helper()
		doc := f.restrictedDoc(t)
		if _, err := f.svc.CreateDocumentAccessRequest(f.ctx, Human(f.tn.member.ID), doc.ID, DocumentAccessRequestInput{
			SourceKind: kind, SourceID: id,
		}); err != nil {
			t.Fatalf("want sent, got %v", err)
		}
		return sourceOf(t, doc.ID)
	}

	t.Run("a task the requester reads is kept", func(t *testing.T) {
		task := seedTask(t, f.tn, f.tn.wsA)
		kind, id := send(t, AccessRequestSourceKindTask, task)
		if !kind.Valid || kind.String != AccessRequestSourceKindTask || !id.Valid || id.String != task {
			t.Fatalf("source = %+v/%+v, want the task", kind, id)
		}
	})

	t.Run("a meeting the requester reads is kept", func(t *testing.T) {
		meeting := seedMeeting(t, f.tn, f.tn.wsA)
		kind, id := send(t, AccessRequestSourceKindMeeting, meeting)
		if !kind.Valid || kind.String != AccessRequestSourceKindMeeting || !id.Valid || id.String != meeting {
			t.Fatalf("source = %+v/%+v, want the meeting", kind, id)
		}
	})

	t.Run("a task of a workspace the requester is not in is dropped", func(t *testing.T) {
		task := seedTask(t, f.tn, f.tn.wsB)
		if kind, id := send(t, AccessRequestSourceKindTask, task); kind.Valid || id.Valid {
			t.Fatalf("source = %+v/%+v, want it dropped", kind, id)
		}
	})

	t.Run("another organization's task is dropped", func(t *testing.T) {
		task := seedTask(t, other, other.wsA)
		if kind, id := send(t, AccessRequestSourceKindTask, task); kind.Valid || id.Valid {
			t.Fatalf("source = %+v/%+v, want it dropped", kind, id)
		}
	})

	// The "another organization" case above is refused by the task gate alone
	// (the requester is not a member of the other organization), so it cannot
	// prove the organization check of resolveAccessRequestSource. This one
	// can: the requester is a member of BOTH organizations - the legacy shape
	// the isolation world inserts by raw SQL, since no API creates it any more
	// (ADR 0032) - so the task gate passes and only the organization comparison
	// drops the pair.
	t.Run("a task of another organization the requester is also a member of is dropped", func(t *testing.T) {
		if _, err := f.pool.Exec(f.ctx,
			`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'member')`,
			other.orgID, f.tn.member.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := f.pool.Exec(f.ctx,
			`INSERT INTO workspace_members (workspace_id, user_id, role, organization_id) VALUES ($1, $2, 'member', $3)`,
			other.wsA, f.tn.member.ID, other.orgID); err != nil {
			t.Fatal(err)
		}
		task := seedTask(t, other, other.wsA)
		kind, id := send(t, AccessRequestSourceKindTask, task)
		if kind.Valid || id.Valid {
			t.Fatalf("source = %+v/%+v, want it dropped: the task is another organization's", kind, id)
		}
	})

	t.Run("an id that does not exist is dropped", func(t *testing.T) {
		if kind, id := send(t, AccessRequestSourceKindTask, util.NewID()); kind.Valid || id.Valid {
			t.Fatalf("source = %+v/%+v, want it dropped", kind, id)
		}
	})

	t.Run("an unwired port drops the source", func(t *testing.T) {
		f.svc.SetAccessRequestSources(nil, nil)
		task := seedTask(t, f.tn, f.tn.wsA)
		if kind, id := send(t, AccessRequestSourceKindTask, task); kind.Valid || id.Valid {
			t.Fatalf("source = %+v/%+v, want it dropped", kind, id)
		}
	})
}

// TestDocumentAccessRequestDoesNotGrant is A07's create half: storing a request
// changes no level, so every read path still refuses the requester until a
// manager answers.
func TestDocumentAccessRequestDoesNotGrant(t *testing.T) {
	f := newAccessRequestFixture(t, "ar07")
	doc := f.restrictedDoc(t)
	if _, err := f.svc.CreateDocumentAccessRequest(f.ctx, Human(f.tn.member.ID), doc.ID, DocumentAccessRequestInput{}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := f.svc.authorizeDocument(f.ctx, Human(f.tn.member.ID), doc.ID, DocumentLevelView); !errors.Is(err, ErrNotFound) {
		t.Fatalf("read after a request = %v, want not found", err)
	}
	var shares int
	if err := f.pool.QueryRow(f.ctx,
		`SELECT count(*) FROM document_shares WHERE document_id = $1`, doc.ID).Scan(&shares); err != nil {
		t.Fatal(err)
	}
	if shares != 0 {
		t.Fatalf("a request created %d shares", shares)
	}
}
