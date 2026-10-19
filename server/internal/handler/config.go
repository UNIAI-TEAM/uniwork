package handler

import (
	"net/http"
	"net/url"
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
	respondJSON(w, 200, sdo.ConfigSDO{
		Flags:                      featureflags.EvaluateFrontendPublicFlags(ctx, h.FeatureFlags),
		RumSampleRate:              h.Cfg.RUMSampleRate,
		WorkManagementCapabilities: workcapability.Catalogue(),
		OfficeInstallerURLs:        sdo.OfficeInstallerURLsSDO{Dev: h.Cfg.OfficeInstallerDevURL, Beta: h.Cfg.OfficeInstallerBetaURL, Stable: h.Cfg.OfficeInstallerStableURL},
		OfficeInstallers:           installerChannels(h.Cfg.OfficeInstallers),
		OfficeDeploymentID:         deploymentID,
		OfficeAPIOrigin:            officeAPIOrigin(h.Cfg.APIPublicURL),
		UniChatInstallers:          installerChannels(h.Cfg.UniChatInstallers),
		UniChatStores:              h.Cfg.UniChatStores(),
	})
}

// installerChannels publishes one catalogue per channel. Invalid configuration
// is hidden here as "nothing published"; Office's protected download endpoint
// reports configuration errors after checking organization membership.
func installerChannels(read func(channel string) ([]config.OfficeInstaller, error)) sdo.OfficeInstallerChannelsSDO {
	channel := func(name string) []config.OfficeInstaller {
		items, err := read(name)
		if err != nil || items == nil {
			return []config.OfficeInstaller{}
		}
		return items
	}
	return sdo.OfficeInstallerChannelsSDO{Dev: channel("dev"), Beta: channel("beta"), Stable: channel("stable")}
}

// officeAPIOrigin is the public deployment origin the web hands to the
// desktop app on every open link, or "" when the configured URL is not a bare
// http(s) origin. The app applies its own channel rule (HTTPS, or loopback
// HTTP on dev) before it stores the address.
func officeAPIOrigin(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return ""
	}
	return u.Scheme + "://" + u.Host
}
