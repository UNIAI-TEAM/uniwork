package service

import (
	"context"
	"encoding/json"
	"regexp"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

var (
	chatMentionMemberPattern = regexp.MustCompile(`mention://member/([A-Z0-9]+)`)
	chatMentionAllPattern    = regexp.MustCompile(`mention://all/all`)
)

func parseMentionUserIDsFromBody(body string) (memberIDs []string, mentionsAll bool) {
	if body == "" {
		return nil, false
	}
	mentionsAll = chatMentionAllPattern.MatchString(body)
	seen := map[string]struct{}{}
	for _, match := range chatMentionMemberPattern.FindAllStringSubmatch(body, -1) {
		if len(match) < 2 {
			continue
		}
		id := strings.ToUpper(strings.TrimSpace(match[1]))
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		memberIDs = append(memberIDs, id)
	}
	sort.Strings(memberIDs)
	return memberIDs, mentionsAll
}

func (s *ChatService) resolveMentionRecipients(
	ctx context.Context,
	senderID string,
	room db.ChatRoom,
	body string,
) ([]string, error) {
	if room.Kind != chatRoomKindWorkspace && room.Kind != chatRoomKindGroup {
		return nil, nil
	}
	memberIDs, mentionsAll := parseMentionUserIDsFromBody(body)
	if !mentionsAll && len(memberIDs) == 0 {
		return nil, nil
	}

	roomMemberIDs, err := s.q.ListChatRoomMemberUserIDs(ctx, room.ID)
	if err != nil {
		return nil, err
	}
	active := make(map[string]struct{}, len(roomMemberIDs))
	for _, id := range roomMemberIDs {
		id = strings.ToUpper(strings.TrimSpace(id))
		if id == "" {
			continue
		}
		active[id] = struct{}{}
	}

	recipients := map[string]struct{}{}
	senderID = strings.ToUpper(strings.TrimSpace(senderID))
	if mentionsAll {
		for id := range active {
			if id != senderID {
				recipients[id] = struct{}{}
			}
		}
	}
	for _, id := range memberIDs {
		if _, ok := active[id]; !ok {
			continue
		}
		if id == senderID {
			continue
		}
		recipients[id] = struct{}{}
	}
	if len(recipients) == 0 {
		return nil, nil
	}
	out := make([]string, 0, len(recipients))
	for id := range recipients {
		out = append(out, id)
	}
	sort.Strings(out)
	return out, nil
}

func mentionedUserIDsFromMetadata(raw []byte) []string {
	meta := decodeChatMessageMetadata(raw)
	if len(meta.MentionedUserIDs) == 0 {
		return nil
	}
	out := make([]string, 0, len(meta.MentionedUserIDs))
	seen := map[string]struct{}{}
	for _, id := range meta.MentionedUserIDs {
		id = strings.ToUpper(strings.TrimSpace(id))
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	if len(out) == 0 {
		return nil
	}
	sort.Strings(out)
	return out
}

func encodeMentionsMetadata(raw []byte, mentionedUserIDs []string) ([]byte, error) {
	meta := decodeChatMessageMetadata(raw)
	meta.MentionedUserIDs = mentionedUserIDs
	if len(meta.Reactions) == 0 && !meta.Pinned && len(meta.MentionedUserIDs) == 0 {
		return []byte("{}"), nil
	}
	return json.Marshal(meta)
}

func messageMentionsCurrentUser(raw []byte, userID string) bool {
	userID = strings.ToUpper(strings.TrimSpace(userID))
	if userID == "" {
		return false
	}
	for _, id := range mentionedUserIDsFromMetadata(raw) {
		if id == userID {
			return true
		}
	}
	return false
}

func (s *ChatService) persistMessageMentions(
	ctx context.Context,
	msg db.ChatMessage,
	mentionedUserIDs []string,
) (db.ChatMessage, error) {
	if len(mentionedUserIDs) == 0 {
		return msg, nil
	}
	meta, err := encodeMentionsMetadata(msg.Metadata, mentionedUserIDs)
	if err != nil {
		return msg, err
	}
	return s.q.UpdateChatMessageMetadata(ctx, db.UpdateChatMessageMetadataParams{
		ID: msg.ID, RoomID: msg.RoomID, WorkspaceID: msg.WorkspaceID, Metadata: meta,
	})
}

func (s *ChatService) publishMentionNotifications(
	ctx context.Context,
	room db.ChatRoom,
	senderID, messageID string,
	mentionedUserIDs []string,
) {
	if len(mentionedUserIDs) == 0 {
		return
	}
	payload := map[string]string{
		"room_id":    room.ID,
		"message_id": messageID,
		"sender_id":  senderID,
	}
	for _, userID := range mentionedUserIDs {
		s.pub.SendToUser(ctx, userID, Event{
			Type:    "chat.mention.created",
			Payload: payload,
		})
	}
}

func (s *ChatService) roomMentionUnread(
	ctx context.Context,
	userID, roomID, anchorWorkspaceID string,
) (int, error) {
	member, err := s.q.GetActiveChatRoomMember(ctx, db.GetActiveChatRoomMemberParams{
		RoomID: roomID, UserID: userID,
	})
	if err != nil {
		return 0, nil
	}
	var since pgtype.Timestamptz
	if member.LastReadAt.Valid {
		since = member.LastReadAt
	}
	rows, err := s.q.ListChatMessagesByRoom(ctx, db.ListChatMessagesByRoomParams{
		RoomID: roomID, WorkspaceID: anchorWorkspaceID, BeforeAt: pgtype.Timestamptz{}, MsgLimit: 500,
	})
	if err != nil {
		return 0, err
	}
	count := 0
	for _, row := range rows {
		if row.SenderID == userID {
			continue
		}
		if since.Valid && !row.CreatedAt.Time.After(since.Time) {
			continue
		}
		if messageMentionsCurrentUser(row.Metadata, userID) {
			count++
		}
	}
	return count, nil
}
