package service

import (
	"context"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The switcher's totals: channels per workspace, dms and groups once per
// organization, a muted room adding only its mentions, a blocked peer's dm
// left out as in the sidebar, and an organization that has deactivated the
// caller dropped with everything in it.
func TestChatUnreadSummary(t *testing.T) {
	s, _, q, ua, ub, w1 := chatFixture(t)
	ctx := context.Background()
	as := NewAuthService(s.pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	uc := registerVerified(t, q, as, "chat-sum-c@example.com", "C")
	ux := registerVerified(t, q, as, "chat-sum-x@example.com", "X")
	w2v, err := s.ws.CreateInOrg(ctx, ua.ID, w1.OrganizationID, "Chat WS 2", "chat-ws-2")
	if err != nil {
		t.Fatal(err)
	}
	w2 := w2v.Workspace
	for _, u := range []db.User{ub, uc} {
		addOrgMember(t, q, w1.OrganizationID, u.ID)
		addWorkspaceMember(t, q, w1.ID, u.ID)
		addWorkspaceMember(t, q, w2.ID, u.ID)
	}
	send := func(sender db.User, wsID, roomID string, bodies ...string) {
		t.Helper()
		for _, b := range bodies {
			if _, err := s.SendRoomMessage(ctx, sender.ID, wsID, roomID, SendChatMessageInput{Body: b}); err != nil {
				t.Fatal(err)
			}
		}
	}
	channel := func(owner db.User, wsID, name string, members ...string) string {
		t.Helper()
		ch, err := s.CreateChannel(ctx, owner.ID, wsID, CreateChannelInput{Name: name, Visibility: chatVisibilityPublic, MemberUserIDs: members})
		if err != nil {
			t.Fatal(err)
		}
		return ch.ID
	}
	dm := func(from db.User, wsID string, to db.User) string {
		t.Helper()
		room, err := s.ResolveDM(ctx, from.ID, wsID, to.ID)
		if err != nil {
			t.Fatal(err)
		}
		return room.ID
	}

	// Organization 1, two workspaces.
	send(ub, w1.ID, channel(ua, w1.ID, "kenh-a", ub.ID), "1", "2", "3")
	muted := channel(ua, w2.ID, "kenh-b", ub.ID)
	send(ub, w2.ID, muted, "1", "2", mentionOf(ua)+"xem giúp")
	if err := s.SetRoomNotificationsMuted(ctx, ua.ID, w2.ID, muted, true); err != nil {
		t.Fatal(err)
	}
	mutedDM := dm(ua, w1.ID, ub)
	send(ub, w1.ID, mutedDM, "a", "b")
	if err := s.SetRoomNotificationsMuted(ctx, ua.ID, w1.ID, mutedDM, true); err != nil {
		t.Fatal(err)
	}
	group, err := s.CreateGroup(ctx, ua.ID, w1.ID, CreateGroupInput{Name: "Trio", MemberUserIDs: []string{ub.ID, uc.ID}})
	if err != nil {
		t.Fatal(err)
	}
	send(ub, w2.ID, group.ID, mentionOf(ua)+"nhóm")
	send(uc, w1.ID, dm(uc, w1.ID, ua), "chặn")
	if err := s.BlockChatUser(ctx, ua.ID, w1.ID, uc.ID); err != nil {
		t.Fatal(err)
	}

	// Organization 2, which the caller also belongs to (an account from
	// before ADR 0032).
	org2, err := s.ws.orgs.Create(ctx, ux.ID, "Org 2", "org-chat-sum-2")
	if err != nil {
		t.Fatal(err)
	}
	w3v, err := s.ws.CreateInOrg(ctx, ux.ID, org2.ID, "Chat WS 3", "chat-ws-3")
	if err != nil {
		t.Fatal(err)
	}
	w3 := w3v.Workspace
	addOrgMember(t, q, org2.ID, ua.ID)
	addWorkspaceMember(t, q, w3.ID, ua.ID)
	send(ux, w3.ID, channel(ux, w3.ID, "kenh-c", ua.ID), "1", "2")
	send(ux, w3.ID, dm(ux, w3.ID, ua), "chào")

	got, err := s.UnreadSummary(ctx, ua.ID)
	if err != nil {
		t.Fatal(err)
	}
	// group 1 (a mention) + org 2's dm 1; the muted dm has no mention, the
	// blocked peer's dm is hidden.
	if got.Direct != (ChatUnreadTotals{Unread: 2, Mentions: 1}) {
		t.Fatalf("direct = %+v, want unread 2 mentions 1", got.Direct)
	}
	want := map[string]ChatUnreadTotals{
		w1.ID: {Unread: 3},
		w2.ID: {Unread: 1, Mentions: 1}, // muted: the mention only
		w3.ID: {Unread: 2},
	}
	assertWorkspaceTotals(t, got.Workspaces, want)

	if _, err := s.pool.Exec(ctx,
		`UPDATE organization_members SET deactivated_at = now() WHERE organization_id = $1 AND user_id = $2`,
		org2.ID, ua.ID); err != nil {
		t.Fatal(err)
	}
	got, err = s.UnreadSummary(ctx, ua.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.Direct != (ChatUnreadTotals{Unread: 1, Mentions: 1}) {
		t.Fatalf("direct after deactivation = %+v, want organization 1's group only", got.Direct)
	}
	delete(want, w3.ID)
	assertWorkspaceTotals(t, got.Workspaces, want)
}

func assertWorkspaceTotals(t *testing.T, got []ChatWorkspaceUnread, want map[string]ChatUnreadTotals) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("workspaces = %+v, want %d", got, len(want))
	}
	for _, ws := range got {
		w, ok := want[ws.WorkspaceID]
		if !ok || ws.ChatUnreadTotals != w {
			t.Fatalf("workspace %s = %+v, want %+v (listed %v)", ws.WorkspaceID, ws.ChatUnreadTotals, w, ok)
		}
	}
}
