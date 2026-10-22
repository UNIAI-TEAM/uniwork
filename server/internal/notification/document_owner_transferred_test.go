package notification

// DOC-06 (UNI-2084) document_owner_transferred, addendum §4.2 + §4.4: the new
// owner of a single-document transfer hears once (group document:{id}:owner),
// re-checked through the read port at delivery time; a frame that carries
// bulk_id belongs to the bulk notice and sends nothing here; the caller never
// hears their own transfer; push is off by default.

import (
	"encoding/json"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func (f *documentFixture) ownerTransferredNotifications(t *testing.T, userID string) []db.Notification {
	t.Helper()
	var out []db.Notification
	for _, n := range f.inbox(t, userID) {
		if n.Kind == KindDocumentOwnerTransferred {
			out = append(out, n)
		}
	}
	return out
}

func TestDocumentOwnerTransferredNotifiesTheNewOwner(t *testing.T) {
	f := newDocumentFixture(t)
	recipient := f.addMember(t, "ot-new@example.com", "Chủ Mới")
	docID := f.document(t, "restricted", "Hợp đồng Q4")

	if _, err := f.docs.TransferOwner(f.ctx, service.Human(f.owner.ID), docID, service.DocumentOwnerTransferInput{UserID: recipient.ID}); err != nil {
		t.Fatal(err)
	}
	pushBefore := len(f.events(t, TopicPush))
	f.handleLast(t, "document.owner_transferred")

	got := f.ownerTransferredNotifications(t, recipient.ID)
	if len(got) != 1 {
		t.Fatalf("new owner notifications = %v, want one", got)
	}
	n := got[0]
	if n.GroupKey != "document:"+docID+":owner" || n.ResourceType != "document" || n.ResourceID != docID {
		t.Fatalf("notification = %+v", n)
	}
	p := decodeNotificationParams(t, n)
	if p["actor"] != f.owner.DisplayName || p["document"] != "Hợp đồng Q4" || p["document_id"] != docID {
		t.Fatalf("params = %v", p)
	}
	if got := f.ownerTransferredNotifications(t, f.owner.ID); len(got) != 0 {
		t.Fatalf("the caller heard their own transfer: %v", got)
	}
	if after := len(f.events(t, TopicPush)); after != pushBefore {
		t.Fatalf("push rows %d -> %d, push is off by default", pushBefore, after)
	}
}

// TestDocumentOwnerTransferredRechecksAndSkipsBulk: a new owner who left the
// workspace before delivery hears nothing, and a frame with bulk_id is the bulk
// command's (its own grouped notice), so this kind ignores it.
func TestDocumentOwnerTransferredRechecksAndSkipsBulk(t *testing.T) {
	f := newDocumentFixture(t)
	recipient := f.addMember(t, "ot-gone@example.com", "Đã Rời")
	docID := f.document(t, "restricted", "Biên bản")
	if _, err := f.docs.TransferOwner(f.ctx, service.Human(f.owner.ID), docID, service.DocumentOwnerTransferInput{UserID: recipient.ID}); err != nil {
		t.Fatal(err)
	}
	ev := f.lastEvent(t, "document.owner_transferred")

	// bulk_id on the frame: nothing, even for a reader.
	var p map[string]string
	if err := json.Unmarshal([]byte(ev.Payload), &p); err != nil {
		t.Fatal(err)
	}
	p["bulk_id"] = "01J8X4BULK0N1P2Q3R4S5T6U7V"
	raw, err := json.Marshal(p)
	if err != nil {
		t.Fatal(err)
	}
	bulk := ev
	bulk.ID = util.NewID()
	bulk.Payload = string(raw)
	if err := f.consumer.Handle(f.ctx, bulk); err != nil {
		t.Fatal(err)
	}
	if got := f.ownerTransferredNotifications(t, recipient.ID); len(got) != 0 {
		t.Fatalf("bulk frame notified: %v", got)
	}

	// The recipient is deactivated before the single frame is delivered.
	if _, err := f.pool.Exec(f.ctx,
		`UPDATE organization_members SET deactivated_at = now() WHERE organization_id = $1 AND user_id = $2`,
		f.orgID, recipient.ID); err != nil {
		t.Fatal(err)
	}
	if err := f.consumer.Handle(f.ctx, ev); err != nil {
		t.Fatal(err)
	}
	if got := f.ownerTransferredNotifications(t, recipient.ID); len(got) != 0 {
		t.Fatalf("a recipient who cannot read was notified: %v", got)
	}
}

func TestDocumentOwnerTransferredTitleAndPrefs(t *testing.T) {
	params := map[string]string{"actor": "An", "document": "Kế hoạch"}
	if got := Title("vi", KindDocumentOwnerTransferred, params); got != "An đã chuyển cho bạn quyền sở hữu tài liệu “Kế hoạch”." {
		t.Fatalf("vi title = %q", got)
	}
	if got := Title("en", KindDocumentOwnerTransferred, params); got != "An transferred ownership of “Kế hoạch” to you." {
		t.Fatalf("en title = %q", got)
	}
	if p := DefaultPrefs(KindDocumentOwnerTransferred); !p.InApp || p.Push {
		t.Fatalf("default prefs = %+v, want in-app on, push off", p)
	}
	if !ValidKind(KindDocumentOwnerTransferred) || Kinds[len(Kinds)-1] != KindDocumentOwnerTransferred {
		t.Fatalf("kind not registered last: %v", Kinds[len(Kinds)-3:])
	}
}
