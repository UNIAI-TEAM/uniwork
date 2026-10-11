package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"slices"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/mentions"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

var chatMentionAllPattern = regexp.MustCompile(`mention://all/all`)

func parseMentionUserIDsFromBody(body string) (memberIDs []string, mentionsAll bool) {
	if body == "" {
		return nil, false
	}
	// The member-link grammar is shared (chat_mentions delegates); the
	// room-wide mention stays chat-local.
	return mentions.MemberIDs(body), chatMentionAllPattern.MatchString(body)
}

// chatSmallRoomMembers is the room size up to which every member may use
// @all and add people to a group; past it only the room's moderators may.
// Both fan out one frame per member. A var so tests can shrink it.
var chatSmallRoomMembers = 50

func errChatMentionAllForbidden() error {
	return coded(http.StatusForbidden, "chat_mention_all_forbidden", "chỉ quản trị phòng mới được nhắc @all trong phòng đông người")
}

// requireMayNotifyRoom refuses a message that notifies every member (@all, a
// reminder) from a non-moderator once the room is past chatSmallRoomMembers.
func (s *ChatService) requireMayNotifyRoom(ctx context.Context, senderID string, room db.ChatRoom, members int) error {
	if members <= chatSmallRoomMembers {
		return nil
	}
	ok, err := s.isChatRoomModerator(ctx, senderID, room)
	if err != nil {
		return err
	}
	if !ok {
		return errChatMentionAllForbidden()
	}
	return nil
}

// chatMentions is who a message mentions: the members it names, and whether
// it says @all. Recipients is everyone to notify.
type chatMentions struct {
	Named      []string
	All        bool
	Recipients []string
}

// resolveMentionRecipients reads the mentions in body. It refuses @all from a
// non-moderator in a room past chatSmallRoomMembers, so callers run it before
// writing the message.
func (s *ChatService) resolveMentionRecipients(
	ctx context.Context,
	senderID string,
	room db.ChatRoom,
	body string,
) (chatMentions, error) {
	if room.Kind != chatRoomKindWorkspace && room.Kind != chatRoomKindChannel && room.Kind != chatRoomKindGroup {
		return chatMentions{}, nil
	}
	memberIDs, mentionsAll := parseMentionUserIDsFromBody(body)
	if !mentionsAll && len(memberIDs) == 0 {
		return chatMentions{}, nil
	}

	roomMemberIDs, err := s.q.ListChatRoomMemberUserIDs(ctx, room.ID)
	if err != nil {
		return chatMentions{}, err
	}
	if mentionsAll {
		if err := s.requireMayNotifyRoom(ctx, senderID, room, len(roomMemberIDs)); err != nil {
			return chatMentions{}, err
		}
	}
	active := make(map[string]struct{}, len(roomMemberIDs))
	for _, id := range roomMemberIDs {
		id = strings.ToUpper(strings.TrimSpace(id))
		if id == "" {
			continue
		}
		active[id] = struct{}{}
	}

	named := map[string]struct{}{}
	senderID = strings.ToUpper(strings.TrimSpace(senderID))
	for _, id := range memberIDs {
		if _, ok := active[id]; !ok {
			continue
		}
		if id == senderID {
			continue
		}
		named[id] = struct{}{}
	}
	recipients := named
	if mentionsAll {
		recipients = map[string]struct{}{}
		for id := range active {
			if id != senderID {
				recipients[id] = struct{}{}
			}
		}
	}
	return chatMentions{Named: sortedIDs(named), All: mentionsAll, Recipients: sortedIDs(recipients)}, nil
}

func sortedIDs(set map[string]struct{}) []string {
	if len(set) == 0 {
		return nil
	}
	out := make([]string, 0, len(set))
	for id := range set {
		out = append(out, id)
	}
	sort.Strings(out)
	return out
}

// isChatRoomModerator is canModerateChatRoom with its own lookups.
func (s *ChatService) isChatRoomModerator(ctx context.Context, userID string, room db.ChatRoom) (bool, error) {
	member, err := s.q.GetActiveChatRoomMember(ctx, db.GetActiveChatRoomMemberParams{
		RoomID: room.ID, UserID: userID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	var wsMember db.WorkspaceMember
	if isWorkspaceDefaultRoom(room) {
		if wsMember, err = s.ws.RequireMember(ctx, roomAnchorWorkspaceID(room), userID); err != nil {
			return false, err
		}
	}
	return canModerateChatRoom(userID, member, room, wsMember), nil
}

// mentionedUserIDsForViewer is the mention list a viewer gets: the named
// members, plus the viewer when the message says @all and they did not send
// it. Storing the flag instead of every member's id keeps a 1,000-person
// @all to a few bytes.
func mentionedUserIDsForViewer(meta chatMessageMetadata, senderID, viewerID string) []string {
	ids := mentionedUserIDsFromMetadata(meta)
	viewerID = strings.ToUpper(strings.TrimSpace(viewerID))
	if viewerID == "" || viewerID == strings.ToUpper(strings.TrimSpace(senderID)) || !meta.MentionsAll {
		return ids
	}
	if slices.Contains(ids, viewerID) {
		return ids
	}
	return append(ids, viewerID)
}

func mentionedUserIDsFromMetadata(meta chatMessageMetadata) []string {
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

func encodeMentionsMetadata(raw []byte, m chatMentions) ([]byte, error) {
	meta := decodeChatMessageMetadata(raw)
	meta.MentionedUserIDs = m.Named
	meta.MentionsAll = m.All
	if len(meta.Reactions) == 0 && !meta.Pinned && len(meta.MentionedUserIDs) == 0 && !meta.MentionsAll &&
		meta.Priority == "" && meta.Poll == nil && meta.Reminder == nil && meta.Note == nil && meta.Post == nil {
		return []byte("{}"), nil
	}
	return json.Marshal(meta)
}

// messageMentionsCurrentUser reports whether a message mentions userID; an
// @all mentions every member (callers skip the sender's own messages).
func messageMentionsCurrentUser(raw []byte, userID string) bool {
	userID = strings.ToUpper(strings.TrimSpace(userID))
	if userID == "" {
		return false
	}
	meta := decodeChatMessageMetadata(raw)
	if meta.MentionsAll {
		return true
	}
	for _, id := range mentionedUserIDsFromMetadata(meta) {
		if id == userID {
			return true
		}
	}
	return false
}

func (s *ChatService) persistMessageMentions(
	ctx context.Context,
	q *db.Queries,
	msg db.ChatMessage,
	m chatMentions,
) (db.ChatMessage, error) {
	if len(m.Recipients) == 0 && !m.All {
		return msg, nil
	}
	meta, err := encodeMentionsMetadata(msg.Metadata, m)
	if err != nil {
		return msg, err
	}
	return q.UpdateChatMessageMetadata(ctx, db.UpdateChatMessageMetadataParams{
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
	s.pub.SendToUsers(ctx, mentionedUserIDs, Event{
		Type: "chat.mention.created",
		Payload: map[string]string{
			"room_id":    room.ID,
			"message_id": messageID,
			"sender_id":  senderID,
		},
	})
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
	// Same bound as the sidebar: a member who never read counts from joining.
	since := member.JoinedAt
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
