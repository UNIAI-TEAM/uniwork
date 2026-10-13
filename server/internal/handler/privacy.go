package handler

import (
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func (h *handlers) listPrivacyExports(w http.ResponseWriter, r *http.Request) {
	if h.Privacy == nil {
		respondError(w, http.StatusServiceUnavailable, "privacy_unavailable", "xuất dữ liệu chưa khả dụng")
		return
	}
	rows, err := h.Privacy.Exports(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "orgID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.PrivacyExportDTO, 0, len(rows))
	for _, row := range rows {
		out = append(out, toPrivacyExportDTO(row))
	}
	respondJSON(w, http.StatusOK, sdo.PrivacyExportListSDO{Exports: out})
}

func (h *handlers) createPrivacyExport(w http.ResponseWriter, r *http.Request) {
	if h.Privacy == nil {
		respondError(w, http.StatusServiceUnavailable, "privacy_unavailable", "xuất dữ liệu chưa khả dụng")
		return
	}
	row, err := h.Privacy.RequestExport(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "orgID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusAccepted, sdo.PrivacyExportSDO{Export: toPrivacyExportDTO(row)})
}

func (h *handlers) createPrivacyDeletion(w http.ResponseWriter, r *http.Request) {
	if h.Privacy == nil {
		respondError(w, http.StatusServiceUnavailable, "privacy_unavailable", "xuất dữ liệu chưa khả dụng")
		return
	}
	var in sdi.CreatePrivacyDeletionSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	row, err := h.Privacy.RequestDeletion(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "orgID"), in.ConfirmSlug)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusAccepted, sdo.PrivacyExportSDO{Export: toPrivacyExportDTO(row)})
}

func (h *handlers) cancelPrivacyDeletion(w http.ResponseWriter, r *http.Request) {
	if h.Privacy == nil {
		respondError(w, http.StatusServiceUnavailable, "privacy_unavailable", "xuất dữ liệu chưa khả dụng")
		return
	}
	row, err := h.Privacy.CancelDeletion(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "orgID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.PrivacyExportSDO{Export: toPrivacyExportDTO(row)})
}

func (h *handlers) getPrivacyExport(w http.ResponseWriter, r *http.Request) {
	if h.Privacy == nil {
		respondError(w, http.StatusServiceUnavailable, "privacy_unavailable", "xuất dữ liệu chưa khả dụng")
		return
	}
	row, err := h.Privacy.Export(r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "orgID"), chi.URLParam(r, "privacyExportID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.PrivacyExportSDO{Export: toPrivacyExportDTO(row)})
}

func (h *handlers) downloadPrivacyExport(w http.ResponseWriter, r *http.Request) {
	if h.Privacy == nil {
		respondError(w, http.StatusServiceUnavailable, "privacy_unavailable", "xuất dữ liệu chưa khả dụng")
		return
	}
	exp, err := h.Privacy.DownloadExport(r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "orgID"), chi.URLParam(r, "privacyExportID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	defer exp.Reader.Close()
	w.Header().Set("Content-Type", exp.ContentType)
	w.Header().Set("Content-Length", strconv.FormatInt(exp.Reader.File.SizeBytes, 10))
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename=%q`, exp.Filename))
	if _, err := io.Copy(w, exp.Reader.Body); err != nil {
		h.Log.Error("privacy export stream", "err", err, "request_id", chi.URLParam(r, "privacyExportID"))
	}
}

func toPrivacyExportDTO(row db.DataSubjectRequest) sdo.PrivacyExportDTO {
	out := sdo.PrivacyExportDTO{
		ID: row.ID, Kind: row.Kind, RowCount: row.RowCount,
		CreatedAt: row.CreatedAt.Time.UTC().Format(time.RFC3339),
		Status:    privacyExportStatus(row),
	}
	if row.Error.Valid {
		msg := row.Error.String
		out.Error = &msg
	}
	if row.ExpiresAt.Valid {
		s := row.ExpiresAt.Time.UTC().Format(time.RFC3339)
		out.ExpiresAt = &s
	}
	if row.EraseAt.Valid {
		s := row.EraseAt.Time.UTC().Format(time.RFC3339)
		out.ErasesAt = &s
	}
	if row.FileID.Valid && row.ExpiresAt.Valid && time.Now().Before(row.ExpiresAt.Time) {
		url := fmt.Sprintf("/api/v1/orgs/%s/privacy/exports/%s/download", row.OrganizationID, row.ID)
		out.DownloadURL = &url
	}
	return out
}

func privacyExportStatus(row db.DataSubjectRequest) string {
	switch {
	case row.CancelledAt.Valid:
		return "cancelled"
	case row.FailedAt.Valid:
		return "failed"
	case row.CompletedAt.Valid:
		return "done"
	case row.StartedAt.Valid:
		return "running"
	case row.Kind == "delete" && row.EraseAt.Valid:
		return "scheduled"
	default:
		return "pending"
	}
}
