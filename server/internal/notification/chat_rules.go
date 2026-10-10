package notification

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/outbox"
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
		if _, err := e.q.GetActiveChatRoomMember(ctx, db.GetActiveChatRoomMemberParams{RoomID: room.ID, UserID: userID}); errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		} else if err != nil {
			return nil, err
		}
		wsID := room.WorkspaceID.String
		if wsID == "" {
			// An organization-level DM or group opens from any workspace of
			// the recipient's in that organization.
			if wsID, err = userWorkspaceIn(ctx, e.q, userID, room.OrganizationID); err != nil || wsID == "" {
				return nil, err
			}
		}
		var groupKey string
		switch kind {
		case KindChatDM:
			groupKey = "chat_room:" + room.ID + ":dm"
		case KindChatThreadReplied:
			groupKey = "chat_thread:" + p["thread_root_id"] + ":reply"
		default:
			groupKey = "chat_room:" + room.ID + ":mention"
		}
		r := newRecipients(ctx, e, ev, wsID)
		r.add(userID)
		params := map[string]string{"actor": actorName(ctx, e.q, ev), "room": room.Name}
		return r.drafts(room.OrganizationID, kind, groupKey, "chat_message", msg.ID, params), nil
	}
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
