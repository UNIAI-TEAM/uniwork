package service

import (
	"context"
	"testing"
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
	if err := s.MarkThreadRead(ctx, ua.ID, w.ID, root.ID); err != nil {
		t.Fatalf("mark read: %v", err)
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
