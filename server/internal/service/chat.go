package service

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	chatRoomKindWorkspace   = "workspace"
	chatLiveKitPrefix       = "uw-voice-"
	defaultChatMessageLimit = 50
	maxChatMessageLimit     = 100
)

// isWorkspaceDefaultRoom is the legacy "phòng chung" (kind=workspace or
// migrated channel with is_default).
func isWorkspaceDefaultRoom(room db.ChatRoom) bool {
	return room.Kind == chatRoomKindWorkspace || (room.Kind == chatRoomKindChannel && room.IsDefault)
}

type ChatService struct {
	pool        *pgxpool.Pool
	q           *db.Queries
	ws          *WorkspaceService
	pub         EventPublisher
	tasks       *TaskService
	TenorAPIKey string
}

func NewChatService(pool *pgxpool.Pool, q *db.Queries, ws *WorkspaceService, pub EventPublisher) *ChatService {
	return &ChatService{pool: pool, q: q, ws: ws, pub: pub}
}

// RoomMemberIDs answers outbox.MemberResolver so room membership events reach
// each member's own connections, including the one just added who is not
// subscribed to the room yet.
func (s *ChatService) RoomMemberIDs(ctx context.Context, roomID string) ([]string, error) {
	return s.q.ListChatRoomMemberUserIDs(ctx, roomID)
}

type WorkspaceChat struct {
	RoomID      string
	WorkspaceID string
}

// WorkspaceChatStatus is returned by GET when the caller may read room state
// without treating "not provisioned yet" as an HTTP error.
type WorkspaceChatStatus struct {
	WorkspaceID string
	RoomID      string // empty until the first ensure/create
	Enabled     bool   // native chat is always enabled
}

type ChatMessageRow struct {
	ID                string
	RoomID            string
	WorkspaceID       string
	SenderID          string
	SenderDisplayName string
	Body              string
	Kind              string
	ReplyToMessageID  *string
	ThreadRootID      *string
	ReplyCount        int
	LastReplyAt       *time.Time
	ThreadUnread      bool
	CreatedAt         time.Time
	Reactions         map[string]int
	Pinned            bool
	MentionedUserIDs  []string
	VoiceCall         *VoiceCallLogInfo
	Voice             *VoiceMessageInfo
	File              *FileMessageInfo
	Poll              *ChatPollInfo
	Reminder          *ChatReminderInfo
	Note              *ChatNoteInfo
	Priority          string
	EditedAt          *time.Time
	// ClientMsgID is the sender's idempotency key, echoed so a client can drop
	// its own queued copy without guessing from body and timestamp.
	ClientMsgID string
}

type ListChatMessagesInput struct {
	Before *time.Time
	Limit  int
}

type SendChatMessageInput struct {
	Body             string
	ReplyToMessageID *string
	Priority         string
	ClientMsgID      string
}

// GetWorkspaceRoom returns native chat room state for a workspace member.
func (s *ChatService) GetWorkspaceRoom(ctx context.Context, userID, workspaceID string) (WorkspaceChatStatus, error) {
	if _, err := s.ws.RequireMember(ctx, workspaceID, userID); err != nil {
		return WorkspaceChatStatus{}, err
	}
	status := WorkspaceChatStatus{WorkspaceID: workspaceID, Enabled: true}
	room, err := s.q.GetWorkspaceChatRoom(ctx, pgtype.Text{String: workspaceID, Valid: true})
	if errors.Is(err, pgx.ErrNoRows) {
		return status, nil
	}
	if err != nil {
		return WorkspaceChatStatus{}, err
	}
	status.RoomID = room.ID
	return status, nil
}

// EnsureWorkspaceRoom creates the workspace channel when needed and syncs members.
func (s *ChatService) EnsureWorkspaceRoom(ctx context.Context, userID, workspaceID string) (WorkspaceChat, error) {
	if _, err := s.ws.RequireMember(ctx, workspaceID, userID); err != nil {
		return WorkspaceChat{}, err
	}
	w, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return WorkspaceChat{}, ErrNotFound
	}

	room, err := s.q.GetWorkspaceChatRoom(ctx, pgtype.Text{String: workspaceID, Valid: true})
	if errors.Is(err, pgx.ErrNoRows) {
		roomID := util.NewID()
		room, err = s.q.CreateChatRoom(ctx, db.CreateChatRoomParams{
			ID:              roomID,
			Kind:            chatRoomKindChannel,
			WorkspaceID:     pgtype.Text{String: workspaceID, Valid: true},
			OrganizationID:  pgtype.Text{String: w.OrganizationID, Valid: true},
			Name:            w.Name,
			MemberSetKey:    pgtype.Text{},
			LivekitRoomName: liveKitRoomFromChatID(roomID),
			CreatedBy:       userID,
			CreatedByKind:   string(audit.KindHuman),
			Visibility:      chatVisibilityPublic,
			ProjectID:       pgtype.Text{},
			Topic:           "",
			IsDefault:       true,
		})
		if err != nil {
			return WorkspaceChat{}, err
		}
	} else if err != nil {
		return WorkspaceChat{}, err
	}

	if err := s.syncWorkspaceRoomMembers(ctx, room.ID, workspaceID); err != nil {
		return WorkspaceChat{}, err
	}
	return WorkspaceChat{RoomID: room.ID, WorkspaceID: workspaceID}, nil
}

func (s *ChatService) syncWorkspaceRoomMembers(ctx context.Context, roomID, workspaceID string) error {
	members, err := s.q.ListWorkspaceMembers(ctx, workspaceID)
	if err != nil {
		return err
	}
	keep := make(map[string]struct{}, len(members))
	for _, m := range members {
		keep[m.UserID] = struct{}{}
		role := workspaceChatMemberRole(m.Role)
		if err := s.syncRoomMember(ctx, roomID, workspaceID, m.UserID, role); err != nil {
			return err
		}
	}
	activeIDs, err := s.q.ListChatRoomMemberUserIDs(ctx, roomID)
	if err != nil {
		return err
	}
	for _, uid := range activeIDs {
		if _, ok := keep[uid]; ok {
			continue
		}
		if err := s.q.LeaveChatRoomMember(ctx, db.LeaveChatRoomMemberParams{
			RoomID: roomID, UserID: uid,
		}); err != nil {
			return err
		}
	}
	return nil
}

func workspaceChatMemberRole(wsRole string) string {
	if wsRole == "owner" || wsRole == "admin" {
		return "admin"
	}
	return "member"
}

// syncRoomMember adds the member when absent and raises an existing member to
// admin when the workspace role demands it; it never demotes.
func (s *ChatService) syncRoomMember(ctx context.Context, roomID, workspaceID, userID, floorRole string) error {
	existing, err := s.q.GetActiveChatRoomMember(ctx, db.GetActiveChatRoomMemberParams{
		RoomID: roomID, UserID: userID,
	})
	if err == nil {
		if floorRole != "admin" || existing.Role == "admin" {
			return nil
		}
		return s.q.UpdateChatRoomMemberRole(ctx, db.UpdateChatRoomMemberRoleParams{
			RoomID: roomID, UserID: userID, Role: "admin",
		})
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	_, err = s.addRoomMember(ctx, s.q, roomID, workspaceID, userID, floorRole)
	return err
}

func (s *ChatService) ensureRoomMember(ctx context.Context, roomID, workspaceID, userID, role string) error {
	return s.ensureRoomMemberTx(ctx, s.q, roomID, workspaceID, userID, role)
}

// ensureRoomMemberTx adds the member inside the caller's transaction; it drops
// the added flag for callers that have nothing to audit.
func (s *ChatService) ensureRoomMemberTx(ctx context.Context, q *db.Queries, roomID, workspaceID, userID, role string) error {
	_, err := s.addRoomMember(ctx, q, roomID, workspaceID, userID, role)
	return err
}

// addRoomMember reports whether it added the row, so a caller inside a
// transaction can audit exactly the members it actually added.
func (s *ChatService) addRoomMember(ctx context.Context, q *db.Queries, roomID, workspaceID, userID, role string) (bool, error) {
	_, err := q.GetActiveChatRoomMember(ctx, db.GetActiveChatRoomMemberParams{
		RoomID: roomID, UserID: userID,
	})
	if err == nil {
		return false, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return false, err
	}
	_, err = q.InsertChatRoomMember(ctx, db.InsertChatRoomMemberParams{
		ID:          util.NewID(),
		RoomID:      roomID,
		WorkspaceID: workspaceID,
		UserID:      userID,
		Role:        role,
		Status:      "active",
	})
	return err == nil, err
}

func (s *ChatService) authorizeWorkspaceRoom(ctx context.Context, userID, workspaceID string) (db.ChatRoom, error) {
	if _, err := s.ws.RequireMember(ctx, workspaceID, userID); err != nil {
		return db.ChatRoom{}, err
	}
	room, err := s.q.GetWorkspaceChatRoom(ctx, pgtype.Text{String: workspaceID, Valid: true})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.ChatRoom{}, ErrNotFound
	}
	if err != nil {
		return db.ChatRoom{}, err
	}
	if _, err := s.q.GetActiveChatRoomMember(ctx, db.GetActiveChatRoomMemberParams{
		RoomID: room.ID, UserID: userID,
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return db.ChatRoom{}, ErrForbidden
		}
		return db.ChatRoom{}, err
	}
	return room, nil
}

// ListRoomMessages returns messages for any chat room the caller may access.
func (s *ChatService) ListRoomMessages(
	ctx context.Context, userID, workspaceID, roomID string, in ListChatMessagesInput,
) ([]ChatMessageRow, error) {
	room, err := s.authorizeRoomRead(ctx, userID, workspaceID, roomID)
	if err != nil {
		return nil, err
	}
	return s.listMessages(ctx, userID, roomAnchorWorkspaceID(room), roomID, in)
}

// GetRoomMessage returns one message in a room the caller may access.
func (s *ChatService) GetRoomMessage(
	ctx context.Context, userID, workspaceID, roomID, messageID string,
) (ChatMessageRow, error) {
	room, err := s.authorizeRoomRead(ctx, userID, workspaceID, roomID)
	if err != nil {
		return ChatMessageRow{}, err
	}
	anchorWS := roomAnchorWorkspaceID(room)
	msg, err := s.q.GetChatMessageInRoom(ctx, db.GetChatMessageInRoomParams{
		ID: messageID, RoomID: roomID, WorkspaceID: anchorWS,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return ChatMessageRow{}, ErrNotFound
	}
	if err != nil {
		return ChatMessageRow{}, err
	}
	u, err := s.q.GetUserByID(ctx, msg.SenderID)
	if err != nil {
		return ChatMessageRow{}, err
	}
	return chatMessageRowFromDBForViewer(msg, u.DisplayName, userID), nil
}

// SendRoomMessage posts a text message to any chat room the caller may access.
func (s *ChatService) SendRoomMessage(
	ctx context.Context, userID, workspaceID, roomID string, in SendChatMessageInput,
) (ChatMessageRow, error) {
	if err := validateChatMessageBody(in.Body); err != nil {
		return ChatMessageRow{}, err
	}
	room, err := s.authorizeRoomMember(ctx, userID, workspaceID, roomID)
	if err != nil {
		return ChatMessageRow{}, err
	}
	return s.sendMessage(ctx, userID, room, in)
}

// ListWorkspaceMessages returns messages for the workspace channel.
func (s *ChatService) ListWorkspaceMessages(
	ctx context.Context, userID, workspaceID string, in ListChatMessagesInput,
) ([]ChatMessageRow, error) {
	if _, err := s.ws.RequireMember(ctx, workspaceID, userID); err != nil {
		return nil, err
	}
	room, err := s.q.GetWorkspaceChatRoom(ctx, pgtype.Text{String: workspaceID, Valid: true})
	if errors.Is(err, pgx.ErrNoRows) {
		return []ChatMessageRow{}, nil
	}
	if err != nil {
		return nil, err
	}
	if _, err := s.q.GetActiveChatRoomMember(ctx, db.GetActiveChatRoomMemberParams{
		RoomID: room.ID, UserID: userID,
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrForbidden
		}
		return nil, err
	}
	return s.listMessages(ctx, userID, workspaceID, room.ID, in)
}

func (s *ChatService) listMessages(
	ctx context.Context, userID, workspaceID, roomID string, in ListChatMessagesInput,
) ([]ChatMessageRow, error) {
	limit := in.Limit
	if limit <= 0 {
		limit = defaultChatMessageLimit
	}
	if limit > maxChatMessageLimit {
		limit = maxChatMessageLimit
	}
	var before pgtype.Timestamptz
	if in.Before != nil {
		before = pgtype.Timestamptz{Time: *in.Before, Valid: true}
	}
	rows, err := s.q.ListChatMessagesByRoom(ctx, db.ListChatMessagesByRoomParams{
		RoomID:      roomID,
		WorkspaceID: workspaceID,
		BeforeAt:    before,
		MsgLimit:    int32(limit),
	})
	if err != nil {
		return nil, err
	}
	out := make([]ChatMessageRow, 0, len(rows))
	for i := len(rows) - 1; i >= 0; i-- {
		out = append(out, chatMessageRowFromListRow(rows[i], userID))
	}
	if len(out) > 0 {
		last := out[len(out)-1]
		_ = s.q.UpdateChatRoomMemberLastRead(ctx, db.UpdateChatRoomMemberLastReadParams{
			RoomID: roomID, UserID: userID, LastReadAt: pgtype.Timestamptz{Time: last.CreatedAt, Valid: true},
		})
	}
	return out, nil
}

// SendWorkspaceMessage posts a text message to the workspace channel.
func (s *ChatService) SendWorkspaceMessage(
	ctx context.Context, userID, workspaceID string, in SendChatMessageInput,
) (ChatMessageRow, error) {
	if err := validateChatMessageBody(in.Body); err != nil {
		return ChatMessageRow{}, err
	}
	room, err := s.authorizeWorkspaceRoom(ctx, userID, workspaceID)
	if errors.Is(err, ErrNotFound) {
		ensured, ensureErr := s.EnsureWorkspaceRoom(ctx, userID, workspaceID)
		if ensureErr != nil {
			return ChatMessageRow{}, ensureErr
		}
		room, err = s.q.GetChatRoomByID(ctx, ensured.RoomID)
		if err != nil {
			return ChatMessageRow{}, err
		}
	} else if err != nil {
		return ChatMessageRow{}, err
	}
	return s.sendMessage(ctx, userID, room, in)
}

func (s *ChatService) sendMessage(
	ctx context.Context, userID string, room db.ChatRoom, in SendChatMessageInput,
) (ChatMessageRow, error) {
	body := strings.TrimSpace(in.Body)
	if err := validateChatMessageBody(body); err != nil {
		return ChatMessageRow{}, err
	}
	clientMsgID := strings.TrimSpace(in.ClientMsgID)
	if err := validateClientMsgID(clientMsgID); err != nil {
		return ChatMessageRow{}, err
	}
	if err := s.requireCanSendMessageInRoom(ctx, userID, room); err != nil {
		return ChatMessageRow{}, err
	}
	anchorWS := roomAnchorWorkspaceID(room)
	if clientMsgID != "" {
		if existing, found, err := s.existingMessageByClientMsgID(ctx, room.ID, userID, clientMsgID); err != nil {
			return ChatMessageRow{}, err
		} else if found {
			return s.chatMessageRowForExisting(ctx, existing)
		}
	}
	var replyTo pgtype.Text
	if in.ReplyToMessageID != nil && strings.TrimSpace(*in.ReplyToMessageID) != "" {
		replyID := strings.TrimSpace(*in.ReplyToMessageID)
		if _, err := s.q.GetChatMessageInRoom(ctx, db.GetChatMessageInRoomParams{
			ID: replyID, RoomID: room.ID, WorkspaceID: anchorWS,
		}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ChatMessageRow{}, Invalid("tin nhắn trả lời không hợp lệ")
			}
			return ChatMessageRow{}, err
		}
		replyTo = pgtype.Text{String: replyID, Valid: true}
	}
	var clientMsg pgtype.Text
	if clientMsgID != "" {
		clientMsg = pgtype.Text{String: clientMsgID, Valid: true}
	}
	msg, err := s.q.CreateChatMessage(ctx, db.CreateChatMessageParams{
		ID:               util.NewID(),
		RoomID:           room.ID,
		WorkspaceID:      anchorWS,
		SenderID:         userID,
		SenderKind:       string(audit.KindHuman),
		Body:             body,
		ReplyToMessageID: replyTo,
		ClientMsgID:      clientMsg,
	})
	if err != nil {
		if clientMsgID != "" && isUniqueViolation(err) {
			if existing, found, lookupErr := s.existingMessageByClientMsgID(ctx, room.ID, userID, clientMsgID); lookupErr != nil {
				return ChatMessageRow{}, lookupErr
			} else if found {
				return s.chatMessageRowForExisting(ctx, existing)
			}
		}
		return ChatMessageRow{}, err
	}
	mentionedUserIDs, err := s.resolveMentionRecipients(ctx, userID, room, body)
	if err != nil {
		return ChatMessageRow{}, err
	}
	if len(mentionedUserIDs) > 0 {
		msg, err = s.persistMessageMentions(ctx, msg, mentionedUserIDs)
		if err != nil {
			return ChatMessageRow{}, err
		}
	}
	if priority := normalizeMessagePriority(in.Priority); priority != "" {
		meta, err := encodeMessagePriorityMetadata(msg.Metadata, priority)
		if err != nil {
			return ChatMessageRow{}, err
		}
		msg, err = s.q.UpdateChatMessageMetadata(ctx, db.UpdateChatMessageMetadataParams{
			ID: msg.ID, RoomID: room.ID, WorkspaceID: anchorWS, Metadata: meta,
		})
		if err != nil {
			return ChatMessageRow{}, err
		}
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
	s.publishCreatedChatMessage(ctx, room, msg.ID)
	s.publishMentionNotifications(ctx, room, userID, msg.ID, mentionedUserIDs)
	return chatMessageRowFromDB(msg, u.DisplayName), nil
}

func (s *ChatService) existingMessageByClientMsgID(
	ctx context.Context, roomID, senderID, clientMsgID string,
) (db.ChatMessage, bool, error) {
	msg, err := s.q.GetChatMessageByClientMsgID(ctx, db.GetChatMessageByClientMsgIDParams{
		RoomID:      roomID,
		SenderID:    senderID,
		ClientMsgID: pgtype.Text{String: clientMsgID, Valid: true},
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.ChatMessage{}, false, nil
	}
	if err != nil {
		return db.ChatMessage{}, false, err
	}
	return msg, true, nil
}

func (s *ChatService) chatMessageRowForExisting(ctx context.Context, msg db.ChatMessage) (ChatMessageRow, error) {
	u, err := s.q.GetUserByID(ctx, msg.SenderID)
	if err != nil {
		return ChatMessageRow{}, err
	}
	return chatMessageRowFromDB(msg, u.DisplayName), nil
}

// ToggleChatMessageReaction adds or removes the caller's reaction on a message.
func (s *ChatService) ToggleChatMessageReaction(
	ctx context.Context, userID, workspaceID, roomID, messageID, emoji string,
) (ChatMessageRow, error) {
	room, err := s.authorizeRoom(ctx, userID, workspaceID, roomID)
	if err != nil {
		return ChatMessageRow{}, err
	}
	if err := s.requireCanSendInRoom(ctx, userID, room.ID, room); err != nil {
		return ChatMessageRow{}, err
	}
	anchorWS := roomAnchorWorkspaceID(room)
	msg, err := s.q.GetChatMessageInRoom(ctx, db.GetChatMessageInRoomParams{
		ID: messageID, RoomID: roomID, WorkspaceID: anchorWS,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return ChatMessageRow{}, ErrNotFound
	}
	if err != nil {
		return ChatMessageRow{}, err
	}
	meta, err := toggleReactionInMetadata(msg.Metadata, userID, emoji)
	if err != nil {
		return ChatMessageRow{}, err
	}
	updated, err := s.q.UpdateChatMessageMetadata(ctx, db.UpdateChatMessageMetadataParams{
		ID: messageID, RoomID: roomID, WorkspaceID: anchorWS, Metadata: meta,
	})
	if err != nil {
		return ChatMessageRow{}, err
	}
	u, err := s.q.GetUserByID(ctx, updated.SenderID)
	if err != nil {
		return ChatMessageRow{}, err
	}
	s.publishChatMessageUpdated(ctx, room, updated.ID)
	return chatMessageRowFromDB(updated, u.DisplayName), nil
}

func chatMessageRowFromDB(msg db.ChatMessage, senderDisplayName string) ChatMessageRow {
	return chatMessageRowFromDBForViewer(msg, senderDisplayName, "")
}

func chatMessageRowFromDBForViewer(msg db.ChatMessage, senderDisplayName, viewerID string) ChatMessageRow {
	out := chatMessageRowFromMessageFields(
		msg.ID, msg.RoomID, msg.WorkspaceID, msg.SenderID, senderDisplayName,
		msg.Kind, msg.Body, msg.Metadata, msg.ReplyToMessageID, msg.EditedAt, msg.CreatedAt, viewerID,
	)
	out.ClientMsgID = msg.ClientMsgID.String
	applyThreadFields(&out, msg.ThreadRootID, msg.ReplyCount, msg.LastReplyAt)
	return out
}

func liveKitRoomFromChatID(chatRoomID string) string {
	const maxLen = 240
	out := chatLiveKitPrefix + chatRoomID
	if len(out) > maxLen {
		return out[:maxLen]
	}
	return out
}

// ChatUserProfile is a UniWork user resolved for cross-workspace DM.
type ChatUserProfile struct {
	UserID      string
	Email       string
	DisplayName string
}

// LookupUserByEmail finds a UniWork user by exact email within an organization.
func (s *ChatService) LookupUserByEmail(ctx context.Context, callerID, workspaceID, email string) (ChatUserProfile, error) {
	w, err := s.workspaceForChat(ctx, callerID, workspaceID)
	if err != nil {
		return ChatUserProfile{}, err
	}
	email = strings.ToLower(strings.TrimSpace(email))
	if !strings.Contains(email, "@") || len(email) < 5 {
		return ChatUserProfile{}, Invalid("email không hợp lệ")
	}
	u, err := s.q.GetUserByEmail(ctx, email)
	if errors.Is(err, pgx.ErrNoRows) {
		return ChatUserProfile{}, ErrNotFound
	}
	if err != nil {
		return ChatUserProfile{}, err
	}
	if err := s.requireOrgPeer(ctx, w.OrganizationID, u.ID); err != nil {
		return ChatUserProfile{}, err
	}
	return userToChatProfile(u, callerID)
}

// LookupUserByID resolves a UniWork user by id within an organization.
func (s *ChatService) LookupUserByID(ctx context.Context, callerID, workspaceID, targetUserID string) (ChatUserProfile, error) {
	w, err := s.workspaceForChat(ctx, callerID, workspaceID)
	if err != nil {
		return ChatUserProfile{}, err
	}
	targetUserID = strings.ToUpper(strings.TrimSpace(targetUserID))
	if targetUserID == "" {
		return ChatUserProfile{}, Invalid("user id is required")
	}
	u, err := s.q.GetUserByID(ctx, targetUserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ChatUserProfile{}, ErrNotFound
	}
	if err != nil {
		return ChatUserProfile{}, err
	}
	if err := s.requireOrgPeer(ctx, w.OrganizationID, u.ID); err != nil {
		return ChatUserProfile{}, err
	}
	return userToChatProfile(u, callerID)
}

func userToChatProfile(u db.User, callerID string) (ChatUserProfile, error) {
	if u.ID == callerID {
		return ChatUserProfile{}, Invalid("không thể nhắn tin với chính mình")
	}
	return ChatUserProfile{UserID: u.ID, Email: u.Email, DisplayName: u.DisplayName}, nil
}

// LiveKitRoomFromChatID maps a native chat room id to a stable LiveKit room name.
func LiveKitRoomFromChatID(chatRoomID string) string {
	return liveKitRoomFromChatID(chatRoomID)
}

// MintVoiceTokenRoom resolves the LiveKit room name for an active voice call session.
func (s *ChatService) MintVoiceTokenRoom(ctx context.Context, userID, chatRoomID, callID string) (string, error) {
	chatRoomID = strings.TrimSpace(chatRoomID)
	if chatRoomID == "" {
		return "", Invalid("room id is required")
	}
	room, err := s.q.GetChatRoomByID(ctx, chatRoomID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	if !room.WorkspaceID.Valid {
		return "", ErrNotFound
	}
	wsID := room.WorkspaceID.String
	if _, err := s.ws.RequireMember(ctx, wsID, userID); err != nil {
		return "", err
	}
	if err := s.requireDMVoiceAllowed(ctx, room, userID); err != nil {
		return "", err
	}
	if err := s.requireVoiceTokenAccess(ctx, room, userID, wsID); err != nil {
		return "", err
	}
	return liveKitRoomForActiveVoiceCall(room, callID)
}
