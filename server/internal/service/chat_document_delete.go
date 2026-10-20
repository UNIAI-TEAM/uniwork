package service

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Deleting a document message (UNI-2012 S1d, D8 as the USER decided it on
// 2026-10-20). Who may delete is chat's own rule and does not change; what the
// delete does to the document depends on the message's origin:
//   - upload (the document was created from chat): the document goes to the
//     trash through the archive command's write half (30-day restore,
//     document.archived), even if others have committed versions since, and
//     every chat-origin share of the document is revoked;
//   - link (an existing Documents file was attached): the document is not
//     touched; only the chat shares whose source is this message are decided
//     again by the member-left reconcile rule, so a grant another live
//     message of the person's current membership backs is re-pointed, and
//     the rest are revoked; a grant the remaining messages back at a lower
//     level is lowered to it (S1-fix-2 SF3). Manual shares are never
//     touched, a manual level a chat grant had raised is restored, and a
//     deactivated member's grant is left for their reactivation (SF5).
// It all runs in the transaction that soft-deletes the message, so the
// message, the trash, the revokes, their audit rows and their outbox rows
// commit together. A second delete never reaches here: the soft delete
// matches live messages only.

// chatDocumentDeleteOutcome is what the delete did to the document, for the
// chat audit row and the post-commit counters.
type chatDocumentDeleteOutcome struct {
	DocumentID string
	Origin     string
	Archived   bool
	Revoked    int
	Lowered    int
	lockOps    *editLockOps
}

// chatDocumentDeleteAfterLock is a test seam: when set, it runs once the
// delete holds the document lock, before it reads the chat shares, so a test
// can race a reconcile or a link send against it. nil in production.
var chatDocumentDeleteAfterLock func()

// metadata is the chat.message_deleted audit row's document part.
func (o chatDocumentDeleteOutcome) metadata(into map[string]any) {
	if o.DocumentID == "" {
		return
	}
	into["document_id"] = o.DocumentID
	into["document_origin"] = o.Origin
	into["document_archived"] = o.Archived
	into["document_shares_revoked"] = o.Revoked
	into["document_shares_lowered"] = o.Lowered
}

// applyDocumentMessageDelete runs D8 for a message the caller has just
// soft-deleted in q's transaction. Anything but a kind="document" message
// (a document_version line included) is left alone. The actor is the person
// deleting, who is the message's sender: chat lets nobody else delete a
// document message.
func (s *ChatService) applyDocumentMessageDelete(ctx context.Context, q *db.Queries, actor Actor, room db.ChatRoom, msg db.ChatMessage) (chatDocumentDeleteOutcome, error) {
	if s.docs == nil || msg.Kind != chatMessageKindDocument {
		return chatDocumentDeleteOutcome{}, nil
	}
	info := documentMessageFromMetadata(msg.Kind, msg.Metadata)
	if info == nil {
		return chatDocumentDeleteOutcome{}, nil
	}
	out := chatDocumentDeleteOutcome{DocumentID: info.DocumentID, Origin: info.Origin}
	doc, err := q.GetDocumentByID(ctx, info.DocumentID)
	if errors.Is(err, pgx.ErrNoRows) {
		// Purged already: nothing is left to trash or revoke.
		return out, nil
	}
	if err != nil {
		return out, err
	}
	if doc.OrganizationID != room.OrganizationID {
		// Never act on another tenant's row, whatever the metadata says.
		return out, nil
	}
	upload := info.Origin == chatDocumentOriginUpload
	// The archive command's lock order: the workspace tree, then the row.
	// The message row is already locked by the soft delete, the same order
	// share-as-document takes (message, then document).
	if upload {
		if err := q.LockDocumentTree(ctx, doc.WorkspaceID); err != nil {
			return out, err
		}
	}
	doc, err = q.LockDocumentByID(ctx, doc.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return out, nil
	}
	if err != nil {
		return out, err
	}
	if upload {
		archived, ops, err := s.docs.archiveChatUploadInTx(ctx, q, actor, doc)
		if err != nil {
			return out, err
		}
		out.Archived, out.lockOps = archived, ops
	}
	if chatDocumentDeleteAfterLock != nil {
		chatDocumentDeleteAfterLock()
	}
	// The link path leaves a deactivated member's grant alone, as the
	// member-left reconcile does (SF5); the trash of an upload takes them all.
	params := db.ListLiveChatDocumentSharesOfDocumentParams{
		OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID, DocumentID: doc.ID,
		SkipDeactivated: !upload,
	}
	if !upload {
		params.SourceMessageID = nullText(msg.ID)
	}
	shares, err := q.ListLiveChatDocumentSharesOfDocument(ctx, params)
	if err != nil {
		return out, err
	}
	var decisions []chatShareDecision
	if upload {
		// USER rule: every chat grant of a trashed upload goes, whatever
		// other message still shows the card.
		decisions = make([]chatShareDecision, len(shares))
		for i, sh := range shares {
			decisions[i] = chatShareDecision{share: sh, action: chatShareRevoke}
		}
	} else {
		// The message is already deleted in this transaction, so the
		// backing search no longer sees it.
		if decisions, err = decideChatShares(ctx, q, doc, shares); err != nil {
			return out, err
		}
	}
	// Set-based (SF1): a 1,000-recipient card is a handful of statements
	// while the tree lock is held, not three round trips per recipient.
	out.Revoked, out.Lowered, err = applyChatShareDecisions(ctx, q, actor, doc, decisions)
	return out, err
}

// archiveChatUploadInTx trashes a chat-uploaded document inside the caller's
// transaction, which holds the tree and row locks. It reports false, writing
// nothing, when the document is already in the trash or the gate refuses: the
// message delete itself is never refused because of the document (chat's
// authorization does not change), and the chat audit row records whether the
// document went.
//
// The gate is the archive root gate with one more pass: the document's human
// creator - the sender, since the document was created by this message - may
// trash it without manage, the way the creator of a pristine copy may (the
// archive command's own exception), because the USER rule is that deleting
// the upload removes the file whoever has edited it since. A document owned
// by a work product or a My Folder still refuses. Manage on a subtree under
// the root is still required.
func (s *DocumentService) archiveChatUploadInTx(ctx context.Context, q *db.Queries, actor Actor, doc db.Document) (bool, *editLockOps, error) {
	if doc.ArchivedAt.Valid {
		return false, nil, nil
	}
	access, err := s.effectiveLevel(ctx, q, actor, doc)
	if err != nil {
		return false, nil, err
	}
	rootOnly, err := chatUploadArchiveGate(actor, doc, access)
	if err != nil {
		if isDocumentRefusal(err) {
			return false, nil, nil
		}
		return false, nil, err
	}
	_, _, ops, err := s.archiveLockedSubtree(ctx, q, actor, doc, rootOnly)
	if err != nil {
		if isDocumentRefusal(err) {
			// Refused before any write: the subtree check and the bound
			// run before the stamp.
			return false, nil, nil
		}
		return false, nil, err
	}
	return true, ops, nil
}

// chatUploadArchiveGate is archiveChatUploadInTx's root gate; rootOnly says the
// creator pass decided the root alone.
func chatUploadArchiveGate(actor Actor, doc db.Document, access DocumentAccess) (rootOnly bool, err error) {
	if doc.OwnerKind.Valid {
		return false, errDocumentOwned()
	}
	if isMyFolder(doc) {
		return false, errMyFolderLocked()
	}
	if actor.Kind == audit.KindHuman && doc.CreatedBy == actor.ID && doc.CreatedByKind == string(audit.KindHuman) {
		return true, nil
	}
	return archiveRootGate(actor, doc, access)
}

// isDocumentRefusal tells a gate's answer (forbidden, not found, a coded
// refusal such as folder_too_large) from a failure that must abort the
// transaction.
func isDocumentRefusal(err error) bool {
	var ce CodedError
	return errors.Is(err, ErrForbidden) || errors.Is(err, ErrNotFound) || errors.As(err, &ce)
}
