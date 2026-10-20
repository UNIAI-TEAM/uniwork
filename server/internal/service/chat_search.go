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
	// The query compares against uw_fold_search(body), so "hop" finds "Họp".
	pattern := "%" + escapeILIKEPattern(foldForSearch(query)) + "%"
	rows, err := s.q.SearchChatMessagesByRoom(ctx, db.SearchChatMessagesByRoomParams{
		RoomID:        roomID,
		WorkspaceID:   roomAnchorWorkspaceID(room),
		SearchPattern: pattern,
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
	s.signChatMedia(ctx, room, out)
	s.resolveChatDocuments(ctx, room, out, userID)
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
	// A thread reply never shows on the main timeline: center on its root.
	// If the root is gone, keep the reply's instant but leave the reply out.
	center := target
	if target.ThreadRootID.Valid {
		root, err := s.q.GetChatMessageInRoom(ctx, db.GetChatMessageInRoomParams{
			ID: target.ThreadRootID.String, RoomID: roomID, WorkspaceID: wsID,
		})
		if err == nil {
			center = root
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
	}
	at := pgtype.Timestamptz{Time: center.CreatedAt.Time, Valid: true}
	older, err := s.q.ListChatMessagesByRoom(ctx, db.ListChatMessagesByRoomParams{
		RoomID: roomID, WorkspaceID: wsID, BeforeAt: at, BeforeID: center.ID, MsgLimit: int32(half),
	})
	if err != nil {
		return nil, err
	}
	newer, err := s.q.ListChatMessagesByRoomAfter(ctx, db.ListChatMessagesByRoomAfterParams{
		RoomID: roomID, WorkspaceID: wsID, AfterAt: at, AfterID: center.ID, MsgLimit: int32(half),
	})
	if err != nil {
		return nil, err
	}
	out := make([]ChatMessageRow, 0, len(older)+1+len(newer))
	for i := len(older) - 1; i >= 0; i-- {
		out = append(out, chatMessageRowFromListRow(older[i], userID))
	}
	if !center.ThreadRootID.Valid {
		u, err := s.q.GetUserByID(ctx, center.SenderID)
		if err != nil {
			return nil, err
		}
		out = append(out, chatMessageRowFromDBForViewer(center, u.DisplayName, userID))
	}
	for _, row := range newer {
		out = append(out, chatMessageRowFromListRow(db.ListChatMessagesByRoomRow(row), userID))
	}
	s.signChatMedia(ctx, room, out)
	s.resolveChatDocuments(ctx, room, out, userID)
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
