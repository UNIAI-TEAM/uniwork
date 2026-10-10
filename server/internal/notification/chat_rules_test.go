package notification

import (
	"testing"

	"github.com/unicomhub/uniwork/server/internal/service"
)

// A DM, a mention and a thread reply reach the inbox through the outbox, one
// row per room (or thread) however many messages arrive before it is read,
// and push only for the first (H1).
func TestChatMessagesReachTheInbox(t *testing.T) {
	f := newFixture(t)
	chat := service.NewChatService(f.pool, f.q, f.ws, service.NopPublisher{})

	dm, err := chat.ResolveDM(f.ctx, f.owner.ID, f.wsID, f.member.ID)
	if err != nil {
		t.Fatal(err)
	}
	pushBefore := len(f.events(t, TopicPush))
	for _, body := range []string{"chào", "có đó không?"} {
		if _, err := chat.SendRoomMessage(f.ctx, f.owner.ID, f.wsID, dm.ID, service.SendChatMessageInput{Body: body}); err != nil {
			t.Fatal(err)
		}
	}
	for _, ev := range f.events(t, "chat.dm.received") {
		if err := f.consumer.Handle(f.ctx, ev); err != nil {
			t.Fatal(err)
		}
	}
	got := f.inbox(t, f.member.ID)
	if len(got) != 1 || got[0].Kind != KindChatDM || got[0].Count != 2 || got[0].ResourceType != "chat_message" ||
		got[0].GroupKey != "chat_room:"+dm.ID+":dm" || got[0].WorkspaceID.String != f.wsID {
		t.Fatalf("dm inbox = %+v", got)
	}
	if !contains(got[0].Params, `"actor":"Chủ Nhóm"`) {
		t.Fatalf("dm params = %s", got[0].Params)
	}
	if n := len(f.events(t, TopicPush)) - pushBefore; n != 1 {
		t.Fatalf("a burst of two DMs pushed %d times, want 1", n)
	}
	if len(f.inbox(t, f.owner.ID)) != 0 {
		t.Fatal("the sender was notified of their own DM")
	}

	ch, err := chat.CreateChannel(f.ctx, f.owner.ID, f.wsID, service.CreateChannelInput{
		Name: "thong-bao", Visibility: "public", MemberUserIDs: []string{f.member.ID},
	})
	if err != nil {
		t.Fatal(err)
	}
	root, err := chat.SendRoomMessage(f.ctx, f.owner.ID, f.wsID, ch.ID, service.SendChatMessageInput{
		Body: "[@Thành Viên](mention://member/" + f.member.ID + ") xem giúp",
	})
	if err != nil {
		t.Fatal(err)
	}
	f.handleLast(t, "chat.message.mentioned")
	got = f.inbox(t, f.member.ID)
	if len(got) != 2 || got[0].Kind != KindChatMentioned || got[0].ResourceID != root.ID || !contains(got[0].Params, `"room":"thong-bao"`) {
		t.Fatalf("mention inbox = %+v", got)
	}

	if _, err := chat.SendThreadReply(f.ctx, f.member.ID, f.wsID, ch.ID, root.ID, service.SendChatMessageInput{Body: "ok"}); err != nil {
		t.Fatal(err)
	}
	f.handleLast(t, "chat.thread.reply_received")
	got = f.inbox(t, f.owner.ID)
	if len(got) != 1 || got[0].Kind != KindChatThreadReplied || got[0].GroupKey != "chat_thread:"+root.ID+":reply" {
		t.Fatalf("thread inbox = %+v", got)
	}

	// A message deleted before delivery notifies nobody.
	gone, err := chat.SendRoomMessage(f.ctx, f.member.ID, f.wsID, dm.ID, service.SendChatMessageInput{Body: "nhầm"})
	if err != nil {
		t.Fatal(err)
	}
	if err := chat.DeleteChatMessage(f.ctx, f.member.ID, f.wsID, dm.ID, gone.ID); err != nil {
		t.Fatal(err)
	}
	f.handleLast(t, "chat.dm.received")
	if got := f.inbox(t, f.owner.ID); len(got) != 1 {
		t.Fatalf("deleted message notified: %+v", got)
	}
}
