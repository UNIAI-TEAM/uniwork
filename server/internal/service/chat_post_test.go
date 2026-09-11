package service

import (
	"context"
	"errors"
	"strings"
	"testing"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestPostEncodeDecodeMetadata(t *testing.T) {
	meta, err := encodePostMetadata("Thông báo nghỉ lễ", true)
	if err != nil || len(meta) == 0 {
		t.Fatalf("encode pinned: err=%v meta=%s", err, meta)
	}
	info := postFromMetadata(chatMessageKindPost, meta, "  Nội dung dài  ")
	if info == nil || info.Title != "Thông báo nghỉ lễ" || info.Body != "Nội dung dài" || !info.PinToTop {
		t.Fatalf("decode pinned: %+v", info)
	}

	plain, err := encodePostMetadata("Update", false)
	if err != nil {
		t.Fatalf("encode plain: %v", err)
	}
	info = postFromMetadata(chatMessageKindPost, plain, "Body")
	if info == nil || info.Title != "Update" || info.PinToTop {
		t.Fatalf("decode plain: %+v", info)
	}
}

func TestPostFromMetadataBranches(t *testing.T) {
	if postFromMetadata("note", nil, "x") != nil {
		t.Fatal("wrong kind should be nil")
	}
	if postFromMetadata(chatMessageKindPost, nil, "   ") != nil {
		t.Fatal("blank title+body should be nil")
	}
	if got := postFromMetadata(chatMessageKindPost, []byte(`{"post":{"title":"Hi"}}`), "Body"); got == nil || got.Title != "Hi" {
		t.Fatalf("title from metadata: %+v", got)
	}
}

func TestChatPostSendWorkspaceSuccessPinned(t *testing.T) {
	s, _, _, ua, _, w := noteFixture(t)
	ctx := context.Background()
	wsRoom, err := s.EnsureWorkspaceRoom(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatalf("ensure room: %v", err)
	}

	msg, err := s.SendPostMessage(ctx, ua.ID, w.ID, wsRoom.RoomID, SendPostMessageInput{
		Title:    "Release 1.4",
		Body:     "Deploy tối nay — checklist trong thread.",
		PinToTop: true,
	})
	if err != nil {
		t.Fatalf("send post: %v", err)
	}
	if msg.Kind != chatMessageKindPost || msg.Body != "Deploy tối nay — checklist trong thread." {
		t.Fatalf("message: kind=%s body=%q", msg.Kind, msg.Body)
	}
	if msg.Post == nil || msg.Post.Title != "Release 1.4" || !msg.Post.PinToTop {
		t.Fatalf("post info: %+v", msg.Post)
	}
	if !msg.Pinned {
		t.Fatal("expected pinned flag")
	}
}

func TestChatPostValidationErrors(t *testing.T) {
	s, _, _, ua, _, w := noteFixture(t)
	ctx := context.Background()
	wsRoom, err := s.EnsureWorkspaceRoom(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatalf("ensure room: %v", err)
	}

	if _, err := s.SendPostMessage(ctx, ua.ID, w.ID, wsRoom.RoomID, SendPostMessageInput{
		Title: "", Body: "x",
	}); err == nil {
		t.Fatal("empty title should fail")
	} else {
		requireNoteValidationError(t, err, "empty title")
	}
	if _, err := s.SendPostMessage(ctx, ua.ID, w.ID, wsRoom.RoomID, SendPostMessageInput{
		Title: "T", Body: "",
	}); err == nil {
		t.Fatal("empty body should fail")
	}
	if _, err := s.SendPostMessage(ctx, ua.ID, w.ID, wsRoom.RoomID, SendPostMessageInput{
		Title: strings.Repeat("t", maxPostTitleLen+1), Body: "ok",
	}); err == nil {
		t.Fatal("long title should fail")
	}
	if _, err := s.SendPostMessage(ctx, ua.ID, w.ID, wsRoom.RoomID, SendPostMessageInput{
		Title: "ok", Body: strings.Repeat("b", maxPostBodyLen+1),
	}); err == nil {
		t.Fatal("long body should fail")
	}
}

func TestChatPostCreateNotesForbidden(t *testing.T) {
	s, _, q, ua, ub, w := noteFixture(t)
	ctx := context.Background()
	groupID := noteGroup(t, s, ua, ub, w, q, "Post Gate", "post-gate@example.com")

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

	_, err = s.SendPostMessage(ctx, ub.ID, w.ID, groupID, SendPostMessageInput{
		Title: "Hi", Body: "Blocked",
	})
	if !errors.Is(err, ErrForbidden) {
		t.Fatalf("want ErrForbidden, got %v", err)
	}
}
