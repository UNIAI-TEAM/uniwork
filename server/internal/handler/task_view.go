package handler

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func viewTime(t pgtype.Timestamptz) string {
	if !t.Valid {
		return ""
	}
	return t.Time.UTC().Format("2006-01-02T15:04:05Z")
}

func textPtr(t pgtype.Text) *string {
	if !t.Valid {
		return nil
	}
	s := t.String
	return &s
}

func taskViewDTO(v db.TaskView) sdo.TaskViewDTO {
	return sdo.TaskViewDTO{
		ID: v.ID, OrganizationID: v.OrganizationID, WorkspaceID: v.WorkspaceID,
		OwnerID: v.OwnerID, Name: v.Name, ScopeType: v.ScopeType,
		ScopeID: textPtr(v.ScopeID), ScopeVariant: textPtr(v.ScopeVariant),
		Visibility: v.Visibility, DefinitionVersion: v.DefinitionVersion,
		Query: json.RawMessage(v.Query), Display: json.RawMessage(v.Display),
		Revision: v.Revision, CreatedAt: viewTime(v.CreatedAt), UpdatedAt: viewTime(v.UpdatedAt),
	}
}

func taskPinDTO(p db.TaskPin) sdo.TaskPinDTO {
	return sdo.TaskPinDTO{
		ID: p.ID, OrganizationID: p.OrganizationID, WorkspaceID: p.WorkspaceID,
		UserID: p.UserID, ItemType: p.ItemType, ItemID: p.ItemID, Position: p.Position,
		CreatedAt: viewTime(p.CreatedAt), UpdatedAt: viewTime(p.UpdatedAt),
	}
}

func (h *handlers) listTaskViews(w http.ResponseWriter, r *http.Request) {
	scopeType := r.URL.Query().Get("scope_type")
	var scopeID *string
	if raw := r.URL.Query().Get("scope_id"); raw != "" {
		scopeID = &raw
	}
	list, err := h.Tasks.ListTaskViews(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), scopeType, scopeID)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.TaskViewDTO, 0, len(list))
	for _, v := range list {
		out = append(out, taskViewDTO(v))
	}
	respondJSON(w, 200, sdo.TaskViewListSDO{Views: out, Total: len(out)})
}

func (h *handlers) createTaskView(w http.ResponseWriter, r *http.Request) {
	var in sdi.CreateTaskViewSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	view, err := h.Tasks.CreateTaskView(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), service.CreateTaskViewInput{
			Name: in.Name, ScopeType: in.ScopeType, ScopeID: in.ScopeID, ScopeVariant: in.ScopeVariant,
			Visibility: in.Visibility, DefinitionVersion: in.DefinitionVersion,
			Query: in.Query, Display: in.Display,
		})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 201, sdo.TaskViewSDO{View: taskViewDTO(view)})
}

func (h *handlers) getTaskView(w http.ResponseWriter, r *http.Request) {
	view, err := h.Tasks.GetTaskView(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), chi.URLParam(r, "id"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.TaskViewSDO{View: taskViewDTO(view)})
}

func (h *handlers) patchTaskView(w http.ResponseWriter, r *http.Request) {
	var in sdi.PatchTaskViewSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	view, err := h.Tasks.UpdateTaskView(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), chi.URLParam(r, "id"), service.UpdateTaskViewInput{
			Name: in.Name, Visibility: in.Visibility, ScopeVariant: in.ScopeVariant,
			Query: in.Query, Display: in.Display, ExpectedRevision: in.ExpectedRevision,
		})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.TaskViewSDO{View: taskViewDTO(view)})
}

func (h *handlers) deleteTaskView(w http.ResponseWriter, r *http.Request) {
	if err := h.Tasks.DeleteTaskView(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), chi.URLParam(r, "id")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.StatusSDO{Status: "ok"})
}

func (h *handlers) getTaskViewPreference(w http.ResponseWriter, r *http.Request) {
	scopeType := r.URL.Query().Get("scope_type")
	var scopeID *string
	if raw := r.URL.Query().Get("scope_id"); raw != "" {
		scopeID = &raw
	}
	pref, err := h.Tasks.GetTaskViewPreference(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), scopeType, scopeID)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.TaskViewPreferenceSDO{
		ScopeType: pref.ScopeType, ScopeID: pref.ScopeID, Prefs: pref.Prefs,
		UpdatedAt: viewTime(pref.UpdatedAt),
	})
}

func (h *handlers) putTaskViewPreference(w http.ResponseWriter, r *http.Request) {
	var in sdi.PutTaskViewPreferenceSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	pref, err := h.Tasks.PutTaskViewPreference(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), service.PutTaskViewPreferenceInput{
			ScopeType: in.ScopeType, ScopeID: in.ScopeID, Prefs: in.Prefs,
		})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.TaskViewPreferenceSDO{
		ScopeType: pref.ScopeType, ScopeID: pref.ScopeID, Prefs: pref.Prefs,
		UpdatedAt: viewTime(pref.UpdatedAt),
	})
}

func (h *handlers) listPins(w http.ResponseWriter, r *http.Request) {
	include := strings.Contains(r.URL.Query().Get("include"), "task_view")
	list, err := h.Tasks.ListPins(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), include)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.TaskPinDTO, 0, len(list))
	for _, p := range list {
		out = append(out, taskPinDTO(p))
	}
	respondJSON(w, 200, sdo.TaskPinListSDO{Pins: out, Total: len(out)})
}

func (h *handlers) createPin(w http.ResponseWriter, r *http.Request) {
	var in sdi.CreatePinSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	pin, err := h.Tasks.CreatePin(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), service.CreatePinInput{ItemType: in.ItemType, ItemID: in.ItemID})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 201, sdo.TaskPinSDO{Pin: taskPinDTO(pin)})
}

func (h *handlers) deletePin(w http.ResponseWriter, r *http.Request) {
	if err := h.Tasks.DeletePin(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), chi.URLParam(r, "itemType"), chi.URLParam(r, "itemID")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.StatusSDO{Status: "ok"})
}

func (h *handlers) reorderPins(w http.ResponseWriter, r *http.Request) {
	var in sdi.ReorderPinsSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	items := make([]service.ReorderPinItem, 0, len(in.Items))
	for _, it := range in.Items {
		items = append(items, service.ReorderPinItem{ID: it.ID, Position: it.Position})
	}
	if err := h.Tasks.ReorderPins(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), items); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.StatusSDO{Status: "ok"})
}
