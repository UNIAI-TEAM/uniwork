package service

import (
	"context"
	"log/slog"
	"time"

	"github.com/unicomhub/uniwork/server/internal/files"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Chat file and voice messages are read straight from storage (UNI-1633): a
// message the caller may read carries presigned URLs, signed when the message
// is loaded, and no route streams the bytes through the API. The URLs are
// signed per viewer and expire (files.MaxResolveURLTTL at most), so they live
// only in responses, never in the stored metadata or a realtime frame.

// signChatMedia fills the read URLs of the file and voice messages in rows,
// all from room, which the caller has already authorized for reading. Signing
// is best effort: a file that cannot be signed (not ready, deleted, storage
// without presign such as the local backend) leaves its URLs empty and the
// message still loads. A row written before the FileService cutover carries
// no file id and gets no URL; files-backfill moves those rows.
func (s *ChatService) signChatMedia(ctx context.Context, room db.ChatRoom, rows []ChatMessageRow) {
	if s.files == nil || len(rows) == 0 {
		return
	}
	var all, attachments, thumbs []files.FileID
	for _, row := range rows {
		switch {
		case row.File != nil && row.File.FileID != "":
			id := files.FileID(row.File.FileID)
			all = append(all, id)
			attachments = append(attachments, id)
			if fileThumbnailable(row.File.ContentType) {
				thumbs = append(thumbs, id)
			}
		case row.Voice != nil && row.Voice.FileID != "":
			all = append(all, files.FileID(row.Voice.FileID))
		}
	}
	if len(all) == 0 {
		return
	}
	scope := chatFileScope(room)
	inline := s.resolveChatMedia(ctx, scope, files.DispositionInline, "", all)
	download := s.resolveChatMedia(ctx, scope, files.DispositionAttachment, "", attachments)
	thumb := s.resolveChatMedia(ctx, scope, files.DispositionInline, files.VariantThumb, thumbs)

	for i := range rows {
		row := &rows[i]
		switch {
		case row.File != nil && row.File.FileID != "":
			id := files.FileID(row.File.FileID)
			original, ok := inline[id]
			if !ok {
				continue
			}
			info := *row.File
			info.URL, info.URLExpiresAt = original.URL, original.URLExpiresAt
			info.ThumbURL = info.URL
			if t, ok := thumb[id]; ok {
				info.ThumbURL = t.URL
				info.URLExpiresAt = earlierTime(info.URLExpiresAt, t.URLExpiresAt)
			}
			if d, ok := download[id]; ok {
				info.DownloadURL = d.URL
				info.URLExpiresAt = earlierTime(info.URLExpiresAt, d.URLExpiresAt)
			}
			row.File = &info
		case row.Voice != nil && row.Voice.FileID != "":
			signed, ok := inline[files.FileID(row.Voice.FileID)]
			if !ok {
				continue
			}
			info := *row.Voice
			info.URL, info.URLExpiresAt = signed.URL, signed.URLExpiresAt
			row.Voice = &info
		}
	}
}

// signChatMediaRow is signChatMedia for one message.
func (s *ChatService) signChatMediaRow(ctx context.Context, room db.ChatRoom, row ChatMessageRow) ChatMessageRow {
	rows := []ChatMessageRow{row}
	s.signChatMedia(ctx, room, rows)
	return rows[0]
}

// resolveChatMedia signs one batch and keeps the ids that got a URL. A batch
// refusal (a mode mismatch is a module bug) is logged and signs nothing.
func (s *ChatService) resolveChatMedia(
	ctx context.Context, scope files.Scope, disposition files.Disposition, variant files.Variant, ids []files.FileID,
) map[files.FileID]files.Resolved {
	out := map[files.FileID]files.Resolved{}
	if len(ids) == 0 {
		return out
	}
	resolved, err := s.files.ResolveMany(ctx, files.ResolveInput{
		Scope: scope, Mode: files.ReadPresign, Disposition: disposition, Variant: variant, FileIDs: ids,
	})
	if err != nil {
		slog.WarnContext(ctx, "chat media: sign failed", "error", err, "organization_id", scope.OrganizationID)
		return out
	}
	for i, r := range resolved {
		if r.Err == nil && r.URL != "" && i < len(ids) {
			out[ids[i]] = r
		}
	}
	return out
}

func earlierTime(a, b time.Time) time.Time {
	if b.Before(a) {
		return b
	}
	return a
}
