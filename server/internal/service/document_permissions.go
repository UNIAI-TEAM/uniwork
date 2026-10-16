package service

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/telemetry"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// DocumentAccess is the answer of effectiveLevel: the level an actor holds on
// one document and the path it came through (C-01 §3.6 `via`).
//
// AdminScope (DOC-05, UNI-1628) marks a workspace owner/admin (organization
// owner/admin implicit) on a restricted document they are not the ACL owner
// of: they administer it (canAdminister) but read it only through a live
// share or a live break-glass grant, so Level holds just what those give.
type DocumentAccess struct {
	Level      DocumentLevel
	Via        DocumentVia
	AdminScope bool
}

// canAdminister is the one predicate of the administrative commands (share,
// links, access list and logs, visibility, archive): manage, or AdminScope
// without any read level at all.
func (a DocumentAccess) canAdminister() bool {
	return a.Level.AtLeast(DocumentLevelManage) || a.AdminScope
}

// ErrDocumentRestricted is the content gate's answer to an AdminScope caller
// that holds no read level: the document is not hidden from them (they see
// its metadata), its content is.
var ErrDocumentRestricted = errors.New("document_restricted")

func errDocumentRestricted() error {
	return CodedError{
		Code: "document_restricted", Status: http.StatusForbidden,
		Msg:    "tài liệu ở chế độ hạn chế; quản trị viên chỉ đọc được nội dung khi mở truy cập khẩn cấp",
		Err:    ErrDocumentRestricted,
		Fields: map[string]any{"can_break_glass": true},
	}
}

// errBreakGlassRequired refuses an AdminScope caller (below manage) a command
// that would hand themselves read access - a share reaching them, or opening
// a restricted document to the workspace - outside the audited break-glass
// path.
func errBreakGlassRequired() error {
	return coded(http.StatusForbidden, "break_glass_required", "quản trị viên không thể tự cấp quyền đọc; hãy dùng truy cập khẩn cấp")
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
// Membership is decided only by the service gates, read through q as well
// (their Q variants), so a mutation holding the document lock never borrows
// a second pool connection. A suspended organization or a deactivated member
// of the document's own organization comes back as that gate's error with
// level none, so callers can tell "closed tenant" from "no access".
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
//     A ws owner/admin on a restricted document they are not the ACL owner
//     of gets no level here, only AdminScope (DOC-05).
//  5. live shares: user, workspace (a workspace of the document's
//     organization whose effective member the person is at read time) and
//     organization principals; the highest level wins.
//  6. AdminScope with no level yet: a live break-glass grant of the actor
//     gives view via break_glass.
//
// Archived documents keep their level here; decideDocumentAccess hides them
// from everyone below manage.
func (s *DocumentService) effectiveLevel(ctx context.Context, q *db.Queries, actor Actor, doc db.Document) (DocumentAccess, error) {
	acc, err := s.resolveLevel(ctx, q, actor, doc)
	// A share principal's workspace gate tags the request with that
	// workspace, whatever the answer; the request is about this document's
	// tenant.
	telemetry.SetTenant(ctx, doc.OrganizationID, doc.WorkspaceID)
	return acc, err
}

// resolveLevel is effectiveLevel without the telemetry tag.
func (s *DocumentService) resolveLevel(ctx context.Context, q *db.Queries, actor Actor, doc db.Document) (DocumentAccess, error) {
	none := DocumentAccess{}
	switch actor.Kind {
	case audit.KindHuman:
		if _, err := s.orgs.RequireMemberQ(ctx, q, doc.OrganizationID, actor.ID); err != nil {
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
	return s.resolveLevelInTenant(ctx, q, actor, doc)
}

// resolveLevelInTenant is resolveLevel after the tenant gate: the owner path,
// the agent cap, the workspace member path and the live shares. A caller must
// have proved the actor's place in the document's organization first;
// FilterReadableDocuments calls it directly because it memoizes that gate per
// organization (R1-3), so a page pays for it once rather than once per
// document. The workspace gate below still refuses a member deactivated since
// that answer (RequireMemberQ reads the organization row too), so the skipped
// check can never admit a closed tenant.
func (s *DocumentService) resolveLevelInTenant(ctx context.Context, q *db.Queries, actor Actor, doc db.Document) (DocumentAccess, error) {
	none := DocumentAccess{}
	switch actor.Kind {
	case audit.KindHuman, audit.KindAgent:
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
	adminScope := false
	isACLOwner := doc.AclOwnerID.Valid && doc.AclOwnerID.String == actor.ID
	m, err := s.ws.RequireMemberQ(ctx, q, doc.WorkspaceID, actor.ID)
	switch {
	case err == nil:
		switch {
		case (m.Role == "owner" || m.Role == "admin") && doc.Visibility == documentVisibilityRestricted && !isACLOwner:
			// DOC-05: administer, never read by role; the level comes only
			// from the shares and the break-glass grant below.
			adminScope = true
		case m.Role == "owner" || m.Role == "admin":
			best = DocumentAccess{Level: DocumentLevelManage, Via: DocumentViaMember}
		case isACLOwner:
			// §14.3: the ACL owner, not created_by, holds manage - a copy
			// keeps the source's ACL owner, so copying never escalates.
			// via stays member: C-01 §3.6 has no ACL-owner path, and
			// "owner" names the §13 work-product delegation.
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
		applies, err := s.shareAppliesTo(ctx, q, sh, actor.ID, doc)
		if err != nil {
			return none, err
		}
		if applies {
			best = DocumentAccess{Level: lvl, Via: DocumentViaShare}
		}
	}
	if adminScope && best.Level == DocumentLevelNone {
		// A grant is read only while the caller still holds AdminScope: an
		// admin demoted since the grant reads nothing through it.
		g, err := q.GetLiveDocumentBreakGlassGrantForActor(ctx, db.GetLiveDocumentBreakGlassGrantForActorParams{
			OrganizationID: doc.OrganizationID,
			WorkspaceID:    doc.WorkspaceID,
			DocumentID:     doc.ID,
			ActorID:        actor.ID,
			ActorKind:      string(actor.Kind),
		})
		switch {
		case err == nil:
			best = DocumentAccess{Level: capDocumentLevel(DocumentLevel(g.Level), DocumentLevelView), Via: DocumentViaBreakGlass}
		case errors.Is(err, pgx.ErrNoRows):
		default:
			return none, err
		}
	}
	best.AdminScope = adminScope
	return best, nil
}

// shareAppliesTo answers whether one live share row covers a person who has
// already passed the organization gate of the document. A share row is
// never trusted to stay inside the tenant: a workspace principal counts
// only while it is a workspace of the document's organization, and any
// refusal from that workspace's gate means "does not apply" - never the
// closed-tenant answer of some other organization.
func (s *DocumentService) shareAppliesTo(ctx context.Context, q *db.Queries, sh db.DocumentShare, userID string, doc db.Document) (bool, error) {
	if sh.OrganizationID != doc.OrganizationID {
		return false, nil
	}
	switch sh.PrincipalType {
	case DocumentPrincipalUser:
		return sh.PrincipalID == userID, nil
	case DocumentPrincipalOrganization:
		return sh.PrincipalID == doc.OrganizationID, nil
	case DocumentPrincipalWorkspace:
		ok, err := workspaceInOrganization(ctx, q, sh.PrincipalID, doc.OrganizationID)
		if err != nil || !ok {
			return false, err
		}
		// Effective membership at read time: leaving the workspace ends the
		// grant immediately (C-01 §4).
		if _, err := s.ws.RequireMemberQ(ctx, q, sh.PrincipalID, userID); err != nil {
			if isGateRefusal(err) {
				return false, nil
			}
			return false, err
		}
		return true, nil
	default:
		return false, nil
	}
}

// workspaceInOrganization is a tenant check, not a membership read.
func workspaceInOrganization(ctx context.Context, q *db.Queries, workspaceID, organizationID string) (bool, error) {
	w, err := q.GetWorkspaceByID(ctx, workspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return w.OrganizationID == organizationID, nil
}

// agentInWorkspace is the agent tenant gate: a workspace_agent_members row
// (RequireAgentMember) for the document's workspace, and an active agent of
// the document's organization in an active organization.
func (s *DocumentService) agentInWorkspace(ctx context.Context, q *db.Queries, agentID string, doc db.Document) (bool, error) {
	if _, err := s.ws.RequireAgentMemberQ(ctx, q, doc.WorkspaceID, agentID); err != nil {
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
	if org.DeletionScheduledAt.Valid {
		return false, errOrganizationDeletionScheduled(org.DeletionScheduledAt.Time)
	}
	return true, nil
}

// closedTenantOrNil keeps the two "closed tenant" answers of the membership
// gates and folds a plain refusal - document_restricted included - into
// "no level".
func closedTenantOrNil(err error) error {
	if errors.Is(err, ErrOrganizationSuspended) || errors.Is(err, ErrMemberDeactivated) || errors.Is(err, ErrOrganizationDeletionScheduled) {
		return err
	}
	if errors.Is(err, ErrForbidden) || errors.Is(err, ErrNotFound) || errors.Is(err, ErrDocumentRestricted) {
		return nil
	}
	return err
}

// isGateRefusal is any "no" a membership gate or the document gate gives,
// as opposed to an infrastructure error. document_restricted is one: an
// admin-only reader reads nothing, so delivery-time checks answer false.
func isGateRefusal(err error) bool {
	return errors.Is(err, ErrForbidden) || errors.Is(err, ErrNotFound) ||
		errors.Is(err, ErrOrganizationSuspended) || errors.Is(err, ErrMemberDeactivated) ||
		errors.Is(err, ErrOrganizationDeletionScheduled) || errors.Is(err, ErrDocumentRestricted)
}

func capDocumentLevel(l, max DocumentLevel) DocumentLevel {
	if l.rank() > max.rank() {
		return max
	}
	return l
}

// decideDocumentAccess turns a computed access into the service answer:
// nothing readable is ErrNotFound (no title, parent or breadcrumb leaks), a
// reader asking for more than they hold is ErrForbidden. An archived
// document is in the trash: only manage (who may restore it) or AdminScope
// still finds it, everyone else gets not found (C-01 §5.1 `archived=1` is
// manage-only). AdminScope alone (Level none) never passes: this is the
// content gate, and DOC-05 keeps content closed to it.
func decideDocumentAccess(doc db.Document, access DocumentAccess, required DocumentLevel) error {
	if access.Level == DocumentLevelNone {
		return ErrNotFound
	}
	if doc.ArchivedAt.Valid && !access.canAdminister() {
		return ErrNotFound
	}
	if !access.Level.AtLeast(required) {
		return ErrForbidden
	}
	return nil
}

// decideDocumentContent is decideDocumentAccess for a route caller: an
// AdminScope caller with no read level already sees the document's metadata,
// so the content refusal is document_restricted (with can_break_glass)
// instead of a not found. Everyone else keeps the 404. Internal read checks
// (canReadDocumentQ, FilterDocumentReadersQ) stay on decideDocumentAccess.
func decideDocumentContent(doc db.Document, access DocumentAccess, required DocumentLevel) error {
	err := decideDocumentAccess(doc, access, required)
	if errors.Is(err, ErrNotFound) && access.Level == DocumentLevelNone && access.AdminScope {
		return errDocumentRestricted()
	}
	return err
}

// decideDocumentViewOrAdminister is the outer gate of an administrative
// command: a reader or an AdminScope caller passes, anyone else is not found
// (existence never leaks), and an archived document is found only by those
// who may administer it.
func decideDocumentViewOrAdminister(doc db.Document, access DocumentAccess) error {
	if access.Level == DocumentLevelNone && !access.AdminScope {
		return ErrNotFound
	}
	if doc.ArchivedAt.Valid && !access.canAdminister() {
		return ErrNotFound
	}
	return nil
}

// decideDocumentAdminister is decideDocumentViewOrAdminister plus
// canAdminister: a reader below manage without AdminScope is forbidden.
func decideDocumentAdminister(doc db.Document, access DocumentAccess) error {
	if err := decideDocumentViewOrAdminister(doc, access); err != nil {
		return err
	}
	if !access.canAdminister() {
		return ErrForbidden
	}
	return nil
}

// authorizeDocument is the read gate every document path by id goes
// through: the row by id, then the organization gate and effectiveLevel
// from the row's own tenant pair. An id from another tenant is not found,
// never forbidden. It is the content gate of the routes (decideDocumentContent):
// an AdminScope caller with no read level is document_restricted.
func (s *DocumentService) authorizeDocument(ctx context.Context, actor Actor, documentID string, required DocumentLevel) (db.Document, DocumentAccess, error) {
	return s.authorizeDocumentGate(ctx, s.q, actor, documentID, func(doc db.Document, access DocumentAccess) error {
		return decideDocumentContent(doc, access, required)
	})
}

// authorizeDocumentQ is the internal read gate read through q. A caller that
// already holds a transaction - the document mutation gate, and through it
// the mention write - passes its q, so the row read, the organization gate
// and effectiveLevel all run on that one connection: a mutation holding the
// document row lock never borrows a second pool connection for a read gate.
// Its refusals are decideDocumentAccess's (not found / forbidden), never
// document_restricted.
func (s *DocumentService) authorizeDocumentQ(ctx context.Context, q *db.Queries, actor Actor, documentID string, required DocumentLevel) (db.Document, DocumentAccess, error) {
	return s.authorizeDocumentGate(ctx, q, actor, documentID, func(doc db.Document, access DocumentAccess) error {
		return decideDocumentAccess(doc, access, required)
	})
}

// authorizeDocumentViewOrAdminister is the outer gate of a command a reader
// or an AdminScope caller may run (the access list).
func (s *DocumentService) authorizeDocumentViewOrAdminister(ctx context.Context, actor Actor, documentID string) (db.Document, DocumentAccess, error) {
	return s.authorizeDocumentGate(ctx, s.q, actor, documentID, decideDocumentViewOrAdminister)
}

// authorizeDocumentAdminister is the gate of a read only those who may
// administer the document make (access logs).
func (s *DocumentService) authorizeDocumentAdminister(ctx context.Context, actor Actor, documentID string) (db.Document, DocumentAccess, error) {
	return s.authorizeDocumentGate(ctx, s.q, actor, documentID, decideDocumentAdminister)
}

func (s *DocumentService) authorizeDocumentGate(ctx context.Context, q *db.Queries, actor Actor, documentID string, decide func(db.Document, DocumentAccess) error) (db.Document, DocumentAccess, error) {
	if !validActor(actor) || documentID == "" {
		return db.Document{}, DocumentAccess{}, ErrNotFound
	}
	doc, err := q.GetDocumentByID(ctx, documentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Document{}, DocumentAccess{}, ErrNotFound
	}
	if err != nil {
		return db.Document{}, DocumentAccess{}, err
	}
	access, err := s.effectiveLevel(ctx, q, actor, doc)
	if err != nil {
		return db.Document{}, DocumentAccess{}, err
	}
	if err := decide(doc, access); err != nil {
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

// ValidatePreviewAssets authorizes every opaque asset id before a preview
// capability is minted. It deliberately returns one not-found answer for a
// foreign document, a missing asset and a non-member, so scope creation never
// becomes an existence oracle. The broker calls this service method rather
// than reading ACL tables in its handler.
func (s *DocumentService) ValidatePreviewAssets(ctx context.Context, actor Actor, documentID string, assetIDs []string) error {
	if documentID == "" || len(assetIDs) > 256 {
		return ErrNotFound
	}
	if _, _, err := s.authorizeDocument(ctx, actor, documentID, DocumentLevelView); err != nil {
		return ErrNotFound
	}
	seen := make(map[string]struct{}, len(assetIDs))
	for _, assetID := range assetIDs {
		if !validPreviewAssetID(assetID) {
			return ErrNotFound
		}
		if _, ok := seen[assetID]; ok {
			return ErrNotFound
		}
		seen[assetID] = struct{}{}
		if _, _, _, err := s.authorizeDocumentAsset(ctx, actor, documentID, assetID, DocumentLevelView); err != nil {
			return ErrNotFound
		}
	}
	return nil
}

func validPreviewAssetID(value string) bool {
	if value == "" || len(value) > 128 || value == "." || value == ".." || strings.ContainsAny(value, "/\\?#%:") {
		return false
	}
	for _, r := range value {
		if r < 0x21 || r == 0x7f {
			return false
		}
	}
	return true
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
	return s.withDocumentMutationLocked(ctx, actor, documentID, "", required, fn)
}

// withFileSaveMutation is withDocumentMutation at edit for the version-save
// commands (commit, restore). The only difference is the answer for a row
// that was archived after the preflight: the gate gives it the preflight's
// answer (decideFileSave: document_archived from edit up, not_found below)
// instead of decideDocumentContent's manage-only not_found, so a race
// never flips the refusal inside one retry. Other commands keep the plain gate.
func (s *DocumentService) withFileSaveMutation(
	ctx context.Context, actor Actor, documentID string,
	fn func(q *db.Queries, doc db.Document, access DocumentAccess) error,
) error {
	return s.withDocumentGateLocked(ctx, actor, documentID, "", decideFileSave, fn)
}

// decideFileSave is the locked gate of a version save. The archived answer
// comes first: archivedSaveRefusal is what the preflight gave (readableDocument
// refuses Level none with not_found before it), so a row archived after the
// preflight keeps that answer, and an AdminScope caller with no read level on
// an archived restricted document gets not_found - never more than the
// preflight told them, and never document_restricted's can_break_glass offer
// for a row in the trash. A live row takes the content gate at edit
// (decideDocumentContent), so a level lost after the preflight answers as on
// every other content command.
func decideFileSave(doc db.Document, access DocumentAccess) error {
	if doc.ArchivedAt.Valid {
		return archivedSaveRefusal(access)
	}
	return decideDocumentContent(doc, access, DocumentLevelEdit)
}

// withDocumentMutationLocked is withDocumentMutation for a command that may
// place a name into a parent: when treeWorkspaceID is set, the workspace tree
// lock is taken once the transaction is open and before the document row lock
// - the one order every naming command keeps (appendix §3.3) - so this
// command's duplicate check and its write run serialized against every other
// naming writer, never after a row lock that a move already holds.
//
// workspace_id never changes on a row, so the id read before the transaction
// still names the row's workspace; a row that somehow disagrees is refused
// rather than trusted.
func (s *DocumentService) withDocumentMutationLocked(
	ctx context.Context, actor Actor, documentID, treeWorkspaceID string, required DocumentLevel,
	fn func(q *db.Queries, doc db.Document, access DocumentAccess) error,
) error {
	return s.withDocumentGateLocked(ctx, actor, documentID, treeWorkspaceID, func(doc db.Document, access DocumentAccess) error {
		return decideDocumentContent(doc, access, required)
	}, fn)
}

// withDocumentViewOrAdministerMutationLocked is withDocumentMutationLocked
// whose outer gate admits a reader or an AdminScope caller; fn decides what
// each of them may change (visibility, shares).
func (s *DocumentService) withDocumentViewOrAdministerMutationLocked(
	ctx context.Context, actor Actor, documentID, treeWorkspaceID string,
	fn func(q *db.Queries, doc db.Document, access DocumentAccess) error,
) error {
	return s.withDocumentGateLocked(ctx, actor, documentID, treeWorkspaceID, decideDocumentViewOrAdminister, fn)
}

func (s *DocumentService) withDocumentGateLocked(
	ctx context.Context, actor Actor, documentID, treeWorkspaceID string,
	decide func(db.Document, DocumentAccess) error,
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
	if treeWorkspaceID != "" {
		if err := q.LockDocumentTree(ctx, treeWorkspaceID); err != nil {
			return err
		}
	}
	doc, err := q.LockDocumentByID(ctx, documentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if treeWorkspaceID != "" && doc.WorkspaceID != treeWorkspaceID {
		return ErrNotFound
	}
	access, err := s.effectiveLevel(ctx, q, actor, doc)
	if err != nil {
		return err
	}
	if err := decide(doc, access); err != nil {
		return err
	}
	if err := fn(q, doc, access); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
