package handler

import (
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// auditExportLinkTTL mirrors the expiry the service stamps on a finished
// export, so the two cannot describe different windows to the user.
const auditExportLinkTTL = 24 * time.Hour

func toAuditEventDTO(v service.AuditEventView) sdo.AuditEventDTO {
	out := sdo.AuditEventDTO{
		ID: v.ID, OrganizationID: v.OrganizationID,
		ActorKind: v.ActorKind, ActorID: v.ActorID,
		Action: v.Action, ResourceType: v.ResourceType, ResourceID: v.ResourceID,
		Changes: v.ChangesParsed, Metadata: v.MetadataParsed,
		CorrelationID: v.CorrelationID,
		OccurredAt:    v.OccurredAt.Time.UTC().Format(time.RFC3339),
		IPAddress:     v.IP,
	}
	if v.WorkspaceID.Valid {
		s := v.WorkspaceID.String
		out.WorkspaceID = &s
	}
	if v.UserAgent.Valid {
		s := v.UserAgent.String
		out.UserAgent = &s
	}
	return out
}

func (h *handlers) listAuditEvents(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	filter := service.AuditFilter{
		Before:       q.Get("before"),
		ActorID:      q.Get("actor_id"),
		Action:       q.Get("action"),
		ResourceType: q.Get("resource_type"),
		ResourceID:   q.Get("resource_id"),
		WorkspaceID:  q.Get("workspace_id"),
	}
	if n, err := strconv.Atoi(q.Get("limit")); err == nil {
		filter.Limit = int32(n)
	}
	if t, ok := parseRFC3339(q.Get("from")); ok {
		filter.From = &t
	}
	if t, ok := parseRFC3339(q.Get("to")); ok {
		filter.To = &t
	}
	events, err := h.Audit.List(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "orgID"), filter)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.AuditEventDTO, 0, len(events))
	for _, e := range events {
		out = append(out, toAuditEventDTO(e))
	}
	// The cursor is the last id on the page. A short page means the caller has
	// reached the end, so it gets no cursor rather than one that returns
	// nothing.
	next := ""
	if len(out) > 0 && int32(len(out)) == effectiveAuditLimit(filter.Limit) {
		next = out[len(out)-1].ID
	}
	respondJSON(w, http.StatusOK, sdo.AuditEventListSDO{Events: out, NextBefore: next})
}

func (h *handlers) getAuditEvent(w http.ResponseWriter, r *http.Request) {
	e, err := h.Audit.Get(r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "orgID"), chi.URLParam(r, "eventID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.AuditEventSDO{Event: toAuditEventDTO(e)})
}

func (h *handlers) listResourceHistory(w http.ResponseWriter, r *http.Request) {
	events, err := h.Audit.ResourceHistory(r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "workspaceID"), chi.URLParam(r, "resourceType"), chi.URLParam(r, "resourceID"), 0)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.AuditEventDTO, 0, len(events))
	for _, e := range events {
		out = append(out, toAuditEventDTO(e))
	}
	respondJSON(w, http.StatusOK, sdo.AuditEventListSDO{Events: out})
}

func (h *handlers) getAuditRetention(w http.ResponseWriter, r *http.Request) {
	days, err := h.Audit.Retention(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "orgID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.AuditRetentionSDO{RetainDays: days})
}

func (h *handlers) setAuditRetention(w http.ResponseWriter, r *http.Request) {
	var in sdi.SetAuditRetentionSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	days, err := h.Audit.SetRetention(r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "orgID"), in.RetainDays)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.AuditRetentionSDO{RetainDays: days})
}

func (h *handlers) listAuditExports(w http.ResponseWriter, r *http.Request) {
	exports, err := h.Audit.Exports(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "orgID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.AuditExportDTO, 0, len(exports))
	for _, e := range exports {
		out = append(out, h.toAuditExportDTO(e))
	}
	respondJSON(w, http.StatusOK, sdo.AuditExportListSDO{Exports: out})
}

func (h *handlers) createAuditExport(w http.ResponseWriter, r *http.Request) {
	var in sdi.CreateAuditExportSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	from, okFrom := parseRFC3339(in.From)
	to, okTo := parseRFC3339(in.To)
	if !okFrom || !okTo {
		respondError(w, http.StatusBadRequest, "invalid_request", "from và to phải theo RFC3339")
		return
	}
	exp, err := h.Audit.RequestExport(r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "orgID"), in.Format, from, to)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusAccepted, sdo.AuditExportSDO{Export: h.toAuditExportDTO(exp)})
}

func (h *handlers) getAuditExport(w http.ResponseWriter, r *http.Request) {
	exp, err := h.Audit.Export(r.Context(), middleware.UserID(r.Context()),
		chi.URLParam(r, "orgID"), chi.URLParam(r, "exportID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.AuditExportSDO{Export: h.toAuditExportDTO(exp)})
}

// toAuditExportDTO derives the status from the timestamps rather than storing
// a status column, so the two can never disagree.
func (h *handlers) toAuditExportDTO(e db.AuditExport) sdo.AuditExportDTO {
	out := sdo.AuditExportDTO{
		ID: e.ID, Format: e.Format, RowCount: e.RowCount,
		FromAt:    e.FromAt.Time.UTC().Format(time.RFC3339),
		ToAt:      e.ToAt.Time.UTC().Format(time.RFC3339),
		CreatedAt: e.CreatedAt.Time.UTC().Format(time.RFC3339),
		Status:    auditExportStatus(e),
	}
	if e.Error.Valid {
		msg := e.Error.String
		out.Error = &msg
	}
	if e.ExpiresAt.Valid {
		s := e.ExpiresAt.Time.UTC().Format(time.RFC3339)
		out.ExpiresAt = &s
	}
	if e.ObjectKey.Valid && h.Storage != nil && e.CompletedAt.Valid &&
		time.Since(e.CompletedAt.Time) < auditExportLinkTTL {
		url := h.Storage.ObjectURL(e.ObjectKey.String)
		out.DownloadURL = &url
	}
	return out
}

func auditExportStatus(e db.AuditExport) string {
	switch {
	case e.FailedAt.Valid:
		return "failed"
	case e.CompletedAt.Valid:
		return "done"
	case e.StartedAt.Valid:
		return "running"
	default:
		return "pending"
	}
}

func effectiveAuditLimit(requested int32) int32 {
	if requested <= 0 || requested > service.AuditPageMax {
		return service.AuditPageMax
	}
	return requested
}

func parseRFC3339(s string) (time.Time, bool) {
	if s == "" {
		return time.Time{}, false
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return time.Time{}, false
	}
	return t, true
}
