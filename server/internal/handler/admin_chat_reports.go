package handler

import (
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The operator's queue of chat reports (store UGC policy, Apple 1.2): the
// platform console lists every organization's reports — ids, reason, status
// and time, never the content — and an admin closes one with a reason once it
// has been acted on.

func adminChatReportDTO(row db.AdminListChatReportsRow) sdo.AdminChatReportDTO {
	dto := sdo.AdminChatReportDTO{
		ID: row.ID, OrganizationID: row.OrganizationID, OrganizationSlug: row.OrganizationSlug,
		OrganizationName: row.OrganizationName, OrganizationStatus: row.OrganizationStatus,
		WorkspaceID: row.WorkspaceID, TargetUserID: row.TargetUserID, ReporterID: row.CreatedBy,
		Reason: row.Reason, Status: row.Status, CreatedAt: row.CreatedAt.Time.UTC().Format(time.RFC3339),
	}
	if row.RoomID.Valid {
		dto.RoomID = &row.RoomID.String
	}
	if row.MessageID.Valid {
		dto.MessageID = &row.MessageID.String
	}
	return dto
}

func (h *handlers) adminListChatReports(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	queue, err := h.Admin.ListChatReports(r.Context(), r.URL.Query().Get("status"), int32(limit), int32(offset))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.AdminChatReportListSDO{Reports: make([]sdo.AdminChatReportDTO, 0, len(queue.Reports)), Total: queue.Total, OpenCount: queue.OpenCount}
	for _, row := range queue.Reports {
		out.Reports = append(out.Reports, adminChatReportDTO(row))
	}
	if queue.OldestOpenAt != nil {
		at := queue.OldestOpenAt.UTC().Format(time.RFC3339)
		out.OldestOpenAt = &at
	}
	respondJSON(w, http.StatusOK, out)
}

func (h *handlers) adminResolveChatReport(w http.ResponseWriter, r *http.Request) {
	var in sdi.ReasonSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	row, err := h.Admin.ResolveChatReport(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "chatReportID"), in.Reason)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.AdminChatReportSDO{ID: row.ID, Status: row.Status})
}
