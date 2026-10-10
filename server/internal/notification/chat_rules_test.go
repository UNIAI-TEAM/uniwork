package notification

import (
	"testing"
	"time"

	authpkg "github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
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

// A DM or group spans the organization: a recipient outside the workspace the
// room was opened from still hears it, linked to a workspace of their own,
// while a recipient inside it keeps that workspace (UNI-1074, UNI-1089).
func TestChatReachesRecipientsInOtherWorkspaces(t *testing.T) {
	f := newFixture(t)
	auth := service.NewAuthService(f.pool, f.q, authpkg.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	bob := f.register(t, auth, "bob@example.com", "Bob Ops")
	ops, err := f.ws.CreateInOrg(f.ctx, f.owner.ID, f.orgID, "Ops", "ops")
	if err != nil {
		t.Fatal(err)
	}
	opsID := ops.Workspace.ID
	if err := f.q.AddOrganizationMember(f.ctx, db.AddOrganizationMemberParams{OrganizationID: f.orgID, UserID: bob.ID, Role: "member"}); err != nil {
		t.Fatal(err)
	}
	if err := f.q.AddWorkspaceMember(f.ctx, db.AddWorkspaceMemberParams{WorkspaceID: opsID, OrganizationID: f.orgID, UserID: bob.ID, Role: "member"}); err != nil {
		t.Fatal(err)
	}
	chat := service.NewChatService(f.pool, f.q, f.ws, service.NopPublisher{})
	wsOf := func(uid, kind string) string {
		t.Helper()
		for _, n := range f.inbox(t, uid) {
			if n.Kind == kind {
				return n.WorkspaceID.String
			}
		}
		t.Fatalf("no %s in the inbox of %s", kind, uid)
		return ""
	}

	// The DM is opened from Sales (f.wsID), where bob is not a member.
	dm, err := chat.ResolveDM(f.ctx, f.member.ID, f.wsID, bob.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := chat.SendRoomMessage(f.ctx, f.member.ID, f.wsID, dm.ID, service.SendChatMessageInput{Body: "chào Bob"}); err != nil {
		t.Fatal(err)
	}
	f.handleLast(t, "chat.dm.received")
	if ws := wsOf(bob.ID, KindChatDM); ws != opsID {
		t.Fatalf("dm workspace = %s, want ops %s", ws, opsID)
	}

	group, err := chat.CreateGroup(f.ctx, f.member.ID, f.wsID, service.CreateGroupInput{Name: "Liên phòng", MemberUserIDs: []string{f.owner.ID, bob.ID}})
	if err != nil {
		t.Fatal(err)
	}
	root, err := chat.SendRoomMessage(f.ctx, f.member.ID, f.wsID, group.ID, service.SendChatMessageInput{
		Body: "[@Bob Ops](mention://member/" + bob.ID + ") xem giúp",
	})
	if err != nil {
		t.Fatal(err)
	}
	f.handleLast(t, "chat.message.mentioned")
	if ws := wsOf(bob.ID, KindChatMentioned); ws != opsID {
		t.Fatalf("mention workspace = %s, want ops %s", ws, opsID)
	}

	if _, err := chat.SendThreadReply(f.ctx, bob.ID, opsID, group.ID, root.ID, service.SendChatMessageInput{Body: "ok"}); err != nil {
		t.Fatal(err)
	}
	if _, err := chat.SendThreadReply(f.ctx, f.owner.ID, f.wsID, group.ID, root.ID, service.SendChatMessageInput{Body: "cảm ơn"}); err != nil {
		t.Fatal(err)
	}
	for _, ev := range f.events(t, "chat.thread.reply_received") {
		if err := f.consumer.Handle(f.ctx, ev); err != nil {
			t.Fatal(err)
		}
	}
	if ws := wsOf(bob.ID, KindChatThreadReplied); ws != opsID {
		t.Fatalf("thread reply workspace = %s, want ops %s", ws, opsID)
	}
	if ws := wsOf(f.member.ID, KindChatThreadReplied); ws != f.wsID {
		t.Fatalf("thread reply workspace for a Sales member = %s, want %s", ws, f.wsID)
	}

	remindAt := time.Now().Add(time.Minute).Truncate(time.Second)
	if _, err := chat.SendReminderMessage(f.ctx, f.member.ID, f.wsID, group.ID, service.SendReminderMessageInput{
		Body: "Họp liên phòng", RemindAt: remindAt.Format(time.RFC3339),
	}); err != nil {
		t.Fatal(err)
	}
	if n, err := chat.NewChatReminderWorker().RunOnce(f.ctx, remindAt.Add(time.Second)); err != nil || n != 1 {
		t.Fatalf("worker fired %d (err %v), want 1", n, err)
	}
	f.handleLast(t, "chat.reminder.due")
	if ws := wsOf(bob.ID, KindChatReminder); ws != opsID {
		t.Fatalf("reminder workspace for bob = %s, want ops %s", ws, opsID)
	}
	if ws := wsOf(f.member.ID, KindChatReminder); ws != f.wsID {
		t.Fatalf("reminder workspace for a Sales member = %s, want %s", ws, f.wsID)
	}
}
