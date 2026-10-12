package service

import (
	"context"

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
// non-restricted document edit (an agent view); and the highest live share
// that applies (user, the organization, or a workspace the actor is in).
// The list SQL admits a row through the same legs, so a row it returns
// always resolves to a level above none.
func (s *DocumentService) attachListAccess(ctx context.Context, scope documentListScope, workspaceID string, agent bool, items []DocumentListItem) error {
	if len(items) == 0 {
		return nil
	}
	var shares map[string][]db.ListLiveSharesForDocumentsRow
	if scope.allowShares && !scope.seeAll {
		ids := make([]string, len(items))
		for i, item := range items {
			ids[i] = item.Document.ID
		}
		rows, err := s.q.ListLiveSharesForDocuments(ctx, db.ListLiveSharesForDocumentsParams{
			OrganizationID: scope.organizationID, WorkspaceID: workspaceID, DocumentIds: ids,
		})
		if err != nil {
			return err
		}
		shares = make(map[string][]db.ListLiveSharesForDocumentsRow, len(rows))
		for _, r := range rows {
			shares[r.DocumentID] = append(shares[r.DocumentID], r)
		}
	}
	for i := range items {
		items[i].Access = listRowAccess(scope, agent, items[i].Document, shares[items[i].Document.ID])
	}
	return nil
}

// listRowAccess is the per-row half of attachListAccess; shares are the live
// grants on this one document.
func listRowAccess(scope documentListScope, agent bool, doc db.Document, shares []db.ListLiveSharesForDocumentsRow) DocumentAccess {
	best := DocumentAccess{}
	switch {
	case scope.seeAll:
		return DocumentAccess{Level: DocumentLevelManage, Via: DocumentViaMember}
	case scope.aclOwner && doc.AclOwnerID.Valid && doc.AclOwnerID.String == scope.actorID:
		return DocumentAccess{Level: DocumentLevelManage, Via: DocumentViaMember}
	case scope.memberVisible && doc.Visibility != documentVisibilityRestricted:
		best = DocumentAccess{Level: DocumentLevelEdit, Via: DocumentViaMember}
		if agent {
			best.Level = DocumentLevelView
		}
	}
	if !scope.allowShares {
		return best
	}
	for _, sh := range shares {
		lvl := DocumentLevel(sh.Level)
		if lvl.rank() <= best.Level.rank() || !listShareApplies(scope, sh, doc) {
			continue
		}
		best = DocumentAccess{Level: lvl, Via: DocumentViaShare}
	}
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
