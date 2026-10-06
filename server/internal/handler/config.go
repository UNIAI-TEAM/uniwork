package handler

import (
	"net/http"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/config"

	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/workcapability"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// config is GET /api/v1/config: the public flags for the caller (anonymous or
// signed in, optionally in an organization), the RUM sample rate, and the
// Work Management capability catalogue. Flags never grant anything —
// permission stays in the services — so the organization id in the query is
// trusted as a targeting hint only.
func (h *handlers) config(w http.ResponseWriter, r *http.Request) {
	ec := featureflag.EvalContext{UserID: middleware.UserID(r.Context()), OrganizationID: r.URL.Query().Get("organization_id")}
	ctx := featureflag.WithEvalContext(r.Context(), ec)
	deploymentID := "default"
	for _, candidate := range h.Cfg.DesktopAuthDeploymentIDs {
		if trimmed := strings.TrimSpace(candidate); trimmed != "" {
			deploymentID = trimmed
			break
		}
	}
	// Hide invalid configuration here; the protected download endpoint reports
	// configuration errors after checking organization membership.
	dev, err := h.Cfg.OfficeInstallers("dev")
	if err != nil || dev == nil {
		dev = []config.OfficeInstaller{}
	}
	beta, err := h.Cfg.OfficeInstallers("beta")
	if err != nil || beta == nil {
		beta = []config.OfficeInstaller{}
	}
	stable, err := h.Cfg.OfficeInstallers("stable")
	if err != nil || stable == nil {
		stable = []config.OfficeInstaller{}
	}
	respondJSON(w, 200, sdo.ConfigSDO{
		Flags:                      featureflags.EvaluateFrontendPublicFlags(ctx, h.FeatureFlags),
		RumSampleRate:              h.Cfg.RUMSampleRate,
		WorkManagementCapabilities: workcapability.Catalogue(),
		OfficeInstallerURLs:        sdo.OfficeInstallerURLsSDO{Dev: h.Cfg.OfficeInstallerDevURL, Beta: h.Cfg.OfficeInstallerBetaURL, Stable: h.Cfg.OfficeInstallerStableURL},
		OfficeInstallers:           sdo.OfficeInstallerChannelsSDO{Dev: dev, Beta: beta, Stable: stable},
		OfficeDeploymentID:         deploymentID,
	})
}
