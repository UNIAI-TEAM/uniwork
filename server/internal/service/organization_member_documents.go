package service

import (
	"context"

	"github.com/oklog/ulid/v2"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Bulk owner transfer of one member's documents (DOC-06b, UNI-2092; access
// addendum §2.2, §2.3, §4.2). An organization-level command on metadata: the
// gate is the organization admin gate of Deactivate (requireAdmin and P6),
// never a workspace gate per document, and no document is read for its
// content. Each call moves at most one batch in one transaction; the client
// loops on has_more, echoing bulk_id and cursor.

const topicDocumentOwnersBulkTransferred = "document.owners_bulk_transferred"

// memberDocumentsTransferBatch bounds one call: one transaction holds at most
// this many row locks and writes at most this many audit and outbox rows. A
// variable so a test can lower it.
var memberDocumentsTransferBatch int32 = 500

// OrganizationMemberDocumentService answers the two document-ownership routes
// of an organization member. It lives beside OrganizationMemberService for
// the admin gate and reaches the documents through DocumentService's own
// resolver, so the self_restricted skip decides by the same level every
// document command does.
type OrganizationMemberDocumentService struct {
	members *OrganizationMemberService
	docs    *DocumentService
}

func NewOrganizationMemberDocumentService(members *OrganizationMemberService, docs *DocumentService) *OrganizationMemberDocumentService {
	return &OrganizationMemberDocumentService{members: members, docs: docs}
}

// MemberDocumentWorkspaceCount is one workspace's share of a member's
// documents.
type MemberDocumentWorkspaceCount struct {
	WorkspaceID   string
	WorkspaceName string
	Count         int64
}

// MemberDocumentOwnership is how many documents a member owns, by workspace.
// Workspaces is never nil.
type MemberDocumentOwnership struct {
	UserID     string
	Total      int64
	Workspaces []MemberDocumentWorkspaceCount
}

// MemberDocumentsTransferInput is the body of the POST: the recipient, and on
// a later call of one run the run's bulk id and the previous answer's cursor.
type MemberDocumentsTransferInput struct {
	ToUserID string
	BulkID   string
	Cursor   string
}

// MemberDocumentsTransfer is one call's answer. Cursor is the last id of the
// batch when HasMore, "" otherwise.
type MemberDocumentsTransfer struct {
	BulkID                    string
	Transferred               int
	SkippedRecipientNotMember int
	SkippedSelfRestricted     int
	HasMore                   bool
	Cursor                    string
}

// requireMemberDocumentsAdmin is the gate of both routes: the caller is an
// active owner or admin of the organization, the source has a membership row
// there (active or deactivated, 404 otherwise), and an admin acts neither on
// another admin nor on the owner (OPEN_QUESTIONS P6, as in Deactivate). The
// caller may be the source.
func (s *OrganizationMemberDocumentService) requireMemberDocumentsAdmin(ctx context.Context, actorID, orgID, userID string) error {
	actor, err := s.members.requireAdmin(ctx, orgID, actorID)
	if err != nil {
		return err
	}
	target, err := s.members.member(ctx, orgID, userID)
	if err != nil {
		return err
	}
	if actorID != userID && (target.Role == OrgRoleAdmin || target.Role == OrgRoleOwner) && actor.Role != OrgRoleOwner {
		return ErrForbidden
	}
	return nil
}

// MemberDocumentOwnership counts the documents the member holds the ACL owner
// slot of, by workspace: archived ones not yet purged included, Work Product
// documents and My Folder roots left out, the same set the transfer walks.
func (s *OrganizationMemberDocumentService) MemberDocumentOwnership(ctx context.Context, actorID, orgID, userID string) (MemberDocumentOwnership, error) {
	if err := s.requireMemberDocumentsAdmin(ctx, actorID, orgID, userID); err != nil {
		return MemberDocumentOwnership{}, err
	}
	rows, err := s.members.q.CountMemberOwnedDocumentsByWorkspace(ctx, db.CountMemberOwnedDocumentsByWorkspaceParams{
		OrganizationID: orgID, Owner: nullText(userID),
	})
	if err != nil {
		return MemberDocumentOwnership{}, err
	}
	out := MemberDocumentOwnership{UserID: userID, Workspaces: make([]MemberDocumentWorkspaceCount, 0, len(rows))}
	for _, r := range rows {
		out.Total += r.DocumentCount
		out.Workspaces = append(out.Workspaces, MemberDocumentWorkspaceCount{
			WorkspaceID: r.WorkspaceID, WorkspaceName: r.WorkspaceName, Count: r.DocumentCount,
		})
	}
	return out, nil
}

// transferListedDocument is the document the level resolver takes, built from
// the metadata columns the batch query selects. Every other field stays zero:
// the resolver reads only these.
func transferListedDocument(r db.ListMemberOwnedDocumentsForTransferRow) db.Document {
	return db.Document{
		ID: r.ID, OrganizationID: r.OrganizationID, WorkspaceID: r.WorkspaceID,
		Visibility: r.Visibility, WorkspaceLevel: r.WorkspaceLevel,
		AclOwnerID: r.AclOwnerID, OwnerKind: r.OwnerKind, OwnerID: r.OwnerID,
	}
}

// validOptionalULID accepts "" or a ULID.
func validOptionalULID(v string) bool {
	if v == "" {
		return true
	}
	_, err := ulid.ParseStrict(v)
	return err == nil
}

// TransferMemberDocuments moves one batch of the member's documents to
// in.ToUserID (§2.2).
//
// Refusals, in order: a bad body is 400 whatever the organization is; the
// gate answers 403/404; a recipient who is the source, not a person, or not
// an active member of the organization is 422 owner_target_not_member.
//
// Per listed document: a recipient who is not an effective member of its
// workspace skips it (recipient_not_member); a recipient who is the caller
// skips a restricted document the caller does not manage (self_restricted,
// DOC-05: an admin never grants themselves read access to restricted
// content). Every other one moves with previous_owner_level none and no
// share for the source, one audit row and one outbox row each, all tagged
// with the run's bulk_id. A call that moved anything also writes one
// document.owners_bulk_transferred audit row and event; a call that moved
// nothing writes nothing at all (Q2 A), like the single route's same-owner
// no-op.
func (s *OrganizationMemberDocumentService) TransferMemberDocuments(ctx context.Context, actor Actor, orgID, userID string, in MemberDocumentsTransferInput) (MemberDocumentsTransfer, error) {
	if in.ToUserID == "" {
		return MemberDocumentsTransfer{}, Invalid("to_user_id bắt buộc")
	}
	if !validOptionalULID(in.BulkID) {
		return MemberDocumentsTransfer{}, Invalid("bulk_id phải là ULID")
	}
	if !validOptionalULID(in.Cursor) {
		return MemberDocumentsTransfer{}, Invalid("cursor không hợp lệ")
	}
	if actor.Kind != audit.KindHuman {
		return MemberDocumentsTransfer{}, ErrForbidden
	}
	if err := s.requireMemberDocumentsAdmin(ctx, actor.ID, orgID, userID); err != nil {
		return MemberDocumentsTransfer{}, err
	}
	out := MemberDocumentsTransfer{BulkID: in.BulkID}
	if out.BulkID == "" {
		out.BulkID = util.NewID()
	}

	tx, err := s.members.pool.Begin(ctx)
	if err != nil {
		return MemberDocumentsTransfer{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	q := s.members.q.WithTx(tx)
	if in.ToUserID == userID {
		return MemberDocumentsTransfer{}, errOwnerTargetNotMember()
	}
	if _, err := s.docs.orgs.RequireMemberQ(ctx, q, orgID, in.ToUserID); err != nil {
		if isGateRefusal(err) {
			return MemberDocumentsTransfer{}, errOwnerTargetNotMember()
		}
		return MemberDocumentsTransfer{}, err
	}

	batch, err := q.ListMemberOwnedDocumentsForTransfer(ctx, db.ListMemberOwnedDocumentsForTransferParams{
		OrganizationID: orgID, Owner: nullText(userID), After: in.Cursor, Page: memberDocumentsTransferBatch,
	})
	if err != nil {
		return MemberDocumentsTransfer{}, err
	}
	// The recipient's workspace membership, decided once per workspace on
	// this transaction.
	member := map[string]bool{}
	movable := make([]db.Document, 0, len(batch))
	for _, row := range batch {
		doc := transferListedDocument(row)
		ok, seen := member[doc.WorkspaceID]
		if !seen {
			if _, err := s.docs.ws.RequireMemberQ(ctx, q, doc.WorkspaceID, in.ToUserID); err != nil {
				if !isGateRefusal(err) {
					return MemberDocumentsTransfer{}, err
				}
			} else {
				ok = true
			}
			member[doc.WorkspaceID] = ok
		}
		if !ok {
			out.SkippedRecipientNotMember++
			continue
		}
		if in.ToUserID == actor.ID && doc.Visibility == documentVisibilityRestricted {
			access, err := s.docs.resolveLevel(ctx, q, actor, doc)
			if err != nil {
				return MemberDocumentsTransfer{}, err
			}
			if !access.Level.AtLeast(DocumentLevelManage) {
				out.SkippedSelfRestricted++
				continue
			}
		}
		movable = append(movable, doc)
	}

	// One UPDATE moves the whole batch, guarded by the owner it was listed
	// under; a row that changed hands under its lock is not returned and not
	// counted. The audit and outbox rows are written a chunk at a time, one of
	// each per moved document (R2-3), in the listed order.
	// The workspace of the first moved document in listed (id) order, named in
	// the bulk event so the grouped notice can be stored under a workspace.
	var firstMovedWorkspace string
	if len(movable) > 0 {
		ids := make([]string, len(movable))
		for i, doc := range movable {
			ids[i] = doc.ID
		}
		moved, err := q.TransferDocumentsACLOwnerFrom(ctx, db.TransferDocumentsACLOwnerFromParams{
			NewOwner: nullText(in.ToUserID), UpdatedBy: actor.ID, UpdatedByKind: string(actor.Kind),
			Ids: ids, OrganizationID: orgID, FromOwner: nullText(userID),
		})
		if err != nil {
			return MemberDocumentsTransfer{}, err
		}
		movedIDs := make(map[string]struct{}, len(moved))
		for _, m := range moved {
			movedIDs[m.ID] = struct{}{}
		}
		recs := make([]audit.Recorded, 0, len(moved))
		for _, doc := range movable {
			if _, ok := movedIDs[doc.ID]; !ok {
				continue
			}
			if firstMovedWorkspace == "" {
				firstMovedWorkspace = doc.WorkspaceID
			}
			recs = append(recs, audit.Recorded{
				Entry: audit.Entry{
					OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, Actor: actor,
					Action: audit.ActionDocumentOwnerTransferred, ResourceType: "document", ResourceID: doc.ID,
					Changes:  audit.Diff(map[string]any{"acl_owner_id": userID}, map[string]any{"acl_owner_id": in.ToUserID}),
					Metadata: map[string]any{"from_user_id": userID, "previous_owner_level": "none", "bulk_id": out.BulkID},
				},
				Events: []audit.Event{{Topic: topicDocumentOwnerTransferred, Payload: map[string]string{
					"document_id": doc.ID, "workspace_id": doc.WorkspaceID, "bulk_id": out.BulkID,
				}}},
			})
		}
		for start := 0; start < len(recs); start += documentShareWriteChunk {
			if err := auditRecorder.RecordMany(ctx, q, recs[start:min(start+documentShareWriteChunk, len(recs))]); err != nil {
				return MemberDocumentsTransfer{}, err
			}
		}
		out.Transferred = len(recs)
	}

	if len(batch) > 0 {
		last := batch[len(batch)-1].ID
		// has_more is an EXISTS past the batch, never "the page was full":
		// LIMIT ... FOR UPDATE returns short when a row changed hands while
		// the batch waited for it (R1-10).
		more, err := q.MemberOwnsDocumentsAfter(ctx, db.MemberOwnsDocumentsAfterParams{
			OrganizationID: orgID, Owner: nullText(userID), After: last,
		})
		if err != nil {
			return MemberDocumentsTransfer{}, err
		}
		if more {
			out.HasMore, out.Cursor = true, last
		}
	}

	if out.Transferred > 0 {
		if err := auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: orgID, Actor: actor,
			Action: audit.ActionDocumentOwnersBulkTransferred, ResourceType: "organization_member", ResourceID: userID,
			Metadata: map[string]any{
				"bulk_id": out.BulkID, "to_user_id": in.ToUserID, "transferred": out.Transferred,
				"skipped": map[string]any{
					"recipient_not_member": out.SkippedRecipientNotMember,
					"self_restricted":      out.SkippedSelfRestricted,
				},
			},
		}, audit.Event{Topic: topicDocumentOwnersBulkTransferred, Payload: map[string]string{
			"organization_id": orgID, "user_id": in.ToUserID, "bulk_id": out.BulkID, "from_user_id": userID,
			"workspace_id": firstMovedWorkspace,
		}}); err != nil {
			return MemberDocumentsTransfer{}, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return MemberDocumentsTransfer{}, err
	}
	return out, nil
}
