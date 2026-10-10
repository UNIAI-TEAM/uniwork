package service

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// defaultChannelRole is the user's active role in the default channel, or ""
// when they are not in it.
func defaultChannelRole(t *testing.T, q *db.Queries, roomID, userID string) string {
	t.Helper()
	m, err := q.GetActiveChatRoomMember(context.Background(), db.GetActiveChatRoomMemberParams{RoomID: roomID, UserID: userID})
	if errors.Is(err, pgx.ErrNoRows) {
		return ""
	}
	if err != nil {
		t.Fatal(err)
	}
	return m.Role
}

// Workspace membership commands keep the default channel in step inside their
// own transaction (C5), so opening chat has nothing left to repair.
func TestWorkspaceMembershipChangesReachTheDefaultChannel(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	room, err := s.EnsureWorkspaceRoom(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}

	invs, _, err := s.ws.InviteMany(ctx, ua.ID, w.ID, []string{ub.Email}, "member")
	if err != nil || len(invs) != 1 {
		t.Fatalf("invite: %v %d", err, len(invs))
	}
	if _, err := s.ws.AcceptInvite(ctx, ub.ID, invs[0].Token); err != nil {
		t.Fatal(err)
	}
	if got := defaultChannelRole(t, q, room.RoomID, ub.ID); got != "member" {
		t.Fatalf("after accepting the invite: role %q, want member", got)
	}

	if _, err := s.ws.UpdateMemberRole(ctx, ua.ID, w.ID, ub.ID, "admin"); err != nil {
		t.Fatal(err)
	}
	if got := defaultChannelRole(t, q, room.RoomID, ub.ID); got != "admin" {
		t.Fatalf("after promotion: role %q, want admin", got)
	}

	if err := s.ws.RemoveMember(ctx, ua.ID, w.ID, ub.ID); err != nil {
		t.Fatal(err)
	}
	if got := defaultChannelRole(t, q, room.RoomID, ub.ID); got != "" {
		t.Fatalf("after removal: still in the default channel as %q", got)
	}

	// A row written behind the commands' back is repaired by the next open.
	addWorkspaceMember(t, q, w.ID, ub.ID)
	if _, err := s.EnsureWorkspaceRoom(ctx, ua.ID, w.ID); err != nil {
		t.Fatal(err)
	}
	if got := defaultChannelRole(t, q, room.RoomID, ub.ID); got != "member" {
		t.Fatalf("safety net: role %q, want member", got)
	}

	members := NewOrganizationMemberService(s.pool, q, s.ws.orgs)
	if err := members.Leave(ctx, ub.ID, w.OrganizationID); err != nil {
		t.Fatal(err)
	}
	if got := defaultChannelRole(t, q, room.RoomID, ub.ID); got != "" {
		t.Fatalf("after leaving the organization: still in the default channel as %q", got)
	}
}

// Deactivation keeps the workspace row, so the safety net must not read it
// as a member to re-add: the person stays out of the default channel, and a
// row left active behind Deactivate's back is marked left (UNI-1084).
func TestDeactivatedMemberStaysOutOfTheDefaultChannel(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	room, err := s.EnsureWorkspaceRoom(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got := defaultChannelRole(t, q, room.RoomID, ub.ID); got != "member" {
		t.Fatalf("before deactivation: role %q, want member", got)
	}
	members := NewOrganizationMemberService(s.pool, q, s.ws.orgs)
	if _, err := members.Deactivate(ctx, ua.ID, w.OrganizationID, ub.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.EnsureWorkspaceRoom(ctx, ua.ID, w.ID); err != nil {
		t.Fatal(err)
	}
	if got := defaultChannelRole(t, q, room.RoomID, ub.ID); got != "" {
		t.Fatalf("after deactivation and a chat open: back in the default channel as %q", got)
	}

	if err := q.InsertChatRoomMembers(ctx, db.InsertChatRoomMembersParams{
		Ids: []string{util.NewID()}, RoomIds: []string{room.RoomID}, WorkspaceID: w.ID,
		UserIds: []string{ub.ID}, Roles: []string{"member"}, OrganizationID: w.OrganizationID,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.EnsureWorkspaceRoom(ctx, ua.ID, w.ID); err != nil {
		t.Fatal(err)
	}
	if got := defaultChannelRole(t, q, room.RoomID, ub.ID); got != "" {
		t.Fatalf("a deactivated member's active row survived the sync as %q", got)
	}
}

// POST /chat/room runs the same number of statements for 3 members as for 23.
func TestEnsureWorkspaceRoomIsConstantStatements(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	as := NewAuthService(s.pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	cs, counter := countingChatService(t, s)

	measure := func() int64 {
		t.Helper()
		before := counter.n.Load()
		if _, err := cs.EnsureWorkspaceRoom(ctx, ua.ID, w.ID); err != nil {
			t.Fatal(err)
		}
		return counter.n.Load() - before
	}
	measure() // creates the room
	small := measure()
	for i := 0; i < 20; i++ {
		u := registerVerified(t, q, as, fmt.Sprintf("chat-load-%02d@example.com", i), fmt.Sprintf("L%02d", i))
		addOrgMember(t, q, w.OrganizationID, u.ID)
		addWorkspaceMember(t, q, w.ID, u.ID)
	}
	joining := measure() // adds the 20 in one insert
	large := measure()
	t.Logf("EnsureWorkspaceRoom statements: 3 members %d, 20 joining %d, 23 members %d", small, joining, large)
	if small != large || joining > large+1 {
		t.Fatalf("statements grow with members: %d (3), %d (20 joining), %d (23)", small, joining, large)
	}
	rows, err := q.ListChatRoomMemberUserIDs(ctx, mustDefaultRoomID(t, q, w.ID))
	if err != nil || len(rows) != 22 {
		t.Fatalf("default channel members = %d, %v; want 22", len(rows), err)
	}
}

func mustDefaultRoomID(t *testing.T, q *db.Queries, workspaceID string) string {
	t.Helper()
	st, err := q.GetWorkspaceChatRoom(context.Background(), pgText(workspaceID))
	if err != nil {
		t.Fatal(err)
	}
	return st.ID
}
