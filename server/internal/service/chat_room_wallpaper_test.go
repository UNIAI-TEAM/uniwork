package service

import (
	"bytes"
	"context"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/files"
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
	uc := chatTestUser(t, q, w, "wallpaper-group-c@example.com")
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

func TestUploadRoomWallpaper_GroupCreator(t *testing.T) {
	f := groupAvatarFixture(t)
	ctx := context.Background()
	sum, err := f.s.UploadRoomWallpaper(ctx, f.ua.ID, f.w.ID, f.group.ID, "wall.png", bytes.NewReader(workspaceIconPNG))
	if err != nil {
		t.Fatalf("upload: %v", err)
	}
	room, err := f.q.GetChatRoomByID(ctx, f.group.ID)
	if err != nil || !room.WallpaperFileID.Valid {
		t.Fatalf("room after upload: %+v err=%v", room, err)
	}
	wallID := files.FileID(room.WallpaperFileID.String)
	if sum.WallpaperURL != "fake://presign/"+string(wallID) {
		t.Fatalf("wallpaper url = %q", sum.WallpaperURL)
	}
	if sum.WallpaperPreset != "custom" {
		t.Fatalf("preset = %q, want custom", sum.WallpaperPreset)
	}
}
