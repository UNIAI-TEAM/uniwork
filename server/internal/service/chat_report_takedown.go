package service

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// RemoveReportedMessageQ is the chat side of the operator's takedown
// (AdminService.RemoveReportedMessage, store UGC policy): the reported
// message is soft-deleted whoever sent it, inside the operator's transaction,
// with everything the sender's own deletion does (DeleteChatMessage): its
// file reference released, its thread's reply count dropped, a task comment
// copied from it deleted, and a chat.message.removed row in the report's
// organization. The returned function announces the deletion after commit
// (the change log, then chat.message.deleted); nil when the message was
// already gone. A room outside the report's organization is not found.
func (s *ChatService) RemoveReportedMessageQ(ctx context.Context, q *db.Queries, actorID string, target ReportedMessage) (func(context.Context), error) {
	room, err := q.GetChatRoomByID(ctx, target.RoomID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if room.OrganizationID != target.OrganizationID {
		return nil, ErrNotFound
	}
	deleted, err := q.ModerationRemoveChatMessage(ctx, db.ModerationRemoveChatMessageParams{
		ID: target.MessageID, RoomID: room.ID, OrganizationID: target.OrganizationID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		// Its sender deleted it first (or it never was in this room): nothing left to take down.
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	anchorWS := roomAnchorWorkspaceID(room)
	if err := s.releaseChatMessageFile(ctx, q, deleted); err != nil {
		return nil, err
	}
	if deleted.ThreadRootID.Valid {
		if err := q.DropChatThreadReplyStats(ctx, db.DropChatThreadReplyStatsParams{
			ThreadRootID: deleted.ThreadRootID, RoomID: room.ID, WorkspaceID: anchorWS,
		}); err != nil {
			return nil, err
		}
	}
	if err := deleteCommentCopiedFromMessage(ctx, q, actorID, deleted.ID); err != nil {
		return nil, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: room.OrganizationID,
		WorkspaceID:    anchorWS,
		Actor:          audit.User(actorID),
		Action:         audit.ActionChatMessageRemoved,
		ResourceType:   "chat_message",
		ResourceID:     deleted.ID,
		Metadata:       map[string]any{"room_id": room.ID, "report_id": target.ReportID, "sender_id": deleted.SenderID, "platform_admin": true},
	}); err != nil {
		return nil, err
	}
	return func(ctx context.Context) {
		s.publishChatMessageDeleted(ctx, room, deleted.ID)
		if deleted.ThreadRootID.Valid {
			s.publishChatMessageUpdated(ctx, room, deleted.ThreadRootID.String)
		}
	}, nil
}
