package handler

import (
	"encoding/json"
	"net/http"
	"strings"
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
// those into 404/403 without leaking whether an id exists. The id-addressed
// routes bind {commentID} to the {documentID} the URL names before the service
// sees the comment: the service authorizes a comment against its own document,
// so without that check a comment on document B would answer - and mutate -
// through a URL naming document A. Bodies go through decode() under the
// default 1 MiB cap. Create carries an optional Idempotency-Key: the service
// replays the stored comment for the same key+fingerprint and answers
// idempotency_payload_mismatch for a different payload.

// documentCommentDTO renders one row from a single-comment response. The
// service returns the row without an author join, so the caller resolves the
// display name through ActorService first (same shape as task comments).
func documentCommentDTO(c db.DocumentComment, displayName, avatarURL string, reactions []sdo.CommentReactionDTO) sdo.DocumentCommentDTO {
	if reactions == nil {
		reactions = []sdo.CommentReactionDTO{}
	}
	out := sdo.DocumentCommentDTO{
		ID: c.ID, DocumentID: c.DocumentID, AuthorID: c.AuthorID, AuthorKind: c.AuthorKind,
		Body: c.Body, Type: c.CommentType, Kind: c.CommentType, Revision: c.Revision,
		CreatedAt:   c.CreatedAt.Time.UTC().Format(time.RFC3339),
		UpdatedAt:   c.UpdatedAt.Time.UTC().Format(time.RFC3339),
		DisplayName: displayName, AvatarURL: avatarURL,
		Author:    sdo.ActorDTO{ID: c.AuthorID, Kind: c.AuthorKind, DisplayName: displayName, AvatarURL: avatarURL},
		Reactions: reactions,
	}
	// A nil anchor marshals as null: the field is always present, so a client
	// reads "no anchor" without a second look at the key list.
	out.Anchor = json.RawMessage(c.Anchor)
	if c.AnchorVersionID.Valid {
		out.AnchorVer = &c.AnchorVersionID.String
	}
	if c.AnchorState.Valid {
		out.AnchorState = &c.AnchorState.String
	}
	if c.ParentCommentID.Valid {
		p := c.ParentCommentID.String
		out.ParentID = &p
	}
	if c.ResolvedAt.Valid {
		s := c.ResolvedAt.Time.UTC().Format(time.RFC3339)
		out.ResolvedAt = &s
	}
	if c.DeletedAt.Valid {
		s := c.DeletedAt.Time.UTC().Format(time.RFC3339)
		out.DeletedAt = &s
	}
	if c.DeletedByID.Valid {
		out.DeletedByID = &c.DeletedByID.String
	}
	if c.DeletedByKind.Valid {
		out.DeletedKind = &c.DeletedByKind.String
	}
	return out
}

// documentCommentDTOFromListRow renders a list row, whose query already
// carries the author display name and the legacy avatar column; the row is the
// same record the single-comment path reads, so it goes through the one
// mapper. resolved is the page's batched Actors.Resolve answer: its avatar
// (which covers FileService uploads) wins, the row's legacy value is only the
// fallback when the resolver gave none.
func documentCommentDTOFromListRow(c db.ListDocumentCommentsRow, reactions []sdo.CommentReactionDTO, resolved map[service.ActorRef]service.ActorInfo) sdo.DocumentCommentDTO {
	avatar := ""
	if c.AvatarUrl.Valid {
		avatar = c.AvatarUrl.String
	}
	if a, ok := resolved[service.ActorRef{Kind: audit.Kind(c.AuthorKind), ID: c.AuthorID}]; ok && a.AvatarURL != "" {
		avatar = a.AvatarURL
	}
	return documentCommentDTO(db.DocumentComment{
		ID: c.ID, DocumentID: c.DocumentID, AuthorID: c.AuthorID, AuthorKind: c.AuthorKind,
		Body: c.Body, CommentType: c.CommentType, Revision: c.Revision,
		ParentCommentID: c.ParentCommentID, ResolvedAt: c.ResolvedAt,
		CreatedAt: c.CreatedAt, UpdatedAt: c.UpdatedAt,
		Anchor: c.Anchor, AnchorVersionID: c.AnchorVersionID, AnchorState: c.AnchorState,
		DeletedAt: c.DeletedAt, DeletedByID: c.DeletedByID, DeletedByKind: c.DeletedByKind,
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
func (h *handlers) respondDocumentComment(w http.ResponseWriter, r *http.Request, status int, c db.DocumentComment) {
	h.respondDocumentCommentWith(w, r, status, c, nil)
}

// respondDocumentCommentWith is respondDocumentComment plus the
// mentions_without_access of a create or an edit (G8-18); nil or empty leaves
// the field out, so an answer with nobody to report keeps the old shape.
func (h *handlers) respondDocumentCommentWith(w http.ResponseWriter, r *http.Request, status int, c db.DocumentComment, noAccess []service.MentionWithoutAccess) {
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
	out := sdo.DocumentCommentSDO{Comment: documentCommentDTO(c, displayName, avatarURL, nil)}
	for _, m := range noAccess {
		out.MentionsWithoutAccess = append(out.MentionsWithoutAccess, sdo.MentionWithoutAccessDTO{
			UserID: m.UserID, DisplayName: m.DisplayName, CanShare: m.CanShare,
		})
	}
	respondJSON(w, status, out)
}

// requireDocumentComment binds the {commentID} in the URL to the {documentID}
// the route names before a mutation addresses the comment by bare id. The
// service authorizes a comment against its own document, so without this check
// a comment on document B would answer - and mutate - through a URL naming
// document A, or through a document that does not exist at all. A comment that
// hangs on another document answers the same 404 as an unknown id and never
// reveals which document holds it.
func (h *handlers) requireDocumentComment(w http.ResponseWriter, r *http.Request) bool {
	c, err := h.Documents.GetDocumentComment(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "commentID"))
	if err != nil {
		h.mapServiceError(w, err)
		return false
	}
	if c.DocumentID != chi.URLParam(r, "documentID") {
		h.mapServiceError(w, service.ErrNotFound)
		return false
	}
	return true
}

// listDocumentComments is GET /documents/{documentID}/comments: the thread for
// a reader (view level), oldest first, with each comment's reactions. The
// answer always carries the document's list_token; since_token equal to the
// current token answers unchanged with no rows, so a polling client keeps the
// list it already has (contract-collab sections 2.1 and 6).
func (h *handlers) listDocumentComments(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	actor := service.Human(middleware.UserID(r.Context()))
	documentID := chi.URLParam(r, "documentID")
	list, err := h.Documents.DocumentComments(r.Context(), actor, documentID, service.DocumentCommentListInput{
		Kind:       r.URL.Query().Get("kind"),
		SinceToken: r.URL.Query().Get("since_token"),
	})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	// The mention name table arrives with G8-05; an empty array keeps the SDO
	// shape the contract fixes.
	out := sdo.DocumentCommentListSDO{
		Comments:  make([]sdo.DocumentCommentDTO, 0, len(list.Rows)),
		Mentions:  []sdo.DocumentCommentMentionDTO{},
		ListToken: list.Token,
		Unchanged: list.Unchanged,
	}
	if list.Unchanged {
		respondJSON(w, http.StatusOK, out)
		return
	}
	reactions, err := h.Documents.DocumentCommentReactions(r.Context(), actor, documentID)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	grouped := groupCommentReactions(reactions)
	// One batched resolve for the page's distinct authors, so FileService
	// avatars appear like they do on the single-comment answers.
	seen := map[service.ActorRef]bool{}
	var refs []service.ActorRef
	for _, c := range list.Rows {
		ref := service.ActorRef{Kind: audit.Kind(c.AuthorKind), ID: c.AuthorID}
		if !seen[ref] {
			seen[ref] = true
			refs = append(refs, ref)
		}
	}
	resolved, err := h.Actors.Resolve(r.Context(), refs)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	for _, c := range list.Rows {
		out.Comments = append(out.Comments, documentCommentDTOFromListRow(c, grouped[c.ID], resolved))
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
	var anchor json.RawMessage
	if in.Anchor != nil {
		anchor = *in.Anchor
	}
	baseVersionID := ""
	if in.BaseVersionID != nil {
		baseVersionID = *in.BaseVersionID
	}
	c, err := h.Documents.AddDocumentComment(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "documentID"), service.AddCommentInput{
		Body:          in.Body,
		ParentID:      in.ParentID,
		CommentType:   in.Kind,
		LegacyType:    in.Type,
		Anchor:        anchor,
		BaseVersionID: baseVersionID,
	}, r.Header.Get("Idempotency-Key"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	noAccess, err := h.Documents.CommentMentionsWithoutAccess(r.Context(), service.Human(middleware.UserID(r.Context())), c.DocumentID, c.ID)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	// 201 for a create and for its replay alike (contract-collab 2.2).
	h.respondDocumentCommentWith(w, r, http.StatusCreated, c, noAccess)
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
	if !h.requireDocumentComment(w, r) {
		return
	}
	c, err := h.Documents.UpdateDocumentComment(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "commentID"), service.UpdateCommentInput{Body: in.Body})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	noAccess, err := h.Documents.CommentMentionsWithoutAccess(r.Context(), service.Human(middleware.UserID(r.Context())), c.DocumentID, c.ID)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	h.respondDocumentCommentWith(w, r, http.StatusOK, c, noAccess)
}

// deleteDocumentComment is DELETE /documents/{documentID}/comments/{commentID}:
// author or manage. A comment with surviving replies becomes a tombstone
// frame (outcome "tombstoned"); one without is removed for real (outcome
// "removed"). `status` keeps the old value old clients read.
func (h *handlers) deleteDocumentComment(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	if !h.requireDocumentComment(w, r) {
		return
	}
	outcome, err := h.Documents.DeleteDocumentComment(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "commentID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.DocumentCommentDeleteSDO{Status: "ok", Outcome: outcome})
}

// putDocumentCommentAnchors is PUT /documents/{documentID}/comments/anchors
// (G8-04, edit level): the editor's anchor map for the version it just saved.
// The service resolves version_id inside this tenant + document (400
// anchor_version_invalid otherwise), never moves an anchor back to an older
// version, and answers the changed/skipped lists plus the document's
// list_token. Repeating the same payload changes no row and emits no event.
func (h *handlers) putDocumentCommentAnchors(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	// R1-8: anchors is a required field, so the body must carry the key and
	// it may not be null. The raw body is decoded once into a presence map
	// and the wire shape is rebuilt from it, the way updateChatChannel does;
	// an absent key or a null answers 400 before the service is reached.
	var raw map[string]json.RawMessage
	if !decode(w, r, &raw, maxJSONBody) {
		return
	}
	var in sdi.PutDocumentCommentAnchorsSDI
	buf, _ := json.Marshal(raw)
	// R3-2: a present-but-malformed anchors value (e.g. [1], "x", {}) must
	// not decode to a nil slice and read as an empty update; the typed-decode
	// error is a 400, as updateChatChannel answers (contract 2.6).
	if err := json.Unmarshal(buf, &in); err != nil {
		respondError(w, http.StatusBadRequest, "invalid_request", "JSON không hợp lệ")
		return
	}
	if v, ok := raw["anchors"]; ok && string(v) != "null" {
		in.AnchorsPresent = true
	} else {
		respondError(w, http.StatusBadRequest, "invalid_request", "anchors là trường bắt buộc")
		return
	}
	// R3-4: the SDI's minLength is documentation only, so an empty or blank
	// comment_id reaches the service and is answered 200 in skipped; refuse
	// it here while the raw pass is in hand.
	for _, a := range in.Anchors {
		if strings.TrimSpace(a.CommentID) == "" {
			respondError(w, http.StatusBadRequest, "invalid_request", "comment_id là trường bắt buộc")
			return
		}
	}
	anchors := make([]service.DocumentCommentAnchorItem, 0, len(in.Anchors))
	for _, a := range in.Anchors {
		anchors = append(anchors, service.DocumentCommentAnchorItem{
			CommentID: a.CommentID, Anchor: a.Anchor, State: a.State,
		})
	}
	res, err := h.Documents.PutDocumentCommentAnchors(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "documentID"), service.DocumentCommentAnchorsInput{VersionID: in.VersionID, Anchors: anchors, AnchorsPresent: in.AnchorsPresent})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.DocumentCommentAnchorsSDO{
		Updated:   res.Updated,
		Skipped:   make([]sdo.DocumentCommentAnchorSkipDTO, 0, len(res.Skipped)),
		ListToken: res.ListToken,
	}
	for _, s := range res.Skipped {
		out.Skipped = append(out.Skipped, sdo.DocumentCommentAnchorSkipDTO{CommentID: s.CommentID, Reason: s.Reason})
	}
	respondJSON(w, http.StatusOK, out)
}

// listDocumentCommentRevisions is GET
// /documents/{documentID}/comments/{commentID}/revisions (view level):
// newest first. The service authorizes the document and binds the comment to
// it; a comment of another document is 404 and a tombstone answers 409
// comment_deleted - its history was deleted for real (Q8).
func (h *handlers) listDocumentCommentRevisions(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	revs, err := h.Documents.DocumentCommentRevisions(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "documentID"), chi.URLParam(r, "commentID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.DocumentCommentRevisionListSDO{Revisions: make([]sdo.DocumentCommentRevisionDTO, 0, len(revs))}
	for _, rev := range revs {
		out.Revisions = append(out.Revisions, sdo.DocumentCommentRevisionDTO{
			ID: rev.ID, Revision: rev.Revision, Body: rev.Body,
			CreatedByID: rev.CreatedBy, CreatedByKind: rev.CreatedByKind,
			CreatedAt: rev.CreatedAt.Time.UTC().Format(time.RFC3339),
		})
	}
	respondJSON(w, http.StatusOK, out)
}

// resolveDocumentComment is POST /documents/{documentID}/comments/{commentID}/resolve
// (edit level, idempotent).
func (h *handlers) resolveDocumentComment(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	if !h.requireDocumentComment(w, r) {
		return
	}
	c, err := h.Documents.ResolveDocumentComment(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "commentID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	h.respondDocumentComment(w, r, http.StatusOK, c)
}

// reopenDocumentComment is DELETE /documents/{documentID}/comments/{commentID}/resolve:
// clears the resolution flag (edit level, idempotent).
func (h *handlers) reopenDocumentComment(w http.ResponseWriter, r *http.Request) {
	if h.Documents == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "documents are not configured")
		return
	}
	if !h.requireDocumentComment(w, r) {
		return
	}
	c, err := h.Documents.UnresolveDocumentComment(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "commentID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	h.respondDocumentComment(w, r, http.StatusOK, c)
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
	if !h.requireDocumentComment(w, r) {
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
	if !h.requireDocumentComment(w, r) {
		return
	}
	if err := h.Documents.RemoveDocumentCommentReaction(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "commentID"), in.Emoji); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.StatusSDO{Status: "ok"})
}
