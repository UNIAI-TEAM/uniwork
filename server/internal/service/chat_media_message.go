package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// errChatFilesNotConfigured is returned when a chat file/voice path runs
// without a files.Service wired (the integration lands with T3/T9).
var errChatFilesNotConfigured = errors.New("chat: files service is not configured")

// SetFiles attaches the shared FileService. Chat keeps the interface type so
// tests can plant filesfake.
func (s *ChatService) SetFiles(f files.Service) { s.files = f }

// FilesService exposes the wired service for handler checks that must refuse
// before doing work (parity with the previous h.Storage nil check).
func (s *ChatService) FilesService() files.Service { return s.files }

// chatMediaCommand is the one send path for file and voice messages: the bytes
// go to FileService under the purpose policy, then the reference is claimed
// and the message row written in a single transaction.
type chatMediaCommand struct {
	purpose     files.UploadPurpose
	kind        string // "file" | "voice"
	filename    string
	body        io.ReadSeeker
	durationMS  int // voice only
	replyToID   *string
	clientMsgID string
}

// AuthorizeMediaSend is the send gate of sendChatMedia, exposed so the upload
// handlers can refuse a non-member before reading a byte of the body.
func (s *ChatService) AuthorizeMediaSend(ctx context.Context, userID, workspaceID, roomID string) error {
	room, err := s.authorizeRoom(ctx, userID, workspaceID, roomID)
	if err != nil {
		return err
	}
	return s.requireCanSendMessageInRoom(ctx, userID, room)
}

// sendChatMedia validates authorization, uploads through FileService and
// commits claim + message in one transaction. client_msg_id semantics: the
// same key with the same file replays the earlier message; the same key with
// a different command is idempotency_conflict.
func (s *ChatService) sendChatMedia(
	ctx context.Context,
	userID, workspaceID, roomID string,
	in chatMediaCommand,
) (ChatMessageRow, error) {
	if s.files == nil {
		return ChatMessageRow{}, filesError(files.StorageUnavailable(errChatFilesNotConfigured))
	}
	room, err := s.authorizeRoom(ctx, userID, workspaceID, roomID)
	if err != nil {
		return ChatMessageRow{}, err
	}
	if err := s.requireCanSendMessageInRoom(ctx, userID, room); err != nil {
		return ChatMessageRow{}, err
	}
	var replyTo pgtype.Text
	if in.replyToID != nil && strings.TrimSpace(*in.replyToID) != "" {
		replyID := strings.TrimSpace(*in.replyToID)
		if _, err := s.q.GetChatMessageInRoom(ctx, db.GetChatMessageInRoomParams{
			ID: replyID, RoomID: room.ID, WorkspaceID: roomAnchorWorkspaceID(room),
		}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return ChatMessageRow{}, Invalid("tin nhắn trả lời không hợp lệ")
			}
			return ChatMessageRow{}, err
		}
		replyTo = pgtype.Text{String: replyID, Valid: true}
	}
	user, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return ChatMessageRow{}, err
	}

	// The body is hashed once here so the payload digest can join the upload
	// idempotency key: a voice note's filename is constant, so without the
	// digest a different recording under the same client_msg_id would look
	// like the same command and replay instead of conflicting. It is hashed
	// and rewound rather than read into memory: the handler hands over a
	// disk-backed part of up to 25 MiB (C7).
	sum := sha256.New()
	if _, err := io.Copy(sum, in.body); err != nil {
		return ChatMessageRow{}, Invalid("không đọc được dữ liệu tệp")
	}
	if _, err := in.body.Seek(0, io.SeekStart); err != nil {
		return ChatMessageRow{}, Invalid("không đọc được dữ liệu tệp")
	}

	scope := chatFileScope(room)
	actor := audit.User(userID)
	up, err := s.files.Upload(ctx, files.UploadInput{
		Actor:          actor,
		Purpose:        in.purpose,
		Scope:          scope,
		IdempotencyKey: chatMediaUploadKey(in.kind, room.ID, userID, in.clientMsgID, sum.Sum(nil)),
		Filename:       in.filename,
		Body:           in.body,
	})
	if err != nil {
		return ChatMessageRow{}, filesError(err)
	}

	// A send permission revoked while the bytes were in flight still stops the
	// commit; the staged upload is canceled so it does not outlive the refusal.
	if err := s.requireCanSendMessageInRoom(ctx, userID, room); err != nil {
		s.cancelStagedUpload(ctx, actor, scope, up.File.ID)
		return ChatMessageRow{}, err
	}

	msg, created, err := s.commitChatMediaMessage(ctx, userID, room, in, up.File, scope, actor, replyTo)
	if err != nil {
		// Any terminal error after the upload leaves a staged object; cancel
		// reclaims it now instead of waiting for the 24h claim window. A file
		// that did get claimed reports already_claimed and stays.
		s.cancelStagedUpload(ctx, actor, scope, up.File.ID)
		return ChatMessageRow{}, err
	}
	if created {
		_ = s.q.UpdateChatRoomMemberLastRead(ctx, db.UpdateChatRoomMemberLastReadParams{
			RoomID: room.ID, UserID: userID,
			LastReadAt: pgtype.Timestamptz{Time: msg.CreatedAt.Time, Valid: true},
		})
		_ = s.q.TouchChatRoomUpdatedAt(ctx, room.ID)
		s.publishCreatedChatMessage(ctx, room, msg.ID)
	}
	return chatMessageRowFromDB(msg, user.DisplayName), nil
}

// commitChatMediaMessage claims the staged file and inserts the message row
// inside one transaction. A client_msg_id that already names a message either
// replays (same kind and file) or conflicts (any other command). created=false
// means a retry won before or during the commit and nothing was written.
func (s *ChatService) commitChatMediaMessage(
	ctx context.Context,
	userID string,
	room db.ChatRoom,
	in chatMediaCommand,
	file files.File,
	scope files.Scope,
	actor audit.Actor,
	replyTo pgtype.Text,
) (msg db.ChatMessage, created bool, err error) {
	fileID := string(file.ID)
	meta, err := json.Marshal(chatMediaMetadata(in, file))
	if err != nil {
		return db.ChatMessage{}, false, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.ChatMessage{}, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)

	var clientMsg pgtype.Text
	if in.clientMsgID != "" {
		clientMsg = pgtype.Text{String: in.clientMsgID, Valid: true}
		existing, found, lookupErr := chatMediaExistingMessage(ctx, q, room.ID, userID, in.clientMsgID)
		if lookupErr != nil {
			return db.ChatMessage{}, false, lookupErr
		}
		if found {
			if chatMediaCommandMatches(existing, in.kind, fileID) {
				return existing, false, nil
			}
			return db.ChatMessage{}, false, errClientMsgIDConflict()
		}
	}
	if _, err := s.files.ClaimInTx(ctx, q, files.ClaimInput{
		Actor: actor, Purpose: in.purpose, Scope: scope, FileIDs: []files.FileID{file.ID},
	}); err != nil {
		return db.ChatMessage{}, false, filesError(err)
	}
	params := db.CreateChatFileMessageParams{
		ID:               util.NewID(),
		RoomID:           room.ID,
		OrganizationID:   room.OrganizationID,
		WorkspaceID:      roomAnchorWorkspaceID(room),
		SenderID:         userID,
		SenderKind:       string(audit.KindHuman),
		Metadata:         meta,
		ReplyToMessageID: replyTo,
		ClientMsgID:      clientMsg,
		FileID:           pgtype.Text{String: fileID, Valid: true},
	}
	if in.kind == "voice" {
		msg, err = q.CreateChatVoiceMessage(ctx, db.CreateChatVoiceMessageParams{
			ID:               params.ID,
			RoomID:           params.RoomID,
			OrganizationID:   params.OrganizationID,
			WorkspaceID:      params.WorkspaceID,
			SenderID:         params.SenderID,
			SenderKind:       params.SenderKind,
			Metadata:         params.Metadata,
			ReplyToMessageID: params.ReplyToMessageID,
			ClientMsgID:      params.ClientMsgID,
			FileID:           params.FileID,
		})
	} else {
		params.Body = file.Filename
		msg, err = q.CreateChatFileMessage(ctx, params)
	}
	if err != nil {
		if in.clientMsgID != "" && isUniqueViolation(err) {
			// A concurrent send under the same client_msg_id won. Replaying it
			// is safe only when the winner stored the same file.
			existing, found, lookupErr := s.existingMessageByClientMsgID(ctx, room.ID, userID, in.clientMsgID)
			if lookupErr != nil {
				return db.ChatMessage{}, false, lookupErr
			}
			if found && chatMediaCommandMatches(existing, in.kind, fileID) {
				return existing, false, nil
			}
			return db.ChatMessage{}, false, errClientMsgIDConflict()
		}
		return db.ChatMessage{}, false, err
	}
	if in.kind == "file" {
		// The timeline shows photos as thumbnails (H15); the slow lane makes them.
		if err := requestFileThumbnail(ctx, q, actor, file, scope); err != nil {
			return db.ChatMessage{}, false, err
		}
	}
	if err := emitChatMessageNotifications(ctx, q, room, userID, msg.ID, "", chatMentions{}); err != nil {
		return db.ChatMessage{}, false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.ChatMessage{}, false, err
	}
	return msg, true, nil
}

// chatMediaCommandMatches: a replayed client_msg_id resolves to the earlier
// message only when the command was the same - same message kind and the same
// verified file. Any other payload under the key is a different command.
func chatMediaCommandMatches(msg db.ChatMessage, kind, fileID string) bool {
	return msg.Kind == kind && msg.FileID.Valid && msg.FileID.String == fileID
}

// errClientMsgIDConflict reports a reused client_msg_id bound to a different
// command, at the FS-C1 idempotency_conflict code.
func errClientMsgIDConflict() error {
	return CodedError{
		Code:   files.CodeIdempotencyConflict,
		Status: http.StatusConflict,
		Msg:    "client_msg_id đã được dùng cho một yêu cầu khác",
		Err:    ErrConflict,
	}
}

// chatMediaExistingMessage is existingMessageByClientMsgID bound to a caller's
// transaction, so the in-commit check sees uncommitted rows in the same tx.
func chatMediaExistingMessage(
	ctx context.Context, q *db.Queries, roomID, senderID, clientMsgID string,
) (db.ChatMessage, bool, error) {
	msg, err := q.GetChatMessageByClientMsgID(ctx, db.GetChatMessageByClientMsgIDParams{
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

// chatMediaUploadKey scopes the FileService idempotency key so the client's
// per-send key cannot collide across rooms or senders, and binds it to the
// payload's SHA-256: the same key with the same bytes replays, the same key
// with different bytes is a different command.
func chatMediaUploadKey(kind, roomID, senderID, clientMsgID string, sum []byte) string {
	key := clientMsgID
	if key == "" {
		key = "auto/" + util.NewID()
	}
	return "chat/" + kind + "/" + roomID + "/" + senderID + "/" + key + "/" + hex.EncodeToString(sum[:8])
}

// chatFileScope is the tenant scope FileService checks on upload, claim and
// read. Chat rooms may or may not carry a workspace (org-level DMs/groups), so
// the workspace branch is optional for chat purposes.
func chatFileScope(room db.ChatRoom) files.Scope {
	return files.Scope{
		OrganizationID: room.OrganizationID,
		WorkspaceID:    roomAnchorWorkspaceID(room),
	}
}

// chatMediaMetadata is the message-level view written next to the relation.
// The verified name, type and size are copied from the files.File the upload
// (or claim) returned; files rows are immutable once ready, so the snapshot
// cannot drift. duration_ms is message metadata FileService does not own.
// No storage locator is ever written here.
func chatMediaMetadata(in chatMediaCommand, file files.File) map[string]any {
	meta := map[string]any{
		"file_id":      string(file.ID),
		"filename":     file.Filename,
		"content_type": file.ContentType,
		"size_bytes":   file.SizeBytes,
	}
	if in.durationMS > 0 {
		meta["duration_ms"] = in.durationMS
	}
	return meta
}

func (s *ChatService) cancelStagedUpload(ctx context.Context, actor audit.Actor, scope files.Scope, id files.FileID) {
	// Best-effort: the upload may already be claimed by a racing row, in which
	// case CancelUpload reports already_claimed and the reference stays.
	_ = s.files.CancelUpload(ctx, files.CancelInput{Actor: actor, Scope: scope, FileID: id})
}

// openChatMediaMessage authorizes the read and opens the file bytes through
// FileService; variant asks for a derivative (the original when there is
// none). A pre-migration row still carries an object_key instead of a
// file_id; it returns an empty Reader so the handler can serve the legacy
// object until the T9b backfill lands.
func (s *ChatService) openChatMediaMessage(
	ctx context.Context,
	userID, workspaceID, roomID, messageID, wantKind string,
	variant files.Variant,
) (ChatMessageRow, files.Reader, error) {
	room, err := s.authorizeRoomRead(ctx, userID, workspaceID, roomID)
	if err != nil {
		return ChatMessageRow{}, files.Reader{}, err
	}
	msg, err := s.q.GetChatMessageInRoom(ctx, db.GetChatMessageInRoomParams{
		ID: messageID, RoomID: roomID, WorkspaceID: roomAnchorWorkspaceID(room),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return ChatMessageRow{}, files.Reader{}, ErrNotFound
	}
	if err != nil {
		return ChatMessageRow{}, files.Reader{}, err
	}
	// The byte stream never shows the sender, so no user lookup per view.
	row := chatMessageRowFromDBForViewer(msg, "", userID)
	var infoOk bool
	switch wantKind {
	case "file":
		infoOk = row.Kind == "file" && row.File != nil
	case "voice":
		infoOk = row.Kind == "voice" && row.Voice != nil
	}
	if !infoOk {
		return ChatMessageRow{}, files.Reader{}, ErrNotFound
	}
	// The column is authoritative; the metadata view carries the same id and
	// is the fallback for a row written by a data fix that set only the
	// metadata side (no T7 writer produces that shape, but readers stay
	// tolerant).
	fileID := ""
	if msg.FileID.Valid {
		fileID = msg.FileID.String
	}
	if fileID == "" {
		switch wantKind {
		case "file":
			fileID = row.File.FileID
		case "voice":
			fileID = row.Voice.FileID
		}
	}
	if fileID == "" {
		// Legacy row: bytes still sit behind the storage object key.
		return row, files.Reader{}, nil
	}
	if s.files == nil {
		return ChatMessageRow{}, files.Reader{}, filesError(files.StorageUnavailable(errChatFilesNotConfigured))
	}
	rd, err := s.files.Open(ctx, files.OpenInput{
		Scope:   chatFileScope(room),
		FileID:  files.FileID(fileID),
		Variant: variant,
	})
	if err != nil {
		return ChatMessageRow{}, files.Reader{}, filesError(err)
	}
	return row, rd, nil
}

// releaseChatMessageFile drops the file reference of a message being deleted,
// in the same transaction as the delete. Bytes are the collector's job: the
// provider re-checks before anything is removed, and another live row holding
// the same file keeps it.
func (s *ChatService) releaseChatMessageFile(ctx context.Context, q *db.Queries, msg db.ChatMessage) error {
	if s.files == nil || !msg.FileID.Valid || msg.FileID.String == "" {
		return nil
	}
	return s.files.ReleaseInTx(ctx, q, []files.FileID{files.FileID(msg.FileID.String)})
}
