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

func noteFixture(t *testing.T) (*ChatService, *capturePublisher, *db.Queries, db.User, db.User, db.Workspace) {
	t.Helper()
	s, pub, q, ua, ub, w := chatFixture(t)
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	return s, pub, q, ua, ub, w
}

func requireNoteValidationError(t *testing.T, err error, what string) {
	t.Helper()
	var ve ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("%s: expected ValidationError, got %v", what, err)
	}
}

// registerNotePeer registers a verified user with org/workspace membership.
func registerNotePeer(t *testing.T, pool *pgxpool.Pool, q *db.Queries, email, name, orgID, wsID string) db.User {
	t.Helper()
	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	u := registerVerified(t, q, as, email, name)
	addOrgMember(t, q, orgID, u.ID)
	addWorkspaceMember(t, q, wsID, u.ID)
	return u
}

// noteGroup creates a group with ua as creator and ub+peer as members.
func noteGroup(t *testing.T, s *ChatService, ua, ub db.User, w db.Workspace, q *db.Queries, name, peerEmail string) string {
	t.Helper()
	peer := registerNotePeer(t, s.pool, q, peerEmail, "Peer", w.OrganizationID, w.ID)
	group, err := s.CreateGroup(context.Background(), ua.ID, w.ID, CreateGroupInput{
		Name: name, MemberUserIDs: []string{ub.ID, peer.ID},
	})
	if err != nil {
		t.Fatalf("create group: %v", err)
	}
	return group.ID
}

func TestNoteEncodeDecodeMetadata(t *testing.T) {
	meta, err := encodeNoteMetadata(true)
	if err != nil || len(meta) == 0 {
		t.Fatalf("encode pinned: err=%v meta=%s", err, meta)
	}
	info := noteFromMetadata(chatMessageKindNote, meta, "  Ghi chú quan trọng  ")
	if info == nil || info.Body != "Ghi chú quan trọng" || !info.PinToTop {
		t.Fatalf("decode pinned: %+v", info)
	}

	plain, err := encodeNoteMetadata(false)
	if err != nil || len(plain) == 0 {
		t.Fatalf("encode plain: err=%v", err)
	}
	info = noteFromMetadata(chatMessageKindNote, plain, "Ghi chú thường")
	if info == nil || info.Body != "Ghi chú thường" || info.PinToTop {
		t.Fatalf("decode plain: %+v", info)
	}
}

func TestNoteFromMetadataBranches(t *testing.T) {
	if noteFromMetadata("reminder", nil, "x") != nil {
		t.Fatal("wrong kind should be nil")
	}
	if noteFromMetadata(chatMessageKindNote, nil, "   ") != nil {
		t.Fatal("blank body should be nil")
	}
	if noteFromMetadata(chatMessageKindNote, []byte(`{"pinned":true}`), "Pinned cũ") == nil {
		t.Fatal("legacy pinned flag should decode")
	} else if got := noteFromMetadata(chatMessageKindNote, []byte(`{"pinned":true}`), "Pinned cũ"); !got.PinToTop {
		t.Fatalf("legacy pinned: %+v", got)
	}
	if got := noteFromMetadata(chatMessageKindNote, []byte(`{"note":{"pin_to_top":true}}`), "Ghim"); got == nil || !got.PinToTop {
		t.Fatalf("note payload pin: %+v", got)
	}
	if got := noteFromMetadata(chatMessageKindNote, []byte(`not-json`), "Vẫn đọc"); got == nil || got.PinToTop {
		t.Fatalf("invalid json: %+v", got)
	}
}

func TestChatNoteSendWorkspaceSuccessPinned(t *testing.T) {
	s, pub, _, ua, _, w := noteFixture(t)
	ctx := context.Background()

	wsRoom, err := s.EnsureWorkspaceRoom(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatalf("ensure room: %v", err)
	}
	pub.events = nil
	msg, err := s.SendNoteMessage(ctx, ua.ID, w.ID, wsRoom.RoomID, SendNoteMessageInput{
		Body: "Nội quy nhóm", PinToTop: true,
	})
	if err != nil {
		t.Fatalf("send note: %v", err)
	}
	if msg.Body != "Nội quy nhóm" || msg.Kind != chatMessageKindNote {
		t.Fatalf("row: %+v", msg)
	}
	if msg.Note == nil || msg.Note.Body != "Nội quy nhóm" || !msg.Note.PinToTop {
		t.Fatalf("note info: %+v", msg.Note)
	}
	if countEvents(pub.events, "chat.message.created") != 1 {
		t.Fatalf("publish: %+v", pub.events)
	}
}

func TestChatNoteSendGroupSuccess(t *testing.T) {
	s, pub, q, ua, ub, w := noteFixture(t)
	ctx := context.Background()

	groupID := noteGroup(t, s, ua, ub, w, q, "Nhóm ghi chú", "note-peer@example.com")
	pub.events = nil
	msg, err := s.SendNoteMessage(ctx, ub.ID, w.ID, groupID, SendNoteMessageInput{
		Body: "Todo tuần này",
	})
	if err != nil {
		t.Fatalf("member send note: %v", err)
	}
	if msg.Body != "Todo tuần này" {
		t.Fatalf("row: %+v", msg)
	}
	if msg.Note == nil || msg.Note.PinToTop {
		t.Fatalf("note info: %+v", msg.Note)
	}
	if countEvents(pub.events, "chat.message.created") != 1 {
		t.Fatalf("publish: %+v", pub.events)
	}
}

func TestChatNoteValidationErrors(t *testing.T) {
	s, _, _, ua, _, w := noteFixture(t)
	ctx := context.Background()

	wsRoom, err := s.EnsureWorkspaceRoom(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatalf("ensure room: %v", err)
	}

	if _, err := s.SendNoteMessage(ctx, ua.ID, w.ID, wsRoom.RoomID, SendNoteMessageInput{
		Body: "   ",
	}); err == nil {
		t.Fatal("blank body should fail")
	} else {
		requireNoteValidationError(t, err, "blank body")
	}

	if _, err := s.SendNoteMessage(ctx, ua.ID, w.ID, wsRoom.RoomID, SendNoteMessageInput{
		Body: strings.Repeat("a", maxNoteBodyLen+1),
	}); err == nil {
		t.Fatal("long body should fail")
	} else {
		requireNoteValidationError(t, err, "long body")
	}
}

func TestChatNoteNotFoundAndForbidden(t *testing.T) {
	s, _, q, ua, ub, w := noteFixture(t)
	ctx := context.Background()

	if _, err := s.SendNoteMessage(ctx, ua.ID, w.ID, "00000000-0000-0000-0000-000000000000", SendNoteMessageInput{
		Body: "Ghi chú",
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing room: %v", err)
	}

	groupID := noteGroup(t, s, ua, ub, w, q, "Kín", "note-peer@example.com")
	outsider := registerNotePeer(t, s.pool, q, "note-stranger@example.com", "Stranger", w.OrganizationID, w.ID)
	if _, err := s.SendNoteMessage(ctx, outsider.ID, w.ID, groupID, SendNoteMessageInput{
		Body: "Ghi chú",
	}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("non-room-member: %v", err)
	}
}

func TestChatNoteNonWorkspaceMemberForbidden(t *testing.T) {
	s, _, q, ua, _, w := chatFixture(t)
	ctx := context.Background()

	wsRoom, err := s.EnsureWorkspaceRoom(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatalf("ensure room: %v", err)
	}
	as := NewAuthService(s.pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	outsider := registerVerified(t, q, as, "note-outsider@example.com", "Outsider")
	if _, err := s.SendNoteMessage(ctx, outsider.ID, w.ID, wsRoom.RoomID, SendNoteMessageInput{
		Body: "Ghi chú",
	}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("outsider: %v", err)
	}
}

func TestChatNoteCreateNotesForbidden(t *testing.T) {
	s, _, q, ua, ub, w := noteFixture(t)
	ctx := context.Background()

	groupID := noteGroup(t, s, ua, ub, w, q, "Hạn chế ghi chú", "note-peer@example.com")
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
	if _, err := s.SendNoteMessage(ctx, ub.ID, w.ID, groupID, SendNoteMessageInput{
		Body: "Ghi chú",
	}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("notes forbidden: %v", err)
	}
}

func TestChatNotePinContentForbidden(t *testing.T) {
	s, _, q, ua, ub, w := noteFixture(t)
	ctx := context.Background()

	groupID := noteGroup(t, s, ua, ub, w, q, "Hạn chế ghim", "note-peer@example.com")
	perms := defaultChatRoomMemberPermissions()
	perms.AllowPinContent = false
	enc, err := encodeMemberPermissions(perms)
	if err != nil {
		t.Fatal(err)
	}
	if err := q.UpdateChatRoomMemberPermissions(ctx, db.UpdateChatRoomMemberPermissionsParams{
		ID: groupID, MemberPermissions: enc,
	}); err != nil {
		t.Fatalf("restrict perms: %v", err)
	}
	if _, err := s.SendNoteMessage(ctx, ub.ID, w.ID, groupID, SendNoteMessageInput{
		Body: "Ghi chú ghim", PinToTop: true,
	}); !errors.Is(err, ErrForbidden) {
		t.Fatalf("pin forbidden: %v", err)
	}
	if _, err := s.SendNoteMessage(ctx, ub.ID, w.ID, groupID, SendNoteMessageInput{
		Body: "Ghi chú thường",
	}); err != nil {
		t.Fatalf("plain note should still pass: %v", err)
	}
}

func TestChatNoteSendRestricted(t *testing.T) {
	s, _, q, ua, ub, w := noteFixture(t)
	ctx := context.Background()

	groupID := noteGroup(t, s, ua, ub, w, q, "Mute ghi chú", "note-peer@example.com")
	if err := q.UpdateChatRoomMemberSendRestricted(ctx, db.UpdateChatRoomMemberSendRestrictedParams{
		RoomID: groupID, UserID: ub.ID, SendRestricted: true,
	}); err != nil {
		t.Fatalf("mute: %v", err)
	}
	_, err := s.SendNoteMessage(ctx, ub.ID, w.ID, groupID, SendNoteMessageInput{
		Body: "Ghi chú",
	})
	requireNoteValidationError(t, err, "muted member")
}
