package notification

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/outbox"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// chatMessageRule turns one durable chat row (ChatService writes one per
// recipient in the send transaction) into a draft. Everything is re-read at
// delivery: a message deleted, or a recipient who left the room, since the
// send gets nothing, and no message text is stored (titles name the sender
// and the room only). The group key is the room - the thread for replies -
// so unread messages merge into one row and one push.
func chatMessageRule(kind string) rule {
	return func(ctx context.Context, e env, ev outbox.Row, p map[string]string) ([]Draft, error) {
		userID, roomID, msgID := p["user_id"], p["room_id"], p["message_id"]
		if userID == "" || roomID == "" || msgID == "" {
			return nil, nil
		}
		msg, err := e.q.GetChatMessageByID(ctx, msgID)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		if msg.DeletedAt.Valid || msg.RoomID != roomID {
			return nil, nil
		}
		room, err := e.q.GetChatRoomByID(ctx, roomID)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		// GetChatRoomByID is by-id: the room must belong to the event's tenant.
		if ev.OrganizationID.Valid && room.OrganizationID != ev.OrganizationID.String {
			return nil, nil
		}
		// A public channel's thread can be followed without joining (authorizeRoomRead);
		// the send-time follower query admits those readers too (UNI-1721).
		publicThread := kind == KindChatThreadReplied && room.Kind == "channel" && room.Visibility == "public"
		mem, err := e.q.GetActiveChatRoomMember(ctx, db.GetActiveChatRoomMemberParams{RoomID: room.ID, UserID: userID})
		if errors.Is(err, pgx.ErrNoRows) {
			if !publicThread {
				return nil, nil
			}
		} else if err != nil {
			return nil, err
		} else if mem.NotificationsMuted {
			// Read at delivery, so a mute set after the send still holds (UNI-1697).
			return nil, nil
		}
		wsID, err := chatRecipientWorkspace(ctx, e, room, userID)
		if err != nil || wsID == "" {
			return nil, err
		}
		var groupKey string
		switch kind {
		case KindChatDM:
			groupKey = service.ChatDMNotifyGroup(room.ID)
		case KindChatThreadReplied:
			groupKey = service.ChatThreadNotifyGroup(p["thread_root_id"])
		default:
			groupKey = service.ChatMentionNotifyGroup(room.ID)
		}
		r := newRecipients(ctx, e, ev, wsID)
		r.add(userID)
		params := map[string]string{"actor": actorName(ctx, e.q, ev), "room": room.Name}
		return r.drafts(room.OrganizationID, kind, groupKey, "chat_message", msg.ID, params)
	}
}

// callRingWindow is how long a ring is worth a push: the push's TTL, past the
// 45 s a client rings for (voice-call-overlay-types.ts).
const callRingWindow = 60 * time.Second

// ruleChatVoiceInviteReceived rings one invitee's devices (spec M3 §2): a
// ringing call, read at delivery, so a row the lane reaches after the window,
// for someone who already answered or joined, or for a call that ended, gets
// nothing. A DM peer who hid the conversation is still rung, as the realtime
// invite and the pending-invite list ring them; a muted room is not.
func ruleChatVoiceInviteReceived(ctx context.Context, e env, ev outbox.Row, p map[string]string) ([]Draft, error) {
	userID, roomID, callID := p["user_id"], p["room_id"], p["call_id"]
	if userID == "" || roomID == "" || callID == "" {
		return nil, nil
	}
	if ev.CreatedAt.Valid && time.Since(ev.CreatedAt.Time) > callRingWindow {
		return nil, nil
	}
	if e.calls != nil && !e.calls.VoiceCallRinging(roomID, callID, userID) {
		return nil, nil
	}
	room, err := e.q.GetChatRoomByID(ctx, roomID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	// GetChatRoomByID is by-id: the room must belong to the event's tenant.
	if ev.OrganizationID.Valid && room.OrganizationID != ev.OrganizationID.String {
		return nil, nil
	}
	mem, err := e.q.GetActiveChatRoomMember(ctx, db.GetActiveChatRoomMemberParams{RoomID: room.ID, UserID: userID})
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		if room.Kind != "dm" {
			return nil, nil
		}
	case err != nil:
		return nil, err
	case mem.NotificationsMuted:
		return nil, nil
	}
	wsID, err := chatRecipientWorkspace(ctx, e, room, userID)
	if err != nil || wsID == "" {
		return nil, err
	}
	r := newRecipients(ctx, e, ev, wsID)
	r.add(userID)
	params := map[string]string{"actor": actorName(ctx, e.q, ev), "room": room.Name, "call_id": callID}
	return r.drafts(room.OrganizationID, KindChatCallIncoming, service.ChatCallNotifyGroup(room.ID), "chat_room", room.ID, params)
}

// chatRecipientWorkspace is the workspace a chat notification for userID
// links to. A channel belongs to its workspace. A DM or group belongs to the
// organization and is only stamped with the creator's workspace, so a
// recipient outside it gets one of their own; the workspace gate the caller
// runs on the result still refuses deactivated and suspended members.
func chatRecipientWorkspace(ctx context.Context, e env, room db.ChatRoom, userID string) (string, error) {
	anchor := room.WorkspaceID.String
	if anchor != "" && room.Kind != "dm" && room.Kind != "group" {
		return anchor, nil
	}
	if anchor != "" {
		if _, err := e.members.RequireMember(ctx, anchor, userID); err == nil {
			return anchor, nil
		} else if err != nil && !refused(err) {
			return "", err
		}
	}
	return userWorkspaceIn(ctx, e.q, userID, room.OrganizationID)
}

func userWorkspaceIn(ctx context.Context, q *db.Queries, userID, orgID string) (string, error) {
	workspaces, err := q.ListWorkspacesForUser(ctx, userID)
	if err != nil {
		return "", err
	}
	for _, w := range workspaces {
		if w.OrganizationID == orgID {
			return w.ID, nil
		}
	}
	return "", nil
}
