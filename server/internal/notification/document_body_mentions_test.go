package notification

// UNI-1968 (BODY-MENTION-NOTIFY, S6): the document.body_mentioned rule. The
// service filters the people a save may notify, and the rule re-checks read
// access at delivery time, so an event naming somebody who lost access - or
// who never had it - writes no row and no push. The kind pushes by default and
// its deep link carries ?mention=1 so the page opens scrolled to the reader's
// own mention (W4).

import (
	"encoding/json"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const bodyMentionTopic = "document.body_mentioned"

// bodyMentionPage is a workspace-visible UniNote page of the fixture workspace,
// created by the fixture owner, whose content mentions each id.
func (f *documentFixture) bodyMentionPage(t *testing.T, title string, ids ...string) string {
	t.Helper()
	v, err := f.docs.CreatePage(f.ctx, service.Human(f.owner.ID), f.wsID, service.CreatePageInput{
		Title: title, Visibility: "workspace",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(ids) == 0 {
		return v.Document.ID
	}
	if _, err := f.docs.UpdateDocument(f.ctx, service.Human(f.owner.ID), v.Document.ID, service.UpdateDocumentInput{
		Revision: v.Document.Revision, Content: bodyMentionPageJSON(ids...),
	}); err != nil {
		t.Fatal(err)
	}
	return v.Document.ID
}

// bodyMentionPageJSON is the page content a mention of each id produces.
func bodyMentionPageJSON(ids ...string) json.RawMessage {
	inline := make([]any, 0, len(ids))
	for _, id := range ids {
		inline = append(inline, map[string]any{"type": "mention", "attrs": map[string]any{"kind": "user", "id": id, "label": "Ai đó"}})
	}
	raw, _ := json.Marshal(map[string]any{"type": "doc", "content": []any{
		map[string]any{"type": "paragraph", "content": inline},
	}})
	return raw
}

// bodyMentionEvent is one hand-built outbox row of the topic, for the cases the
// service never produces (a payload naming somebody who cannot read).
func (f *documentFixture) bodyMentionEvent(t *testing.T, docID, userID, actorID, authorID string) db.OutboxEvent {
	t.Helper()
	payload, err := json.Marshal(map[string]string{
		"document_id": docID, "workspace_id": f.wsID, "user_id": userID, "author_id": authorID,
	})
	if err != nil {
		t.Fatal(err)
	}
	return db.OutboxEvent{
		ID: util.NewID(), Topic: bodyMentionTopic, Payload: string(payload),
		OrganizationID: optText(f.orgID), WorkspaceID: optText(f.wsID),
		ActorKind: optText("human"), ActorID: optText(actorID),
	}
}

// A newly named reader gets one row of the new kind, with the document title
// and the deep link that scrolls the page to their own mention; the push is on
// by default and carries the short kind title.
func TestDocumentBodyMentionNotification(t *testing.T) {
	f := newDocumentFixture(t)
	docID := f.bodyMentionPage(t, "Kế hoạch Q4", f.member.ID)

	f.handleLast(t, bodyMentionTopic)
	got := f.inbox(t, f.member.ID)
	if len(got) != 1 || got[0].Kind != KindDocumentBodyMentioned || got[0].TitleKey != "notifications.kind.document_body_mentioned" {
		t.Fatalf("member inbox = %+v", got)
	}
	if !contains(got[0].Params, "Kế hoạch Q4") || !contains(got[0].Params, docID) {
		t.Fatalf("params missing the document: %s", got[0].Params)
	}
	if want := "document:" + docID + ":body_mention:" + f.member.ID; got[0].GroupKey != want {
		t.Fatalf("group key = %q, want %q", got[0].GroupKey, want)
	}
	if n := f.inbox(t, f.owner.ID); len(n) != 0 {
		t.Fatalf("the author's own mention notified them: %+v", n)
	}

	if p := DefaultPrefs(KindDocumentBodyMentioned); !p.InApp || !p.Push || !p.Email {
		t.Fatalf("DefaultPrefs(%s) = %+v, want push on like the comment mention", KindDocumentBodyMentioned, p)
	}
	f.subscribe(t, f.member.ID, "https://push.example/body-mention")
	spy := &spySender{}
	pc := NewPushConsumer(f.q, spy, "http://app.test")
	if err := pc.Handle(f.ctx, f.lastEvent(t, TopicPush)); err != nil {
		t.Fatal(err)
	}
	if len(spy.sent) != 1 {
		t.Fatalf("sent = %+v, want one push", spy.sent)
	}
	if want := "http://app.test/notif-org/notif-ws/documents/" + docID + "?mention=1"; spy.sent[0].URL != want {
		t.Fatalf("push url = %q, want %q", spy.sent[0].URL, want)
	}
	if want := kindTitles["vi"][KindDocumentBodyMentioned]; spy.sent[0].Title != want {
		t.Fatalf("push title = %q, want the short kindTitle %q", spy.sent[0].Title, want)
	}
}

// Removing the mention and adding it back notifies the person again: each save
// carries its own event, and each event reaches them.
func TestDocumentBodyMentionNotifiesAgainAfterReAdd(t *testing.T) {
	f := newDocumentFixture(t)
	docID := f.bodyMentionPage(t, "Nhắc lại", f.member.ID)
	f.handleLast(t, bodyMentionTopic)

	doc, err := f.q.GetDocumentByID(f.ctx, docID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.docs.UpdateDocument(f.ctx, service.Human(f.owner.ID), docID, service.UpdateDocumentInput{
		Revision: doc.Revision, Content: bodyMentionPageJSON(),
	}); err != nil {
		t.Fatal(err)
	}
	doc, err = f.q.GetDocumentByID(f.ctx, docID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.docs.UpdateDocument(f.ctx, service.Human(f.owner.ID), docID, service.UpdateDocumentInput{
		Revision: doc.Revision, Content: bodyMentionPageJSON(f.member.ID),
	}); err != nil {
		t.Fatal(err)
	}
	f.handleLast(t, bodyMentionTopic)

	got := f.inbox(t, f.member.ID)
	if len(got) != 1 || got[0].Count != 2 {
		t.Fatalf("member inbox = %+v, want one row merged from two mentions", got)
	}
}

// The delivery-time re-check: a real event naming an active organization
// member who never had access to a restricted page, or whose only document
// grant was revoked after the save, returns nil from Handle and writes no
// notification row, no notification.push event and no push delivery, while a
// readable member in the same save still gets both (S3, RBM-01/03/06/07/08).
func TestDocumentBodyMentionNonReaderGetsNothing(t *testing.T) {
	f := newDocumentFixture(t)
	v, err := f.docs.CreatePage(f.ctx, service.Human(f.owner.ID), f.wsID, service.CreatePageInput{
		Title: "Kín", Visibility: "restricted",
	})
	if err != nil {
		t.Fatal(err)
	}
	docID := v.Document.ID
	revoked, revokedShare := f.sharedCommentAuthor(t, docID, "body-mention-revoked@example.com", "Người Bị Thu Hồi")
	reader, _ := f.sharedCommentAuthor(t, docID, "body-mention-reader@example.com", "Người Được Đọc")
	outsider := f.user(t, "body-mention-outsider@example.com", "Người Ngoài")

	f.subscribe(t, f.member.ID, "https://push.example/body-mention-never")
	f.subscribe(t, revoked.ID, "https://push.example/body-mention-revoked")
	f.subscribe(t, reader.ID, "https://push.example/body-mention-reader")
	f.subscribe(t, outsider.ID, "https://push.example/body-mention-outsider")

	if _, err := f.docs.UpdateDocument(f.ctx, service.Human(f.owner.ID), docID, service.UpdateDocumentInput{
		Revision: v.Document.Revision, Content: bodyMentionPageJSON(f.member.ID, revoked.ID, reader.ID),
	}); err != nil {
		t.Fatal(err)
	}
	evs := f.events(t, bodyMentionTopic)
	if len(evs) != 3 {
		t.Fatalf("body-mention events = %d, want 3 real outbox rows", len(evs))
	}
	f.revokeShare(t, revokedShare, docID)

	spy := &spySender{}
	pc := NewPushConsumer(f.q, spy, "http://app.test")
	for _, ev := range []db.OutboxEvent{
		evs[0], // (a) active organization member who never had access to the restricted page
		evs[1], // (b) active organization member whose only document grant was revoked after the save
		f.bodyMentionEvent(t, docID, outsider.ID, f.owner.ID, f.owner.ID),
	} {
		if err := f.consumer.Handle(f.ctx, ev); err != nil {
			t.Fatalf("Handle(%s) = %v, want nil", ev.ID, err)
		}
	}
	for _, blocked := range []struct {
		who, id string
	}{
		{"never-reader org member", f.member.ID},
		{"revoked-grant member", revoked.ID},
		{"outsider", outsider.ID},
	} {
		if n := f.inbox(t, blocked.id); len(n) != 0 {
			t.Fatalf("%s inbox = %+v, want nothing", blocked.who, n)
		}
	}
	if pushEvs := f.events(t, TopicPush); len(pushEvs) != 0 {
		t.Fatalf("notification.push events after blocked deliveries = %+v, want none", pushEvs)
	}
	if len(spy.sent) != 0 {
		t.Fatalf("non-reader push = %+v, want none", spy.sent)
	}

	// Readable-member control in the same scenario: the unrevoked share still
	// delivers both the notification row and the push.
	if err := f.consumer.Handle(f.ctx, evs[2]); err != nil {
		t.Fatalf("Handle(reader) = %v, want nil", err)
	}
	got := f.inbox(t, reader.ID)
	if len(got) != 1 || got[0].Kind != KindDocumentBodyMentioned || !contains(got[0].Params, "Kín") {
		t.Fatalf("reader control inbox = %+v, want one body-mention row", got)
	}
	if n := f.inbox(t, f.member.ID); len(n) != 0 {
		t.Fatalf("never-reader inbox after control = %+v, want nothing", n)
	}
	if n := f.inbox(t, revoked.ID); len(n) != 0 {
		t.Fatalf("revoked-reader inbox after control = %+v, want nothing", n)
	}
	pushEvs := f.events(t, TopicPush)
	if len(pushEvs) != 1 || !contains(pushEvs[0].Payload, reader.ID) {
		t.Fatalf("notification.push events = %+v, want 1 for the readable control", pushEvs)
	}
	for _, ev := range pushEvs {
		if err := pc.Handle(f.ctx, ev); err != nil {
			t.Fatal(err)
		}
	}
	wantTag := "document:" + docID + ":body_mention:" + reader.ID
	if len(spy.sent) != 1 || spy.sent[0].Tag != wantTag {
		t.Fatalf("sent pushes = %+v, want only the readable member (%s)", spy.sent, wantTag)
	}
}

// A payload whose user_id is the author is dropped, whatever the event's actor
// is (S3).
func TestDocumentBodyMentionAuthorIsSkipped(t *testing.T) {
	f := newDocumentFixture(t)
	docID := f.bodyMentionPage(t, "Tự nhắc", f.member.ID)

	// The owner authored the mention; the member carries the event.
	if err := f.consumer.Handle(f.ctx, f.bodyMentionEvent(t, docID, f.owner.ID, f.member.ID, f.owner.ID)); err != nil {
		t.Fatalf("Handle(author self-mention) = %v, want nil", err)
	}
	if n := f.inbox(t, f.owner.ID); len(n) != 0 {
		t.Fatalf("author inbox = %+v, want nothing", n)
	}
	if n := f.inbox(t, f.member.ID); len(n) != 0 {
		t.Fatalf("event actor inbox = %+v, want nothing", n)
	}
}
