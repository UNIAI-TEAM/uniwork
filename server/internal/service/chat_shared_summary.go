package service

import (
	"context"
	"time"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// ChatRoomSharedSummary is what the info panel shows of a room's shared
// media without paging its history: a count per kind and the newest photos.
type ChatRoomSharedSummary struct {
	Photos, GIFs, Videos, Files, Links, Voices int
	RecentPhotos                               []ChatSharedPhoto
}

// ChatSharedPhoto is one recent photo: an attachment (FileID set, URLs
// signed for the viewer) or a picker image whose URL is public.
type ChatSharedPhoto struct {
	MessageID    string
	FileID       string
	Title        string
	URL          string
	ThumbURL     string
	URLExpiresAt time.Time
	CreatedAt    time.Time
}

// RoomSharedSummary counts the room's photos, GIFs, videos, files, links and
// voice messages and returns its newest photos, behind the room read gate.
func (s *ChatService) RoomSharedSummary(
	ctx context.Context, userID, workspaceID, roomID string,
) (ChatRoomSharedSummary, error) {
	room, err := s.authorizeRoomRead(ctx, userID, workspaceID, roomID)
	if err != nil {
		return ChatRoomSharedSummary{}, err
	}
	rows, err := s.q.GetChatRoomSharedSummary(ctx, db.GetChatRoomSharedSummaryParams{
		RoomID: room.ID, WorkspaceID: roomAnchorWorkspaceID(room),
	})
	if err != nil {
		return ChatRoomSharedSummary{}, err
	}
	out := ChatRoomSharedSummary{RecentPhotos: []ChatSharedPhoto{}}
	if len(rows) == 0 {
		return out, nil
	}
	first := rows[0]
	out.Photos, out.GIFs, out.Videos = int(first.PhotoCount), int(first.GifCount), int(first.VideoCount)
	out.Files, out.Links, out.Voices = int(first.FileCount), int(first.LinkCount), int(first.VoiceCount)

	attachments := make([]ChatMessageRow, 0, len(rows))
	for _, row := range rows {
		if !row.ID.Valid {
			continue
		}
		photo := ChatSharedPhoto{MessageID: row.ID.String, CreatedAt: row.CreatedAt.Time}
		if row.MediaUrl.Valid {
			photo.URL, photo.ThumbURL, photo.Title = row.MediaUrl.String, row.MediaUrl.String, row.MediaAlt.String
			if photo.Title == "" {
				photo.Title = "media"
			}
		} else {
			attachments = append(attachments, ChatMessageRow{
				ID: row.ID.String, Kind: row.Kind.String, File: fileMessageFromMetadata(row.Kind.String, row.Metadata),
			})
		}
		out.RecentPhotos = append(out.RecentPhotos, photo)
	}
	s.signChatMedia(ctx, room, attachments)
	signed := make(map[string]*FileMessageInfo, len(attachments))
	for _, row := range attachments {
		signed[row.ID] = row.File
	}
	for i := range out.RecentPhotos {
		photo := &out.RecentPhotos[i]
		if file := signed[photo.MessageID]; file != nil {
			photo.FileID, photo.Title = file.FileID, file.Filename
			photo.URL, photo.ThumbURL, photo.URLExpiresAt = file.URL, file.ThumbURL, file.URLExpiresAt
		}
	}
	return out, nil
}
