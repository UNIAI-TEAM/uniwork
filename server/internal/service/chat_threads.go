package service

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	chatThreadFollowAuthor    = "author"
	chatThreadFollowReplied   = "replied"
	chatThreadFollowMentioned = "mentioned"
	chatThreadFollowManual    = "manual"
)

func errChatThreadInvalidRoot() error {
	return coded(http.StatusUnprocessableEntity, "chat_thread_invalid_root", "không thể trả lời vào một câu trả lời thread")
}

func errChatThreadNotFound() error {
	return coded(http.StatusNotFound, "chat_thread_not_found", "không tìm thấy thread")
}

// ChatThreadSummary is one followed thread for the caller's list.
type ChatThreadSummary struct {
	ThreadRootID string
	RoomID       string
	WorkspaceID  string
	RootBody     string
	RootSenderID string
	ReplyCount   int
	LastReplyAt  *time.Time
	RootCreated  time.Time
	Unread       bool
	Muted        bool
	Reason       string
}

func threadAllowedOnRoom(room db.ChatRoom) bool {
	return room.Kind == chatRoomKindChannel || room.Kind == chatRoomKindGroup || room.Kind == chatRoomKindWorkspace
}

func (s *ChatService) resolveThreadRoot(
	ctx context.Context, room db.ChatRoom, messageID string,
) (db.ChatMessage, error) {
	anchorWS := roomAnchorWorkspaceID(room)
	msg, err := s.q.GetChatMessageInRoom(ctx, db.GetChatMessageInRoomParams{
		ID: messageID, RoomID: room.ID, WorkspaceID: anchorWS,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.ChatMessage{}, errChatThreadNotFound()
	}
	if err != nil {
		return db.ChatMessage{}, err
	}
	if msg.ThreadRootID.Valid {
		return db.ChatMessage{}, errChatThreadInvalidRoot()
	}
	return msg, nil
}

// ListThreadMessages returns the root plus replies for a thread.
func (s *ChatService) ListThreadMessages(
	ctx context.Context, userID, workspaceID, roomID, threadRootID string, in ListChatMessagesInput,
) ([]ChatMessageRow, error) {
	room, err := s.authorizeRoomRead(ctx, userID, workspaceID, roomID)
	if err != nil {
		return nil, err
	}
	if !threadAllowedOnRoom(room) {
		return nil, errChatThreadNotFound()
	}
	if _, err := s.resolveThreadRoot(ctx, room, threadRootID); err != nil {
		return nil, err
	}
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
	rows, err := s.q.ListChatThreadMessages(ctx, db.ListChatThreadMessagesParams{
		RoomID:       room.ID,
		WorkspaceID:  roomAnchorWorkspaceID(room),
		ThreadRootID: threadRootID,
		BeforeAt:     before,
		MsgLimit:     int32(limit),
	})
	if err != nil {
		return nil, err
	}
	out := make([]ChatMessageRow, 0, len(rows))
	for i := len(rows) - 1; i >= 0; i-- {
		out = append(out, chatMessageRowFromThreadListRow(rows[i], userID))
	}
	unread, err := s.threadUnreadForViewer(ctx, userID, threadRootID)
	if err != nil {
		return nil, err
	}
	for i := range out {
		if out[i].ID == threadRootID {
			out[i].ThreadUnread = unread
		}
	}
	return out, nil
}

// SendThreadReply posts a reply into a thread (one level only).
func (s *ChatService) SendThreadReply(
	ctx context.Context, userID, workspaceID, roomID, threadRootID string, in SendChatMessageInput,
) (ChatMessageRow, error) {
	if err := validateChatMessageBody(in.Body); err != nil {
		return ChatMessageRow{}, err
	}
	room, err := s.authorizeRoomMember(ctx, userID, workspaceID, roomID)
	if err != nil {
		return ChatMessageRow{}, err
	}
	if !threadAllowedOnRoom(room) {
		return ChatMessageRow{}, errChatThreadNotFound()
	}
	root, err := s.resolveThreadRoot(ctx, room, threadRootID)
	if err != nil {
		return ChatMessageRow{}, err
	}
	if err := s.requireCanSendMessageInRoom(ctx, userID, room); err != nil {
		return ChatMessageRow{}, err
	}

	body := strings.TrimSpace(in.Body)
	clientMsgID := strings.TrimSpace(in.ClientMsgID)
	if err := validateClientMsgID(clientMsgID); err != nil {
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

	orgID := roomOrganizationID(room)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ChatMessageRow{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)

	var clientMsg pgtype.Text
	if clientMsgID != "" {
		clientMsg = pgtype.Text{String: clientMsgID, Valid: true}
	}
	replyTo := pgtype.Text{String: threadRootID, Valid: true}
	msg, err := q.CreateChatMessage(ctx, db.CreateChatMessageParams{
		ID:               util.NewID(),
		RoomID:           room.ID,
		WorkspaceID:      anchorWS,
		SenderID:         userID,
		SenderKind:       string(audit.KindHuman),
		Body:             body,
		ReplyToMessageID: replyTo,
		ClientMsgID:      clientMsg,
		ThreadRootID:     pgtype.Text{String: threadRootID, Valid: true},
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
	repliedAt := msg.CreatedAt
	if _, err := q.BumpChatThreadReplyStats(ctx, db.BumpChatThreadReplyStatsParams{
		RepliedAt:    repliedAt,
		ThreadRootID: threadRootID,
		RoomID:       room.ID,
		WorkspaceID:  anchorWS,
	}); err != nil {
		return ChatMessageRow{}, err
	}

	now := repliedAt.Time
	if err := s.ensureThreadFollowerTx(ctx, q, orgID, anchorWS, room.ID, threadRootID, root.SenderID, chatThreadFollowAuthor, &now); err != nil {
		return ChatMessageRow{}, err
	}
	if err := s.ensureThreadFollowerTx(ctx, q, orgID, anchorWS, room.ID, threadRootID, userID, chatThreadFollowReplied, &now); err != nil {
		return ChatMessageRow{}, err
	}

	mentionedUserIDs, err := s.resolveMentionRecipients(ctx, userID, room, body)
	if err != nil {
		return ChatMessageRow{}, err
	}
	if len(mentionedUserIDs) > 0 {
		meta, err := encodeMentionsMetadata(msg.Metadata, mentionedUserIDs)
		if err != nil {
			return ChatMessageRow{}, err
		}
		msg, err = q.UpdateChatMessageMetadata(ctx, db.UpdateChatMessageMetadataParams{
			ID: msg.ID, RoomID: room.ID, WorkspaceID: anchorWS, Metadata: meta,
		})
		if err != nil {
			return ChatMessageRow{}, err
		}
		for _, mid := range mentionedUserIDs {
			if err := s.ensureThreadFollowerTx(ctx, q, orgID, anchorWS, room.ID, threadRootID, mid, chatThreadFollowMentioned, nil); err != nil {
				return ChatMessageRow{}, err
			}
		}
	}
	if priority := normalizeMessagePriority(in.Priority); priority != "" {
		meta, err := encodeMessagePriorityMetadata(msg.Metadata, priority)
		if err != nil {
			return ChatMessageRow{}, err
		}
		msg, err = q.UpdateChatMessageMetadata(ctx, db.UpdateChatMessageMetadataParams{
			ID: msg.ID, RoomID: room.ID, WorkspaceID: anchorWS, Metadata: meta,
		})
		if err != nil {
			return ChatMessageRow{}, err
		}
	}
	_ = q.TouchChatRoomUpdatedAt(ctx, room.ID)
	if err := tx.Commit(ctx); err != nil {
		return ChatMessageRow{}, err
	}

	u, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return ChatMessageRow{}, err
	}
	s.publishCreatedChatMessage(ctx, room, msg.ID)
	s.publishChatRoomEvent(ctx, room.ID, Event{
		Type: "chat.thread.replied",
		Payload: map[string]string{
			"room_id": room.ID, "thread_root_id": threadRootID, "message_id": msg.ID,
		},
	})
	s.publishMentionNotifications(ctx, room, userID, msg.ID, mentionedUserIDs)
	s.notifyThreadFollowers(ctx, room, userID, threadRootID, msg.ID)
	return chatMessageRowFromDB(msg, u.DisplayName), nil
}

// FollowThread follows or unmutes a thread for the caller.
func (s *ChatService) FollowThread(ctx context.Context, userID, workspaceID, threadRootID string) error {
	room, root, err := s.loadThreadRootAcrossRooms(ctx, userID, workspaceID, threadRootID)
	if err != nil {
		return err
	}
	if !threadAllowedOnRoom(room) {
		return errChatThreadNotFound()
	}
	orgID := roomOrganizationID(room)
	anchorWS := roomAnchorWorkspaceID(room)
	if _, err := s.q.GetChatThreadFollower(ctx, db.GetChatThreadFollowerParams{
		ThreadRootID: root.ID, UserID: userID,
	}); errors.Is(err, pgx.ErrNoRows) {
		return s.ensureThreadFollowerTx(ctx, s.q, orgID, anchorWS, room.ID, root.ID, userID, chatThreadFollowManual, nil)
	} else if err != nil {
		return err
	}
	return s.q.UnmuteChatThreadFollower(ctx, db.UnmuteChatThreadFollowerParams{
		ThreadRootID: root.ID, UserID: userID,
	})
}

// UnfollowThread mutes a thread (keeps the row so auto-follow does not revive it).
func (s *ChatService) UnfollowThread(ctx context.Context, userID, workspaceID, threadRootID string) error {
	_, root, err := s.loadThreadRootAcrossRooms(ctx, userID, workspaceID, threadRootID)
	if err != nil {
		return err
	}
	return s.q.MuteChatThreadFollower(ctx, db.MuteChatThreadFollowerParams{
		ThreadRootID: root.ID, UserID: userID,
	})
}

// MarkThreadRead updates last_read_at for the caller on a thread.
func (s *ChatService) MarkThreadRead(ctx context.Context, userID, workspaceID, threadRootID string) error {
	room, root, err := s.loadThreadRootAcrossRooms(ctx, userID, workspaceID, threadRootID)
	if err != nil {
		return err
	}
	orgID := roomOrganizationID(room)
	anchorWS := roomAnchorWorkspaceID(room)
	now := time.Now().UTC()
	if err := s.ensureThreadFollowerTx(ctx, s.q, orgID, anchorWS, room.ID, root.ID, userID, chatThreadFollowManual, &now); err != nil {
		return err
	}
	return s.q.MarkChatThreadRead(ctx, db.MarkChatThreadReadParams{
		ThreadRootID: root.ID,
		UserID:       userID,
		LastReadAt:   pgtype.Timestamptz{Time: now, Valid: true},
	})
}

// ListFollowedThreads returns threads the caller follows (optionally unread only).
func (s *ChatService) ListFollowedThreads(
	ctx context.Context, userID, workspaceID string, unreadOnly bool, limit int,
) ([]ChatThreadSummary, error) {
	if _, err := s.workspaceForChat(ctx, userID, workspaceID); err != nil {
		return nil, err
	}
	if limit <= 0 {
		limit = defaultChatMessageLimit
	}
	if limit > maxChatMessageLimit {
		limit = maxChatMessageLimit
	}
	rows, err := s.q.ListChatThreadsForFollower(ctx, db.ListChatThreadsForFollowerParams{
		UserID:      userID,
		WorkspaceID: workspaceID,
		UnreadOnly:  unreadOnly,
		ResultLimit: int32(limit),
	})
	if err != nil {
		return nil, err
	}
	out := make([]ChatThreadSummary, 0, len(rows))
	for _, row := range rows {
		sum := ChatThreadSummary{
			ThreadRootID: row.ThreadRootID,
			RoomID:       row.RoomID,
			WorkspaceID:  row.WorkspaceID,
			RootBody:     row.RootBody,
			RootSenderID: row.RootSenderID,
			ReplyCount:   int(row.ReplyCount),
			RootCreated:  row.RootCreatedAt.Time,
			Unread:       boolFromDriver(row.Unread),
			Muted:        row.Muted,
			Reason:       row.Reason,
		}
		if row.LastReplyAt.Valid {
			t := row.LastReplyAt.Time
			sum.LastReplyAt = &t
		}
		out = append(out, sum)
	}
	return out, nil
}

func (s *ChatService) loadThreadRootAcrossRooms(
	ctx context.Context, userID, workspaceID, threadRootID string,
) (db.ChatRoom, db.ChatMessage, error) {
	if _, err := s.workspaceForChat(ctx, userID, workspaceID); err != nil {
		return db.ChatRoom{}, db.ChatMessage{}, err
	}
	msg, err := s.q.GetChatMessageByID(ctx, threadRootID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.ChatRoom{}, db.ChatMessage{}, errChatThreadNotFound()
	}
	if err != nil {
		return db.ChatRoom{}, db.ChatMessage{}, err
	}
	if msg.DeletedAt.Valid || msg.ThreadRootID.Valid {
		return db.ChatRoom{}, db.ChatMessage{}, errChatThreadNotFound()
	}
	room, err := s.authorizeRoomRead(ctx, userID, workspaceID, msg.RoomID)
	if err != nil {
		if errors.Is(err, ErrForbidden) || errors.Is(err, ErrNotFound) {
			return db.ChatRoom{}, db.ChatMessage{}, errChatThreadNotFound()
		}
		return db.ChatRoom{}, db.ChatMessage{}, err
	}
	return room, msg, nil
}

func (s *ChatService) ensureThreadFollowerTx(
	ctx context.Context, q *db.Queries,
	orgID, workspaceID, roomID, threadRootID, userID, reason string,
	lastRead *time.Time,
) error {
	if strings.TrimSpace(userID) == "" {
		return nil
	}
	var lr pgtype.Timestamptz
	if lastRead != nil {
		lr = pgtype.Timestamptz{Time: *lastRead, Valid: true}
	}
	return q.UpsertChatThreadFollower(ctx, db.UpsertChatThreadFollowerParams{
		ID:             util.NewID(),
		OrganizationID: orgID,
		WorkspaceID:    workspaceID,
		RoomID:         roomID,
		ThreadRootID:   threadRootID,
		UserID:         userID,
		Reason:         reason,
		LastReadAt:     lr,
	})
}

func (s *ChatService) threadUnreadForViewer(ctx context.Context, userID, threadRootID string) (bool, error) {
	f, err := s.q.GetChatThreadFollower(ctx, db.GetChatThreadFollowerParams{
		ThreadRootID: threadRootID, UserID: userID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	root, err := s.q.GetChatMessageByID(ctx, threadRootID)
	if err != nil {
		return false, err
	}
	if !root.LastReplyAt.Valid {
		return false, nil
	}
	if !f.LastReadAt.Valid {
		return true, nil
	}
	return root.LastReplyAt.Time.After(f.LastReadAt.Time), nil
}

func (s *ChatService) notifyThreadFollowers(
	ctx context.Context, room db.ChatRoom, senderID, threadRootID, messageID string,
) {
	ids, err := s.q.ListChatThreadFollowerUserIDs(ctx, threadRootID)
	if err != nil {
		return
	}
	for _, id := range ids {
		if id == "" || id == senderID {
			continue
		}
		s.pub.SendToUser(ctx, id, Event{
			Type: "chat.thread.replied",
			Payload: map[string]string{
				"room_id": room.ID, "thread_root_id": threadRootID, "message_id": messageID,
			},
		})
	}
}

func chatMessageRowFromThreadListRow(row db.ListChatThreadMessagesRow, viewerID string) ChatMessageRow {
	out := chatMessageRowFromMessageFields(
		row.ID, row.RoomID, row.WorkspaceID, row.SenderID, row.SenderDisplayName,
		row.Kind, row.Body, row.Metadata, row.ReplyToMessageID, row.EditedAt, row.CreatedAt, viewerID,
	)
	out.ClientMsgID = row.ClientMsgID.String
	applyThreadFields(&out, row.ThreadRootID, row.ReplyCount, row.LastReplyAt)
	return out
}

func boolFromDriver(v any) bool {
	switch t := v.(type) {
	case bool:
		return t
	case int64:
		return t != 0
	case int32:
		return t != 0
	case int:
		return t != 0
	default:
		return false
	}
}
