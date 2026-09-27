package service

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
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

// requireDocumentACLChange is the shared head of every share/link command:
// the actor must read the document (otherwise not found), an owned document
// is refused for everyone who reads it, and only manage may change access.
func requireDocumentACLChange(doc db.Document, access DocumentAccess) error {
	if doc.OwnerKind.Valid {
		return errDocumentOwned()
	}
	if !access.Level.AtLeast(DocumentLevelManage) {
		return ErrForbidden
	}
	return nil
}

// ShareDocument grants a level to a user, a workspace or the whole
// organization. A live share for the same principal at another level is
// revoked and a new row inserted in the same transaction, so the table keeps
// the history of every grant; the same level again changes nothing. Shares
// never inherit to child pages (C-01 §4).
func (s *DocumentService) ShareDocument(ctx context.Context, actor Actor, documentID string, in DocumentShareInput) (db.DocumentShare, error) {
	switch in.Level {
	case DocumentLevelView, DocumentLevelEdit, DocumentLevelManage:
	default:
		return db.DocumentShare{}, Invalid("level phải là view, edit hoặc manage")
	}
	var out db.DocumentShare
	err := s.withDocumentMutation(ctx, actor, documentID, DocumentLevelView, func(q *db.Queries, doc db.Document, access DocumentAccess) error {
		if err := requireDocumentACLChange(doc, access); err != nil {
			return err
		}
		if err := s.validateSharePrincipal(ctx, q, doc, in); err != nil {
			return err
		}
		prev, err := q.GetDocumentShare(ctx, db.GetDocumentShareParams{
			OrganizationID: doc.OrganizationID,
			WorkspaceID:    doc.WorkspaceID,
			DocumentID:     doc.ID,
			PrincipalType:  in.PrincipalType,
			PrincipalID:    in.PrincipalID,
		})
		var before map[string]any
		switch {
		case err == nil:
			if prev.Level == string(in.Level) {
				out = prev
				return nil
			}
			if err := q.RevokeDocumentShare(ctx, db.RevokeDocumentShareParams{
				ID: prev.ID, OrganizationID: prev.OrganizationID, WorkspaceID: prev.WorkspaceID,
				DocumentID: prev.DocumentID, RevokedBy: nullText(actor.ID),
			}); err != nil {
				return err
			}
			before = map[string]any{"level": prev.Level}
		case errors.Is(err, pgx.ErrNoRows):
		default:
			return err
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
			return err
		}
		if err := auditRecorder.Record(ctx, q, audit.Entry{
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
			},
		}, audit.Event{Topic: "document.shared", Payload: map[string]string{
			"document_id":  doc.ID,
			"workspace_id": doc.WorkspaceID,
			"share_id":     sh.ID,
		}}); err != nil {
			return err
		}
		out = sh
		return nil
	})
	return out, err
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
	return s.withDocumentMutation(ctx, actor, documentID, DocumentLevelView, func(q *db.Queries, doc db.Document, access DocumentAccess) error {
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
		if err := q.RevokeDocumentShare(ctx, db.RevokeDocumentShareParams{
			ID: sh.ID, OrganizationID: sh.OrganizationID, WorkspaceID: sh.WorkspaceID,
			DocumentID: sh.DocumentID, RevokedBy: nullText(actor.ID),
		}); err != nil {
			return err
		}
		return auditRecorder.Record(ctx, q, audit.Entry{
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
			},
		}, audit.Event{Topic: "document.share_revoked", Payload: map[string]string{
			"document_id":  doc.ID,
			"workspace_id": doc.WorkspaceID,
			"share_id":     sh.ID,
		}})
	})
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
}

// DocumentAccessOverview answers "who has access" (C-01 §5.3). Everyone who
// reads the document gets their own level; only manage sees the rest.
type DocumentAccessOverview struct {
	My       DocumentAccess
	ACLOwner *DocumentPersonAccess
	Shares   []DocumentShareAccess
	Links    []db.DocumentShareLink
}

// DocumentPersonAccess is one person's effective level.
type DocumentPersonAccess struct {
	UserID string
	Access DocumentAccess
}

// DocumentAccessList resolves effective access rather than echoing
// document_shares rows.
func (s *DocumentService) DocumentAccessList(ctx context.Context, actor Actor, documentID string) (DocumentAccessOverview, error) {
	doc, my, err := s.authorizeDocument(ctx, actor, documentID, DocumentLevelView)
	if err != nil {
		return DocumentAccessOverview{}, err
	}
	out := DocumentAccessOverview{My: my}
	if !my.Level.AtLeast(DocumentLevelManage) {
		return out, nil
	}
	if doc.AclOwnerID.Valid && !doc.OwnerKind.Valid {
		acc, err := s.personAccess(ctx, doc, doc.AclOwnerID.String)
		if err != nil {
			return DocumentAccessOverview{}, err
		}
		out.ACLOwner = &DocumentPersonAccess{UserID: doc.AclOwnerID.String, Access: acc}
	}
	shares, err := s.q.ListDocumentShares(ctx, db.ListDocumentSharesParams{
		OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
	})
	if err != nil {
		return DocumentAccessOverview{}, err
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
		case sh.PrincipalType == DocumentPrincipalWorkspace:
			ok, err := workspaceInOrganization(ctx, s.q, sh.PrincipalID, doc.OrganizationID)
			if err != nil {
				return DocumentAccessOverview{}, err
			}
			entry.Active = ok
		case sh.PrincipalType == DocumentPrincipalOrganization:
			entry.Active = sh.PrincipalID == doc.OrganizationID
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
	}
	return out, nil
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
}

const maxSharedWithMe = 200

// ListSharedWithMe lists the documents a person reaches through a share in
// one organization, from any of its workspaces - the recipient never has to
// join the source workspace (plan §3.1). The organization gate runs first;
// workspace shares are narrowed to the workspaces WorkspaceService says the
// person reaches, and every candidate then goes through effectiveLevel, so a
// revoked, superseded or no-longer-reaching share drops out.
func (s *DocumentService) ListSharedWithMe(ctx context.Context, userID, organizationID string) ([]SharedDocument, error) {
	if _, err := s.orgs.RequireMember(ctx, organizationID, userID); err != nil {
		if errors.Is(err, ErrForbidden) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	workspaces, err := s.ws.ListForUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	workspaceIDs := make([]string, 0, len(workspaces))
	for _, w := range workspaces {
		if w.OrganizationID == organizationID {
			workspaceIDs = append(workspaceIDs, w.ID)
		}
	}
	rows, err := s.q.ListDocumentShareCandidates(ctx, db.ListDocumentShareCandidatesParams{
		OrganizationID: organizationID, UserID: userID, WorkspaceIds: workspaceIDs, MaxRows: maxSharedWithMe,
	})
	if err != nil {
		return nil, err
	}
	// Each candidate tags the request with its own workspace (same
	// organization); telemetry has no reset, so a list that spans
	// workspaces carries the last one - the organization tag is exact.
	out := make([]SharedDocument, 0, len(rows))
	for _, r := range rows {
		acc, err := s.effectiveLevel(ctx, s.q, Human(userID), r.Document)
		if err != nil {
			return nil, err
		}
		if acc.Via == DocumentViaShare && acc.Level != DocumentLevelNone {
			out = append(out, SharedDocument{Document: r.Document, Access: acc})
		}
	}
	return out, nil
}
