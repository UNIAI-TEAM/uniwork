package service

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Break-glass (DOC-05; UNI-1628, addendum section 4): a workspace owner/admin
// holds no read access to a restricted document by role. They may open
// emergency view access - view only, 24 hours, with a written reason, an audit
// row and a notification to the document's owner - and end it again. The
// level it gives is resolved in resolveLevelInTenant; this file is the write
// path and the admin reads.
const (
	breakGlassTTL       = 24 * time.Hour
	breakGlassReasonMin = 10
	breakGlassReasonMax = 500
)

func errBreakGlassReasonInvalid(length int) error {
	return CodedError{
		Code: "break_glass_reason_invalid", Status: http.StatusUnprocessableEntity,
		Msg:    "lý do truy cập khẩn cấp phải từ 10 đến 500 ký tự",
		Fields: map[string]any{"min": breakGlassReasonMin, "max": breakGlassReasonMax, "length": length},
	}
}

// DocumentBreakGlassGrantView is one grant with the display name of the person
// who opened it ("" when the account no longer exists).
type DocumentBreakGlassGrantView struct {
	Grant     db.DocumentBreakGlassGrant
	ActorName string
}

// breakGlassView attaches the opener's display name to a grant.
func breakGlassView(ctx context.Context, q *db.Queries, g db.DocumentBreakGlassGrant) (DocumentBreakGlassGrantView, error) {
	out := DocumentBreakGlassGrantView{Grant: g}
	if g.ActorKind != string(audit.KindHuman) {
		return out, nil
	}
	u, err := q.GetUserByID(ctx, g.ActorID)
	switch {
	case err == nil:
		out.ActorName = u.DisplayName
	case errors.Is(err, pgx.ErrNoRows):
	default:
		return DocumentBreakGlassGrantView{}, err
	}
	return out, nil
}

// GrantDocumentBreakGlass opens 24 hours of view access for a workspace
// owner/admin on a restricted document they are not the ACL owner of. The
// bool is true for a new grant and false when the caller already holds a live
// one: that one is returned as it is, with no new audit row and no new
// notification. Only AdminScope callers may open one (a reader gets forbidden,
// anyone else not found); the reason is checked after that, so a refused
// caller learns nothing about the bounds.
func (s *DocumentService) GrantDocumentBreakGlass(ctx context.Context, actor Actor, documentID, reason string) (DocumentBreakGlassGrantView, bool, error) {
	var out DocumentBreakGlassGrantView
	created := false
	err := s.withDocumentViewOrAdministerMutationLocked(ctx, actor, documentID, "", shelveWriteRefused, func(q *db.Queries, doc db.Document, access DocumentAccess) error {
		if doc.OwnerKind.Valid {
			return errDocumentOwned()
		}
		if isMyFolder(doc) {
			return errMyFolderLocked()
		}
		if actor.Kind != audit.KindHuman || !access.AdminScope {
			return ErrForbidden
		}
		reason = strings.TrimSpace(reason)
		if n := utf8.RuneCountInString(reason); n < breakGlassReasonMin || n > breakGlassReasonMax {
			return errBreakGlassReasonInvalid(n)
		}
		live, err := q.GetLiveDocumentBreakGlassGrantForActor(ctx, db.GetLiveDocumentBreakGlassGrantForActorParams{
			OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
			ActorID: actor.ID, ActorKind: string(actor.Kind),
		})
		switch {
		case err == nil:
			out, err = breakGlassView(ctx, q, live)
			return err
		case !errors.Is(err, pgx.ErrNoRows):
			return err
		}
		expires := time.Now().UTC().Add(breakGlassTTL)
		g, err := q.InsertDocumentBreakGlassGrant(ctx, db.InsertDocumentBreakGlassGrantParams{
			ID: util.NewID(), OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
			DocumentID: doc.ID, ActorID: actor.ID, ActorKind: string(actor.Kind),
			Level: string(DocumentLevelView), Reason: reason,
			ExpiresAt: pgtype.Timestamptz{Time: expires, Valid: true},
		})
		if err != nil {
			return err
		}
		if err := auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: doc.OrganizationID,
			WorkspaceID:    doc.WorkspaceID,
			Actor:          actor,
			Action:         audit.ActionDocumentBreakGlassGranted,
			ResourceType:   "document",
			ResourceID:     doc.ID,
			Metadata: map[string]any{
				"grant_id":   g.ID,
				"level":      g.Level,
				"reason":     reason,
				"expires_at": expires.Format(time.RFC3339),
			},
		}, audit.Event{Topic: "document.break_glass_granted", Payload: map[string]string{
			"document_id":  doc.ID,
			"workspace_id": doc.WorkspaceID,
			"grant_id":     g.ID,
		}}); err != nil {
			return err
		}
		created = true
		out, err = breakGlassView(ctx, q, g)
		return err
	})
	if err != nil {
		return DocumentBreakGlassGrantView{}, false, err
	}
	return out, created, nil
}

// RevokeDocumentBreakGlass ends a grant now. The grant's own holder ("End
// access") or anyone who may administer the document may do it. A grant that
// is already revoked or expired answers success and writes nothing; one that
// is not on this document is not found.
func (s *DocumentService) RevokeDocumentBreakGlass(ctx context.Context, actor Actor, documentID, grantID string) error {
	return s.withDocumentViewOrAdministerMutationLocked(ctx, actor, documentID, "", shelveWriteAllowed, func(q *db.Queries, doc db.Document, access DocumentAccess) error {
		g, err := q.GetDocumentBreakGlassGrant(ctx, db.GetDocumentBreakGlassGrantParams{
			OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID, ID: grantID,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		own := g.ActorID == actor.ID && g.ActorKind == string(actor.Kind)
		if !own && !access.canAdminister() {
			return ErrForbidden
		}
		if g.RevokedAt.Valid || !g.ExpiresAt.Time.After(time.Now()) {
			return nil
		}
		n, err := q.RevokeDocumentBreakGlassGrant(ctx, db.RevokeDocumentBreakGlassGrantParams{
			ID: g.ID, OrganizationID: g.OrganizationID, WorkspaceID: g.WorkspaceID, DocumentID: g.DocumentID,
			RevokedBy: nullText(actor.ID),
		})
		if err != nil {
			return err
		}
		if n == 0 {
			return nil
		}
		by := "administrator"
		if own {
			by = "holder"
		}
		return auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: doc.OrganizationID,
			WorkspaceID:    doc.WorkspaceID,
			Actor:          actor,
			Action:         audit.ActionDocumentBreakGlassRevoked,
			ResourceType:   "document",
			ResourceID:     doc.ID,
			Metadata: map[string]any{
				"grant_id":   g.ID,
				"grantee_id": g.ActorID,
				"level":      g.Level,
				"ended_by":   by,
			},
		}, audit.Event{Topic: "document.break_glass_revoked", Payload: map[string]string{
			"document_id":  doc.ID,
			"workspace_id": doc.WorkspaceID,
			"grant_id":     g.ID,
		}})
	})
}

// listLiveBreakGlass is the live grants of a document, newest first, for the
// access panel of those who may administer it.
func (s *DocumentService) listLiveBreakGlass(ctx context.Context, doc db.Document) ([]DocumentBreakGlassGrantView, error) {
	rows, err := s.q.ListLiveDocumentBreakGlassGrants(ctx, db.ListLiveDocumentBreakGlassGrantsParams{
		OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
	})
	if err != nil {
		return nil, err
	}
	out := make([]DocumentBreakGlassGrantView, 0, len(rows))
	for _, g := range rows {
		v, err := breakGlassView(ctx, s.q, g)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, nil
}

// aclOwnerAccess is the acl_owner block of the access overview and the admin
// summary: nil for a document with no ACL owner or one a work product owns.
func (s *DocumentService) aclOwnerAccess(ctx context.Context, doc db.Document) (*DocumentPersonAccess, error) {
	if !doc.AclOwnerID.Valid || doc.OwnerKind.Valid {
		return nil, nil
	}
	acc, err := s.personAccess(ctx, doc, doc.AclOwnerID.String)
	if err != nil {
		return nil, err
	}
	return &DocumentPersonAccess{UserID: doc.AclOwnerID.String, Access: acc}, nil
}

// breakGlassExpiry is the end of the live grant a read through break-glass
// runs on, so the banner can show it without a second call. Zero when the
// access is not break-glass.
func (s *DocumentService) breakGlassExpiry(ctx context.Context, q *db.Queries, actor Actor, doc db.Document, access DocumentAccess) (time.Time, error) {
	if access.Via != DocumentViaBreakGlass {
		return time.Time{}, nil
	}
	g, err := q.GetLiveDocumentBreakGlassGrantForActor(ctx, db.GetLiveDocumentBreakGlassGrantForActorParams{
		OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
		ActorID: actor.ID, ActorKind: string(actor.Kind),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return time.Time{}, nil
	}
	if err != nil {
		return time.Time{}, err
	}
	return g.ExpiresAt.Time, nil
}

// DocumentAdminSummary is what an administrator sees of a restricted document
// they cannot read: metadata, the ACL owner and their own standing. Never
// content.
type DocumentAdminSummary struct {
	Document  db.Document
	SizeBytes int64
	ACLOwner  *DocumentPersonAccess
	My        DocumentAccess
	MyGrant   *DocumentBreakGlassGrantView
}

// DocumentAdminSummary answers GET /documents/{id}/admin-summary for a caller
// who may administer the document (manage or AdminScope); a reader below that
// is forbidden, anyone else not found.
func (s *DocumentService) DocumentAdminSummary(ctx context.Context, actor Actor, documentID string) (DocumentAdminSummary, error) {
	doc, my, err := s.authorizeDocumentAdminister(ctx, actor, documentID)
	if err != nil {
		return DocumentAdminSummary{}, err
	}
	out := DocumentAdminSummary{Document: doc, My: my}
	facts, err := s.listFacts(ctx, doc.OrganizationID, []db.Document{doc})
	if err != nil {
		return DocumentAdminSummary{}, err
	}
	if len(facts) == 1 {
		out.SizeBytes = facts[0].SizeBytes
	}
	if out.ACLOwner, err = s.aclOwnerAccess(ctx, doc); err != nil {
		return DocumentAdminSummary{}, err
	}
	if actor.Kind != audit.KindHuman {
		return out, nil
	}
	g, err := s.q.GetLiveDocumentBreakGlassGrantForActor(ctx, db.GetLiveDocumentBreakGlassGrantForActorParams{
		OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
		ActorID: actor.ID, ActorKind: string(actor.Kind),
	})
	switch {
	case err == nil:
		v, err := breakGlassView(ctx, s.q, g)
		if err != nil {
			return DocumentAdminSummary{}, err
		}
		out.MyGrant = &v
	case !errors.Is(err, pgx.ErrNoRows):
		return DocumentAdminSummary{}, err
	}
	return out, nil
}
