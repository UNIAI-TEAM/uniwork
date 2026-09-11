package service

import (
	"context"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	chatRoomKindDM    = "dm"
	chatRoomKindGroup = "group"
)

// ChatRoomSummary is a dm, group, or channel room visible to the caller.
type ChatRoomSummary struct {
	ID                 string
	Kind               string
	Name               string
	WorkspaceID        string
	MemberUserIDs      []string
	UnreadCount        int
	MentionUnreadCount int
	PeerUserID         string
	PeerEmail          string
	PeerDisplayName    string
	// PeerLastReadAt is the DM peer's read cursor (nil for non-DM or never read).
	PeerLastReadAt        *time.Time
	LastMessageBody       string
	LastMessageKind       string
	LastMessageSenderID   string
	LastMessageSenderName string
	LastMessageAt         *time.Time
	MemberPermissions     ChatRoomMemberPermissions
	Visibility            string
	ProjectID             string
	Topic                 string
	IsDefault             bool
}

type CreateGroupInput struct {
	Name          string
	MemberUserIDs []string
}

// ListChatRooms returns dm, group, workspace/default, and joined channels for a workspace member.
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
		mentionUnread, mErr := s.roomMentionUnread(ctx, userID, wsRoom.ID, workspaceID)
		if mErr != nil {
			return nil, mErr
		}
		wsSummary := ChatRoomSummary{
			ID: wsRoom.ID, Kind: wsRoom.Kind, Name: wsRoom.Name,
			WorkspaceID: workspaceID, UnreadCount: unread, MentionUnreadCount: mentionUnread,
			MemberPermissions: memberPermissionsFromRaw(wsRoom.MemberPermissions),
			Visibility:        wsRoom.Visibility,
			Topic:             wsRoom.Topic,
			IsDefault:         wsRoom.IsDefault,
			ProjectID:         textOrEmpty(wsRoom.ProjectID),
		}
		if preview, pErr := s.q.GetLatestChatMessageByRoom(ctx, db.GetLatestChatMessageByRoomParams{
			RoomID: wsRoom.ID, WorkspaceID: workspaceID,
		}); pErr == nil {
			applyLastMessagePreview(&wsSummary, &chatLastMessagePreview{
				Body: preview.Body, Kind: preview.Kind, SenderID: preview.SenderID,
				SenderDisplayName: preview.SenderDisplayName, CreatedAt: preview.CreatedAt.Time,
			})
		} else if !errors.Is(pErr, pgx.ErrNoRows) {
			return nil, pErr
		}
		out = append(out, wsSummary)
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
		summary, err := s.roomSummary(ctx, userID, anchorWS, row.ID, row.Kind, row.Name, chatUnreadCount(row.UnreadCount), memberSetKey, row.MemberPermissions)
		if err != nil {
			return nil, err
		}
		if summary.Kind == chatRoomKindDM && summary.PeerUserID != "" {
			if _, blocked := blockedPeers[strings.ToUpper(summary.PeerUserID)]; blocked {
				continue
			}
		}
		applyLastMessagePreview(&summary, lastMessagePreviewFromListRow(
			row.LastMessageBody, row.LastMessageKind, row.LastMessageSenderID,
			row.LastMessageSenderName, row.LastMessageAt,
		))
		out = append(out, summary)
	}

	// ListChatRoomsForMember stays dm/group-only; channels are workspace-scoped via ListChatChannelsMine.
	channelRows, err := s.q.ListChatChannelsMine(ctx, db.ListChatChannelsMineParams{
		UserID: userID, WorkspaceID: pgtype.Text{String: workspaceID, Valid: true},
	})
	if err != nil {
		// Do not fail the whole sidebar (DMs/groups) if channel preview scan breaks.
		return out, nil
	}
	for _, row := range channelRows {
		if row.IsDefault {
			continue // already included via GetWorkspaceChatRoom
		}
		summary, err := s.channelSummaryFromMineRow(ctx, userID, row)
		if err != nil {
			continue
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
	return s.roomSummaryWithPreview(ctx, userID, roomAnchorWorkspaceID(room), room.ID, room.Kind, room.Name, 0, memberSetKeyFromRoom(room), room.MemberPermissions)
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
	anchorWS := roomAnchorWorkspaceID(room)
	if room.CreatedBy == userID {
		if err := s.syncRoomMember(ctx, room.ID, anchorWS, userID, "admin"); err != nil {
			return ChatRoomSummary{}, err
		}
	}
	return s.roomSummaryWithPreview(ctx, userID, anchorWS, room.ID, room.Kind, room.Name, 0, memberSetKeyFromRoom(room), room.MemberPermissions)
}
func (s *ChatService) InviteGroupMembers(ctx context.Context, userID, workspaceID, roomID string, memberUserIDs []string) (ChatRoomSummary, error) {
	room, err := s.authorizeRoom(ctx, userID, workspaceID, roomID)
	if err != nil {
		return ChatRoomSummary{}, err
	}
	if room.Kind != chatRoomKindGroup && room.Kind != chatRoomKindChannel {
		return ChatRoomSummary{}, Invalid("chỉ có thể mời thành viên vào nhóm hoặc kênh chat")
	}
	if room.Kind == chatRoomKindChannel && room.IsDefault {
		return ChatRoomSummary{}, Invalid("kênh mặc định đồng bộ thành viên từ workspace")
	}
	orgID := roomOrganizationID(room)
	anchorWS := roomAnchorWorkspaceID(room)
	ids := normalizeUserIDs(memberUserIDs)
	if len(ids) == 0 {
		return ChatRoomSummary{}, Invalid("cần ít nhất một thành viên để mời")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ChatRoomSummary{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	for _, id := range ids {
		if id == userID {
			continue
		}
		if err := s.requireOrgPeer(ctx, orgID, id); err != nil {
			return ChatRoomSummary{}, err
		}
		added, err := s.addRoomMember(ctx, q, roomID, anchorWS, id, "member")
		if err != nil {
			return ChatRoomSummary{}, err
		}
		if !added {
			continue // already a member; re-inviting is not a state change
		}
		if err := auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: orgID, WorkspaceID: anchorWS,
			Actor:        audit.User(userID),
			Action:       audit.ActionChatRoomMemberAdded,
			ResourceType: "chat_room", ResourceID: roomID,
			Metadata: map[string]any{"member_id": id},
		}, audit.Event{Topic: "chat.room.member_added", Payload: map[string]string{
			"room_id": roomID, "user_id": id,
		}}); err != nil {
			return ChatRoomSummary{}, err
		}
	}
	_ = q.TouchChatRoomUpdatedAt(ctx, roomID)
	if err := tx.Commit(ctx); err != nil {
		return ChatRoomSummary{}, err
	}
	s.publishChatRoomMembersEvent(ctx, roomID, Event{
		Type: "chat.room.updated", Payload: map[string]string{"room_id": roomID},
	})
	return s.roomSummaryWithPreview(ctx, userID, anchorWS, room.ID, room.Kind, room.Name, 0, memberSetKeyFromRoom(room), room.MemberPermissions)
}

// RemoveWorkspaceRoomMember removes a workspace member from the workspace and
// marks them left in the workspace chat room. Only workspace owners/admins may
// remove others; explicit workspace owners cannot be removed.
func (s *ChatService) RemoveWorkspaceRoomMember(
	ctx context.Context, actorID, workspaceID, roomID, targetUserID string,
) error {
	room, err := s.authorizeRoom(ctx, actorID, workspaceID, roomID)
	if err != nil {
		return err
	}
	if room.Kind != chatRoomKindWorkspace && !(room.Kind == chatRoomKindChannel && room.IsDefault) {
		return Invalid("chỉ có thể xóa thành viên khỏi kênh mặc định của workspace")
	}
	actor, err := s.ws.RequireMember(ctx, workspaceID, actorID)
	if err != nil {
		return err
	}
	if !adminLikeRole(actor.Role) {
		return ErrForbidden
	}
	if err := s.ws.RemoveMember(ctx, actorID, workspaceID, targetUserID); err != nil {
		return err
	}
	if err := s.q.LeaveChatRoomMember(ctx, db.LeaveChatRoomMemberParams{
		RoomID: roomID, UserID: targetUserID,
	}); err != nil {
		return err
	}
	s.publishChatRoomMembersEvent(ctx, roomID, Event{
		Type: "chat.room.updated", Payload: map[string]string{"room_id": roomID},
	})
	return nil
}

// LeaveChatRoom marks the caller as left for a dm, group, or non-default channel.
func (s *ChatService) LeaveChatRoom(ctx context.Context, userID, workspaceID, roomID string) error {
	room, err := s.authorizeRoom(ctx, userID, workspaceID, roomID)
	if err != nil {
		return err
	}
	if room.Kind == chatRoomKindWorkspace || room.IsDefault {
		return Invalid("không thể rời kênh mặc định của workspace")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	if err := q.LeaveChatRoomMember(ctx, db.LeaveChatRoomMemberParams{
		RoomID: roomID, UserID: userID,
	}); err != nil {
		return err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: roomOrganizationID(room), WorkspaceID: roomAnchorWorkspaceID(room),
		Actor:        audit.User(userID),
		Action:       audit.ActionChatRoomMemberRemoved,
		ResourceType: "chat_room", ResourceID: roomID,
		Metadata: map[string]any{"member_id": userID, "self_service": true},
	}, audit.Event{Topic: "chat.room.member_removed", Payload: map[string]string{
		"room_id": roomID, "user_id": userID,
	}}); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
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
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.ChatRoom{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	room, err := q.CreateChatRoom(ctx, db.CreateChatRoomParams{
		ID:              roomID,
		Kind:            kind,
		WorkspaceID:     pgtype.Text{String: anchorWorkspaceID, Valid: true},
		OrganizationID:  pgtype.Text{String: orgID, Valid: true},
		Name:            name,
		MemberSetKey:    pgtype.Text{String: memberSetKey, Valid: true},
		LivekitRoomName: liveKitRoomFromChatID(roomID),
		CreatedBy:       creatorID,
		CreatedByKind:   string(audit.KindHuman),
		Visibility:      chatVisibilityPrivate,
		ProjectID:       pgtype.Text{},
		Topic:           "",
		IsDefault:       false,
	})
	if err != nil {
		return db.ChatRoom{}, err
	}
	for _, id := range uniqueUserIDs(allMemberIDs) {
		role := "member"
		if id == creatorID {
			role = "admin"
		}
		if err := s.ensureRoomMemberTx(ctx, q, roomID, anchorWorkspaceID, id, role); err != nil {
			return db.ChatRoom{}, err
		}
	}
	// Only room administration is audited; message traffic is not
	// (OPEN_QUESTIONS A4). The realtime notice now leaves through the outbox,
	// which is why there is no Publish call here any more.
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID, WorkspaceID: anchorWorkspaceID,
		Actor:        audit.User(creatorID),
		Action:       audit.ActionChatRoomCreated,
		ResourceType: "chat_room", ResourceID: roomID,
		Changes:  audit.Diff(nil, map[string]any{"kind": kind}),
		Metadata: map[string]any{"member_count": len(uniqueUserIDs(allMemberIDs))},
	}, audit.Event{Topic: "chat.room.created", Payload: map[string]string{
		"room_id": roomID, "workspace_id": anchorWorkspaceID,
	}}); err != nil {
		return db.ChatRoom{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.ChatRoom{}, err
	}
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
	return s.authorizeRoomAccess(ctx, userID, workspaceID, roomID, true)
}

// authorizeRoomRead allows reading a public channel without joining.
func (s *ChatService) authorizeRoomRead(ctx context.Context, userID, workspaceID, roomID string) (db.ChatRoom, error) {
	return s.authorizeRoomAccess(ctx, userID, workspaceID, roomID, false)
}

// authorizeRoomMember requires active membership (send / moderate).
func (s *ChatService) authorizeRoomMember(ctx context.Context, userID, workspaceID, roomID string) (db.ChatRoom, error) {
	return s.authorizeRoomAccess(ctx, userID, workspaceID, roomID, true)
}

func (s *ChatService) authorizeRoomAccess(ctx context.Context, userID, workspaceID, roomID string, requireMember bool) (db.ChatRoom, error) {
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
	if room.ArchivedAt.Valid {
		return db.ChatRoom{}, ErrNotFound
	}
	switch room.Kind {
	case chatRoomKindWorkspace, chatRoomKindChannel:
		if !room.WorkspaceID.Valid || room.WorkspaceID.String != workspaceID {
			return db.ChatRoom{}, ErrNotFound
		}
	default:
		if !room.OrganizationID.Valid || room.OrganizationID.String != w.OrganizationID {
			return db.ChatRoom{}, ErrNotFound
		}
	}

	_, memErr := s.q.GetActiveChatRoomMember(ctx, db.GetActiveChatRoomMemberParams{
		RoomID: roomID, UserID: userID,
	})
	isMember := memErr == nil
	if memErr != nil && !errors.Is(memErr, pgx.ErrNoRows) {
		return db.ChatRoom{}, memErr
	}

	if room.Kind == chatRoomKindChannel && room.Visibility == chatVisibilityPublic && !requireMember {
		// Public channels: workspace members may read without joining.
		return room, nil
	}
	if !isMember {
		if room.Kind == chatRoomKindChannel {
			if requireMember && room.Visibility == chatVisibilityPublic {
				return db.ChatRoom{}, errChatNotMember()
			}
			return db.ChatRoom{}, errChatChannelPrivate()
		}
		if errors.Is(memErr, pgx.ErrNoRows) {
			return db.ChatRoom{}, ErrForbidden
		}
		return db.ChatRoom{}, memErr
	}
	if room.Kind == chatRoomKindDM && !s.userInVoiceRoomMemberSet(room, userID) {
		return db.ChatRoom{}, ErrForbidden
	}
	return room, nil
}

func (s *ChatService) roomSummary(
	ctx context.Context, userID, anchorWorkspaceID, roomID, kind, name string, unread int, memberSetKey string, memberPermissions []byte,
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
	mentionUnread, err := s.roomMentionUnread(ctx, userID, roomID, anchorWorkspaceID)
	if err != nil {
		return ChatRoomSummary{}, err
	}
	out := ChatRoomSummary{
		ID: roomID, Kind: kind, Name: name, WorkspaceID: anchorWorkspaceID,
		MemberUserIDs: memberIDs, UnreadCount: unread, MentionUnreadCount: mentionUnread,
		MemberPermissions: memberPermissionsFromRaw(memberPermissions),
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
			if member, mErr := s.q.GetActiveChatRoomMember(ctx, db.GetActiveChatRoomMemberParams{
				RoomID: roomID, UserID: peerID,
			}); mErr == nil && member.LastReadAt.Valid {
				t := member.LastReadAt.Time
				out.PeerLastReadAt = &t
			}
		}
	}
	return out, nil
}

func (s *ChatService) attachLastMessagePreview(
	ctx context.Context,
	summary *ChatRoomSummary,
	roomID, workspaceID string,
) error {
	preview, err := s.q.GetLatestChatMessageByRoom(ctx, db.GetLatestChatMessageByRoomParams{
		RoomID: roomID, WorkspaceID: workspaceID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	applyLastMessagePreview(summary, &chatLastMessagePreview{
		Body: preview.Body, Kind: preview.Kind, SenderID: preview.SenderID,
		SenderDisplayName: preview.SenderDisplayName, CreatedAt: preview.CreatedAt.Time,
	})
	return nil
}

func (s *ChatService) roomSummaryWithPreview(
	ctx context.Context,
	userID, anchorWorkspaceID, roomID, kind, name string,
	unread int,
	memberSetKey string,
	memberPermissions []byte,
) (ChatRoomSummary, error) {
	summary, err := s.roomSummary(ctx, userID, anchorWorkspaceID, roomID, kind, name, unread, memberSetKey, memberPermissions)
	if err != nil {
		return ChatRoomSummary{}, err
	}
	if err := s.attachLastMessagePreview(ctx, &summary, roomID, anchorWorkspaceID); err != nil {
		return ChatRoomSummary{}, err
	}
	return summary, nil
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
