package service

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	defaultCallLogPageSize = 30
	maxCallLogPageSize     = 100
)

// ChatCallLog is one row of the UniChat calls tab: a voice_call_log message
// and the room it was posted in. Call is nil when the log's metadata is
// unreadable; the row still says a call happened there.
type ChatCallLog struct {
	MessageID  string
	RoomID     string
	RoomKind   string
	RoomName   string
	PeerUserID string
	SenderID   string
	SenderName string
	CreatedAt  time.Time
	Call       *VoiceCallLogInfo
}

// ChatCallLogPage is one page, newest first; NextCursor is empty on the last.
type ChatCallLogPage struct {
	Logs       []ChatCallLog
	NextCursor string
}

// ListCallLogs pages the call logs of the rooms the caller sees in this
// workspace's chat (UNI-1833). It reads only: the logs are the messages the
// hangup already wrote. cursor is a previous page's NextCursor.
func (s *ChatService) ListCallLogs(ctx context.Context, userID, workspaceID, cursor string, limit int) (ChatCallLogPage, error) {
	w, err := s.workspaceForChat(ctx, userID, workspaceID)
	if err != nil {
		return ChatCallLogPage{}, err
	}
	if limit <= 0 {
		limit = defaultCallLogPageSize
	}
	limit = min(limit, maxCallLogPageSize)
	params := db.ListChatCallLogsForMemberParams{
		ViewerID: userID, OrganizationID: w.OrganizationID, WorkspaceID: w.ID,
		// One row over the page answers "is there another page".
		RowLimit: int32(limit + 1),
	}
	if cursor != "" {
		at, id, err := decodeFeedCursor(cursor)
		if err != nil {
			return ChatCallLogPage{}, err
		}
		params.CursorAt = pgtype.Timestamptz{Time: at, Valid: true}
		params.CursorID = pgtype.Text{String: id, Valid: true}
	}
	rows, err := s.q.ListChatCallLogsForMember(ctx, params)
	if err != nil {
		return ChatCallLogPage{}, err
	}
	page := ChatCallLogPage{Logs: make([]ChatCallLog, 0, min(len(rows), limit))}
	for i, row := range rows {
		if i == limit {
			last := page.Logs[limit-1]
			page.NextCursor = encodeFeedCursor(last.CreatedAt, last.MessageID)
			break
		}
		page.Logs = append(page.Logs, ChatCallLog{
			MessageID: row.ID, RoomID: row.RoomID, RoomKind: row.RoomKind, RoomName: row.RoomName,
			PeerUserID: row.PeerUserID, SenderID: row.SenderID, SenderName: row.SenderDisplayName,
			CreatedAt: row.CreatedAt.Time,
			Call:      voiceCallLogFromMetadata("voice_call_log", row.Metadata),
		})
	}
	return page, nil
}
