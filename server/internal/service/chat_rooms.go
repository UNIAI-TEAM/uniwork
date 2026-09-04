package service

import (
	"context"
	"errors"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	chatRoomKindDM    = "dm"
	chatRoomKindGroup = "group"
)

// ChatRoomSummary is a dm or group room visible to the caller.
type ChatRoomSummary struct {
	ID              string
	Kind            string
	Name            string
	WorkspaceID     string
	MemberUserIDs   []string
	UnreadCount     int
	PeerUserID      string
	PeerEmail       string
	PeerDisplayName string
}

type CreateGroupInput struct {
	Name          string
	MemberUserIDs []string
}

// ListChatRooms returns dm, group, and workspace rooms for a workspace member.
func (s *ChatService) ListChatRooms(ctx context.Context, userID, workspaceID string) ([]ChatRoomSummary, error) {
	w, err := s.workspaceForChat(ctx, userID, workspaceID)
	if err != nil {
		return nil, err
	}
	out := make([]ChatRoomSummary, 0)

	wsRoom, err := s.q.GetWorkspaceChatRoom(ctx, pgtype.Text{String: workspaceID, Valid: true})
	if err == nil {
		unread, uErr := s.roomUnread(ctx, userID, wsRoom.ID, workspaceID)
		if uErr != nil {
			return nil, uErr
		}
		out = append(out, ChatRoomSummary{
			ID: wsRoom.ID, Kind: chatRoomKindWorkspace, Name: wsRoom.Name,
			WorkspaceID: workspaceID, UnreadCount: unread,
		})
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}

	blockedPeers := map[string]struct{}{}
	if blockedIDs, err := s.q.ListChatBlockedPeerIDs(ctx, db.ListChatBlockedPeerIDsParams{
		OrganizationID: w.OrganizationID, BlockerID: userID,
	}); err != nil {
		return nil, err
	} else {
		for _, id := range blockedIDs {
			blockedPeers[strings.ToUpper(strings.TrimSpace(id))] = struct{}{}
		}
	}

	rows, err := s.q.ListChatRoomsForMember(ctx, db.ListChatRoomsForMemberParams{
		UserID: userID, OrganizationID: pgtype.Text{String: w.OrganizationID, Valid: true},
	})
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		if row.Kind == chatRoomKindDM && !s.userInVoiceRoomMemberSet(db.ChatRoom{
			Kind: row.Kind, MemberSetKey: row.MemberSetKey,
		}, userID) {
			continue
		}
		anchorWS := workspaceID
		if row.WorkspaceID.Valid {
			anchorWS = row.WorkspaceID.String
		}
		memberSetKey := ""
		if row.MemberSetKey.Valid {
			memberSetKey = row.MemberSetKey.String
		}
		summary, err := s.roomSummary(ctx, userID, anchorWS, row.ID, row.Kind, row.Name, chatUnreadCount(row.UnreadCount), memberSetKey)
		if err != nil {
			return nil, err
		}
		if summary.Kind == chatRoomKindDM && summary.PeerUserID != "" {
			if _, blocked := blockedPeers[strings.ToUpper(summary.PeerUserID)]; blocked {
				continue
			}
		}
		out = append(out, summary)
	}
	return out, nil
}

func (s *ChatService) roomUnread(ctx context.Context, userID, roomID, anchorWorkspaceID string) (int, error) {
	member, err := s.q.GetActiveChatRoomMember(ctx, db.GetActiveChatRoomMemberParams{
		RoomID: roomID, UserID: userID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	if err != nil {
		return 0, err
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
		count++
	}
	return count, nil
}

// ResolveDM finds or creates a 1:1 dm room scoped to the workspace organization.
func (s *ChatService) ResolveDM(ctx context.Context, userID, workspaceID, targetUserID string) (ChatRoomSummary, error) {
	targetUserID = strings.ToUpper(strings.TrimSpace(targetUserID))
	if targetUserID == "" {
		return ChatRoomSummary{}, Invalid("user id is required")
	}
	if targetUserID == userID {
		return ChatRoomSummary{}, Invalid("không thể nhắn tin với chính mình")
	}
	w, err := s.workspaceForChat(ctx, userID, workspaceID)
	if err != nil {
		return ChatRoomSummary{}, err
	}
	if err := s.requireOrgPeer(ctx, w.OrganizationID, targetUserID); err != nil {
		return ChatRoomSummary{}, err
	}
	key := memberSetKey([]string{userID, targetUserID})
	room, err := s.q.GetChatRoomByKindAndMemberSet(ctx, db.GetChatRoomByKindAndMemberSetParams{
		OrganizationID: pgtype.Text{String: w.OrganizationID, Valid: true},
		Kind:           chatRoomKindDM,
		MemberSetKey:   pgtype.Text{String: key, Valid: true},
	})
	if errors.Is(err, pgx.ErrNoRows) {
		peer, err := s.q.GetUserByID(ctx, targetUserID)
		if err != nil {
			return ChatRoomSummary{}, err
		}
		name := strings.TrimSpace(peer.DisplayName)
		if name == "" {
			name = peer.Email
		}
		room, err = s.createChatRoom(ctx, userID, w.OrganizationID, workspaceID, chatRoomKindDM, name, key, []string{userID, targetUserID})
		if err != nil {
			return ChatRoomSummary{}, err
		}
	} else if err != nil {
		return ChatRoomSummary{}, err
	}
	if err := s.ensureExistingRoomAccess(ctx, room, userID, targetUserID); err != nil {
		return ChatRoomSummary{}, err
	}
	return s.roomSummary(ctx, userID, roomAnchorWorkspaceID(room), room.ID, room.Kind, room.Name, 0, memberSetKeyFromRoom(room))
}

// CreateGroup finds or creates a multi-person group room scoped to the organization.
func (s *ChatService) CreateGroup(ctx context.Context, userID, workspaceID string, in CreateGroupInput) (ChatRoomSummary, error) {
	w, err := s.workspaceForChat(ctx, userID, workspaceID)
	if err != nil {
		return ChatRoomSummary{}, err
	}
	name := strings.TrimSpace(in.Name)
	memberIDs := normalizeUserIDs(in.MemberUserIDs)
	if len(memberIDs) < 2 {
		return ChatRoomSummary{}, Invalid("nhóm cần ít nhất 2 thành viên")
	}
	for _, id := range memberIDs {
		if err := s.requireOrgPeer(ctx, w.OrganizationID, id); err != nil {
			return ChatRoomSummary{}, err
		}
	}
	allIDs := uniqueUserIDs(append(memberIDs, userID))
	if len(allIDs) < 3 {
		return ChatRoomSummary{}, Invalid("nhóm cần ít nhất 2 thành viên khác bạn")
	}
	key := memberSetKey(allIDs)
	room, err := s.q.GetChatRoomByKindAndMemberSet(ctx, db.GetChatRoomByKindAndMemberSetParams{
		OrganizationID: pgtype.Text{String: w.OrganizationID, Valid: true},
		Kind:           chatRoomKindGroup,
		MemberSetKey:   pgtype.Text{String: key, Valid: true},
	})
	if errors.Is(err, pgx.ErrNoRows) {
		if name == "" {
			name = defaultGroupNameFromUsers(ctx, s.q, memberIDs)
		}
		room, err = s.createChatRoom(ctx, userID, w.OrganizationID, workspaceID, chatRoomKindGroup, name, key, allIDs)
		if err != nil {
			return ChatRoomSummary{}, err
		}
	} else if err != nil {
		return ChatRoomSummary{}, err
	}
	if err := s.ensureExistingRoomAccess(ctx, room, userID); err != nil {
		return ChatRoomSummary{}, err
	}
	return s.roomSummary(ctx, userID, roomAnchorWorkspaceID(room), room.ID, room.Kind, room.Name, 0, memberSetKeyFromRoom(room))
}
func (s *ChatService) InviteGroupMembers(ctx context.Context, userID, workspaceID, roomID string, memberUserIDs []string) (ChatRoomSummary, error) {
	room, err := s.authorizeRoom(ctx, userID, workspaceID, roomID)
	if err != nil {
		return ChatRoomSummary{}, err
	}
	if room.Kind != chatRoomKindGroup {
		return ChatRoomSummary{}, Invalid("chỉ có thể mời thành viên vào nhóm chat")
	}
	orgID := roomOrganizationID(room)
	anchorWS := roomAnchorWorkspaceID(room)
	ids := normalizeUserIDs(memberUserIDs)
	if len(ids) == 0 {
		return ChatRoomSummary{}, Invalid("cần ít nhất một thành viên để mời")
	}
	for _, id := range ids {
		if id == userID {
			continue
		}
		if err := s.requireOrgPeer(ctx, orgID, id); err != nil {
			return ChatRoomSummary{}, err
		}
		if err := s.ensureRoomMember(ctx, roomID, anchorWS, id, "member"); err != nil {
			return ChatRoomSummary{}, err
		}
	}
	_ = s.q.TouchChatRoomUpdatedAt(ctx, roomID)
	s.publishChatRoomMembersEvent(ctx, roomID, Event{
		Type: "chat.room.updated", Payload: map[string]string{"room_id": roomID},
	})
	return s.roomSummary(ctx, userID, anchorWS, room.ID, room.Kind, room.Name, 0, memberSetKeyFromRoom(room))
}

// LeaveChatRoom marks the caller as left for a dm or group room.
func (s *ChatService) LeaveChatRoom(ctx context.Context, userID, workspaceID, roomID string) error {
	room, err := s.authorizeRoom(ctx, userID, workspaceID, roomID)
	if err != nil {
		return err
	}
	if room.Kind == chatRoomKindWorkspace {
		return Invalid("không thể rời phòng workspace")
	}
	if err := s.q.LeaveChatRoomMember(ctx, db.LeaveChatRoomMemberParams{
		RoomID: roomID, UserID: userID,
	}); err != nil {
		return err
	}
	s.publishChatRoomMembersEvent(ctx, roomID, Event{
		Type: "chat.room.updated", Payload: map[string]string{"room_id": roomID},
	})
	return nil
}

func (s *ChatService) createChatRoom(
	ctx context.Context,
	creatorID, orgID, anchorWorkspaceID, kind, name, memberSetKey string,
	allMemberIDs []string,
) (db.ChatRoom, error) {
	roomID := util.NewID()
	room, err := s.q.CreateChatRoom(ctx, db.CreateChatRoomParams{
		ID:              roomID,
		Kind:            kind,
		WorkspaceID:     pgtype.Text{String: anchorWorkspaceID, Valid: true},
		OrganizationID:  pgtype.Text{String: orgID, Valid: true},
		Name:            name,
		MemberSetKey:    pgtype.Text{String: memberSetKey, Valid: true},
		LivekitRoomName: liveKitRoomFromChatID(roomID),
		CreatedBy:       creatorID,
	})
	if err != nil {
		return db.ChatRoom{}, err
	}
	for _, id := range uniqueUserIDs(allMemberIDs) {
		if err := s.ensureRoomMember(ctx, roomID, anchorWorkspaceID, id, "member"); err != nil {
			return db.ChatRoom{}, err
		}
	}
	s.publishChatRoomMembersEvent(ctx, roomID, Event{
		Type: "chat.room.created", Payload: map[string]string{"room_id": roomID},
	})
	return room, nil
}

func (s *ChatService) ensureExistingRoomAccess(ctx context.Context, room db.ChatRoom, userIDs ...string) error {
	anchorWS := roomAnchorWorkspaceID(room)
	for _, id := range userIDs {
		id = strings.ToUpper(strings.TrimSpace(id))
		if id == "" {
			continue
		}
		if err := s.ensureRoomMember(ctx, room.ID, anchorWS, id, "member"); err != nil {
			return err
		}
	}
	return nil
}

func (s *ChatService) authorizeRoom(ctx context.Context, userID, workspaceID, roomID string) (db.ChatRoom, error) {
	w, err := s.workspaceForChat(ctx, userID, workspaceID)
	if err != nil {
		return db.ChatRoom{}, err
	}
	room, err := s.q.GetChatRoomByID(ctx, roomID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.ChatRoom{}, ErrNotFound
	}
	if err != nil {
		return db.ChatRoom{}, err
	}
	switch room.Kind {
	case chatRoomKindWorkspace:
		if !room.WorkspaceID.Valid || room.WorkspaceID.String != workspaceID {
			return db.ChatRoom{}, ErrNotFound
		}
	default:
		if !room.OrganizationID.Valid || room.OrganizationID.String != w.OrganizationID {
			return db.ChatRoom{}, ErrNotFound
		}
	}
	if _, err := s.q.GetActiveChatRoomMember(ctx, db.GetActiveChatRoomMemberParams{
		RoomID: roomID, UserID: userID,
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return db.ChatRoom{}, ErrForbidden
		}
		return db.ChatRoom{}, err
	}
	if room.Kind == chatRoomKindDM && !s.userInVoiceRoomMemberSet(room, userID) {
		return db.ChatRoom{}, ErrForbidden
	}
	return room, nil
}

func (s *ChatService) roomSummary(
	ctx context.Context, userID, anchorWorkspaceID, roomID, kind, name string, unread int, memberSetKey string,
) (ChatRoomSummary, error) {
	others, err := s.q.ListChatRoomMemberUserIDs(ctx, roomID)
	if err != nil {
		return ChatRoomSummary{}, err
	}
	memberIDs := make([]string, 0, len(others))
	for _, id := range others {
		if id != userID {
			memberIDs = append(memberIDs, id)
		}
	}
	sort.Strings(memberIDs)
	out := ChatRoomSummary{
		ID: roomID, Kind: kind, Name: name, WorkspaceID: anchorWorkspaceID,
		MemberUserIDs: memberIDs, UnreadCount: unread,
	}
	if kind == chatRoomKindDM {
		peerID := ""
		if len(memberIDs) == 1 {
			peerID = memberIDs[0]
		} else if memberSetKey != "" {
			peerID = peerUserIDFromMemberSet(memberSetKey, userID)
		}
		if peerID != "" {
			peer, err := s.q.GetUserByID(ctx, peerID)
			if err != nil {
				return ChatRoomSummary{}, err
			}
			out.PeerUserID = peer.ID
			out.PeerEmail = peer.Email
			out.PeerDisplayName = peer.DisplayName
			if strings.TrimSpace(out.Name) == "" {
				out.Name = peer.DisplayName
			}
		}
	}
	return out, nil
}

func memberSetKeyFromRoom(room db.ChatRoom) string {
	if room.MemberSetKey.Valid {
		return room.MemberSetKey.String
	}
	return ""
}

func peerUserIDFromMemberSet(memberSetKey, userID string) string {
	self := strings.ToUpper(strings.TrimSpace(userID))
	for _, id := range strings.Split(memberSetKey, memberSetDelimiter) {
		id = strings.ToUpper(strings.TrimSpace(id))
		if id != "" && id != self {
			return id
		}
	}
	return ""
}

// memberSetDelimiter must not appear in ULID user ids (0x00 is rejected by Postgres UTF-8 text).
const memberSetDelimiter = "|"

func memberSetKey(userIDs []string) string {
	ids := uniqueUserIDs(userIDs)
	sort.Strings(ids)
	return strings.Join(ids, memberSetDelimiter)
}

func uniqueUserIDs(userIDs []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(userIDs))
	for _, id := range userIDs {
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
	return out
}

func normalizeUserIDs(userIDs []string) []string {
	return uniqueUserIDs(userIDs)
}

func chatUnreadCount(v interface{}) int {
	switch n := v.(type) {
	case int32:
		return int(n)
	case int64:
		return int(n)
	case int:
		return n
	default:
		return 0
	}
}

func defaultGroupNameFromUsers(ctx context.Context, q *db.Queries, memberIDs []string) string {
	names := make([]string, 0, len(memberIDs))
	for _, id := range memberIDs {
		u, err := q.GetUserByID(ctx, id)
		if err != nil {
			continue
		}
		label := strings.TrimSpace(u.DisplayName)
		if label == "" {
			label = u.Email
		}
		if label != "" {
			names = append(names, label)
		}
	}
	sort.Strings(names)
	if len(names) == 0 {
		return "Group"
	}
	if len(names) > 3 {
		return strings.Join(names[:3], ", ") + "…"
	}
	return strings.Join(names, ", ")
}
