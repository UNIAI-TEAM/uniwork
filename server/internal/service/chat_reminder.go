package service

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const chatMessageKindReminder = "reminder"

const maxReminderBodyLen = 500

var allowedReminderRepeats = map[string]struct{}{
	"none":    {},
	"daily":   {},
	"weekly":  {},
	"monthly": {},
}

type ChatReminderPayload struct {
	Body     string `json:"body"`
	RemindAt string `json:"remind_at"`
	Repeat   string `json:"repeat"`
}

type ChatReminderInfo struct {
	Body     string
	RemindAt string
	Repeat   string
}

type SendReminderMessageInput struct {
	Body             string
	RemindAt         string
	Repeat           string
	ReplyToMessageID *string
}

func reminderFromMetadata(kind string, raw []byte) *ChatReminderInfo {
	if kind != chatMessageKindReminder || len(raw) == 0 {
		return nil
	}
	meta := decodeChatMessageMetadata(raw)
	if meta.Reminder == nil || strings.TrimSpace(meta.Reminder.Body) == "" {
		return nil
	}
	return &ChatReminderInfo{
		Body:     meta.Reminder.Body,
		RemindAt: meta.Reminder.RemindAt,
		Repeat:   meta.Reminder.Repeat,
	}
}

func encodeReminderMetadata(payload ChatReminderPayload) ([]byte, error) {
	meta := chatMessageMetadata{Reminder: &payload}
	return json.Marshal(meta)
}

func normalizeReminderRepeat(repeat string) string {
	repeat = strings.TrimSpace(strings.ToLower(repeat))
	if repeat == "" {
		return "none"
	}
	if _, ok := allowedReminderRepeats[repeat]; ok {
		return repeat
	}
	return "none"
}

func (s *ChatService) SendReminderMessage(
	ctx context.Context, userID, workspaceID, roomID string, in SendReminderMessageInput,
) (ChatMessageRow, error) {
	body := strings.TrimSpace(in.Body)
	if body == "" {
		return ChatMessageRow{}, Invalid("nội dung nhắc hẹn không được để trống")
	}
	if len(body) > maxReminderBodyLen {
		return ChatMessageRow{}, Invalid("nội dung nhắc hẹn quá dài")
	}

	remindAtRaw := strings.TrimSpace(in.RemindAt)
	if remindAtRaw == "" {
		return ChatMessageRow{}, Invalid("thời gian nhắc hẹn không hợp lệ")
	}
	remindAt, err := time.Parse(time.RFC3339, remindAtRaw)
	if err != nil {
		return ChatMessageRow{}, Invalid("thời gian nhắc hẹn không hợp lệ")
	}
	if !remindAt.After(time.Now()) {
		return ChatMessageRow{}, Invalid("thời gian nhắc hẹn phải ở tương lai")
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

	repeat := normalizeReminderRepeat(in.Repeat)
	payload := ChatReminderPayload{
		Body:     body,
		RemindAt: remindAt.Format(time.RFC3339),
		Repeat:   repeat,
	}
	meta, err := encodeReminderMetadata(payload)
	if err != nil {
		return ChatMessageRow{}, err
	}

	anchorWS := roomAnchorWorkspaceID(room)
	msg, err := s.q.CreateChatReminderMessage(ctx, db.CreateChatReminderMessageParams{
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
