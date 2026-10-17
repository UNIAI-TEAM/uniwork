package notification

import (
	"encoding/json"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// SH-S3 (UNI-1782; addendum §8, §10 Q-S2): KindDocumentShared notifications.
// A direct user share notifies the recipient only when their effective level on
// the document strictly rises compared to before the command, and only while
// they can still read the document at delivery time.

func (f *documentFixture) addOrgOutsider(t *testing.T, email, name string) db.User {
	t.Helper()
	u := f.user(t, email, name)
	if err := f.q.AddOrganizationMember(f.ctx, db.AddOrganizationMemberParams{
		OrganizationID: f.orgID, UserID: u.ID, Role: "member",
	}); err != nil {
		t.Fatal(err)
	}
	return u
}

func (f *documentFixture) sharedNotifications(t *testing.T, userID string) []db.Notification {
	t.Helper()
	var out []db.Notification
	for _, n := range f.inbox(t, userID) {
		if n.Kind == KindDocumentShared {
			out = append(out, n)
		}
	}
	return out
}

func decodeNotificationParams(t *testing.T, n db.Notification) map[string]string {
	t.Helper()
	var params map[string]string
	if err := json.Unmarshal([]byte(n.Params), &params); err != nil {
		t.Fatal(err)
	}
	return params
}

// TestDocumentSharedGrantNewAndRaiseNotifiesRecipient covers:
// - grant new (none -> view) -> one notification + push on by default + deep link
// - raise view -> edit -> notifies with updated level
// - lower edit -> view -> no notification
func TestDocumentSharedGrantNewAndRaiseNotifiesRecipient(t *testing.T) {
	f := newDocumentFixture(t)
	recipient := f.addOrgOutsider(t, "share-new@example.com", "Người Nhận")
	if err := f.q.AddWorkspaceMember(f.ctx, db.AddWorkspaceMemberParams{
		WorkspaceID: f.wsID, OrganizationID: f.orgID, UserID: recipient.ID, Role: "member",
	}); err != nil {
		t.Fatal(err)
	}
	docID := f.document(t, "restricted", "Kế hoạch năm")

	// 1. Grant new (none -> view) -> 1 notification + 1 push event.
	pushBefore := len(f.events(t, TopicPush))
	if _, err := f.docs.ShareDocument(f.ctx, service.Human(f.owner.ID), docID, service.DocumentShareInput{
		PrincipalType: service.DocumentPrincipalUser,
		PrincipalID:   recipient.ID,
		Level:         service.DocumentLevelView,
	}); err != nil {
		t.Fatalf("share view: %v", err)
	}
	f.handleLast(t, "document.shared")

	got := f.sharedNotifications(t, recipient.ID)
	if len(got) != 1 {
		t.Fatalf("recipient notifications after grant new = %d, want 1", len(got))
	}
	if got[0].GroupKey != "document:"+docID+":shared" || got[0].ResourceType != "document" || got[0].ResourceID != docID {
		t.Fatalf("notification row = %+v", got[0])
	}
	p := decodeNotificationParams(t, got[0])
	if p["actor"] != f.owner.DisplayName || p["document"] != "Kế hoạch năm" || p["document_id"] != docID || p["level"] != "view" {
		t.Fatalf("notification params = %v", p)
	}
	if n := len(f.events(t, TopicPush)) - pushBefore; n != 1 {
		t.Fatalf("push events = %d, want 1 (push on by default)", n)
	}

	// Verify push deep link opens /{org}/{ws}/documents/{id}.
	f.subscribe(t, recipient.ID, "https://push.example/doc-shared")
	spy := &spySender{}
	pc := NewPushConsumer(f.q, spy, "http://app.test")
	if err := pc.Handle(f.ctx, f.lastEvent(t, TopicPush)); err != nil {
		t.Fatal(err)
	}
	if len(spy.sent) != 1 || spy.sent[0].URL != "http://app.test/notif-org/notif-ws/documents/"+docID {
		t.Fatalf("push sent = %+v, want deep link to document", spy.sent)
	}

	// Mark the first notification read so a subsequent notification creates a
	// second row instead of merging into the unread one.
	if _, err := f.pool.Exec(f.ctx, `UPDATE notifications SET read_at = now() WHERE id = $1`, got[0].ID); err != nil {
		t.Fatal(err)
	}

	// 2. Raise view -> edit -> 1 new notification with level=edit.
	if _, err := f.docs.ShareDocument(f.ctx, service.Human(f.owner.ID), docID, service.DocumentShareInput{
		PrincipalType: service.DocumentPrincipalUser,
		PrincipalID:   recipient.ID,
		Level:         service.DocumentLevelEdit,
	}); err != nil {
		t.Fatalf("raise to edit: %v", err)
	}
	f.handleLast(t, "document.shared")

	got = f.sharedNotifications(t, recipient.ID)
	if len(got) != 2 {
		t.Fatalf("recipient notifications after raise view->edit = %d, want 2", len(got))
	}
	if p := decodeNotificationParams(t, got[0]); p["level"] != "edit" {
		t.Fatalf("raised notification params = %v, want level=edit", p)
	}
	if _, err := f.pool.Exec(f.ctx, `UPDATE notifications SET read_at = now() WHERE id = $1`, got[0].ID); err != nil {
		t.Fatal(err)
	}

	// 3. Lower edit -> view -> 0 new notifications, and outbox payload carries no notify_user_id.
	if _, err := f.docs.ShareDocument(f.ctx, service.Human(f.owner.ID), docID, service.DocumentShareInput{
		PrincipalType: service.DocumentPrincipalUser,
		PrincipalID:   recipient.ID,
		Level:         service.DocumentLevelView,
	}); err != nil {
		t.Fatalf("lower to view: %v", err)
	}
	lastEv := f.lastEvent(t, "document.shared")
	var evPayload map[string]string
	if err := json.Unmarshal([]byte(lastEv.Payload), &evPayload); err != nil {
		t.Fatal(err)
	}
	if _, has := evPayload["notify_user_id"]; has {
		t.Fatalf("downgrade event carries notify_user_id: %v", evPayload)
	}
	f.handleLast(t, "document.shared")
	if got = f.sharedNotifications(t, recipient.ID); len(got) != 2 {
		t.Fatalf("recipient notifications after downgrade edit->view = %d, want still 2", len(got))
	}
}

// TestDocumentSharedSkipsWorkspaceOrgAndExistingHigherOrEqualAccess covers:
// - workspace share -> none
// - organization share -> none
// - already edit via home row, then direct edit -> none
// - self-share -> none
func TestDocumentSharedSkipsWorkspaceOrgAndExistingHigherOrEqualAccess(t *testing.T) {
	f := newDocumentFixture(t)
	otherWS, err := f.ws.CreateInOrg(f.ctx, f.owner.ID, f.orgID, "Sibling WS", "sibling-ws-share")
	if err != nil {
		t.Fatal(err)
	}
	siblingMember := f.addOrgOutsider(t, "sibling@example.com", "Thành Viên Nhóm Kia")
	if err := f.q.AddWorkspaceMember(f.ctx, db.AddWorkspaceMemberParams{
		WorkspaceID: otherWS.ID, OrganizationID: f.orgID, UserID: siblingMember.ID, Role: "member",
	}); err != nil {
		t.Fatal(err)
	}

	// Workspace-visible document (home row grants edit to f.member).
	docID := f.document(t, "workspace", "Tài liệu chung")

	// 1. Workspace share to otherWS -> no notification.
	if _, err := f.docs.ShareDocument(f.ctx, service.Human(f.owner.ID), docID, service.DocumentShareInput{
		PrincipalType: service.DocumentPrincipalWorkspace,
		PrincipalID:   otherWS.ID,
		Level:         service.DocumentLevelView,
	}); err != nil {
		t.Fatal(err)
	}
	f.handleLast(t, "document.shared")
	if got := f.sharedNotifications(t, siblingMember.ID); len(got) != 0 {
		t.Fatalf("workspace share notified member: %+v", got)
	}

	// 2. Organization share -> no notification.
	if _, err := f.docs.ShareDocument(f.ctx, service.Human(f.owner.ID), docID, service.DocumentShareInput{
		PrincipalType: service.DocumentPrincipalOrganization,
		PrincipalID:   f.orgID,
		Level:         service.DocumentLevelView,
	}); err != nil {
		t.Fatal(err)
	}
	f.handleLast(t, "document.shared")
	if got := f.sharedNotifications(t, siblingMember.ID); len(got) != 0 {
		t.Fatalf("organization share notified member: %+v", got)
	}

	// 3. f.member already holds edit via the home row (visibility='workspace',
	// workspace_level='edit'); granting direct edit (or view) does not raise
	// their effective level -> no notification.
	if _, err := f.docs.ShareDocument(f.ctx, service.Human(f.owner.ID), docID, service.DocumentShareInput{
		PrincipalType: service.DocumentPrincipalUser,
		PrincipalID:   f.member.ID,
		Level:         service.DocumentLevelEdit,
	}); err != nil {
		t.Fatal(err)
	}
	f.handleLast(t, "document.shared")
	if got := f.sharedNotifications(t, f.member.ID); len(got) != 0 {
		t.Fatalf("member already at edit via home row was notified: %+v", got)
	}

	// 4. Self-share by owner -> no notification.
	if _, err := f.docs.ShareDocument(f.ctx, service.Human(f.owner.ID), docID, service.DocumentShareInput{
		PrincipalType: service.DocumentPrincipalUser,
		PrincipalID:   f.owner.ID,
		Level:         service.DocumentLevelManage,
	}); err != nil {
		t.Fatal(err)
	}
	f.handleLast(t, "document.shared")
	if got := f.sharedNotifications(t, f.owner.ID); len(got) != 0 {
		t.Fatalf("self-share notified actor: %+v", got)
	}
}

// TestDocumentSharedDropsWhenRecipientLostReadBeforeSend verifies the
// delivery-time CanReadDocument gate: if the share is revoked before the
// notify consumer processes document.shared, no notification is created.
func TestDocumentSharedDropsWhenRecipientLostReadBeforeSend(t *testing.T) {
	f := newDocumentFixture(t)
	recipient := f.addOrgOutsider(t, "lost-read@example.com", "Mất Quyền")
	docID := f.document(t, "restricted", "Tài liệu thu hồi nhanh")

	sh, err := f.docs.ShareDocument(f.ctx, service.Human(f.owner.ID), docID, service.DocumentShareInput{
		PrincipalType: service.DocumentPrincipalUser,
		PrincipalID:   recipient.ID,
		Level:         service.DocumentLevelView,
	})
	if err != nil {
		t.Fatal(err)
	}
	sharedEv := f.lastEvent(t, "document.shared")

	if err := f.docs.RevokeDocumentShare(f.ctx, service.Human(f.owner.ID), docID, sh.ID); err != nil {
		t.Fatal(err)
	}
	if err := f.consumer.Handle(f.ctx, sharedEv); err != nil {
		t.Fatal(err)
	}
	if got := f.sharedNotifications(t, recipient.ID); len(got) != 0 {
		t.Fatalf("recipient who lost read before send received notification: %+v", got)
	}
}

// TestDocumentSharedBatchNotifiesEachRisenUser verifies that ShareDocumentBatch
// notifies each user whose effective level rose and skips users in the same
// batch whose effective level did not rise.
func TestDocumentSharedBatchNotifiesEachRisenUser(t *testing.T) {
	f := newDocumentFixture(t)
	u1 := f.addOrgOutsider(t, "batch1@example.com", "Người Lô 1")
	u2 := f.addOrgOutsider(t, "batch2@example.com", "Người Lô 2")
	docID := f.document(t, "workspace", "Tài liệu chia sẻ lô")

	// f.member already holds edit via the home row; u1 and u2 hold none.
	shares, err := f.docs.ShareDocumentBatch(
		f.ctx,
		service.Human(f.owner.ID),
		docID,
		[]string{u1.ID, f.member.ID, u2.ID},
		service.DocumentLevelEdit,
	)
	if err != nil {
		t.Fatalf("ShareDocumentBatch: %v", err)
	}
	if len(shares) != 3 {
		t.Fatalf("shares = %d, want 3", len(shares))
	}

	evs := f.events(t, "document.shared")
	if len(evs) != 3 {
		t.Fatalf("document.shared events = %d, want 3", len(evs))
	}
	for _, ev := range evs {
		if err := f.consumer.Handle(f.ctx, ev); err != nil {
			t.Fatal(err)
		}
	}

	for name, uid := range map[string]string{"u1": u1.ID, "u2": u2.ID} {
		got := f.sharedNotifications(t, uid)
		if len(got) != 1 {
			t.Fatalf("%s notifications = %d, want 1", name, len(got))
		}
		if p := decodeNotificationParams(t, got[0]); p["level"] != "edit" || p["document_id"] != docID {
			t.Fatalf("%s params = %v", name, p)
		}
	}
	if got := f.sharedNotifications(t, f.member.ID); len(got) != 0 {
		t.Fatalf("f.member (already at edit via home row) was notified in batch: %+v", got)
	}
}
