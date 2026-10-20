package service

import (
	"bytes"
	"context"
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	"github.com/unicomhub/uniwork/server/internal/linkpreview"
)

func TestForwardChatMessageToTwoRooms(t *testing.T) {
	s, _, ua, ub, uc, w, group := groupTrioFixture(t)
	ctx := context.Background()
	src, err := s.SendRoomMessage(ctx, ub.ID, w.ID, group.ID, SendChatMessageInput{Body: "Báo giá mới nhé"})
	if err != nil {
		t.Fatal(err)
	}
	dmB, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatal(err)
	}
	dmC, err := s.ResolveDM(ctx, ua.ID, w.ID, uc.ID)
	if err != nil {
		t.Fatal(err)
	}
	out, err := s.ForwardChatMessage(ctx, ua.ID, w.ID, src.ID, ForwardChatMessageInput{
		TargetRoomIDs: []string{dmB.ID, dmC.ID, dmB.ID}, Comment: "Xem giúp",
	})
	if err != nil {
		t.Fatalf("forward: %v", err)
	}
	if len(out) != 2 {
		t.Fatalf("forwarded into %d rooms, want 2 (the repeated id counts once)", len(out))
	}
	msgs, err := s.ListRoomMessages(ctx, uc.ID, w.ID, dmC.ID, ListChatMessagesInput{})
	if err != nil {
		t.Fatal(err)
	}
	if len(msgs) != 2 || msgs[0].Body != "Xem giúp" || msgs[1].ID != out[1].MessageID {
		t.Fatalf("target timeline = %+v, want the comment then the copy", msgs)
	}
	copied := msgs[1]
	if copied.SenderID != ua.ID || copied.Body != src.Body || copied.ForwardedFrom == nil {
		t.Fatalf("copy = %+v", copied)
	}
	if f := copied.ForwardedFrom; f.SenderID != ub.ID || f.SenderName != "B" || !f.SentAt.Equal(src.CreatedAt) {
		t.Fatalf("forwarded_from = %+v, want B at %s", f, src.CreatedAt)
	}

	// Forwarding the copy again still names the first author.
	again, err := s.ForwardChatMessage(ctx, uc.ID, w.ID, copied.ID, ForwardChatMessageInput{TargetRoomIDs: []string{group.ID}})
	if err != nil {
		t.Fatal(err)
	}
	row, err := s.GetRoomMessage(ctx, ua.ID, w.ID, group.ID, again[0].MessageID)
	if err != nil || row.ForwardedFrom == nil || row.ForwardedFrom.SenderID != ub.ID {
		t.Fatalf("second hop = %+v, %v", row.ForwardedFrom, err)
	}

	var audits int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE organization_id = $1 AND action = 'chat.message.forwarded'`,
		w.OrganizationID).Scan(&audits); err != nil {
		t.Fatal(err)
	}
	if audits != 3 {
		t.Fatalf("audit rows = %d, want one per target room (3)", audits)
	}
}

func TestForwardChatMessageHonoursAllowForward(t *testing.T) {
	s, _, ua, ub, _, w, group := groupTrioFixture(t)
	ctx := context.Background()
	src, err := s.SendRoomMessage(ctx, ua.ID, w.ID, group.ID, SendChatMessageInput{Body: "nội bộ"})
	if err != nil {
		t.Fatal(err)
	}
	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatal(err)
	}
	perms := defaultChatRoomMemberPermissions()
	perms.AllowForward = false
	if _, err := s.UpdateChatRoomSettings(ctx, ua.ID, w.ID, group.ID, UpdateChatRoomSettingsInput{MemberPermissions: &perms}); err != nil {
		t.Fatal(err)
	}
	in := ForwardChatMessageInput{TargetRoomIDs: []string{dm.ID}}
	if _, err := s.ForwardChatMessage(ctx, ub.ID, w.ID, src.ID, in); !codedIs(err, "chat_forward_disabled") {
		t.Fatalf("member forward with allow_forward off = %v, want chat_forward_disabled", err)
	}
	// The group's creator moderates it and still may.
	if _, err := s.ForwardChatMessage(ctx, ua.ID, w.ID, src.ID, in); err != nil {
		t.Fatalf("moderator forward: %v", err)
	}
}

func TestForwardChatMessageRefusesATargetAndWritesNothing(t *testing.T) {
	s, q, ua, ub, uc, w, group := groupTrioFixture(t)
	ctx := context.Background()
	src, err := s.SendRoomMessage(ctx, ua.ID, w.ID, group.ID, SendChatMessageInput{Body: "chuyển đi"})
	if err != nil {
		t.Fatal(err)
	}
	dmC, err := s.ResolveDM(ctx, ub.ID, w.ID, uc.ID)
	if err != nil {
		t.Fatal(err)
	}
	dmA, err := s.ResolveDM(ctx, ub.ID, w.ID, ua.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.BlockChatUser(ctx, ua.ID, w.ID, ub.ID); err != nil {
		t.Fatal(err)
	}
	_, err = s.ForwardChatMessage(ctx, ub.ID, w.ID, src.ID, ForwardChatMessageInput{TargetRoomIDs: []string{dmC.ID, dmA.ID}})
	var ce CodedError
	if !errors.As(err, &ce) || ce.Code != "chat_forward_target_refused" || ce.Fields["room_id"] != dmA.ID {
		t.Fatalf("forward into a blocked DM = %v, want chat_forward_target_refused naming it", err)
	}
	if msgs, err := s.ListRoomMessages(ctx, uc.ID, w.ID, dmC.ID, ListChatMessagesInput{}); err != nil || len(msgs) != 0 {
		t.Fatalf("the allowed room got %d messages (%v); a refused target must stop every copy", len(msgs), err)
	}

	// A room the caller is not in is not found, and its id is not echoed.
	as := NewAuthService(s.pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	ud := registerVerified(t, q, as, "chat-d@example.com", "D")
	addOrgMember(t, q, w.OrganizationID, ud.ID)
	addWorkspaceMember(t, q, w.ID, ud.ID)
	dmAD, err := s.ResolveDM(ctx, ua.ID, w.ID, ud.ID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.ForwardChatMessage(ctx, ub.ID, w.ID, src.ID, ForwardChatMessageInput{TargetRoomIDs: []string{dmAD.ID}})
	if !errors.Is(err, ErrForbidden) && !errors.Is(err, ErrNotFound) {
		t.Fatalf("forward into someone else's DM = %v, want a plain refusal", err)
	}
	if errors.As(err, &ce) && ce.Code == "chat_forward_target_refused" {
		t.Fatal("a room the caller cannot open must not be named back")
	}
}

func TestForwardChatMessageRefusesRoomBoundKinds(t *testing.T) {
	s, _, ua, ub, _, w, group := groupTrioFixture(t)
	ctx := context.Background()
	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatal(err)
	}
	poll, err := s.SendPollMessage(ctx, ua.ID, w.ID, group.ID, SendPollMessageInput{Question: "Ăn gì?", Options: []string{"Cơm", "Phở"}})
	if err != nil {
		t.Fatal(err)
	}
	note, err := s.SendNoteMessage(ctx, ua.ID, w.ID, group.ID, SendNoteMessageInput{Body: "ghi chú"})
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{poll.ID, note.ID} {
		if _, err := s.ForwardChatMessage(ctx, ua.ID, w.ID, id, ForwardChatMessageInput{TargetRoomIDs: []string{dm.ID}}); !codedIs(err, "chat_forward_kind") {
			t.Fatalf("forward %s = %v, want chat_forward_kind", id, err)
		}
	}
	if _, err := s.ForwardChatMessage(ctx, ua.ID, w.ID, poll.ID, ForwardChatMessageInput{}); err == nil {
		t.Fatal("a forward with no target must be refused")
	}
}

// A file forwarded into a room of the same file scope shares the source file;
// into a room anchored in another workspace it gets its own copy, so the
// target's members read it through their own room and the source stays put.
func TestForwardChatFileIsReadableInTheTarget(t *testing.T) {
	s, _, q, ua, ub, w := chatFixtureFiles(t)
	ctx := context.Background()
	as := NewAuthService(s.pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	uc := registerVerified(t, q, as, "chat-c@example.com", "C")
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	addOrgMember(t, q, w.OrganizationID, uc.ID)
	w2, err := s.ws.CreateInOrg(ctx, ua.ID, w.OrganizationID, "Chat WS 2", "chat-ws-2")
	if err != nil {
		t.Fatal(err)
	}
	addWorkspaceMember(t, q, w2.Workspace.ID, uc.ID)

	room, err := s.EnsureWorkspaceRoom(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	src, err := s.SendFileMessage(ctx, ua.ID, w.ID, room.RoomID, SendFileMessageInput{
		Filename: "bao-gia.pdf", Body: bytes.NewReader(tinyFSFileBytes), ClientMsgID: "fwd-file-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	sameScope, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatal(err)
	}
	otherScope, err := s.ResolveDM(ctx, ua.ID, w2.Workspace.ID, uc.ID)
	if err != nil {
		t.Fatal(err)
	}
	out, err := s.ForwardChatMessage(ctx, ua.ID, w.ID, src.ID, ForwardChatMessageInput{TargetRoomIDs: []string{sameScope.ID, otherScope.ID}})
	if err != nil {
		t.Fatalf("forward file: %v", err)
	}
	read := func(userID, wsID, roomID, msgID string) ChatMessageRow {
		t.Helper()
		row, rd, err := s.OpenChatFileMessage(ctx, userID, wsID, roomID, msgID, false)
		if err != nil {
			t.Fatalf("open copy in %s: %v", roomID, err)
		}
		defer func() { _ = rd.Close() }()
		got, err := io.ReadAll(rd.Body)
		if err != nil || !bytes.Equal(got, tinyFSFileBytes) {
			t.Fatalf("copy bytes in %s = %q, %v", roomID, got, err)
		}
		return row
	}
	shared := read(ub.ID, w.ID, sameScope.ID, out[0].MessageID)
	if shared.File.FileID != src.File.FileID || shared.File.Filename != "bao-gia.pdf" || shared.ForwardedFrom == nil {
		t.Fatalf("same-scope copy = %+v, want the source file and forwarded_from", shared.File)
	}
	copied := read(uc.ID, w2.Workspace.ID, otherScope.ID, out[1].MessageID)
	if copied.File.FileID == src.File.FileID {
		t.Fatal("a copy in another workspace's scope must reference its own file")
	}
	// The source room still reads its own file.
	read(ua.ID, w.ID, room.RoomID, src.ID)

	stored, err := q.GetChatMessageByID(ctx, out[1].MessageID)
	if err != nil || !stored.FileID.Valid || stored.FileID.String != copied.File.FileID {
		t.Fatalf("copy row file_id = %+v, %v", stored.FileID, err)
	}
}

// A forwarded link shows the source's card at once; a link the source has no
// card for yet is requested for the copy, as a send would.
func TestForwardChatMessageCarriesTheLinkPreview(t *testing.T) {
	s, _, q, ua, ub, w, pool := chatFixtureWithPool(t)
	s.SetFiles(filesfake.New(filesfake.Options{}))
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	room, err := s.EnsureWorkspaceRoom(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatal(err)
	}
	src, err := s.SendRoomMessage(ctx, ua.ID, w.ID, room.RoomID, SendChatMessageInput{Body: "Bài blog: https://uniwork.vn/blog/q4"})
	if err != nil {
		t.Fatal(err)
	}
	c := NewChatLinkPreviewConsumer(s, &stubPreviewFetcher{preview: linkpreview.Preview{Title: "UniWork Q4", SiteName: "uniwork.vn"}})
	for _, r := range linkPreviewRequests(t, pool) {
		if err := c.Handle(ctx, r); err != nil {
			t.Fatal(err)
		}
	}
	out, err := s.ForwardChatMessage(ctx, ua.ID, w.ID, src.ID, ForwardChatMessageInput{TargetRoomIDs: []string{dm.ID}})
	if err != nil {
		t.Fatal(err)
	}
	previews, err := s.ListRoomLinkPreviews(ctx, ub.ID, w.ID, dm.ID, []string{out[0].MessageID})
	if err != nil || len(previews) != 1 || previews[0].Title != "UniWork Q4" {
		t.Fatalf("copy's preview = %+v, %v; want the source's card", previews, err)
	}
	if n := len(linkPreviewRequests(t, pool)); n != 1 {
		t.Fatalf("link preview requests = %d, want only the source's (the copy reuses its card)", n)
	}

	// A source whose card is not made yet: the copy asks for its own.
	fresh, err := s.SendRoomMessage(ctx, ua.ID, w.ID, room.RoomID, SendChatMessageInput{Body: "xem https://uniwork.vn/moi"})
	if err != nil {
		t.Fatal(err)
	}
	again, err := s.ForwardChatMessage(ctx, ua.ID, w.ID, fresh.ID, ForwardChatMessageInput{TargetRoomIDs: []string{dm.ID}})
	if err != nil {
		t.Fatal(err)
	}
	reqs := linkPreviewRequests(t, pool)
	if len(reqs) != 3 || !strings.Contains(string(reqs[2].Payload), again[0].MessageID) {
		t.Fatalf("requests = %d, want the copy's own request last", len(reqs))
	}
}
