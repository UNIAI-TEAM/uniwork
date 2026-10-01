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
	InstallerURL string
	ServerOrigin string
	Channel      string
	ClientID     string
	DeploymentID string
}

// Download policy belongs here, not in HTTP or in the audit-query service.
type OfficeDesktopDownloadService struct {
	orgs *OrganizationService
	cfg  config.Config
}

func NewOfficeDesktopDownloadService(orgs *OrganizationService, cfg config.Config) *OfficeDesktopDownloadService {
	return &OfficeDesktopDownloadService{orgs: orgs, cfg: cfg}
}

func (s *OfficeDesktopDownloadService) Get(ctx context.Context, userID, organizationID, channel string) (OfficeDesktopDownload, error) {
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
	if channel == "" {
		channel = "stable"
	}
	var installer string
	switch channel {
	case "dev":
		installer = s.cfg.OfficeInstallerDevURL
	case "beta":
		installer = s.cfg.OfficeInstallerBetaURL
	case "stable":
		installer = s.cfg.OfficeInstallerStableURL
	default:
		return out, Invalid("channel must be stable, beta, or dev")
	}
	if installer == "" {
		return out, coded(http.StatusNotFound, "installer_unavailable", "installer is not configured for this channel")
	}
	if !validDesktopURL(installer, channel, false) || !validDesktopURL(s.cfg.APIPublicURL, channel, true) {
		return out, coded(http.StatusServiceUnavailable, "office_download_unavailable", "desktop download URLs are not configured safely")
	}
	clientID := "uniwork-office"
	if channel == "dev" {
		clientID += "-dev"
	}
	if s.cfg.DesktopAuthClientID != clientID || len(s.cfg.DesktopAuthDeploymentIDs) != 1 || strings.TrimSpace(s.cfg.DesktopAuthDeploymentIDs[0]) == "" {
		return out, coded(http.StatusServiceUnavailable, "office_download_unavailable", "desktop client or deployment binding is ambiguous")
	}
	deploymentID := s.cfg.DesktopAuthDeploymentIDs[0]
	if !asciiAlphaNumeric(deploymentID[0]) || len(deploymentID) > 128 || strings.IndexFunc(deploymentID, func(r rune) bool {
		return !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '.' || r == '_' || r == '-')
	}) >= 0 {
		return out, coded(http.StatusServiceUnavailable, "office_download_unavailable", "desktop deployment binding is invalid")
	}
	out = OfficeDesktopDownload{InstallerURL: installer, ServerOrigin: strings.TrimRight(s.cfg.APIPublicURL, "/"), Channel: channel, ClientID: clientID, DeploymentID: deploymentID}
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
