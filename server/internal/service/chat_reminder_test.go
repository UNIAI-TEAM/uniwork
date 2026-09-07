package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/auth"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func reminderFixture(t *testing.T) (*ChatService, *capturePublisher, *db.Queries, db.User, db.User, db.Workspace) {
	t.Helper()
	s, pub, q, ua, ub, w := chatFixture(t)
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	return s, pub, q, ua, ub, w
}

func futureRemindAt() string {
	return time.Now().Add(2 * time.Hour).Format(time.RFC3339)
}

// registerReminderPeer registers a verified user with org/workspace membership.
func registerReminderPeer(t *testing.T, pool *pgxpool.Pool, q *db.Queries, email, name, orgID, wsID string) db.User {
	t.Helper()
	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	u := registerVerified(t, q, as, email, name)
	addOrgMember(t, q, orgID, u.ID)
	addWorkspaceMember(t, q, wsID, u.ID)
	return u
}

// reminderGroup creates a group with ua as creator and ub+peer as members.
func reminderGroup(t *testing.T, s *ChatService, ua, ub db.User, w db.Workspace, q *db.Queries, name, peerEmail string) string {
	t.Helper()
	peer := registerReminderPeer(t, s.pool, q, peerEmail, "Peer", w.OrganizationID, w.ID)
	group, err := s.CreateGroup(context.Background(), ua.ID, w.ID, CreateGroupInput{
		Name: name, MemberUserIDs: []string{ub.ID, peer.ID},
	})
	if err != nil {
		t.Fatalf("create group: %v", err)
	}
	return group.ID
}

func requireReminderValidationError(t *testing.T, err error, what string) {
	t.Helper()
	var ve ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("%s: expected ValidationError, got %v", what, err)
	}
}

func TestReminderNormalizeRepeat(t *testing.T) {
	cases := map[string]string{
		"":         "none",
		"   ":      "none",
		"none":     "none",
		"daily":    "daily",
		"DAILY":    "daily",
		"  Daily ": "daily",
		"Weekly":   "weekly",
		"MONTHLY":  "monthly",
		"yearly":   "none",
		"hourly":   "none",
	}
	for in, want := range cases {
		if got := normalizeReminderRepeat(in); got != want {
			t.Fatalf("normalize %q: got %q want %q", in, got, want)
		}
	}
}

func TestReminderEncodeDecodeMetadata(t *testing.T) {
	meta, err := encodeReminderMetadata(ChatReminderPayload{
		Body: "Họp nhóm", RemindAt: futureRemindAt(), Repeat: "daily",
	})
	if err != nil || len(meta) == 0 {
		t.Fatalf("encode: err=%v meta=%s", err, meta)
	}
	info := reminderFromMetadata(chatMessageKindReminder, meta)
	if info == nil || info.Body != "Họp nhóm" || info.Repeat != "daily" || info.RemindAt == "" {
		t.Fatalf("decode: %+v", info)
	}
}

func TestReminderFromMetadataBranches(t *testing.T) {
	if reminderFromMetadata("note", []byte(`{"reminder":{"body":"x"}}`)) != nil {
		t.Fatal("wrong kind should be nil")
	}
	if reminderFromMetadata(chatMessageKindReminder, nil) != nil {
		t.Fatal("empty raw should be nil")
	}
	if reminderFromMetadata(chatMessageKindReminder, []byte(`{}`)) != nil {
		t.Fatal("missing reminder should be nil")
	}
	if reminderFromMetadata(chatMessageKindReminder, []byte(`{"reminder":{"body":"   "}}`)) != nil {
		t.Fatal("blank body should be nil")
	}
	if reminderFromMetadata(chatMessageKindReminder, []byte(`not-json`)) != nil {
		t.Fatal("invalid json should be nil")
	}
}

func TestChatReminderSendWorkspaceSuccess(t *testing.T) {
	s, pub, _, ua, _, w := reminderFixture(t)
	ctx := context.Background()

	wsRoom, err := s.EnsureWorkspaceRoom(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatalf("ensure room: %v", err)
	}
	pub.events = nil
	msg, err := s.SendReminderMessage(ctx, ua.ID, w.ID, wsRoom.RoomID, SendReminderMessageInput{
		Body: "Nhắc họp daily", RemindAt: futureRemindAt(), Repeat: "daily",
	})
	if err != nil {
		t.Fatalf("send reminder: %v", err)
	}
	if msg.Body != "Nhắc họp daily" || msg.Kind != chatMessageKindReminder {
		t.Fatalf("row: %+v", msg)
	}
	if msg.Reminder == nil || msg.Reminder.Repeat != "daily" || msg.Reminder.Body != "Nhắc họp daily" {
		t.Fatalf("reminder info: %+v", msg.Reminder)
	}
	if countEvents(pub.events, "chat.message.created") != 1 {
		t.Fatalf("publish: %+v", pub.events)
	}
}

func TestChatReminderSendGroupSuccessRepeatNormalized(t *testing.T) {
	s, pub, q, ua, ub, w := reminderFixture(t)
	ctx := context.Background()

	groupID := reminderGroup(t, s, ua, ub, w, q, "Nhóm nhắc hẹn", "reminder-peer@example.com")
	pub.events = nil
	msg, err := s.SendReminderMessage(ctx, ub.ID, w.ID, groupID, SendReminderMessageInput{
		Body: "Deadline báo cáo", RemindAt: futureRemindAt(), Repeat: "yearly",
	})
	if err != nil {
		t.Fatalf("member send reminder: %v", err)
	}
	if msg.Body != "Deadline báo cáo" {
		t.Fatalf("row: %+v", msg)
	}
	if msg.Reminder == nil || msg.Reminder.Repeat != "none" {
		t.Fatalf("repeat should normalize to none: %+v", msg.Reminder)
	}
	if countEvents(pub.events, "chat.message.created") != 1 {
		t.Fatalf("publish: %+v", pub.events)
	}
}

func TestChatReminderValidationErrors(t *testing.T) {
	s, _, _, ua, _, w := reminderFixture(t)
	ctx := context.Background()

	wsRoom, err := s.EnsureWorkspaceRoom(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatalf("ensure room: %v", err)
	}

	if _, err := s.SendReminderMessage(ctx, ua.ID, w.ID, wsRoom.RoomID, SendReminderMessageInput{
		Body: "   ", RemindAt: futureRemindAt(),
	}); err == nil {
		t.Fatal("blank body should fail")
	} else {
		requireReminderValidationError(t, err, "blank body")
	}

	if _, err := s.SendReminderMessage(ctx, ua.ID, w.ID, wsRoom.RoomID, SendReminderMessageInput{
		Body: strings.Repeat("a", maxReminderBodyLen+1), RemindAt: futureRemindAt(),
	}); err == nil {
		t.Fatal("long body should fail")
	} else {
		requireReminderValidationError(t, err, "long body")
	}

	if _, err := s.SendReminderMessage(ctx, ua.ID, w.ID, wsRoom.RoomID, SendReminderMessageInput{
		Body: "Nhắc việc",
	}); err == nil {
		t.Fatal("missing remind_at should fail")
	} else {
		requireReminderValidationError(t, err, "missing remind_at")
	}

	if _, err := s.SendReminderMessage(ctx, ua.ID, w.ID, wsRoom.RoomID, SendReminderMessageInput{
		Body: "Nhắc việc", RemindAt: "ngày mai",
	}); err == nil {
		t.Fatal("bad remind_at should fail")
	} else {
		requireReminderValidationError(t, err, "bad remind_at")
	}

	if _, err := s.SendReminderMessage(ctx, ua.ID, w.ID, wsRoom.RoomID, SendReminderMessageInput{
		Body: "Nhắc việc", RemindAt: time.Now().Add(-time.Hour).Format(time.RFC3339),
	}); err == nil {
		t.Fatal("past remind_at should fail")
	} else {
		requireReminderValidationError(t, err, "past remind_at")
	}
}

func TestChatReminderNotFoundAndForbidden(t *testing.T) {
	s, _, q, ua, ub, w := reminderFixture(t)
	ctx := context.Background()

	if _, err := s.SendReminderMessage(ctx, ua.ID, w.ID, "00000000-0000-0000-0000-000000000000", SendReminderMessageInput{
		Body: "Nhắc việc", RemindAt: futureRemindAt(),
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing room: %v", err)
	}

	groupID := reminderGroup(t, s, ua, ub, w, q, "Kín", "reminder-peer@example.com")
	outsider := registerReminderPeer(t, s.pool, q, "reminder-stranger@example.com", "Stranger", w.OrganizationID, w.ID)
	if _, err := s.SendReminderMessage(ctx, outsider.ID, w.ID, groupID, SendReminderMessageInput{
		Body: "Nhắc việc", RemindAt: futureRemindAt(),
	}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("non-room-member: %v", err)
	}
}

func TestChatReminderNonWorkspaceMemberForbidden(t *testing.T) {
	s, _, q, ua, _, w := chatFixture(t)
	ctx := context.Background()

	wsRoom, err := s.EnsureWorkspaceRoom(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatalf("ensure room: %v", err)
	}
	as := NewAuthService(s.pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	outsider := registerVerified(t, q, as, "reminder-outsider@example.com", "Outsider")
	if _, err := s.SendReminderMessage(ctx, outsider.ID, w.ID, wsRoom.RoomID, SendReminderMessageInput{
		Body: "Nhắc việc", RemindAt: futureRemindAt(),
	}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("outsider: %v", err)
	}
}

func TestChatReminderCreateNotesForbidden(t *testing.T) {
	s, _, q, ua, ub, w := reminderFixture(t)
	ctx := context.Background()

	groupID := reminderGroup(t, s, ua, ub, w, q, "Hạn chế ghi chú", "reminder-peer@example.com")
	perms := defaultChatRoomMemberPermissions()
	perms.AllowCreateNotes = false
	enc, err := encodeMemberPermissions(perms)
	if err != nil {
		t.Fatal(err)
	}
	if err := q.UpdateChatRoomMemberPermissions(ctx, db.UpdateChatRoomMemberPermissionsParams{
		ID: groupID, MemberPermissions: enc,
	}); err != nil {
		t.Fatalf("restrict perms: %v", err)
	}
	if _, err := s.SendReminderMessage(ctx, ub.ID, w.ID, groupID, SendReminderMessageInput{
		Body: "Nhắc việc", RemindAt: futureRemindAt(),
	}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("notes forbidden: %v", err)
	}
}

func TestChatReminderSendRestricted(t *testing.T) {
	s, _, q, ua, ub, w := reminderFixture(t)
	ctx := context.Background()

	groupID := reminderGroup(t, s, ua, ub, w, q, "Mute nhắc hẹn", "reminder-peer@example.com")
	if err := q.UpdateChatRoomMemberSendRestricted(ctx, db.UpdateChatRoomMemberSendRestrictedParams{
		RoomID: groupID, UserID: ub.ID, SendRestricted: true,
	}); err != nil {
		t.Fatalf("mute: %v", err)
	}
	_, err := s.SendReminderMessage(ctx, ub.ID, w.ID, groupID, SendReminderMessageInput{
		Body: "Nhắc việc", RemindAt: futureRemindAt(),
	})
	requireReminderValidationError(t, err, "muted member")
}
