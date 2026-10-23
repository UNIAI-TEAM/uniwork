package handler

import (
	"github.com/go-chi/chi/v5"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
	"net/http"
	"strconv"
	"time"
)

func (h *handlers) createDemoRequest(w http.ResponseWriter, r *http.Request) {
	if h.DemoRequests == nil {
		respondError(w, http.StatusServiceUnavailable, "demo_requests_unavailable", "Demo request intake is unavailable")
		return
	}
	var in sdi.CreateDemoRequestSDI
	if !decode(w, r, &in, 16*1024) {
		return
	}
	id, err := h.DemoRequests.Create(r.Context(), service.CreateDemoRequestInput{FullName: in.FullName, WorkEmail: in.WorkEmail, CompanyName: in.CompanyName, TeamSize: in.TeamSize, Message: in.Message, Locale: in.Locale, RequestKey: r.Header.Get("Idempotency-Key")})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusCreated, sdo.DemoRequestReceiptSDO{RequestID: id})
}
func demoRequestDTO(row db.DemoRequest) sdo.DemoRequestDTO {
	return sdo.DemoRequestDTO{ID: row.ID, FullName: row.FullName, WorkEmail: row.WorkEmail, CompanyName: row.CompanyName, TeamSize: row.TeamSize, Message: row.Message, Locale: row.Locale, Status: row.Status, CreatedAt: row.CreatedAt.Time.Format(time.RFC3339), UpdatedAt: row.UpdatedAt.Time.Format(time.RFC3339)}
}
func (h *handlers) adminListDemoRequests(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	page, err := h.Admin.ListDemoRequests(r.Context(), r.URL.Query().Get("status"), int32(limit), int32(offset))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	rows := make([]sdo.DemoRequestDTO, 0, len(page.Requests))
	for _, row := range page.Requests {
		rows = append(rows, demoRequestDTO(row))
	}
	respondJSON(w, http.StatusOK, sdo.DemoRequestListSDO{Requests: rows, Total: page.Total})
}
func (h *handlers) adminUpdateDemoRequest(w http.ResponseWriter, r *http.Request) {
	var in sdi.UpdateDemoRequestSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	row, err := h.Admin.UpdateDemoRequest(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "demoRequestID"), in.Status, in.Reason)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.DemoRequestSDO{Request: demoRequestDTO(row)})
}
