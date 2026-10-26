package service

import (
	"context"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestUpdateChatRoomWallpaperPreset_DMMemberAllowed(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.UpdateChatRoomWallpaperPreset(ctx, ua.ID, w.ID, dm.ID, "sky"); err != nil {
		t.Fatalf("dm member a: %v", err)
	}
	if err := s.UpdateChatRoomWallpaperPreset(ctx, ub.ID, w.ID, dm.ID, "mint"); err != nil {
		t.Fatalf("dm member b: %v", err)
	}
}

func TestUpdateChatRoomWallpaperPreset_GroupMemberForbidden(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	as := NewAuthService(s.pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	uc := registerVerified(t, q, as, "chat-wallpaper-c@example.com", "C")
	// A group needs two members besides its creator.
	for _, u := range []db.User{ub, uc} {
		addOrgMember(t, q, w.OrganizationID, u.ID)
		addWorkspaceMember(t, q, w.ID, u.ID)
	}
	group, err := s.CreateGroup(ctx, ua.ID, w.ID, CreateGroupInput{
		Name:          "wallpaper group",
		MemberUserIDs: []string{ub.ID, uc.ID},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := s.UpdateChatRoomWallpaperPreset(ctx, ub.ID, w.ID, group.ID, "sky"); err != ErrForbidden {
		t.Fatalf("regular member should be forbidden, got %v", err)
	}
	if err := s.UpdateChatRoomWallpaperPreset(ctx, ua.ID, w.ID, group.ID, "sky"); err != nil {
		t.Fatalf("group creator: %v", err)
	}
}
