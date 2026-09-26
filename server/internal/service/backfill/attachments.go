package backfill

import (
	"context"
	"strings"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// M1 (inventory spec §9): attachments.object_key is the locator; the row's
// organization_id is the verified tenant and the workspaces join is the
// cross-check, because the writer minted keys as
// workspaces/<workspace_id>/attachments/<attachment_id>/<filename>.
// object_url is a hint only — it is never a tenant or backend source.
//
// The legacy writer always targeted the configured STORAGE_BACKEND of its
// moment, which the row does not record, so plan leaves Storage empty; apply
// resolves the adapter by probing the configured stores.
func (e *Engine) scanAttachments(ctx context.Context, after string, limit int32) ([]Item, string, error) {
	rows, err := e.q.FileBackfillScanAttachments(ctx, db.FileBackfillScanAttachmentsParams{
		AfterID: after, LimitN: limit,
	})
	if err != nil {
		return nil, "", err
	}
	items := make([]Item, 0, len(rows))
	next := ""
	for _, r := range rows {
		items = append(items, classifyAttachment(r))
		next = r.ID
	}
	if int32(len(rows)) < limit {
		next = ""
	}
	return items, next, nil
}

func classifyAttachment(r db.FileBackfillScanAttachmentsRow) Item {
	it := Item{
		Cohort:         CohortTaskAttachments,
		SourceTable:    "attachments",
		SourceID:       r.ID,
		OrganizationID: r.OrganizationID,
		WorkspaceID:    r.WorkspaceID,
		Filename:       r.Filename,
		SizeBytes:      r.SizeBytes,
		Claimed:        !r.ExpiresAt.Valid, // binding CHECK: staged rows carry expires_at
		Purpose:        "task_attachment",
	}
	if it.Claimed && r.CommentID.Valid {
		it.Purpose = "task_comment_attachment"
	}

	if r.FileID.Valid && r.FileID.String != "" {
		it.Class = ClassAlreadyApplied
		it.FileID = r.FileID.String
		return it
	}
	if !r.ObjectKey.Valid || r.ObjectKey.String == "" {
		it.Class = ClassUnresolved
		it.Reason = "no_locator"
		return it
	}
	it.ObjectKey = r.ObjectKey.String
	it.RawLocator = r.ObjectKey.String
	if r.ObjectUrl.Valid {
		it.RawLocator = r.ObjectKey.String + " | url_hint=" + r.ObjectUrl.String
	}

	// Key cross-check: the writer's own shape carries the workspace; a
	// mismatch is conflicting evidence, not something to guess at. The id
	// segment is deliberately NOT compared to the row: a second row naming
	// another attachment's key is the M2 duplicate-reference case — it
	// verifies and the shared-locator pass dedupes it to one file.
	segs := strings.Split(it.ObjectKey, "/")
	if len(segs) < 5 || segs[0] != "workspaces" || segs[2] != "attachments" {
		it.Class = ClassHeld
		it.Reason = "unrecognized_key_shape"
		return it
	}
	if segs[1] != r.WorkspaceID {
		it.Class = ClassHeld
		it.Reason = "workspace_mismatch"
		return it
	}
	if !r.WorkspaceOrganizationID.Valid {
		it.Class = ClassUnresolved
		it.Reason = "workspace_missing"
		return it
	}
	if r.WorkspaceOrganizationID.String != r.OrganizationID {
		it.Class = ClassHeld
		it.Reason = "organization_mismatch"
		return it
	}
	it.Class = ClassVerified
	return it
}
