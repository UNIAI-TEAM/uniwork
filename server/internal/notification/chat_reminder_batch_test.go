package notification

import (
	"context"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	authpkg "github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type countingMemberGate struct {
	inner MemberChecker
	n     atomic.Int64
}

func (c *countingMemberGate) RequireMember(ctx context.Context, workspaceID, userID string) (db.WorkspaceMember, error) {
	c.n.Add(1)
	return c.inner.RequireMember(ctx, workspaceID, userID)
}

// Due reminders on a workspace channel must not call RequireMember once per
// room member (UNI-1727).
func TestChatReminderDueOnLargeChannelBatchMembershipGate(t *testing.T) {
	f := newFixture(t)
	const extra = 24
	userIDs := make([]string, 0, extra)
	auth := service.NewAuthService(f.pool, f.q, authpkg.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	for i := 0; i < extra; i++ {
		u := f.register(t, auth, fmt.Sprintf("ch-mem-%d@example.com", i), "Thành viên")
		if err := f.q.AddOrganizationMember(f.ctx, db.AddOrganizationMemberParams{OrganizationID: f.orgID, UserID: u.ID, Role: "member"}); err != nil {
			t.Fatal(err)
		}
		if err := f.q.AddWorkspaceMember(f.ctx, db.AddWorkspaceMemberParams{WorkspaceID: f.wsID, OrganizationID: f.orgID, UserID: u.ID, Role: "member"}); err != nil {
			t.Fatal(err)
		}
		userIDs = append(userIDs, u.ID)
	}
	chat := service.NewChatService(f.pool, f.q, f.ws, service.NopPublisher{})
	ch, err := chat.CreateChannel(f.ctx, f.owner.ID, f.wsID, service.CreateChannelInput{
		Name: "dong", Visibility: "public", MemberUserIDs: append([]string{f.member.ID}, userIDs...),
	})
	if err != nil {
		t.Fatal(err)
	}
	remindAt := time.Now().Add(time.Minute).Truncate(time.Second)
	if _, err := chat.SendReminderMessage(f.ctx, f.owner.ID, f.wsID, ch.ID, service.SendReminderMessageInput{
		Body: "Deadline", RemindAt: remindAt.Format(time.RFC3339),
	}); err != nil {
		t.Fatal(err)
	}
	if n, err := chat.NewChatReminderWorker().RunOnce(f.ctx, remindAt.Add(time.Second)); err != nil || n != 1 {
		t.Fatalf("worker fired %d (err %v), want 1", n, err)
	}
	gate := &countingMemberGate{inner: f.ws}
	consumer := NewConsumer(f.pool, f.q, gate)
	if err := consumer.Handle(f.ctx, f.lastEvent(t, "chat.reminder.due")); err != nil {
		t.Fatal(err)
	}
	if got := gate.n.Load(); got != 0 {
		t.Fatalf("RequireMember calls = %d, want 0 for a workspace channel reminder", got)
	}
}
