package notification

import (
	"testing"

	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Audit "Security & privacy", push-preview-plaintext: the words of a chat push
// pass through Expo, FCM and APNs and sit on a lock screen. A person who hid
// them, or an organization that did, gets "Tin nhắn mới" with the sender in
// the title; the ids that open the room and power Reply are unchanged.
func TestChatPushHidesTheMessageTextWhenThePersonOrTheOrganizationAsks(t *testing.T) {
	f := newFixture(t)
	chat := service.NewChatService(f.pool, f.q, f.ws, service.NopPublisher{})
	dm, err := chat.ResolveDM(f.ctx, f.owner.ID, f.wsID, f.member.ID)
	if err != nil {
		t.Fatal(err)
	}
	f.subscribe(t, f.member.ID, "ExponentPushToken[member]")
	spy := &spySender{}
	pc := NewPushConsumer(f.q, spy, "http://app.test")
	send := func(body string) {
		t.Helper()
		f.readAll(t, f.member.ID)
		if _, err := chat.SendRoomMessage(f.ctx, f.owner.ID, f.wsID, dm.ID, service.SendChatMessageInput{Body: body}); err != nil {
			t.Fatal(err)
		}
		f.handleLast(t, "chat.dm.received")
		if err := pc.Handle(f.ctx, f.lastEvent(t, TopicPush)); err != nil {
			t.Fatal(err)
		}
	}

	send("lương tháng này")
	if got := spy.sent[len(spy.sent)-1]; got.Body != "lương tháng này" {
		t.Fatalf("shown by default: %+v", got)
	}

	if _, err := f.q.SetUserPushPreviewsHidden(f.ctx, db.SetUserPushPreviewsHiddenParams{ID: f.member.ID, Hidden: true}); err != nil {
		t.Fatal(err)
	}
	send("mật khẩu wifi")
	got := spy.sent[len(spy.sent)-1]
	if got.Body != "Tin nhắn mới" || got.Title != "Chủ Nhóm đã nhắn tin cho bạn" || got.Chat.RoomID != dm.ID {
		t.Fatalf("hidden by the person: %+v", got)
	}

	if _, err := f.q.SetUserPushPreviewsHidden(f.ctx, db.SetUserPushPreviewsHiddenParams{ID: f.member.ID, Hidden: false}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.q.SetOrganizationPushPreviewPolicy(f.ctx, db.SetOrganizationPushPreviewPolicyParams{ID: f.orgID, Hidden: true, ActorID: f.owner.ID}); err != nil {
		t.Fatal(err)
	}
	send("hợp đồng mới")
	if got := spy.sent[len(spy.sent)-1]; got.Body != "Tin nhắn mới" {
		t.Fatalf("hidden by the organization: %+v", got)
	}
}
