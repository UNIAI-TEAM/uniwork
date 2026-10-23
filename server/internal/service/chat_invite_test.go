package service

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
)

// Inviting fans one event per new member out to every member. A channel's
// moderators decide who joins it; in a group anyone may add people while the
// group stays small. One request names at most chatInviteMaxIDs people.
func TestInviteMembersNeedsAModeratorOutsideSmallGroups(t *testing.T) {
	s, _, q, ua, ub, w, pool := chatFixtureWithPool(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	uc := registerVerified(t, q, as, "chat-invite-c@example.com", "C")
	addOrgMember(t, q, w.OrganizationID, uc.ID)
	addWorkspaceMember(t, q, w.ID, uc.ID)

	ch, err := s.CreateChannel(ctx, ua.ID, w.ID, CreateChannelInput{
		Name: "ops", Visibility: chatVisibilityPrivate, MemberUserIDs: []string{ub.ID},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.InviteGroupMembers(ctx, ub.ID, w.ID, ch.ID, []string{uc.ID}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("member invite into a channel: want ErrForbidden, got %v", err)
	}
	if _, err := s.InviteGroupMembers(ctx, ua.ID, w.ID, ch.ID, []string{uc.ID}); err != nil {
		t.Fatalf("channel owner invite: %v", err)
	}

	ud := registerVerified(t, q, as, "chat-invite-d@example.com", "D")
	addOrgMember(t, q, w.OrganizationID, ud.ID)
	group, err := s.CreateGroup(ctx, ua.ID, w.ID, CreateGroupInput{Name: "g", MemberUserIDs: []string{ub.ID, uc.ID}})
	if err != nil {
		t.Fatal(err)
	}
	smallChatRoom(t, 3)
	if _, err := s.InviteGroupMembers(ctx, ub.ID, w.ID, group.ID, []string{ud.ID}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("member invite past the small-group bound: want ErrForbidden, got %v", err)
	}
	// Naming someone already in the group does not grow it (UNI-1073).
	if _, err := s.InviteGroupMembers(ctx, ub.ID, w.ID, group.ID, []string{uc.ID}); err != nil {
		t.Fatalf("member re-invite of an existing member at the bound: %v", err)
	}
	smallChatRoom(t, 50)
	// One outsider refuses the whole invite before anything is written.
	outsider := registerVerified(t, q, as, "chat-invite-x@example.com", "X")
	if _, err := s.InviteGroupMembers(ctx, ub.ID, w.ID, group.ID, []string{ud.ID, outsider.ID}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("invite naming a non-member of the organization: want ErrNotFound, got %v", err)
	}
	if ids, err := q.ListChatRoomMemberUserIDs(ctx, group.ID); err != nil || len(ids) != 3 {
		t.Fatalf("a refused invite left members %v (err %v), want the 3 it started with", ids, err)
	}
	if _, err := s.InviteGroupMembers(ctx, ub.ID, w.ID, group.ID, []string{ud.ID}); err != nil {
		t.Fatalf("member invite into a small group: %v", err)
	}

	tooMany := make([]string, chatInviteMaxIDs+1)
	for i := range tooMany {
		tooMany[i] = fmt.Sprintf("01J8X4USR0%016d", i)
	}
	if _, err := s.InviteGroupMembers(ctx, ua.ID, w.ID, group.ID, tooMany); !isValidation(err) {
		t.Fatalf("invite of %d ids: want a validation error, got %v", len(tooMany), err)
	}
}
