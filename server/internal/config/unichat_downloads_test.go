package config

import (
	"strings"
	"testing"
)

// The UniChat desktop release (D2) emits UNICHAT_INSTALLER_<CHANNEL>_URLS in
// the Office value format with the same platform keys, so the same parser
// reads it: same order, same checks, same metadata, and no legacy URL.
func TestUniChatInstallersShareTheOfficeContract(t *testing.T) {
	base := "https://github.com/UNIAI-TEAM/uniwork/releases/download/chat-desktop-v0.1.0-dev.1/"
	cfg := Config{
		OfficeInstallerDevURL:   "https://downloads.test/office-legacy.exe",
		OfficeInstallerDevURLs:  `{"linux-x64-deb":"https://downloads.test/office.deb"}`,
		UniChatInstallerDevURLs: `{"linux-x64-appimage":"` + base + `UniChat_0.1.0-dev.1_unsigned_linux_x64.AppImage","darwin-arm64":"` + base + `UniChat_0.1.0-dev.1_unsigned_darwin_arm64.dmg","win32-x64":"` + base + `UniChat_0.1.0-dev.1_unsigned_win32_x64-setup.exe"}`,
	}
	items, err := cfg.UniChatInstallers("dev")
	if err != nil || len(items) != 3 {
		t.Fatalf("dev installers: %+v %v", items, err)
	}
	for i, want := range []struct{ platform, kind string }{{"win32-x64", ".exe"}, {"darwin-arm64", ".dmg"}, {"linux-x64-appimage", ".AppImage"}} {
		if items[i].Platform != want.platform || items[i].Kind != want.kind || items[i].Version != "0.1.0-dev.1" || !items[i].Unsigned || !strings.HasPrefix(items[i].URL, base) {
			t.Fatalf("dev[%d] = %+v, want %s %s", i, items[i], want.platform, want.kind)
		}
	}
	for _, channel := range []string{"beta", "stable"} {
		if items, err := cfg.UniChatInstallers(channel); err != nil || items == nil || len(items) != 0 {
			t.Fatalf("%s must be empty, never another channel's or Office's: %+v %v", channel, items, err)
		}
	}
	// Office's singular legacy URL is Office's alone.
	cfg.UniChatInstallerDevURLs = ""
	if items, err := cfg.UniChatInstallers("dev"); err != nil || len(items) != 0 {
		t.Fatalf("UniChat inherited an Office URL: %+v %v", items, err)
	}
	for _, raw := range []string{`null`, `[]`, `{`, `{"unknown":"https://downloads.test/a.exe"}`, `{"win32-x64":"javascript:alert(1)"}`, `{"darwin-arm64":"https://downloads.test/a.exe"}`, `{"linux-x64-deb":"https://user:pass@downloads.test/a.deb"}`, `{"linux-x64-deb":"http://downloads.test/a.deb"}`, `{"win32-x64":"https://downloads.test/bad%5Cname.exe"}`} {
		cfg.UniChatInstallerBetaURLs = raw
		if _, err := cfg.UniChatInstallers("beta"); err == nil {
			t.Fatalf("accepted invalid map %s", raw)
		}
	}
	cfg.UniChatInstallerDevURLs = `{"linux-x64-deb":"http://localhost:18584/unichat.deb"}`
	if items, err := cfg.UniChatInstallers("dev"); err != nil || len(items) != 1 {
		t.Fatalf("dev loopback HTTP rejected: %+v %v", items, err)
	}
	if _, err := cfg.UniChatInstallers("nightly"); err == nil {
		t.Fatal("accepted an unknown channel")
	}
}

// Store links are opened by the visitor's browser: only HTTPS with a host and
// without credentials or whitespace is published; anything else is hidden.
func TestUniChatStoresAcceptOnlyHTTPS(t *testing.T) {
	cfg := Config{
		UniChatStoreIOSURL:     "https://apps.apple.com/app/unichat/id1234567890",
		UniChatStoreAndroidURL: "https://play.google.com/store/apps/details?id=com.uniworkos.chat",
		UniChatTestFlightURL:   " https://testflight.apple.com/join/AbCdEf12 ",
		UniChatPlayInternalURL: "javascript:alert(1)",
	}
	want := UniChatStoreLinks{
		IOS:        "https://apps.apple.com/app/unichat/id1234567890",
		Android:    "https://play.google.com/store/apps/details?id=com.uniworkos.chat",
		TestFlight: "https://testflight.apple.com/join/AbCdEf12",
	}
	if got := cfg.UniChatStores(); got != want {
		t.Fatalf("stores = %+v, want %+v", got, want)
	}
	for _, bad := range []string{"http://apps.apple.com/app/id1", "itms-apps://apps.apple.com/app/id1", "https://user:pw@apps.apple.com/app/id1", "https:///app/id1", "https://apps.apple.com/app id1", "//apps.apple.com/app/id1", "apps.apple.com/app/id1"} {
		if got := (Config{UniChatStoreIOSURL: bad}).UniChatStores(); got.IOS != "" {
			t.Errorf("published unsafe store link %q", bad)
		}
	}
}

func TestLoadUniChatDownloadEnv(t *testing.T) {
	setRequired(t)
	t.Setenv("UNICHAT_INSTALLER_DEV_URLS", `{"linux-x64-deb":"http://localhost:18584/unichat.deb"}`)
	t.Setenv("UNICHAT_INSTALLER_BETA_URLS", `{"darwin-x64":"https://downloads.test/unichat.dmg"}`)
	t.Setenv("UNICHAT_INSTALLER_STABLE_URLS", "")
	t.Setenv("UNICHAT_STORE_IOS_URL", "https://apps.apple.com/app/id1")
	t.Setenv("UNICHAT_STORE_ANDROID_URL", "https://play.google.com/store/apps/details?id=com.uniworkos.chat")
	t.Setenv("UNICHAT_TESTFLIGHT_URL", "https://testflight.apple.com/join/x")
	t.Setenv("UNICHAT_PLAY_INTERNAL_URL", "https://play.google.com/apps/internaltest/1")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.UniChatInstallerDevURLs == "" || cfg.UniChatInstallerBetaURLs == "" || cfg.UniChatInstallerStableURLs != "" {
		t.Fatalf("installer env: %+v", cfg)
	}
	if cfg.UniChatStoreIOSURL == "" || cfg.UniChatStoreAndroidURL == "" || cfg.UniChatTestFlightURL == "" || cfg.UniChatPlayInternalURL == "" {
		t.Fatalf("store env: %+v", cfg.UniChatStores())
	}
}
