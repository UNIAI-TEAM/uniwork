package config

import (
	"encoding/json"
	"fmt"
	"net/url"
	"path"
	"regexp"
	"strings"
)

// The ordered platform contract is mirrored by core's pure installer registry.
var OfficeInstallerPlatforms = []string{"win32-x64", "win32-x64-zip", "darwin-arm64", "darwin-x64", "linux-x64-deb", "linux-x64-appimage"}
var installerKinds = map[string]string{"win32-x64": ".exe", "win32-x64-zip": ".zip", "darwin-arm64": ".dmg", "darwin-x64": ".dmg", "linux-x64-deb": ".deb", "linux-x64-appimage": ".AppImage"}
var installerVersion = regexp.MustCompile(`_([0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?)_`)

type OfficeInstaller struct {
	Platform     string `json:"platform" description:"Khóa nền tảng của bản cài" example:"linux-x64-deb"`
	URL          string `json:"url" description:"URL bộ cài an toàn theo kênh" example:"https://downloads.example/office.deb"`
	Kind         string `json:"kind" description:"Định dạng tệp bộ cài" example:".deb"`
	Version      string `json:"version,omitempty" description:"Phiên bản từ tên artifact" example:"0.1.0-dev.1"`
	Unsigned     bool   `json:"unsigned" description:"Artifact có nhãn chưa ký" example:"true"`
	SizeBytes    *int64 `json:"size_bytes,omitempty" description:"Dung lượng artifact khi release cung cấp" example:"148897792"`
	SHA256       string `json:"sha256,omitempty" description:"Checksum SHA-256 khi release cung cấp"`
	Requirements string `json:"requirements,omitempty" description:"Yêu cầu hệ thống của artifact khi release cung cấp"`
}

// Legacy single URLs map to Windows for one release only (remove 2026-11-02).
// Explicit JSON entries win; no channel ever inherits a different channel.
func (c Config) OfficeInstallers(channel string) ([]OfficeInstaller, error) {
	var raw, legacy string
	switch channel {
	case "dev":
		raw, legacy = c.OfficeInstallerDevURLs, c.OfficeInstallerDevURL
	case "beta":
		raw, legacy = c.OfficeInstallerBetaURLs, c.OfficeInstallerBetaURL
	case "stable":
		raw, legacy = c.OfficeInstallerStableURLs, c.OfficeInstallerStableURL
	default:
		return nil, fmt.Errorf("invalid installer channel")
	}
	urls := map[string]string{}
	if strings.TrimSpace(raw) != "" {
		if err := json.Unmarshal([]byte(raw), &urls); err != nil || urls == nil {
			return nil, fmt.Errorf("invalid installer URL map")
		}
	}
	if _, present := urls["win32-x64"]; !present && legacy != "" {
		urls["win32-x64"] = legacy
	}
	for platform, rawURL := range urls {
		kind, known := installerKinds[platform]
		if !known {
			return nil, fmt.Errorf("unsupported installer platform")
		}
		if rawURL == "" {
			continue
		}
		u, err := url.Parse(rawURL)
		if err != nil || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || u.Opaque != "" || strings.ContainsAny(rawURL, "\r\n\t ") {
			return nil, fmt.Errorf("unsafe installer URL")
		}
		loopback := u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1" || u.Hostname() == "::1"
		if u.Scheme != "https" && !(channel == "dev" && loopback && u.Scheme == "http") {
			return nil, fmt.Errorf("unsafe installer URL scheme")
		}
		if path.Ext(u.Path) != kind {
			return nil, fmt.Errorf("installer format does not match platform")
		}
	}
	items := make([]OfficeInstaller, 0, len(urls))
	for _, platform := range OfficeInstallerPlatforms {
		if rawURL := urls[platform]; rawURL != "" {
			u, _ := url.Parse(rawURL)
			item := OfficeInstaller{Platform: platform, URL: rawURL, Kind: installerKinds[platform], Unsigned: strings.Contains(path.Base(u.Path), "unsigned")}
			if match := installerVersion.FindStringSubmatch(path.Base(u.Path)); len(match) > 1 {
				item.Version = match[1]
			}
			items = append(items, item)
		}
	}
	return items, nil
}
