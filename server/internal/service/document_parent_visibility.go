package service

import (
	"context"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// A document is shown on its own on a reader's side, never inside someone
// else's folder (UNI-1974): a folder is a private container, so a row whose
// parent folder the reader does not list carries no parent_id. The server is
// the authority; a client that groups rows by folder finds nothing to group
// by. Only folder parents are masked - a page's children keep their parent.

// folderParentIDs lists the distinct parent ids of rows that name one.
func folderParentIDs(docs []*db.Document) []string {
	seen := make(map[string]struct{}, len(docs))
	ids := make([]string, 0, len(docs))
	for _, d := range docs {
		if !d.ParentID.Valid || d.ParentID.String == "" {
			continue
		}
		if _, ok := seen[d.ParentID.String]; ok {
			continue
		}
		seen[d.ParentID.String] = struct{}{}
		ids = append(ids, d.ParentID.String)
	}
	return ids
}

// maskParents clears ParentID on every row whose parent is in hidden.
func maskParents(docs []*db.Document, hidden map[string]bool) {
	for _, d := range docs {
		if d.ParentID.Valid && hidden[d.ParentID.String] {
			d.ParentID.Valid, d.ParentID.String = false, ""
		}
	}
}

// maskUnlistedFolderParents masks, on one page of a workspace list, the rows
// whose parent folder the caller does not list: the list scope decides, with
// the same legs as the list queries (the see_all leg minus a foreign My
// Folder), through ONE read of the parents and ONE read of their shares.
func (s *DocumentService) maskUnlistedFolderParents(ctx context.Context, scope documentListScope, workspaceID string, agent bool, docs []*db.Document) error {
	ids := folderParentIDs(docs)
	if len(ids) == 0 {
		return nil
	}
	parents, err := s.q.ListDocumentsByIDs(ctx, db.ListDocumentsByIDsParams{
		OrganizationID: scope.organizationID, WorkspaceID: workspaceID, Ids: ids,
	})
	if err != nil {
		return err
	}
	items := make([]DocumentListItem, 0, len(parents))
	for _, p := range parents {
		if p.Kind == DocumentKindFolder {
			items = append(items, DocumentListItem{Document: p})
		}
	}
	if err := s.attachListAccess(ctx, scope, workspaceID, agent, items); err != nil {
		return err
	}
	hidden := make(map[string]bool, len(items))
	for _, it := range items {
		listed := it.Access.Level != DocumentLevelNone ||
			(it.Access.AdminScope && !isMyFolder(it.Document))
		if !listed {
			hidden[it.Document.ID] = true
		}
	}
	maskParents(docs, hidden)
	return nil
}

// maskUnreadableFolderParents is the cross-workspace twin (Shared with me,
// favorites): the caller's effective level on each distinct folder parent
// decides, since the rows come from several workspaces the caller may not
// even belong to.
func (s *DocumentService) maskUnreadableFolderParents(ctx context.Context, actor Actor, docs []*db.Document) error {
	ids := folderParentIDs(docs)
	if len(ids) == 0 {
		return nil
	}
	hidden := make(map[string]bool, len(ids))
	byOrg := make(map[string]db.Document)
	for _, d := range docs {
		if d.ParentID.Valid {
			byOrg[d.ParentID.String] = *d
		}
	}
	for _, id := range ids {
		child := byOrg[id]
		p, err := s.q.GetDocument(ctx, db.GetDocumentParams{
			ID: id, OrganizationID: child.OrganizationID, WorkspaceID: child.WorkspaceID,
		})
		if err != nil || p.Kind != DocumentKindFolder {
			// A parent that is gone, or is a page, is not a folder to hide.
			continue
		}
		acc, err := s.effectiveLevel(ctx, s.q, actor, p)
		if err != nil {
			if isGateRefusal(err) {
				hidden[id] = true
				continue
			}
			return err
		}
		if decideDocumentAccess(p, acc, DocumentLevelView) != nil {
			hidden[id] = true
		}
	}
	maskParents(docs, hidden)
	return nil
}

// ParentVisible reports whether the view's document may name its parent: the
// last breadcrumb is the direct parent exactly when the caller reads it.
func (v DocumentView) ParentVisible() bool {
	if !v.Document.ParentID.Valid {
		return true
	}
	n := len(v.Breadcrumbs)
	return n > 0 && v.Breadcrumbs[n-1].ID == v.Document.ParentID.String
}
