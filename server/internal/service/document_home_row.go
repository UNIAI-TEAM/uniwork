package service

import (
	"context"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The home row (SH-S1, UNI-1780): documents.visibility beside
// documents.workspace_level, the one grant the document's own workspace holds
// as a group. This file holds its single writer, so the PATCH (a client
// toggling visibility) and the share routes that merge a grant for that
// workspace cannot drift apart.

// documentHomeRowMove is the target state of one home-row write.
type documentHomeRowMove struct {
	// Visibility turns the row on (workspace) or off (restricted). While it
	// is 'restricted' the level is stored but grants nothing.
	Visibility string
	// WorkspaceLevel is the level the row grants while it is on: view,
	// comment or edit (never manage, Q-S1).
	WorkspaceLevel string
	// BatchID rides the audit metadata when the write belongs to a batched
	// command (SH-S2's PUT /access); empty on a single command.
	BatchID string
	// KeepRevision leaves the row's revision where it is: the caller's
	// command already bumped it (a PATCH that wrote the document's fields in
	// the same request), and one successful command bumps the revision once
	// (C-01 §9.1 item 3). The zero value bumps, so a caller that does not ask
	// keeps the behaviour of every other home-row write.
	KeepRevision bool
}

// writeDocumentHomeRow is the one place a document's home row moves. Inside
// the caller's transaction - the document row is already locked - it writes
// visibility/workspace_level, records document.workspace_access_changed with
// the before/after pair and its ids-only frame, and revokes every live share
// whose principal is the document's own workspace: legacy rows an earlier
// binary wrote, which would otherwise duplicate the row. Each revoke carries
// the existing document.share_revoked audit row and event.
//
// A move that changes neither field and leaves no legacy share writes
// nothing at all (the same level again is a no-op, as it is for a share row).
func writeDocumentHomeRow(ctx context.Context, q *db.Queries, actor Actor, doc db.Document, move documentHomeRowMove) (db.Document, error) {
	if isMyFolder(doc) {
		return db.Document{}, errMyFolderLocked()
	}
	legacy, err := homeWorkspaceShares(ctx, q, doc)
	if err != nil {
		return db.Document{}, err
	}
	if doc.Visibility == move.Visibility && doc.WorkspaceLevel == move.WorkspaceLevel && len(legacy) == 0 {
		return doc, nil
	}
	updated, err := q.UpdateDocumentHomeRow(ctx, db.UpdateDocumentHomeRowParams{
		Visibility:     move.Visibility,
		WorkspaceLevel: move.WorkspaceLevel,
		KeepRevision:   move.KeepRevision,
		UpdatedBy:      actor.ID,
		UpdatedByKind:  string(actor.Kind),
		ID:             doc.ID,
		OrganizationID: doc.OrganizationID,
		WorkspaceID:    doc.WorkspaceID,
	})
	if err != nil {
		return db.Document{}, err
	}
	entry := audit.Entry{
		OrganizationID: updated.OrganizationID,
		WorkspaceID:    updated.WorkspaceID,
		Actor:          actor,
		Action:         audit.ActionDocumentWorkspaceAccessChanged,
		ResourceType:   "document",
		ResourceID:     updated.ID,
		Changes: audit.Diff(
			map[string]any{"visibility": doc.Visibility, "workspace_level": doc.WorkspaceLevel},
			map[string]any{"visibility": updated.Visibility, "workspace_level": updated.WorkspaceLevel},
		),
	}
	if move.BatchID != "" {
		entry.Metadata = map[string]any{"batch_id": move.BatchID}
	}
	if err := auditRecorder.Record(ctx, q, entry, audit.Event{
		Topic: "document.workspace_access_changed",
		Payload: map[string]string{
			"document_id": updated.ID, "workspace_id": updated.WorkspaceID,
		},
	}); err != nil {
		return db.Document{}, err
	}
	for _, sh := range legacy {
		if err := revokeDocumentShareRow(ctx, q, actor, updated, sh); err != nil {
			return db.Document{}, err
		}
	}
	return updated, nil
}

// homeWorkspaceShares lists the live shares whose principal is the document's
// own workspace (BR-04's duplicate source, legacy data only: no command
// writes one any more).
func homeWorkspaceShares(ctx context.Context, q *db.Queries, doc db.Document) ([]db.DocumentShare, error) {
	shares, err := q.ListDocumentShares(ctx, db.ListDocumentSharesParams{
		OrganizationID: doc.OrganizationID,
		WorkspaceID:    doc.WorkspaceID,
		DocumentID:     doc.ID,
	})
	if err != nil {
		return nil, err
	}
	var out []db.DocumentShare
	for _, sh := range shares {
		if sh.PrincipalType == DocumentPrincipalWorkspace && sh.PrincipalID == doc.WorkspaceID {
			out = append(out, sh)
		}
	}
	return out, nil
}
