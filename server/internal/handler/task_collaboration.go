package handler

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func commentDTOFromRow(c db.TaskComment) map[string]any {
	out := map[string]any{
		"id": c.ID, "task_id": c.TaskID, "author_id": c.AuthorID, "author_kind": c.AuthorKind,
		"body": c.Body, "type": c.CommentType, "revision": c.Revision,
		"created_at": c.CreatedAt.Time.Format(time.RFC3339),
		"updated_at": c.UpdatedAt.Time.Format(time.RFC3339),
	}
	if c.ParentCommentID.Valid {
		out["parent_id"] = c.ParentCommentID.String
	}
	if c.ResolvedAt.Valid {
		out["resolved_at"] = c.ResolvedAt.Time.Format(time.RFC3339)
		if c.ResolvedByType.Valid {
			out["resolved_by_type"] = c.ResolvedByType.String
		}
		if c.ResolvedByID.Valid {
			out["resolved_by_id"] = c.ResolvedByID.String
		}
	}
	return out
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
	respondJSON(w, 200, map[string]any{"comment": commentDTOFromRow(c)})
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
	respondJSON(w, 200, map[string]any{"comment": commentDTOFromRow(c)})
}

func (h *handlers) unresolveComment(w http.ResponseWriter, r *http.Request) {
	c, err := h.Tasks.UnresolveComment(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "commentID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, map[string]any{"comment": commentDTOFromRow(c)})
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
	if err := h.Tasks.ListTaskAttachments(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "taskID")); err != nil {
		h.mapServiceError(w, err)
	}
}

func (h *handlers) getAttachment(w http.ResponseWriter, r *http.Request) {
	if err := h.Tasks.GetAttachment(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "attachmentID")); err != nil {
		h.mapServiceError(w, err)
	}
}

func (h *handlers) deleteAttachment(w http.ResponseWriter, r *http.Request) {
	if err := h.Tasks.DeleteAttachment(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "attachmentID")); err != nil {
		h.mapServiceError(w, err)
	}
}

func (h *handlers) getTaskTimeline(w http.ResponseWriter, r *http.Request) {
	if err := h.Tasks.GetTaskTimeline(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "taskID")); err != nil {
		h.mapServiceError(w, err)
	}
}

func (h *handlers) commentSubTaskPreview(w http.ResponseWriter, r *http.Request) {
	if err := h.Tasks.CommentSubTaskPreview(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "commentID")); err != nil {
		h.mapServiceError(w, err)
	}
}

func (h *handlers) createCommentSubTasks(w http.ResponseWriter, r *http.Request) {
	if err := h.Tasks.CreateCommentSubTasks(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "commentID")); err != nil {
		h.mapServiceError(w, err)
	}
}

func (h *handlers) previewCommentTriggers(w http.ResponseWriter, r *http.Request) {
	if err := h.Tasks.PreviewCommentTriggers(r.Context(), service.Human(middleware.UserID(r.Context())), chi.URLParam(r, "taskID")); err != nil {
		h.mapServiceError(w, err)
	}
}
