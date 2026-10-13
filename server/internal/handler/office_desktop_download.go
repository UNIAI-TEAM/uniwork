package handler

import (
	"net/http"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
)

func (h *handlers) officeDesktopDownload(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if h.OfficeDesktopDownload == nil {
		respondError(w, http.StatusServiceUnavailable, "office_download_unavailable", "desktop download profile is not configured")
		return
	}
	in := sdi.OfficeDesktopDownloadSDI{OrganizationID: strings.TrimSpace(r.URL.Query().Get("organization_id")), Channel: r.URL.Query().Get("channel"), Platform: r.URL.Query().Get("platform")}
	out, err := h.OfficeDesktopDownload.Get(r.Context(), middleware.UserID(r.Context()), in.OrganizationID, in.Channel, in.Platform)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.OfficeDesktopDownloadSDO{InstallerURL: out.InstallerURL, Installers: out.Installers, SupportedPlatforms: out.SupportedPlatforms, ServerOrigin: out.ServerOrigin, Channel: out.Channel, ClientID: out.ClientID, DeploymentID: out.DeploymentID})
}
