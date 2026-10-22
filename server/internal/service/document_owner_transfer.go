package service

import (
	"context"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Per-document owner transfer (DOC-06, UNI-2084; access addendum §2.1, §2.3,
// §4.2). The ACL owner slot of one document moves to another person. The
// command runs through withDocumentAdministerMutation (canAdminister: manage
// or AdminScope), so the row lock, the gate re-check and every write below are
// one transaction: the new owner, the previous owner's share, the audit row
// and the ids-only event commit together or not at all.
//
// The bulk route (orgs/{org}/members/{userID}/document-ownership) is S-DOC06b;
// it writes the same audit action and topic with bulk_id added.

const topicDocumentOwnerTransferred = "document.owner_transferred"

// DocumentOwnerTransferInput is the body of PUT /documents/{id}/owner.
// PreviousOwnerLevel is edit (the default when empty), comment, view or none.
type DocumentOwnerTransferInput struct {
	UserID             string
	PreviousOwnerLevel string
}

// DocumentOwnerTransfer is the answer: the new owner, the previous one, and
// the share the previous owner keeps - empty when they keep nothing (none, a
// deactivated previous owner, a folder) and both previous fields empty when
// the recipient already owned the document.
type DocumentOwnerTransfer struct {
	DocumentID           string
	ACLOwnerID           string
	PreviousOwnerID      string
	PreviousOwnerShareID string
}

// errOwnerTargetNotMember refuses a recipient who cannot hold the ACL owner
// slot: not a person, not an active member of the organization, or not an
// effective member of the document's workspace. The ACL owner manages only
// through the workspace gate (resolveLevelInTenantFromShares), so handing the
// slot to anyone else would leave a document nobody manages as its owner.
func errOwnerTargetNotMember() error {
	return coded(http.StatusUnprocessableEntity, "owner_target_not_member", "người nhận phải là thành viên đang hoạt động của workspace chứa tài liệu")
}

// previousOwnerLevel resolves the body's previous_owner_level. The name is
// returned too, because none has no DocumentLevel of its own and the audit
// row records what was asked.
func previousOwnerLevel(level string) (DocumentLevel, string, error) {
	switch level {
	case "", string(DocumentLevelEdit):
		return DocumentLevelEdit, string(DocumentLevelEdit), nil
	case string(DocumentLevelComment), string(DocumentLevelView):
		return DocumentLevel(level), level, nil
	case "none":
		return DocumentLevelNone, "none", nil
	default:
		return DocumentLevelNone, "", Invalid("previous_owner_level phải là edit, comment, view hoặc none")
	}
}

// TransferOwner hands the document's ACL owner slot to in.UserID (§2.1).
//
// Refusals, in order: a bad body is 400 whatever the document is; the gate
// answers 404/403 (cannot see / cannot administer); a Work Product document
// is 409 (its resolver decides) and so is My Folder; an AdminScope caller
// below manage taking a restricted document for themselves is
// break_glass_required (DOC-05: read access comes only through break-glass);
// a recipient who cannot own it is 422. Handing the document to its current
// owner writes nothing at all. An archived document is transferable, so a
// successor can restore it.
func (s *DocumentService) TransferOwner(ctx context.Context, actor Actor, documentID string, in DocumentOwnerTransferInput) (DocumentOwnerTransfer, error) {
	keep, keepName, err := previousOwnerLevel(in.PreviousOwnerLevel)
	if err != nil {
		return DocumentOwnerTransfer{}, err
	}
	if in.UserID == "" {
		return DocumentOwnerTransfer{}, Invalid("user_id bắt buộc")
	}
	var out DocumentOwnerTransfer
	err = s.withDocumentAdministerMutation(ctx, actor, documentID, shelveWriteRefused, func(q *db.Queries, doc db.Document, access DocumentAccess) error {
		if doc.OwnerKind.Valid {
			return errDocumentOwned()
		}
		if isMyFolder(doc) {
			return errMyFolderLocked()
		}
		from := ""
		if doc.AclOwnerID.Valid {
			from = doc.AclOwnerID.String
		}
		if from == in.UserID {
			out = DocumentOwnerTransfer{DocumentID: doc.ID, ACLOwnerID: in.UserID}
			return nil
		}
		if access.AdminScope && !access.Level.AtLeast(DocumentLevelManage) &&
			actor.Kind == audit.KindHuman && in.UserID == actor.ID && doc.Visibility == documentVisibilityRestricted {
			return errBreakGlassRequired()
		}
		if err := s.requireOwnerTarget(ctx, q, doc, in.UserID); err != nil {
			return err
		}
		updated, err := q.TransferDocumentACLOwner(ctx, db.TransferDocumentACLOwnerParams{
			NewOwner: nullText(in.UserID), UpdatedBy: actor.ID, UpdatedByKind: string(actor.Kind),
			ID: doc.ID, OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			// The row is locked and was checked unowned above; a miss here
			// means it changed under the lock, which the lock rules out.
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		shareID, err := s.keepPreviousOwnerAccess(ctx, q, actor, updated, access, from, keep)
		if err != nil {
			return err
		}
		if err := auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, Actor: actor,
			Action: audit.ActionDocumentOwnerTransferred, ResourceType: "document", ResourceID: doc.ID,
			Changes:  audit.Diff(map[string]any{"acl_owner_id": from}, map[string]any{"acl_owner_id": in.UserID}),
			Metadata: map[string]any{"from_user_id": from, "previous_owner_level": keepName},
		}, audit.Event{Topic: topicDocumentOwnerTransferred, Payload: map[string]string{
			"document_id": doc.ID, "workspace_id": doc.WorkspaceID,
		}}); err != nil {
			return err
		}
		out = DocumentOwnerTransfer{
			DocumentID: doc.ID, ACLOwnerID: in.UserID, PreviousOwnerID: from, PreviousOwnerShareID: shareID,
		}
		return nil
	})
	if err != nil {
		return DocumentOwnerTransfer{}, err
	}
	return out, nil
}

// requireOwnerTarget proves the recipient can hold the slot: an active member
// of the document's organization and an effective member of its workspace,
// through the two membership gates read on the command's own transaction.
// An agent is a member of neither table, so it fails here too (aclOwnerFor:
// only a person holds the slot). Every refusal is the same 422, so the answer
// never tells an unknown id from a member of another workspace.
func (s *DocumentService) requireOwnerTarget(ctx context.Context, q *db.Queries, doc db.Document, userID string) error {
	if _, err := s.orgs.RequireMemberQ(ctx, q, doc.OrganizationID, userID); err != nil {
		if isGateRefusal(err) {
			return errOwnerTargetNotMember()
		}
		return err
	}
	if _, err := s.ws.RequireMemberQ(ctx, q, doc.WorkspaceID, userID); err != nil {
		if isGateRefusal(err) {
			return errOwnerTargetNotMember()
		}
		return err
	}
	return nil
}

// keepPreviousOwnerAccess writes the previous owner's share after the slot
// moved, and returns the share they keep. It only raises: a live manual user
// share at or above the asked level is left as it is and named in the answer,
// and so is a chat-origin one above it; an equal chat-origin one is taken over
// as manual. It
// writes nothing for none, for a document that had no ACL owner, for a
// folder (folders are never shared) and for a previous owner who is no
// longer an active member of the organization - granting access to a closed
// account would be a grant nobody can use (§2.1 "Chủ cũ").
//
// The grant goes through shareDocumentInTx on the updated row, so it is the
// share path's own write: its checks, its document.shared audit row and
// event.
func (s *DocumentService) keepPreviousOwnerAccess(ctx context.Context, q *db.Queries, actor Actor, doc db.Document, access DocumentAccess, from string, keep DocumentLevel) (string, error) {
	if from == "" || keep == DocumentLevelNone || doc.Kind == DocumentKindFolder {
		return "", nil
	}
	if _, err := s.orgs.RequireMemberQ(ctx, q, doc.OrganizationID, from); err != nil {
		if isGateRefusal(err) {
			return "", nil
		}
		return "", err
	}
	prev, err := q.GetDocumentShare(ctx, db.GetDocumentShareParams{
		OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
		PrincipalType: DocumentPrincipalUser, PrincipalID: from,
	})
	switch {
	case err == nil:
		have := DocumentLevel(prev.Level).rank()
		switch {
		case !prev.SourceKind.Valid && have >= keep.rank():
			return prev.ID, nil
		case prev.SourceKind.Valid && have > keep.rank():
			// A chat-origin share above the asked level stays as it is: a
			// manual grant at the asked level would take it over and lower
			// it. It can still go when the person leaves the room; the
			// transfer never lowers what they hold.
			return prev.ID, nil
		}
		// A manual share below the asked level is raised, and a chat-origin
		// one at or below it falls through to the share path, whose
		// keepsLiveShare takes an equal one over as manual so leaving the
		// room does not revoke what the transfer promised.
	case errors.Is(err, pgx.ErrNoRows):
	default:
		return "", err
	}
	sh, err := s.shareDocumentInTx(ctx, q, actor, doc, access, DocumentShareInput{
		PrincipalType: DocumentPrincipalUser, PrincipalID: from, Level: keep,
	})
	if err != nil {
		return "", err
	}
	return sh.ID, nil
}
