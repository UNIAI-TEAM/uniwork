package handler

import (
	"net/http"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
)

func (h *handlers) officeDesktopDownload(w http.ResponseWriter, r *http.Request) {
	orgID := strings.TrimSpace(r.URL.Query().Get("organization_id"))
	if orgID == "" {
		respondError(w, http.StatusBadRequest, "invalid_request", "organization_id is required")
		return
	}
	channel := strings.TrimSpace(r.URL.Query().Get("channel"))
	if channel == "" {
		channel = "stable"
	}
	var installer string
	switch channel {
	case "dev":
		installer = h.Cfg.OfficeInstallerDevURL
	case "beta":
		installer = h.Cfg.OfficeInstallerBetaURL
	case "stable":
		installer = h.Cfg.OfficeInstallerStableURL
	default:
		respondError(w, http.StatusBadRequest, "invalid_request", "channel must be stable, beta, or dev")
		return
	}
	if installer == "" {
		respondError(w, http.StatusNotFound, "installer_unavailable", "installer is not configured for this channel")
		return
	}
	deploymentID := "default"
	for _, candidate := range h.Cfg.DesktopAuthDeploymentIDs {
		if value := strings.TrimSpace(candidate); value != "" {
			deploymentID = value
			break
		}
	}
	if h.Audit == nil {
		respondError(w, http.StatusServiceUnavailable, "office_download_unavailable", "desktop download profile is not configured")
		return
	}
	if err := h.Audit.RecordOfficeDesktopDownload(r.Context(), middleware.UserID(r.Context()), orgID, channel, deploymentID); err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, http.StatusOK, sdo.OfficeDesktopDownloadSDO{InstallerURL: installer, ServerOrigin: strings.TrimRight(h.Cfg.APIPublicURL, "/"), Channel: channel, ClientID: h.Cfg.DesktopAuthClientID, DeploymentID: deploymentID})
}
