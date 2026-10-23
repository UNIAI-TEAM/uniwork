package service

import (
	"context"

	"github.com/unicomhub/uniwork/server/internal/files"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// chatFileReferenceProvider is the ReferenceProvider for chat_messages.file_id
// (FS-C1 section 6). A live row holds its file; a soft-deleted row does not,
// because DeleteChatMessage releases the reference in the delete transaction.
// HeldBy runs on the caller's transaction so the collector observes work that
// has just committed.
type chatFileReferenceProvider struct{}

func (chatFileReferenceProvider) Name() string { return "chat.messages" }

func (chatFileReferenceProvider) Purposes() []files.UploadPurpose {
	return []files.UploadPurpose{files.ChatAttachment, files.ChatVoice}
}

func (chatFileReferenceProvider) HeldBy(
	ctx context.Context, q *db.Queries, ids []files.FileID,
) (map[files.FileID]files.HoldReason, error) {
	out := make(map[files.FileID]files.HoldReason, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	wanted := make([]string, len(ids))
	for i, id := range ids {
		wanted[i] = string(id)
	}
	held, err := q.ListChatMessageFileRefs(ctx, wanted)
	if err != nil {
		return nil, err
	}
	for _, h := range held {
		if h.Valid && h.String != "" {
			out[files.FileID(h.String)] = files.HoldActive
		}
	}
	return out, nil
}

// FileReferenceProvider exposes chat's provider for the FileService registry.
func (s *ChatService) FileReferenceProvider() files.ReferenceProvider {
	return chatFileReferenceProvider{}
}
