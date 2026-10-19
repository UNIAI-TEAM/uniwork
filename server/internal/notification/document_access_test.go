package notification

// DOC-07 (UNI-1631) manager-side notifications: the request reaches the
// document's managers (ACL owner, manage shares, or the workspace owners and
// admins when neither exists), filtered through the administer port at
// delivery time; the answer reaches the requester, with the document named on
// an approval and never on a decline; and an unwired port sends nothing.

import (
	"testing"

	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// accessRequestNotifications lists a user's notifications of one kind.
func (f *documentFixture) accessRequestNotifications(t *testing.T, userID, kind string) []db.Notification {
	t.Helper()
	var out []db.Notification
	for _, n := range f.inbox(t, userID) {
		if n.Kind == kind {
			out = append(out, n)
		}
	}
	return out
}

// unreadAccessRequestNotifications is accessRequestNotifications limited to the
// rows still open. A group key merges into an OPEN row (§4.4), so a delivery
// that reached the wrong person shows up as a new unread row even when the
// read rows of the same kind are still around.
func (f *documentFixture) unreadAccessRequestNotifications(t *testing.T, userID, kind string) []db.Notification {
	t.Helper()
	var out []db.Notification
	for _, n := range f.accessRequestNotifications(t, userID, kind) {
		if !n.ReadAt.Valid {
			out = append(out, n)
		}
	}
	return out
}

// sendAccessRequest has a member ask for a restricted document the fixture
// owner administers, and delivers the event.
func (f *documentFixture) sendAccessRequest(t *testing.T, requesterID, docID string) {
	t.Helper()
	if _, err := f.docs.CreateDocumentAccessRequest(f.ctx, service.Human(requesterID), docID, service.DocumentAccessRequestInput{
		RequestedLevel: "edit", Message: "cần xem để chuẩn bị họp",
	}); err != nil {
		t.Fatal(err)
	}
}

// TestDocumentAccessRequestedNotifiesTheManagers covers §3.1's recipient rule:
// the ACL owner and a live manage-share holder hear, the requester never hears
// their own request, and a manager whose manage share was revoked before
// delivery does not - while the ACL owner still does.
func TestDocumentAccessRequestedNotifiesTheManagers(t *testing.T) {
	f := newDocumentFixture(t)
	f.consumer.SetDocumentAdministrators(f.docs)
	manager := f.addMember(t, "ar-manager@example.com", "Quản Lý")
	docID := f.document(t, "restricted", "Kế hoạch họp")
	if _, err := f.docs.ShareDocument(f.ctx, service.Human(f.owner.ID), docID, service.DocumentShareInput{
		PrincipalType: service.DocumentPrincipalUser, PrincipalID: manager.ID, Level: service.DocumentLevelManage,
	}); err != nil {
		t.Fatal(err)
	}

	f.sendAccessRequest(t, f.member.ID, docID)
	f.handleLast(t, "document.access_requested")

	got := f.accessRequestNotifications(t, f.owner.ID, KindDocumentAccessRequested)
	if len(got) != 1 {
		t.Fatalf("ACL owner notifications = %v, want one", got)
	}
	p := decodeNotificationParams(t, got[0])
	if p["document"] != "Kế hoạch họp" || p["document_id"] != docID || p["actor"] != f.member.DisplayName {
		t.Fatalf("params = %v", p)
	}
	if got[0].GroupKey != "document:"+docID+":access_requests" {
		t.Fatalf("group key = %q", got[0].GroupKey)
	}
	if n := f.accessRequestNotifications(t, manager.ID, KindDocumentAccessRequested); len(n) != 1 {
		t.Fatalf("manage-share manager notifications = %v, want one", n)
	}
	if n := f.accessRequestNotifications(t, f.member.ID, KindDocumentAccessRequested); len(n) != 0 {
		t.Fatalf("the requester heard their own request: %v", n)
	}

	// Revoke the manage share, then ask again: the revoked manager is filtered
	// out at delivery time, the ACL owner still hears. Both first notices are
	// marked read first, because one group key merges an open row instead of
	// writing a second one (§4.4) - with the rows read, a delivery that still
	// reached the revoked manager would have to write a new one.
	if _, err := f.pool.Exec(f.ctx,
		`UPDATE notifications SET read_at = now() WHERE kind = $1 AND user_id = ANY($2)`,
		KindDocumentAccessRequested, []string{f.owner.ID, manager.ID}); err != nil {
		t.Fatal(err)
	}
	shares := f.liveSharesOf(t, docID, manager.ID)
	if len(shares) != 1 {
		t.Fatalf("manage shares = %v, want one", shares)
	}
	if err := f.docs.RevokeDocumentShare(f.ctx, service.Human(f.owner.ID), docID, shares[0].ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(f.ctx, `UPDATE document_access_requests SET status = 'cancelled' WHERE document_id = $1`, docID); err != nil {
		t.Fatal(err)
	}
	f.sendAccessRequest(t, f.member.ID, docID)
	f.handleLast(t, "document.access_requested")
	if n := f.unreadAccessRequestNotifications(t, manager.ID, KindDocumentAccessRequested); len(n) != 0 {
		t.Fatalf("a revoked manager was notified: %v", n)
	}
	// The ACL owner hears the second request as a new unread row: the group key
	// merged nothing, because their first row was read.
	if n := f.unreadAccessRequestNotifications(t, f.owner.ID, KindDocumentAccessRequested); len(n) != 1 {
		t.Fatalf("ACL owner unread notifications after the revoke = %d, want 1", len(n))
	}
}

// TestDocumentAccessRequestedFallbackToWorkspaceAdmins covers the §3.1
// fallback and the contract's "AdminScope-only admin receives" case: with no
// effective ACL owner and no live manage share, the workspace owners and admins
// are the managers - including an admin who may administer the restricted
// document without being able to read it (DOC-05's AdminScope).
func TestDocumentAccessRequestedFallbackToWorkspaceAdmins(t *testing.T) {
	f := newDocumentFixture(t)
	f.consumer.SetDocumentAdministrators(f.docs)
	docID := f.document(t, "restricted", "Không có chủ ACL")
	if _, err := f.pool.Exec(f.ctx, `UPDATE documents SET acl_owner_id = NULL WHERE id = $1`, docID); err != nil {
		t.Fatal(err)
	}
	admin := f.addMember(t, "ar-fb-admin@example.com", "Quản Trị Dự Phòng")
	if _, err := f.pool.Exec(f.ctx,
		`UPDATE workspace_members SET role = 'admin' WHERE workspace_id = $1 AND user_id = $2`, f.wsID, admin.ID); err != nil {
		t.Fatal(err)
	}
	orgAdminNoWS := f.addMember(t, "ar-fb-org-admin@example.com", "Quản Trị Tổ Chức")
	if _, err := f.pool.Exec(f.ctx,
		`UPDATE organization_members SET role = 'admin' WHERE organization_id = $1 AND user_id = $2`, f.orgID, orgAdminNoWS.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(f.ctx,
		`DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`, f.wsID, orgAdminNoWS.ID); err != nil {
		t.Fatal(err)
	}
	deactivatedOrgAdmin := f.addMember(t, "ar-fb-deact-org-admin@example.com", "Quản Trị Đã Khóa")
	if _, err := f.pool.Exec(f.ctx,
		`UPDATE organization_members SET role = 'admin', deactivated_at = now() WHERE organization_id = $1 AND user_id = $2`, f.orgID, deactivatedOrgAdmin.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.pool.Exec(f.ctx,
		`DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2`, f.wsID, deactivatedOrgAdmin.ID); err != nil {
		t.Fatal(err)
	}

	f.sendAccessRequest(t, f.member.ID, docID)
	f.handleLast(t, "document.access_requested")

	// The fixture owner is the organization owner, hence an implicit workspace
	// admin; the added admin holds only AdminScope and cannot read the row.
	for name, uid := range map[string]string{
		"owner":                    f.owner.ID,
		"AdminScope-only admin":    admin.ID,
		"org admin with no ws row": orgAdminNoWS.ID,
	} {
		if n := f.accessRequestNotifications(t, uid, KindDocumentAccessRequested); len(n) != 1 {
			t.Fatalf("%s notifications = %v, want one", name, n)
		}
	}
	if n := f.accessRequestNotifications(t, deactivatedOrgAdmin.ID, KindDocumentAccessRequested); len(n) != 0 {
		t.Fatalf("deactivated org admin notifications = %v, want none", n)
	}
}

// TestDocumentAccessRequestedUnwiredPortSendsNothing is the fail-closed rule:
// without the administer port the rule cannot tell a manager from a stranger,
// so it sends nothing at all.
func TestDocumentAccessRequestedUnwiredPortSendsNothing(t *testing.T) {
	f := newDocumentFixture(t)
	docID := f.document(t, "restricted", "Chưa gắn cổng")
	f.sendAccessRequest(t, f.member.ID, docID)

	f.handleLast(t, "document.access_requested")
	if n := f.accessRequestNotifications(t, f.owner.ID, KindDocumentAccessRequested); len(n) != 0 {
		t.Fatalf("notifications with an unwired port = %v, want none", n)
	}
}

// TestDocumentAccessDecidedNotifiesTheRequester covers §3.1/§4.4: an approval
// names the document and pushes; a decline never names it and does not push.
func TestDocumentAccessDecidedNotifiesTheRequester(t *testing.T) {
	f := newDocumentFixture(t)
	f.consumer.SetDocumentAdministrators(f.docs)
	docID := f.document(t, "restricted", "Hợp đồng mua bán")
	f.sendAccessRequest(t, f.member.ID, docID)
	reqID := f.pendingRequestID(t, docID)

	// Decline first: the requester never read the title, so the sentence is the
	// title-less one and the row carries no document param.
	pushBefore := len(f.events(t, TopicPush))
	if _, err := f.docs.DeclineDocumentAccessRequest(f.ctx, service.Human(f.owner.ID), docID, reqID); err != nil {
		t.Fatal(err)
	}
	f.handleLast(t, "document.access_request_decided")

	got := f.accessRequestNotifications(t, f.member.ID, KindDocumentAccessDeclined)
	if len(got) != 1 {
		t.Fatalf("declined notifications = %v, want one", got)
	}
	p := decodeNotificationParams(t, got[0])
	if p["document"] != "" {
		t.Fatalf("a declined notice carries the document title: %v", p)
	}
	if p["document_id"] != docID {
		t.Fatalf("params = %v, want the document id", p)
	}
	if n := len(f.events(t, TopicPush)) - pushBefore; n != 0 {
		t.Fatalf("push events for a decline = %d, want none (push off by default)", n)
	}
	if n := f.accessRequestNotifications(t, f.owner.ID, KindDocumentAccessDeclined); len(n) != 0 {
		t.Fatalf("the manager heard their own decline: %v", n)
	}

	// Ask again and approve while the decline row is still unread: each
	// decision kind carries its own group key (§4.4, BE-SD7-9), so the unread
	// decline does not swallow the approval's kind/title or its push event.
	if _, err := f.pool.Exec(f.ctx, `UPDATE document_access_requests SET decided_at = now() - interval '2 hours' WHERE id = $1`, reqID); err != nil {
		t.Fatal(err)
	}
	f.sendAccessRequest(t, f.member.ID, docID)
	second := f.pendingRequestID(t, docID)
	pushBefore = len(f.events(t, TopicPush))
	if _, err := f.docs.ApproveDocumentAccessRequest(f.ctx, service.Human(f.owner.ID), docID, second, "edit"); err != nil {
		t.Fatal(err)
	}
	f.handleLast(t, "document.access_request_decided")

	approved := f.accessRequestNotifications(t, f.member.ID, KindDocumentAccessApproved)
	if len(approved) != 1 {
		t.Fatalf("approved notifications = %v, want one", approved)
	}
	if got[0].GroupKey != "document:"+docID+":access_declined" {
		t.Fatalf("declined group key = %q, want document:%s:access_declined", got[0].GroupKey, docID)
	}
	if approved[0].GroupKey != "document:"+docID+":access_approved" || approved[0].TitleKey != TitleKey(KindDocumentAccessApproved) {
		t.Fatalf("approved row = %+v, want group key document:%s:access_approved and title %s", approved[0], docID, TitleKey(KindDocumentAccessApproved))
	}
	ap := decodeNotificationParams(t, approved[0])
	if ap["document"] != "Hợp đồng mua bán" {
		t.Fatalf("approved params = %v, want the document title", ap)
	}
	if n := len(f.events(t, TopicPush)) - pushBefore; n != 1 {
		t.Fatalf("push events for an approval = %d, want 1 (push on by default)", n)
	}
}

// TestDocumentAccessRequestPushDeepLink pins the two deep links §3.4 names: a
// manager's request opens the share dialog at its requests section, and an
// approval opens the document itself.
func TestDocumentAccessRequestPushDeepLink(t *testing.T) {
	f := newDocumentFixture(t)
	f.consumer.SetDocumentAdministrators(f.docs)
	docID := f.document(t, "restricted", "Mở đúng mục")
	f.sendAccessRequest(t, f.member.ID, docID)
	f.handleLast(t, "document.access_requested")
	f.subscribe(t, f.owner.ID, "https://push.example/ar-manager")

	spy := &spySender{}
	pc := NewPushConsumer(f.q, spy, "http://app.test")
	if err := pc.Handle(f.ctx, f.lastEvent(t, TopicPush)); err != nil {
		t.Fatal(err)
	}
	want := "http://app.test/notif-org/notif-ws/documents/" + docID + "?access=requests"
	if len(spy.sent) != 1 || spy.sent[0].URL != want {
		t.Fatalf("push sent = %+v, want %s", spy.sent, want)
	}
}

// TestDocumentAccessPushDefaults pins §4.4's push defaults for the three kinds.
func TestDocumentAccessPushDefaults(t *testing.T) {
	for kind, want := range map[string]bool{
		KindDocumentAccessRequested: true,
		KindDocumentAccessApproved:  true,
		KindDocumentAccessDeclined:  false,
	} {
		if got := DefaultPrefs(kind).Push; got != want {
			t.Errorf("%s push default = %v, want %v", kind, got, want)
		}
		if got := DefaultPrefs(kind).InApp; !got {
			t.Errorf("%s in-app default = %v, want true", kind, got)
		}
	}
}

// liveSharesOf lists one person's live grants on a document.
func (f *documentFixture) liveSharesOf(t *testing.T, docID, userID string) []db.DocumentShare {
	t.Helper()
	shares, err := f.q.ListDocumentShares(f.ctx, db.ListDocumentSharesParams{
		OrganizationID: f.orgID, WorkspaceID: f.wsID, DocumentID: docID,
	})
	if err != nil {
		t.Fatal(err)
	}
	var out []db.DocumentShare
	for _, sh := range shares {
		if sh.PrincipalType == service.DocumentPrincipalUser && sh.PrincipalID == userID {
			out = append(out, sh)
		}
	}
	return out
}

// pendingRequestID is the id of a document's live pending request.
func (f *documentFixture) pendingRequestID(t *testing.T, docID string) string {
	t.Helper()
	var id string
	if err := f.pool.QueryRow(f.ctx,
		`SELECT id FROM document_access_requests WHERE document_id = $1 AND status = 'pending' ORDER BY created_at DESC LIMIT 1`,
		docID).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}
