package handler

import (
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

func (h *handlers) listPeople(w http.ResponseWriter, r *http.Request) {
	orgID, ok := h.orgIDFromSlug(w, r)
	if !ok {
		return
	}
	qs := r.URL.Query()
	limit, err := strconv.Atoi(qs.Get("limit"))
	if err != nil {
		limit = 0
	}
	page, err := h.People.Search(r.Context(), middleware.UserID(r.Context()), orgID, service.PeopleFilter{
		Query:        qs.Get("q"),
		DepartmentID: qs.Get("department_id"),
		ManagerID:    qs.Get("manager_id"),
		Role:         qs.Get("role"),
		Status:       qs.Get("status"),
		Cursor:       qs.Get("cursor"),
		Limit:        int32(limit),
	})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	people := make([]sdo.PersonDTO, 0, len(page.People))
	for _, p := range page.People {
		people = append(people, h.toPersonDTO(r, p))
	}
	respondJSON(w, http.StatusOK, sdo.PeopleListSDO{
		People: people, NextCursor: page.NextCursor, TotalActive: page.TotalActive,
	})
}

func (h *handlers) getPerson(w http.ResponseWriter, r *http.Request) {
	orgID, ok := h.orgIDFromSlug(w, r)
	if !ok {
		return
	}
	person, reports, err := h.People.Get(r.Context(), middleware.UserID(r.Context()), orgID, chi.URLParam(r, "userID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	h.respondPerson(w, r, person, reports)
}

func (h *handlers) patchPersonProfile(w http.ResponseWriter, r *http.Request) {
	var in sdi.ProfileSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	orgID, ok := h.orgIDFromSlug(w, r)
	if !ok {
		return
	}
	person, reports, err := h.People.UpdateProfileAndRead(r.Context(), middleware.UserID(r.Context()), orgID, chi.URLParam(r, "userID"),
		service.ProfileInput{
			Title: in.Title, DepartmentID: in.DepartmentID, ManagerID: in.ManagerID,
			EmployeeCode: in.EmployeeCode, Phone: in.Phone, PhoneVisible: in.PhoneVisible,
			Location: in.Location, Bio: in.Bio, JoinedOn: in.JoinedOn,
		})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	h.respondPerson(w, r, person, reports)
}

// exportPeople streams the directory as a CSV attachment. It is the one route
// in this tag with no JSON body, so it writes its own headers before the
// service starts streaming.
func (h *handlers) exportPeople(w http.ResponseWriter, r *http.Request) {
	orgID, ok := h.orgIDFromSlug(w, r)
	if !ok {
		return
	}
	// Authorize before a single byte goes out: once the 200 header is written
	// there is no way to turn the response into a 403.
	if err := h.People.RequireExporter(r.Context(), middleware.UserID(r.Context()), orgID); err != nil {
		h.mapServiceError(w, err)
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="people.csv"`)
	if _, err := h.People.ExportCSV(r.Context(), middleware.UserID(r.Context()), orgID, w); err != nil {
		h.Log.Error("people export", "err", err)
	}
}

func (h *handlers) respondPerson(w http.ResponseWriter, r *http.Request, p service.PersonView, reports []service.ActorInfo) {
	out := make([]sdo.ActorDTO, 0, len(reports))
	for _, a := range reports {
		out = append(out, sdo.ActorDTO{ID: a.ID, Kind: string(a.Kind), DisplayName: a.DisplayName, AvatarURL: a.AvatarURL})
	}
	respondJSON(w, http.StatusOK, sdo.PersonSDO{Person: h.toPersonDTO(r, p), Reports: out})
}

func (h *handlers) toPersonDTO(r *http.Request, p service.PersonView) sdo.PersonDTO {
	status := "active"
	if p.DeactivatedAt.Valid {
		status = "deactivated"
	}
	joined := ""
	if p.JoinedOn.Valid {
		joined = p.JoinedOn.Time.Format("2006-01-02")
	}
	dto := sdo.PersonDTO{
		UserID: p.UserID, DisplayName: p.DisplayName, Email: p.Email, AvatarURL: p.AvatarURL,
		OrgRole: p.Role, Status: status, Title: p.Title,
		EmployeeCode: p.EmployeeCode, Phone: p.Phone, PhoneVisible: p.PhoneVisible,
		Location: p.Location, Bio: p.Bio, JoinedOn: joined, Timezone: p.Timezone,
		DeactivatedAt: rfc3339(p.DeactivatedAt), IsSelf: p.IsSelf,
	}
	if p.DepartmentID != "" {
		dto.Department = &sdo.DepartmentRefDTO{ID: p.DepartmentID, Name: p.DepartmentName}
	}
	if p.ManagerID != "" {
		dto.Manager = h.actorDTO(r, p.ManagerID)
	}
	return dto
}

// actorDTO resolves one human actor for display. A lookup that fails leaves
// the field null rather than failing the whole response: a missing manager
// name is a worse reason to lose a profile than to show it incomplete.
func (h *handlers) actorDTO(r *http.Request, userID string) *sdo.ActorDTO {
	ref := service.ActorRef{Kind: audit.KindHuman, ID: userID}
	infos, err := h.Actors.Resolve(r.Context(), []service.ActorRef{ref})
	if err != nil {
		return nil
	}
	info, ok := infos[ref]
	if !ok {
		return nil
	}
	return &sdo.ActorDTO{ID: info.ID, Kind: string(info.Kind), DisplayName: info.DisplayName, AvatarURL: info.AvatarURL}
}
