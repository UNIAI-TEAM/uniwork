package service

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"slices"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestChatThreadReplyStaysOffMainTimeline(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	room, err := s.EnsureWorkspaceRoom(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	root, err := s.SendRoomMessage(ctx, ua.ID, w.ID, room.RoomID, SendChatMessageInput{Body: "deploy luc may?"})
	if err != nil {
		t.Fatalf("root: %v", err)
	}
	reply, err := s.SendThreadReply(ctx, ub.ID, w.ID, room.RoomID, root.ID, SendChatMessageInput{Body: "9pm ok"})
	if err != nil {
		t.Fatalf("reply: %v", err)
	}
	if reply.ThreadRootID == nil || *reply.ThreadRootID != root.ID {
		t.Fatalf("thread_root_id: %+v", reply)
	}

	main, err := s.ListRoomMessages(ctx, ua.ID, w.ID, room.RoomID, ListChatMessagesInput{})
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range main {
		if m.ID == reply.ID {
			t.Fatal("thread reply leaked onto main timeline")
		}
		if m.ID == root.ID && m.ReplyCount != 1 {
			t.Fatalf("root reply_count want 1 got %d", m.ReplyCount)
		}
	}

	thread, err := s.ListThreadMessages(ctx, ua.ID, w.ID, room.RoomID, root.ID, ListChatMessagesInput{})
	if err != nil {
		t.Fatal(err)
	}
	if len(thread) != 2 {
		t.Fatalf("thread len=%d want 2", len(thread))
	}

	if _, err := s.SendThreadReply(ctx, ua.ID, w.ID, room.RoomID, reply.ID, SendChatMessageInput{Body: "nested"}); !codedIs(err, "chat_thread_invalid_root") {
		t.Fatalf("nested reply: want chat_thread_invalid_root, got %v", err)
	}

	if err := s.UnfollowThread(ctx, ua.ID, w.ID, root.ID); err != nil {
		t.Fatalf("mute: %v", err)
	}
	if _, err := s.SendThreadReply(ctx, ub.ID, w.ID, room.RoomID, root.ID, SendChatMessageInput{Body: "again"}); err != nil {
		t.Fatalf("reply after mute: %v", err)
	}
	mine, err := s.ListFollowedThreads(ctx, ua.ID, w.ID, false, 20)
	if err != nil {
		t.Fatal(err)
	}
	for _, th := range mine {
		if th.ThreadRootID == root.ID {
			t.Fatal("muted thread still listed")
		}
	}
}

func TestChatThreadFollowMarkReadAndList(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	room, err := s.EnsureWorkspaceRoom(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	root, err := s.SendRoomMessage(ctx, ua.ID, w.ID, room.RoomID, SendChatMessageInput{Body: "root"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SendThreadReply(ctx, ub.ID, w.ID, room.RoomID, root.ID, SendChatMessageInput{
		Body: "reply", Priority: "important", ClientMsgID: "cmid-thread-1",
	}); err != nil {
		t.Fatal(err)
	}
	// Idempotent resend with the same client_msg_id.
	again, err := s.SendThreadReply(ctx, ub.ID, w.ID, room.RoomID, root.ID, SendChatMessageInput{
		Body: "reply", ClientMsgID: "cmid-thread-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if again.ClientMsgID != "cmid-thread-1" {
		t.Fatalf("client_msg_id echo: %q", again.ClientMsgID)
	}

	if err := s.UnfollowThread(ctx, ua.ID, w.ID, root.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.FollowThread(ctx, ua.ID, w.ID, root.ID); err != nil {
		t.Fatalf("unfollow then follow: %v", err)
	}
	// Each read hands back the pointer it replaced, so a catch-up asked for
	// after opening the thread still starts where the reader left off.
	for i := 0; i < 2; i++ {
		before, err := q.GetChatThreadFollower(ctx, db.GetChatThreadFollowerParams{ThreadRootID: root.ID, UserID: ua.ID})
		if err != nil {
			t.Fatal(err)
		}
		prev, err := s.MarkThreadRead(ctx, ua.ID, w.ID, root.ID)
		if err != nil {
			t.Fatalf("mark read %d: %v", i, err)
		}
		if !before.LastReadAt.Valid || !prev.Equal(before.LastReadAt.Time) {
			t.Fatalf("mark read %d: previous=%v want %v", i, prev, before.LastReadAt)
		}
	}

	thread, err := s.ListThreadMessages(ctx, ua.ID, w.ID, room.RoomID, root.ID, ListChatMessagesInput{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if len(thread) < 2 {
		t.Fatalf("thread len=%d", len(thread))
	}
	for _, m := range thread {
		if m.ID == root.ID && m.ThreadUnread {
			t.Fatal("root still unread after mark read")
		}
	}

	listed, err := s.ListFollowedThreads(ctx, ua.ID, w.ID, false, 0)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, th := range listed {
		if th.ThreadRootID == root.ID {
			found = true
			if th.ReplyCount < 1 {
				t.Fatalf("reply_count=%d", th.ReplyCount)
			}
		}
	}
	if !found {
		t.Fatal("followed thread missing from list")
	}

	unreadOnly, err := s.ListFollowedThreads(ctx, ua.ID, w.ID, true, 5)
	if err != nil {
		t.Fatal(err)
	}
	for _, th := range unreadOnly {
		if th.ThreadRootID == root.ID {
			t.Fatal("read thread still in unread-only list")
		}
	}
}

// Deleting a reply takes it off the root's summary (UNI-1678): one fewer in
// reply_count, last_reply_at falls back to the newest live reply, an empty
// thread leaves the followed list, and the room hears about the root.
func TestDeletingAThreadReplyUpdatesTheRoot(t *testing.T) {
	s, pub, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	room, err := s.EnsureWorkspaceRoom(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	root, err := s.SendRoomMessage(ctx, ua.ID, w.ID, room.RoomID, SendChatMessageInput{Body: "deploy luc may?"})
	if err != nil {
		t.Fatal(err)
	}
	r1, err := s.SendThreadReply(ctx, ub.ID, w.ID, room.RoomID, root.ID, SendChatMessageInput{Body: "9pm"})
	if err != nil {
		t.Fatal(err)
	}
	r2, err := s.SendThreadReply(ctx, ub.ID, w.ID, room.RoomID, root.ID, SendChatMessageInput{Body: "ok"})
	if err != nil {
		t.Fatal(err)
	}

	rootRow := func() ChatMessageRow {
		t.Helper()
		main, err := s.ListRoomMessages(ctx, ua.ID, w.ID, room.RoomID, ListChatMessagesInput{})
		if err != nil {
			t.Fatal(err)
		}
		for _, m := range main {
			if m.ID == root.ID {
				return m
			}
		}
		t.Fatal("root missing from main timeline")
		return ChatMessageRow{}
	}
	rootUpdatedSince := func(from int) bool {
		for _, ev := range pub.events[from:] {
			if ev.Type == "chat.message.updated" && ev.Payload["message_id"] == root.ID {
				return true
			}
		}
		return false
	}

	mark := len(pub.events)
	if err := s.DeleteChatMessage(ctx, ub.ID, w.ID, room.RoomID, r2.ID); err != nil {
		t.Fatalf("delete r2: %v", err)
	}
	got := rootRow()
	if got.ReplyCount != 1 {
		t.Fatalf("after r2 delete: reply_count=%d want 1", got.ReplyCount)
	}
	if got.LastReplyAt == nil || !got.LastReplyAt.Equal(r1.CreatedAt) {
		t.Fatalf("after r2 delete: last_reply_at=%v want %v", got.LastReplyAt, r1.CreatedAt)
	}
	if !rootUpdatedSince(mark) {
		t.Fatal("no chat.message.updated for the root after deleting r2")
	}

	mark = len(pub.events)
	if err := s.DeleteChatMessage(ctx, ub.ID, w.ID, room.RoomID, r1.ID); err != nil {
		t.Fatalf("delete r1: %v", err)
	}
	got = rootRow()
	if got.ReplyCount != 0 || got.LastReplyAt != nil {
		t.Fatalf("after r1 delete: reply_count=%d last_reply_at=%v want 0, nil", got.ReplyCount, got.LastReplyAt)
	}
	if !rootUpdatedSince(mark) {
		t.Fatal("no chat.message.updated for the root after deleting r1")
	}
	followed, err := s.ListFollowedThreads(ctx, ub.ID, w.ID, false, 20)
	if err != nil {
		t.Fatal(err)
	}
	for _, th := range followed {
		if th.ThreadRootID == root.ID {
			t.Fatal("empty thread still in the followed list")
		}
	}

	// A main-timeline delete has no root to refresh.
	plain, err := s.SendRoomMessage(ctx, ub.ID, w.ID, room.RoomID, SendChatMessageInput{Body: "plain"})
	if err != nil {
		t.Fatal(err)
	}
	mark = len(pub.events)
	if err := s.DeleteChatMessage(ctx, ub.ID, w.ID, room.RoomID, plain.ID); err != nil {
		t.Fatal(err)
	}
	for _, ev := range pub.events[mark:] {
		if ev.Type == "chat.message.updated" {
			t.Fatalf("main-timeline delete published %s for %s", ev.Type, ev.Payload["message_id"])
		}
	}
}

func TestChatThreadRejectedOnDM(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatal(err)
	}
	root, err := s.SendRoomMessage(ctx, ua.ID, w.ID, dm.ID, SendChatMessageInput{Body: "dm root"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SendThreadReply(ctx, ub.ID, w.ID, dm.ID, root.ID, SendChatMessageInput{Body: "nope"}); !codedIs(err, "chat_thread_not_found") {
		t.Fatalf("dm thread reply: want chat_thread_not_found, got %v", err)
	}
	if _, err := s.ListThreadMessages(ctx, ua.ID, w.ID, dm.ID, root.ID, ListChatMessagesInput{}); !codedIs(err, "chat_thread_not_found") {
		t.Fatalf("dm list thread: want chat_thread_not_found, got %v", err)
	}
	if err := s.FollowThread(ctx, ua.ID, w.ID, root.ID); !codedIs(err, "chat_thread_not_found") {
		t.Fatalf("dm follow: want chat_thread_not_found, got %v", err)
	}
	if _, err := s.ListThreadMessages(ctx, ua.ID, w.ID, dm.ID, "missing-root", ListChatMessagesInput{}); !codedIs(err, "chat_thread_not_found") {
		t.Fatalf("missing root: want chat_thread_not_found, got %v", err)
	}
}

func TestBoolFromDriver(t *testing.T) {
	cases := []struct {
		in   any
		want bool
	}{
		{true, true},
		{false, false},
		{int64(1), true},
		{int64(0), false},
		{int32(2), true},
		{int32(0), false},
		{3, true},
		{0, false},
		{"x", false},
		{nil, false},
	}
	for _, c := range cases {
		if got := boolFromDriver(c.in); got != c.want {
			t.Fatalf("boolFromDriver(%v)=%v want %v", c.in, got, c.want)
		}
	}
}

// Opening a thread marks it read but does not follow it: only the root's
// author, repliers, mentioned members and a manual Follow are followers, so a
// reader is not notified of every later reply (UNI-1682).
func TestOpeningAThreadDoesNotFollowIt(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	uc := chatTestUser(t, q, w, "thread-reader-c@example.com")

	room, err := s.EnsureWorkspaceRoom(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	root, err := s.SendRoomMessage(ctx, ua.ID, w.ID, room.RoomID, SendChatMessageInput{Body: "Lich nghi le"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SendThreadReply(ctx, ub.ID, w.ID, room.RoomID, root.ID, SendChatMessageInput{Body: "ok"}); err != nil {
		t.Fatal(err)
	}

	if _, err := s.MarkThreadRead(ctx, uc.ID, w.ID, root.ID); err != nil {
		t.Fatalf("mark read: %v", err)
	}
	if _, err := q.GetChatThreadFollower(ctx, db.GetChatThreadFollowerParams{
		ThreadRootID: root.ID, UserID: uc.ID,
	}); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("reader became a follower: err=%v", err)
	}
	reply, err := s.SendThreadReply(ctx, ub.ID, w.ID, room.RoomID, root.ID, SendChatMessageInput{Body: "chot truoc thu 6"})
	if err != nil {
		t.Fatal(err)
	}
	if got := chatNotifyRecipients(t, s, "chat.thread.reply_received", reply.ID); slices.Contains(got, uc.ID) {
		t.Fatalf("reader notified of a reply: %v", got)
	}

	following := func() bool {
		t.Helper()
		thread, err := s.ListThreadMessages(ctx, uc.ID, w.ID, room.RoomID, root.ID, ListChatMessagesInput{})
		if err != nil {
			t.Fatal(err)
		}
		for _, m := range thread {
			if m.ID == root.ID {
				return m.ThreadFollowing
			}
		}
		t.Fatal("root missing from thread")
		return false
	}
	if following() {
		t.Fatal("following before Follow")
	}
	if err := s.FollowThread(ctx, uc.ID, w.ID, root.ID); err != nil {
		t.Fatal(err)
	}
	if !following() {
		t.Fatal("not following after Follow")
	}
	if err := s.UnfollowThread(ctx, uc.ID, w.ID, root.ID); err != nil {
		t.Fatal(err)
	}
	if following() {
		t.Fatal("still following after Unfollow")
	}
}

// A thread with more replies than one page still answers whether the viewer
// follows it: the root, the oldest row, falls off the newest-first page, so the
// first page carries it on top (UNI-1682).
func TestBusyThreadStillReportsFollowing(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	room, err := s.EnsureWorkspaceRoom(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	root, err := s.SendRoomMessage(ctx, ua.ID, w.ID, room.RoomID, SendChatMessageInput{Body: "Ke hoach quy 4"})
	if err != nil {
		t.Fatal(err)
	}
	for range defaultChatMessageLimit + 1 {
		if _, err := s.SendThreadReply(ctx, ua.ID, w.ID, room.RoomID, root.ID, SendChatMessageInput{Body: "ok"}); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.FollowThread(ctx, ub.ID, w.ID, root.ID); err != nil {
		t.Fatal(err)
	}

	thread, err := s.ListThreadMessages(ctx, ub.ID, w.ID, room.RoomID, root.ID, ListChatMessagesInput{})
	if err != nil {
		t.Fatal(err)
	}
	if len(thread) != defaultChatMessageLimit+1 || thread[0].ID != root.ID {
		t.Fatalf("first page: %d rows, first=%q, want root then %d replies", len(thread), thread[0].ID, defaultChatMessageLimit)
	}
	if !thread[0].ThreadFollowing {
		t.Fatal("follower reported as not following on a busy thread")
	}
	if thread[0].ReplyCount != defaultChatMessageLimit+1 {
		t.Fatalf("root reply_count=%d", thread[0].ReplyCount)
	}

	older, err := s.ListThreadMessages(ctx, ub.ID, w.ID, room.RoomID, root.ID, ListChatMessagesInput{Before: &thread[1].CreatedAt})
	if err != nil {
		t.Fatal(err)
	}
	// Only the first page carries the root (UNI-1679).
	if len(older) != 1 || older[0].ID == root.ID {
		t.Fatalf("older page: %d rows, want only the oldest reply", len(older))
	}
}

func TestListRoomMessagesAroundKeepsThreadRepliesInTheThread(t *testing.T) {
	s, _, q, ua, ub, w, pool := chatFixtureWithPool(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	room, err := s.EnsureWorkspaceRoom(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	send := func(body string) ChatMessageRow {
		t.Helper()
		m, err := s.SendRoomMessage(ctx, ua.ID, w.ID, room.RoomID, SendChatMessageInput{Body: body})
		if err != nil {
			t.Fatalf("send %q: %v", body, err)
		}
		return m
	}
	reply := func(rootID, body string) ChatMessageRow {
		t.Helper()
		m, err := s.SendThreadReply(ctx, ub.ID, w.ID, room.RoomID, rootID, SendChatMessageInput{Body: body})
		if err != nil {
			t.Fatalf("reply %q: %v", body, err)
		}
		return m
	}
	root := send("ke hoach Q4")
	r1 := reply(root.ID, "mot")
	mainA := send("tin chinh A")
	r2 := reply(root.ID, "hai")
	mainB := send("tin chinh B")
	r3 := reply(root.ID, "ba")
	// Two main-timeline messages on the same instant sit on the anchor's boundary.
	if _, err := pool.Exec(ctx, `UPDATE chat_messages SET created_at = $1 WHERE id = $2`, mainA.CreatedAt, mainB.ID); err != nil {
		t.Fatal(err)
	}
	replyIDs := map[string]bool{r1.ID: true, r2.ID: true, r3.ID: true}

	check := func(anchor string) {
		t.Helper()
		around, err := s.ListRoomMessagesAround(ctx, ua.ID, w.ID, room.RoomID, anchor, 50)
		if err != nil {
			t.Fatal(err)
		}
		seen := map[string]int{}
		for i, m := range around {
			seen[m.ID]++
			if replyIDs[m.ID] {
				t.Fatalf("around %s: thread reply %s on the main timeline", anchor, m.ID)
			}
			if m.ID == root.ID && m.ReplyCount != 3 {
				t.Fatalf("around %s: root reply_count=%d want 3", anchor, m.ReplyCount)
			}
			if i > 0 {
				prev := around[i-1]
				if m.CreatedAt.Before(prev.CreatedAt) || (m.CreatedAt.Equal(prev.CreatedAt) && m.ID <= prev.ID) {
					t.Fatalf("around %s: rows not ascending by (created_at, id) at %d", anchor, i)
				}
			}
		}
		for _, id := range []string{root.ID, mainA.ID, mainB.ID} {
			if seen[id] != 1 {
				t.Fatalf("around %s: %s seen %d times, want once", anchor, id, seen[id])
			}
		}
	}
	check(mainA.ID)
	check(mainB.ID)
	check(r2.ID)
}

func TestListThreadMessagesPagesOlderReplies(t *testing.T) {
	s, _, q, ua, ub, w, pool := chatFixtureWithPool(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	room, err := s.EnsureWorkspaceRoom(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	root, err := s.SendRoomMessage(ctx, ua.ID, w.ID, room.RoomID, SendChatMessageInput{Body: "ke hoach Q4"})
	if err != nil {
		t.Fatal(err)
	}
	const total = 60
	replies := make([]ChatMessageRow, 0, total)
	for i := range total {
		m, err := s.SendThreadReply(ctx, ub.ID, w.ID, room.RoomID, root.ID, SendChatMessageInput{Body: fmt.Sprintf("#%d", i+1)})
		if err != nil {
			t.Fatalf("reply %d: %v", i+1, err)
		}
		replies = append(replies, m)
	}
	// One reply a second after the root; #10 and #11 share an instant, so the
	// page boundary falls between two rows with the same created_at.
	base := root.CreatedAt.Add(time.Second)
	for i, m := range replies {
		at := base.Add(time.Duration(i) * time.Second)
		if i == 10 {
			at = base.Add(9 * time.Second)
		}
		if _, err := pool.Exec(ctx, `UPDATE chat_messages SET created_at = $1 WHERE id = $2`, at, m.ID); err != nil {
			t.Fatal(err)
		}
	}

	first, err := s.ListThreadMessages(ctx, ua.ID, w.ID, room.RoomID, root.ID, ListChatMessagesInput{Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	if len(first) != 51 || first[0].ID != root.ID {
		t.Fatalf("first page: len=%d head=%v, want the root then 50 replies", len(first), first[0].ID)
	}
	older, err := s.ListThreadMessages(ctx, ua.ID, w.ID, room.RoomID, root.ID, ListChatMessagesInput{
		Limit: 50, Cursor: first[1].Cursor(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(older) != 10 {
		t.Fatalf("older page len=%d want 10", len(older))
	}
	seen := map[string]int{}
	for _, m := range append(first[1:], older...) {
		if m.ID == root.ID {
			t.Fatal("root repeated on the older page")
		}
		seen[m.ID]++
	}
	for i, m := range replies {
		if seen[m.ID] != 1 {
			t.Fatalf("reply #%d seen %d times, want once", i+1, seen[m.ID])
		}
	}
}

// UNI-1693: the default channel has no chat.room.activity, so a client counts
// its unread and mentions from these frames; a thread reply must say it is one.
func TestThreadReplyFramesNameTheirRoot(t *testing.T) {
	s, pub, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	room, err := s.EnsureWorkspaceRoom(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	mention := SendChatMessageInput{Body: "[@B](mention://member/" + ub.ID + ") xem giup"}
	rootIDs := func(from int) map[string]string {
		got := map[string]string{}
		for _, ev := range pub.events[from:] {
			if ev.Type == "chat.message.created" || ev.Type == "chat.mention.created" {
				id, ok := ev.Payload["thread_root_id"]
				if !ok {
					id = "<absent>"
				}
				got[ev.Type] = id
			}
		}
		return got
	}

	from := len(pub.events)
	root, err := s.SendRoomMessage(ctx, ua.ID, w.ID, room.RoomID, mention)
	if err != nil {
		t.Fatalf("root: %v", err)
	}
	if got, want := rootIDs(from), map[string]string{"chat.message.created": "<absent>", "chat.mention.created": "<absent>"}; !maps.Equal(got, want) {
		t.Fatalf("main-timeline frames: got %v want %v", got, want)
	}

	from = len(pub.events)
	if _, err := s.SendThreadReply(ctx, ua.ID, w.ID, room.RoomID, root.ID, mention); err != nil {
		t.Fatalf("reply: %v", err)
	}
	if got, want := rootIDs(from), map[string]string{"chat.message.created": root.ID, "chat.mention.created": root.ID}; !maps.Equal(got, want) {
		t.Fatalf("thread reply frames: got %v want %v", got, want)
	}
}
