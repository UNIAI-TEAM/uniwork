package service

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const chatMessageKindPost = "post"

const (
	maxPostTitleLen = 200
	maxPostBodyLen  = 8000
)

// ChatPostPayload is stored under metadata.post.
type ChatPostPayload struct {
	Title    string `json:"title"`
	PinToTop bool   `json:"pin_to_top,omitempty"`
}

// ChatPostInfo is the view-model for a post message.
type ChatPostInfo struct {
	Title    string
	Body     string
	PinToTop bool
}

// SendPostMessageInput creates an announcement-style post in a chat room.
type SendPostMessageInput struct {
	Title            string
	Body             string
	PinToTop         bool
	ReplyToMessageID *string
}

func postFromMetadata(kind string, raw []byte, body string) *ChatPostInfo {
	if kind != chatMessageKindPost {
		return nil
	}
	content := strings.TrimSpace(body)
	meta := decodeChatMessageMetadata(raw)
	title := ""
	pinToTop := meta.Pinned
	if meta.Post != nil {
		title = strings.TrimSpace(meta.Post.Title)
		if meta.Post.PinToTop {
			pinToTop = true
		}
	}
	if title == "" && content == "" {
		return nil
	}
	return &ChatPostInfo{
		Title:    title,
		Body:     content,
		PinToTop: pinToTop,
	}
}

func encodePostMetadata(title string, pinToTop bool) ([]byte, error) {
	meta := chatMessageMetadata{
		Post: &ChatPostPayload{Title: title, PinToTop: pinToTop},
	}
	if pinToTop {
		meta.Pinned = true
	}
	return json.Marshal(meta)
}

func (s *ChatService) SendPostMessage(
	ctx context.Context, userID, workspaceID, roomID string, in SendPostMessageInput,
) (ChatMessageRow, error) {
	title := strings.TrimSpace(in.Title)
	body := strings.TrimSpace(in.Body)
	if title == "" {
		return ChatMessageRow{}, Invalid("tiêu đề bài đăng không được để trống")
	}
	if len(title) > maxPostTitleLen {
		return ChatMessageRow{}, Invalid("tiêu đề bài đăng quá dài")
	}
	if body == "" {
		return ChatMessageRow{}, Invalid("nội dung bài đăng không được để trống")
	}
	if len(body) > maxPostBodyLen {
		return ChatMessageRow{}, Invalid("nội dung bài đăng quá dài")
	}

	room, err := s.authorizeRoom(ctx, userID, workspaceID, roomID)
	if err != nil {
		return ChatMessageRow{}, err
	}
	if err := s.requireCanSendInRoom(ctx, userID, room.ID, room); err != nil {
		return ChatMessageRow{}, err
	}
	// Posts share the notes gate until a dedicated allow_create_posts lands.
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

	meta, err := encodePostMetadata(title, in.PinToTop)
	if err != nil {
		return ChatMessageRow{}, err
	}

	anchorWS := roomAnchorWorkspaceID(room)
	msg, err := s.q.CreateChatPostMessage(ctx, db.CreateChatPostMessageParams{
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
	case chatRoomKindWorkspace, chatRoomKindChannel:
		s.pub.Publish(ctx, anchorWS, ev)
	default:
		s.publishChatRoomEvent(ctx, room.ID, ev)
		s.publishChatRoomActivity(ctx, room.ID)
	}
	return chatMessageRowFromDBForViewer(msg, u.DisplayName, userID), nil
}
