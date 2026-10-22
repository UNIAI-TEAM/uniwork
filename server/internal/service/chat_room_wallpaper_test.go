package service

import (
	"context"
	"testing"
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
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	group, err := s.CreateGroup(ctx, ua.ID, w.ID, CreateGroupInput{
		Name:          "wallpaper group",
		MemberUserIDs: []string{ub.ID},
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
