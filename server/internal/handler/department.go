package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func (h *handlers) listDepartments(w http.ResponseWriter, r *http.Request) {
	orgID, ok := h.orgIDFromSlug(w, r)
	if !ok {
		return
	}
	rows, err := h.Departments.List(r.Context(), middleware.UserID(r.Context()), orgID,
		r.URL.Query().Get("include_archived") == "true")
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	h.respondDepartmentList(w, r, rows)
}

func (h *handlers) createDepartment(w http.ResponseWriter, r *http.Request) {
	var in sdi.DepartmentSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	orgID, ok := h.orgIDFromSlug(w, r)
	if !ok {
		return
	}
	d, err := h.Departments.Create(r.Context(), middleware.UserID(r.Context()), orgID, departmentInput(in))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusCreated, sdo.DepartmentSDO{Department: h.toDepartmentDTO(r, d, 0)})
}

func (h *handlers) patchDepartment(w http.ResponseWriter, r *http.Request) {
	var in sdi.DepartmentSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	orgID, ok := h.orgIDFromSlug(w, r)
	if !ok {
		return
	}
	d, err := h.Departments.Update(r.Context(), middleware.UserID(r.Context()), orgID, chi.URLParam(r, "departmentId"), departmentInput(in))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.DepartmentSDO{Department: h.toDepartmentDTO(r, d, 0)})
}

func (h *handlers) archiveDepartment(w http.ResponseWriter, r *http.Request) {
	orgID, ok := h.orgIDFromSlug(w, r)
	if !ok {
		return
	}
	d, err := h.Departments.Archive(r.Context(), middleware.UserID(r.Context()), orgID, chi.URLParam(r, "departmentId"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.DepartmentSDO{Department: h.toDepartmentDTO(r, d, 0)})
}

func (h *handlers) reorderDepartments(w http.ResponseWriter, r *http.Request) {
	var in sdi.DepartmentOrderSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	orgID, ok := h.orgIDFromSlug(w, r)
	if !ok {
		return
	}
	rows, err := h.Departments.Reorder(r.Context(), middleware.UserID(r.Context()), orgID, in.IDs)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	h.respondDepartmentList(w, r, rows)
}

func (h *handlers) respondDepartmentList(w http.ResponseWriter, r *http.Request, rows []db.ListDepartmentsRow) {
	out := make([]sdo.DepartmentDTO, 0, len(rows))
	for _, d := range rows {
		out = append(out, h.toDepartmentDTO(r, db.Department{
			ID: d.ID, OrganizationID: d.OrganizationID, ParentID: d.ParentID, Name: d.Name,
			Code: d.Code, HeadUserID: d.HeadUserID, SortOrder: d.SortOrder, ArchivedAt: d.ArchivedAt,
		}, d.MemberCount))
	}
	respondJSON(w, http.StatusOK, sdo.DepartmentListSDO{Departments: out})
}

func (h *handlers) toDepartmentDTO(r *http.Request, d db.Department, memberCount int64) sdo.DepartmentDTO {
	out := sdo.DepartmentDTO{
		ID: d.ID, Name: d.Name, Code: pgText(d.Code), ParentID: pgText(d.ParentID),
		MemberCount: memberCount, SortOrder: d.SortOrder, ArchivedAt: rfc3339(d.ArchivedAt),
	}
	if d.HeadUserID.Valid {
		out.Head = h.actorDTO(r, d.HeadUserID.String)
	}
	return out
}

func departmentInput(in sdi.DepartmentSDI) service.DepartmentInput {
	return service.DepartmentInput{Name: in.Name, Code: in.Code, ParentID: in.ParentID, HeadUserID: in.HeadUserID}
}
