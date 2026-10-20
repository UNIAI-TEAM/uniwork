package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// ChatForwardedFrom names the original author of a forwarded message. It
// carries no room: the target room never learns where the message came from.
type ChatForwardedFrom struct {
	SenderID   string    `json:"sender_id"`
	SenderName string    `json:"sender_name"`
	SentAt     time.Time `json:"sent_at"`
}

type ForwardChatMessageInput struct {
	TargetRoomIDs []string
	// Comment, when set, is sent as the caller's own text message just before
	// the forwarded copy in every target room.
	Comment string
}

type ChatForwardedMessage struct {
	RoomID    string
	MessageID string
}

const maxChatForwardTargets = 10

// chatForwardMediaKeys are the metadata keys a forwarded file or voice note
// keeps: the file reference and its verified snapshot, nothing room-bound.
var chatForwardMediaKeys = []string{"file_id", "filename", "content_type", "size_bytes", "duration_ms"}

func errChatForwardKind() error {
	return coded(http.StatusBadRequest, "chat_forward_kind", "loại tin này không chuyển tiếp được")
}

func errChatForwardDisabled() error {
	return coded(http.StatusForbidden, "chat_forward_disabled", "phòng này không cho phép chuyển tiếp tin nhắn")
}

// errChatForwardTarget wraps a send refusal in one target room. The room id is
// echoed only after the caller proved membership of that room, so it reveals
// nothing the caller did not already know.
func errChatForwardTarget(roomID string, cause error) error {
	return CodedError{
		Code: "chat_forward_target_refused", Status: http.StatusForbidden,
		Msg: "không gửi được vào một cuộc trò chuyện đã chọn", Err: cause,
		Fields: map[string]any{"room_id": roomID},
	}
}

type chatForwardTarget struct {
	room     db.ChatRoom
	mentions chatMentions // of the comment
	fileID   files.FileID
}

// ForwardChatMessage copies one message into up to ten rooms the caller may
// send in. It is all or nothing: every target is checked before the first
// write and every copy commits in one transaction, so a refused room leaves
// no copy anywhere. Each copy is an ordinary message of the caller's (same
// notifications, unread and realtime frames as a send) that carries
// forwarded_from, and each writes one chat.message.forwarded audit row.
func (s *ChatService) ForwardChatMessage(
	ctx context.Context, userID, workspaceID, messageID string, in ForwardChatMessageInput,
) ([]ChatForwardedMessage, error) {
	targetIDs := uniqueUserIDs(in.TargetRoomIDs) // ULIDs, like user ids
	if len(targetIDs) == 0 || len(targetIDs) > maxChatForwardTargets {
		return nil, Invalid("chọn từ 1 đến 10 cuộc trò chuyện")
	}
	comment := strings.TrimSpace(in.Comment)
	if comment != "" {
		if err := validateChatMessageBody(comment); err != nil {
			return nil, err
		}
	}
	source, msg, err := s.loadMessageForLink(ctx, userID, workspaceID, messageID)
	if err != nil {
		return nil, err
	}
	if err := s.requireMayForwardFrom(ctx, userID, workspaceID, source); err != nil {
		return nil, err
	}
	purpose, err := chatForwardPurpose(msg)
	if err != nil {
		return nil, err
	}
	from, err := s.chatForwardOrigin(ctx, msg)
	if err != nil {
		return nil, err
	}
	previewID, err := s.chatForwardPreviewID(ctx, msg)
	if err != nil {
		return nil, err
	}

	targets := make([]chatForwardTarget, 0, len(targetIDs))
	for _, id := range targetIDs {
		room, err := s.authorizeRoomMember(ctx, userID, workspaceID, id)
		if err != nil {
			return nil, err
		}
		if err := s.requireCanSendInRoom(ctx, userID, room.ID, room); err != nil {
			return nil, errChatForwardTarget(room.ID, err)
		}
		t := chatForwardTarget{room: room}
		if comment != "" {
			if t.mentions, err = s.resolveMentionRecipients(ctx, userID, room, comment); err != nil {
				return nil, errChatForwardTarget(room.ID, err)
			}
		}
		targets = append(targets, t)
	}
	staged, err := s.forwardFiles(ctx, userID, source, msg, purpose, targets)
	defer func() {
		// Copies that never got claimed (a failed commit) are reclaimed now
		// instead of waiting for the claim window; a claimed one is kept.
		for scope, id := range staged {
			s.cancelStagedUpload(ctx, audit.User(userID), scope, id)
		}
	}()
	if err != nil {
		return nil, err
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	type written struct {
		target  chatForwardTarget
		comment db.ChatMessage
		copy    db.ChatMessage
	}
	out := make([]written, 0, len(targets))
	for _, t := range targets {
		w := written{target: t}
		if comment != "" {
			if w.comment, err = s.insertForwardComment(ctx, q, userID, t, comment); err != nil {
				return nil, err
			}
		}
		if w.copy, err = s.insertForwardCopy(ctx, q, userID, msg, from, purpose, t); err != nil {
			return nil, err
		}
		if err := linkForwardPreview(ctx, q, userID, t.room, w.copy, previewID); err != nil {
			return nil, err
		}
		if err := auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: t.room.OrganizationID, WorkspaceID: roomAnchorWorkspaceID(t.room),
			Actor: Human(userID), Action: audit.ActionChatMessageForwarded,
			ResourceType: "chat_message", ResourceID: w.copy.ID,
			Metadata: map[string]any{
				"room_id": t.room.ID, "source_message_id": msg.ID, "source_room_id": source.ID,
			},
		}); err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	clear(staged)

	result := make([]ChatForwardedMessage, 0, len(out))
	for _, w := range out {
		room := w.target.room
		_ = s.q.UpdateChatRoomMemberLastRead(ctx, db.UpdateChatRoomMemberLastReadParams{
			RoomID: room.ID, UserID: userID, LastReadAt: w.copy.CreatedAt,
		})
		_ = s.q.TouchChatRoomUpdatedAt(ctx, room.ID)
		if w.comment.ID != "" {
			s.publishCreatedChatMessage(ctx, room, w.comment.ID, userID, "")
			s.publishMentionNotifications(ctx, room, userID, w.comment.ID, "", w.target.mentions.Recipients)
		}
		s.publishCreatedChatMessage(ctx, room, w.copy.ID, userID, "")
		result = append(result, ChatForwardedMessage{RoomID: room.ID, MessageID: w.copy.ID})
	}
	return result, nil
}

// requireMayForwardFrom: reading the source room is enough unless the room
// turned allow_forward off, which leaves forwarding to its moderators.
func (s *ChatService) requireMayForwardFrom(ctx context.Context, userID, workspaceID string, room db.ChatRoom) error {
	if memberPermissionsFromRaw(room.MemberPermissions).AllowForward {
		return nil
	}
	member, err := s.q.GetActiveChatRoomMember(ctx, db.GetActiveChatRoomMemberParams{RoomID: room.ID, UserID: userID})
	if errors.Is(err, pgx.ErrNoRows) {
		return errChatForwardDisabled()
	}
	if err != nil {
		return err
	}
	wsMember, err := s.ws.RequireMember(ctx, workspaceID, userID)
	if err != nil {
		return err
	}
	if !canModerateChatRoom(userID, member, room, wsMember) {
		return errChatForwardDisabled()
	}
	return nil
}

// chatForwardPurpose refuses the kinds that only make sense in their own room
// (polls, notes, reminders, posts, call logs and their AI summaries, system
// lines) and returns the file purpose of an attachment ("" for text).
func chatForwardPurpose(msg db.ChatMessage) (files.UploadPurpose, error) {
	switch msg.Kind {
	case "text":
		if voiceCallSummaryFromMetadata(msg.Kind, msg.Metadata) != nil {
			return "", errChatForwardKind()
		}
		return "", nil
	case "file", "voice":
		// A row from before the FileService cutover has no reference to copy.
		if !msg.FileID.Valid || msg.FileID.String == "" {
			return "", errChatForwardKind()
		}
		if msg.Kind == "voice" {
			return files.ChatVoice, nil
		}
		return files.ChatAttachment, nil
	default:
		return "", errChatForwardKind()
	}
}

// chatForwardOrigin is the author shown on the copy. Forwarding a forwarded
// message keeps naming the first author, not the person in between.
func (s *ChatService) chatForwardOrigin(ctx context.Context, msg db.ChatMessage) (ChatForwardedFrom, error) {
	if prev := decodeChatMessageMetadata(msg.Metadata).ForwardedFrom; prev != nil {
		return *prev, nil
	}
	from := ChatForwardedFrom{SenderID: msg.SenderID, SentAt: msg.CreatedAt.Time}
	u, err := s.q.GetUserByID(ctx, msg.SenderID)
	if err == nil {
		from.SenderName = u.DisplayName
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return ChatForwardedFrom{}, err
	}
	return from, nil
}

// forwardFiles finds the file each target's copy references. FileService only
// serves a chat file inside the scope it was uploaded to (organization plus
// the room's anchor workspace), so a target in the source's scope shares the
// source file - a second live reference, collected only when both are gone -
// and a target in another scope gets its own copy of the bytes, staged here
// and claimed in the commit. It never widens the source room's scope. The
// returned map holds the copies still to claim, for the caller to cancel.
func (s *ChatService) forwardFiles(
	ctx context.Context, userID string, source db.ChatRoom, msg db.ChatMessage,
	purpose files.UploadPurpose, targets []chatForwardTarget,
) (map[files.Scope]files.FileID, error) {
	staged := map[files.Scope]files.FileID{}
	if purpose == "" {
		return staged, nil
	}
	if s.files == nil {
		return staged, filesError(files.StorageUnavailable(errChatFilesNotConfigured))
	}
	srcScope := chatFileScope(source)
	srcID := files.FileID(msg.FileID.String)
	for i := range targets {
		scope := chatFileScope(targets[i].room)
		if scope == srcScope {
			targets[i].fileID = srcID
			continue
		}
		if id, ok := staged[scope]; ok {
			targets[i].fileID = id
			continue
		}
		rd, err := s.files.Open(ctx, files.OpenInput{Scope: srcScope, FileID: srcID})
		if err != nil {
			return staged, filesError(err)
		}
		up, err := s.files.Upload(ctx, files.UploadInput{
			Actor: audit.User(userID), Purpose: purpose, Scope: scope,
			IdempotencyKey: "chat/forward/" + msg.ID + "/" + util.NewID(),
			Filename:       rd.File.Filename, Body: rd.Body,
		})
		_ = rd.Close()
		if err != nil {
			return staged, filesError(err)
		}
		staged[scope] = up.File.ID
		targets[i].fileID = up.File.ID
	}
	return staged, nil
}

func (s *ChatService) insertForwardComment(
	ctx context.Context, q *db.Queries, userID string, t chatForwardTarget, body string,
) (db.ChatMessage, error) {
	meta, err := buildChatTextMessageMetadata(t.mentions, "")
	if err != nil {
		return db.ChatMessage{}, err
	}
	msg, err := q.CreateChatMessage(ctx, db.CreateChatMessageParams{
		ID: util.NewID(), RoomID: t.room.ID, OrganizationID: t.room.OrganizationID,
		WorkspaceID: roomAnchorWorkspaceID(t.room), SenderID: userID, SenderKind: string(audit.KindHuman),
		Body: body, Metadata: meta,
	})
	if err != nil {
		return db.ChatMessage{}, err
	}
	if err := requestChatLinkPreview(ctx, q, userID, t.room, msg.ID, body); err != nil {
		return db.ChatMessage{}, err
	}
	return msg, emitChatMessageNotifications(ctx, q, t.room, userID, msg.ID, "", "", t.mentions)
}

// insertForwardCopy writes the copy with the source's body and, for an
// attachment, its file snapshot, claiming the target's file reference in the
// same transaction. Reactions, pins, mentions and priority stay behind.
func (s *ChatService) insertForwardCopy(
	ctx context.Context, q *db.Queries, userID string, src db.ChatMessage, from ChatForwardedFrom,
	purpose files.UploadPurpose, t chatForwardTarget,
) (db.ChatMessage, error) {
	fields := map[string]any{"forwarded_from": from}
	if purpose != "" {
		var srcMeta map[string]json.RawMessage
		if err := json.Unmarshal(src.Metadata, &srcMeta); err != nil {
			return db.ChatMessage{}, err
		}
		for _, key := range chatForwardMediaKeys {
			if v, ok := srcMeta[key]; ok {
				fields[key] = v
			}
		}
		fields["file_id"] = string(t.fileID)
	}
	meta, err := json.Marshal(fields)
	if err != nil {
		return db.ChatMessage{}, err
	}
	id, anchorWS := util.NewID(), roomAnchorWorkspaceID(t.room)
	var msg db.ChatMessage
	switch src.Kind {
	case "text":
		msg, err = q.CreateChatMessage(ctx, db.CreateChatMessageParams{
			ID: id, RoomID: t.room.ID, OrganizationID: t.room.OrganizationID, WorkspaceID: anchorWS,
			SenderID: userID, SenderKind: string(audit.KindHuman), Body: src.Body, Metadata: meta,
		})
	default:
		scope, actor := chatFileScope(t.room), audit.User(userID)
		claimed, claimErr := s.files.ClaimInTx(ctx, q, files.ClaimInput{
			Actor: actor, Purpose: purpose, Scope: scope, FileIDs: []files.FileID{t.fileID},
		})
		if claimErr != nil {
			return db.ChatMessage{}, filesError(claimErr)
		}
		fileID := pgtype.Text{String: string(t.fileID), Valid: true}
		if src.Kind == "voice" {
			msg, err = q.CreateChatVoiceMessage(ctx, db.CreateChatVoiceMessageParams{
				ID: id, RoomID: t.room.ID, OrganizationID: t.room.OrganizationID, WorkspaceID: anchorWS,
				SenderID: userID, SenderKind: string(audit.KindHuman), Metadata: meta, FileID: fileID,
			})
		} else {
			msg, err = q.CreateChatFileMessage(ctx, db.CreateChatFileMessageParams{
				ID: id, RoomID: t.room.ID, OrganizationID: t.room.OrganizationID, WorkspaceID: anchorWS,
				SenderID: userID, SenderKind: string(audit.KindHuman), Body: src.Body, Metadata: meta, FileID: fileID,
			})
			// A copy in a new scope has no thumbnail yet; a shared file already has one.
			if err == nil && string(t.fileID) != src.FileID.String && len(claimed) == 1 {
				err = requestFileThumbnail(ctx, q, actor, claimed[0], scope)
			}
		}
	}
	if err != nil {
		return db.ChatMessage{}, err
	}
	return msg, emitChatMessageNotifications(ctx, q, t.room, userID, msg.ID, "", "", chatMentions{})
}

// chatForwardPreviewID is the link card the source text shows, "" when it has
// none (yet). Rooms are org-scoped, so the card is the target's organization's.
func (s *ChatService) chatForwardPreviewID(ctx context.Context, msg db.ChatMessage) (string, error) {
	if msg.Kind != "text" {
		return "", nil
	}
	id, err := s.q.GetChatMessageLinkPreviewID(ctx, db.GetChatMessageLinkPreviewIDParams{
		OrganizationID: msg.OrganizationID, MessageID: msg.ID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return id, err
}

// linkForwardPreview gives a text copy the source's card in the forward's
// transaction, or, when the source has none yet, asks for one as a send does.
func linkForwardPreview(ctx context.Context, q *db.Queries, userID string, room db.ChatRoom, copied db.ChatMessage, previewID string) error {
	if copied.Kind != "text" {
		return nil
	}
	if previewID == "" {
		return requestChatLinkPreview(ctx, q, userID, room, copied.ID, copied.Body)
	}
	_, err := q.InsertChatMessageLinkPreview(ctx, db.InsertChatMessageLinkPreviewParams{
		MessageID: copied.ID, OrganizationID: room.OrganizationID, RoomID: room.ID, PreviewID: previewID,
	})
	return err
}
