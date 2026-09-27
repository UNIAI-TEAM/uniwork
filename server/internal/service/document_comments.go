package service

// Document comments (G1-07, UNI-681): the document half of the shared
// comment core (comments.go). Every read goes through authorizeDocument and
// every write through withDocumentMutation - the document row lock plus a
// fresh effectiveLevel - so a share revoked before the mutation started is
// already visible to the command; a revoke that commits later waits. The
// permission ladder has no comment level: view reads the thread, edit
// comments/reacts/resolves, and edit-or-delete is author-or-manage while the
// actor still holds the resource. Anonymous (public link) and agent writes
// are refused by the gate itself. Reactions live in the shared
// comment_reactions table and are only reached through a comment proven to
// hang on this document.

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const idempotencyScopeDocumentCommentCreate = "documents.comment_create"

// documentCommentAdapter is the document_comments persistence adapter + the
// resource authorizer. access is the fresh decision withDocumentMutation
// computed under the document row lock - canModerate never re-reads state.
type documentCommentAdapter struct {
	svc    *DocumentService
	access DocumentAccess
}

func (documentCommentAdapter) byID(ctx context.Context, q *db.Queries, id string) (db.DocumentComment, error) {
	return q.GetDocumentCommentByID(ctx, id)
}

func (documentCommentAdapter) tenantGet(ctx context.Context, q *db.Queries, ref CommentRef, id string) (db.DocumentComment, error) {
	return q.GetDocumentComment(ctx, db.GetDocumentCommentParams{
		ID: id, OrganizationID: ref.OrganizationID, WorkspaceID: ref.WorkspaceID,
	})
}

func (documentCommentAdapter) identity(c db.DocumentComment) commentIdentity {
	return commentIdentity{ID: c.ID, ResourceID: c.DocumentID, AuthorID: c.AuthorID, AuthorKind: c.AuthorKind}
}

func (documentCommentAdapter) insert(ctx context.Context, q *db.Queries, ref CommentRef, _ AddCommentInput, p preparedComment) (db.DocumentComment, error) {
	return q.CreateDocumentComment(ctx, db.CreateDocumentCommentParams{
		ID: p.ID, OrganizationID: ref.OrganizationID, WorkspaceID: ref.WorkspaceID,
		DocumentID: ref.ResourceID, AuthorID: p.AuthorID, AuthorKind: p.AuthorKind,
		Body: p.Body, ParentCommentID: p.ParentID, CommentType: p.CommentType,
	})
}

func (documentCommentAdapter) updateBody(ctx context.Context, q *db.Queries, ref CommentRef, c db.DocumentComment, body string) (db.DocumentComment, error) {
	return q.UpdateDocumentCommentBody(ctx, db.UpdateDocumentCommentBodyParams{
		ID: c.ID, OrganizationID: ref.OrganizationID, WorkspaceID: ref.WorkspaceID, Body: body,
	})
}

func (documentCommentAdapter) remove(ctx context.Context, q *db.Queries, ref CommentRef, c db.DocumentComment) error {
	return q.DeleteDocumentComment(ctx, db.DeleteDocumentCommentParams{
		ID: c.ID, OrganizationID: ref.OrganizationID, WorkspaceID: ref.WorkspaceID,
	})
}

func (documentCommentAdapter) resolve(ctx context.Context, q *db.Queries, ref CommentRef, c db.DocumentComment, resolvedByType, resolvedByID string) (db.DocumentComment, error) {
	return q.ResolveDocumentComment(ctx, db.ResolveDocumentCommentParams{
		ID: c.ID, OrganizationID: ref.OrganizationID, WorkspaceID: ref.WorkspaceID,
		ResolvedByType: pgtype.Text{String: resolvedByType, Valid: true},
		ResolvedByID:   pgtype.Text{String: resolvedByID, Valid: true},
	})
}

func (documentCommentAdapter) unresolve(ctx context.Context, q *db.Queries, ref CommentRef, c db.DocumentComment) (db.DocumentComment, error) {
	return q.UnresolveDocumentComment(ctx, db.UnresolveDocumentCommentParams{
		ID: c.ID, OrganizationID: ref.OrganizationID, WorkspaceID: ref.WorkspaceID,
	})
}

// commentTypes is the document allowlist: public clients write plain
// comments only - a system row can never be minted through this path.
func (documentCommentAdapter) commentTypes() []string { return []string{"comment"} }

func (documentCommentAdapter) foreignParentError() error {
	return Invalid("parent_id không thuộc tài liệu này")
}

// canModerate is author-or-manage on the freshly computed access: the author
// match is verbatim, the manager half is the manage level.
func (a documentCommentAdapter) canModerate(_ context.Context, actor Actor, _ CommentRef, c db.DocumentComment) (bool, error) {
	id := a.identity(c)
	if id.AuthorID == actor.ID && id.AuthorKind == string(actor.Kind) {
		return true, nil
	}
	return a.access.Level.AtLeast(DocumentLevelManage), nil
}

// beforeDelete is a no-op for document comments - no attachment rows bind a
// comment_id there.
func (documentCommentAdapter) beforeDelete(_ context.Context, _ *db.Queries, _ CommentRef, _ db.DocumentComment) error {
	return nil
}

func (documentCommentAdapter) verbs() commentVerbs {
	return commentVerbs{
		resourceType:    "document",
		added:           audit.ActionDocumentCommentAdded,
		updated:         audit.ActionDocumentCommentUpdated,
		deleted:         audit.ActionDocumentCommentDeleted,
		resolved:        audit.ActionDocumentCommentResolved,
		unresolved:      audit.ActionDocumentCommentUnresolved,
		reactionAdded:   audit.ActionDocumentCommentReactionAdded,
		reactionRemoved: audit.ActionDocumentCommentReactionRemoved,
	}
}

func docCommentRef(doc db.Document) CommentRef {
	return CommentRef{Kind: CommentResourceDocument, ResourceID: doc.ID,
		OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID}
}

// documentCommentByID loads one comment by bare id for the id-addressed
// commands; the document it hangs on is then authorized through the gate.
func (s *DocumentService) documentCommentByID(ctx context.Context, commentID string) (db.DocumentComment, error) {
	c, err := documentCommentAdapter{}.byID(ctx, s.q, commentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.DocumentComment{}, ErrNotFound
	}
	return c, err
}

// DocumentComments lists the thread for a reader (view).
func (s *DocumentService) DocumentComments(ctx context.Context, actor Actor, documentID string) ([]db.ListDocumentCommentsRow, error) {
	doc, _, err := s.authorizeDocument(ctx, actor, documentID, DocumentLevelView)
	if err != nil {
		return nil, err
	}
	return s.q.ListDocumentComments(ctx, db.ListDocumentCommentsParams{
		DocumentID: doc.ID, OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
	})
}

// DocumentCommentReactions lists every reaction on the document's comments
// for a reader (view).
func (s *DocumentService) DocumentCommentReactions(ctx context.Context, actor Actor, documentID string) ([]db.CommentReaction, error) {
	doc, _, err := s.authorizeDocument(ctx, actor, documentID, DocumentLevelView)
	if err != nil {
		return nil, err
	}
	return s.q.ListDocumentCommentReactions(ctx, db.ListDocumentCommentReactionsParams{
		DocumentID: doc.ID, OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
	})
}

// GetDocumentComment returns one comment for a reader of its document.
func (s *DocumentService) GetDocumentComment(ctx context.Context, actor Actor, commentID string) (db.DocumentComment, error) {
	c, err := s.documentCommentByID(ctx, commentID)
	if err != nil {
		return db.DocumentComment{}, err
	}
	if _, _, err := s.authorizeDocument(ctx, actor, c.DocumentID, DocumentLevelView); err != nil {
		return db.DocumentComment{}, err
	}
	return c, nil
}

// AddDocumentComment creates a threaded comment: edit level inside the
// document lock, idempotent under Idempotency-Key in the
// documents.comment_create scope.
func (s *DocumentService) AddDocumentComment(ctx context.Context, actor Actor, documentID string, in AddCommentInput, idempotencyKey string) (db.DocumentComment, error) {
	var out db.DocumentComment
	err := s.withDocumentMutation(ctx, actor, documentID, DocumentLevelEdit, func(q *db.Queries, doc db.Document, access DocumentAccess) error {
		ref := docCommentRef(doc)
		// The fingerprint binds the document, so a key reused on another
		// document answers idempotency_payload_mismatch instead of replaying
		// the first document's comment.
		parent := ""
		if in.ParentID != nil {
			parent = *in.ParentID
		}
		replay, commit, err := BeginIdempotent(ctx, q, ref.OrganizationID, ref.WorkspaceID,
			idempotencyScopeDocumentCommentCreate, idempotencyKey, actor.ID, IdempotencyOptions{
				Fingerprint:        IdempotencyFingerprint("document_comment_create", doc.ID, parent, in.CommentType, in.Body),
				RequireFingerprint: true,
			})
		if err != nil {
			return NormalizeIdempotencyError(err)
		}
		if replay != nil {
			return json.Unmarshal(replay.Body, &out)
		}
		c, err := addCommentOn(ctx, q, documentCommentAdapter{svc: s, access: access}, ref, actor, in)
		if err != nil {
			return err
		}
		body, err := json.Marshal(c)
		if err != nil {
			return err
		}
		if err := commit(http.StatusOK, body); err != nil {
			return err
		}
		out = c
		return nil
	})
	return out, err
}

// UpdateDocumentComment edits a body; author or manage, and only while the
// actor still holds edit on the document.
func (s *DocumentService) UpdateDocumentComment(ctx context.Context, actor Actor, commentID string, in UpdateCommentInput) (db.DocumentComment, error) {
	before, err := s.documentCommentByID(ctx, commentID)
	if err != nil {
		return db.DocumentComment{}, err
	}
	var out db.DocumentComment
	err = s.withDocumentMutation(ctx, actor, before.DocumentID, DocumentLevelEdit, func(q *db.Queries, doc db.Document, access DocumentAccess) error {
		out, err = updateCommentOn(ctx, q, documentCommentAdapter{svc: s, access: access}, docCommentRef(doc), actor, commentID, in)
		return err
	})
	return out, err
}

// DeleteDocumentComment removes a comment; author or manage.
func (s *DocumentService) DeleteDocumentComment(ctx context.Context, actor Actor, commentID string) error {
	before, err := s.documentCommentByID(ctx, commentID)
	if err != nil {
		return err
	}
	return s.withDocumentMutation(ctx, actor, before.DocumentID, DocumentLevelEdit, func(q *db.Queries, doc db.Document, access DocumentAccess) error {
		return deleteCommentOn(ctx, q, documentCommentAdapter{svc: s, access: access}, docCommentRef(doc), actor, commentID)
	})
}

// ResolveDocumentComment marks a comment resolved (edit level; idempotent).
func (s *DocumentService) ResolveDocumentComment(ctx context.Context, actor Actor, commentID string) (db.DocumentComment, error) {
	return s.setDocumentCommentResolved(ctx, actor, commentID, true)
}

// UnresolveDocumentComment clears resolution (edit level; idempotent).
func (s *DocumentService) UnresolveDocumentComment(ctx context.Context, actor Actor, commentID string) (db.DocumentComment, error) {
	return s.setDocumentCommentResolved(ctx, actor, commentID, false)
}

func (s *DocumentService) setDocumentCommentResolved(ctx context.Context, actor Actor, commentID string, on bool) (db.DocumentComment, error) {
	before, err := s.documentCommentByID(ctx, commentID)
	if err != nil {
		return db.DocumentComment{}, err
	}
	var out db.DocumentComment
	err = s.withDocumentMutation(ctx, actor, before.DocumentID, DocumentLevelEdit, func(q *db.Queries, doc db.Document, access DocumentAccess) error {
		out, err = setCommentResolvedOn(ctx, q, documentCommentAdapter{svc: s, access: access}, docCommentRef(doc), actor, commentID, on)
		return err
	})
	return out, err
}

// AddDocumentCommentReaction upserts an emoji on a comment (edit level).
func (s *DocumentService) AddDocumentCommentReaction(ctx context.Context, actor Actor, commentID, emoji string) (db.CommentReaction, error) {
	before, err := s.documentCommentByID(ctx, commentID)
	if err != nil {
		return db.CommentReaction{}, err
	}
	var out db.CommentReaction
	err = s.withDocumentMutation(ctx, actor, before.DocumentID, DocumentLevelEdit, func(q *db.Queries, doc db.Document, access DocumentAccess) error {
		out, err = reactToCommentOn(ctx, q, documentCommentAdapter{svc: s, access: access}, docCommentRef(doc), actor, commentID, emoji)
		return err
	})
	return out, err
}

// RemoveDocumentCommentReaction deletes the caller's emoji (edit level).
func (s *DocumentService) RemoveDocumentCommentReaction(ctx context.Context, actor Actor, commentID, emoji string) error {
	before, err := s.documentCommentByID(ctx, commentID)
	if err != nil {
		return err
	}
	return s.withDocumentMutation(ctx, actor, before.DocumentID, DocumentLevelEdit, func(q *db.Queries, doc db.Document, access DocumentAccess) error {
		return unreactToCommentOn(ctx, q, documentCommentAdapter{svc: s, access: access}, docCommentRef(doc), actor, commentID, emoji)
	})
}
