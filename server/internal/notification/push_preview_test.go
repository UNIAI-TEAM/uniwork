package notification

import (
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Audit "Security & privacy", push-preview-plaintext: the words of a chat push
// pass through Expo, FCM and APNs and sit on a lock screen, and so does its
// title, which names the sender. A person who hid previews, or an organization
// that did, gets "Tin nhắn riêng mới" with no body and no name; the ids that
// open the room and power Reply are unchanged.
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
	if got := spy.sent[len(spy.sent)-1]; got.Body != "lương tháng này" || got.Title != "Chủ Nhóm đã nhắn tin cho bạn" {
		t.Fatalf("shown by default: %+v", got)
	}

	if _, err := f.q.SetUserPushPreviewsHidden(f.ctx, db.SetUserPushPreviewsHiddenParams{ID: f.member.ID, Hidden: true}); err != nil {
		t.Fatal(err)
	}
	send("mật khẩu wifi")
	got := spy.sent[len(spy.sent)-1]
	if got.Body != "" || got.Title != "Tin nhắn riêng mới" || got.Chat.RoomID != dm.ID {
		t.Fatalf("hidden by the person: %+v", got)
	}

	if _, err := f.q.SetUserPushPreviewsHidden(f.ctx, db.SetUserPushPreviewsHiddenParams{ID: f.member.ID, Hidden: false}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.q.SetOrganizationPushPreviewPolicy(f.ctx, db.SetOrganizationPushPreviewPolicyParams{ID: f.orgID, Hidden: true, ActorID: f.owner.ID}); err != nil {
		t.Fatal(err)
	}
	send("hợp đồng mới")
	if got := spy.sent[len(spy.sent)-1]; got.Body != "" || strings.Contains(got.Title, "Chủ Nhóm") {
		t.Fatalf("hidden by the organization: %+v", got)
	}
}

// A task's push names its title and who assigned it; with the organization's
// policy on, it reaches the phone as "Bạn có thông báo mới" and nothing else.
func TestHiddenPreviewsAlsoHideTaskAndDocumentTitles(t *testing.T) {
	f := newFixture(t)
	if _, err := f.q.SetOrganizationPushPreviewPolicy(f.ctx, db.SetOrganizationPushPreviewPolicyParams{ID: f.orgID, Hidden: true, ActorID: f.owner.ID}); err != nil {
		t.Fatal(err)
	}
	f.subscribe(t, f.member.ID, "ExponentPushToken[member]")
	task := f.newTask(t, "Hợp đồng mật")
	f.assign(t, task.ID, f.member.ID)
	f.handleLast(t, "task.updated")
	spy := &spySender{}
	pc := NewPushConsumer(f.q, spy, "http://app.test")
	if err := pc.Handle(f.ctx, f.lastEvent(t, TopicPush)); err != nil {
		t.Fatal(err)
	}
	if len(spy.sent) != 1 {
		t.Fatalf("sent = %+v", spy.sent)
	}
	if got := spy.sent[0]; got.Title != "Bạn có thông báo mới" || got.Body != "" || strings.Contains(got.Title, "Hợp đồng") {
		t.Fatalf("hidden task push = %+v", got)
	}
}
