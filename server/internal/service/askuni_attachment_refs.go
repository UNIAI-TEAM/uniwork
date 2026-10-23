package service

import (
	"context"

	"github.com/unicomhub/uniwork/server/internal/files"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// AskUniAttachmentProvider tells FileService which ai_attachment files an Ask
// UNI question still carries. A conversation's delete removes its
// ai_attachments rows and releases the files, so a row that exists holds its
// file.
type AskUniAttachmentProvider struct{}

func (AskUniAttachmentProvider) Name() string { return "ai_attachments.file" }

func (AskUniAttachmentProvider) Purposes() []files.UploadPurpose {
	return []files.UploadPurpose{files.AiAttachment}
}

func (AskUniAttachmentProvider) HeldBy(ctx context.Context, q *db.Queries, ids []files.FileID) (map[files.FileID]files.HoldReason, error) {
	out := make(map[files.FileID]files.HoldReason, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	held, err := q.ListAiAttachmentFileIDs(ctx, fileIDStrings(ids))
	if err != nil {
		return nil, err
	}
	for _, id := range held {
		if id != "" {
			out[files.FileID(id)] = files.HoldActive
		}
	}
	return out, nil
}
