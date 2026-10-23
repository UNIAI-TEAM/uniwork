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

// A group's description follows the rename rule, is capped, clears with "",
// is audited, and comes back on the room list.
func TestGroupTopicFollowsTheRenameRule(t *testing.T) {
	f := groupAvatarFixture(t)
	ctx := context.Background()
	set := func(userID, topic string) error {
		_, err := f.s.UpdateChatRoomSettings(ctx, userID, f.w.ID, f.group.ID, UpdateChatRoomSettingsInput{Topic: &topic})
		return err
	}
	topicOf := func() string {
		room, err := f.q.GetChatRoomByID(ctx, f.group.ID)
		if err != nil {
			t.Fatal(err)
		}
		return room.Topic
	}

	if err := set(f.ub.ID, "  Nơi team trao đổi  "); err != nil {
		t.Fatalf("member sets the description with the flag on: %v", err)
	}
	if got := topicOf(); got != "Nơi team trao đổi" {
		t.Fatalf("topic=%q, want trimmed", got)
	}

	locked := defaultChatRoomMemberPermissions()
	locked.AllowChangeProfile = false
	if _, err := f.s.UpdateChatRoomSettings(ctx, f.ua.ID, f.w.ID, f.group.ID, UpdateChatRoomSettingsInput{MemberPermissions: &locked}); err != nil {
		t.Fatal(err)
	}
	if err := set(f.ub.ID, "hijack"); err != ErrForbidden {
		t.Fatalf("member with the flag off: err=%v, want ErrForbidden", err)
	}
	requireValidationError(t, set(f.ua.ID, strings.Repeat("ạ", chatChannelTopicMaxRunes+1)), "overlong topic")
	if got := topicOf(); got != "Nơi team trao đổi" {
		t.Fatalf("a refused request changed the topic to %q", got)
	}
	if err := set(f.ua.ID, strings.Repeat("ạ", chatChannelTopicMaxRunes)); err != nil {
		t.Fatalf("creator sets a topic at the limit: %v", err)
	}

	rooms, err := f.s.ListChatRooms(ctx, f.ua.ID, f.w.ID)
	if err != nil {
		t.Fatal(err)
	}
	listed := ""
	for _, r := range rooms {
		if r.ID == f.group.ID {
			listed = r.Topic
		}
	}
	if listed != strings.Repeat("ạ", chatChannelTopicMaxRunes) {
		t.Fatalf("room list topic=%q", listed)
	}

	if err := set(f.ua.ID, ""); err != nil || topicOf() != "" {
		t.Fatalf("clearing the topic: err=%v topic=%q", err, topicOf())
	}
	var n int
	if err := f.pool.QueryRow(ctx,
		`SELECT count(*) FROM audit_events WHERE action = 'chat.room.settings_updated' AND resource_id = $1 AND changes::jsonb ? 'topic'`, f.group.ID,
	).Scan(&n); err != nil || n != 3 {
		t.Fatalf("topic audit rows: err=%v count=%d, want 3", err, n)
	}
}
