package service

// Group avatar (UNI-1898): the image a group shows in place of its members'
// faces. It mirrors the workspace icon (workspace_icon.go): upload outside
// the transaction, claim and release inside it, presign when a room is read.
// Only a group has one: allow_change_profile gates a group's name and avatar,
// while a channel is renamed through its own settings and shows its # glyph.

import (
	"context"
	"errors"
	"io"
	"log/slog"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// UploadRoomAvatar makes an image the group's avatar. Any failure after the
// upload cancels it, so no claim is left behind.
func (s *ChatService) UploadRoomAvatar(ctx context.Context, userID, workspaceID, roomID, filename string, body io.Reader) (ChatRoomSummary, error) {
	room, err := s.authorizeRoomAvatarChange(ctx, userID, workspaceID, roomID)
	if err != nil {
		return ChatRoomSummary{}, err
	}
	if s.files == nil {
		return ChatRoomSummary{}, collaborationUnavailable("chat_room_avatar_storage_missing", "ảnh nhóm chưa khả dụng")
	}
	scope := chatFileScope(room)
	actor := audit.User(userID)
	up, err := s.files.Upload(ctx, files.UploadInput{
		Actor:          actor,
		Purpose:        files.ChatRoomAvatar,
		Scope:          scope,
		IdempotencyKey: "chat-room-avatar-" + util.NewID(),
		Filename:       filename,
		Body:           body,
	})
	if err != nil {
		return ChatRoomSummary{}, avatarUploadError(err)
	}
	newID := up.File.ID
	if err := s.setRoomAvatar(ctx, userID, room, newID); err != nil {
		_ = s.files.CancelUpload(ctx, files.CancelInput{Actor: actor, Scope: scope, FileID: newID})
		return ChatRoomSummary{}, err
	}
	return s.groupSummary(ctx, userID, roomID)
}

// RemoveRoomAvatar drops the uploaded avatar, so the group shows its members
// again. A group with no avatar is left alone and nothing is recorded.
func (s *ChatService) RemoveRoomAvatar(ctx context.Context, userID, workspaceID, roomID string) (ChatRoomSummary, error) {
	room, err := s.authorizeRoomAvatarChange(ctx, userID, workspaceID, roomID)
	if err != nil {
		return ChatRoomSummary{}, err
	}
	if room.AvatarFileID.Valid {
		if err := s.setRoomAvatar(ctx, userID, room, ""); err != nil {
			return ChatRoomSummary{}, err
		}
	}
	return s.groupSummary(ctx, userID, roomID)
}

// authorizeRoomAvatarChange is the rename rule of UpdateChatRoomSettings for a
// group: a room admin or its creator, or any member while
// allow_change_profile is on.
func (s *ChatService) authorizeRoomAvatarChange(ctx context.Context, userID, workspaceID, roomID string) (db.ChatRoom, error) {
	room, err := s.authorizeRoom(ctx, userID, workspaceID, roomID)
	if err != nil {
		return db.ChatRoom{}, err
	}
	if room.Kind != chatRoomKindGroup {
		return db.ChatRoom{}, Invalid("chỉ nhóm chat mới có ảnh nhóm")
	}
	if err := s.memberCanPerformRoomAction(ctx, userID, roomID, room, func(p ChatRoomMemberPermissions) bool {
		return p.AllowChangeProfile
	}); err != nil {
		return db.ChatRoom{}, err
	}
	return room, nil
}

// setRoomAvatar points the group at newID ("" removes the avatar), releases
// the file it showed before and records the change, in one transaction. As
// for the workspace icon, claim and release lock files rows before the room
// row: the first read is plain, and the FOR UPDATE re-read after the files
// calls turns a concurrent swap into a conflict instead of an orphan.
func (s *ChatService) setRoomAvatar(ctx context.Context, userID string, room db.ChatRoom, newID files.FileID) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)

	prev, err := q.GetChatRoomByID(ctx, room.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	var replaces []files.FileID
	if prev.AvatarFileID.Valid && prev.AvatarFileID.String != "" {
		replaces = []files.FileID{files.FileID(prev.AvatarFileID.String)}
	}
	if newID != "" {
		if _, err := s.files.ClaimInTx(ctx, q, files.ClaimInput{
			Actor: audit.User(userID), Purpose: files.ChatRoomAvatar, Scope: chatFileScope(room),
			FileIDs: []files.FileID{newID}, Replaces: replaces,
		}); err != nil {
			return filesError(err)
		}
	}
	if err := releaseFilesInTx(ctx, s.files, q, replaces); err != nil {
		return err
	}
	cur, err := q.GetChatRoomAvatarFileIDForUpdate(ctx, db.GetChatRoomAvatarFileIDForUpdateParams{ID: room.ID, OrganizationID: room.OrganizationID})
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if cur != prev.AvatarFileID {
		return ErrConflict
	}
	next := pgtype.Text{String: string(newID), Valid: newID != ""}
	if err := q.SetChatRoomAvatar(ctx, db.SetChatRoomAvatarParams{
		ID: room.ID, OrganizationID: room.OrganizationID, AvatarFileID: next,
	}); err != nil {
		return err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: room.OrganizationID,
		WorkspaceID:    roomAnchorWorkspaceID(room),
		Actor:          audit.User(userID),
		Action:         audit.ActionChatRoomSettingsUpdated,
		ResourceType:   "chat_room",
		ResourceID:     room.ID,
		Changes:        map[string]audit.Change{"avatar": {From: roomAvatarLabel(prev.AvatarFileID), To: roomAvatarLabel(next)}},
	}); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	s.publishChatRoomMembersEvent(ctx, room.ID, Event{
		Type: "chat.room.updated", Payload: map[string]string{"room_id": room.ID},
	})
	return nil
}

// roomAvatarLabel names the avatar in an audit diff: the file id, or "" for
// the members' faces.
func roomAvatarLabel(id pgtype.Text) string {
	if id.Valid && id.String != "" {
		return "file:" + id.String
	}
	return ""
}

// groupSummary is the room a group mutation answers with, avatar signed.
func (s *ChatService) groupSummary(ctx context.Context, userID, roomID string) (ChatRoomSummary, error) {
	room, err := s.q.GetChatRoomByID(ctx, roomID)
	if err != nil {
		return ChatRoomSummary{}, err
	}
	return s.roomSummaryWithAvatar(ctx, userID, room)
}

// roomSummaryWithAvatar is roomSummaryWithPreview for a dm or group row, with
// a group's uploaded avatar signed.
func (s *ChatService) roomSummaryWithAvatar(ctx context.Context, userID string, room db.ChatRoom) (ChatRoomSummary, error) {
	sum, err := s.roomSummaryWithPreview(ctx, userID, roomAnchorWorkspaceID(room), room.ID, room.Kind, room.Name, 0, memberSetKeyFromRoom(room), room.MemberPermissions)
	if err != nil {
		return ChatRoomSummary{}, err
	}
	sum.AvatarURL = s.roomAvatarURL(ctx, room.ID, chatFileScope(room), room.AvatarFileID)
	return sum, nil
}

// roomAvatarURL presigns a group's uploaded avatar. A failure returns "" and
// the client falls back to the members' faces, as the workspace icon falls
// back to its initial.
func (s *ChatService) roomAvatarURL(ctx context.Context, roomID string, scope files.Scope, fileID pgtype.Text) string {
	if s.files == nil || !fileID.Valid || fileID.String == "" {
		return ""
	}
	resolved, err := s.files.ResolveMany(ctx, files.ResolveInput{
		Scope:       scope,
		Mode:        files.ReadPresign,
		Disposition: files.DispositionInline,
		FileIDs:     []files.FileID{files.FileID(fileID.String)},
	})
	if err != nil {
		slog.Warn("chat room avatar resolve", "room_id", roomID, "err", err)
		return ""
	}
	for _, r := range resolved {
		if r.Err != nil {
			// A refused id is not a batch error; log it, or an avatar that
			// never shows (local storage cannot presign) leaves no trace.
			slog.Warn("chat room avatar resolve", "room_id", roomID, "err", r.Err)
			continue
		}
		return r.URL
	}
	return ""
}

// ChatRoomAvatarProvider tells FileService which chat_room_avatar files a
// group still shows.
type ChatRoomAvatarProvider struct{}

func (ChatRoomAvatarProvider) Name() string { return "chat_rooms.avatar" }

func (ChatRoomAvatarProvider) Purposes() []files.UploadPurpose {
	return []files.UploadPurpose{files.ChatRoomAvatar}
}

func (ChatRoomAvatarProvider) HeldBy(ctx context.Context, q *db.Queries, ids []files.FileID) (map[files.FileID]files.HoldReason, error) {
	out := map[files.FileID]files.HoldReason{}
	if len(ids) == 0 {
		return out, nil
	}
	raw := make([]string, 0, len(ids))
	for _, id := range ids {
		raw = append(raw, string(id))
	}
	held, err := q.ListChatRoomAvatarFileIDs(ctx, raw)
	if err != nil {
		return nil, err
	}
	for _, id := range held {
		if id.Valid && id.String != "" {
			out[files.FileID(id.String)] = files.HoldActive
		}
	}
	return out, nil
}
