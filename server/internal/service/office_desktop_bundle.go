package service

import (
	"archive/zip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"strings"
	"time"
)

const desktopInstallerMaxBytes int64 = 512 << 20

// A staged bundle owns its temporary installer. The handler closes it after
// streaming, including on a disconnected browser. No account token is sent to
// the configured release server, and redirects cannot widen its authority.
type OfficeDesktopBundle struct {
	installer *os.File
	filename  string
	profile   OfficeDesktopDownload
}

func (s *OfficeDesktopDownloadService) Bundle(ctx context.Context, profile OfficeDesktopDownload) (*OfficeDesktopBundle, error) {
	u, err := url.Parse(profile.InstallerURL)
	if err != nil || !validDesktopURL(profile.InstallerURL, profile.Channel, false) {
		return nil, Invalid("invalid installer URL")
	}
	ext := path.Ext(u.Path)
	switch ext {
	case ".exe", ".dmg", ".pkg", ".zip", ".deb", ".AppImage":
	default:
		return nil, coded(http.StatusServiceUnavailable, "installer_unavailable", "unsupported installer type")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, profile.InstallerURL, nil)
	if err != nil {
		return nil, err
	}
	client := &http.Client{Timeout: 2 * time.Minute, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return fmt.Errorf("installer redirects are refused") }}
	response, err := client.Do(request)
	if err != nil {
		return nil, coded(http.StatusBadGateway, "installer_unavailable", "installer download failed")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK || response.ContentLength > desktopInstallerMaxBytes {
		return nil, coded(http.StatusBadGateway, "installer_unavailable", "installer response is unavailable or too large")
	}
	file, err := os.CreateTemp("", "uniwork-installer-*")
	if err != nil {
		return nil, err
	}
	filename := path.Base(u.Path)
	if filename == "." || strings.ContainsAny(filename, "\\\r\n") {
		filename = "UniWork-Office-Setup" + ext
	}
	bundle := &OfficeDesktopBundle{installer: file, filename: filename, profile: profile}
	n, err := io.Copy(file, io.LimitReader(response.Body, desktopInstallerMaxBytes+1))
	if err != nil || n == 0 || n > desktopInstallerMaxBytes {
		_ = bundle.Close()
		return nil, coded(http.StatusBadGateway, "installer_unavailable", "installer download was incomplete")
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		_ = bundle.Close()
		return nil, err
	}
	return bundle, nil
}

func (b *OfficeDesktopBundle) Close() error {
	name := b.installer.Name()
	closeErr := b.installer.Close()
	removeErr := os.Remove(name)
	if closeErr != nil {
		return closeErr
	}
	return removeErr
}

func (b *OfficeDesktopBundle) WriteZipTo(w io.Writer) error {
	archive := zip.NewWriter(w)
	installer, err := archive.CreateHeader(&zip.FileHeader{Name: b.filename, Method: zip.Store})
	if err != nil {
		return err
	}
	if _, err := io.Copy(installer, b.installer); err != nil {
		return err
	}
	profile, err := archive.Create("deployment-profile.json")
	if err != nil {
		return err
	}
	// This local installer file intentionally uses the desktop profile schema,
	// not the API SDO. It contains only public deployment identity.
	if err := json.NewEncoder(profile).Encode(struct {
		DeploymentID string `json:"deploymentId"`
		APIOrigin    string `json:"apiOrigin"`
		ClientID     string `json:"clientId"`
		Channel      string `json:"channel"`
	}{b.profile.DeploymentID, b.profile.ServerOrigin, b.profile.ClientID, b.profile.Channel}); err != nil {
		return err
	}
	return archive.Close()
}
