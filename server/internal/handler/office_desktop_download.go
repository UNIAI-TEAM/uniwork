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
	in := sdi.OfficeDesktopDownloadSDI{OrganizationID: strings.TrimSpace(r.URL.Query().Get("organization_id")), Channel: r.URL.Query().Get("channel"), Bundle: r.URL.Query().Get("bundle") == "true", Platform: r.URL.Query().Get("platform")}
	if in.Bundle && in.Platform == "" {
		in.Platform = "win32-x64"
	}
	out, err := h.OfficeDesktopDownload.Get(r.Context(), middleware.UserID(r.Context()), in.OrganizationID, in.Channel, in.Platform)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	if in.Bundle {
		bundle, err := h.OfficeDesktopDownload.Bundle(r.Context(), out)
		if err != nil {
			h.mapServiceError(w, err)
			return
		}
		defer func() {
			if err := bundle.Close(); err != nil {
				h.Log.Error("desktop bundle cleanup failed", "error", err)
			}
		}()
		w.Header().Set("Content-Type", "application/zip")
		w.Header().Set("Content-Disposition", `attachment; filename="UniWork-Office.zip"`)
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if err := bundle.WriteZipTo(w); err != nil {
			h.Log.Error("desktop bundle stream failed", "error", err)
		}
		return
	}
	respondJSON(w, http.StatusOK, sdo.OfficeDesktopDownloadSDO{InstallerURL: out.InstallerURL, Installers: out.Installers, SupportedPlatforms: out.SupportedPlatforms, ServerOrigin: out.ServerOrigin, Channel: out.Channel, ClientID: out.ClientID, DeploymentID: out.DeploymentID})
}
