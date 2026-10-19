package handler

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
)

// putOfficeOfflineLease is PUT /documents/{documentID}/office/offline-lease
// (G5-08s): grant or renew the bearer device's offline lease. The handler
// hands the path id and the bearer's session to the service, which decides
// everything else.
func (h *handlers) putOfficeOfflineLease(w http.ResponseWriter, r *http.Request) {
	if h.OfficeLease == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "offline leases are not configured")
		return
	}
	var in sdi.PutOfficeOfflineLeaseSDI
	// An empty or absent body is a new grant (login-sync contract 6.2.1, G5-D1).
	emptyBodyAsObject(r)
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	lease, err := h.OfficeLease.Put(r.Context(), service.Human(middleware.UserID(r.Context())), service.OfficeLeasePutInput{
		DocumentID: chi.URLParam(r, "documentID"), DeviceSessionID: middleware.SessionID(r.Context()),
		Lease: strings.TrimSpace(in.Lease),
	})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondOfficeJSON(w, http.StatusOK, sdo.OfficeOfflineLeaseSDO{
		Lease: lease.Token, LeaseID: lease.LeaseID, DocumentID: lease.DocumentID,
		OrganizationID: lease.OrganizationID, WorkspaceID: lease.WorkspaceID,
		VersionID: lease.VersionID, Version: lease.Version, Revision: strconv.FormatInt(lease.Revision, 10),
		Level: lease.Level, PolicyEpoch: lease.PolicyEpoch, Generation: lease.Generation, Renewed: lease.Renewed,
		IssuedAt: lease.IssuedAt.UTC().Format(time.RFC3339), ExpiresAt: lease.ExpiresAt.UTC().Format(time.RFC3339),
		RenewAfter: lease.RenewAfter.UTC().Format(time.RFC3339), ServerTime: lease.ServerTime.UTC().Format(time.RFC3339),
	})
}

// deleteOfficeOfflineLease is DELETE /documents/{documentID}/office/offline-lease:
// the bearer device returns its lease. It works with the flag off.
func (h *handlers) deleteOfficeOfflineLease(w http.ResponseWriter, r *http.Request) {
	if h.OfficeLease == nil {
		respondError(w, http.StatusNotImplemented, "storage_unavailable", "offline leases are not configured")
		return
	}
	if err := h.OfficeLease.Release(r.Context(), service.Human(middleware.UserID(r.Context())),
		chi.URLParam(r, "documentID"), middleware.SessionID(r.Context())); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondOfficeJSON(w, http.StatusOK, sdo.StatusSDO{Status: "ok"})
}
