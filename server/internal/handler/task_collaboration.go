package handler

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// commentDTO builds the CommentSDO shape for create/list/update/resolve so
// thread fields and author display stay consistent across every response.
func commentDTO(
	id, taskID, authorID, authorKind, body, commentType string,
	revision int64,
	parentID pgtype.Text,
	resolvedAt pgtype.Timestamptz,
	createdAt, updatedAt pgtype.Timestamptz,
	displayName, avatarURL string,
) sdo.CommentDTO {
	out := sdo.CommentDTO{
		ID: id, TaskID: taskID, AuthorID: authorID, AuthorKind: authorKind, Body: body,
		Type: commentType, Revision: revision,
		CreatedAt:   createdAt.Time.Format(time.RFC3339),
		UpdatedAt:   updatedAt.Time.Format(time.RFC3339),
		DisplayName: displayName, AvatarURL: avatarURL,
		Author: sdo.ActorDTO{ID: authorID, Kind: authorKind, DisplayName: displayName, AvatarURL: avatarURL},
	}
	if parentID.Valid {
		p := parentID.String
		out.ParentID = &p
	}
	if resolvedAt.Valid {
		s := resolvedAt.Time.Format(time.RFC3339)
		out.ResolvedAt = &s
	}
	return out
}

func commentDTOFromListRow(c db.ListTaskCommentsRow) sdo.CommentDTO {
	avatar := ""
	if c.AvatarUrl.Valid {
		avatar = c.AvatarUrl.String
	}
	return commentDTO(
		c.ID, c.TaskID, c.AuthorID, c.AuthorKind, c.Body, c.CommentType, c.Revision,
		c.ParentCommentID, c.ResolvedAt, c.CreatedAt, c.UpdatedAt, c.DisplayName, avatar,
	)
}

func commentDTOFromTaskComment(c db.TaskComment, displayName, avatarURL string) sdo.CommentDTO {
	return commentDTO(
		c.ID, c.TaskID, c.AuthorID, c.AuthorKind, c.Body, c.CommentType, c.Revision,
		c.ParentCommentID, c.ResolvedAt, c.CreatedAt, c.UpdatedAt, displayName, avatarURL,
	)
}

func (h *handlers) respondComment(w http.ResponseWriter, r *http.Request, c db.TaskComment) {
	displayName, avatarURL := "", ""
	actors, err := h.Actors.Resolve(r.Context(), []service.ActorRef{{Kind: audit.Kind(c.AuthorKind), ID: c.AuthorID}})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	if a, ok := actors[service.ActorRef{Kind: audit.Kind(c.AuthorKind), ID: c.AuthorID}]; ok {
		displayName, avatarURL = a.DisplayName, a.AvatarURL
	}
	respondJSON(w, 200, sdo.CommentSDO{Comment: commentDTOFromTaskComment(c, displayName, avatarURL)})
}

func (h *handlers) updateComment(w http.ResponseWriter, r *http.Request) {
	var in sdi.UpdateCommentSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	c, err := h.Tasks.UpdateComment(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "commentID"), service.UpdateCommentInput{Body: in.Body})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	h.respondComment(w, r, c)
}

func (h *handlers) deleteComment(w http.ResponseWriter, r *http.Request) {
	if err := h.Tasks.DeleteComment(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "commentID")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]string{"status": "ok"})
}

func (h *handlers) resolveComment(w http.ResponseWriter, r *http.Request) {
	c, err := h.Tasks.ResolveComment(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "commentID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	h.respondComment(w, r, c)
}

func (h *handlers) unresolveComment(w http.ResponseWriter, r *http.Request) {
	c, err := h.Tasks.UnresolveComment(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "commentID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	h.respondComment(w, r, c)
}

func (h *handlers) addCommentReaction(w http.ResponseWriter, r *http.Request) {
	var in sdi.ReactionSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	row, err := h.Tasks.AddCommentReaction(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "commentID"), in.Emoji)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"reaction": map[string]any{
		"id": row.ID, "comment_id": row.CommentID, "actor_type": row.ActorType, "actor_id": row.ActorID,
		"emoji": row.Emoji, "created_at": row.CreatedAt.Time.Format(time.RFC3339),
	}})
}

func (h *handlers) removeCommentReaction(w http.ResponseWriter, r *http.Request) {
	var in sdi.ReactionSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	if err := h.Tasks.RemoveCommentReaction(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "commentID"), in.Emoji); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]string{"status": "ok"})
}

func (h *handlers) addTaskReaction(w http.ResponseWriter, r *http.Request) {
	var in sdi.ReactionSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	row, err := h.Tasks.AddTaskReaction(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "taskID"), in.Emoji)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"reaction": map[string]any{
		"id": row.ID, "task_id": row.TaskID, "actor_type": row.ActorType, "actor_id": row.ActorID,
		"emoji": row.Emoji, "created_at": row.CreatedAt.Time.Format(time.RFC3339),
	}})
}

func (h *handlers) removeTaskReaction(w http.ResponseWriter, r *http.Request) {
	var in sdi.ReactionSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	if err := h.Tasks.RemoveTaskReaction(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "taskID"), in.Emoji); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]string{"status": "ok"})
}

func (h *handlers) listTaskSubscribers(w http.ResponseWriter, r *http.Request) {
	list, err := h.Tasks.ListTaskSubscribers(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "taskID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]map[string]any, 0, len(list))
	for _, s := range list {
		out = append(out, map[string]any{
			"task_id": s.TaskID, "actor_type": s.ActorType, "actor_id": s.ActorID,
			"reason": s.Reason, "created_at": s.CreatedAt.Time.Format(time.RFC3339),
		})
	}
	respondJSON(w, 200, map[string]any{"subscribers": out})
}

func subscribeInput(in sdi.SubscribeTaskSDI) service.SubscribeTaskInput {
	return service.SubscribeTaskInput{UserID: in.UserID, UserType: in.UserType}
}

func (h *handlers) subscribeTask(w http.ResponseWriter, r *http.Request) {
	var in sdi.SubscribeTaskSDI
	if r.ContentLength != 0 && !decode(w, r, &in, maxJSONBody) {
		return
	}
	if err := h.Tasks.SubscribeTask(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "taskID"), subscribeInput(in)); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]string{"status": "ok"})
}

func (h *handlers) unsubscribeTask(w http.ResponseWriter, r *http.Request) {
	var in sdi.SubscribeTaskSDI
	if r.ContentLength != 0 && !decode(w, r, &in, maxJSONBody) {
		return
	}
	if err := h.Tasks.UnsubscribeTask(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "taskID"), subscribeInput(in)); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]string{"status": "ok"})
}

func (h *handlers) unsubscribeTaskSubtree(w http.ResponseWriter, r *http.Request) {
	var in sdi.SubscribeTaskSDI
	if r.ContentLength != 0 && !decode(w, r, &in, maxJSONBody) {
		return
	}
	if err := h.Tasks.UnsubscribeTaskSubtree(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "taskID"), subscribeInput(in)); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]string{"status": "ok"})
}

func (h *handlers) listTaskAttachments(w http.ResponseWriter, r *http.Request) {
	h.mapServiceError(w, h.Tasks.ListTaskAttachments(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "taskID")))
}

func (h *handlers) getAttachment(w http.ResponseWriter, r *http.Request) {
	h.mapServiceError(w, h.Tasks.GetAttachment(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "attachmentID")))
}

func (h *handlers) deleteAttachment(w http.ResponseWriter, r *http.Request) {
	h.mapServiceError(w, h.Tasks.DeleteAttachment(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "attachmentID")))
}

func (h *handlers) getTaskTimeline(w http.ResponseWriter, r *http.Request) {
	h.mapServiceError(w, h.Tasks.GetTaskTimeline(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "taskID")))
}

func (h *handlers) commentSubTaskPreview(w http.ResponseWriter, r *http.Request) {
	h.mapServiceError(w, h.Tasks.CommentSubTaskPreview(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "commentID")))
}

func (h *handlers) createCommentSubTasks(w http.ResponseWriter, r *http.Request) {
	h.mapServiceError(w, h.Tasks.CreateCommentSubTasks(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "commentID")))
}

func (h *handlers) previewCommentTriggers(w http.ResponseWriter, r *http.Request) {
	h.mapServiceError(w, h.Tasks.PreviewCommentTriggers(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "taskID")))
}
