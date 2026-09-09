package service

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	chatRoomKindChannel      = "channel"
	chatVisibilityPublic     = "public"
	chatVisibilityPrivate    = "private"
	chatChannelNameMaxRunes  = 80
	chatChannelTopicMaxRunes = 280
)

// CreateChannelInput is POST .../chat/channels.
type CreateChannelInput struct {
	Name          string
	Visibility    string
	Topic         string
	ProjectID     string
	MemberUserIDs []string
}

// UpdateChannelInput is PATCH .../chat/channels/{roomID}.
// ClearProject is true when the client sent project_id: null.
type UpdateChannelInput struct {
	Name         *string
	Topic        *string
	Visibility   *string
	ProjectID    *string
	ClearProject bool
}

// ListChannelsInput is GET .../chat/channels.
type ListChannelsInput struct {
	Scope     string // mine | discoverable
	ProjectID string
	Query     string
}

func errChatChannelNameInvalid() error {
	return coded(http.StatusUnprocessableEntity, "chat_channel_name_invalid", "tên kênh phải từ 1 đến 80 ký tự")
}

func errChatChannelDefaultImmutable() error {
	return coded(http.StatusUnprocessableEntity, "chat_channel_default_immutable", "không thể đổi visibility hoặc lưu trữ kênh mặc định")
}

func errChatChannelPrivate() error {
	return coded(http.StatusNotFound, "chat_channel_private", "không tìm thấy kênh")
}

func errChatNotMember() error {
	return coded(http.StatusForbidden, "chat_not_member", "cần tham gia kênh trước khi gửi tin")
}

func errProjectNotFound() error {
	return coded(http.StatusNotFound, "project_not_found", "không tìm thấy project")
}

// CreateChannel creates a public or private channel in the workspace.
func (s *ChatService) CreateChannel(ctx context.Context, userID, workspaceID string, in CreateChannelInput) (ChatRoomSummary, error) {
	w, err := s.workspaceForChat(ctx, userID, workspaceID)
	if err != nil {
		return ChatRoomSummary{}, err
	}
	name := strings.TrimSpace(in.Name)
	if n := utf8.RuneCountInString(name); n < 1 || n > chatChannelNameMaxRunes {
		return ChatRoomSummary{}, errChatChannelNameInvalid()
	}
	visibility := strings.TrimSpace(in.Visibility)
	if visibility == "" {
		visibility = chatVisibilityPrivate
	}
	if visibility != chatVisibilityPublic && visibility != chatVisibilityPrivate {
		return ChatRoomSummary{}, Invalid("visibility phải là public hoặc private")
	}
	topic := strings.TrimSpace(in.Topic)
	if utf8.RuneCountInString(topic) > chatChannelTopicMaxRunes {
		return ChatRoomSummary{}, Invalid("topic tối đa 280 ký tự")
	}
	projectID := strings.TrimSpace(in.ProjectID)
	if projectID != "" {
		if err := s.requireProjectInWorkspace(ctx, workspaceID, w.OrganizationID, projectID); err != nil {
			return ChatRoomSummary{}, err
		}
	}

	memberIDs := uniqueUserIDs(append([]string{userID}, in.MemberUserIDs...))
	for _, id := range memberIDs {
		if id == userID {
			continue
		}
		if err := s.requireOrgPeer(ctx, w.OrganizationID, id); err != nil {
			return ChatRoomSummary{}, err
		}
	}

	roomID := util.NewID()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ChatRoomSummary{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	proj := pgtype.Text{}
	if projectID != "" {
		proj = pgtype.Text{String: projectID, Valid: true}
	}
	room, err := q.CreateChatRoom(ctx, db.CreateChatRoomParams{
		ID:              roomID,
		Kind:            chatRoomKindChannel,
		WorkspaceID:     pgtype.Text{String: workspaceID, Valid: true},
		OrganizationID:  pgtype.Text{String: w.OrganizationID, Valid: true},
		Name:            name,
		MemberSetKey:    pgtype.Text{},
		LivekitRoomName: liveKitRoomFromChatID(roomID),
		CreatedBy:       userID,
		CreatedByKind:   string(audit.KindHuman),
		Visibility:      visibility,
		ProjectID:       proj,
		Topic:           topic,
		IsDefault:       false,
	})
	if err != nil {
		return ChatRoomSummary{}, err
	}
	for _, id := range memberIDs {
		role := "member"
		if id == userID {
			role = "admin"
		}
		if err := s.ensureRoomMemberTx(ctx, q, roomID, workspaceID, id, role); err != nil {
			return ChatRoomSummary{}, err
		}
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: w.OrganizationID, WorkspaceID: workspaceID,
		Actor:        audit.User(userID),
		Action:       audit.ActionChatRoomCreated,
		ResourceType: "chat_room", ResourceID: roomID,
		Changes: audit.Diff(nil, map[string]any{
			"kind": chatRoomKindChannel, "visibility": visibility, "name": name,
		}),
		Metadata: map[string]any{"member_count": len(memberIDs)},
	}, audit.Event{Topic: "chat.channel.created", Payload: map[string]string{
		"room_id": roomID, "workspace_id": workspaceID,
	}}); err != nil {
		return ChatRoomSummary{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ChatRoomSummary{}, err
	}
	return s.channelSummaryFromRoom(ctx, userID, room, 0)
}

// ListChannels returns channels the caller owns/joined or can discover.
func (s *ChatService) ListChannels(ctx context.Context, userID, workspaceID string, in ListChannelsInput) ([]ChatRoomSummary, error) {
	if _, err := s.workspaceForChat(ctx, userID, workspaceID); err != nil {
		return nil, err
	}
	scope := strings.TrimSpace(in.Scope)
	if scope == "" {
		scope = "mine"
	}
	proj := optionalText(strings.TrimSpace(in.ProjectID))
	q := optionalText(strings.TrimSpace(in.Query))
	ws := pgtype.Text{String: workspaceID, Valid: true}

	switch scope {
	case "mine":
		rows, err := s.q.ListChatChannelsMine(ctx, db.ListChatChannelsMineParams{
			UserID: userID, WorkspaceID: ws, ProjectID: proj, SearchQ: q,
		})
		if err != nil {
			return nil, err
		}
		out := make([]ChatRoomSummary, 0, len(rows))
		for _, row := range rows {
			sum, err := s.channelSummaryFromMineRow(ctx, userID, row)
			if err != nil {
				return nil, err
			}
			out = append(out, sum)
		}
		return out, nil
	case "discoverable":
		rows, err := s.q.ListChatChannelsDiscoverable(ctx, db.ListChatChannelsDiscoverableParams{
			WorkspaceID: ws, UserID: userID, ProjectID: proj, SearchQ: q,
		})
		if err != nil {
			return nil, err
		}
		out := make([]ChatRoomSummary, 0, len(rows))
		for _, row := range rows {
			out = append(out, channelSummaryFromDiscoverRow(row))
		}
		return out, nil
	default:
		return nil, Invalid("scope phải là mine hoặc discoverable")
	}
}

// ListProjectChannels returns channels visible for a project page.
func (s *ChatService) ListProjectChannels(ctx context.Context, userID, workspaceID, projectID string) ([]ChatRoomSummary, error) {
	w, err := s.workspaceForChat(ctx, userID, workspaceID)
	if err != nil {
		return nil, err
	}
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		return nil, errProjectNotFound()
	}
	if err := s.requireProjectInWorkspace(ctx, workspaceID, w.OrganizationID, projectID); err != nil {
		return nil, err
	}
	rows, err := s.q.ListChatChannelsByProject(ctx, db.ListChatChannelsByProjectParams{
		WorkspaceID: pgtype.Text{String: workspaceID, Valid: true},
		ProjectID:   pgtype.Text{String: projectID, Valid: true},
		UserID:      userID,
	})
	if err != nil {
		return nil, err
	}
	out := make([]ChatRoomSummary, 0, len(rows))
	for _, row := range rows {
		out = append(out, ChatRoomSummary{
			ID: row.ID, Kind: row.Kind, Name: row.Name, WorkspaceID: workspaceID,
			Visibility: row.Visibility, Topic: row.Topic, IsDefault: row.IsDefault,
			ProjectID:         textOrEmpty(row.ProjectID),
			MemberPermissions: memberPermissionsFromRaw(row.MemberPermissions),
		})
	}
	return out, nil
}

// UpdateChannel patches name/topic/visibility/project on a channel.
func (s *ChatService) UpdateChannel(ctx context.Context, userID, workspaceID, roomID string, in UpdateChannelInput) (ChatRoomSummary, error) {
	room, err := s.authorizeChannelAdmin(ctx, userID, workspaceID, roomID)
	if err != nil {
		return ChatRoomSummary{}, err
	}
	if room.IsDefault && in.Visibility != nil && *in.Visibility != room.Visibility {
		return ChatRoomSummary{}, errChatChannelDefaultImmutable()
	}
	params := db.UpdateChatChannelParams{ID: roomID, ClearProject: in.ClearProject}
	if in.Name != nil {
		name := strings.TrimSpace(*in.Name)
		if n := utf8.RuneCountInString(name); n < 1 || n > chatChannelNameMaxRunes {
			return ChatRoomSummary{}, errChatChannelNameInvalid()
		}
		params.Name = pgtype.Text{String: name, Valid: true}
	}
	if in.Topic != nil {
		topic := strings.TrimSpace(*in.Topic)
		if utf8.RuneCountInString(topic) > chatChannelTopicMaxRunes {
			return ChatRoomSummary{}, Invalid("topic tối đa 280 ký tự")
		}
		params.Topic = pgtype.Text{String: topic, Valid: true}
	}
	if in.Visibility != nil {
		vis := strings.TrimSpace(*in.Visibility)
		if vis != chatVisibilityPublic && vis != chatVisibilityPrivate {
			return ChatRoomSummary{}, Invalid("visibility phải là public hoặc private")
		}
		params.Visibility = pgtype.Text{String: vis, Valid: true}
	}
	if in.ProjectID != nil && !in.ClearProject {
		pid := strings.TrimSpace(*in.ProjectID)
		if pid == "" {
			params.ClearProject = true
		} else {
			w, err := s.q.GetWorkspaceByID(ctx, workspaceID)
			if err != nil {
				return ChatRoomSummary{}, err
			}
			if err := s.requireProjectInWorkspace(ctx, workspaceID, w.OrganizationID, pid); err != nil {
				return ChatRoomSummary{}, err
			}
			params.ProjectID = pgtype.Text{String: pid, Valid: true}
		}
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ChatRoomSummary{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	updated, err := q.UpdateChatChannel(ctx, params)
	if errors.Is(err, pgx.ErrNoRows) {
		return ChatRoomSummary{}, ErrNotFound
	}
	if err != nil {
		return ChatRoomSummary{}, err
	}
	orgID := roomOrganizationID(updated)
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID, WorkspaceID: workspaceID,
		Actor:        audit.User(userID),
		Action:       audit.ActionChatChannelUpdated,
		ResourceType: "chat_room", ResourceID: roomID,
		Changes: audit.Diff(
			map[string]any{"name": room.Name, "topic": room.Topic, "visibility": room.Visibility, "project_id": textOrEmpty(room.ProjectID)},
			map[string]any{"name": updated.Name, "topic": updated.Topic, "visibility": updated.Visibility, "project_id": textOrEmpty(updated.ProjectID)},
		),
	}, audit.Event{Topic: "chat.channel.updated", Payload: map[string]string{
		"room_id": roomID, "workspace_id": workspaceID,
	}}); err != nil {
		return ChatRoomSummary{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ChatRoomSummary{}, err
	}
	s.publishChatRoomMembersEvent(ctx, roomID, Event{
		Type: "chat.channel.updated", Payload: map[string]string{"room_id": roomID, "workspace_id": workspaceID},
	})
	return s.channelSummaryFromRoom(ctx, userID, updated, 0)
}

// JoinChannel adds the caller to a public channel.
func (s *ChatService) JoinChannel(ctx context.Context, userID, workspaceID, roomID string) (ChatRoomSummary, error) {
	w, err := s.workspaceForChat(ctx, userID, workspaceID)
	if err != nil {
		return ChatRoomSummary{}, err
	}
	room, err := s.q.GetChatRoomByID(ctx, roomID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ChatRoomSummary{}, ErrNotFound
	}
	if err != nil {
		return ChatRoomSummary{}, err
	}
	if room.Kind != chatRoomKindChannel || room.ArchivedAt.Valid {
		return ChatRoomSummary{}, ErrNotFound
	}
	if !room.WorkspaceID.Valid || room.WorkspaceID.String != workspaceID {
		return ChatRoomSummary{}, ErrNotFound
	}
	if room.Visibility != chatVisibilityPublic {
		return ChatRoomSummary{}, errChatChannelPrivate()
	}
	if _, err := s.q.GetActiveChatRoomMember(ctx, db.GetActiveChatRoomMemberParams{
		RoomID: roomID, UserID: userID,
	}); err == nil {
		return s.channelSummaryFromRoom(ctx, userID, room, 0)
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return ChatRoomSummary{}, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ChatRoomSummary{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	_ = q.ReactivateChatRoomMember(ctx, db.ReactivateChatRoomMemberParams{
		RoomID: roomID, UserID: userID,
	})
	if _, err := q.GetActiveChatRoomMember(ctx, db.GetActiveChatRoomMemberParams{
		RoomID: roomID, UserID: userID,
	}); errors.Is(err, pgx.ErrNoRows) {
		if err := s.ensureRoomMemberTx(ctx, q, roomID, workspaceID, userID, "member"); err != nil {
			return ChatRoomSummary{}, err
		}
	} else if err != nil {
		return ChatRoomSummary{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: w.OrganizationID, WorkspaceID: workspaceID,
		Actor:        audit.User(userID),
		Action:       audit.ActionChatRoomMemberAdded,
		ResourceType: "chat_room", ResourceID: roomID,
		Metadata: map[string]any{"member_id": userID, "via": "join"},
	}, audit.Event{Topic: "chat.room.member_added", Payload: map[string]string{
		"room_id": roomID, "user_id": userID,
	}}); err != nil {
		return ChatRoomSummary{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return ChatRoomSummary{}, err
	}
	return s.channelSummaryFromRoom(ctx, userID, room, 0)
}

// ArchiveChannel soft-archives a non-default channel.
func (s *ChatService) ArchiveChannel(ctx context.Context, userID, workspaceID, roomID string) error {
	room, err := s.authorizeChannelAdmin(ctx, userID, workspaceID, roomID)
	if err != nil {
		return err
	}
	if room.IsDefault {
		return errChatChannelDefaultImmutable()
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	if _, err := q.ArchiveChatChannel(ctx, db.ArchiveChatChannelParams{
		ID: roomID, ArchivedBy: pgtype.Text{String: userID, Valid: true},
	}); errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	} else if err != nil {
		return err
	}
	orgID := roomOrganizationID(room)
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID, WorkspaceID: workspaceID,
		Actor:        audit.User(userID),
		Action:       audit.ActionChatChannelArchived,
		ResourceType: "chat_room", ResourceID: roomID,
	}, audit.Event{Topic: "chat.channel.archived", Payload: map[string]string{
		"room_id": roomID, "workspace_id": workspaceID,
	}}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// UnarchiveChannel restores an archived channel.
func (s *ChatService) UnarchiveChannel(ctx context.Context, userID, workspaceID, roomID string) error {
	room, err := s.authorizeChannelAdminIncludingArchived(ctx, userID, workspaceID, roomID)
	if err != nil {
		return err
	}
	if !room.ArchivedAt.Valid {
		return nil
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	if _, err := q.UnarchiveChatChannel(ctx, roomID); errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	} else if err != nil {
		return err
	}
	orgID := roomOrganizationID(room)
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID, WorkspaceID: workspaceID,
		Actor:        audit.User(userID),
		Action:       audit.ActionChatChannelUpdated,
		ResourceType: "chat_room", ResourceID: roomID,
		Metadata: map[string]any{"unarchived": true},
	}, audit.Event{Topic: "chat.channel.updated", Payload: map[string]string{
		"room_id": roomID, "workspace_id": workspaceID,
	}}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// CreateChannelForProject creates a public channel linked to a project (optional CreateProject tick).
func (s *ChatService) CreateChannelForProject(ctx context.Context, q *db.Queries, userID, orgID, workspaceID, projectID, name string) (db.ChatRoom, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		name = "chung"
	}
	if utf8.RuneCountInString(name) > chatChannelNameMaxRunes {
		name = string([]rune(name)[:chatChannelNameMaxRunes])
	}
	roomID := util.NewID()
	room, err := q.CreateChatRoom(ctx, db.CreateChatRoomParams{
		ID:              roomID,
		Kind:            chatRoomKindChannel,
		WorkspaceID:     pgtype.Text{String: workspaceID, Valid: true},
		OrganizationID:  pgtype.Text{String: orgID, Valid: true},
		Name:            name,
		MemberSetKey:    pgtype.Text{},
		LivekitRoomName: liveKitRoomFromChatID(roomID),
		CreatedBy:       userID,
		CreatedByKind:   string(audit.KindHuman),
		Visibility:      chatVisibilityPublic,
		ProjectID:       pgtype.Text{String: projectID, Valid: true},
		Topic:           "",
		IsDefault:       false,
	})
	if err != nil {
		return db.ChatRoom{}, err
	}
	if err := s.ensureRoomMemberTx(ctx, q, roomID, workspaceID, userID, "admin"); err != nil {
		return db.ChatRoom{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID, WorkspaceID: workspaceID,
		Actor:        audit.User(userID),
		Action:       audit.ActionChatRoomCreated,
		ResourceType: "chat_room", ResourceID: roomID,
		Changes: audit.Diff(nil, map[string]any{
			"kind": chatRoomKindChannel, "visibility": chatVisibilityPublic, "project_id": projectID,
		}),
	}, audit.Event{Topic: "chat.channel.created", Payload: map[string]string{
		"room_id": roomID, "workspace_id": workspaceID,
	}}); err != nil {
		return db.ChatRoom{}, err
	}
	return room, nil
}

func (s *ChatService) requireProjectInWorkspace(ctx context.Context, workspaceID, orgID, projectID string) error {
	_, err := s.q.GetProject(ctx, db.GetProjectParams{
		ID: projectID, OrganizationID: orgID, WorkspaceID: workspaceID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return errProjectNotFound()
	}
	return err
}

func (s *ChatService) authorizeChannelAdmin(ctx context.Context, userID, workspaceID, roomID string) (db.ChatRoom, error) {
	room, err := s.authorizeRoomMember(ctx, userID, workspaceID, roomID)
	if err != nil {
		return db.ChatRoom{}, err
	}
	if room.Kind != chatRoomKindChannel || room.ArchivedAt.Valid {
		return db.ChatRoom{}, ErrNotFound
	}
	if room.CreatedBy == userID {
		return room, nil
	}
	mem, err := s.q.GetActiveChatRoomMember(ctx, db.GetActiveChatRoomMemberParams{
		RoomID: roomID, UserID: userID,
	})
	if err != nil {
		return db.ChatRoom{}, err
	}
	if mem.Role == "admin" {
		return room, nil
	}
	wsMember, err := s.ws.RequireMember(ctx, workspaceID, userID)
	if err != nil {
		return db.ChatRoom{}, err
	}
	if adminLikeRole(wsMember.Role) {
		return room, nil
	}
	return db.ChatRoom{}, ErrForbidden
}

func (s *ChatService) authorizeChannelAdminIncludingArchived(ctx context.Context, userID, workspaceID, roomID string) (db.ChatRoom, error) {
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
	if room.Kind != chatRoomKindChannel {
		return db.ChatRoom{}, ErrNotFound
	}
	if !room.WorkspaceID.Valid || room.WorkspaceID.String != workspaceID {
		return db.ChatRoom{}, ErrNotFound
	}
	if !room.OrganizationID.Valid || room.OrganizationID.String != w.OrganizationID {
		return db.ChatRoom{}, ErrNotFound
	}
	if room.CreatedBy == userID {
		return room, nil
	}
	mem, err := s.q.GetActiveChatRoomMember(ctx, db.GetActiveChatRoomMemberParams{
		RoomID: roomID, UserID: userID,
	})
	if err == nil && mem.Role == "admin" {
		return room, nil
	}
	wsMember, err := s.ws.RequireMember(ctx, workspaceID, userID)
	if err != nil {
		return db.ChatRoom{}, err
	}
	if adminLikeRole(wsMember.Role) {
		return room, nil
	}
	return db.ChatRoom{}, ErrForbidden
}

func (s *ChatService) channelSummaryFromRoom(ctx context.Context, userID string, room db.ChatRoom, unread int) (ChatRoomSummary, error) {
	wsID := roomAnchorWorkspaceID(room)
	sum, err := s.roomSummary(ctx, userID, wsID, room.ID, room.Kind, room.Name, unread, "", room.MemberPermissions)
	if err != nil {
		return ChatRoomSummary{}, err
	}
	sum.Visibility = room.Visibility
	sum.Topic = room.Topic
	sum.IsDefault = room.IsDefault
	sum.ProjectID = textOrEmpty(room.ProjectID)
	return sum, nil
}

func (s *ChatService) channelSummaryFromMineRow(ctx context.Context, userID string, row db.ListChatChannelsMineRow) (ChatRoomSummary, error) {
	wsID := ""
	if row.WorkspaceID.Valid {
		wsID = row.WorkspaceID.String
	}
	sum, err := s.roomSummary(ctx, userID, wsID, row.ID, row.Kind, row.Name, chatUnreadCount(row.UnreadCount), "", row.MemberPermissions)
	if err != nil {
		return ChatRoomSummary{}, err
	}
	sum.Visibility = row.Visibility
	sum.Topic = row.Topic
	sum.IsDefault = row.IsDefault
	sum.ProjectID = textOrEmpty(row.ProjectID)
	if row.LastMessageAt.Valid {
		t := row.LastMessageAt.Time
		sum.LastMessageAt = &t
		sum.LastMessageBody = row.LastMessageBody
		sum.LastMessageKind = row.LastMessageKind
		sum.LastMessageSenderID = row.LastMessageSenderID
		sum.LastMessageSenderName = row.LastMessageSenderName
	}
	return sum, nil
}

func channelSummaryFromDiscoverRow(row db.ListChatChannelsDiscoverableRow) ChatRoomSummary {
	wsID := ""
	if row.WorkspaceID.Valid {
		wsID = row.WorkspaceID.String
	}
	return ChatRoomSummary{
		ID: row.ID, Kind: row.Kind, Name: row.Name, WorkspaceID: wsID,
		Visibility: row.Visibility, Topic: row.Topic, IsDefault: row.IsDefault,
		ProjectID:         textOrEmpty(row.ProjectID),
		MemberPermissions: memberPermissionsFromRaw(row.MemberPermissions),
	}
}

func optionalText(s string) pgtype.Text {
	if s == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: s, Valid: true}
}
