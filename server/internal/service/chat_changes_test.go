package service

import (
	"context"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The chat change log (ADR 0039 draft): a client that saw changes up to N
// reads only what changed after it, each message once as it is now, in the
// rooms it may read; a client too far behind is told to reload.
func TestChatSyncReplaysWhatChangedSinceTheClientsHead(t *testing.T) {
	s, _, q, ua, ub, w, _ := chatFixtureWithPool(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	m1, err := sendInWorkspaceRoom(ctx, s, ua.ID, w.ID, SendChatMessageInput{Body: "một"})
	if err != nil {
		t.Fatalf("send m1: %v", err)
	}
	// A client that has just loaded what it shows asks where the log is.
	start, err := s.SyncChatChanges(ctx, ub.ID, w.ID, 0, false)
	if err != nil || start.Reset || len(start.Changes) != 0 || start.Head < 1 {
		t.Fatalf("start: err=%v page=%+v", err, start)
	}

	if _, err := s.EditChatMessage(ctx, ua.ID, w.ID, m1.RoomID, m1.ID, "một (sửa)"); err != nil {
		t.Fatalf("edit m1: %v", err)
	}
	m2, err := sendInWorkspaceRoom(ctx, s, ua.ID, w.ID, SendChatMessageInput{Body: "hai"})
	if err != nil {
		t.Fatalf("send m2: %v", err)
	}
	if err := s.DeleteChatMessage(ctx, ua.ID, w.ID, m1.RoomID, m1.ID); err != nil {
		t.Fatalf("delete m1: %v", err)
	}
	m3, err := sendInWorkspaceRoom(ctx, s, ua.ID, w.ID, SendChatMessageInput{Body: "ba"})
	if err != nil {
		t.Fatalf("send m3: %v", err)
	}
	if _, err := s.EditChatMessage(ctx, ua.ID, w.ID, m3.RoomID, m3.ID, "ba (sửa)"); err != nil {
		t.Fatalf("edit m3: %v", err)
	}

	page, err := s.SyncChatChanges(ctx, ub.ID, w.ID, start.Head, true)
	if err != nil || page.Reset {
		t.Fatalf("sync: err=%v page=%+v", err, page)
	}
	if page.Head != start.Head+5 {
		t.Fatalf("head: got %d, want %d", page.Head, start.Head+5)
	}
	type seen struct{ id, kind, body string }
	var got []seen
	for _, c := range page.Changes {
		body := ""
		if c.Message != nil {
			body = c.Message.Body
		}
		got = append(got, seen{c.MessageID, c.Kind, body})
	}
	// One line per message, its last change; a message created then edited is still new; a deleted one has no body.
	want := []seen{{m2.ID, ChatChangeCreated, "hai"}, {m1.ID, ChatChangeDeleted, ""}, {m3.ID, ChatChangeCreated, "ba (sửa)"}}
	if len(got) != len(want) {
		t.Fatalf("changes: got %+v, want %+v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("change %d: got %+v, want %+v", i, got[i], want[i])
		}
	}

	again, err := s.SyncChatChanges(ctx, ub.ID, w.ID, page.Head, true)
	if err != nil || again.Reset || len(again.Changes) != 0 || again.Head != page.Head {
		t.Fatalf("caught up: err=%v page=%+v", err, again)
	}
	ahead, err := s.SyncChatChanges(ctx, ub.ID, w.ID, page.Head+100, true)
	if err != nil || !ahead.Reset || ahead.Head != page.Head {
		t.Fatalf("ahead of the log: err=%v page=%+v", err, ahead)
	}
}

func TestChatSyncKeepsToTheRoomsTheCallerReads(t *testing.T) {
	s, _, q, ua, ub, w, pool := chatFixtureWithPool(t)
	ctx := context.Background()
	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	uc := registerVerified(t, q, as, "chat-c@example.com", "C")
	for _, u := range []db.User{ub, uc} {
		addOrgMember(t, q, w.OrganizationID, u.ID)
		addWorkspaceMember(t, q, w.ID, u.ID)
	}
	start, err := s.SyncChatChanges(ctx, uc.ID, w.ID, 0, false)
	if err != nil {
		t.Fatal(err)
	}
	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatalf("dm: %v", err)
	}
	if _, err := s.SendRoomMessage(ctx, ua.ID, w.ID, dm.ID, SendChatMessageInput{Body: "riêng"}); err != nil {
		t.Fatalf("send dm: %v", err)
	}
	public, err := sendInWorkspaceRoom(ctx, s, ua.ID, w.ID, SendChatMessageInput{Body: "chung"})
	if err != nil {
		t.Fatalf("send: %v", err)
	}

	outsider, err := s.SyncChatChanges(ctx, uc.ID, w.ID, start.Head, true)
	if err != nil || len(outsider.Changes) != 1 || outsider.Changes[0].MessageID != public.ID {
		t.Fatalf("a DM C is not in stays out of C's sync: err=%v page=%+v", err, outsider)
	}
	member, err := s.SyncChatChanges(ctx, ub.ID, w.ID, start.Head, true)
	if err != nil || len(member.Changes) != 2 || member.Changes[0].RoomID != dm.ID || member.Changes[0].Message == nil {
		t.Fatalf("B reads the DM's change: err=%v page=%+v", err, member)
	}
	// Both answers end at the same place in the log, whatever they could read.
	if outsider.Head != member.Head {
		t.Fatalf("heads: %d vs %d", outsider.Head, member.Head)
	}
	if _, err := s.SyncChatChanges(ctx, uc.ID, "not-a-workspace", 0, false); err == nil {
		t.Fatal("a workspace the caller is not in is refused")
	}
}

func TestChatSyncTellsAClientTooFarBehindToReload(t *testing.T) {
	s, _, _, ua, _, w, pool := chatFixtureWithPool(t)
	ctx := context.Background()
	start, err := s.SyncChatChanges(ctx, ua.ID, w.ID, 0, false)
	if err != nil {
		t.Fatal(err)
	}
	m, err := sendInWorkspaceRoom(ctx, s, ua.ID, w.ID, SendChatMessageInput{Body: "x"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.EditChatMessage(ctx, ua.ID, w.ID, m.RoomID, m.ID, "y"); err != nil {
		t.Fatal(err)
	}
	// The writer trimmed the oldest change: a client whose head is before it reloads.
	if _, err := pool.Exec(ctx, `DELETE FROM chat_changes WHERE organization_id = $1 AND seq = $2`, w.OrganizationID, start.Head+1); err != nil {
		t.Fatal(err)
	}
	trimmed, err := s.SyncChatChanges(ctx, ua.ID, w.ID, start.Head, true)
	if err != nil || !trimmed.Reset {
		t.Fatalf("behind the oldest change kept: err=%v page=%+v", err, trimmed)
	}
	kept, err := s.SyncChatChanges(ctx, ua.ID, w.ID, start.Head+1, true)
	if err != nil || kept.Reset || len(kept.Changes) != 1 {
		t.Fatalf("right at the oldest change kept: err=%v page=%+v", err, kept)
	}

	// More changes than one page carries: pages, not a reset. Each page ends at
	// its last change and says more; the last one ends at the head.
	for i := 0; i <= ChatSyncMaxChanges; i++ {
		s.recordChatChange(ctx, db.ChatRoom{ID: m.RoomID}, m.ID, ChatChangeUpdated)
	}
	first, err := s.SyncChatChanges(ctx, ua.ID, w.ID, kept.Head, true)
	if err != nil || first.Reset || !first.More || first.Head != kept.Head+ChatSyncMaxChanges || len(first.Changes) != 1 {
		t.Fatalf("first page: err=%v reset=%v more=%v head=%d changes=%d", err, first.Reset, first.More, first.Head, len(first.Changes))
	}
	rest, err := s.SyncChatChanges(ctx, ua.ID, w.ID, first.Head, true)
	if err != nil || rest.Reset || rest.More || rest.Head != kept.Head+ChatSyncMaxChanges+1 || len(rest.Changes) != 1 {
		t.Fatalf("last page: err=%v page=%+v", err, rest)
	}
}

// Review P2: the page cap counted the whole organization's log, so a busy
// organization answered reset to every live check of every phone, even when
// nothing changed in a room the caller reads.
func TestChatSyncDoesNotCountRoomsTheCallerCannotRead(t *testing.T) {
	s, _, q, ua, ub, w, pool := chatFixtureWithPool(t)
	ctx := context.Background()
	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	uc := registerVerified(t, q, as, "chat-sync-c@example.com", "C")
	for _, u := range []db.User{ub, uc} {
		addOrgMember(t, q, w.OrganizationID, u.ID)
		addWorkspaceMember(t, q, w.ID, u.ID)
	}
	start, err := s.SyncChatChanges(ctx, uc.ID, w.ID, 0, false)
	if err != nil {
		t.Fatal(err)
	}
	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatalf("dm: %v", err)
	}
	private, err := s.SendRoomMessage(ctx, ua.ID, w.ID, dm.ID, SendChatMessageInput{Body: "riêng"})
	if err != nil {
		t.Fatalf("send dm: %v", err)
	}
	for i := 0; i < ChatSyncMaxChanges+50; i++ {
		s.recordChatChange(ctx, db.ChatRoom{ID: dm.ID, OrganizationID: w.OrganizationID}, private.ID, ChatChangeUpdated)
	}
	public, err := sendInWorkspaceRoom(ctx, s, ua.ID, w.ID, SendChatMessageInput{Body: "chung"})
	if err != nil {
		t.Fatalf("send: %v", err)
	}
	page, err := s.SyncChatChanges(ctx, uc.ID, w.ID, start.Head, true)
	if err != nil || page.Reset || page.More || len(page.Changes) != 1 || page.Changes[0].MessageID != public.ID {
		t.Fatalf("C reads only the public change, in one page: err=%v reset=%v more=%v changes=%+v", err, page.Reset, page.More, page.Changes)
	}
	member, err := s.SyncChatChanges(ctx, ub.ID, w.ID, start.Head, true)
	if err != nil || member.Reset || !member.More {
		t.Fatalf("B, in the DM, pages through it: err=%v reset=%v more=%v", err, member.Reset, member.More)
	}
}

// Review P2: the log row was written on the request's context after the
// commit, so a sender whose phone dropped right then lost the row, and a
// reconnect that syncs no longer refetches what it shows.
func TestChatChangeIsRecordedAfterTheRequestIsGone(t *testing.T) {
	s, _, _, ua, _, w, _ := chatFixtureWithPool(t)
	ctx := context.Background()
	start, err := s.SyncChatChanges(ctx, ua.ID, w.ID, 0, false)
	if err != nil {
		t.Fatal(err)
	}
	m, err := sendInWorkspaceRoom(ctx, s, ua.ID, w.ID, SendChatMessageInput{Body: "x"})
	if err != nil {
		t.Fatal(err)
	}
	gone, cancel := context.WithCancel(ctx)
	cancel()
	s.recordChatChange(gone, db.ChatRoom{ID: m.RoomID}, m.ID, ChatChangeUpdated)
	page, err := s.SyncChatChanges(ctx, ua.ID, w.ID, start.Head, true)
	if err != nil || page.Head != start.Head+2 {
		t.Fatalf("the change of a cancelled request is in the log: err=%v page=%+v", err, page)
	}
}

// sendInWorkspaceRoom posts to the workspace channel, creating it on first
// use, as the removed SendWorkspaceMessage did (UNI-1718).
func sendInWorkspaceRoom(
	ctx context.Context, s *ChatService, userID, workspaceID string, in SendChatMessageInput,
) (ChatMessageRow, error) {
	room, err := s.EnsureWorkspaceRoom(ctx, userID, workspaceID)
	if err != nil {
		return ChatMessageRow{}, err
	}
	return s.SendRoomMessage(ctx, userID, workspaceID, room.RoomID, in)
}
