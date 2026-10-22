package service

import (
	"bytes"
	"context"
	"testing"
)

func TestUpdateChatRoomWallpaperPreset_DMMemberAllowed(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	// A DM needs both people in the organization and the workspace.
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
	// A group holds at least two people besides its creator.
	uc := chatTestUser(t, q, w, "wallpaper-c@example.com")
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

// A room's custom wallpaper goes through the shared upload session, whose
// purpose checks must name chat_room_wallpaper (9991792900000006).
func TestChatRoomWallpaperUploadIsStored(t *testing.T) {
	f := groupAvatarFixture(t)
	ctx := context.Background()
	if _, err := f.s.UploadRoomWallpaper(ctx, f.ua.ID, f.w.ID, f.group.ID, "nen.png", bytes.NewReader(workspaceIconPNG)); err != nil {
		t.Fatal(err)
	}
	room, err := f.q.GetChatRoomByID(ctx, f.group.ID)
	if err != nil || !room.WallpaperFileID.Valid {
		t.Fatalf("room after upload: %+v err=%v", room, err)
	}
}
