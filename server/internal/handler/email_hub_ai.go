package handler

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

func (h *handlers) summarizeEmailHubThread(w http.ResponseWriter, r *http.Request) {
	var in sdi.SummarizeEmailHubThreadSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	if in.AccountID == "" {
		respondError(w, http.StatusBadRequest, "invalid_request", "account_id is required")
		return
	}
	sum, err := h.EmailHub.SummarizeThread(
		r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), in.AccountID, chi.URLParam(r, "threadID"), in.Locale, in.Force,
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, toEmailHubThreadSummarySDO(sum))
}

func (h *handlers) getEmailHubThreadSummary(w http.ResponseWriter, r *http.Request) {
	accountID := r.URL.Query().Get("account_id")
	if accountID == "" {
		respondError(w, http.StatusBadRequest, "invalid_request", "account_id is required")
		return
	}
	locale := r.URL.Query().Get("locale")
	sum, err := h.EmailHub.GetThreadSummary(
		r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), accountID, chi.URLParam(r, "threadID"), locale,
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, toEmailHubThreadSummarySDO(sum))
}

func toEmailHubThreadSummarySDO(sum service.EmailHubThreadSummaryView) sdo.EmailHubThreadSummarySDO {
	out := sdo.EmailHubThreadSummarySDO{
		Summary: sum.Summary, KeyPoints: sum.KeyPoints, NeedsReply: sum.NeedsReply,
		ReplyHint: sum.ReplyHint, Model: sum.Model, Cached: sum.Cached,
		ActionItems: []sdo.SummaryActionItemDTO{},
	}
	if !sum.SummarizedAt.IsZero() {
		out.SummarizedAt = sum.SummarizedAt.UTC().Format(time.RFC3339)
	}
	for _, item := range sum.ActionItems {
		out.ActionItems = append(out.ActionItems, sdo.SummaryActionItemDTO{
			Title: item.Title, Owner: item.Owner, Due: item.Due,
		})
	}
	return out
}

func (h *handlers) createEmailHubSummaryTasks(w http.ResponseWriter, r *http.Request) {
	var in sdi.EmailHubSummaryTasksSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	if in.AccountID == "" {
		respondError(w, http.StatusBadRequest, "invalid_request", "account_id is required")
		return
	}
	items := make([]service.SummaryTaskItem, 0, len(in.Items))
	for _, it := range in.Items {
		items = append(items, service.SummaryTaskItem{
			Title: it.Title, Description: it.Description, AssigneeID: it.AssigneeID, ProjectID: it.ProjectID,
			Priority: it.Priority, DueDate: it.DueDate, Owner: it.Owner, DueSpoken: it.DueSpoken,
		})
	}
	tasks, err := h.EmailHub.CreateTasksFromThreadSummary(
		r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), in.AccountID, chi.URLParam(r, "threadID"), items,
	)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	ids := make([]string, 0, len(tasks))
	for _, t := range tasks {
		ids = append(ids, t.ID)
	}
	respondJSON(w, http.StatusCreated, sdo.TaskIDListSDO{TaskIDs: ids})
}
