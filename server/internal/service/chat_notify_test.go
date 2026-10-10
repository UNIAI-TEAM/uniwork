package service

import (
	"bytes"
	"context"
	"encoding/json"
	"slices"
	"testing"
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
