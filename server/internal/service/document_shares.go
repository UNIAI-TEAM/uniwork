package service

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// DocumentShareInput is one grant (C-01 §5.3): a principal of the
// document's organization and the level it receives.
type DocumentShareInput struct {
	PrincipalType string
	PrincipalID   string
	Level         DocumentLevel
}

// errDocumentOwned is the §13.4 refusal: sharing, links, visibility, moving
// into the tree and archiving are the owning work product's to decide, at
// every level, workspace owners and admins included.
func errDocumentOwned() error {
	return coded(409, "document_owned_by_work_product", "tài liệu thuộc một kết quả công việc; thao tác này đi qua kết quả công việc")
}

func errPrincipalNotInOrganization() error {
	return coded(422, "principal_not_in_organization", "người hoặc nhóm được chia sẻ không thuộc tổ chức của tài liệu")
}

// errHomeRowLevelNotAllowed is Q-S1 of the share SRS addendum: the home row
// tops out at edit, so a share naming the document's own workspace cannot
// carry manage.
func errHomeRowLevelNotAllowed() error {
	return CodedError{
		Code:   "level_not_allowed",
		Status: http.StatusUnprocessableEntity,
		Msg:    "dòng Workspace gốc chỉ nhận view, comment hoặc edit",
		Fields: map[string]any{"max": string(DocumentLevelEdit)},
	}
}

// errOrgShareLevelNotAllowed is Q-S1 (D3) of the share SRS addendum: an
// organization-wide grant tops out at edit, so neither POST /shares nor
// PUT /access may grant manage to principal_type='organization'.
func errOrgShareLevelNotAllowed() error {
	return CodedError{
		Code:   "level_not_allowed",
		Status: http.StatusUnprocessableEntity,
		Msg:    "chia sẻ toàn tổ chức chỉ nhận view, comment hoặc edit",
		Fields: map[string]any{"max": string(DocumentLevelEdit)},
	}
}

// requireDocumentACLChange is the shared head of every share/link command:
// the actor must read or administer the document (otherwise not found, the
// outer gate), an owned document is refused for everyone who reaches it, and
// only those who may administer it (manage or AdminScope, DOC-05) may change
// access.
func requireDocumentACLChange(doc db.Document, access DocumentAccess) error {
	if doc.OwnerKind.Valid {
		return errDocumentOwned()
	}
	if isMyFolder(doc) {
		return errMyFolderLocked()
	}
	if !access.canAdminister() {
		return ErrForbidden
	}
	return nil
}

// refuseAdminSelfShare is DOC-05's self-grant guard: an AdminScope caller
// below manage may share the document with others, but a share that would
// reach themselves (their user, a workspace they are in - every workspace
// for an organization owner/admin - or the organization) is a way to read
// it outside the audited break-glass path, so it is break_glass_required.
func (s *DocumentService) refuseAdminSelfShare(ctx context.Context, q *db.Queries, doc db.Document, access DocumentAccess, actor Actor, in DocumentShareInput) error {
	if !access.AdminScope || access.Level.AtLeast(DocumentLevelManage) {
		return nil
	}
	reaches, err := s.shareAppliesTo(ctx, q, db.DocumentShare{
		OrganizationID: doc.OrganizationID, PrincipalType: in.PrincipalType, PrincipalID: in.PrincipalID,
	}, actor.ID, doc)
	if err != nil {
		return err
	}
	if reaches {
		return errBreakGlassRequired()
	}
	return nil
}

// ShareDocument grants a level to a user, a workspace or the whole
// organization. A live share for the same principal at another level is
// revoked and a new row inserted in the same transaction, so the table keeps
// the history of every grant; the same level again changes nothing. Shares
// never inherit to child pages (C-01 §4).
func (s *DocumentService) ShareDocument(ctx context.Context, actor Actor, documentID string, in DocumentShareInput) (db.DocumentShare, error) {
	if err := validShareLevel(in.Level); err != nil {
		return db.DocumentShare{}, err
	}
	var out db.DocumentShare
	err := s.withDocumentViewOrAdministerMutationLocked(ctx, actor, documentID, "", shelveWriteRefused, func(q *db.Queries, doc db.Document, access DocumentAccess) error {
		if err := requireDocumentACLChange(doc, access); err != nil {
			return err
		}
		if err := s.validateSharePrincipal(ctx, q, doc, in); err != nil {
			return err
		}
		if err := s.refuseAdminSelfShare(ctx, q, doc, access, actor, in); err != nil {
			return err
		}
		notifyUserID := ""
		if in.PrincipalType == DocumentPrincipalUser {
			uid, err := s.notifyOnUserShare(ctx, q, actor, doc, nil, in.PrincipalID, in.Level)
			if err != nil {
				return err
			}
			notifyUserID = uid
		}
		sh, err := s.applyDocumentShareWithBatch(ctx, q, actor, doc, access, in, "", notifyUserID)
		out = sh
		return err
	})
	return out, err
}

// notifyOnUserShare decides whether a direct user grant at `level` notifies
// the recipient: only when the command as a whole strictly raises their
// effective level on the document compared to before it, and never for the
// actor's own grant (SH-S3; addendum §8, §10 Q-S2).
//
// It runs against the COMMAND-START document and shares, once per recipient
// and before any write, so the decision can never depend on the order items
// are applied nor be taken against partially applied ones (R1-01/R1-02/
// R1-13). sharesBefore is the live share set read before the first write; a
// nil slice means "not loaded yet" and the level is resolved with a fresh
// read instead (the single ShareDocument path). A recipient who is refused
// by the tenant gate is not notified: the same answer the grant would get.
func (s *DocumentService) notifyOnUserShare(ctx context.Context, q *db.Queries, actor Actor, doc db.Document, sharesBefore []db.DocumentShare, userID string, level DocumentLevel) (string, error) {
	if actor.Kind == audit.KindHuman && userID == actor.ID {
		return "", nil
	}
	var acc DocumentAccess
	var err error
	if sharesBefore != nil {
		acc, err = s.resolveLevelInTenantWithShares(ctx, q, Human(userID), doc, sharesBefore)
	} else {
		acc, err = s.effectiveLevel(ctx, q, Human(userID), doc)
	}
	if err != nil {
		if isGateRefusal(err) {
			return "", nil
		}
		return "", err
	}
	if level.rank() > acc.Level.rank() {
		return userID, nil
	}
	return "", nil
}

// validShareLevel is the one level check every share command shares, so a
// level added to the set reaches the single and the batch path together.
func validShareLevel(level DocumentLevel) error {
	switch level {
	case DocumentLevelView, DocumentLevelComment, DocumentLevelEdit, DocumentLevelManage:
		return nil
	default:
		return Invalid("level phải là view, comment, edit hoặc manage")
	}
}

// applyDocumentShare writes one grant inside the caller's transaction, after
// the caller has gated the actor and validated the principal: the same live
// level is returned unchanged with no audit row, another live level is
// revoked and replaced, and a new grant is inserted with its audit row and
// document.shared event. A share naming the document's own workspace is not a
// grant of its own (BR-04, SH-S1 item 2): it merges into the home row.
//
// The recipient's notify decision (notifyUserID) is decided by the caller
// BEFORE the first write of the command and passed in, never recomputed here
// against partially applied items (SH-S3 R1-01/R1-02/R1-13): the writer only
// stamps the id onto the event it emits.
func (s *DocumentService) applyDocumentShare(ctx context.Context, q *db.Queries, actor Actor, doc db.Document, access DocumentAccess, in DocumentShareInput) (db.DocumentShare, error) {
	return s.applyDocumentShareWithBatch(ctx, q, actor, doc, access, in, "", "")
}

func (s *DocumentService) applyDocumentShareWithBatch(ctx context.Context, q *db.Queries, actor Actor, doc db.Document, access DocumentAccess, in DocumentShareInput, batchID, notifyUserID string) (db.DocumentShare, error) {
	if in.PrincipalType == DocumentPrincipalWorkspace && in.PrincipalID == doc.WorkspaceID {
		return mergeDocumentShareIntoHomeRow(ctx, q, actor, doc, access, in.Level, batchID)
	}
	if in.PrincipalType == DocumentPrincipalOrganization && in.Level == DocumentLevelManage {
		return db.DocumentShare{}, errOrgShareLevelNotAllowed()
	}
	prev, err := q.GetDocumentShare(ctx, db.GetDocumentShareParams{
		OrganizationID: doc.OrganizationID,
		WorkspaceID:    doc.WorkspaceID,
		DocumentID:     doc.ID,
		PrincipalType:  in.PrincipalType,
		PrincipalID:    in.PrincipalID,
	})
	if err == nil && prev.Level == string(in.Level) {
		return prev, nil
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return db.DocumentShare{}, err
	}
	// A self-share never notifies the actor, whatever the caller decided.
	if in.PrincipalType == DocumentPrincipalUser && actor.Kind == audit.KindHuman && in.PrincipalID == actor.ID {
		notifyUserID = ""
	}
	var before map[string]any
	if err == nil {
		if err := q.RevokeDocumentShare(ctx, db.RevokeDocumentShareParams{
			ID: prev.ID, OrganizationID: prev.OrganizationID, WorkspaceID: prev.WorkspaceID,
			DocumentID: prev.DocumentID, RevokedBy: nullText(actor.ID),
		}); err != nil {
			return db.DocumentShare{}, err
		}
		before = map[string]any{"level": prev.Level}
	}
	sh, err := q.InsertDocumentShare(ctx, db.InsertDocumentShareParams{
		ID:             util.NewID(),
		OrganizationID: doc.OrganizationID,
		WorkspaceID:    doc.WorkspaceID,
		DocumentID:     doc.ID,
		PrincipalType:  in.PrincipalType,
		PrincipalID:    in.PrincipalID,
		Level:          string(in.Level),
		GrantedBy:      actor.ID,
		GrantedByKind:  string(actor.Kind),
	})
	if err != nil {
		return db.DocumentShare{}, err
	}
	meta := map[string]any{
		"share_id":       sh.ID,
		"principal_type": sh.PrincipalType,
		"principal_id":   sh.PrincipalID,
	}
	if batchID != "" {
		meta["batch_id"] = batchID
	}
	payload := map[string]string{
		"document_id":  doc.ID,
		"workspace_id": doc.WorkspaceID,
		"share_id":     sh.ID,
	}
	if notifyUserID != "" {
		payload["notify_user_id"] = notifyUserID
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: doc.OrganizationID,
		WorkspaceID:    doc.WorkspaceID,
		Actor:          actor,
		Action:         audit.ActionDocumentShared,
		ResourceType:   "document",
		ResourceID:     doc.ID,
		Changes:        audit.Diff(before, map[string]any{"level": sh.Level}),
		Metadata:       meta,
	}, audit.Event{Topic: "document.shared", Payload: payload}); err != nil {
		return db.DocumentShare{}, err
	}
	return sh, nil
}

// mergeDocumentShareIntoHomeRow is a share whose principal is the document's
// own workspace (BR-04, L1): no document_shares row is written - the home row
// carries that workspace's grant - so the command moves visibility to
// 'workspace' at the requested level through the one home-row writer. Q-S1
// refuses manage, and DOC-05 refuses an AdminScope-only caller the widening
// of a restricted document, exactly as the PATCH and the self-share rule do.
func mergeDocumentShareIntoHomeRow(ctx context.Context, q *db.Queries, actor Actor, doc db.Document, access DocumentAccess, level DocumentLevel, batchID string) (db.DocumentShare, error) {
	if level == DocumentLevelManage {
		return db.DocumentShare{}, errHomeRowLevelNotAllowed()
	}
	if doc.Visibility == documentVisibilityRestricted && !access.Level.AtLeast(DocumentLevelManage) {
		return db.DocumentShare{}, errBreakGlassRequired()
	}
	updated, err := writeDocumentHomeRow(ctx, q, actor, doc, documentHomeRowMove{
		Visibility: documentVisibilityWorkspace, WorkspaceLevel: string(level), BatchID: batchID,
	})
	if err != nil {
		return db.DocumentShare{}, err
	}
	return homeWorkspaceShareRow(updated, actor, level), nil
}

// homeWorkspaceShareRow is the answer a merged share gives: the grant the
// home row now holds, in the shape a real grant has (same principal, same
// level, the caller as its grantor). No document_shares row stands behind it,
// so it has no id and no created_at, and it is ended by moving visibility,
// never by revoking a share.
func homeWorkspaceShareRow(doc db.Document, actor Actor, level DocumentLevel) db.DocumentShare {
	return db.DocumentShare{
		OrganizationID: doc.OrganizationID,
		WorkspaceID:    doc.WorkspaceID,
		DocumentID:     doc.ID,
		PrincipalType:  DocumentPrincipalWorkspace,
		PrincipalID:    doc.WorkspaceID,
		Level:          string(level),
		GrantedBy:      actor.ID,
		GrantedByKind:  string(actor.Kind),
	}
}

// validateSharePrincipal keeps every grant inside the document's
// organization (C-01 §3.4): a user must be an active member of it, a
// workspace must belong to it, and an organization share names it.
func (s *DocumentService) validateSharePrincipal(ctx context.Context, q *db.Queries, doc db.Document, in DocumentShareInput) error {
	if in.PrincipalID == "" {
		return Invalid("principal_id bắt buộc")
	}
	switch in.PrincipalType {
	case DocumentPrincipalUser:
		if _, err := s.orgs.RequireMemberQ(ctx, q, doc.OrganizationID, in.PrincipalID); err != nil {
			if isGateRefusal(err) {
				return errPrincipalNotInOrganization()
			}
			return err
		}
	case DocumentPrincipalWorkspace:
		ok, err := workspaceInOrganization(ctx, q, in.PrincipalID, doc.OrganizationID)
		if err != nil {
			return err
		}
		if !ok {
			return errPrincipalNotInOrganization()
		}
	case DocumentPrincipalOrganization:
		if in.PrincipalID != doc.OrganizationID {
			return errPrincipalNotInOrganization()
		}
	default:
		return Invalid("principal_type phải là user, workspace hoặc organization")
	}
	return nil
}

// RevokeDocumentShare ends one live share. The row stays with revoked_at
// set: the table is the history of who had access.
func (s *DocumentService) RevokeDocumentShare(ctx context.Context, actor Actor, documentID, shareID string) error {
	return s.withDocumentViewOrAdministerMutationLocked(ctx, actor, documentID, "", shelveWriteAllowed, func(q *db.Queries, doc db.Document, access DocumentAccess) error {
		if err := requireDocumentACLChange(doc, access); err != nil {
			return err
		}
		sh, err := q.GetLiveDocumentShareByID(ctx, db.GetLiveDocumentShareByIDParams{
			ID: shareID, OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		return revokeDocumentShareRow(ctx, q, actor, doc, sh)
	})
}

// revokeDocumentShareRow ends one live share inside the caller's transaction:
// the row is stamped revoked (the table keeps the history) and the
// document.share_revoked audit row, carrying the principal and its prior
// level, goes out with its ids-only event. RevokeDocumentShare and the
// home-row writer (document_home_row.go) both end shares through it, so a
// merged legacy grant is retracted exactly like one revoked by hand.
func revokeDocumentShareRow(ctx context.Context, q *db.Queries, actor Actor, doc db.Document, sh db.DocumentShare) error {
	return revokeDocumentShareRowWithBatch(ctx, q, actor, doc, sh, "")
}

func revokeDocumentShareRowWithBatch(ctx context.Context, q *db.Queries, actor Actor, doc db.Document, sh db.DocumentShare, batchID string) error {
	if err := q.RevokeDocumentShare(ctx, db.RevokeDocumentShareParams{
		ID: sh.ID, OrganizationID: sh.OrganizationID, WorkspaceID: sh.WorkspaceID,
		DocumentID: sh.DocumentID, RevokedBy: nullText(actor.ID),
	}); err != nil {
		return err
	}
	meta := map[string]any{
		"share_id":       sh.ID,
		"principal_type": sh.PrincipalType,
		"principal_id":   sh.PrincipalID,
		// The prior level is replicated into the metadata the change
		// feed reads (BE-G1-2): a removal is decided from the audit
		// row alone, so the revoked principal and the level it held
		// must sit together in one durable row.
		"level": sh.Level,
	}
	if batchID != "" {
		meta["batch_id"] = batchID
	}
	return auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: doc.OrganizationID,
		WorkspaceID:    doc.WorkspaceID,
		Actor:          actor,
		Action:         audit.ActionDocumentShareRevoked,
		ResourceType:   "document",
		ResourceID:     doc.ID,
		Changes:        audit.Diff(map[string]any{"level": sh.Level}, nil),
		Metadata:       meta,
	}, audit.Event{Topic: "document.share_revoked", Payload: map[string]string{
		"document_id":  doc.ID,
		"workspace_id": doc.WorkspaceID,
		"share_id":     sh.ID,
	}})
}

// DocumentAccessSource via values on GET /api/v1/documents/{documentID}/shares (SH-S2, UNI-1781).
const (
	DocumentAccessSourceViaOwner       = "owner"
	DocumentAccessSourceViaMember      = "member"
	DocumentAccessSourceViaShare       = "share"
	DocumentAccessSourceViaOrgAdmin    = "org_admin"
	DocumentAccessSourceViaBreakGlass  = "break_glass"
	DocumentAccessSourceViaWorkProduct = "work_product"
)

// DocumentAccessSource is one path through which a person receives access on a document.
type DocumentAccessSource struct {
	Via           string
	PrincipalType string
	PrincipalID   string
	Name          string
	Level         DocumentLevel
}

// DocumentHomeWorkspaceAccess is the home_workspace block on GET /documents/{id}/shares.
type DocumentHomeWorkspaceAccess struct {
	WorkspaceID   string
	WorkspaceName string
	Visibility    string
	Level         *DocumentLevel
}

// DocumentShareAccess is one share row with what it grants right now.
type DocumentShareAccess struct {
	Share db.DocumentShare
	// Active is false when the grant no longer reaches anyone through this
	// row: a user who left or was deactivated, a workspace gone from the
	// organization, or any share on an owned document (§13.4 ignores them).
	Active bool
	// Effective is, for a user principal, the level that person holds on
	// the document now through every path (a workspace admin shared "view"
	// still manages). For workspace and organization principals it is the
	// share's level, applied to their effective members at read time.
	Effective DocumentAccess
	// Sources and Warnings are populated for user principals (SH-S2, UNI-1781).
	Sources  []DocumentAccessSource
	Warnings []string
}

// DocumentAccessOverview answers "who has access" (C-01 §5.3). Everyone who
// reads the document gets their own level and MySources; only manage/AdminScope
// sees the rest.
type DocumentAccessOverview struct {
	My            DocumentAccess
	MySources     []DocumentAccessSource
	ACLOwner      *DocumentPersonAccess
	HomeWorkspace *DocumentHomeWorkspaceAccess
	Shares        []DocumentShareAccess
	Links         []db.DocumentShareLink
	// BreakGlass is the live emergency grants, newest first (DOC-05).
	BreakGlass []DocumentBreakGlassGrantView
}

// DocumentPersonAccess is one person's effective level.
type DocumentPersonAccess struct {
	UserID string
	Access DocumentAccess
}

// DocumentAccessList resolves effective access rather than echoing
// document_shares rows. A reader below manage gets only My; a caller who may
// administer the document (manage or AdminScope, DOC-05) gets the full lists.
func (s *DocumentService) DocumentAccessList(ctx context.Context, actor Actor, documentID string) (DocumentAccessOverview, error) {
	doc, my, err := s.authorizeDocumentViewOrAdminister(ctx, actor, documentID)
	if err != nil {
		return DocumentAccessOverview{}, err
	}
	shares, err := s.q.ListDocumentShares(ctx, db.ListDocumentSharesParams{
		OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
	})
	if err != nil {
		return DocumentAccessOverview{}, err
	}
	mySources := []DocumentAccessSource{}
	if actor.Kind == audit.KindHuman {
		mySources, err = s.personAccessSources(ctx, doc, shares, actor.ID)
		if err != nil {
			return DocumentAccessOverview{}, err
		}
	}
	out := DocumentAccessOverview{My: my, MySources: mySources}
	if !my.canAdminister() {
		return out, nil
	}
	if out.ACLOwner, err = s.aclOwnerAccess(ctx, doc); err != nil {
		return DocumentAccessOverview{}, err
	}
	homeWS, err := s.q.GetWorkspaceByID(ctx, doc.WorkspaceID)
	if err != nil {
		return DocumentAccessOverview{}, err
	}
	homeLvl, hasHomeLvl := currentHomeWorkspaceLevel(doc, filterHomeWorkspaceShares(shares, doc.WorkspaceID))
	var homeLvlPtr *DocumentLevel
	if hasHomeLvl {
		l := homeLvl
		homeLvlPtr = &l
	}
	out.HomeWorkspace = &DocumentHomeWorkspaceAccess{
		WorkspaceID:   doc.WorkspaceID,
		WorkspaceName: homeWS.Name,
		Visibility:    doc.Visibility,
		Level:         homeLvlPtr,
	}

	for _, sh := range shares {
		entry := DocumentShareAccess{Share: sh}
		switch {
		case doc.OwnerKind.Valid:
		case sh.PrincipalType == DocumentPrincipalUser:
			acc, err := s.personAccess(ctx, doc, sh.PrincipalID)
			if err != nil {
				return DocumentAccessOverview{}, err
			}
			entry.Effective = acc
			entry.Active = acc.Level != DocumentLevelNone
			if entry.Active {
				srcs, err := s.personAccessSources(ctx, doc, shares, sh.PrincipalID)
				if err != nil {
					return DocumentAccessOverview{}, err
				}
				entry.Sources = srcs
				if acc.Level.rank() > DocumentLevel(sh.Level).rank() {
					entry.Warnings = []string{DocumentAccessWarningDirectBelowGroup}
				}
			}
		case sh.PrincipalType == DocumentPrincipalWorkspace || sh.PrincipalType == DocumentPrincipalOrganization:
			ok, err := groupShareActive(ctx, s.q, doc.OrganizationID, sh.PrincipalType, sh.PrincipalID)
			if err != nil {
				return DocumentAccessOverview{}, err
			}
			entry.Active = ok
		}
		if entry.Active && sh.PrincipalType != DocumentPrincipalUser {
			entry.Effective = DocumentAccess{Level: DocumentLevel(sh.Level), Via: DocumentViaShare}
		}
		out.Shares = append(out.Shares, entry)
	}
	if !doc.OwnerKind.Valid {
		links, err := s.q.ListLiveDocumentShareLinks(ctx, db.ListLiveDocumentShareLinksParams{
			OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
		})
		if err != nil {
			return DocumentAccessOverview{}, err
		}
		out.Links = links
		if out.BreakGlass, err = s.listLiveBreakGlass(ctx, doc); err != nil {
			return DocumentAccessOverview{}, err
		}
	}
	return out, nil
}

func (s *DocumentService) personAccessSources(ctx context.Context, doc db.Document, shares []db.DocumentShare, userID string) ([]DocumentAccessSource, error) {
	sources := make([]DocumentAccessSource, 0)
	if userID == "" {
		return sources, nil
	}
	if _, err := s.orgs.RequireMemberQ(ctx, s.q, doc.OrganizationID, userID); err != nil {
		if isGateRefusal(err) {
			return sources, nil
		}
		return nil, err
	}
	if doc.OwnerKind.Valid {
		lvl, err := s.ownerLevelResolve(ctx, Human(userID), doc.OwnerID.String)
		if err != nil {
			if isGateRefusal(err) {
				return sources, nil
			}
			return nil, err
		}
		if lvl != DocumentLevelNone {
			sources = append(sources, DocumentAccessSource{
				Via:           DocumentAccessSourceViaWorkProduct,
				PrincipalType: doc.OwnerKind.String,
				PrincipalID:   doc.OwnerID.String,
				Level:         lvl,
			})
		}
		return sources, nil
	}
	u, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return sources, nil
		}
		return nil, err
	}
	homeWS, err := s.q.GetWorkspaceByID(ctx, doc.WorkspaceID)
	if err != nil {
		return nil, err
	}
	homeLvl, hasHomeLvl := currentHomeWorkspaceLevel(doc, filterHomeWorkspaceShares(shares, doc.WorkspaceID))

	var adminScope bool
	m, err := s.ws.RequireMemberQ(ctx, s.q, doc.WorkspaceID, userID)
	switch {
	case err == nil:
		isACLOwner := doc.AclOwnerID.Valid && doc.AclOwnerID.String == userID
		adminScope = (m.Role == "owner" || m.Role == "admin") && doc.Visibility == documentVisibilityRestricted && !isACLOwner
		if isACLOwner {
			sources = append(sources, DocumentAccessSource{
				Via:           DocumentAccessSourceViaOwner,
				PrincipalType: DocumentPrincipalUser,
				PrincipalID:   userID,
				Name:          u.DisplayName,
				Level:         DocumentLevelManage,
			})
		}
		if (m.Role == "owner" || m.Role == "admin") && doc.Visibility != documentVisibilityRestricted && !isACLOwner {
			sources = append(sources, DocumentAccessSource{
				Via:           DocumentAccessSourceViaOrgAdmin,
				PrincipalType: DocumentPrincipalWorkspace,
				PrincipalID:   doc.WorkspaceID,
				Name:          homeWS.Name,
				Level:         DocumentLevelManage,
			})
		} else if hasHomeLvl {
			sources = append(sources, DocumentAccessSource{
				Via:           DocumentAccessSourceViaMember,
				PrincipalType: DocumentPrincipalWorkspace,
				PrincipalID:   doc.WorkspaceID,
				Name:          homeWS.Name,
				Level:         homeLvl,
			})
		}
	case isGateRefusal(err):
	default:
		return nil, err
	}

	for _, sh := range shares {
		switch sh.PrincipalType {
		case DocumentPrincipalWorkspace:
			if sh.PrincipalID == doc.WorkspaceID {
				continue
			}
			applies, err := s.shareAppliesTo(ctx, s.q, sh, userID, doc)
			if err != nil {
				return nil, err
			}
			if !applies {
				continue
			}
			ws, err := s.q.GetWorkspaceByID(ctx, sh.PrincipalID)
			if err != nil {
				return nil, err
			}
			sources = append(sources, DocumentAccessSource{
				Via:           DocumentAccessSourceViaShare,
				PrincipalType: DocumentPrincipalWorkspace,
				PrincipalID:   sh.PrincipalID,
				Name:          ws.Name,
				Level:         DocumentLevel(sh.Level),
			})
		case DocumentPrincipalOrganization:
			if sh.PrincipalID != doc.OrganizationID {
				continue
			}
			org, err := s.q.GetOrganizationByID(ctx, doc.OrganizationID)
			if err != nil {
				return nil, err
			}
			sources = append(sources, DocumentAccessSource{
				Via:           DocumentAccessSourceViaShare,
				PrincipalType: DocumentPrincipalOrganization,
				PrincipalID:   sh.PrincipalID,
				Name:          org.Name,
				Level:         DocumentLevel(sh.Level),
			})
		case DocumentPrincipalUser:
			if sh.PrincipalID != userID {
				continue
			}
			sources = append(sources, DocumentAccessSource{
				Via:           DocumentAccessSourceViaShare,
				PrincipalType: DocumentPrincipalUser,
				PrincipalID:   userID,
				Name:          u.DisplayName,
				Level:         DocumentLevel(sh.Level),
			})
		}
	}

	if adminScope {
		g, err := s.q.GetLiveDocumentBreakGlassGrantForActor(ctx, db.GetLiveDocumentBreakGlassGrantForActorParams{
			OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
			ActorID: userID, ActorKind: string(audit.KindHuman),
		})
		switch {
		case err == nil:
			sources = append(sources, DocumentAccessSource{
				Via:           DocumentAccessSourceViaBreakGlass,
				PrincipalType: DocumentPrincipalUser,
				PrincipalID:   userID,
				Name:          u.DisplayName,
				Level:         capDocumentLevel(DocumentLevel(g.Level), DocumentLevelView),
			})
		case errors.Is(err, pgx.ErrNoRows):
		default:
			return nil, err
		}
	}
	return sources, nil
}

// groupShareActive is whether a workspace or organization share still
// reaches anyone: a workspace principal while it is a workspace of the
// document's organization, an organization principal when it is that
// organization. DocumentAccessList and the access report both answer
// "active" through it.
func groupShareActive(ctx context.Context, q *db.Queries, organizationID, principalType, principalID string) (bool, error) {
	switch principalType {
	case DocumentPrincipalWorkspace:
		return workspaceInOrganization(ctx, q, principalID, organizationID)
	case DocumentPrincipalOrganization:
		return principalID == organizationID, nil
	}
	return false, nil
}

// personAccess is one person's level with a closed-tenant answer folded to
// none: a deactivated member holds nothing on the list.
func (s *DocumentService) personAccess(ctx context.Context, doc db.Document, userID string) (DocumentAccess, error) {
	acc, err := s.effectiveLevel(ctx, s.q, Human(userID), doc)
	if err != nil && !isGateRefusal(err) {
		return DocumentAccess{}, err
	}
	if err != nil {
		return DocumentAccess{}, nil
	}
	return acc, nil
}

// SharedDocument is one row of "shared with me".
type SharedDocument struct {
	Document db.Document
	Access   DocumentAccess
	Facts    DocumentListFacts
	// EditLock is who is editing this row's document right now, when a live
	// tenure exists (UNI-1645 §3.2); nil when nobody holds it. It never
	// carries the tenure id.
	EditLock *DocumentEditLockSummary
	// ShareScope summarizes who reaches this row's document (SH-S3, UNI-1782;
	// addendum §6.4, §7); nil for agent actors.
	ShareScope *DocumentShareScope
}

// SharedWithMeQuery is one page request of the recipient's shared list.
// AfterCreatedAt/AfterID are the keyset of the last candidate the previous
// page read (both empty starts at the newest share).
type SharedWithMeQuery struct {
	Limit          int
	AfterCreatedAt time.Time
	AfterID        string
	// Format and Access are the same library filters the other lists take
	// (UNI-1868); an unknown value is 400 invalid_filter.
	Format string
	Access string
}

// SharedWithMePage is one page of shared documents plus the keyset of the
// last candidate read. NextID is empty when the candidates were exhausted.
type SharedWithMePage struct {
	Items         []SharedDocument
	NextCreatedAt time.Time
	NextID        string
}

// sharedWithMeCandidatePage is how many share candidates one SQL page reads
// before the effective-level filter runs. Variable so tests can shrink it.
var sharedWithMeCandidatePage = 200

// EffectiveSharedWithMeLimit clamps the requested page size the way the other
// document lists do (<= 0 -> default, > cap -> cap).
func EffectiveSharedWithMeLimit(limit int) int {
	if limit <= 0 {
		return defaultDocumentListPage
	}
	if limit > maxDocumentListPage {
		return maxDocumentListPage
	}
	return limit
}

// ListSharedWithMe lists the documents a person reaches through a share in
// one organization, from any of its workspaces - the recipient never has to
// join the source workspace (plan §3.1). The organization gate runs first;
// workspace shares are narrowed to the workspaces WorkspaceService says the
// person reaches. Candidates are walked by keyset in SQL pages and every one
// runs effectiveLevel before it may fill a result slot, so a denied candidate
// never consumes one; the walk stops at `limit` visible rows or exhausted
// candidates and returns the keyset of the last row processed so the route
// can hand out an opaque next cursor.
func (s *DocumentService) ListSharedWithMe(ctx context.Context, userID, organizationID string, in SharedWithMeQuery) (SharedWithMePage, error) {
	page, err := s.listSharedWithMePage(ctx, userID, organizationID, in)
	if err != nil {
		return SharedWithMePage{}, err
	}
	facts, err := s.listFacts(ctx, organizationID, sharedDocuments(page.Items))
	if err != nil {
		return SharedWithMePage{}, err
	}
	for i := range page.Items {
		page.Items[i].Facts = facts[i]
	}
	if err := s.attachSharedEditLocks(ctx, Human(userID), organizationID, page.Items); err != nil {
		return SharedWithMePage{}, err
	}
	return page, s.attachSharedShareScopes(ctx, Human(userID), organizationID, page.Items)
}

func (s *DocumentService) listSharedWithMePage(ctx context.Context, userID, organizationID string, in SharedWithMeQuery) (SharedWithMePage, error) {
	if _, err := s.orgs.RequireMember(ctx, organizationID, userID); err != nil {
		if errors.Is(err, ErrForbidden) {
			return SharedWithMePage{}, ErrNotFound
		}
		return SharedWithMePage{}, err
	}
	workspaces, err := s.ws.ListForUser(ctx, userID)
	if err != nil {
		return SharedWithMePage{}, err
	}
	workspaceIDs := make([]string, 0, len(workspaces))
	for _, w := range workspaces {
		if w.OrganizationID == organizationID {
			workspaceIDs = append(workspaceIDs, w.ID)
		}
	}
	limit := EffectiveSharedWithMeLimit(in.Limit)
	filters, err := resolveListFilters(in.Format, in.Access, "", false)
	if err != nil {
		return SharedWithMePage{}, err
	}
	afterAt, afterID := in.AfterCreatedAt, in.AfterID
	if afterAt.IsZero() || afterID == "" {
		afterAt, afterID = time.Time{}, ""
	}
	out := make([]SharedDocument, 0, limit)
	for {
		params := db.ListDocumentShareCandidatesParams{
			OrganizationID: organizationID, UserID: userID, WorkspaceIds: workspaceIDs,
			MaxRows: int32(sharedWithMeCandidatePage),
			// The candidate walk asks SQL for the filters too, so a page of
			// candidates is already the filtered set; the effective-level
			// filter below stays the authority for who is a recipient.
			Format: nullText(filters.format), FormatMime: nullText(filters.formatMime),
			FormatMimes: files.DocumentFormatMimes(),
			Access:      nullText(filters.access), AccessLevels: filters.accessLevels,
		}
		if !afterAt.IsZero() {
			params.AfterCreatedAt = pgtype.Timestamptz{Time: afterAt, Valid: true}
			params.AfterID = nullText(afterID)
		}
		rows, err := s.q.ListDocumentShareCandidates(ctx, params)
		if err != nil {
			return SharedWithMePage{}, err
		}
		// Each candidate tags the request with its own workspace (same
		// organization); telemetry has no reset, so a list that spans
		// workspaces carries the last one - the organization tag is exact.
		for _, r := range rows {
			acc, err := s.effectiveLevel(ctx, s.q, Human(userID), r.Document)
			if err != nil {
				return SharedWithMePage{}, err
			}
			if acc.Via != DocumentViaShare || acc.Level == DocumentLevelNone {
				continue
			}
			out = append(out, SharedDocument{Document: r.Document, Access: acc})
			if len(out) == limit {
				// The keyset points just past the row that filled the page;
				// candidates after it (denied or not) are re-read by the next
				// request, never dropped. A full page may still have no
				// successor, and the next call then answers an empty page.
				return SharedWithMePage{Items: out, NextCreatedAt: r.CreatedAt.Time, NextID: r.Document.ID}, nil
			}
		}
		if len(rows) < sharedWithMeCandidatePage {
			break
		}
		last := rows[len(rows)-1]
		afterAt, afterID = last.CreatedAt.Time, last.Document.ID
	}
	return SharedWithMePage{Items: out}, nil
}
