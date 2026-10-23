package notification

import (
	"context"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// roomFixture is a DM from the owner to the member, whose phones are an
// Android build with the call UI, an iPhone and a browser.
func roomFixture(t *testing.T) (*fixture, *service.ChatService, service.ChatRoomSummary) {
	t.Helper()
	f := newFixture(t)
	chat := service.NewChatService(f.pool, f.q, f.ws, service.NopPublisher{})
	dm, err := chat.ResolveDM(f.ctx, f.owner.ID, f.wsID, f.member.ID)
	if err != nil {
		t.Fatal(err)
	}
	f.subscribeAs(t, f.member.ID, "ExponentPushToken[android]", "expo/android; call-ui")
	f.subscribeAs(t, f.member.ID, "ExponentPushToken[iphone]", "expo/ios")
	f.subscribe(t, f.member.ID, "https://push.example/member-browser")
	return f, chat, dm
}

// sendDM sends one message to the member and turns it into its notification
// and its push row.
func sendDM(t *testing.T, f *fixture, chat *service.ChatService, dm service.ChatRoomSummary, body string) {
	t.Helper()
	if _, err := chat.SendRoomMessage(f.ctx, f.owner.ID, f.wsID, dm.ID, service.SendChatMessageInput{Body: body}); err != nil {
		t.Fatal(err)
	}
	f.handleLast(t, "chat.dm.received")
}

// Reading a room whose DM notification reached a phone writes one
// chat.room.notifications_cleared row, and the push lane tells only the
// reader's Android phones with the call UI, so a closed app's tray stops
// showing a message already read elsewhere. Reading it again, with nothing left
// open, writes nothing: a quiet room wakes no phone.
func TestReadingARoomClearsItsNotificationsOnTheAndroidPhones(t *testing.T) {
	f, chat, dm := roomFixture(t)
	sendDM(t, f, chat, dm, "chào")
	if err := NewPushConsumer(f.q, &spySender{}, "http://app.test").Handle(f.ctx, f.lastEvent(t, TopicPush)); err != nil {
		t.Fatal(err)
	}
	before := len(f.events(t, TopicRoomNotificationsCleared))

	if err := chat.MarkRoomRead(f.ctx, f.member.ID, f.wsID, dm.ID); err != nil {
		t.Fatal(err)
	}
	rows := f.events(t, TopicRoomNotificationsCleared)
	if len(rows) != before+1 {
		t.Fatalf("cleared rows = %d (was %d), want one for the read", len(rows), before)
	}
	cleared := rows[len(rows)-1]
	if p := payloadOf(t, cleared); p["user_id"] != f.member.ID || p["room_id"] != dm.ID || len(p) != 2 {
		t.Fatalf("cleared payload = %v, want the reader and the room", p)
	}
	if cleared.ActorID.String != f.member.ID || cleared.OrganizationID.String != f.orgID {
		t.Fatalf("cleared actor/org = %+v/%+v", cleared.ActorID, cleared.OrganizationID)
	}
	spy := &spySender{}
	if err := NewPushConsumer(f.q, spy, "http://app.test").Handle(f.ctx, cleared); err != nil {
		t.Fatal(err)
	}
	want := PushMessage{TTL: 86400, Cleared: RoomCleared{RoomID: dm.ID, WorkspaceID: cleared.WorkspaceID.String}}
	if len(spy.sent) != 1 || spy.sent[0] != want || spy.endpoints[0] != "ExponentPushToken[android]" {
		t.Fatalf("room read sent %+v to %v, want %+v to the Android phone with the call UI only", spy.sent, spy.endpoints, want)
	}

	if err := chat.MarkRoomRead(f.ctx, f.member.ID, f.wsID, dm.ID); err != nil {
		t.Fatal(err)
	}
	if again := f.events(t, TopicRoomNotificationsCleared); len(again) != len(rows) {
		t.Fatalf("a read with nothing open wrote %d more cleared rows", len(again)-len(rows))
	}
}

// While the person chats on the web, each message opens a DM row whose push
// is held back because they are reading the room, and the web's read closes
// it. No phone was shown it, so the read wakes no phone (review: room-read
// push for notifications never pushed).
func TestARoomReadAfterAHeldBackPushWakesNoPhone(t *testing.T) {
	f, chat, dm := roomFixture(t)
	before := len(f.events(t, TopicRoomNotificationsCleared))
	for _, body := range []string{"một", "hai"} {
		sendDM(t, f, chat, dm, body)
		spy := &spySender{}
		pc := NewPushConsumer(f.q, spy, "http://app.test")
		pc.SetPresence(fakePresence{at: time.Now(), ok: true})
		push := f.lastEvent(t, TopicPush)
		if err := pc.Handle(f.ctx, push); err != nil {
			t.Fatal(err)
		}
		if len(spy.sent) != 0 {
			t.Fatalf("a push to someone reading the room went out: %+v", spy.sent)
		}
		if n := f.notificationOf(t, push); !n.PushedAt.Valid || n.PhonePushedAt.Valid {
			t.Fatalf("held-back push: pushed_at %v, phone_pushed_at %v; want only pushed_at", n.PushedAt, n.PhonePushedAt)
		}
		if err := chat.MarkRoomRead(f.ctx, f.member.ID, f.wsID, dm.ID); err != nil {
			t.Fatal(err)
		}
	}
	if after := f.events(t, TopicRoomNotificationsCleared); len(after) != before {
		t.Fatalf("reads of rows no phone was shown wrote %d cleared rows", len(after)-before)
	}
}

// A row read before its push went out (the push lane had not reached it, or
// the person's preferences send no push) was in no tray either.
func TestARoomReadBeforeThePushWakesNoPhone(t *testing.T) {
	f, chat, dm := roomFixture(t)
	before := len(f.events(t, TopicRoomNotificationsCleared))
	sendDM(t, f, chat, dm, "chào")
	if err := chat.MarkRoomRead(f.ctx, f.member.ID, f.wsID, dm.ID); err != nil {
		t.Fatal(err)
	}
	if after := f.events(t, TopicRoomNotificationsCleared); len(after) != before {
		t.Fatalf("a read of a row never pushed wrote %d cleared rows", len(after)-before)
	}
	spy := &spySender{}
	if err := NewPushConsumer(f.q, spy, "http://app.test").Handle(f.ctx, f.lastEvent(t, TopicPush)); err != nil {
		t.Fatal(err)
	}
	if len(spy.sent) != 0 {
		t.Fatalf("a push for a row already read went out: %+v", spy.sent)
	}
}

// readingSender reads the room the first time it sends, the race where the
// read lands between the push lane's read check and the push reaching a tray.
type readingSender struct {
	spySender
	read func()
}

func (s *readingSender) Send(ctx context.Context, sub db.PushSubscription, m PushMessage) error {
	if s.read != nil {
		s.read()
		s.read = nil
	}
	return s.spySender.Send(ctx, sub, m)
}

// A read that closes the row while its push is on the way may tell the phone
// before the push lands there: a chat push claims the row, phone mark
// included, before it is sent (ClaimChatNotificationPush), so the read writes
// its own cleared row, and the push lane, once the push it just delivered is
// in the tray, takes it back out of the Android tray itself. A thread reply,
// which a room read does not close, is left alone.
func TestARoomReadDuringThePushClearsWhatTheLaneJustSent(t *testing.T) {
	f, chat, dm := roomFixture(t)
	sendDM(t, f, chat, dm, "chào")
	before := len(f.events(t, TopicRoomNotificationsCleared))
	spy := &readingSender{read: func() {
		if err := chat.MarkRoomRead(f.ctx, f.member.ID, f.wsID, dm.ID); err != nil {
			t.Fatal(err)
		}
	}}
	push := f.lastEvent(t, TopicPush)
	if err := NewPushConsumer(f.q, spy, "http://app.test").Handle(f.ctx, push); err != nil {
		t.Fatal(err)
	}
	if after := f.events(t, TopicRoomNotificationsCleared); len(after) != before+1 {
		t.Fatalf("the read wrote %d cleared rows, want 1 for the phone the claim marked", len(after)-before)
	}
	if n := f.notificationOf(t, push); !n.PhonePushedAt.Valid || !n.ReadAt.Valid {
		t.Fatalf("phone_pushed_at %v, read_at %v; want both", n.PhonePushedAt, n.ReadAt)
	}
	want := PushMessage{TTL: 86400, Cleared: RoomCleared{RoomID: dm.ID, WorkspaceID: f.wsID}}
	last := len(spy.sent) - 1
	if last < 1 || spy.sent[last] != want || spy.endpoints[last] != "ExponentPushToken[android]" || spy.sent[last-1].Cleared != (RoomCleared{}) {
		t.Fatalf("pushes = %+v to %v, want the message then %+v to the Android phone only", spy.sent, spy.endpoints, want)
	}
}
