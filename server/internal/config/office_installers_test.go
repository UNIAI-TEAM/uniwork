package config

import "testing"

func TestOfficeInstallersPlatformMaps(t *testing.T) {
	cfg := Config{OfficeInstallerDevURL: "https://downloads.test/legacy.exe", OfficeInstallerDevURLs: `{"linux-x64-deb":"https://downloads.test/office.deb","darwin-arm64":"https://downloads.test/office.dmg"}`}
	items, err := cfg.OfficeInstallers("dev")
	if err != nil || len(items) != 3 || items[0].Platform != "win32-x64" || items[1].Platform != "darwin-arm64" || items[2].Kind != ".deb" {
		t.Fatalf("platform map: %+v %v", items, err)
	}
	items, err = cfg.OfficeInstallers("stable")
	if err != nil || len(items) != 0 {
		t.Fatalf("stable fell back to dev: %+v %v", items, err)
	}
	for _, raw := range []string{`null`, `[]`, `{`, `{"unknown":"https://downloads.test/a.exe"}`, `{"win32-x64":"javascript:alert(1)"}`, `{"darwin-arm64":"https://downloads.test/a.exe"}`, `{"linux-x64-deb":"https://user:pass@downloads.test/a.deb"}`, `{"linux-x64-deb":"http://downloads.test/a.deb"}`} {
		cfg.OfficeInstallerDevURLs = raw
		if _, err := cfg.OfficeInstallers("dev"); err == nil {
			t.Fatalf("accepted invalid map %s", raw)
		}
	}
}

func TestOfficeInstallersMetadataAndOverride(t *testing.T) {
	cfg := Config{OfficeInstallerDevURL: "https://downloads.test/legacy.exe", OfficeInstallerDevURLs: `{"win32-x64":"https://downloads.test/Office_0.1.0-dev.9_unsigned_win32_x64-setup.exe","linux-x64-appimage":"http://localhost:18584/Office_0.1.0-dev.9_unsigned_linux_x64.AppImage"}`}
	items, err := cfg.OfficeInstallers("dev")
	if err != nil || len(items) != 2 || items[0].Version != "0.1.0-dev.9" || !items[0].Unsigned || items[0].URL == cfg.OfficeInstallerDevURL || items[1].Kind != ".AppImage" {
		t.Fatalf("artifact metadata: %+v %v", items, err)
	}
	cfg.OfficeInstallerDevURLs = `{"win32-x64":""}`
	items, err = cfg.OfficeInstallers("dev")
	if err != nil || len(items) != 0 {
		t.Fatalf("explicit unavailable inherited legacy URL: %+v %v", items, err)
	}
}

func TestLoadOfficeInstallerURLMaps(t *testing.T) {
	setRequired(t)
	t.Setenv("OFFICE_INSTALLER_DEV_URLS", `{"linux-x64-deb":"http://localhost:18584/test.deb"}`)
	t.Setenv("OFFICE_INSTALLER_BETA_URLS", `{"darwin-x64":"https://downloads.test/beta.dmg"}`)
	t.Setenv("OFFICE_INSTALLER_STABLE_URLS", "")
	cfg, err := Load()
	if err != nil || cfg.OfficeInstallerDevURLs == "" || cfg.OfficeInstallerBetaURLs == "" || cfg.OfficeInstallerStableURLs != "" {
		t.Fatalf("platform env loading: %v", err)
	}
}
