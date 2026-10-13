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
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const idempotencyScopeDocumentCommentCreate = "documents.comment_create"

// Document comment outcomes (contract-collab section 2.4): a comment with
// replies is kept as a tombstone frame, one without is removed for real.
const (
	DocumentCommentOutcomeTombstoned = "tombstoned"
	DocumentCommentOutcomeRemoved    = "removed"
)

// errCommentDeleted is the 409 a mutation on a tombstoned comment answers
// (contract-collab section 9). Deliberately unclassified in the error-class
// registry: the composer must tell "this comment is gone" apart from a
// retryable conflict, not run the save-conflict recovery path.
func errCommentDeleted() error {
	return CodedError{Code: "comment_deleted", Status: http.StatusConflict, Msg: "bình luận này đã bị xóa"}
}

// documentCommentsAfterRead is a test seam: the list reads every row of the
// document in one statement and then hashes those exact rows into the
// list_token, so a write that commits in between must not be described by the
// token the caller stores. DocumentCommentListToken sets this to interleave
// such a write and prove the next poll still sees it. Never set in production.
var documentCommentsAfterRead func()

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
	return commentIdentity{
		ID: c.ID, ResourceID: c.DocumentID, AuthorID: c.AuthorID,
		AuthorKind: c.AuthorKind, CommentType: c.CommentType, Deleted: c.DeletedAt.Valid,
	}
}

func (documentCommentAdapter) insert(ctx context.Context, q *db.Queries, ref CommentRef, _ AddCommentInput, p preparedComment) (db.DocumentComment, error) {
	return q.CreateDocumentComment(ctx, db.CreateDocumentCommentParams{
		ID: p.ID, OrganizationID: ref.OrganizationID, WorkspaceID: ref.WorkspaceID,
		DocumentID: ref.ResourceID, AuthorID: p.AuthorID, AuthorKind: p.AuthorKind,
		Body: p.Body, ParentCommentID: p.ParentID, CommentType: p.CommentType,
	})
}

// updateBody writes one edit: the revision row holding the body being
// replaced (OQ-C3) and then the new body on the comment, both in the caller's
// transaction. A tombstone has nothing to edit - its history is gone for real
// (Q8) - so it answers 409 instead.
func (documentCommentAdapter) updateBody(ctx context.Context, q *db.Queries, ref CommentRef, actor Actor, c db.DocumentComment, body string) (db.DocumentComment, error) {
	if c.DeletedAt.Valid {
		return db.DocumentComment{}, errCommentDeleted()
	}
	if _, err := q.InsertDocumentCommentRevision(ctx, db.InsertDocumentCommentRevisionParams{
		ID: util.NewID(), OrganizationID: ref.OrganizationID, WorkspaceID: ref.WorkspaceID,
		DocumentID: ref.ResourceID, CommentID: c.ID,
		Body: c.Body, Revision: c.Revision,
		CreatedBy: actor.ID, CreatedByKind: string(actor.Kind),
	}); err != nil {
		return db.DocumentComment{}, err
	}
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
	if c.DeletedAt.Valid {
		return db.DocumentComment{}, errCommentDeleted()
	}
	return q.ResolveDocumentComment(ctx, db.ResolveDocumentCommentParams{
		ID: c.ID, OrganizationID: ref.OrganizationID, WorkspaceID: ref.WorkspaceID,
		ResolvedByType: pgtype.Text{String: resolvedByType, Valid: true},
		ResolvedByID:   pgtype.Text{String: resolvedByID, Valid: true},
	})
}

func (documentCommentAdapter) unresolve(ctx context.Context, q *db.Queries, ref CommentRef, c db.DocumentComment) (db.DocumentComment, error) {
	if c.DeletedAt.Valid {
		return db.DocumentComment{}, errCommentDeleted()
	}
	return q.UnresolveDocumentComment(ctx, db.UnresolveDocumentCommentParams{
		ID: c.ID, OrganizationID: ref.OrganizationID, WorkspaceID: ref.WorkspaceID,
	})
}

// resolveCommentType maps a document create onto its thread kind (G8-03):
// an explicit kind picks the flow, an empty kind inherits the parent's for a
// reply and starts a discussion for a root (OQ-C2). A reply may not change
// the thread's kind, and the allowlist stays narrow - neither of the task
// system types can be minted through this path.
func (documentCommentAdapter) resolveCommentType(kind, parentType string) (string, error) {
	kind = strings.TrimSpace(kind)
	if kind == "" {
		if parentType != "" {
			return parentType, nil
		}
		return "discussion", nil
	}
	if kind != "comment" && kind != "discussion" {
		return "", Invalid("kind không hợp lệ")
	}
	if parentType != "" && kind != parentType {
		return "", Invalid("kind của trả lời phải khớp loại của bình luận cha")
	}
	return kind, nil
}

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

// beforeDelete removes the comment's reactions in the delete transaction (no
// FK, so the service cleans up); no attachment rows bind a document comment.
func (documentCommentAdapter) beforeDelete(ctx context.Context, q *db.Queries, ref CommentRef, c db.DocumentComment) error {
	return q.DeleteDocumentCommentReactions(ctx, db.DeleteDocumentCommentReactionsParams{
		CommentID: c.ID, OrganizationID: ref.OrganizationID, WorkspaceID: ref.WorkspaceID,
	})
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

// DocumentCommentListInput filters the thread read (contract-collab section
// 2.1). An empty kind returns both thread kinds; SinceToken is the list_token
// of the previous full list - equal to the current one, the answer is
// Unchanged and carries no rows.
type DocumentCommentListInput struct {
	Kind       string
	SinceToken string
}

// DocumentCommentList is one list answer: the rows (oldest first) plus the
// document-wide list_token they were hashed from. Unchanged marks the probe
// answer - rows and token describe the same document state the caller already
// holds, and Rows is empty.
type DocumentCommentList struct {
	Rows      []db.ListDocumentCommentsRow
	Token     string
	Unchanged bool
}

// DocumentComments lists the thread for a reader (view). Kind filters the
// answer in memory; the token is computed from every row of the document the
// one SQL statement returned, so it can never run ahead of the rows the
// caller received (contract-collab section 6).
func (s *DocumentService) DocumentComments(ctx context.Context, actor Actor, documentID string, in DocumentCommentListInput) (DocumentCommentList, error) {
	kind := strings.TrimSpace(in.Kind)
	if kind != "" && kind != "comment" && kind != "discussion" {
		return DocumentCommentList{}, Invalid("kind không hợp lệ")
	}
	doc, _, err := s.authorizeDocument(ctx, actor, documentID, DocumentLevelView)
	if err != nil {
		return DocumentCommentList{}, err
	}
	rows, err := s.q.ListDocumentComments(ctx, db.ListDocumentCommentsParams{
		DocumentID: doc.ID, OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
	})
	if err != nil {
		return DocumentCommentList{}, err
	}
	if documentCommentsAfterRead != nil {
		documentCommentsAfterRead()
	}
	token := documentCommentListToken(rows)
	if in.SinceToken != "" && in.SinceToken == token {
		return DocumentCommentList{Token: token, Unchanged: true}, nil
	}
	// The kind filter runs after the token: the token is one per document and
	// must not change with the filter a client happens to send.
	filtered := rows[:0:0]
	for _, r := range rows {
		if kind != "" && r.CommentType != kind {
			continue
		}
		filtered = append(filtered, r)
	}
	return DocumentCommentList{Rows: filtered, Token: token}, nil
}

// documentCommentListToken is the opaque "lt1:" token of contract-collab
// section 6: a SHA-256 over (id, updated_at, anchor_state) of every remaining
// row of the document, both kinds, tombstones included, sorted by id. It
// changes when any row is created, edited, tombstoned, resolved or removed -
// a hard delete changes the row set even though no row is newer - and never
// from a reaction or a rename.
func documentCommentListToken(rows []db.ListDocumentCommentsRow) string {
	sorted := make([]db.ListDocumentCommentsRow, len(rows))
	copy(sorted, rows)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].ID < sorted[j].ID })
	h := sha256.New()
	for _, r := range sorted {
		state := ""
		if r.AnchorState.Valid {
			state = r.AnchorState.String
		}
		for _, part := range []string{r.ID, r.UpdatedAt.Time.UTC().Format("2006-01-02T15:04:05.000000Z"), state} {
			_, _ = h.Write([]byte(part))
			_, _ = h.Write([]byte{0})
		}
	}
	return "lt1:" + hex.EncodeToString(h.Sum(nil))
}

// DocumentCommentRevisions lists one comment's edit history, newest first
// (view). A comment of another document is 404; a tombstone answers 409 -
// its history was deleted for real (Q8).
func (s *DocumentService) DocumentCommentRevisions(ctx context.Context, actor Actor, documentID, commentID string) ([]db.DocumentCommentRevision, error) {
	doc, _, err := s.authorizeDocument(ctx, actor, documentID, DocumentLevelView)
	if err != nil {
		return nil, err
	}
	c, err := loadInResource(ctx, s.q, documentCommentAdapter{}, docCommentRef(doc), commentID)
	if err != nil {
		return nil, err
	}
	if c.DeletedAt.Valid {
		return nil, errCommentDeleted()
	}
	return s.q.ListDocumentCommentRevisions(ctx, db.ListDocumentCommentRevisionsParams{
		CommentID: c.ID, DocumentID: doc.ID,
		OrganizationID: doc.OrganizationID, WorkspaceID: doc.WorkspaceID,
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

// validateDocumentCommentLegacyType keeps the pre-G8 wire field honest: the
// old allowlist was "comment" (or empty) and it never picks the thread kind -
// that is `kind`/comment_type now. Anything else answers the old 400.
func validateDocumentCommentLegacyType(legacyType string) error {
	legacyType = strings.TrimSpace(legacyType)
	if legacyType == "" || legacyType == "comment" {
		return nil
	}
	return Invalid("type không hợp lệ")
}

// AddDocumentComment creates a threaded comment: edit level inside the
// document lock, idempotent under Idempotency-Key in the
// documents.comment_create scope.
func (s *DocumentService) AddDocumentComment(ctx context.Context, actor Actor, documentID string, in AddCommentInput, idempotencyKey string) (db.DocumentComment, error) {
	if err := validateDocumentCommentLegacyType(in.LegacyType); err != nil {
		return db.DocumentComment{}, err
	}
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

// DeleteDocumentComment deletes a comment; author or manage. The outcome
// names what happened: a comment with surviving replies is kept as a
// tombstone frame, one without is removed for real (contract-collab 2.4).
func (s *DocumentService) DeleteDocumentComment(ctx context.Context, actor Actor, commentID string) (string, error) {
	before, err := s.documentCommentByID(ctx, commentID)
	if err != nil {
		return "", err
	}
	var outcome string
	err = s.withDocumentMutation(ctx, actor, before.DocumentID, DocumentLevelEdit, func(q *db.Queries, doc db.Document, access DocumentAccess) error {
		outcome, err = deleteDocumentCommentOn(ctx, q, documentCommentAdapter{svc: s, access: access}, docCommentRef(doc), actor, commentID)
		return err
	})
	return outcome, err
}

// deleteDocumentCommentOn is the document delete policy. The structure stays:
// a comment with at least one child (tombstoned or not) keeps its row as an
// empty frame while its own revisions, reactions and mentions go; a comment
// with no child is removed for real, and a tombstoned ancestor that loses its
// last child is removed with it, up to the root (OQ-C4).
func deleteDocumentCommentOn(ctx context.Context, q *db.Queries, ad documentCommentAdapter, ref CommentRef, actor Actor, commentID string) (string, error) {
	c, err := loadInResource(ctx, q, ad, ref, commentID)
	if err != nil {
		return "", err
	}
	allowed, err := ad.canModerate(ctx, actor, ref, c)
	if err != nil {
		return "", err
	}
	if !allowed {
		return "", ErrForbidden
	}
	if c.DeletedAt.Valid {
		// Already a tombstone: nothing to delete, nothing to audit.
		return DocumentCommentOutcomeTombstoned, nil
	}
	replies, err := q.CountDocumentCommentReplies(ctx, db.CountDocumentCommentRepliesParams{
		ParentCommentID: pgtype.Text{String: c.ID, Valid: true},
		OrganizationID:  ref.OrganizationID, WorkspaceID: ref.WorkspaceID,
	})
	if err != nil {
		return "", err
	}
	v := ad.verbs()
	if replies > 0 {
		if err := ad.beforeDelete(ctx, q, ref, c); err != nil {
			return "", err
		}
		if err := q.MarkDocumentCommentMentionsRemoved(ctx, db.MarkDocumentCommentMentionsRemovedParams{
			CommentID: c.ID, DocumentID: ref.ResourceID,
			OrganizationID: ref.OrganizationID, WorkspaceID: ref.WorkspaceID,
		}); err != nil {
			return "", err
		}
		if err := q.DeleteDocumentCommentRevisions(ctx, db.DeleteDocumentCommentRevisionsParams{
			CommentID: c.ID, OrganizationID: ref.OrganizationID, WorkspaceID: ref.WorkspaceID,
		}); err != nil {
			return "", err
		}
		if _, err := q.TombstoneDocumentComment(ctx, db.TombstoneDocumentCommentParams{
			ID: c.ID, OrganizationID: ref.OrganizationID, WorkspaceID: ref.WorkspaceID,
			DeletedByID:   pgtype.Text{String: actor.ID, Valid: true},
			DeletedByKind: pgtype.Text{String: string(actor.Kind), Valid: true},
		}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				// A raced delete already tombstoned the row: same outcome.
				return DocumentCommentOutcomeTombstoned, nil
			}
			return "", err
		}
		if err := recordCommentAudit(ctx, q, actor, ref, v, v.deleted, commentID, nil); err != nil {
			return "", err
		}
		return DocumentCommentOutcomeTombstoned, nil
	}
	cur := c
	for {
		if err := ad.beforeDelete(ctx, q, ref, cur); err != nil {
			return "", err
		}
		if err := q.DeleteDocumentCommentMentions(ctx, db.DeleteDocumentCommentMentionsParams{
			CommentID: cur.ID, DocumentID: ref.ResourceID,
			OrganizationID: ref.OrganizationID, WorkspaceID: ref.WorkspaceID,
		}); err != nil {
			return "", err
		}
		if err := q.DeleteDocumentCommentRevisions(ctx, db.DeleteDocumentCommentRevisionsParams{
			CommentID: cur.ID, OrganizationID: ref.OrganizationID, WorkspaceID: ref.WorkspaceID,
		}); err != nil {
			return "", err
		}
		if err := ad.remove(ctx, q, ref, cur); err != nil {
			return "", err
		}
		// A tombstoned parent with no other child left has nothing to hold
		// its frame open; it goes with the last child, and so on upward.
		if !cur.ParentCommentID.Valid {
			break
		}
		parent, err := ad.tenantGet(ctx, q, ref, cur.ParentCommentID.String)
		if errors.Is(err, pgx.ErrNoRows) {
			break
		}
		if err != nil {
			return "", err
		}
		if parent.DocumentID != ref.ResourceID || !parent.DeletedAt.Valid {
			break
		}
		siblings, err := q.CountDocumentCommentReplies(ctx, db.CountDocumentCommentRepliesParams{
			ParentCommentID: pgtype.Text{String: parent.ID, Valid: true},
			OrganizationID:  ref.OrganizationID, WorkspaceID: ref.WorkspaceID,
		})
		if err != nil {
			return "", err
		}
		if siblings > 0 {
			break
		}
		cur = parent
	}
	if err := recordCommentAudit(ctx, q, actor, ref, v, v.deleted, commentID, nil); err != nil {
		return "", err
	}
	return DocumentCommentOutcomeRemoved, nil
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
