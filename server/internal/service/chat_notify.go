package service

import (
	"context"
	"log/slog"
	"slices"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// mentionNotifiedIDs is who a mention notifies: everyone for a small-room @all, else the named.
func mentionNotifiedIDs(m chatMentions) []string {
	mentioned := m.Recipients
	if m.All && len(mentioned)+1 > chatSmallRoomMembers {
		mentioned = m.Named
	}
	return mentioned
}

func chatNotifyEvent(room db.ChatRoom, topic, messageID, threadRootID, userID string) audit.Event {
	p := map[string]string{"room_id": room.ID, "message_id": messageID, "user_id": userID}
	if threadRootID != "" {
		p["thread_root_id"] = threadRootID
	}
	return audit.Event{
		Topic: topic, Version: 1, Payload: p,
		OrganizationID: room.OrganizationID, WorkspaceID: roomAnchorWorkspaceID(room),
	}
}

func newMentionNotifyIDs(before chatMessageMetadata, m chatMentions) []string {
	if before.MentionsAll {
		return nil
	}
	prev := map[string]struct{}{}
	for _, id := range mentionedUserIDsFromMetadata(before) {
		prev[id] = struct{}{}
	}
	var added []string
	for _, id := range mentionNotifiedIDs(m) {
		id = strings.ToUpper(strings.TrimSpace(id))
		if id == "" {
			continue
		}
		if _, ok := prev[id]; ok {
			continue
		}
		added = append(added, id)
	}
	return added
}

// emitChatMentionsAdded writes durable mention rows for newly added @names on edit (UNI-1730).
func emitChatMentionsAdded(
	ctx context.Context, q *db.Queries, room db.ChatRoom, senderID string, msg db.ChatMessage, ids []string,
) error {
	if len(ids) == 0 {
		return nil
	}
	threadRootID := ""
	if msg.ThreadRootID.Valid {
		threadRootID = msg.ThreadRootID.String
	}
	var events []audit.Event
	for _, id := range ids {
		if id == senderID {
			continue
		}
		events = append(events, chatNotifyEvent(room, "chat.message.mentioned", msg.ID, threadRootID, id))
	}
	if len(events) == 0 {
		return nil
	}
	return auditRecorder.Emit(ctx, q, Human(senderID), events...)
}

// emitChatMessageNotifications writes, in the send transaction, the durable
// rows the notification consumer turns into inbox items and Web Push: one per
// mentioned member, one for a DM's peer, one per follower of a thread the
// message replies to (H1). The ephemeral chat.mention.created frame stays for
// the open chat page; these reach the person who is not on it.
//
// @all past chatSmallRoomMembers notifies only the members it also names: a
// row per member of a 1,000-person room is spam, and the mention badge still
// counts it. A thread follower the message mentions hears it once, as the
// mention. A thread with more followers than chatSmallRoomMembers is the same
// badge: only the root's author (threadRootAuthorID) gets a row, so a busy
// thread does not write a row per follower under the root's lock nor queue
// them on the workspace's notify lane. Chat messages are not audited
// (OPEN_QUESTIONS A4), hence Emit.
func emitChatMessageNotifications(
	ctx context.Context, q *db.Queries, room db.ChatRoom,
	senderID, messageID, threadRootID, threadRootAuthorID string, m chatMentions,
) error {
	mentioned := mentionNotifiedIDs(m)
	var events []audit.Event
	add := func(topic, userID string) {
		events = append(events, chatNotifyEvent(room, topic, messageID, threadRootID, userID))
	}
	skip := map[string]bool{senderID: true}
	for _, id := range mentioned {
		skip[id] = true
		add("chat.message.mentioned", id)
	}
	if peer, err := dmPeerUserID(room, senderID); err == nil {
		add("chat.dm.received", peer)
	}
	if threadRootID != "" {
		// Muted followers are already left out by the query.
		followers, err := q.ListChatThreadFollowerUserIDs(ctx, threadRootID)
		if err != nil {
			return err
		}
		rest := make([]string, 0, len(followers))
		for _, id := range followers {
			if !skip[id] {
				skip[id] = true
				rest = append(rest, id)
			}
		}
		if len(rest) > chatSmallRoomMembers {
			rest = slices.DeleteFunc(rest, func(id string) bool { return id != threadRootAuthorID })
		}
		for _, id := range rest {
			add("chat.thread.reply_received", id)
		}
	}
	if len(events) == 0 {
		return nil
	}
	return auditRecorder.Emit(ctx, q, Human(senderID), events...)
}

// The notification group keys of a chat: the consumer merges a room's (or a
// thread's) unread messages into one row under them, and reading the chat
// closes that row by the same keys.
func ChatDMNotifyGroup(roomID string) string      { return "chat_room:" + roomID + ":dm" }
func ChatMentionNotifyGroup(roomID string) string { return "chat_room:" + roomID + ":mention" }
func ChatThreadNotifyGroup(rootID string) string  { return "chat_thread:" + rootID + ":reply" }
func ChatCallNotifyGroup(roomID string) string    { return "chat_call:" + roomID }

// voiceCallInvitees is who a call's push rings: a DM's peer, or every other
// member of a group or channel up to chatSmallRoomMembers. A bigger room rings
// only the clients that have it open (chat.voice.invite), as an @all there
// notifies only the names it carries: a phone per member of a large channel
// is spam.
func (s *ChatService) voiceCallInvitees(ctx context.Context, room db.ChatRoom, callerID string) ([]string, error) {
	if room.Kind == chatRoomKindDM {
		peer, err := dmPeerUserID(room, callerID)
		if err != nil {
			return nil, err
		}
		return []string{peer}, nil
	}
	ids, err := s.q.ListChatRoomMemberUserIDs(ctx, room.ID)
	if err != nil {
		return nil, err
	}
	slices.Sort(ids)
	ids = slices.DeleteFunc(slices.Compact(ids), func(id string) bool { return id == "" || id == callerID })
	if len(ids)+1 > chatSmallRoomMembers {
		return nil, nil
	}
	return ids, nil
}

// emitVoiceCallRings writes, in one transaction, the durable row the
// notification consumer turns into a "X đang gọi" push for each invitee (spec
// M3 §2), after closing any ring row a call in this room left open, so the new
// ring opens a fresh row and pushes. The live ring stays the ephemeral
// chat.voice.invite; the invite writes no business row and chat signals are
// not audited (OPEN_QUESTIONS A4) — the call is audited once, when it is logged.
func (s *ChatService) emitVoiceCallRings(ctx context.Context, room db.ChatRoom, callerID, callID string, invitees []string) error {
	if len(invitees) == 0 {
		return nil
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)
	groups := []string{ChatCallNotifyGroup(room.ID)}
	events := make([]audit.Event, 0, len(invitees))
	for _, id := range invitees {
		if err := qtx.MarkNotificationGroupsRead(ctx, db.MarkNotificationGroupsReadParams{UserID: id, GroupKeys: groups}); err != nil {
			return err
		}
		events = append(events, audit.Event{
			Topic: "chat.voice.invite_received", Version: 1,
			Payload:        map[string]string{"room_id": room.ID, "call_id": callID, "user_id": id},
			OrganizationID: room.OrganizationID, WorkspaceID: roomAnchorWorkspaceID(room),
		})
	}
	if err := auditRecorder.Emit(ctx, qtx, Human(callerID), events...); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// closeVoiceCallRings closes the ring rows of people the call no longer rings
// (they answered, or it ended), so a push still queued for them is dropped.
// A push already sent is not recalled. Best effort: the call goes on either way.
func (s *ChatService) closeVoiceCallRings(ctx context.Context, roomID string, userIDs []string) {
	groups := []string{ChatCallNotifyGroup(roomID)}
	for _, id := range userIDs {
		if err := s.q.MarkNotificationGroupsRead(ctx, db.MarkNotificationGroupsReadParams{UserID: id, GroupKeys: groups}); err != nil {
			slog.WarnContext(ctx, "chat: close call ring", "room_id", roomID, "user_id", id, "error", err)
		}
	}
}
