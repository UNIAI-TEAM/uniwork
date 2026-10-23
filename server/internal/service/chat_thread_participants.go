package service

import (
	"context"
	"log/slog"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// attachThreadParticipants sets ThreadParticipantIDs (the thread pill's
// faces, UNI-1908 F5) on each thread root among rows: one query per page,
// none when no row has a reply. The faces are decoration, so a failed read
// leaves them off rather than failing the page.
func (s *ChatService) attachThreadParticipants(ctx context.Context, room db.ChatRoom, rows []ChatMessageRow) {
	var roots []string
	for _, row := range rows {
		if row.ReplyCount > 0 && row.ThreadRootID == nil {
			roots = append(roots, row.ID)
		}
	}
	if len(roots) == 0 {
		return
	}
	got, err := s.q.ListChatThreadParticipants(ctx, db.ListChatThreadParticipantsParams{
		RootIds: roots, RoomID: room.ID, WorkspaceID: roomAnchorWorkspaceID(room),
	})
	if err != nil {
		slog.WarnContext(ctx, "chat: thread participants not read", "room_id", room.ID, "error", err)
		return
	}
	byRoot := make(map[string][]string, len(roots))
	for _, p := range got {
		byRoot[p.ThreadRootID] = append(byRoot[p.ThreadRootID], p.SenderID)
	}
	for i := range rows {
		if ids, ok := byRoot[rows[i].ID]; ok {
			rows[i].ThreadParticipantIDs = ids
		}
	}
}
