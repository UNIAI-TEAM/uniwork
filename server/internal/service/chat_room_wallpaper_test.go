package service

import (
	"bytes"
	"context"
	"errors"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/files"
)

// Both people in a DM may change its wallpaper. ResolveDM only pairs people
// of the same organization, so the fixture puts ub in it first.
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
	room, err := q.GetChatRoomByID(ctx, dm.ID)
	if err != nil || room.WallpaperPreset != "mint" {
		t.Fatalf("dm wallpaper = %q err=%v, want mint", room.WallpaperPreset, err)
	}
}

// In a group only the moderators change the wallpaper; a group needs two
// people besides its creator, so the fixture is a group of three.
func TestUpdateChatRoomWallpaperPreset_GroupMemberForbidden(t *testing.T) {
	f := groupAvatarFixture(t)
	ctx := context.Background()
	if err := f.s.UpdateChatRoomWallpaperPreset(ctx, f.ub.ID, f.w.ID, f.group.ID, "sky"); !errors.Is(err, ErrForbidden) {
		t.Fatalf("regular member should be forbidden, got %v", err)
	}
	if err := f.s.UpdateChatRoomWallpaperPreset(ctx, f.ua.ID, f.w.ID, f.group.ID, "sky"); err != nil {
		t.Fatalf("group creator: %v", err)
	}
}

// ChatRoomWallpaperProvider holds the image a room shows and lets go of it
// once the room shows another image or a preset, so the collector reclaims
// the replaced file and never the current one.
func TestChatRoomWallpaperProviderHoldsOnlyTheCurrentImage(t *testing.T) {
	f := groupAvatarFixture(t)
	ctx := context.Background()

	first, err := f.s.UploadRoomWallpaper(ctx, f.ua.ID, f.w.ID, f.group.ID, "nen.png", bytes.NewReader(workspaceIconPNG))
	if err != nil {
		t.Fatal(err)
	}
	room, err := f.q.GetChatRoomByID(ctx, f.group.ID)
	if err != nil || !room.WallpaperFileID.Valid || room.WallpaperPreset != chatWallpaperPresetCustom {
		t.Fatalf("room after upload: preset=%q file=%v err=%v", room.WallpaperPreset, room.WallpaperFileID, err)
	}
	firstID := files.FileID(room.WallpaperFileID.String)
	if first.WallpaperURL != "fake://presign/"+string(firstID) {
		t.Fatalf("wallpaper url = %q", first.WallpaperURL)
	}

	if _, err := f.s.UploadRoomWallpaper(ctx, f.ua.ID, f.w.ID, f.group.ID, "nen2.png", bytes.NewReader(workspaceIconPNG)); err != nil {
		t.Fatal(err)
	}
	room, _ = f.q.GetChatRoomByID(ctx, f.group.ID)
	secondID := files.FileID(room.WallpaperFileID.String)
	held, err := ChatRoomWallpaperProvider{}.HeldBy(ctx, f.q, []files.FileID{firstID, secondID})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := held[firstID]; ok || held[secondID] != files.HoldActive || len(held) != 1 {
		t.Fatalf("held = %v, want only the current wallpaper %s", held, secondID)
	}

	if err := f.s.UpdateChatRoomWallpaperPreset(ctx, f.ua.ID, f.w.ID, f.group.ID, "sky"); err != nil {
		t.Fatal(err)
	}
	if held, _ := (ChatRoomWallpaperProvider{}).HeldBy(ctx, f.q, []files.FileID{secondID}); len(held) != 0 {
		t.Fatalf("wallpaper replaced by a preset still held: %v", held)
	}
}
