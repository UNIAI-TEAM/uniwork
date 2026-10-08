package config

import (
	"strings"
	"testing"
)

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

func TestOfficeInstallersEncodedFilenames(t *testing.T) {
	for _, filename := range []string{"bad%5Cname.exe", "bad%0Aname.exe", "bad%00name.exe", "bad%3Fname.exe", "bad%3Aname.exe", "bad%22name.exe"} {
		cfg := Config{OfficeInstallerDevURLs: `{"win32-x64":"https://downloads.test/` + filename + `"}`}
		if _, err := cfg.OfficeInstallers("dev"); err == nil {
			t.Errorf("accepted filename the bundle cannot preserve: %s", filename)
		}
	}
	cfg := Config{OfficeInstallerDevURLs: `{"win32-x64":"https://downloads.test/my%20office%2Eexe"}`}
	if items, err := cfg.OfficeInstallers("dev"); err != nil || len(items) != 1 {
		t.Fatalf("valid encoded artifact rejected: %+v %v", items, err)
	}
}

// The exact shape scripts/office/installer-urls.mjs emits from the
// office-desktop-installers workflow: release-asset URLs, unsigned file names.
func TestOfficeInstallerURLsFromCIJob(t *testing.T) {
	setRequired(t)
	base := "https://github.com/unicomhub/uniwork/releases/download/office-desktop-v0.1.0-dev.7/"
	t.Setenv("OFFICE_INSTALLER_DEV_URL", "")
	t.Setenv("OFFICE_INSTALLER_BETA_URL", "")
	t.Setenv("OFFICE_INSTALLER_STABLE_URL", "")
	t.Setenv("OFFICE_INSTALLER_DEV_URLS", `{"win32-x64":"`+base+`uniwork-office-test_0.1.0-dev.7_unsigned_win32_x64-setup.exe","win32-x64-zip":"`+base+`uniwork-office-test_0.1.0-dev.7_unsigned_win32_x64.zip","linux-x64-deb":"`+base+`uniwork-office-test_0.1.0-dev.7_unsigned_linux_x64.deb","linux-x64-appimage":"`+base+`uniwork-office-test_0.1.0-dev.7_unsigned_linux_x64.AppImage"}`)
	t.Setenv("OFFICE_INSTALLER_BETA_URLS", `{"win32-x64":"https://github.com/unicomhub/uniwork/releases/download/office-desktop-v0.1.0-beta.3/uniwork-office_0.1.0-beta.3_unsigned_win32_x64-setup.exe"}`)
	t.Setenv("OFFICE_INSTALLER_STABLE_URLS", "")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	dev, err := cfg.OfficeInstallers("dev")
	if err != nil || len(dev) != 4 {
		t.Fatalf("dev installers: %+v %v", dev, err)
	}
	for i, want := range []struct{ platform, kind string }{{"win32-x64", ".exe"}, {"win32-x64-zip", ".zip"}, {"linux-x64-deb", ".deb"}, {"linux-x64-appimage", ".AppImage"}} {
		if dev[i].Platform != want.platform || dev[i].Kind != want.kind || dev[i].Version != "0.1.0-dev.7" || !dev[i].Unsigned || !strings.HasPrefix(dev[i].URL, base) {
			t.Fatalf("dev[%d] = %+v, want %s %s unsigned 0.1.0-dev.7", i, dev[i], want.platform, want.kind)
		}
	}
	beta, err := cfg.OfficeInstallers("beta")
	if err != nil || len(beta) != 1 || beta[0].Version != "0.1.0-beta.3" || !beta[0].Unsigned {
		t.Fatalf("beta installers: %+v %v", beta, err)
	}
	if stable, err := cfg.OfficeInstallers("stable"); err != nil || len(stable) != 0 {
		t.Fatalf("stable must stay empty: %+v %v", stable, err)
	}
}

func TestOfficeDesktopChannelFollowsTheDesktopClient(t *testing.T) {
	for _, tc := range []struct{ client, setting, want string }{
		{"uniwork-office-dev", "", "dev"},
		{"uniwork-office-dev", "dev", "dev"},
		{"uniwork-office", "", "stable"},
		{"uniwork-office", "stable", "stable"},
		{"uniwork-office", "beta", "beta"},
		{"someone-else", "", ""},
	} {
		cfg := Config{DesktopAuthClientID: tc.client, OfficeDesktopChannelSetting: tc.setting}
		if err := cfg.validateOfficeDesktopChannel(); err != nil {
			t.Fatalf("%s/%s rejected: %v", tc.client, tc.setting, err)
		}
		if got := cfg.OfficeDesktopChannel(); got != tc.want {
			t.Fatalf("%s/%s = %q, want %q", tc.client, tc.setting, got, tc.want)
		}
	}
}

func TestLoadRefusesAnOfficeChannelTheClientCannotServe(t *testing.T) {
	for _, tc := range []struct{ client, setting, wantInError string }{
		{"uniwork-office", "dev", "DESKTOP_AUTH_CLIENT_ID=uniwork-office-dev"},
		{"uniwork-office-dev", "beta", "DESKTOP_AUTH_REDIRECT_URIS=uniwork-office://auth/callback"},
		{"uniwork-office", "nightly", "must be stable, beta or dev"},
	} {
		setRequired(t)
		t.Setenv("DESKTOP_AUTH_CLIENT_ID", tc.client)
		t.Setenv("OFFICE_DESKTOP_CHANNEL", tc.setting)
		if _, err := Load(); err == nil || !strings.Contains(err.Error(), tc.wantInError) {
			t.Fatalf("%s/%s: err = %v, want it to name %q", tc.client, tc.setting, err, tc.wantInError)
		}
	}
	setRequired(t)
	t.Setenv("DESKTOP_AUTH_CLIENT_ID", "uniwork-office-dev")
	t.Setenv("DESKTOP_AUTH_REDIRECT_URIS", "uniwork-office-dev://auth/callback")
	t.Setenv("OFFICE_DESKTOP_CHANNEL", "")
	cfg, err := Load()
	if err != nil || cfg.OfficeDesktopChannel() != "dev" {
		t.Fatalf("dev client: channel %q err %v", cfg.OfficeDesktopChannel(), err)
	}
}
