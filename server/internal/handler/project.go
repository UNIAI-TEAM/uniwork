package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func projectDate(d pgtype.Date) *string {
	if !d.Valid {
		return nil
	}
	s := d.Time.UTC().Format("2006-01-02")
	return &s
}

func projectDTO(p db.Project, stats service.ProjectView) sdo.ProjectDTO {
	return sdo.ProjectDTO{
		ID: p.ID, OrganizationID: p.OrganizationID, WorkspaceID: p.WorkspaceID,
		Title: p.Title, Description: p.Description, Icon: textPtr(p.Icon),
		Status: p.Status, Priority: p.Priority, LeadType: textPtr(p.LeadType), LeadID: textPtr(p.LeadID),
		StartDate: projectDate(p.StartDate), DueDate: projectDate(p.DueDate),
		Revision: p.Revision, TaskCount: stats.TaskCount, DoneCount: stats.DoneCount,
		ResourceCount: stats.ResourceCount,
		CreatedAt:     viewTime(p.CreatedAt), UpdatedAt: viewTime(p.UpdatedAt),
	}
}

func projectResourceDTO(r db.ProjectResource) sdo.ProjectResourceDTO {
	ref := json.RawMessage(r.ResourceRef)
	if len(ref) == 0 {
		ref = json.RawMessage("{}")
	}
	return sdo.ProjectResourceDTO{
		ID: r.ID, ProjectID: r.ProjectID, WorkspaceID: r.WorkspaceID,
		ResourceType: r.ResourceType, ResourceRef: ref, Label: textPtr(r.Label),
		Position: r.Position, CreatedAt: viewTime(r.CreatedAt), UpdatedAt: viewTime(r.UpdatedAt),
	}
}

func (h *handlers) listProjects(w http.ResponseWriter, r *http.Request) {
	actor := service.Human(middleware.UserID(r.Context()))
	wsID := chi.URLParam(r, "workspaceID")
	filter := service.ListProjectsFilter{}
	if s := r.URL.Query().Get("status"); s != "" {
		filter.Status = &s
	}
	if p := r.URL.Query().Get("priority"); p != "" {
		filter.Priority = &p
	}
	list, err := h.Tasks.ListProjects(r.Context(), actor, wsID, filter)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	stats, err := h.Tasks.ProjectStats(r.Context(), actor, wsID, list)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.ProjectDTO, 0, len(list))
	for _, p := range list {
		out = append(out, projectDTO(p, stats[p.ID]))
	}
	respondJSON(w, 200, sdo.ProjectListSDO{Projects: out, Total: len(out)})
}

func (h *handlers) searchProjects(w http.ResponseWriter, r *http.Request) {
	actor := service.Human(middleware.UserID(r.Context()))
	wsID := chi.URLParam(r, "workspaceID")
	in := service.SearchProjectsInput{
		Q: r.URL.Query().Get("q"), IncludeClosed: r.URL.Query().Get("include_closed") == "true",
	}
	if lim := r.URL.Query().Get("limit"); lim != "" {
		if v, err := strconv.Atoi(lim); err == nil {
			in.Limit = int32(v)
		}
	}
	if off := r.URL.Query().Get("offset"); off != "" {
		if v, err := strconv.Atoi(off); err == nil {
			in.Offset = int32(v)
		}
	}
	list, total, err := h.Tasks.SearchProjects(r.Context(), actor, wsID, in)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	stats, err := h.Tasks.ProjectStats(r.Context(), actor, wsID, list)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.ProjectDTO, 0, len(list))
	for _, p := range list {
		out = append(out, projectDTO(p, stats[p.ID]))
	}
	respondJSON(w, 200, sdo.ProjectListSDO{Projects: out, Total: int(total)})
}

func (h *handlers) createProject(w http.ResponseWriter, r *http.Request) {
	var in sdi.CreateProjectSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	actor := service.Human(middleware.UserID(r.Context()))
	wsID := chi.URLParam(r, "workspaceID")
	resources := make([]service.CreateProjectResourceInput, 0, len(in.Resources))
	for _, res := range in.Resources {
		resources = append(resources, service.CreateProjectResourceInput{
			ResourceType: res.ResourceType, ResourceRef: res.ResourceRef,
			Label: res.Label, Position: res.Position,
		})
	}
	project, err := h.Tasks.CreateProject(r.Context(), actor, wsID, service.CreateProjectInput{
		Title: in.Title, Description: in.Description, Icon: in.Icon,
		Status: in.Status, Priority: in.Priority, LeadType: in.LeadType, LeadID: in.LeadID,
		StartDate: in.StartDate, DueDate: in.DueDate, Resources: resources,
		CreateChannel: in.CreateChannel,
	})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	stats, err := h.Tasks.ProjectStats(r.Context(), actor, wsID, []db.Project{project})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 201, sdo.ProjectSDO{Project: projectDTO(project, stats[project.ID])})
}

func (h *handlers) getProject(w http.ResponseWriter, r *http.Request) {
	actor := service.Human(middleware.UserID(r.Context()))
	wsID := chi.URLParam(r, "workspaceID")
	project, err := h.Tasks.GetProject(r.Context(), actor, wsID, chi.URLParam(r, "projectID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	stats, err := h.Tasks.ProjectStats(r.Context(), actor, wsID, []db.Project{project})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.ProjectSDO{Project: projectDTO(project, stats[project.ID])})
}

func (h *handlers) putProject(w http.ResponseWriter, r *http.Request) {
	var raw map[string]json.RawMessage
	if !decode(w, r, &raw, maxJSONBody) {
		return
	}
	in, err := parsePutProject(raw)
	if err != nil {
		respondError(w, 400, "invalid_request", err.Error())
		return
	}
	var bodyRev *int64
	if v, ok := raw["revision"]; ok && string(v) != "null" {
		var n int64
		if err := json.Unmarshal(v, &n); err != nil {
			respondError(w, 400, "invalid_request", "revision phải là số")
			return
		}
		bodyRev = &n
	}
	rev, err := resolveTaskRevision(r.Header.Get("If-Match"), bodyRev)
	if err != nil {
		respondError(w, 400, "invalid_request", err.Error())
		return
	}
	if rev == nil {
		respondError(w, 400, "invalid_request", "revision hoặc If-Match là bắt buộc")
		return
	}
	in.ExpectedRevision = *rev
	actor := service.Human(middleware.UserID(r.Context()))
	wsID := chi.URLParam(r, "workspaceID")
	project, err := h.Tasks.UpdateProject(r.Context(), actor, wsID, chi.URLParam(r, "projectID"), in)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	stats, err := h.Tasks.ProjectStats(r.Context(), actor, wsID, []db.Project{project})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.ProjectSDO{Project: projectDTO(project, stats[project.ID])})
}

func parsePutProject(raw map[string]json.RawMessage) (service.UpdateProjectInput, error) {
	var in service.UpdateProjectInput
	str := func(k string) (*string, error) {
		v, ok := raw[k]
		if !ok {
			return nil, nil
		}
		var s string
		if err := json.Unmarshal(v, &s); err != nil {
			return nil, fmt.Errorf("%s phải là chuỗi", k)
		}
		return &s, nil
	}
	nullable := func(k string) (**string, error) {
		v, ok := raw[k]
		if !ok {
			return nil, nil
		}
		if string(v) == "null" {
			var p *string
			return &p, nil
		}
		var s string
		if err := json.Unmarshal(v, &s); err != nil {
			return nil, fmt.Errorf("%s phải là chuỗi hoặc null", k)
		}
		p := &s
		return &p, nil
	}
	var err error
	if in.Title, err = str("title"); err != nil {
		return in, err
	}
	if in.Description, err = str("description"); err != nil {
		return in, err
	}
	if in.Icon, err = str("icon"); err != nil {
		return in, err
	}
	if in.Status, err = str("status"); err != nil {
		return in, err
	}
	if in.Priority, err = str("priority"); err != nil {
		return in, err
	}
	if in.LeadType, err = nullable("lead_type"); err != nil {
		return in, err
	}
	if in.LeadID, err = nullable("lead_id"); err != nil {
		return in, err
	}
	if in.StartDate, err = nullable("start_date"); err != nil {
		return in, err
	}
	if in.DueDate, err = nullable("due_date"); err != nil {
		return in, err
	}
	return in, nil
}

func (h *handlers) deleteProject(w http.ResponseWriter, r *http.Request) {
	if err := h.Tasks.DeleteProject(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), chi.URLParam(r, "projectID")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.StatusSDO{Status: "ok"})
}

func (h *handlers) listProjectResources(w http.ResponseWriter, r *http.Request) {
	list, err := h.Tasks.ListProjectResources(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), chi.URLParam(r, "projectID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.ProjectResourceDTO, 0, len(list))
	for _, row := range list {
		out = append(out, projectResourceDTO(row))
	}
	respondJSON(w, 200, sdo.ProjectResourceListSDO{Resources: out, Total: len(out)})
}

func (h *handlers) createProjectResource(w http.ResponseWriter, r *http.Request) {
	var in sdi.CreateProjectResourceSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	row, err := h.Tasks.CreateProjectResource(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), chi.URLParam(r, "projectID"), service.CreateProjectResourceInput{
			ResourceType: in.ResourceType, ResourceRef: in.ResourceRef, Label: in.Label, Position: in.Position,
		})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 201, sdo.ProjectResourceSDO{Resource: projectResourceDTO(row)})
}

func (h *handlers) putProjectResource(w http.ResponseWriter, r *http.Request) {
	var in sdi.PutProjectResourceSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	row, err := h.Tasks.UpdateProjectResource(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), chi.URLParam(r, "projectID"), chi.URLParam(r, "resourceID"),
		service.UpdateProjectResourceInput{ResourceRef: in.ResourceRef, Label: in.Label, Position: in.Position})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.ProjectResourceSDO{Resource: projectResourceDTO(row)})
}

func (h *handlers) deleteProjectResource(w http.ResponseWriter, r *http.Request) {
	if err := h.Tasks.DeleteProjectResource(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "workspaceID"), chi.URLParam(r, "projectID"), chi.URLParam(r, "resourceID")); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.StatusSDO{Status: "ok"})
}
