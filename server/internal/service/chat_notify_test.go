package service

import (
	"bytes"
	"context"
	"encoding/json"
	"slices"
	"testing"
	"time"
)

// chatNotifyRecipients is every user_id the durable chat notification topic
// carries for messageID, in insert order.
func chatNotifyRecipients(t *testing.T, s *ChatService, topic, messageID string) []string {
	t.Helper()
	rows, err := s.pool.Query(context.Background(),
		`SELECT payload FROM outbox_events WHERE topic = $1 AND payload::jsonb->>'message_id' = $2 ORDER BY id`, topic, messageID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var raw string
		if err := rows.Scan(&raw); err != nil {
			t.Fatal(err)
		}
		var p map[string]string
		if err := json.Unmarshal([]byte(raw), &p); err != nil {
			t.Fatal(err)
		}
		out = append(out, p["user_id"])
	}
	return out
}

// A DM, a mention and a thread reply each leave a durable outbox row in the
// send transaction, so the notification consumer can reach a person who is
// not on the chat page (H1). The ephemeral frame alone is lost when nobody
// is connected.
func TestChatSendWritesDurableNotificationRows(t *testing.T) {
	s, _, q, ua, ub, w := chatFixtureFiles(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)

	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatal(err)
	}
	text, err := s.SendRoomMessage(ctx, ua.ID, w.ID, dm.ID, SendChatMessageInput{Body: "chào"})
	if err != nil {
		t.Fatal(err)
	}
	if got := chatNotifyRecipients(t, s, "chat.dm.received", text.ID); !slices.Equal(got, []string{ub.ID}) {
		t.Fatalf("dm text notified %v, want the peer", got)
	}
	file, err := s.SendFileMessage(ctx, ub.ID, w.ID, dm.ID, SendFileMessageInput{
		Filename: "ke-hoach.pdf", Body: bytes.NewReader(tinyFSFileBytes),
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := chatNotifyRecipients(t, s, "chat.dm.received", file.ID); !slices.Equal(got, []string{ua.ID}) {
		t.Fatalf("dm file notified %v, want the peer", got)
	}

	ch, err := s.CreateChannel(ctx, ua.ID, w.ID, CreateChannelInput{
		Name: "notify", Visibility: chatVisibilityPublic, MemberUserIDs: []string{ub.ID},
	})
	if err != nil {
		t.Fatal(err)
	}
	named, err := s.SendRoomMessage(ctx, ua.ID, w.ID, ch.ID, SendChatMessageInput{Body: "[@B](mention://member/" + ub.ID + ") xem nhé"})
	if err != nil {
		t.Fatal(err)
	}
	if got := chatNotifyRecipients(t, s, "chat.message.mentioned", named.ID); !slices.Equal(got, []string{ub.ID}) {
		t.Fatalf("mention notified %v, want the named member", got)
	}
	plain, err := s.SendRoomMessage(ctx, ua.ID, w.ID, ch.ID, SendChatMessageInput{Body: "không nhắc ai"})
	if err != nil {
		t.Fatal(err)
	}
	if got := chatNotifyRecipients(t, s, "chat.message.mentioned", plain.ID); len(got) != 0 {
		t.Fatalf("plain channel message notified %v", got)
	}

	all, err := s.SendRoomMessage(ctx, ua.ID, w.ID, ch.ID, SendChatMessageInput{Body: mentionAllBody})
	if err != nil {
		t.Fatal(err)
	}
	if got := chatNotifyRecipients(t, s, "chat.message.mentioned", all.ID); !slices.Equal(got, []string{ub.ID}) {
		t.Fatalf("@all in a small room notified %v, want every other member", got)
	}
	// Past the small-room bound @all stays a badge: one inbox row per member
	// of a 1,000-person room is the spam the bound exists to prevent.
	smallChatRoom(t, 1)
	loud, err := s.SendRoomMessage(ctx, ua.ID, w.ID, ch.ID, SendChatMessageInput{Body: mentionAllBody})
	if err != nil {
		t.Fatal(err)
	}
	if got := chatNotifyRecipients(t, s, "chat.message.mentioned", loud.ID); len(got) != 0 {
		t.Fatalf("@all in a large room notified %v", got)
	}

	reply, err := s.SendThreadReply(ctx, ub.ID, w.ID, ch.ID, plain.ID, SendChatMessageInput{Body: "ok"})
	if err != nil {
		t.Fatal(err)
	}
	if got := chatNotifyRecipients(t, s, "chat.thread.reply_received", reply.ID); !slices.Equal(got, []string{ua.ID}) {
		t.Fatalf("thread reply notified %v, want the root's author", got)
	}
	// A follower the reply names hears it once, as a mention.
	pinged, err := s.SendThreadReply(ctx, ub.ID, w.ID, ch.ID, plain.ID, SendChatMessageInput{Body: "[@A](mention://member/" + ua.ID + ") ?"})
	if err != nil {
		t.Fatal(err)
	}
	if got := chatNotifyRecipients(t, s, "chat.thread.reply_received", pinged.ID); len(got) != 0 {
		t.Fatalf("mentioned follower also got a thread row: %v", got)
	}
	if got := chatNotifyRecipients(t, s, "chat.message.mentioned", pinged.ID); !slices.Equal(got, []string{ua.ID}) {
		t.Fatalf("thread mention notified %v", got)
	}
}

// sendEveryKind sends a poll, a note, a post and a reminder into roomID, each
// keyed by clientMsgID plus its kind, and returns them in that order.
func sendEveryKind(t *testing.T, s *ChatService, userID, workspaceID, roomID, clientMsgID string) []ChatMessageRow {
	t.Helper()
	ctx := context.Background()
	remindAt := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
	key := func(kind string) string {
		if clientMsgID == "" {
			return ""
		}
		return clientMsgID + "-" + kind
	}
	var out []ChatMessageRow
	for _, send := range []func() (ChatMessageRow, error){
		func() (ChatMessageRow, error) {
			return s.SendPollMessage(ctx, userID, workspaceID, roomID, SendPollMessageInput{
				Question: "Ăn trưa ở đâu?", Options: []string{"Phở", "Bún"}, ClientMsgID: key("poll"),
			})
		},
		func() (ChatMessageRow, error) {
			return s.SendNoteMessage(ctx, userID, workspaceID, roomID, SendNoteMessageInput{
				Body: "Ghi chú họp", ClientMsgID: key("note"),
			})
		},
		func() (ChatMessageRow, error) {
			return s.SendPostMessage(ctx, userID, workspaceID, roomID, SendPostMessageInput{
				Title: "Thông báo", Body: "Nghỉ lễ", ClientMsgID: key("post"),
			})
		},
		func() (ChatMessageRow, error) {
			return s.SendReminderMessage(ctx, userID, workspaceID, roomID, SendReminderMessageInput{
				Body: "Nộp báo cáo", RemindAt: remindAt, Repeat: "daily", ClientMsgID: key("reminder"),
			})
		},
	} {
		row, err := send()
		if err != nil {
			t.Fatal(err)
		}
		out = append(out, row)
	}
	return out
}

// A poll, note, post or reminder in a DM reaches the offline peer the same way
// a text does: a durable chat.dm.received row in the send transaction.
func TestKindMessagesInADMNotifyThePeer(t *testing.T) {
	s, _, q, ua, ub, w := chatFixtureFiles(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, msg := range sendEveryKind(t, s, ua.ID, w.ID, dm.ID, "") {
		if got := chatNotifyRecipients(t, s, "chat.dm.received", msg.ID); !slices.Equal(got, []string{ub.ID}) {
			t.Fatalf("dm %s notified %v, want the peer", msg.Kind, got)
		}
	}
}

// The client retries a send on a network error or a 5xx with the same key; a
// repeat must return the first message, not post a second poll or a second
// daily reminder.
func TestKindMessagesReturnTheFirstOnARepeatedClientMsgID(t *testing.T) {
	s, _, q, ua, ub, w := chatFixtureFiles(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	dm, err := s.ResolveDM(ctx, ua.ID, w.ID, ub.ID)
	if err != nil {
		t.Fatal(err)
	}
	first := sendEveryKind(t, s, ua.ID, w.ID, dm.ID, "retry-key-01")
	again := sendEveryKind(t, s, ua.ID, w.ID, dm.ID, "retry-key-01")
	for i := range first {
		if first[i].ID != again[i].ID {
			t.Fatalf("%s repeat got %s, want the first %s", first[i].Kind, again[i].ID, first[i].ID)
		}
	}
	var messages, reminders int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM chat_messages WHERE room_id = $1`, dm.ID).Scan(&messages); err != nil {
		t.Fatal(err)
	}
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM chat_reminders WHERE room_id = $1`, dm.ID).Scan(&reminders); err != nil {
		t.Fatal(err)
	}
	if messages != 4 || reminders != 1 {
		t.Fatalf("room holds %d messages and %d reminders, want 4 and 1", messages, reminders)
	}
}

// Past chatSmallRoomMembers a thread reply is a badge for its followers, like
// @all: a row per follower of a busy thread is written under the root's lock
// and drained one by one on the workspace's notify lane. The root's author
// still hears it.
func TestThreadReplyPastTheBoundNotifiesOnlyTheRootAuthor(t *testing.T) {
	s, _, q, ua, ub, w := chatFixture(t)
	ctx := context.Background()
	addOrgMember(t, q, w.OrganizationID, ub.ID)
	addWorkspaceMember(t, q, w.ID, ub.ID)
	uc := chatTestUser(t, q, w, "thread-bound-c@example.com")
	ud := chatTestUser(t, q, w, "thread-bound-d@example.com")
	ch, err := s.CreateChannel(ctx, ua.ID, w.ID, CreateChannelInput{
		Name: "thread-bound", Visibility: chatVisibilityPublic, MemberUserIDs: []string{ub.ID, uc.ID, ud.ID},
	})
	if err != nil {
		t.Fatal(err)
	}
	root, err := s.SendRoomMessage(ctx, ua.ID, w.ID, ch.ID, SendChatMessageInput{Body: "nghỉ Tết"})
	if err != nil {
		t.Fatal(err)
	}
	for _, u := range []string{ub.ID, uc.ID} {
		if _, err := s.SendThreadReply(ctx, u, w.ID, ch.ID, root.ID, SendChatMessageInput{Body: "đã đọc"}); err != nil {
			t.Fatal(err)
		}
	}

	smallChatRoom(t, 1)
	reply, err := s.SendThreadReply(ctx, ud.ID, w.ID, ch.ID, root.ID, SendChatMessageInput{Body: "đã đọc"})
	if err != nil {
		t.Fatal(err)
	}
	if got := chatNotifyRecipients(t, s, "chat.thread.reply_received", reply.ID); !slices.Equal(got, []string{ua.ID}) {
		t.Fatalf("reply in a busy thread notified %v, want only the root's author", got)
	}
}
