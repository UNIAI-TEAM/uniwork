package notification

// G8-05 (UNI-1400): the durable mention claim (contract-collab section 8.2).
// The rule only reads unclaimed rows; the consumer claims the row with
// ClaimDocumentCommentMention inside the notification's own transaction, so
// concurrent consumers, outbox replays and repeated edits commit exactly one
// notification per mention row - and a failed notification write rolls the
// claim back with it.

import (
	"sync"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/outbox"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func (f *documentFixture) setPref(t *testing.T, userID, kind string, inApp bool) {
	t.Helper()
	if err := f.q.UpsertNotificationPreference(f.ctx, db.UpsertNotificationPreferenceParams{
		UserID: userID, Kind: kind, InApp: inApp, Push: true, Email: true,
	}); err != nil {
		t.Fatal(err)
	}
}

func (f *documentFixture) mentionRowID(t *testing.T, commentID, userID string) string {
	t.Helper()
	var id string
	if err := f.pool.QueryRow(f.ctx,
		`SELECT id FROM document_comment_mentions WHERE comment_id = $1 AND user_id = $2`,
		commentID, userID).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

// InApp off claims the row without writing a notification; re-enabling the
// channel and editing the comment while keeping the name notifies nothing
// again.
func TestDocumentMentionClaimInAppOff(t *testing.T) {
	f := newDocumentFixture(t)
	docID := f.document(t, "workspace", "Tắt hộp việc")
	f.setPref(t, f.member.ID, KindDocumentMentioned, false)
	created := f.commentOf(t, f.owner.ID, docID, mentionOf(f.member)+" xem giúp", "comment")

	f.handleComment(t)

	if n := f.inbox(t, f.member.ID); len(n) != 0 {
		t.Fatalf("in_app=false still wrote a notification: %+v", n)
	}
	if state, notified := f.mentionState(t, created.ID, f.member.ID); state != "active" || !notified.Valid {
		t.Fatalf("row = %s/%v, want claimed active", state, notified)
	}

	f.setPref(t, f.member.ID, KindDocumentMentioned, true)
	f.edit(t, f.owner.ID, created.ID, mentionOf(f.member)+" sửa nhưng giữ tên")
	f.handleAll(t, "document.comment_updated")
	if n := f.inbox(t, f.member.ID); len(n) != 0 {
		t.Fatalf("re-enabled channel resurrected a claimed mention: %+v", n)
	}
}

// A notification write that fails after the claim rolls the claim back;
// the next delivery of the same event claims and notifies.
func TestDocumentMentionClaimRollsBackWithTheNotification(t *testing.T) {
	f := newDocumentFixture(t)
	docID := f.document(t, "workspace", "Lỗi ghi")
	created := f.commentOf(t, f.owner.ID, docID, mentionOf(f.member)+" xem giúp", "comment")

	draft := Draft{
		UserID: f.member.ID, OrganizationID: f.orgID, WorkspaceID: f.wsID,
		Kind: KindDocumentMentioned, GroupKey: "document:" + docID + ":mention:" + created.ID,
		ResourceType: "document", ResourceID: docID,
		ActorKind: "human", ActorID: f.owner.ID, Params: map[string]string{},
		Claim: &MentionClaim{MentionID: f.mentionRowID(t, created.ID, f.member.ID)},
	}
	failing := draft
	// An actor kind outside the notifications CHECK fails UpsertNotification,
	// which runs after the claim in the same transaction.
	failing.ActorKind = "bogus"
	if err := f.consumer.write(f.ctx, "ev-fail", "", failing, DefaultPrefs(KindDocumentMentioned)); err == nil {
		t.Fatal("write succeeded with an invalid actor kind")
	}
	if _, notified := f.mentionState(t, created.ID, f.member.ID); notified.Valid {
		t.Fatal("the claim survived the failed notification write")
	}
	if n := f.inbox(t, f.member.ID); len(n) != 0 {
		t.Fatalf("failed write left a notification: %+v", n)
	}

	if err := f.consumer.write(f.ctx, "ev-fail", "", draft, DefaultPrefs(KindDocumentMentioned)); err != nil {
		t.Fatal(err)
	}
	if n := f.inbox(t, f.member.ID); len(n) != 1 {
		t.Fatalf("next delivery = %+v, want one notification", n)
	}
	if _, notified := f.mentionState(t, created.ID, f.member.ID); !notified.Valid {
		t.Fatal("next delivery did not claim the row")
	}
}

// Two consumers racing on the same mention row - one per event, create and
// edit - commit exactly one notification: the UPDATE only matches while the
// row is unclaimed. The count assertion is the proof: the two events share a
// group key, so a loser that still wrote would merge into the winner's open
// row (count=2), not add a row; count=1 can only hold because the claim let
// exactly one writer through.
func TestDocumentMentionClaimOneOfTwoConsumers(t *testing.T) {
	f := newDocumentFixture(t)
	docID := f.document(t, "workspace", "Đua nhau")
	created := f.commentOf(t, f.owner.ID, docID, mentionOf(f.member)+" xem giúp", "comment")
	f.edit(t, f.owner.ID, created.ID, mentionOf(f.member)+" xem lại")

	events := []outbox.Row{
		f.lastEvent(t, "document.comment_added"),
		f.lastEvent(t, "document.comment_updated"),
	}
	var wg sync.WaitGroup
	errs := make(chan error, len(events))
	for _, ev := range events {
		wg.Add(1)
		go func(ev outbox.Row) {
			defer wg.Done()
			errs <- f.consumer.Handle(f.ctx, ev)
		}(ev)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	n := f.inbox(t, f.member.ID)
	if len(n) != 1 {
		t.Fatalf("concurrent consumers wrote %d notifications, want exactly one", len(n))
	}
	if n[0].Count != 1 {
		t.Fatalf("notification count = %d, want 1: a second writer merged into the open row", n[0].Count)
	}
	if _, notified := f.mentionState(t, created.ID, f.member.ID); !notified.Valid {
		t.Fatal("the mention row was never claimed")
	}
}
