package service

import (
	"context"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// emitChatMessageNotifications writes, in the send transaction, the durable
// rows the notification consumer turns into inbox items and Web Push: one per
// mentioned member, one for a DM's peer, one per follower of a thread the
// message replies to (H1). The ephemeral chat.mention.created frame stays for
// the open chat page; these reach the person who is not on it.
//
// @all past chatSmallRoomMembers notifies only the members it also names: a
// row per member of a 1,000-person room is spam, and the mention badge still
// counts it. A thread follower the message mentions hears it once, as the
// mention. Chat messages are not audited (OPEN_QUESTIONS A4), hence Emit.
func emitChatMessageNotifications(
	ctx context.Context, q *db.Queries, room db.ChatRoom,
	senderID, messageID, threadRootID string, m chatMentions,
) error {
	mentioned := m.Recipients
	// Recipients leave the sender out, so the room is one larger.
	if m.All && len(mentioned)+1 > chatSmallRoomMembers {
		mentioned = m.Named
	}
	var events []audit.Event
	add := func(topic, userID string) {
		p := map[string]string{"room_id": room.ID, "message_id": messageID, "user_id": userID}
		if threadRootID != "" {
			p["thread_root_id"] = threadRootID
		}
		events = append(events, audit.Event{
			Topic: topic, Version: 1, Payload: p,
			OrganizationID: room.OrganizationID, WorkspaceID: roomAnchorWorkspaceID(room),
		})
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
		for _, id := range followers {
			if !skip[id] {
				skip[id] = true
				add("chat.thread.reply_received", id)
			}
		}
	}
	if len(events) == 0 {
		return nil
	}
	return auditRecorder.Emit(ctx, q, Human(senderID), events...)
}
