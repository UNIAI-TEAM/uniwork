package notification

import (
	"testing"

	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// A plain message in a group or channel reaches every other member, as a
// messenger's does (UNI-2141): one inbox row per room while unread, merged
// like a DM's, and a push for each message under the room's own group key,
// with the message's words and the room's name. Reading the room closes it, a
// muted room sends nothing, and switching chat_message's push off leaves the
// inbox row without a push: "mentions only".
func TestEveryRoomMessageReachesTheOtherMembers(t *testing.T) {
	f := newFixture(t)
	chat := service.NewChatService(f.pool, f.q, f.ws, service.NopPublisher{})
	ch, err := chat.CreateChannel(f.ctx, f.owner.ID, f.wsID, service.CreateChannelInput{
		Name: "ca-nha", Visibility: "private", MemberUserIDs: []string{f.member.ID},
	})
	if err != nil {
		t.Fatal(err)
	}
	send := func(body string) string {
		t.Helper()
		msg, err := chat.SendRoomMessage(f.ctx, f.owner.ID, f.wsID, ch.ID, service.SendChatMessageInput{Body: body})
		if err != nil {
			t.Fatal(err)
		}
		f.handleLast(t, "chat.message.received")
		return msg.ID
	}
	byKind := func() []db.Notification {
		t.Helper()
		var out []db.Notification
		for _, n := range f.inbox(t, f.member.ID) {
			if n.Kind == KindChatMessage {
				out = append(out, n)
			}
		}
		return out
	}

	pushBefore := len(f.events(t, TopicPush))
	send("chào cả nhà")
	lastID := send("họp lúc 3 giờ")
	got := byKind()
	if len(got) != 1 || got[0].Count != 2 || got[0].GroupKey != "chat_room:"+ch.ID+":message" || got[0].ResourceID != lastID ||
		!contains(got[0].Params, `"room":"ca-nha"`) {
		t.Fatalf("room message inbox = %+v", got)
	}
	if len(f.inbox(t, f.owner.ID)) != 0 {
		t.Fatal("the sender was notified of their own message")
	}
	pushes := f.events(t, TopicPush)[pushBefore:]
	if len(pushes) != 2 {
		t.Fatalf("two room messages pushed %d times, want 2", len(pushes))
	}

	spy := &spySender{}
	f.subscribeAs(t, f.member.ID, "ExponentPushToken[android]", "expo/android; call-ui; chat-quiet")
	if err := NewPushConsumer(f.q, spy, "http://app.test").Handle(f.ctx, pushes[1]); err != nil {
		t.Fatal(err)
	}
	if len(spy.sent) != 1 {
		t.Fatalf("pushes = %+v, want the phone's", spy.sent)
	}
	m := spy.sent[0]
	if m.Body != "họp lúc 3 giờ" || m.Channel != ChannelMessages || m.Tag != "chat_room:"+ch.ID+":message" ||
		m.Chat.RoomID != ch.ID || m.Chat.MessageID != lastID || m.Title != "Chủ Nhóm đã nhắn trong ca-nha" {
		t.Fatalf("room message push = %+v", m)
	}

	if err := chat.MarkRoomRead(f.ctx, f.member.ID, f.wsID, ch.ID); err != nil {
		t.Fatal(err)
	}
	if got := byKind(); len(got) != 1 || !got[0].ReadAt.Valid {
		t.Fatalf("room message row after reading the room = %+v", got)
	}

	// Push off for the kind: the inbox still counts the message, no phone hears it.
	if err := f.q.UpsertNotificationPreference(f.ctx, db.UpsertNotificationPreferenceParams{
		UserID: f.member.ID, Kind: KindChatMessage, InApp: true, Push: false, Email: true,
	}); err != nil {
		t.Fatal(err)
	}
	pushBefore = len(f.events(t, TopicPush))
	send("chỉ trong hộp việc")
	if n := len(f.events(t, TopicPush)) - pushBefore; n != 0 || len(byKind()) != 2 {
		t.Fatalf("with push off: %d pushes, rows %+v; want an inbox row and no push", n, byKind())
	}

	// A muted room sends nothing at all.
	if err := chat.SetRoomNotificationsMuted(f.ctx, f.member.ID, f.wsID, ch.ID, true); err != nil {
		t.Fatal(err)
	}
	if err := chat.MarkRoomRead(f.ctx, f.member.ID, f.wsID, ch.ID); err != nil {
		t.Fatal(err)
	}
	send("im lặng")
	for _, n := range byKind() {
		if !n.ReadAt.Valid {
			t.Fatalf("a muted room opened a row: %+v", n)
		}
	}
}
