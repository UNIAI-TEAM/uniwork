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
