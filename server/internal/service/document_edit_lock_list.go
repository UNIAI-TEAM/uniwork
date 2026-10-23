package service

import "context"

// List-row edit-lock summaries (UNI-1645, addendum 2026-10-15 §3.2). The
// library list, search, tree, recent and shared-with-me rows show who is
// editing the document; the organization-scoped favorites list deliberately
// carries nothing. Every attach below is one batched read per page
// (DocumentEditLockSummaries), so a page of 100 rows costs a single query and
// never grows into one query per row. A list row never carries the tenure id:
// only R1 answers it, and only to a manager who is not the holder (C2-1).

// attachListEditLocks fills EditLock on one page of list/search/recent rows.
// Every item of a page belongs to the one organization its list was scoped to
// (the same invariant attachListFacts relies on).
func (s *DocumentService) attachListEditLocks(ctx context.Context, actor Actor, items []DocumentListItem) error {
	if len(items) == 0 {
		return nil
	}
	ids := make([]string, 0, len(items))
	for i := range items {
		ids = append(ids, items[i].Document.ID)
	}
	sums, err := s.DocumentEditLockSummaries(ctx, actor, items[0].Document.OrganizationID, ids)
	if err != nil {
		return err
	}
	for i := range items {
		if sum, ok := sums[items[i].Document.ID]; ok {
			items[i].EditLock = &sum
		}
	}
	return nil
}

// attachTreeEditLocks fills EditLock on every node of the tree forest.
func (s *DocumentService) attachTreeEditLocks(ctx context.Context, actor Actor, organizationID string, nodes []DocumentTreeNode) error {
	ids := make([]string, 0, len(nodes))
	collectTreeEditLockIDs(nodes, &ids)
	if len(ids) == 0 {
		return nil
	}
	sums, err := s.DocumentEditLockSummaries(ctx, actor, organizationID, ids)
	if err != nil {
		return err
	}
	applyTreeEditLocks(nodes, sums)
	return nil
}

func collectTreeEditLockIDs(nodes []DocumentTreeNode, ids *[]string) {
	for i := range nodes {
		*ids = append(*ids, nodes[i].ID)
		collectTreeEditLockIDs(nodes[i].Children, ids)
	}
}

func applyTreeEditLocks(nodes []DocumentTreeNode, sums map[string]DocumentEditLockSummary) {
	for i := range nodes {
		if sum, ok := sums[nodes[i].ID]; ok {
			nodes[i].EditLock = &sum
		}
		applyTreeEditLocks(nodes[i].Children, sums)
	}
}

// attachSharedEditLocks fills EditLock on one page of shared-with-me rows.
// The page spans the organization's workspaces, so the organization the route
// was scoped to is the summary key.
func (s *DocumentService) attachSharedEditLocks(ctx context.Context, actor Actor, organizationID string, items []SharedDocument) error {
	if len(items) == 0 {
		return nil
	}
	ids := make([]string, 0, len(items))
	for i := range items {
		ids = append(ids, items[i].Document.ID)
	}
	sums, err := s.DocumentEditLockSummaries(ctx, actor, organizationID, ids)
	if err != nil {
		return err
	}
	for i := range items {
		if sum, ok := sums[items[i].Document.ID]; ok {
			items[i].EditLock = &sum
		}
	}
	return nil
}
