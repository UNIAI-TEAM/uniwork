package service

import (
	"context"

	"github.com/unicomhub/uniwork/server/internal/files"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// DocumentVersionReferenceProvider is the ReferenceProvider for
// document_versions.file_id (C-01 §14.2; UNI-675). A file version's blob is
// held while it is the document's current pointer (active), while it is an
// older restorable version (version_history), and while the parent document
// is archived but not yet purged (soft_deleted). A purged document deletes
// its version rows in the same transaction, so nothing lingers to hold.
//
// The provider exists before the document_file purpose opens (G1-03) because
// the reference registry refuses to collect a file_id column's orphans
// without one.
type DocumentVersionReferenceProvider struct{}

func (DocumentVersionReferenceProvider) Name() string { return "documents.versions" }

func (DocumentVersionReferenceProvider) Purposes() []files.UploadPurpose {
	return []files.UploadPurpose{files.DocumentFile}
}

func (DocumentVersionReferenceProvider) HeldBy(
	ctx context.Context, q *db.Queries, ids []files.FileID,
) (map[files.FileID]files.HoldReason, error) {
	out := make(map[files.FileID]files.HoldReason, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.ListDocumentVersionFileHolds(ctx, fileIDStrings(ids))
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		if !r.FileID.Valid || r.FileID.String == "" {
			continue
		}
		reason := documentVersionHold(r.Reason)
		id := files.FileID(r.FileID.String)
		if cur, ok := out[id]; !ok || holdRank(reason) > holdRank(cur) {
			out[id] = reason
		}
	}
	return out, nil
}

func documentVersionHold(reason string) files.HoldReason {
	switch reason {
	case "version_history":
		return files.HoldVersionHistory
	case "soft_deleted":
		return files.HoldSoftDeleted
	default:
		return files.HoldActive
	}
}

// DocumentAssetReferenceProvider is the ReferenceProvider for
// document_assets.file_id (C-01 §3.3). An asset still referenced by content
// is held active; one orphaned less than seven days ago rides its retention
// hold; one the content of a non-purged page version still references holds
// version_history whatever its orphaned_at (C-01 §14.2, G1-03); anything
// else is released - the provider deliberately returns no hold so the
// collector may reap it. An asset on an archived-but-not-purged document
// holds soft_deleted regardless of its own orphaned_at.
type DocumentAssetReferenceProvider struct{}

func (DocumentAssetReferenceProvider) Name() string { return "documents.assets" }

func (DocumentAssetReferenceProvider) Purposes() []files.UploadPurpose {
	return []files.UploadPurpose{files.DocumentAsset}
}

func (DocumentAssetReferenceProvider) HeldBy(
	ctx context.Context, q *db.Queries, ids []files.FileID,
) (map[files.FileID]files.HoldReason, error) {
	out := make(map[files.FileID]files.HoldReason, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.ListDocumentAssetFileHolds(ctx, fileIDStrings(ids))
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		reason, held := documentAssetHold(r.Reason)
		if !held {
			continue
		}
		id := files.FileID(r.FileID)
		if cur, ok := out[id]; !ok || holdRank(reason) > holdRank(cur) {
			out[id] = reason
		}
	}
	return out, nil
}

// documentAssetHold translates the query's classification. 'released' is the
// one answer that must NOT hold: the seven-day orphan window expired.
func documentAssetHold(reason string) (files.HoldReason, bool) {
	switch reason {
	case "active":
		return files.HoldActive, true
	case "retention":
		return files.HoldRetention, true
	case "soft_deleted":
		return files.HoldSoftDeleted, true
	case "version_history":
		return files.HoldVersionHistory, true
	default:
		return "", false
	}
}

// fileIDStrings converts FileIDs for the sqlc.arg text[] parameters.
func fileIDStrings(ids []files.FileID) []string {
	out := make([]string, len(ids))
	for i, id := range ids {
		out[i] = string(id)
	}
	return out
}
