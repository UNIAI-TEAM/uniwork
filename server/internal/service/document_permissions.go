package service

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// DocumentAccess is the answer of effectiveLevel: the level an actor holds on
// one document and the path it came through (C-01 §3.6 `via`).
type DocumentAccess struct {
	Level DocumentLevel
	Via   DocumentVia
}

// Document share principals (C-01 §3.4).
const (
	DocumentPrincipalUser         = "user"
	DocumentPrincipalWorkspace    = "workspace"
	DocumentPrincipalOrganization = "organization"
)

const documentVisibilityRestricted = "restricted"

// effectiveLevel is the one place a document level is computed (C-01 §4,
// §13.4); every handler, service and packages/core/permissions/rules.ts
// mirror answers from it. q reads the ACL rows: inside a mutation it is the
// transaction that holds the document row lock, so a concurrent revoke is
// either fully visible or has not started (see withDocumentMutation).
//
// Membership is decided only by the service gates. A suspended organization
// or a deactivated member comes back as that gate's error with level none,
// so callers can tell "closed tenant" from "no access".
//
// Order:
//  1. tenant gate: human -> OrganizationService.RequireMember on the
//     document's organization; agent -> RequireAgentMember on the document's
//     workspace plus an active agent of that organization; anyone else none.
//  2. owned (§13.4) FIRST: the owner resolver decides; shares, visibility,
//     created_by and acl_owner_id are not read. An agent is capped at view.
//  3. agent: view on a workspace-visible document, none on a restricted one.
//  4. human member path via WorkspaceService.RequireMember on the document's
//     workspace: ws owner/admin (org owner/admin implicit) and the ACL owner
//     -> manage; effective member on a workspace-visible document -> edit.
//  5. live shares: user, workspace (effective member of that workspace at
//     read time) and organization principals; the highest level wins.
func (s *DocumentService) effectiveLevel(ctx context.Context, q *db.Queries, actor Actor, doc db.Document) (DocumentAccess, error) {
	none := DocumentAccess{}
	switch actor.Kind {
	case audit.KindHuman:
		if _, err := s.orgs.RequireMember(ctx, doc.OrganizationID, actor.ID); err != nil {
			return none, closedTenantOrNil(err)
		}
	case audit.KindAgent:
		ok, err := s.agentInWorkspace(ctx, q, actor.ID, doc)
		if err != nil || !ok {
			return none, err
		}
	default:
		// System jobs act through internal paths, never through a level.
		return none, nil
	}

	if doc.OwnerKind.Valid {
		lvl, err := s.ownerLevelResolve(ctx, actor, doc.OwnerID.String)
		if err != nil {
			return none, err
		}
		if actor.Kind == audit.KindAgent {
			lvl = capDocumentLevel(lvl, DocumentLevelView)
		}
		if lvl == DocumentLevelNone {
			return none, nil
		}
		return DocumentAccess{Level: lvl, Via: DocumentViaOwner}, nil
	}

	if actor.Kind == audit.KindAgent {
		// Agents never edit directly (writes go through proposals, ADR 0010)
		// and never see a restricted document: restricted means "only the
		// people it is shared with", and agents are not share principals.
		if doc.Visibility == documentVisibilityRestricted {
			return none, nil
		}
		return DocumentAccess{Level: DocumentLevelView, Via: DocumentViaMember}, nil
	}

	best := none
	m, err := s.ws.RequireMember(ctx, doc.WorkspaceID, actor.ID)
	switch {
	case err == nil:
		switch {
		case m.Role == "owner" || m.Role == "admin":
			best = DocumentAccess{Level: DocumentLevelManage, Via: DocumentViaMember}
		case doc.AclOwnerID.Valid && doc.AclOwnerID.String == actor.ID:
			// §14.3: the ACL owner, not created_by, holds manage - a copy
			// keeps the source's ACL owner, so copying never escalates.
			best = DocumentAccess{Level: DocumentLevelManage, Via: DocumentViaMember}
		case doc.Visibility != documentVisibilityRestricted:
			best = DocumentAccess{Level: DocumentLevelEdit, Via: DocumentViaMember}
		}
	case errors.Is(err, ErrForbidden):
		// Not a member of the document's workspace: shares may still apply
		// (plan §3.1 - recipients need not join the source workspace).
	default:
		return none, closedTenantOrNil(err)
	}
	if best.Level == DocumentLevelManage {
		return best, nil
	}

	shares, err := q.ListDocumentShares(ctx, db.ListDocumentSharesParams{
		OrganizationID: doc.OrganizationID,
		WorkspaceID:    doc.WorkspaceID,
		DocumentID:     doc.ID,
	})
	if err != nil {
		return none, err
	}
	for _, sh := range shares {
		lvl := DocumentLevel(sh.Level)
		if lvl.rank() <= best.Level.rank() {
			continue
		}
		applies, err := s.shareAppliesTo(ctx, sh, actor.ID, doc)
		if err != nil {
			return none, err
		}
		if applies {
			best = DocumentAccess{Level: lvl, Via: DocumentViaShare}
		}
	}
	return best, nil
}

// shareAppliesTo answers whether one live share row covers a person who has
// already passed the organization gate of the document.
func (s *DocumentService) shareAppliesTo(ctx context.Context, sh db.DocumentShare, userID string, doc db.Document) (bool, error) {
	switch sh.PrincipalType {
	case DocumentPrincipalUser:
		return sh.PrincipalID == userID, nil
	case DocumentPrincipalOrganization:
		return sh.PrincipalID == doc.OrganizationID, nil
	case DocumentPrincipalWorkspace:
		// Effective membership at read time: leaving the workspace ends the
		// grant immediately (C-01 §4).
		if _, err := s.ws.RequireMember(ctx, sh.PrincipalID, userID); err != nil {
			if errors.Is(err, ErrForbidden) {
				return false, nil
			}
			return false, closedTenantOrNil(err)
		}
		return true, nil
	default:
		return false, nil
	}
}

// agentInWorkspace is the agent tenant gate: a workspace_agent_members row
// (RequireAgentMember) for the document's workspace, and an active agent of
// the document's organization in an active organization.
func (s *DocumentService) agentInWorkspace(ctx context.Context, q *db.Queries, agentID string, doc db.Document) (bool, error) {
	if _, err := s.ws.RequireAgentMember(ctx, doc.WorkspaceID, agentID); err != nil {
		if errors.Is(err, ErrForbidden) {
			return false, nil
		}
		return false, err
	}
	a, err := q.GetAgent(ctx, agentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if a.OrganizationID != doc.OrganizationID || a.Status != "active" || a.ArchivedAt.Valid {
		return false, nil
	}
	org, err := q.GetOrganizationByID(ctx, doc.OrganizationID)
	if err != nil {
		return false, err
	}
	if org.Status != OrganizationActive {
		return false, errOrganizationSuspended()
	}
	return true, nil
}

// closedTenantOrNil keeps the two "closed tenant" answers of the membership
// gates and folds a plain refusal into "no level".
func closedTenantOrNil(err error) error {
	if errors.Is(err, ErrOrganizationSuspended) || errors.Is(err, ErrMemberDeactivated) {
		return err
	}
	if errors.Is(err, ErrForbidden) || errors.Is(err, ErrNotFound) {
		return nil
	}
	return err
}

func capDocumentLevel(l, max DocumentLevel) DocumentLevel {
	if l.rank() > max.rank() {
		return max
	}
	return l
}

// decideDocumentAccess turns a computed access into the service answer:
// nothing readable is ErrNotFound (no title, parent or breadcrumb leaks), a
// reader asking for more than they hold is ErrForbidden.
func decideDocumentAccess(access DocumentAccess, required DocumentLevel) error {
	if access.Level == DocumentLevelNone {
		return ErrNotFound
	}
	if !access.Level.AtLeast(required) {
		return ErrForbidden
	}
	return nil
}

// authorizeDocument is the read gate every document path by id goes
// through: the row by id, then the organization gate and effectiveLevel
// from the row's own tenant pair. An id from another tenant is not found,
// never forbidden.
func (s *DocumentService) authorizeDocument(ctx context.Context, actor Actor, documentID string, required DocumentLevel) (db.Document, DocumentAccess, error) {
	if !validActor(actor) || documentID == "" {
		return db.Document{}, DocumentAccess{}, ErrNotFound
	}
	doc, err := s.q.GetDocumentByID(ctx, documentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Document{}, DocumentAccess{}, ErrNotFound
	}
	if err != nil {
		return db.Document{}, DocumentAccess{}, err
	}
	access, err := s.effectiveLevel(ctx, s.q, actor, doc)
	if err != nil {
		return db.Document{}, DocumentAccess{}, err
	}
	if err := decideDocumentAccess(access, required); err != nil {
		return db.Document{}, DocumentAccess{}, err
	}
	return doc, access, nil
}

// authorizeDocumentVersion authorizes the parent document first; the
// version is then looked up inside that document's tenant pair, so a
// version number of an unreadable document is indistinguishable from a
// missing one.
func (s *DocumentService) authorizeDocumentVersion(ctx context.Context, actor Actor, documentID string, versionNo int32, required DocumentLevel) (db.Document, db.DocumentVersion, DocumentAccess, error) {
	doc, access, err := s.authorizeDocument(ctx, actor, documentID, required)
	if err != nil {
		return db.Document{}, db.DocumentVersion{}, DocumentAccess{}, err
	}
	v, err := s.q.GetDocumentVersion(ctx, db.GetDocumentVersionParams{
		OrganizationID: doc.OrganizationID,
		WorkspaceID:    doc.WorkspaceID,
		DocumentID:     doc.ID,
		Version:        versionNo,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Document{}, db.DocumentVersion{}, DocumentAccess{}, ErrNotFound
	}
	if err != nil {
		return db.Document{}, db.DocumentVersion{}, DocumentAccess{}, err
	}
	return doc, v, access, nil
}

// authorizeDocumentAsset is the asset twin of authorizeDocumentVersion.
func (s *DocumentService) authorizeDocumentAsset(ctx context.Context, actor Actor, documentID, assetID string, required DocumentLevel) (db.Document, db.DocumentAsset, DocumentAccess, error) {
	doc, access, err := s.authorizeDocument(ctx, actor, documentID, required)
	if err != nil {
		return db.Document{}, db.DocumentAsset{}, DocumentAccess{}, err
	}
	a, err := s.q.GetDocumentAsset(ctx, db.GetDocumentAssetParams{
		ID:             assetID,
		OrganizationID: doc.OrganizationID,
		WorkspaceID:    doc.WorkspaceID,
		DocumentID:     doc.ID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Document{}, db.DocumentAsset{}, DocumentAccess{}, ErrNotFound
	}
	if err != nil {
		return db.Document{}, db.DocumentAsset{}, DocumentAccess{}, err
	}
	return doc, a, access, nil
}

// withDocumentMutation is the gate every document command runs through: one
// transaction that locks the document row, re-evaluates effectiveLevel with
// the transaction's view of the ACL, and only then runs fn with the locked
// row. No decision taken before the transaction (an earlier open, a cached
// my_level) is ever trusted: share grants and revokes lock the same row, so
// a revoke that commits first is seen here, and one that starts later waits
// for this command to finish.
func (s *DocumentService) withDocumentMutation(
	ctx context.Context, actor Actor, documentID string, required DocumentLevel,
	fn func(q *db.Queries, doc db.Document, access DocumentAccess) error,
) error {
	if !validActor(actor) || documentID == "" {
		return ErrNotFound
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.q.WithTx(tx)
	doc, err := q.LockDocumentByID(ctx, documentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	access, err := s.effectiveLevel(ctx, q, actor, doc)
	if err != nil {
		return err
	}
	if err := decideDocumentAccess(access, required); err != nil {
		return err
	}
	if err := fn(q, doc, access); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
