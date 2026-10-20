package service

import (
	"context"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// applyAccessBatchItems applies (or, on a dry run, only decides) every item of
// an UpdateDocumentAccess batch and answers the results in item order
// (UNI-2012 S1e-bulk).
//
// User items are the bulk of a large batch, so they are written set-based:
// each outcome is decided from the command-start share set (validation
// refused duplicate principals, and no group or home-row write touches a user
// share, so that set is still each user's live share when the item runs), the
// revokes go out as one statement per chunk and the grants through
// writeUserSharesBulk, one call per level. Workspace, organization and
// home-row items keep the per-item path.
//
// The audit and outbox rows are the per-item path's, row for row and in item
// order: each user grant and revoke keeps its own document.shared /
// document.share_revoked row with the batch id and its own event (the grant's
// with the recipient's notify_user_id), recorded through RecordMany, and the
// buffered user rows are flushed before every group or home-row item writes
// its own.
func (s *DocumentService) applyAccessBatchItems(
	ctx context.Context,
	q *db.Queries,
	actor Actor,
	doc db.Document,
	access DocumentAccess,
	sharesBefore []db.DocumentShare,
	items []DocumentAccessBatchItem,
	batchID string,
	dryRun bool,
	notifyByIndex []string,
) ([]DocumentAccessItemResult, error) {
	liveByUser := make(map[string]db.DocumentShare)
	for _, sh := range sharesBefore {
		if sh.PrincipalType == DocumentPrincipalUser {
			liveByUser[sh.PrincipalID] = sh
		}
	}

	results := make([]DocumentAccessItemResult, len(items))
	writes := make([]accessBatchWrite, len(items))
	var revokeIDs []string
	grantsByLevel := make(map[DocumentLevel][]string)
	var grantLevels []DocumentLevel
	for i, it := range items {
		if it.PrincipalType != DocumentPrincipalUser {
			continue
		}
		prev, hasLive := liveByUser[it.PrincipalID]
		results[i], writes[i] = decideAccessBatchShareItem(i, it, prev, hasLive)
		switch writes[i] {
		case accessBatchWriteRevoke:
			revokeIDs = append(revokeIDs, prev.ID)
		case accessBatchWriteGrant:
			if _, seen := grantsByLevel[*it.Level]; !seen {
				grantLevels = append(grantLevels, *it.Level)
			}
			grantsByLevel[*it.Level] = append(grantsByLevel[*it.Level], it.PrincipalID)
		}
	}

	if dryRun {
		for i, it := range items {
			if it.PrincipalType == DocumentPrincipalUser {
				continue
			}
			res, _, err := s.applyAccessBatchItem(ctx, q, actor, doc, access, i, it, batchID, true, notifyByIndex[i])
			if err != nil {
				return nil, err
			}
			results[i] = res
		}
		return results, nil
	}

	for start := 0; start < len(revokeIDs); start += documentShareWriteChunk {
		if err := q.RevokeDocumentSharesByIDs(ctx, db.RevokeDocumentSharesByIDsParams{
			RevokedBy: nullText(actor.ID), Ids: revokeIDs[start:min(start+documentShareWriteChunk, len(revokeIDs))],
			OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
		}); err != nil {
			return nil, err
		}
	}
	// Every user granted here has no live share at the item's level, so the
	// bulk writer writes each one (none is kept as it is).
	granted := make(map[string]db.DocumentShare)
	for _, lvl := range grantLevels {
		live, _, err := writeUserSharesBulk(ctx, q, actor, doc, sharesBefore, grantsByLevel[lvl], lvl, userShareSource{})
		if err != nil {
			return nil, err
		}
		for id, sh := range live {
			granted[id] = sh
		}
	}

	var pending []audit.Recorded
	flush := func() error {
		for start := 0; start < len(pending); start += documentShareWriteChunk {
			if err := auditRecorder.RecordMany(ctx, q, pending[start:min(start+documentShareWriteChunk, len(pending))]); err != nil {
				return err
			}
		}
		pending = pending[:0]
		return nil
	}
	for i, it := range items {
		if it.PrincipalType != DocumentPrincipalUser {
			if err := flush(); err != nil {
				return nil, err
			}
			res, updatedDoc, err := s.applyAccessBatchItem(ctx, q, actor, doc, access, i, it, batchID, false, notifyByIndex[i])
			if err != nil {
				return nil, err
			}
			doc = updatedDoc
			results[i] = res
			continue
		}
		switch writes[i] {
		case accessBatchWriteRevoke:
			pending = append(pending, accessBatchRevokeRecord(actor, doc, liveByUser[it.PrincipalID], batchID))
		case accessBatchWriteGrant:
			sh := granted[it.PrincipalID]
			results[i].ShareID = sh.ID
			prev, hasLive := liveByUser[it.PrincipalID]
			pending = append(pending, accessBatchGrantRecord(actor, doc, sh, prev, hasLive, batchID, notifyByIndex[i]))
		}
	}
	if err := flush(); err != nil {
		return nil, err
	}
	return results, nil
}

// accessBatchGrantRecord is the audit row and event applyDocumentShareWithBatch
// writes for one user grant of a batch.
func accessBatchGrantRecord(actor Actor, doc db.Document, sh, prev db.DocumentShare, hasPrev bool, batchID, notifyUserID string) audit.Recorded {
	var before map[string]any
	if hasPrev {
		before = map[string]any{"level": prev.Level}
	}
	payload := map[string]string{
		"document_id":  doc.ID,
		"workspace_id": doc.WorkspaceID,
		"share_id":     sh.ID,
	}
	if notifyUserID != "" {
		payload["notify_user_id"] = notifyUserID
	}
	return audit.Recorded{
		Entry: audit.Entry{
			OrganizationID: doc.OrganizationID,
			WorkspaceID:    doc.WorkspaceID,
			Actor:          actor,
			Action:         audit.ActionDocumentShared,
			ResourceType:   "document",
			ResourceID:     doc.ID,
			Changes:        audit.Diff(before, map[string]any{"level": sh.Level}),
			Metadata: map[string]any{
				"share_id":       sh.ID,
				"principal_type": sh.PrincipalType,
				"principal_id":   sh.PrincipalID,
				"batch_id":       batchID,
			},
		},
		Events: []audit.Event{{Topic: "document.shared", Payload: payload}},
	}
}

// accessBatchRevokeRecord is the audit row and event
// revokeDocumentShareRowWithBatch writes for one revoked user share of a
// batch, the prior level in the metadata the change feed reads (BE-G1-2).
func accessBatchRevokeRecord(actor Actor, doc db.Document, sh db.DocumentShare, batchID string) audit.Recorded {
	return audit.Recorded{
		Entry: audit.Entry{
			OrganizationID: doc.OrganizationID,
			WorkspaceID:    doc.WorkspaceID,
			Actor:          actor,
			Action:         audit.ActionDocumentShareRevoked,
			ResourceType:   "document",
			ResourceID:     doc.ID,
			Changes:        audit.Diff(map[string]any{"level": sh.Level}, nil),
			Metadata: map[string]any{
				"share_id":       sh.ID,
				"principal_type": sh.PrincipalType,
				"principal_id":   sh.PrincipalID,
				"level":          sh.Level,
				"batch_id":       batchID,
			},
		},
		Events: []audit.Event{{Topic: "document.share_revoked", Payload: map[string]string{
			"document_id":  doc.ID,
			"workspace_id": doc.WorkspaceID,
			"share_id":     sh.ID,
		}}},
	}
}
