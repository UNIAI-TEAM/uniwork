package service

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// H18: the group dedupe key was the whole member id list in a unique btree,
// so a group of ~99 people overflowed the index row and failed with a 500.
func TestLargeGroupIsCreatedAndStillDeduplicated(t *testing.T) {
	s, _, q, ua, _, w := chatFixture(t)
	ctx := context.Background()
	members := make([]string, 0, 120)
	for i := range 120 {
		u, err := q.CreateUser(ctx, db.CreateUserParams{
			ID: util.NewID(), Email: fmt.Sprintf("big-group-%d@example.com", i), DisplayName: fmt.Sprintf("U%d", i), Locale: "vi",
		})
		if err != nil {
			t.Fatal(err)
		}
		addOrgMember(t, q, w.OrganizationID, u.ID)
		members = append(members, u.ID)
	}
	group, err := s.CreateGroup(ctx, ua.ID, w.ID, CreateGroupInput{Name: "All hands", MemberUserIDs: members})
	if err != nil {
		t.Fatalf("create 121-person group: %v", err)
	}
	again, err := s.CreateGroup(ctx, ua.ID, w.ID, CreateGroupInput{Name: "All hands", MemberUserIDs: members})
	if err != nil || again.ID != group.ID {
		t.Fatalf("same members should resolve the same group: err=%v first=%s again=%s", err, group.ID, again.ID)
	}
}

// A group created before the digest key stored the member list itself; the
// rehash migration must produce exactly the key Go computes, or recreating
// that group makes a duplicate.
func TestLegacyGroupKeyIsRehashedByTheMigration(t *testing.T) {
	s, _, q, ua, _, w := chatFixture(t)
	ctx := context.Background()
	ub := chatTestUser(t, q, w, "legacy-key-b@example.com")
	uc := chatTestUser(t, q, w, "legacy-key-c@example.com")
	all := []string{ua.ID, ub.ID, uc.ID}
	legacy, err := s.createChatRoom(ctx, ua.ID, w.OrganizationID, w.ID, chatRoomKindGroup, "Legacy", memberSetKey(all), all)
	if err != nil {
		t.Fatal(err)
	}
	up, err := os.ReadFile(filepath.Join("..", "..", "migrations", "9991791623828586_chat_rooms_group_key_sha256.up.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.pool.Exec(ctx, string(up)); err != nil {
		t.Fatal(err)
	}
	got, err := s.CreateGroup(ctx, ua.ID, w.ID, CreateGroupInput{MemberUserIDs: []string{ub.ID, uc.ID}})
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != legacy.ID {
		t.Fatalf("recreating a legacy group made %s, want the existing %s", got.ID, legacy.ID)
	}
	// Running it again (or over a group already keyed by digest) is a no-op.
	if _, err := s.pool.Exec(ctx, string(up)); err != nil {
		t.Fatal(err)
	}
	room, err := q.GetChatRoomByID(ctx, legacy.ID)
	if err != nil || room.MemberSetKey.String != groupMemberSetKey(all) {
		t.Fatalf("key after a second run = %q, %v; want %q", room.MemberSetKey.String, err, groupMemberSetKey(all))
	}
}

// chatTestUser is an org and workspace member of w.
func chatTestUser(t *testing.T, q *db.Queries, w db.Workspace, email string) db.User {
	t.Helper()
	u, err := q.CreateUser(context.Background(), db.CreateUserParams{ID: util.NewID(), Email: email, DisplayName: email[:6], Locale: "vi"})
	if err != nil {
		t.Fatal(err)
	}
	addOrgMember(t, q, w.OrganizationID, u.ID)
	addWorkspaceMember(t, q, w.ID, u.ID)
	return u
}

func TestGroupSizeIsCapped(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	tooMany := make([]string, maxChatGroupMembers)
	for i := range tooMany {
		tooMany[i] = util.NewID()
	}
	_, err := s.CreateGroup(ctx, ua.ID, w.ID, CreateGroupInput{MemberUserIDs: tooMany})
	requireValidationError(t, err, "create past the cap")

	addOrgMember(t, q, w.OrganizationID, ub.ID)
	uc, err := q.CreateUser(ctx, db.CreateUserParams{ID: util.NewID(), Email: "group-cap-c@example.com", DisplayName: "C", Locale: "vi"})
	if err != nil {
		t.Fatal(err)
	}
	addOrgMember(t, q, w.OrganizationID, uc.ID)
	group, err := s.CreateGroup(ctx, ua.ID, w.ID, CreateGroupInput{MemberUserIDs: []string{ub.ID, uc.ID}})
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.InviteGroupMembers(ctx, ua.ID, w.ID, group.ID, tooMany[:maxChatGroupMembers-2])
	requireValidationError(t, err, "invite past the cap")
}
