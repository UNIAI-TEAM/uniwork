package notification

import (
	"encoding/json"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/audit"
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

// batchLevels returns each recipient's notification level for the mixed batch
// tests, keyed by user id; a recipient with no notification is absent.
func (f *documentFixture) batchLevels(t *testing.T, userIDs ...string) map[string]string {
	t.Helper()
	out := map[string]string{}
	for _, uid := range userIDs {
		got := f.sharedNotifications(t, uid)
		if len(got) == 0 {
			continue
		}
		if len(got) != 1 {
			t.Fatalf("recipient %s has %d document_shared notifications, want 1", uid, len(got))
		}
		out[uid] = decodeNotificationParams(t, got[0])["level"]
	}
	return out
}

// TestDocumentAccessBatchNotificationIgnoresItemOrder is the R1-01/R1-02/R1-13
// regression: a mixed UpdateDocumentAccess batch that changes the home row and
// grants a direct user share must notify exactly when the recipient's effective
// level RISES across the whole command, whatever order the items arrive in.
//
// Case A (home-edit + user-edit): a restricted document, a workspace member
// with no access; the home item opens the document to the workspace at edit and
// the user item grants edit. The recipient ends at edit from none, so the
// command notifies with edit in BOTH orders - the bug stamped it in only one.
// Case B (revoke org edit + grant direct view): the recipient read through an
// organization edit grant; the command replaces it with a direct view, an
// effective downgrade, so it notifies in NEITHER order.
func TestDocumentAccessBatchNotificationIgnoresItemOrder(t *testing.T) {
	type tc struct {
		name       string
		userFirst  bool
		rise       bool
		wantLevel  string
		wantNotify bool
	}
	cases := []tc{
		{name: "home edit then user edit", userFirst: false, rise: true, wantLevel: "edit", wantNotify: true},
		{name: "user edit then home edit", userFirst: true, rise: true, wantLevel: "edit", wantNotify: true},
		{name: "revoke org then user view", userFirst: false, rise: false, wantLevel: "view", wantNotify: false},
		{name: "user view then revoke org", userFirst: true, rise: false, wantLevel: "view", wantNotify: false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			f := newDocumentFixture(t)
			recipient := f.addOrgOutsider(t, "order@example.com", "Người Nhận")
			if err := f.q.AddWorkspaceMember(f.ctx, db.AddWorkspaceMemberParams{
				WorkspaceID: f.wsID, OrganizationID: f.orgID, UserID: recipient.ID, Role: "member",
			}); err != nil {
				t.Fatal(err)
			}
			docID := f.document(t, "restricted", "Tài liệu lô hỗn hợp")

			var items []service.DocumentAccessBatchItem
			if c.rise {
				// Home item opens the document to the workspace at edit (the
				// recipient, a member, rises none -> edit); the user item
				// grants edit directly.
				items = []service.DocumentAccessBatchItem{
					{PrincipalType: service.DocumentPrincipalWorkspace, PrincipalID: f.wsID, Level: new(service.DocumentLevelEdit)},
					{PrincipalType: service.DocumentPrincipalUser, PrincipalID: recipient.ID, Level: new(service.DocumentLevelEdit)},
				}
			} else {
				// Seed an organization edit grant, then revoke it while
				// granting the recipient a direct view: edit -> view is a
				// downgrade, so no notification.
				if _, err := f.q.InsertDocumentShare(f.ctx, db.InsertDocumentShareParams{
					ID: "01J8X4ORGEDIT000000000000", OrganizationID: f.orgID, WorkspaceID: f.wsID,
					DocumentID: docID, PrincipalType: service.DocumentPrincipalOrganization,
					PrincipalID: f.orgID, Level: string(service.DocumentLevelEdit),
					GrantedBy: f.owner.ID, GrantedByKind: "human",
				}); err != nil {
					t.Fatal(err)
				}
				items = []service.DocumentAccessBatchItem{
					{PrincipalType: service.DocumentPrincipalOrganization, PrincipalID: f.orgID, Level: nil},
					{PrincipalType: service.DocumentPrincipalUser, PrincipalID: recipient.ID, Level: new(service.DocumentLevelView)},
				}
			}
			if c.userFirst {
				items[0], items[1] = items[1], items[0]
			}

			if _, err := f.docs.UpdateDocumentAccess(f.ctx, service.Human(f.owner.ID), docID, service.UpdateDocumentAccessInput{Items: items}); err != nil {
				t.Fatalf("UpdateDocumentAccess: %v", err)
			}
			f.handleAll(t, "document.shared")

			levels := f.batchLevels(t, recipient.ID)
			if c.wantNotify {
				if levels[recipient.ID] != c.wantLevel {
					t.Fatalf("notified level = %q, want %q (order-independent)", levels[recipient.ID], c.wantLevel)
				}
			} else if _, ok := levels[recipient.ID]; ok {
				t.Fatalf("recipient notified %q, want none (no rise over the whole command)", levels[recipient.ID])
			}
		})
	}
}

// TestDocumentAccessBatchNotificationHomeRowReplacement is the R1-13
// home-row shape: a workspace-visible document grants a member view through the
// home row; the batch turns the home row off and grants that same member a
// direct view. Access is unchanged (view -> view), so NO notification is due -
// in either order. Under the old writer a home-row revoke applied first dropped
// the recipient to none, so the same-level user grant looked like a rise and
// notified.
func TestDocumentAccessBatchNotificationHomeRowReplacement(t *testing.T) {
	for _, homeFirst := range []bool{true, false} {
		name := "user view then home off"
		if homeFirst {
			name = "home off then user view"
		}
		t.Run(name, func(t *testing.T) {
			f := newDocumentFixture(t)
			recipient := f.addOrgOutsider(t, "home-replace@example.com", "Người Nhận Nhà")
			if err := f.q.AddWorkspaceMember(f.ctx, db.AddWorkspaceMemberParams{
				WorkspaceID: f.wsID, OrganizationID: f.orgID, UserID: recipient.ID, Role: "member",
			}); err != nil {
				t.Fatal(err)
			}
			// workspace_level is 'view' so the member reads view via the home row.
			docID := f.document(t, "workspace", "Tài liệu thay hàng nhà")
			if _, err := f.pool.Exec(f.ctx, `UPDATE documents SET workspace_level = 'view' WHERE id = $1`, docID); err != nil {
				t.Fatal(err)
			}

			items := []service.DocumentAccessBatchItem{
				{PrincipalType: service.DocumentPrincipalWorkspace, PrincipalID: f.wsID, Level: nil},
				{PrincipalType: service.DocumentPrincipalUser, PrincipalID: recipient.ID, Level: new(service.DocumentLevelView)},
			}
			if !homeFirst {
				items[0], items[1] = items[1], items[0]
			}
			if _, err := f.docs.UpdateDocumentAccess(f.ctx, service.Human(f.owner.ID), docID, service.UpdateDocumentAccessInput{Items: items}); err != nil {
				t.Fatalf("UpdateDocumentAccess: %v", err)
			}
			f.handleAll(t, "document.shared")
			if got := f.sharedNotifications(t, recipient.ID); len(got) != 0 {
				t.Fatalf("unchanged access (view -> view) notified recipient: %+v", got)
			}
		})
	}
}

// TestDocumentSharedBatchLevelRecoveredByShareID is the R1-09 regression: one
// HTTP-correlated mixed-level batch grants A view and B edit; both direct
// shares are revoked before the consumer runs, while an organization grant
// added after the batch keeps both readable. The delayed event must recover
// each recipient's ORIGINAL level from the share row its share_id names
// (revoked history included), so A is told view and B edit - never both view,
// which the old correlation-keyed audit lookup produced.
func TestDocumentSharedBatchLevelRecoveredByShareID(t *testing.T) {
	f := newDocumentFixture(t)
	a := f.addOrgOutsider(t, "delayed-a@example.com", "Người A")
	b := f.addOrgOutsider(t, "delayed-b@example.com", "Người B")
	docID := f.document(t, "restricted", "Tài liệu trì hoãn")

	// One HTTP-style correlation for the whole batch, exactly as middleware
	// would stamp it: every audit/outbox row in the batch shares it.
	ctx := audit.WithRequest(f.ctx, audit.RequestInfo{CorrelationID: "corr-batch-0001"})

	res, err := f.docs.UpdateDocumentAccess(ctx, service.Human(f.owner.ID), docID, service.UpdateDocumentAccessInput{Items: []service.DocumentAccessBatchItem{
		{PrincipalType: service.DocumentPrincipalUser, PrincipalID: a.ID, Level: new(service.DocumentLevelView)},
		{PrincipalType: service.DocumentPrincipalUser, PrincipalID: b.ID, Level: new(service.DocumentLevelEdit)},
	}})
	if err != nil {
		t.Fatalf("UpdateDocumentAccess: %v", err)
	}
	evs := f.events(t, "document.shared")
	if len(evs) != 2 {
		t.Fatalf("document.shared events = %d, want 2", len(evs))
	}

	// An organization view grant keeps both readable once their direct shares
	// are revoked, so the delivery-time CanReadDocument gate still passes.
	if _, err := f.q.InsertDocumentShare(ctx, db.InsertDocumentShareParams{
		ID: "01J8X4ORGHOLD00000000000000", OrganizationID: f.orgID, WorkspaceID: f.wsID,
		DocumentID: docID, PrincipalType: service.DocumentPrincipalOrganization,
		PrincipalID: f.orgID, Level: string(service.DocumentLevelView),
		GrantedBy: f.owner.ID, GrantedByKind: "human",
	}); err != nil {
		t.Fatal(err)
	}
	for _, r := range res.Results {
		if r.ShareID == "" {
			t.Fatalf("result %d has no share_id: %+v", r.Index, r)
		}
		if err := f.docs.RevokeDocumentShare(ctx, service.Human(f.owner.ID), docID, r.ShareID); err != nil {
			t.Fatalf("revoke %s: %v", r.ShareID, err)
		}
	}
	for _, ev := range evs {
		if err := f.consumer.Handle(ctx, ev); err != nil {
			t.Fatal(err)
		}
	}

	gotA := f.batchLevels(t, a.ID)
	gotB := f.batchLevels(t, b.ID)
	if gotA[a.ID] != "view" || gotB[b.ID] != "edit" {
		t.Fatalf("delayed levels = A %q / B %q, want view/edit", gotA[a.ID], gotB[b.ID])
	}
}
