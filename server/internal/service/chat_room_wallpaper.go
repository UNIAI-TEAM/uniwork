package service

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	chatWallpaperPresetDefault = "default"
	chatWallpaperPresetCustom  = "custom"
)

var validChatWallpaperPresets = map[string]struct{}{
	"default": {}, "sky": {}, "lavender": {}, "sunset": {}, "mint": {}, "slate": {}, "midnight": {},
	"rose": {}, "ocean": {}, "forest": {}, "sand": {}, "dawn": {}, "grape": {}, "coral": {}, "paper": {},
	"waves": {}, "grid": {}, "diagonal": {}, "hearts": {}, "bloom": {}, "leaves": {}, "stars": {}, "bubbles": {},
}

// UpdateChatRoomWallpaperPreset sets a shared room wallpaper preset (not custom upload).
func (s *ChatService) UpdateChatRoomWallpaperPreset(ctx context.Context, actorID, workspaceID, roomID, preset string) error {
	preset = strings.TrimSpace(preset)
	if preset == "" {
		return Invalid("wallpaper preset is required")
	}
	if preset != chatWallpaperPresetDefault {
		if _, ok := validChatWallpaperPresets[preset]; !ok {
			return Invalid("wallpaper preset is not allowed")
		}
	}
	room, err := s.authorizeRoomWallpaperChange(ctx, actorID, workspaceID, roomID)
	if err != nil {
		return err
	}
	return s.setRoomWallpaperPreset(ctx, actorID, room, preset)
}

// UploadRoomWallpaper stores a custom image as the room's shared wallpaper.
func (s *ChatService) UploadRoomWallpaper(ctx context.Context, userID, workspaceID, roomID, filename string, body io.Reader) (ChatRoomSummary, error) {
	room, err := s.authorizeRoomWallpaperChange(ctx, userID, workspaceID, roomID)
	if err != nil {
		return ChatRoomSummary{}, err
	}
	if s.files == nil {
		return ChatRoomSummary{}, collaborationUnavailable("chat_room_wallpaper_storage_missing", "hình nền chat chưa khả dụng")
	}
	scope := chatFileScope(room)
	actor := audit.User(userID)
	up, err := s.files.Upload(ctx, files.UploadInput{
		Actor:          actor,
		Purpose:        files.ChatRoomWallpaper,
		Scope:          scope,
		IdempotencyKey: "chat-room-wallpaper-" + util.NewID(),
		Filename:       filename,
		Body:           body,
	})
	if err != nil {
		return ChatRoomSummary{}, avatarUploadError(err)
	}
	newID := up.File.ID
	if err := s.setRoomWallpaperFile(ctx, userID, room, newID); err != nil {
		_ = s.files.CancelUpload(ctx, files.CancelInput{Actor: actor, Scope: scope, FileID: newID})
		return ChatRoomSummary{}, err
	}
	return s.roomSummaryWithWallpaper(ctx, userID, room.ID)
}

func (s *ChatService) authorizeRoomWallpaperChange(ctx context.Context, userID, workspaceID, roomID string) (db.ChatRoom, error) {
	room, err := s.authorizeRoom(ctx, userID, workspaceID, roomID)
	if err != nil {
		return db.ChatRoom{}, err
	}
	if room.Kind == chatRoomKindDM {
		return room, nil
	}
	actorMember, err := s.q.GetActiveChatRoomMember(ctx, db.GetActiveChatRoomMemberParams{
		RoomID: roomID, UserID: userID,
	})
	if err != nil {
		return db.ChatRoom{}, err
	}
	wsMember, err := s.ws.RequireMember(ctx, workspaceID, userID)
	if err != nil {
		return db.ChatRoom{}, err
	}
	if !canModerateChatRoom(userID, actorMember, room, wsMember) {
		return db.ChatRoom{}, ErrForbidden
	}
	return room, nil
}

func (s *ChatService) setRoomWallpaperPreset(ctx context.Context, userID string, room db.ChatRoom, preset string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)

	prev, err := q.GetChatRoomWallpaperForUpdate(ctx, db.GetChatRoomWallpaperForUpdateParams{
		ID: room.ID, OrganizationID: room.OrganizationID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	var replaces []files.FileID
	if prev.WallpaperFileID.Valid && prev.WallpaperFileID.String != "" {
		replaces = []files.FileID{files.FileID(prev.WallpaperFileID.String)}
	}
	if err := releaseFilesInTx(ctx, s.files, q, replaces); err != nil {
		return err
	}
	if err := q.SetChatRoomWallpaper(ctx, db.SetChatRoomWallpaperParams{
		ID: room.ID, OrganizationID: room.OrganizationID,
		WallpaperPreset: preset,
		WallpaperFileID: pgtype.Text{},
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
		Changes: map[string]audit.Change{
			"wallpaper_preset": {From: prev.WallpaperPreset, To: preset},
		},
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

func (s *ChatService) setRoomWallpaperFile(ctx context.Context, userID string, room db.ChatRoom, newID files.FileID) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)

	prev, err := q.GetChatRoomWallpaperForUpdate(ctx, db.GetChatRoomWallpaperForUpdateParams{
		ID: room.ID, OrganizationID: room.OrganizationID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	var replaces []files.FileID
	if prev.WallpaperFileID.Valid && prev.WallpaperFileID.String != "" {
		replaces = []files.FileID{files.FileID(prev.WallpaperFileID.String)}
	}
	if newID != "" {
		if _, err := s.files.ClaimInTx(ctx, q, files.ClaimInput{
			Actor: audit.User(userID), Purpose: files.ChatRoomWallpaper, Scope: chatFileScope(room),
			FileIDs: []files.FileID{newID}, Replaces: replaces,
		}); err != nil {
			return filesError(err)
		}
	}
	if err := releaseFilesInTx(ctx, s.files, q, replaces); err != nil {
		return err
	}
	cur, err := q.GetChatRoomWallpaperForUpdate(ctx, db.GetChatRoomWallpaperForUpdateParams{
		ID: room.ID, OrganizationID: room.OrganizationID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if cur.WallpaperFileID != prev.WallpaperFileID {
		return ErrConflict
	}
	nextFile := pgtype.Text{String: string(newID), Valid: newID != ""}
	if err := q.SetChatRoomWallpaper(ctx, db.SetChatRoomWallpaperParams{
		ID: room.ID, OrganizationID: room.OrganizationID,
		WallpaperPreset: chatWallpaperPresetCustom,
		WallpaperFileID: nextFile,
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
		Changes: map[string]audit.Change{
			"wallpaper": {From: prev.WallpaperPreset, To: chatWallpaperPresetCustom},
		},
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

func (s *ChatService) applyWallpaperToSummary(ctx context.Context, sum *ChatRoomSummary, scope files.Scope, preset string, fileID pgtype.Text) {
	sum.WallpaperPreset = strings.TrimSpace(preset)
	if sum.WallpaperPreset == "" {
		sum.WallpaperPreset = chatWallpaperPresetDefault
	}
	sum.WallpaperURL = s.roomWallpaperURL(ctx, sum.ID, scope, fileID, sum.WallpaperPreset)
}

func (s *ChatService) roomWallpaperURL(ctx context.Context, roomID string, scope files.Scope, fileID pgtype.Text, preset string) string {
	if preset != chatWallpaperPresetCustom || s.files == nil || !fileID.Valid || fileID.String == "" {
		return ""
	}
	resolved, err := s.files.ResolveMany(ctx, files.ResolveInput{
		Scope:       scope,
		Mode:        files.ReadPresign,
		Disposition: files.DispositionInline,
		FileIDs:     []files.FileID{files.FileID(fileID.String)},
	})
	if err != nil {
		slog.Warn("chat room wallpaper resolve", "room_id", roomID, "err", err)
		return ""
	}
	for _, r := range resolved {
		if r.Err != nil {
			slog.Warn("chat room wallpaper resolve", "room_id", roomID, "err", r.Err)
			continue
		}
		return r.URL
	}
	return ""
}

func (s *ChatService) roomSummaryWithWallpaper(ctx context.Context, userID, roomID string) (ChatRoomSummary, error) {
	room, err := s.q.GetChatRoomByID(ctx, roomID)
	if err != nil {
		return ChatRoomSummary{}, err
	}
	sum, err := s.roomSummaryWithAvatar(ctx, userID, room)
	if err != nil {
		return ChatRoomSummary{}, err
	}
	s.applyWallpaperToSummary(ctx, &sum, chatFileScope(room), room.WallpaperPreset, room.WallpaperFileID)
	return sum, nil
}

// ChatRoomWallpaperProvider tells FileService which chat_room_wallpaper files a room still shows.
type ChatRoomWallpaperProvider struct{}

func (ChatRoomWallpaperProvider) Name() string { return "chat_rooms.wallpaper" }

func (ChatRoomWallpaperProvider) Purposes() []files.UploadPurpose {
	return []files.UploadPurpose{files.ChatRoomWallpaper}
}

func (ChatRoomWallpaperProvider) HeldBy(ctx context.Context, q *db.Queries, ids []files.FileID) (map[files.FileID]files.HoldReason, error) {
	out := map[files.FileID]files.HoldReason{}
	if len(ids) == 0 {
		return out, nil
	}
	raw := make([]string, 0, len(ids))
	for _, id := range ids {
		raw = append(raw, string(id))
	}
	held, err := q.ListChatRoomWallpaperFileIDs(ctx, raw)
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
