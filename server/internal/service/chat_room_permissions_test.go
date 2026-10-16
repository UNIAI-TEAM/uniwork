package service

import (
	"context"
	"strings"
	"testing"
)

func TestMemberPermissionsFromRawDefaults(t *testing.T) {
	perms := memberPermissionsFromRaw(nil)
	if !perms.AllowSendMessages || !perms.AllowPinContent {
		t.Fatalf("expected defaults: %+v", perms)
	}
}

func TestMemberPermissionsFromRawPartialJSON(t *testing.T) {
	raw := []byte(`{"allow_send_messages":false}`)
	perms := memberPermissionsFromRaw(raw)
	if perms.AllowSendMessages {
		t.Fatalf("expected send disabled: %+v", perms)
	}
}

func TestChatRoomRenameRejectsOverlongName(t *testing.T) {
	s, _, _, ua, _, w := chatFixture(t)
	ctx := context.Background()
	roomID := mustPollRoom(t, s, ctx, ua.ID, w.ID)

	tooLong := strings.Repeat("ạ", chatRoomNameMaxRunes+1)
	_, err := s.UpdateChatRoomSettings(ctx, ua.ID, w.ID, roomID, UpdateChatRoomSettingsInput{Name: &tooLong})
	requireValidationError(t, err, "overlong room name")

	atLimit := strings.Repeat("ạ", chatRoomNameMaxRunes)
	if _, err := s.UpdateChatRoomSettings(ctx, ua.ID, w.ID, roomID, UpdateChatRoomSettingsInput{Name: &atLimit}); err != nil {
		t.Fatalf("name at the limit: %v", err)
	}
}

func TestChannelRenameThroughRoomSettingsNeedsAModerator(t *testing.T) {
	s, _, q, ua, ub, w, pool := chatFixtureWithPool(t)
	ctx := context.Background()
	addWorkspaceMember(t, q, w.ID, ub.ID)
	roomID := mustPollRoom(t, s, ctx, ua.ID, w.ID)
	before, err := q.GetChatRoomByID(ctx, roomID)
	if err != nil {
		t.Fatal(err)
	}

	hijack := "abc"
	if _, err := s.UpdateChatRoomSettings(ctx, ub.ID, w.ID, roomID, UpdateChatRoomSettingsInput{Name: &hijack}); err != ErrForbidden {
		t.Fatalf("regular member renaming the default channel: err=%v, want ErrForbidden", err)
	}
	if after, _ := q.GetChatRoomByID(ctx, roomID); after.Name != before.Name {
		t.Fatalf("name changed to %q by a refused rename", after.Name)
	}

	renamed := "Kênh chung mới"
	if _, err := s.UpdateChatRoomSettings(ctx, ua.ID, w.ID, roomID, UpdateChatRoomSettingsInput{Name: &renamed}); err != nil {
		t.Fatalf("moderator rename: %v", err)
	}
	var n int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM audit_events WHERE action = 'chat.room.settings_updated' AND resource_id = $1`, roomID,
	).Scan(&n); err != nil || n != 1 {
		t.Fatalf("settings audit rows: err=%v count=%d", err, n)
	}
}

func TestRoomSettingsRejectsABadNameBeforeWriting(t *testing.T) {
	s, _, _, ua, _, w := chatFixture(t)
	ctx := context.Background()
	roomID := mustPollRoom(t, s, ctx, ua.ID, w.ID)

	locked := defaultChatRoomMemberPermissions()
	locked.AllowSendMessages = false
	empty := ""
	_, err := s.UpdateChatRoomSettings(ctx, ua.ID, w.ID, roomID, UpdateChatRoomSettingsInput{
		Name: &empty, MemberPermissions: &locked,
	})
	requireValidationError(t, err, "empty room name")

	perms, err := s.GetRoomMemberPermissions(ctx, ua.ID, w.ID, roomID)
	if err != nil {
		t.Fatal(err)
	}
	if !perms.AllowSendMessages {
		t.Fatalf("permissions written by a request that failed validation: %+v", perms)
	}
}
