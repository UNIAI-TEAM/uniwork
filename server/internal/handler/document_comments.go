package handler

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Document comments HTTP (G1-07, UNI-681; lane 07b). Every handler builds the
// actor with service.Human from the auth middleware, hands the wire shape
// straight to DocumentService and never queries the DB: the service decides
// visibility and answers ErrNotFound/ErrForbidden, and mapServiceError turns
// those into 404/403 without leaking whether an id exists. Bodies go through
// decode() under the default 1 MiB cap. Create carries an optional
// Idempotency-Key: the service replays the stored comment for the same
// key+fingerprint and answers idempotency_payload_mismatch for a different
// payload.

// documentCommentDTO renders one row from a single-comment response. The
// service returns the row without an author join, so the caller resolves the
// display name through ActorService first (same shape as task comments).
func documentCommentDTO(c db.DocumentComment, displayName, avatarURL string, reactions []sdo.CommentReactionDTO) sdo.DocumentCommentDTO {
	if reactions == nil {
		reactions = []sdo.CommentReactionDTO{}
	}
	out := sdo.DocumentCommentDTO{
		ID: c.ID, DocumentID: c.DocumentID, AuthorID: c.AuthorID, AuthorKind: c.AuthorKind,
		Body: c.Body, Type: c.CommentType, Revision: c.Revision,
		CreatedAt:   c.CreatedAt.Time.UTC().Format(time.RFC3339),
		UpdatedAt:   c.UpdatedAt.Time.UTC().Format(time.RFC3339),
		DisplayName: displayName, AvatarURL: avatarURL,
		Author:    sdo.ActorDTO{ID: c.AuthorID, Kind: c.AuthorKind, DisplayName: displayName, AvatarURL: avatarURL},
		Reactions: reactions,
	}
	if c.ParentCommentID.Valid {
		p := c.ParentCommentID.String
		out.ParentID = &p
	}
	if c.ResolvedAt.Valid {
		s := c.ResolvedAt.Time.UTC().Format(time.RFC3339)
		out.ResolvedAt = &s
	}
	return out
}

// documentCommentDTOFromListRow renders a list row, whose query already
// carries the author display name and avatar; the row is the same record the
// single-comment path reads, so it goes through the one mapper.
func documentCommentDTOFromListRow(c db.ListDocumentCommentsRow, reactions []sdo.CommentReactionDTO) sdo.DocumentCommentDTO {
	avatar := ""
	if c.AvatarUrl.Valid {
		avatar = c.AvatarUrl.String
	}
	return documentCommentDTO(db.DocumentComment{
		ID: c.ID, DocumentID: c.DocumentID, AuthorID: c.AuthorID, AuthorKind: c.AuthorKind,
		Body: c.Body, CommentType: c.CommentType, Revision: c.Revision,
		ParentCommentID: c.ParentCommentID, ResolvedAt: c.ResolvedAt,
		CreatedAt: c.CreatedAt, UpdatedAt: c.UpdatedAt,
	}, c.DisplayName, avatar, reactions)
}

// commentReactionDTO renders one comment_reactions row for the reaction
// answer (the same shape the task comment API returns).
func commentReactionDTO(row db.CommentReaction) sdo.CommentReactionDTO {
	return sdo.CommentReactionDTO{
		ID:        row.ID,
		CommentID: row.CommentID,
		ActorType: row.ActorType,
		ActorID:   row.ActorID,
		Emoji:     row.Emoji,
		CreatedAt: row.CreatedAt.Time.UTC().Format(time.RFC3339),
	}
}

// respondDocumentComment writes one comment with its author resolved. The
// reaction list stays empty on single-comment answers (create/patch/resolve)
// exactly like the task comment API: the client refetches the thread for
// reactions, and an answer that never carries them is honest about it.
func (h *handlers) respondDocumentComment(w http.ResponseWriter, r *http.Request, c db.DocumentComment) {
	displayName, avatarURL := "", ""
	ref := service.ActorRef{Kind: audit.Kind(c.AuthorKind), ID: c.AuthorID}
	actors, err := h.Actors.Resolve(r.Context(), []service.ActorRef{ref})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	if a, ok := actors[ref]; ok {
		displayName, avatarURL = a.DisplayName, a.AvatarURL
	}
	respondJSON(w, http.StatusOK, sdo.DocumentCommentSDO{Comment: documentCommentDTO(c, displayName, avatarURL, nil)})
}

// listDocumentComments is GET /documents/{documentID}/comments: the thread for
// a reader (view level), oldest first, with each comment's reactions.
func (h *handlers) listDocumentComments(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	actor := service.Human(middleware.UserID(r.Context()))
	documentID := chi.URLParam(r, "documentID")
	comments, err := h.Documents.DocumentComments(r.Context(), actor, documentID)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	reactions, err := h.Documents.DocumentCommentReactions(r.Context(), actor, documentID)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	grouped := groupCommentReactions(reactions)
	out := sdo.DocumentCommentListSDO{Comments: make([]sdo.DocumentCommentDTO, 0, len(comments))}
	for _, c := range comments {
		out.Comments = append(out.Comments, documentCommentDTOFromListRow(c, grouped[c.ID]))
	}
	respondJSON(w, http.StatusOK, out)
}

// createDocumentComment is POST /documents/{documentID}/comments: a threaded
// comment (edit level) under the optional Idempotency-Key.
func (h *handlers) createDocumentComment(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	var in sdi.CreateDocumentCommentSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	c, err := h.Documents.AddDocumentComment(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "documentID"), service.AddCommentInput{
		Body:        in.Body,
		ParentID:    in.ParentID,
		CommentType: in.Type,
	}, r.Header.Get("Idempotency-Key"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	h.respondDocumentComment(w, r, c)
}

// updateDocumentComment is PATCH /documents/{documentID}/comments/{commentID}:
// author-or-manage edits the body, and only while the caller still holds edit
// on the document.
func (h *handlers) updateDocumentComment(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	var in sdi.UpdateDocumentCommentSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	c, err := h.Documents.UpdateDocumentComment(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "commentID"), service.UpdateCommentInput{Body: in.Body})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	h.respondDocumentComment(w, r, c)
}

// deleteDocumentComment is DELETE /documents/{documentID}/comments/{commentID}:
// author or manage; the service removes the comment's reactions with it.
func (h *handlers) deleteDocumentComment(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	if err := h.Documents.DeleteDocumentComment(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "commentID")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.StatusSDO{Status: "ok"})
}

// resolveDocumentComment is POST /documents/{documentID}/comments/{commentID}/resolve
// (edit level, idempotent).
func (h *handlers) resolveDocumentComment(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	c, err := h.Documents.ResolveDocumentComment(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "commentID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	h.respondDocumentComment(w, r, c)
}

// reopenDocumentComment is DELETE /documents/{documentID}/comments/{commentID}/resolve:
// clears the resolution flag (edit level, idempotent).
func (h *handlers) reopenDocumentComment(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	c, err := h.Documents.UnresolveDocumentComment(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "commentID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	h.respondDocumentComment(w, r, c)
}

// addDocumentCommentReaction is POST /documents/{documentID}/comments/{commentID}/reactions
// (edit level; idempotent - the same emoji by the same actor maps to one row).
func (h *handlers) addDocumentCommentReaction(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	var in sdi.ReactionSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	reaction, err := h.Documents.AddDocumentCommentReaction(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "commentID"), in.Emoji)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.CommentReactionSDO{Reaction: commentReactionDTO(reaction)})
}

// removeDocumentCommentReaction is DELETE /documents/{documentID}/comments/{commentID}/reactions
// (edit level; idempotent - removing an absent reaction is a no-op).
func (h *handlers) removeDocumentCommentReaction(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	var in sdi.ReactionSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	if err := h.Documents.RemoveDocumentCommentReaction(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "commentID"), in.Emoji); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.StatusSDO{Status: "ok"})
}
