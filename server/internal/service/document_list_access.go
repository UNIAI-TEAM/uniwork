package service

import (
	"context"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// attachListAccess fills Access on one page of list rows: the level the actor
// holds on each document, so a client can hide the commands the row would
// refuse. It is effectiveLevel's answer for the rows a workspace list can
// return (never owned work products - the list queries leave those out),
// read from the scope the list already resolved plus ONE query for the live
// shares of the page, instead of one effectiveLevel per row.
//
// The legs match resolveLevel for a person or an agent who passed the list's
// gates: workspace owner/admin manage; the ACL owner manage; a member on a
// non-restricted document the home row's workspace_level (an agent view); and
// the highest live share that applies (user, the organization, or a workspace
// the actor is in).
// The list SQL admits a row through the same legs, so a row it returns
// always resolves to a level above none - except DOC-05's: a workspace
// owner/admin sees every restricted row (see_all) but holds AdminScope there,
// with a level only from a live share or a live break-glass grant, both read
// once for the page.
func (s *DocumentService) attachListAccess(ctx context.Context, scope documentListScope, workspaceID string, agent bool, items []DocumentListItem) error {
	return s.attachListAccessQ(ctx, s.q, scope, workspaceID, agent, items)
}

// attachListAccessQ is attachListAccess read through q, for a caller that
// holds a snapshot transaction (the access report export).
func (s *DocumentService) attachListAccessQ(ctx context.Context, q *db.Queries, scope documentListScope, workspaceID string, agent bool, items []DocumentListItem) error {
	if len(items) == 0 {
		return nil
	}
	var shareIDs, adminIDs []string
	for _, item := range items {
		switch {
		case listAdminScopeRow(scope, item.Document):
			shareIDs = append(shareIDs, item.Document.ID)
			adminIDs = append(adminIDs, item.Document.ID)
		case scope.allowShares && !scope.seeAll:
			shareIDs = append(shareIDs, item.Document.ID)
		}
	}
	var shares map[string][]db.ListLiveSharesForDocumentsRow
	if scope.allowShares && len(shareIDs) > 0 {
		rows, err := q.ListLiveSharesForDocuments(ctx, db.ListLiveSharesForDocumentsParams{
			OrganizationID: scope.organizationID, WorkspaceID: workspaceID, DocumentIds: shareIDs,
		})
		if err != nil {
			return err
		}
		shares = make(map[string][]db.ListLiveSharesForDocumentsRow, len(rows))
		for _, r := range rows {
			shares[r.DocumentID] = append(shares[r.DocumentID], r)
		}
	}
	grants, err := s.liveBreakGlassFor(ctx, q, scope, workspaceID, adminIDs)
	if err != nil {
		return err
	}
	for i := range items {
		id := items[i].Document.ID
		items[i].Access = listRowAccess(scope, agent, items[i].Document, shares[id], grants[id])
	}
	return nil
}

// listAdminScopeRow is DOC-05's row shape: a see_all caller (workspace
// owner/admin) on a restricted document they are not the ACL owner of.
func listAdminScopeRow(scope documentListScope, doc db.Document) bool {
	return scope.seeAll && doc.Visibility == documentVisibilityRestricted &&
		!(doc.AclOwnerID.Valid && doc.AclOwnerID.String == scope.actorID)
}

// liveBreakGlassFor reads the caller's live break-glass grants on the given
// documents in one query; ids is only ever AdminScope rows.
func (s *DocumentService) liveBreakGlassFor(ctx context.Context, q *db.Queries, scope documentListScope, workspaceID string, ids []string) (map[string]bool, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	rows, err := q.ListLiveBreakGlassGrantsForDocuments(ctx, db.ListLiveBreakGlassGrantsForDocumentsParams{
		OrganizationID: scope.organizationID, WorkspaceID: workspaceID, DocumentIds: ids,
		ActorID: scope.actorID, ActorKind: string(audit.KindHuman),
	})
	if err != nil {
		return nil, err
	}
	out := make(map[string]bool, len(rows))
	for _, r := range rows {
		out[r.DocumentID] = true
	}
	return out, nil
}

// listRowAccess is the per-row half of attachListAccess; shares are the live
// grants on this one document, breakGlass whether the caller holds a live
// break-glass grant on it (read only for AdminScope rows).
func listRowAccess(scope documentListScope, agent bool, doc db.Document, shares []db.ListLiveSharesForDocumentsRow, breakGlass bool) DocumentAccess {
	best := DocumentAccess{}
	adminScope := false
	switch {
	case listAdminScopeRow(scope, doc):
		adminScope = true
	case scope.seeAll:
		return DocumentAccess{Level: DocumentLevelManage, Via: DocumentViaMember}
	case scope.aclOwner && doc.AclOwnerID.Valid && doc.AclOwnerID.String == scope.actorID:
		return DocumentAccess{Level: DocumentLevelManage, Via: DocumentViaMember}
	case scope.memberVisible && doc.Visibility != documentVisibilityRestricted:
		// The home row's own level (SH-S1): a workspace-visible document
		// grants workspace_level (view/comment/edit), never a fixed edit.
		best = DocumentAccess{Level: DocumentLevel(doc.WorkspaceLevel), Via: DocumentViaMember}
		if agent {
			best.Level = DocumentLevelView
		}
	}
	if scope.allowShares {
		for _, sh := range shares {
			lvl := DocumentLevel(sh.Level)
			if lvl.rank() <= best.Level.rank() || !listShareApplies(scope, sh, doc) {
				continue
			}
			best = DocumentAccess{Level: lvl, Via: DocumentViaShare}
		}
	}
	if adminScope && best.Level == DocumentLevelNone && breakGlass {
		best = DocumentAccess{Level: DocumentLevelView, Via: DocumentViaBreakGlass}
	}
	best.AdminScope = adminScope
	return best
}

// listShareApplies mirrors shareAppliesTo for a person already admitted by
// the list's organization gate; the workspaces they belong to were resolved
// once into the scope.
func listShareApplies(scope documentListScope, sh db.ListLiveSharesForDocumentsRow, doc db.Document) bool {
	switch sh.PrincipalType {
	case DocumentPrincipalUser:
		return sh.PrincipalID == scope.actorID
	case DocumentPrincipalOrganization:
		return sh.PrincipalID == doc.OrganizationID
	case DocumentPrincipalWorkspace:
		for _, w := range scope.shareWorkspaces {
			if w == sh.PrincipalID {
				return true
			}
		}
	}
	return false
}
