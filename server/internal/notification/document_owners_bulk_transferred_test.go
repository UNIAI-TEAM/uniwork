package notification

// DOC-06b (UNI-2092) document_owners_bulk_transferred, addendum §4.2 + §4.4:
// the recipient of a bulk transfer hears once per run (group
// document_owner_bulk:{bulk_id}, OncePerGroup, so the later batches of one run
// add no row and bump nothing), re-checked as an active organization member at
// delivery time; the caller never hears their own transfer; push is off by
// default.

import (
	"testing"

	"github.com/unicomhub/uniwork/server/internal/outbox"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func (f *documentFixture) bulkTransferredNotifications(t *testing.T, userID string) []db.Notification {
	t.Helper()
	var out []db.Notification
	for _, n := range f.inbox(t, userID) {
		if n.Kind == KindDocumentOwnersBulkTransferred {
			out = append(out, n)
		}
	}
	return out
}

// bulkEvent is the outbox row the bulk service writes: organization, the
// recipient, the run and the source member, ids only.
func (f *documentFixture) bulkEvent(t *testing.T, actorID string, payload map[string]string) outbox.Row {
	t.Helper()
	return f.editEvent(t, "document.owners_bulk_transferred", actorID, "", payload)
}

func (f *documentFixture) bulkPayload(recipientID, fromID, bulkID string) map[string]string {
	return map[string]string{"organization_id": f.orgID, "user_id": recipientID, "bulk_id": bulkID, "from_user_id": fromID}
}

func TestDocumentOwnersBulkTransferredGroupsTheBatchesOfOneRun(t *testing.T) {
	f := newDocumentFixture(t)
	source := f.addMember(t, "bulk-src@example.com", "Nguyễn Cũ")
	recipient := f.addMember(t, "bulk-new@example.com", "Chủ Mới")
	bulkID := util.NewID()

	for range 2 {
		f.handleEvent(t, f.bulkEvent(t, f.owner.ID, f.bulkPayload(recipient.ID, source.ID, bulkID)))
	}
	pushBefore := len(f.events(t, TopicPush))

	got := f.bulkTransferredNotifications(t, recipient.ID)
	if len(got) != 1 {
		t.Fatalf("recipient notifications = %v, want one row for two batches of one run", got)
	}
	n := got[0]
	if n.GroupKey != "document_owner_bulk:"+bulkID || n.ResourceType != "organization_member" || n.ResourceID != source.ID {
		t.Fatalf("notification = %+v", n)
	}
	if n.Count > 1 {
		t.Fatalf("count = %d, a later batch of the run bumped the row", n.Count)
	}
	p := decodeNotificationParams(t, n)
	if p["actor"] != f.owner.DisplayName || p["name"] != "Nguyễn Cũ" {
		t.Fatalf("params = %v", p)
	}
	if got := f.bulkTransferredNotifications(t, f.owner.ID); len(got) != 0 {
		t.Fatalf("the caller heard their own transfer: %v", got)
	}
	if after := len(f.events(t, TopicPush)); after != pushBefore {
		t.Fatalf("push rows %d -> %d, push is off by default", pushBefore, after)
	}

	// A second run is a second notice.
	f.handleEvent(t, f.bulkEvent(t, f.owner.ID, f.bulkPayload(recipient.ID, source.ID, util.NewID())))
	if got := f.bulkTransferredNotifications(t, recipient.ID); len(got) != 2 {
		t.Fatalf("notifications after a second run = %d, want 2", len(got))
	}
}

func TestDocumentOwnersBulkTransferredRechecksTheRecipient(t *testing.T) {
	f := newDocumentFixture(t)
	source := f.addMember(t, "bulk-src2@example.com", "Nguyễn Cũ")
	recipient := f.addMember(t, "bulk-gone@example.com", "Đã Rời")
	if _, err := f.pool.Exec(f.ctx,
		`UPDATE organization_members SET deactivated_at = now() WHERE organization_id = $1 AND user_id = $2`,
		f.orgID, recipient.ID); err != nil {
		t.Fatal(err)
	}
	f.handleEvent(t, f.bulkEvent(t, f.owner.ID, f.bulkPayload(recipient.ID, source.ID, util.NewID())))
	if got := f.bulkTransferredNotifications(t, recipient.ID); len(got) != 0 {
		t.Fatalf("a deactivated recipient was notified: %v", got)
	}
}

func TestDocumentOwnersBulkTransferredSkipsTheCallerAndMalformedFrames(t *testing.T) {
	f := newDocumentFixture(t)
	source := f.addMember(t, "bulk-src3@example.com", "Nguyễn Cũ")
	bulkID := util.NewID()

	// The admin transferred to themselves: no notice.
	f.handleEvent(t, f.bulkEvent(t, f.owner.ID, f.bulkPayload(f.owner.ID, source.ID, bulkID)))
	// No bulk_id, no user_id, no from_user_id: nothing to say or to group.
	f.handleEvent(t, f.bulkEvent(t, f.owner.ID, f.bulkPayload(f.member.ID, source.ID, "")))
	f.handleEvent(t, f.bulkEvent(t, f.owner.ID, f.bulkPayload("", source.ID, bulkID)))
	f.handleEvent(t, f.bulkEvent(t, f.owner.ID, f.bulkPayload(f.member.ID, "", bulkID)))

	for _, uid := range []string{f.owner.ID, f.member.ID} {
		if got := f.bulkTransferredNotifications(t, uid); len(got) != 0 {
			t.Fatalf("user %s notified: %v", uid, got)
		}
	}
}

func TestDocumentOwnersBulkTransferredTitleAndPrefs(t *testing.T) {
	params := map[string]string{"actor": "An", "name": "Bình"}
	if got := Title("vi", KindDocumentOwnersBulkTransferred, params); got != "An đã chuyển cho bạn quyền sở hữu các tài liệu của Bình." {
		t.Fatalf("vi title = %q", got)
	}
	if got := Title("en", KindDocumentOwnersBulkTransferred, params); got != "An transferred Bình's documents to you." {
		t.Fatalf("en title = %q", got)
	}
	if p := DefaultPrefs(KindDocumentOwnersBulkTransferred); !p.InApp || p.Push {
		t.Fatalf("default prefs = %+v, want in-app on, push off", p)
	}
	if !ValidKind(KindDocumentOwnersBulkTransferred) || Kinds[len(Kinds)-1] != KindDocumentOwnersBulkTransferred {
		t.Fatalf("kind not registered last: %v", Kinds[len(Kinds)-3:])
	}
}
