package notification

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/outbox"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// burstDM sends one DM from the owner to the member and returns its message
// id and push row.
func burstDM(t *testing.T, f *fixture, chat *service.ChatService, dm service.ChatRoomSummary, body string) (string, outbox.Row) {
	t.Helper()
	msg, err := chat.SendRoomMessage(f.ctx, f.owner.ID, f.wsID, dm.ID, service.SendChatMessageInput{Body: body})
	if err != nil {
		t.Fatal(err)
	}
	f.handleLast(t, "chat.dm.received")
	return msg.ID, f.lastEvent(t, TopicPush)
}

// Every message of a burst reaches the phone with its own words, grouped
// under the room's tag; the first alerts and the ones inside chatAlertWindow
// after it come quietly. A push row the lane delivers twice, or one that
// arrives after a newer message of the room was pushed, sends nothing.
func TestEveryChatMessagePushesAndABurstAlertsOnce(t *testing.T) {
	f, chat, dm := roomFixture(t)
	spy := &spySender{}
	pc := NewPushConsumer(f.q, spy, "http://app.test")
	handle := func(ev outbox.Row) {
		t.Helper()
		if err := pc.Handle(f.ctx, ev); err != nil {
			t.Fatal(err)
		}
	}
	// sentTo returns the pushes that went to the Android phone.
	sentTo := func(endpoint string) []PushMessage {
		var out []PushMessage
		for i, m := range spy.sent {
			if spy.endpoints[i] == endpoint && m.Cleared == (RoomCleared{}) {
				out = append(out, m)
			}
		}
		return out
	}

	firstID, first := burstDM(t, f, chat, dm, "một")
	handle(first)
	secondID, second := burstDM(t, f, chat, dm, "hai")
	thirdID, third := burstDM(t, f, chat, dm, "ba")
	handle(third)
	// The lane reaching the second message after the third went out drops it:
	// the tray already shows the newer one.
	handle(second)
	handle(third)

	phone := sentTo("ExponentPushToken[android]")
	if len(phone) != 2 {
		t.Fatalf("android pushes = %+v, want the first and the third message", phone)
	}
	if phone[0].Body != "một" || phone[0].Chat.MessageID != firstID || phone[0].Quiet {
		t.Fatalf("first push = %+v, want an alerting push of %s", phone[0], firstID)
	}
	if phone[1].Body != "ba" || phone[1].Chat.MessageID != thirdID || !phone[1].Quiet {
		t.Fatalf("third push = %+v, want a quiet push of %s", phone[1], thirdID)
	}
	tag := "chat_room:" + dm.ID + ":dm"
	if phone[0].Tag != tag || phone[1].Tag != tag {
		t.Fatalf("tags = %q, %q, want the room's group %q", phone[0].Tag, phone[1].Tag, tag)
	}
	if phone[0].Chat.Unread != 0 || phone[1].Chat.Unread != 3 {
		t.Fatalf("unread counts = %d, %d, want none on the first and 3 on the burst", phone[0].Chat.Unread, phone[1].Chat.Unread)
	}
	n := f.notificationOf(t, third)
	if n.PushedMessageID.String != thirdID {
		t.Fatalf("pushed_message_id = %q, want %s (not %s)", n.PushedMessageID.String, thirdID, secondID)
	}
	alerted := n.PhonePushedAt.Time

	// Past the window the room alerts again, and that alert restarts it. The
	// window runs on the database's clock, so the last alert is moved back.
	if _, err := f.pool.Exec(f.ctx, `UPDATE notifications SET phone_pushed_at = phone_pushed_at - $2::interval WHERE id = $1`,
		n.ID, (chatAlertWindow + time.Second).String()); err != nil {
		t.Fatal(err)
	}
	alerted = alerted.Add(-chatAlertWindow - time.Second)
	fourthID, fourth := burstDM(t, f, chat, dm, "bốn")
	handle(fourth)
	phone = sentTo("ExponentPushToken[android]")
	if len(phone) != 3 || phone[2].Chat.MessageID != fourthID || phone[2].Quiet {
		t.Fatalf("pushes after the window = %+v, want an alerting push of %s", phone, fourthID)
	}
	if n := f.notificationOf(t, fourth); !n.PhonePushedAt.Time.After(alerted) {
		t.Fatalf("phone_pushed_at = %v, want the new alert after %v", n.PhonePushedAt.Time, alerted)
	}
}

// Reading the room closes its row: the next message opens a new one and
// alerts at once, whatever the window of the old row said.
func TestAReadRoomAlertsAgainOnItsNextMessage(t *testing.T) {
	f, chat, dm := roomFixture(t)
	spy := &spySender{}
	pc := NewPushConsumer(f.q, spy, "http://app.test")
	_, first := burstDM(t, f, chat, dm, "một")
	if err := pc.Handle(f.ctx, first); err != nil {
		t.Fatal(err)
	}
	_, second := burstDM(t, f, chat, dm, "hai")
	if err := chat.MarkRoomRead(f.ctx, f.member.ID, f.wsID, dm.ID); err != nil {
		t.Fatal(err)
	}
	// The read closed the row before its second push ran: nothing goes out.
	before := len(spy.sent)
	if err := pc.Handle(f.ctx, second); err != nil {
		t.Fatal(err)
	}
	if len(spy.sent) != before {
		t.Fatalf("a push for a read row went out: %+v", spy.sent[before:])
	}
	thirdID, third := burstDM(t, f, chat, dm, "ba")
	if err := pc.Handle(f.ctx, third); err != nil {
		t.Fatal(err)
	}
	last := spy.sent[len(spy.sent)-1]
	if last.Chat.MessageID != thirdID || last.Quiet {
		t.Fatalf("push after the read = %+v, want an alerting push of %s", last, thirdID)
	}
}

// A push row written before pushes went per message names no message: it
// keeps the old once-per-row rule, so a retry after the deploy does not send
// a row that already went out again.
func TestAPushRowWithoutAMessageKeepsTheOncePerRowRule(t *testing.T) {
	f, chat, dm := roomFixture(t)
	spy := &spySender{}
	pc := NewPushConsumer(f.q, spy, "http://app.test")
	_, ev := burstDM(t, f, chat, dm, "một")
	ev.Payload = `{"notification_id":"` + payloadOf(t, ev)["notification_id"] + `","user_id":"` + f.member.ID + `"}`
	for range 2 {
		if err := pc.Handle(f.ctx, ev); err != nil {
			t.Fatal(err)
		}
	}
	if len(spy.sent) != 3 { // the Android phone, the iPhone and the browser, once
		t.Fatalf("legacy push row sent %d pushes, want 3", len(spy.sent))
	}
}

// raceSender is a spySender that runs during, once, in the middle of the
// first send: another push of the same row handled by another lane worker
// while this one is on the network.
type raceSender struct {
	spySender
	during func()
}

func (s *raceSender) Send(ctx context.Context, sub db.PushSubscription, m PushMessage) error {
	err := s.spySender.Send(ctx, sub, m)
	if h := s.during; h != nil {
		s.during = nil
		h()
	}
	return err
}

// phonePushes are the pushes that went to the member's Android phone.
func phonePushes(s *spySender) []PushMessage {
	var out []PushMessage
	for i, m := range s.sent {
		if s.endpoints[i] == "ExponentPushToken[android]" && m.Cleared == (RoomCleared{}) {
			out = append(out, m)
		}
	}
	return out
}

// Two lane workers on two pushes of one room: the push that claimed the row
// first decides. An older message reached while a newer one is on its way
// sends nothing (it would replace the newer one in the tray), and a burst
// still alerts once although both pushes read the row before either sent.
func TestConcurrentPushesOfARoomClaimTheRowBeforeSending(t *testing.T) {
	f, chat, dm := roomFixture(t)
	spy := &raceSender{}
	pc := NewPushConsumer(f.q, spy, "http://app.test")
	handle := func(ev outbox.Row) {
		t.Helper()
		if err := pc.Handle(f.ctx, ev); err != nil {
			t.Fatal(err)
		}
	}

	firstID, first := burstDM(t, f, chat, dm, "một")
	secondID, second := burstDM(t, f, chat, dm, "hai")
	// The second message's push runs while the first one's is on the network.
	spy.during = func() { handle(second) }
	handle(first)
	phone := phonePushes(&spy.spySender)
	alerts := 0
	for _, m := range phone {
		if !m.Quiet {
			alerts++
		}
	}
	if alerts != 1 {
		t.Fatalf("phone pushes = %+v, want one alert for the burst of %s and %s", phone, firstID, secondID)
	}

	_, third := burstDM(t, f, chat, dm, "ba")
	fourthID, fourth := burstDM(t, f, chat, dm, "bốn")
	before := len(phonePushes(&spy.spySender))
	// The older message's push runs while the newer one's is on the network: it sends nothing.
	spy.during = func() { handle(third) }
	handle(fourth)
	phone = phonePushes(&spy.spySender)[before:]
	if len(phone) != 1 || phone[0].Chat.MessageID != fourthID {
		t.Fatalf("phone pushes = %+v, want only the newer message %s", phone, fourthID)
	}
}

// A push the lane fails to send gives its claim back, so the retry sends it,
// and alerts, as the first try would have.
func TestAFailedChatPushIsSentByItsRetry(t *testing.T) {
	f, chat, dm := roomFixture(t)
	spy := &spySender{err: errors.New("expo down")}
	pc := NewPushConsumer(f.q, spy, "http://app.test")
	msgID, ev := burstDM(t, f, chat, dm, "một")
	if err := pc.Handle(f.ctx, ev); err == nil {
		t.Fatal("a failed send acknowledged its row")
	}
	spy.err = nil
	failed := len(spy.sent)
	if err := pc.Handle(f.ctx, ev); err != nil {
		t.Fatal(err)
	}
	phone := phonePushes(spy)
	if len(spy.sent) == failed || phone[len(phone)-1].Chat.MessageID != msgID || phone[len(phone)-1].Quiet {
		t.Fatalf("retry pushes = %+v, want an alerting push of %s", spy.sent[failed:], msgID)
	}
}

// The order of a room's messages is the database's (created_at, then id), not
// the ids alone: ids are minted on the API nodes' clocks, and a node a little
// behind gives a later message a lower id. That message still pushes.
func TestALaterMessageWithALowerIDStillPushes(t *testing.T) {
	f, chat, dm := roomFixture(t)
	spy := &spySender{}
	pc := NewPushConsumer(f.q, spy, "http://app.test")
	lowID, low := burstDM(t, f, chat, dm, "một")
	_, high := burstDM(t, f, chat, dm, "hai")
	if _, err := f.pool.Exec(f.ctx, `UPDATE chat_messages SET created_at = now() + interval '1 second' WHERE id = $1`, lowID); err != nil {
		t.Fatal(err)
	}
	for _, ev := range []outbox.Row{high, low} {
		if err := pc.Handle(f.ctx, ev); err != nil {
			t.Fatal(err)
		}
	}
	phone := phonePushes(spy)
	if len(phone) != 2 || phone[1].Chat.MessageID != lowID {
		t.Fatalf("phone pushes = %+v, want the later message %s pushed last", phone, lowID)
	}
}
