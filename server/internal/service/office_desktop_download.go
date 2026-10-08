package service

import (
	"context"
	"net/http"
	"net/url"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/config"
)

type OfficeDesktopDownload struct {
	InstallerURL       string
	Installers         []config.OfficeInstaller
	SupportedPlatforms []string
	ServerOrigin       string
	Channel            string
	ClientID           string
	DeploymentID       string
}

// Download policy belongs here, not in HTTP or in the audit-query service.
type OfficeDesktopDownloadService struct {
	orgs *OrganizationService
	cfg  config.Config
}

func NewOfficeDesktopDownloadService(orgs *OrganizationService, cfg config.Config) *OfficeDesktopDownloadService {
	return &OfficeDesktopDownloadService{orgs: orgs, cfg: cfg}
}

func (s *OfficeDesktopDownloadService) Get(ctx context.Context, userID, organizationID, channel string, selectedPlatform ...string) (OfficeDesktopDownload, error) {
	var out OfficeDesktopDownload
	if organizationID == "" {
		return out, Invalid("organization_id is required")
	}
	tx, err := s.orgs.pool.Begin(ctx)
	if err != nil {
		return out, err
	}
	defer tx.Rollback(ctx)
	q := s.orgs.q.WithTx(tx)
	// Do not reveal configured channels to a non-member or suspended account.
	if _, err := s.orgs.RequireMemberQ(ctx, q, organizationID, userID); err != nil {
		return out, err
	}
	// No channel asked means the deployment's own channel, never a guess.
	if channel == "" {
		channel = s.cfg.OfficeDesktopChannel()
	}
	if channel != "dev" && channel != "beta" && channel != "stable" {
		return out, Invalid("channel must be stable, beta, or dev")
	}
	platform := ""
	if len(selectedPlatform) > 0 {
		platform = selectedPlatform[0]
	}
	if platform != "" {
		known := false
		for _, key := range config.OfficeInstallerPlatforms {
			if key == platform {
				known = true
				break
			}
		}
		if !known {
			return out, Invalid("unsupported installer platform")
		}
	}
	installers, err := s.cfg.OfficeInstallers(channel)
	if err != nil {
		return out, coded(http.StatusServiceUnavailable, "office_download_unavailable", "desktop installer URLs are not configured safely")
	}
	if len(installers) == 0 {
		return out, coded(http.StatusNotFound, "installer_unavailable", "installer is not configured for this channel")
	}
	// Old clients only understand Windows. Do not point their singular URL at
	// a Mac/Linux artifact when this channel has no Windows installer.
	installer := ""
	for _, item := range installers {
		if item.Platform == "win32-x64" {
			installer = item.URL
			break
		}
	}
	if platform != "" {
		installer = ""
		for _, item := range installers {
			if item.Platform == platform {
				installer = item.URL
				break
			}
		}
		if installer == "" {
			return out, coded(http.StatusNotFound, "installer_unavailable", "installer is not configured for this platform and channel")
		}
	}
	if !validDesktopURL(s.cfg.APIPublicURL, channel, true) {
		return out, coded(http.StatusServiceUnavailable, "office_download_unavailable", "desktop download URLs are not configured safely")
	}
	clientID := config.OfficeDesktopClientID(channel)
	if s.cfg.DesktopAuthClientID != clientID || len(s.cfg.DesktopAuthDeploymentIDs) != 1 || strings.TrimSpace(s.cfg.DesktopAuthDeploymentIDs[0]) == "" {
		// Name the settings: the operator who reads this has installers
		// configured but a desktop client bound to a different channel.
		return out, coded(http.StatusServiceUnavailable, "office_download_unavailable", "desktop client or deployment binding is ambiguous: "+config.OfficeDesktopBindingHint(channel))
	}
	deploymentID := s.cfg.DesktopAuthDeploymentIDs[0]
	if !asciiAlphaNumeric(deploymentID[0]) || len(deploymentID) > 128 || strings.IndexFunc(deploymentID, func(r rune) bool {
		return !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '.' || r == '_' || r == '-')
	}) >= 0 {
		return out, coded(http.StatusServiceUnavailable, "office_download_unavailable", "desktop deployment binding is invalid")
	}
	out = OfficeDesktopDownload{InstallerURL: installer, Installers: installers, SupportedPlatforms: append([]string(nil), config.OfficeInstallerPlatforms...), ServerOrigin: strings.TrimRight(s.cfg.APIPublicURL, "/"), Channel: channel, ClientID: clientID, DeploymentID: deploymentID}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: organizationID, Actor: audit.User(userID), Action: audit.ActionOfficeDesktopDownloaded,
		ResourceType: "office_desktop_download", ResourceID: deploymentID,
		Metadata: map[string]any{"channel": channel, "deployment_id": deploymentID},
	}); err != nil {
		return OfficeDesktopDownload{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return OfficeDesktopDownload{}, err
	}
	return out, nil
}

func asciiAlphaNumeric(c byte) bool {
	return c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9'
}

func validDesktopURL(raw, channel string, originOnly bool) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Hostname() == "" || u.User != nil || u.Fragment != "" || u.RawQuery != "" {
		return false
	}
	loopback := u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1" || u.Hostname() == "::1"
	if u.Scheme != "https" && !(channel == "dev" && u.Scheme == "http" && loopback) {
		return false
	}
	return !originOnly || u.Path == "" || u.Path == "/"
}
