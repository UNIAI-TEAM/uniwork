package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

func toActionItemDTO(v service.ActionItemView) sdo.MeetingActionItemDTO {
	it := v.Item
	d := sdo.MeetingActionItemDTO{
		ID: it.ID, Source: it.Source, Position: int(it.Position), Title: it.Title,
		OwnerText: it.OwnerText, DueText: it.DueText, Description: it.Description, SuggestedPriority: it.SuggestedPriority,
		SuggestedAssigneeID: v.SuggestedAssigneeID, SuggestedDueDate: v.SuggestedDueDate,
		Status: v.Status, DismissReason: it.DismissReason, DismissedBy: textPtr(it.DismissedBy),
		Evidence: toEvidenceRefsDTO(v.Evidence), SummaryID: textPtr(it.SummaryID), CreatedAt: rfc3339(it.CreatedAt),
	}
	if it.DismissedAt.Valid {
		at := rfc3339(it.DismissedAt)
		d.DismissedAt = &at
	}
	if t := v.Task; t != nil {
		d.Task = &sdo.MeetingActionItemTaskDTO{
			ID: t.ID, Title: t.Title, Status: t.Status, Done: t.Done, Overdue: t.Overdue, AssigneeID: t.AssigneeID, DueDate: t.DueDate,
		}
	}
	return d
}

func (h *handlers) listActionItems(w http.ResponseWriter, r *http.Request) {
	v, err := h.Meetings.ActionItems(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.MeetingActionItemsSDO{
		Items: make([]sdo.MeetingActionItemDTO, 0, len(v.Items)),
		Counts: sdo.MeetingActionItemCountsDTO{
			Pending: v.Counts.Pending, Converted: v.Counts.Converted, Dismissed: v.Counts.Dismissed,
			TasksDone: v.Counts.TasksDone, TasksOverdue: v.Counts.TasksOverdue,
		},
	}
	for _, it := range v.Items {
		out.Items = append(out.Items, toActionItemDTO(it))
	}
	respondJSON(w, 200, out)
}

func (h *handlers) addActionItem(w http.ResponseWriter, r *http.Request) {
	var in sdi.AddActionItemSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	v, err := h.Meetings.AddActionItem(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"),
		service.AddActionItemInput{Title: in.Title, OwnerText: in.OwnerText, DueText: in.DueText})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.MeetingActionItemSDO{Item: toActionItemDTO(v)})
}

func (h *handlers) dismissActionItem(w http.ResponseWriter, r *http.Request) {
	var in sdi.DismissActionItemSDI
	// The reason is optional, so no body at all is fine; any body, chunked
	// ones included, goes through decode and its size cap.
	if r.Body != http.NoBody && !decode(w, r, &in, maxJSONBody) {
		return
	}
	if err := h.Meetings.DismissActionItem(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"),
		chi.URLParam(r, "actionItemID"), in.Reason); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.StatusSDO{Status: "ok"})
}

func (h *handlers) restoreActionItem(w http.ResponseWriter, r *http.Request) {
	if err := h.Meetings.RestoreActionItem(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"),
		chi.URLParam(r, "actionItemID")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.StatusSDO{Status: "ok"})
}

func (h *handlers) convertActionItems(w http.ResponseWriter, r *http.Request) {
	var in sdi.ConvertActionItemsSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	items := make([]service.ConvertActionItem, 0, len(in.Items))
	for _, it := range in.Items {
		items = append(items, service.ConvertActionItem{
			ActionItemID: it.ActionItemID, Title: it.Title, Description: it.Description,
			AssigneeID: blankAsNil(it.AssigneeID), DueDate: blankAsNil(it.DueDate),
			ProjectID: it.ProjectID, Priority: it.Priority,
			Status: it.Status, AssigneeKind: it.AssigneeKind, StartDate: blankAsNil(it.StartDate), ParentTaskID: blankAsNil(it.ParentTaskID),
			Stage: it.Stage, LabelIDs: it.LabelIDs, AttachmentIDs: it.AttachmentIDs, Properties: it.Properties,
		})
	}
	links, err := h.Meetings.ConvertActionItems(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"), summaryLocale(in.Locale), items)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.ConvertActionItemsSDO{Links: make([]sdo.ActionItemLinkDTO, 0, len(links))}
	for _, l := range links {
		out.Links = append(out.Links, sdo.ActionItemLinkDTO{ActionItemID: l.ActionItemID, TaskID: l.TaskID})
	}
	respondJSON(w, 200, out)
}

func (h *handlers) listCarriedOverItems(w http.ResponseWriter, r *http.Request) {
	items, err := h.Meetings.CarriedOverItems(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "meetingID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.MeetingCarriedOverItemsSDO{Items: make([]sdo.MeetingCarriedOverItemDTO, 0, len(items))}
	for _, it := range items {
		t := it.Task
		out.Items = append(out.Items, sdo.MeetingCarriedOverItemDTO{
			ActionItemID: it.ActionItemID,
			Meeting:      sdo.MeetingCarriedOverMeetingDTO{ID: it.MeetingID, Title: it.MeetingTitle, StartedAt: rfc3339(it.MeetingStartedAt)},
			Task: sdo.MeetingActionItemTaskDTO{
				ID: t.ID, Title: t.Title, Status: t.Status, Done: t.Done, Overdue: t.Overdue, AssigneeID: t.AssigneeID, DueDate: t.DueDate,
			},
		})
	}
	respondJSON(w, 200, out)
}
