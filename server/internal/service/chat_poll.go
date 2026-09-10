package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const chatMessageKindPoll = "poll"

type ChatPollSettings struct {
	DeadlineAt           *string `json:"deadline_at,omitempty"`
	PinToTop             bool    `json:"pin_to_top,omitempty"`
	AllowMultiple        bool    `json:"allow_multiple,omitempty"`
	AllowAddOptions      bool    `json:"allow_add_options,omitempty"`
	HideResultsUntilVote bool    `json:"hide_results_until_vote,omitempty"`
	HideVoters           bool    `json:"hide_voters,omitempty"`
}

type ChatPollOption struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Votes int    `json:"votes"`
}

type ChatPollPayload struct {
	Question    string              `json:"question"`
	Options     []ChatPollOption    `json:"options"`
	Settings    ChatPollSettings    `json:"settings"`
	VotesByUser map[string][]string `json:"votes_by_user,omitempty"`
}

type ChatPollInfo struct {
	Question        string
	Options         []ChatPollOption
	Settings        ChatPollSettings
	ViewerOptionIDs []string
	VotesByUser     map[string][]string
}

type SendPollMessageInput struct {
	Question         string
	Options          []string
	Settings         ChatPollSettings
	ReplyToMessageID *string
}

func pollFromMetadata(kind string, raw []byte, viewerID string) *ChatPollInfo {
	if kind != chatMessageKindPoll || len(raw) == 0 {
		return nil
	}
	meta := decodeChatMessageMetadata(raw)
	if meta.Poll == nil || meta.Poll.Question == "" || len(meta.Poll.Options) < 2 {
		return nil
	}
	viewerKey := strings.ToUpper(strings.TrimSpace(viewerID))
	var viewerOptionIDs []string
	if viewerKey != "" && meta.Poll.VotesByUser != nil {
		viewerOptionIDs = meta.Poll.VotesByUser[viewerKey]
	}
	var votesByUser map[string][]string
	if !meta.Poll.Settings.HideVoters {
		viewerHasVoted := len(viewerOptionIDs) > 0
		if !meta.Poll.Settings.HideResultsUntilVote || viewerHasVoted {
			votesByUser = meta.Poll.VotesByUser
		}
	}
	return &ChatPollInfo{
		Question:        meta.Poll.Question,
		Options:         meta.Poll.Options,
		Settings:        meta.Poll.Settings,
		ViewerOptionIDs: viewerOptionIDs,
		VotesByUser:     votesByUser,
	}
}

func encodePollMetadata(payload ChatPollPayload) ([]byte, error) {
	meta := chatMessageMetadata{Poll: &payload}
	return json.Marshal(meta)
}

func normalizePollOptions(labels []string) []ChatPollOption {
	out := make([]ChatPollOption, 0, len(labels))
	for _, label := range labels {
		label = strings.TrimSpace(label)
		if label == "" {
			continue
		}
		out = append(out, ChatPollOption{
			ID:    util.NewID(),
			Label: label,
			Votes: 0,
		})
	}
	return out
}

func pollIsExpired(settings ChatPollSettings, now time.Time) bool {
	if settings.DeadlineAt == nil {
		return false
	}
	deadlineRaw := strings.TrimSpace(*settings.DeadlineAt)
	if deadlineRaw == "" {
		return false
	}
	deadline, err := time.Parse(time.RFC3339, deadlineRaw)
	if err != nil {
		return false
	}
	return !deadline.After(now)
}

func (s *ChatService) SendPollMessage(
	ctx context.Context, userID, workspaceID, roomID string, in SendPollMessageInput,
) (ChatMessageRow, error) {
	question := strings.TrimSpace(in.Question)
	options := normalizePollOptions(in.Options)
	if question == "" {
		return ChatMessageRow{}, Invalid("câu hỏi bình chọn không được để trống")
	}
	if len(options) < 2 {
		return ChatMessageRow{}, Invalid("cần ít nhất 2 lựa chọn")
	}
	if len(question) > 200 {
		return ChatMessageRow{}, Invalid("câu hỏi bình chọn quá dài")
	}

	room, err := s.authorizeRoom(ctx, userID, workspaceID, roomID)
	if err != nil {
		return ChatMessageRow{}, err
	}
	if err := s.requireCanSendInRoom(ctx, userID, room.ID, room); err != nil {
		return ChatMessageRow{}, err
	}
	if err := s.memberCanPerformRoomAction(ctx, userID, room.ID, room, func(p ChatRoomMemberPermissions) bool {
		return p.AllowCreatePolls
	}); err != nil {
		return ChatMessageRow{}, err
	}

	settings := in.Settings
	if settings.DeadlineAt != nil {
		deadlineRaw := strings.TrimSpace(*settings.DeadlineAt)
		if deadlineRaw == "" {
			settings.DeadlineAt = nil
		} else if deadline, parseErr := time.Parse(time.RFC3339, deadlineRaw); parseErr != nil {
			return ChatMessageRow{}, Invalid("thời hạn bình chọn không hợp lệ")
		} else if !deadline.After(time.Now()) {
			return ChatMessageRow{}, Invalid("thời hạn bình chọn phải ở tương lai")
		} else {
			normalized := deadline.Format(time.RFC3339)
			settings.DeadlineAt = &normalized
		}
	}

	payload := ChatPollPayload{
		Question:    question,
		Options:     options,
		Settings:    settings,
		VotesByUser: map[string][]string{},
	}
	meta, err := encodePollMetadata(payload)
	if err != nil {
		return ChatMessageRow{}, err
	}

	anchorWS := roomAnchorWorkspaceID(room)
	msg, err := s.q.CreateChatPollMessage(ctx, db.CreateChatPollMessageParams{
		ID:          util.NewID(),
		RoomID:      room.ID,
		WorkspaceID: anchorWS,
		SenderID:    userID,
		Body:        question,
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

func (s *ChatService) VoteChatPollMessage(
	ctx context.Context, userID, workspaceID, roomID, messageID, optionID string,
) (ChatMessageRow, error) {
	optionID = strings.TrimSpace(optionID)
	if optionID == "" {
		return ChatMessageRow{}, Invalid("lựa chọn không hợp lệ")
	}
	room, err := s.authorizeRoom(ctx, userID, workspaceID, roomID)
	if err != nil {
		return ChatMessageRow{}, err
	}
	anchorWS := roomAnchorWorkspaceID(room)
	msg, err := s.q.GetChatMessageInRoom(ctx, db.GetChatMessageInRoomParams{
		ID: messageID, RoomID: room.ID, WorkspaceID: anchorWS,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ChatMessageRow{}, ErrNotFound
		}
		return ChatMessageRow{}, err
	}
	if msg.Kind != chatMessageKindPoll {
		return ChatMessageRow{}, Invalid("tin nhắn không phải bình chọn")
	}
	meta := decodeChatMessageMetadata(msg.Metadata)
	if meta.Poll == nil {
		return ChatMessageRow{}, Invalid("dữ liệu bình chọn không hợp lệ")
	}
	if pollIsExpired(meta.Poll.Settings, time.Now()) {
		return ChatMessageRow{}, Invalid("bình chọn đã kết thúc")
	}

	userKey := strings.ToUpper(strings.TrimSpace(userID))
	if meta.Poll.VotesByUser == nil {
		meta.Poll.VotesByUser = map[string][]string{}
	}
	previous := meta.Poll.VotesByUser[userKey]
	optionExists := false
	for _, option := range meta.Poll.Options {
		if option.ID == optionID {
			optionExists = true
			break
		}
	}
	if !optionExists {
		return ChatMessageRow{}, Invalid("lựa chọn không hợp lệ")
	}

	nextVotes := previous
	if meta.Poll.Settings.AllowMultiple {
		found := false
		filtered := make([]string, 0, len(previous))
		for _, id := range previous {
			if id == optionID {
				found = true
				continue
			}
			filtered = append(filtered, id)
		}
		if !found {
			filtered = append(filtered, optionID)
		}
		nextVotes = filtered
	} else {
		if len(previous) == 1 && previous[0] == optionID {
			nextVotes = nil
		} else {
			nextVotes = []string{optionID}
		}
	}

	removed := make(map[string]int)
	for _, id := range previous {
		removed[id]++
	}
	added := make(map[string]int)
	for _, id := range nextVotes {
		added[id]++
	}
	for i := range meta.Poll.Options {
		id := meta.Poll.Options[i].ID
		delta := added[id] - removed[id]
		meta.Poll.Options[i].Votes += delta
		if meta.Poll.Options[i].Votes < 0 {
			meta.Poll.Options[i].Votes = 0
		}
	}
	if len(nextVotes) == 0 {
		delete(meta.Poll.VotesByUser, userKey)
	} else {
		meta.Poll.VotesByUser[userKey] = nextVotes
	}

	updatedMeta, err := json.Marshal(meta)
	if err != nil {
		return ChatMessageRow{}, err
	}
	updated, err := s.q.UpdateChatMessageMetadata(ctx, db.UpdateChatMessageMetadataParams{
		ID: msg.ID, RoomID: room.ID, WorkspaceID: anchorWS, Metadata: updatedMeta,
	})
	if err != nil {
		return ChatMessageRow{}, err
	}
	u, err := s.q.GetUserByID(ctx, msg.SenderID)
	if err != nil {
		return ChatMessageRow{}, err
	}
	s.publishChatRoomEvent(ctx, room.ID, Event{
		Type: "chat.message.updated",
		Payload: map[string]string{
			"room_id":    room.ID,
			"message_id": msg.ID,
		},
	})
	return chatMessageRowFromDBForViewer(updated, u.DisplayName, userID), nil
}
