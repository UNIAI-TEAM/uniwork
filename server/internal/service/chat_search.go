package service

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	minChatSearchQueryRunes = 2
	maxChatSearchQueryRunes = 100
	defaultChatSearchLimit  = 20
	maxChatSearchLimit      = 50
	defaultAroundLimit      = 50
)

type SearchChatMessagesInput struct {
	Query  string
	Limit  int
	Before *time.Time
}

func escapeILIKEPattern(query string) string {
	var b strings.Builder
	for _, r := range query {
		switch r {
		case '\\', '%', '_':
			b.WriteByte('\\')
		}
		b.WriteRune(r)
	}
	return b.String()
}

// SearchRoomMessages finds text messages in a room matching query (does not update last_read_at).
func (s *ChatService) SearchRoomMessages(
	ctx context.Context, userID, workspaceID, roomID string, in SearchChatMessagesInput,
) ([]ChatMessageRow, error) {
	query := strings.TrimSpace(in.Query)
	if utf8.RuneCountInString(query) < minChatSearchQueryRunes {
		return nil, Invalid("từ khóa tìm kiếm quá ngắn")
	}
	if utf8.RuneCountInString(query) > maxChatSearchQueryRunes {
		return nil, Invalid("từ khóa tìm kiếm quá dài")
	}
	room, err := s.authorizeRoomRead(ctx, userID, workspaceID, roomID)
	if err != nil {
		return nil, err
	}
	limit := in.Limit
	if limit <= 0 {
		limit = defaultChatSearchLimit
	}
	if limit > maxChatSearchLimit {
		limit = maxChatSearchLimit
	}
	var before pgtype.Timestamptz
	if in.Before != nil {
		before = pgtype.Timestamptz{Time: *in.Before, Valid: true}
	}
	pattern := "%" + escapeILIKEPattern(query) + "%"
	rows, err := s.q.SearchChatMessagesByRoom(ctx, db.SearchChatMessagesByRoomParams{
		RoomID:        roomID,
		WorkspaceID:   roomAnchorWorkspaceID(room),
		SearchPattern: []byte(pattern),
		BeforeAt:      before,
		ResultLimit:   int32(limit),
	})
	if err != nil {
		return nil, err
	}
	out := make([]ChatMessageRow, 0, len(rows))
	for _, row := range rows {
		out = append(out, chatMessageRowFromSearchRow(row, userID))
	}
	return out, nil
}

// ListRoomMessagesAround returns messages centered on messageID (does not update last_read_at).
func (s *ChatService) ListRoomMessagesAround(
	ctx context.Context, userID, workspaceID, roomID, messageID string, limit int,
) ([]ChatMessageRow, error) {
	room, err := s.authorizeRoomRead(ctx, userID, workspaceID, roomID)
	if err != nil {
		return nil, err
	}
	wsID := roomAnchorWorkspaceID(room)
	target, err := s.q.GetChatMessageInRoom(ctx, db.GetChatMessageInRoomParams{
		ID: messageID, RoomID: roomID, WorkspaceID: wsID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if limit <= 0 {
		limit = defaultAroundLimit
	}
	if limit > maxChatMessageLimit {
		limit = maxChatMessageLimit
	}
	half := limit / 2
	if half < 1 {
		half = 1
	}
	anchorAt := pgtype.Timestamptz{Time: target.CreatedAt.Time, Valid: true}
	beforeRows, err := s.q.ListChatMessagesBeforeOrAtInRoom(ctx, db.ListChatMessagesBeforeOrAtInRoomParams{
		RoomID: roomID, WorkspaceID: wsID, BeforeOrAt: anchorAt, MsgLimit: int32(half),
	})
	if err != nil {
		return nil, err
	}
	afterRows, err := s.q.ListChatMessagesAfterInRoom(ctx, db.ListChatMessagesAfterInRoomParams{
		RoomID: roomID, WorkspaceID: wsID, AfterAt: anchorAt, MsgLimit: int32(half),
	})
	if err != nil {
		return nil, err
	}
	byID := make(map[string]ChatMessageRow, len(beforeRows)+len(afterRows))
	for i := len(beforeRows) - 1; i >= 0; i-- {
		row := chatMessageRowFromBeforeOrAtRow(beforeRows[i], userID)
		byID[row.ID] = row
	}
	for _, row := range afterRows {
		converted := chatMessageRowFromAfterRow(row, userID)
		byID[converted.ID] = converted
	}
	out := make([]ChatMessageRow, 0, len(byID))
	for _, row := range byID {
		out = append(out, row)
	}
	// Sort ASC by created_at.
	for i := 0; i < len(out); i++ {
		for j := i + 1; j < len(out); j++ {
			if out[j].CreatedAt.Before(out[i].CreatedAt) {
				out[i], out[j] = out[j], out[i]
			}
		}
	}
	return out, nil
}

func chatMessageRowFromSearchRow(row db.SearchChatMessagesByRoomRow, viewerID string) ChatMessageRow {
	out := chatMessageRowFromMessageFields(
		row.ID, row.RoomID, row.WorkspaceID, row.SenderID, row.SenderDisplayName,
		row.Kind, row.Body, row.Metadata, row.ReplyToMessageID, row.EditedAt, row.CreatedAt, viewerID,
	)
	out.ClientMsgID = row.ClientMsgID.String
	return out
}

func chatMessageRowFromBeforeOrAtRow(row db.ListChatMessagesBeforeOrAtInRoomRow, viewerID string) ChatMessageRow {
	out := chatMessageRowFromMessageFields(
		row.ID, row.RoomID, row.WorkspaceID, row.SenderID, row.SenderDisplayName,
		row.Kind, row.Body, row.Metadata, row.ReplyToMessageID, row.EditedAt, row.CreatedAt, viewerID,
	)
	out.ClientMsgID = row.ClientMsgID.String
	return out
}

func chatMessageRowFromAfterRow(row db.ListChatMessagesAfterInRoomRow, viewerID string) ChatMessageRow {
	out := chatMessageRowFromMessageFields(
		row.ID, row.RoomID, row.WorkspaceID, row.SenderID, row.SenderDisplayName,
		row.Kind, row.Body, row.Metadata, row.ReplyToMessageID, row.EditedAt, row.CreatedAt, viewerID,
	)
	out.ClientMsgID = row.ClientMsgID.String
	return out
}
