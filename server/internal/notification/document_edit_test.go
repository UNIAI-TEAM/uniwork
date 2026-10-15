package notification

// UNI-1645 (addendum §5.2): the three edit-lock kinds. The rules read only
// the outbox row, the document and - for the answer - the audit row of the
// same correlation, so the rows under test are built by hand: the lock
// service that emits them is separate work, and what matters here is who is
// notified, with which params, and who is not.

import (
	"encoding/json"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/outbox"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// editEvent is the outbox row of one edit-lock topic as the lock service
// will write it: ids only, the actor and correlation of the command.
func (f *documentFixture) editEvent(t *testing.T, topic, actorID, correlationID string, payload map[string]string) outbox.Row {
	t.Helper()
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	return db.OutboxEvent{
		ID: util.NewID(), Topic: topic, Payload: string(raw),
		WorkspaceID:    pgtype.Text{String: f.wsID, Valid: true},
		OrganizationID: pgtype.Text{String: f.orgID, Valid: true},
		CorrelationID:  pgtype.Text{String: correlationID, Valid: correlationID != ""},
		ActorKind:      pgtype.Text{String: "human", Valid: true},
		ActorID:        pgtype.Text{String: actorID, Valid: true},
	}
}

func (f *documentFixture) handleEdit(t *testing.T, ev outbox.Row) {
	t.Helper()
	if err := f.consumer.Handle(f.ctx, ev); err != nil {
		t.Fatal(err)
	}
}

// answerAudit writes the audit row the answer command writes next to its
// event; the rule reads metadata.decision from it.
func (f *documentFixture) answerAudit(t *testing.T, resourceID, correlationID, decision string) {
	t.Helper()
	if _, err := f.pool.Exec(f.ctx,
		`INSERT INTO audit_events (id, organization_id, workspace_id, actor_kind, actor_id, action, resource_type, resource_id, correlation_id, metadata)
		 VALUES ($1,$2,$3,'human',$4,'document.edit_request_answered','document',$5,$6,$7)`,
		util.NewID(), f.orgID, f.wsID, f.member.ID, resourceID, correlationID, `{"decision":"`+decision+`"}`); err != nil {
		t.Fatal(err)
	}
}

func editPayload(docID, wsID, userID, requestID string) map[string]string {
	p := map[string]string{"document_id": docID, "workspace_id": wsID, "user_id": userID}
	if requestID != "" {
		p["request_id"] = requestID
	}
	return p
}

// The holder is told, in-app, with the request id the deep link needs; the
// requester (the actor) is not.
func TestDocumentEditRequestedNotifiesTheHolder(t *testing.T) {
	f := newDocumentFixture(t)
	docID := f.document(t, "workspace", "Bản kế hoạch")
	reqID := util.NewID()

	// member holds the lock, owner asks.
	f.handleEdit(t, f.editEvent(t, "document.edit_requested", f.owner.ID, "", editPayload(docID, f.wsID, f.member.ID, reqID)))

	got := f.inbox(t, f.member.ID)
	if len(got) != 1 || got[0].Kind != KindDocumentEditRequested || got[0].TitleKey != "notifications.kind.document_edit_requested" {
		t.Fatalf("holder inbox = %+v", got)
	}
	if got[0].ResourceType != "document" || got[0].ResourceID != docID || got[0].ActorID != f.owner.ID {
		t.Fatalf("row = %+v", got[0])
	}
	var params map[string]string
	if err := json.Unmarshal([]byte(got[0].Params), &params); err != nil {
		t.Fatal(err)
	}
	if params["request_id"] != reqID || params["document"] != "Bản kế hoạch" || params["actor"] != f.owner.DisplayName {
		t.Fatalf("params = %v", params)
	}
	if n := f.inbox(t, f.owner.ID); len(n) != 0 {
		t.Fatalf("the requester was notified: %+v", n)
	}
}

// A holder who can no longer read the document (their only path was a share,
// revoked before the consumer ran) gets nothing, for each of the three topics.
func TestDocumentEditKindsNeedReadAccess(t *testing.T) {
	f := newDocumentFixture(t)
	docID := f.document(t, "restricted", "Tài liệu hạn chế")
	holder, share := f.sharedCommentAuthor(t, docID, "edit-revoked@example.com", "Người Bị Thu Hồi")
	f.revokeShare(t, share, docID)
	reqID := util.NewID()
	f.answerAudit(t, reqID, "corr-revoked", "accept")

	f.handleEdit(t, f.editEvent(t, "document.edit_requested", f.owner.ID, "", editPayload(docID, f.wsID, holder.ID, reqID)))
	f.handleEdit(t, f.editEvent(t, "document.lock_taken_over", f.owner.ID, "", editPayload(docID, f.wsID, holder.ID, "")))
	f.handleEdit(t, f.editEvent(t, "document.edit_request_answered", f.owner.ID, "corr-revoked", editPayload(docID, f.wsID, holder.ID, reqID)))
	if n := f.inbox(t, holder.ID); len(n) != 0 {
		t.Fatalf("a person who cannot read the document was notified: %+v", n)
	}
}

// The previous holder hears of a take-over; two take-overs are two rows, and
// the manager who did it is never told about their own action.
func TestDocumentEditTakenOverNotifiesThePreviousHolder(t *testing.T) {
	f := newDocumentFixture(t)
	docID := f.document(t, "workspace", "Bị lấy quyền")

	f.handleEdit(t, f.editEvent(t, "document.lock_taken_over", f.owner.ID, "", editPayload(docID, f.wsID, f.member.ID, "")))
	f.handleEdit(t, f.editEvent(t, "document.lock_taken_over", f.owner.ID, "", editPayload(docID, f.wsID, f.member.ID, "")))

	got := f.inbox(t, f.member.ID)
	if len(got) != 2 {
		t.Fatalf("previous holder inbox = %+v, want one row per take-over", got)
	}
	for _, n := range got {
		if n.Kind != KindDocumentEditTakenOver || n.ResourceID != docID {
			t.Fatalf("row = %+v", n)
		}
	}
	if n := f.inbox(t, f.owner.ID); len(n) != 0 {
		t.Fatalf("the manager was notified: %+v", n)
	}

	// A take-over of your own tenure by yourself (same user, other device)
	// is no news either.
	f.handleEdit(t, f.editEvent(t, "document.lock_taken_over", f.member.ID, "", editPayload(docID, f.wsID, f.member.ID, "")))
	if n := f.inbox(t, f.member.ID); len(n) != 2 {
		t.Fatalf("self take-over added a row: %+v", n)
	}
}

// The requester hears the answer; the declined sentence is chosen by the
// decision the audit row carries, and no audit row means no guess.
func TestDocumentEditRequestAnsweredCarriesTheDecision(t *testing.T) {
	f := newDocumentFixture(t)
	docID := f.document(t, "workspace", "Trả lời yêu cầu")

	// accept: the audit row files the request as its resource.
	acceptReq := util.NewID()
	f.answerAudit(t, acceptReq, "corr-accept", "accept")
	f.handleEdit(t, f.editEvent(t, "document.edit_request_answered", f.member.ID, "corr-accept", editPayload(docID, f.wsID, f.owner.ID, acceptReq)))
	// decline: the audit row files the document as its resource.
	declineReq := util.NewID()
	f.answerAudit(t, docID, "corr-decline", "decline")
	f.handleEdit(t, f.editEvent(t, "document.edit_request_answered", f.member.ID, "corr-decline", editPayload(docID, f.wsID, f.owner.ID, declineReq)))
	// no audit row at all: nothing is written.
	f.handleEdit(t, f.editEvent(t, "document.edit_request_answered", f.member.ID, "corr-missing", editPayload(docID, f.wsID, f.owner.ID, util.NewID())))

	got := f.inbox(t, f.owner.ID)
	if len(got) != 2 {
		t.Fatalf("requester inbox = %+v, want accept and decline only", got)
	}
	decisions := map[string]string{}
	for _, n := range got {
		if n.Kind != KindDocumentEditRequestAnswered || n.TitleKey != "notifications.kind.document_edit_request_answered" {
			t.Fatalf("row = %+v", n)
		}
		var params map[string]string
		if err := json.Unmarshal([]byte(n.Params), &params); err != nil {
			t.Fatal(err)
		}
		decisions[params["request_id"]] = params["decision"]
	}
	if decisions[acceptReq] != "accept" || decisions[declineReq] != "decline" {
		t.Fatalf("decisions = %v", decisions)
	}
	if n := f.inbox(t, f.member.ID); len(n) != 0 {
		t.Fatalf("the holder who answered was notified: %+v", n)
	}
}

// An event whose workspace is not the document's workspace is dropped: the
// document id came from the payload, so the tenant pair is re-proved.
func TestDocumentEditKindsRejectAForeignTenantEvent(t *testing.T) {
	f := newDocumentFixture(t)
	docID := f.document(t, "workspace", "Của tổ chức khác")
	ev := f.editEvent(t, "document.lock_taken_over", f.owner.ID, "", editPayload(docID, f.wsID, f.member.ID, ""))
	ev.OrganizationID = pgtype.Text{String: util.NewID(), Valid: true}
	f.handleEdit(t, ev)
	if n := f.inbox(t, f.member.ID); len(n) != 0 {
		t.Fatalf("a foreign-tenant event notified: %+v", n)
	}
}

// Push is on for the request and the take-over only (Q6); the answer stays
// in-app. Every kind keeps the digest on like the rest.
func TestDocumentEditKindsDefaultPrefs(t *testing.T) {
	for kind, push := range map[string]bool{
		KindDocumentEditRequested:       true,
		KindDocumentEditTakenOver:       true,
		KindDocumentEditRequestAnswered: false,
	} {
		p := DefaultPrefs(kind)
		if !p.InApp || !p.Email || p.Push != push {
			t.Errorf("DefaultPrefs(%s) = %+v, want in-app, email, push=%v", kind, p, push)
		}
	}
}

// The declined sentence is picked by the decision param; the accepted one is
// the kind's own entry, and the document name stays verbatim.
func TestEditRequestAnsweredTitleFollowsTheDecision(t *testing.T) {
	params := map[string]string{"actor": "An", "document": "Kế hoạch"}
	if got, want := Title("vi", KindDocumentEditRequestAnswered, params), "An đã nhường quyền sửa “Kế hoạch” cho bạn"; got != want {
		t.Fatalf("accepted vi = %q, want %q", got, want)
	}
	params["decision"] = "decline"
	if got, want := Title("vi", KindDocumentEditRequestAnswered, params), "An chưa nhả quyền sửa “Kế hoạch”"; got != want {
		t.Fatalf("declined vi = %q, want %q", got, want)
	}
	if got, want := Title("en", KindDocumentEditRequestAnswered, params), "An is still editing “Kế hoạch”"; got != want {
		t.Fatalf("declined en = %q, want %q", got, want)
	}
	if got, want := Title("en", KindDocumentEditRequested, map[string]string{"actor": "An", "document": "D"}), "An wants to edit “D”"; got != want {
		t.Fatalf("requested en = %q, want %q", got, want)
	}
}

// The holder's push opens the document with the request id, the others open
// the plain document.
func TestResourceURLEditRequestDeepLink(t *testing.T) {
	f := newDocumentFixture(t)
	docID := f.document(t, "workspace", "Liên kết yêu cầu")
	reqID := util.NewID()
	f.handleEdit(t, f.editEvent(t, "document.edit_requested", f.owner.ID, "", editPayload(docID, f.wsID, f.member.ID, reqID)))
	f.handleEdit(t, f.editEvent(t, "document.lock_taken_over", f.owner.ID, "", editPayload(docID, f.wsID, f.member.ID, "")))

	want := map[string]string{
		KindDocumentEditRequested: "https://app.test/notif-org/notif-ws/documents/" + docID + "?edit_request=" + reqID,
		KindDocumentEditTakenOver: "https://app.test/notif-org/notif-ws/documents/" + docID,
	}
	for _, n := range f.inbox(t, f.member.ID) {
		got, err := ResourceURL(f.ctx, f.q, "https://app.test", n)
		if err != nil {
			t.Fatal(err)
		}
		if got != want[n.Kind] {
			t.Fatalf("%s url = %q, want %q", n.Kind, got, want[n.Kind])
		}
	}
}
