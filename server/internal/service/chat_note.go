package service

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const chatMessageKindNote = "note"

const maxNoteBodyLen = 2000

type ChatNotePayload struct {
	PinToTop bool `json:"pin_to_top,omitempty"`
}

type ChatNoteInfo struct {
	Body     string
	PinToTop bool
}

type SendNoteMessageInput struct {
	Body             string
	PinToTop         bool
	ReplyToMessageID *string
}

func noteFromMetadata(kind string, raw []byte, body string) *ChatNoteInfo {
	if kind != chatMessageKindNote {
		return nil
	}
	content := strings.TrimSpace(body)
	if content == "" {
		return nil
	}
	meta := decodeChatMessageMetadata(raw)
	pinToTop := meta.Pinned
	if meta.Note != nil && meta.Note.PinToTop {
		pinToTop = true
	}
	return &ChatNoteInfo{
		Body:     content,
		PinToTop: pinToTop,
	}
}

func encodeNoteMetadata(pinToTop bool) ([]byte, error) {
	meta := chatMessageMetadata{
		Note: &ChatNotePayload{PinToTop: pinToTop},
	}
	if pinToTop {
		meta.Pinned = true
	}
	return json.Marshal(meta)
}

func (s *ChatService) SendNoteMessage(
	ctx context.Context, userID, workspaceID, roomID string, in SendNoteMessageInput,
) (ChatMessageRow, error) {
	body := strings.TrimSpace(in.Body)
	if body == "" {
		return ChatMessageRow{}, Invalid("nội dung ghi chú không được để trống")
	}
	if len(body) > maxNoteBodyLen {
		return ChatMessageRow{}, Invalid("nội dung ghi chú quá dài")
	}

	room, err := s.authorizeRoom(ctx, userID, workspaceID, roomID)
	if err != nil {
		return ChatMessageRow{}, err
	}
	if err := s.requireCanSendInRoom(ctx, userID, room.ID, room); err != nil {
		return ChatMessageRow{}, err
	}
	if err := s.memberCanPerformRoomAction(ctx, userID, room.ID, room, func(p ChatRoomMemberPermissions) bool {
		return p.AllowCreateNotes
	}); err != nil {
		return ChatMessageRow{}, err
	}
	if in.PinToTop {
		if err := s.memberCanPerformRoomAction(ctx, userID, room.ID, room, func(p ChatRoomMemberPermissions) bool {
			return p.AllowPinContent
		}); err != nil {
			return ChatMessageRow{}, err
		}
	}

	meta, err := encodeNoteMetadata(in.PinToTop)
	if err != nil {
		return ChatMessageRow{}, err
	}

	anchorWS := roomAnchorWorkspaceID(room)
	msg, err := s.q.CreateChatNoteMessage(ctx, db.CreateChatNoteMessageParams{
		ID:          util.NewID(),
		RoomID:      room.ID,
		WorkspaceID: anchorWS,
		SenderID:    userID,
		Body:        body,
		Metadata:    meta,
	})
	if err != nil {
		return ChatMessageRow{}, err
	}

	u, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return ChatMessageRow{}, err
	}
	createdAt := msg.CreatedAt.Time
	_ = s.q.UpdateChatRoomMemberLastRead(ctx, db.UpdateChatRoomMemberLastReadParams{
		RoomID: room.ID, UserID: userID, LastReadAt: pgtype.Timestamptz{Time: createdAt, Valid: true},
	})
	_ = s.q.TouchChatRoomUpdatedAt(ctx, room.ID)
	ev := Event{
		Type: "chat.message.created",
		Payload: map[string]string{
			"room_id":    room.ID,
			"message_id": msg.ID,
		},
	}
	switch room.Kind {
	case chatRoomKindWorkspace:
		s.pub.Publish(ctx, anchorWS, ev)
	default:
		s.publishChatRoomEvent(ctx, room.ID, ev)
		s.publishChatRoomActivity(ctx, room.ID)
	}
	return chatMessageRowFromDBForViewer(msg, u.DisplayName, userID), nil
}
