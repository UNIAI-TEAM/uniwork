package service

import (
	"context"
	"encoding/json"
	"strings"
	"unicode/utf8"
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
	Body        string
	PinToTop    bool
	ClientMsgID string
}

func noteFromMetadata(kind string, meta chatMessageMetadata, body string) *ChatNoteInfo {
	if kind != chatMessageKindNote {
		return nil
	}
	content := strings.TrimSpace(body)
	if content == "" {
		return nil
	}
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
	if utf8.RuneCountInString(body) > maxNoteBodyLen {
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

	return s.sendKindMessage(ctx, userID, room, chatMessageKindNote, body, meta, in.ClientMsgID, nil)
}
