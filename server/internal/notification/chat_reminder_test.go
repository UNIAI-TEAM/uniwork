package notification

import (
	"testing"
	"time"

	authpkg "github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// A due chat reminder reaches every room member's inbox through the server's
// worker, with no browser involved, and a redelivered event adds nothing.
func TestChatReminderDueNotifiesRoomMembers(t *testing.T) {
	f := newFixture(t)
	third := f.register(t, service.NewAuthService(f.pool, f.q, authpkg.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil), "third@example.com", "Người Ba")
	if err := f.q.AddOrganizationMember(f.ctx, db.AddOrganizationMemberParams{OrganizationID: f.orgID, UserID: third.ID, Role: "member"}); err != nil {
		t.Fatal(err)
	}
	if err := f.q.AddWorkspaceMember(f.ctx, db.AddWorkspaceMemberParams{WorkspaceID: f.wsID, OrganizationID: f.orgID, UserID: third.ID, Role: "member"}); err != nil {
		t.Fatal(err)
	}
	chat := service.NewChatService(f.pool, f.q, f.ws, service.NopPublisher{})
	room, err := chat.CreateGroup(f.ctx, f.owner.ID, f.wsID, service.CreateGroupInput{Name: "Nhóm", MemberUserIDs: []string{f.member.ID, third.ID}})
	if err != nil {
		t.Fatal(err)
	}
	remindAt := time.Now().Add(time.Minute).Truncate(time.Second)
	msg, err := chat.SendReminderMessage(f.ctx, f.owner.ID, f.wsID, room.ID, service.SendReminderMessageInput{
		Body: "Gửi hợp đồng", RemindAt: remindAt.Format(time.RFC3339),
	})
	if err != nil {
		t.Fatal(err)
	}
	if n, err := chat.NewChatReminderWorker().RunOnce(f.ctx, remindAt.Add(time.Second)); err != nil || n != 1 {
		t.Fatalf("worker fired %d (err %v), want 1", n, err)
	}
	f.handleLast(t, "chat.reminder.due")
	f.handleLast(t, "chat.reminder.due")

	for _, uid := range []string{f.owner.ID, f.member.ID, third.ID} {
		got := f.inbox(t, uid)
		if len(got) != 1 || got[0].Kind != KindChatReminder || got[0].ResourceID != msg.ID || got[0].Count != 1 {
			t.Fatalf("inbox of %s = %+v, want one chat_reminder for %s", uid, got, msg.ID)
		}
		if !contains(got[0].Params, "Gửi hợp đồng") {
			t.Fatalf("params = %s", got[0].Params)
		}
	}
	// Push is on by default for a due reminder.
	if evs := f.events(t, TopicPush); len(evs) != 3 {
		t.Fatalf("notification.push events = %d, want 3", len(evs))
	}
}
