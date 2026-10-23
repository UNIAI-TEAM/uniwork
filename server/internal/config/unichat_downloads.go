package config

import (
	"fmt"
	"net/url"
	"strings"
)

// UniChatInstallers reads UNICHAT_INSTALLER_<CHANNEL>_URLS with the Office
// parser: the UniChat desktop release emits the same platform keys and value
// format. There is no legacy singular URL, and no channel inherits another.
func (c Config) UniChatInstallers(channel string) ([]OfficeInstaller, error) {
	switch channel {
	case "dev":
		return parseInstallers(channel, c.UniChatInstallerDevURLs, "")
	case "beta":
		return parseInstallers(channel, c.UniChatInstallerBetaURLs, "")
	case "stable":
		return parseInstallers(channel, c.UniChatInstallerStableURLs, "")
	}
	return nil, fmt.Errorf("invalid installer channel")
}

// UniChatStoreLinks are the mobile store pages the public download page links
// to; an empty value means that store has nothing published.
type UniChatStoreLinks struct {
	IOS          string `json:"ios" description:"Trang App Store của UniChat; rỗng là chưa phát hành" example:"https://apps.apple.com/app/id1234567890"`
	Android      string `json:"android" description:"Trang Google Play của UniChat; rỗng là chưa phát hành" example:"https://play.google.com/store/apps/details?id=com.uniworkos.chat"`
	TestFlight   string `json:"testflight" description:"Link mời TestFlight cho bản thử iOS; rỗng là không có" example:"https://testflight.apple.com/join/AbCdEf12"`
	PlayInternal string `json:"play_internal" description:"Link thử nghiệm nội bộ Google Play; rỗng là không có" example:"https://play.google.com/apps/internaltest/4701234567890"`
}

// UniChatStores hides any configured link the visitor's browser should not
// open: only HTTPS with a host, without credentials or whitespace.
func (c Config) UniChatStores() UniChatStoreLinks {
	return UniChatStoreLinks{
		IOS:          storeURL(c.UniChatStoreIOSURL),
		Android:      storeURL(c.UniChatStoreAndroidURL),
		TestFlight:   storeURL(c.UniChatTestFlightURL),
		PlayInternal: storeURL(c.UniChatPlayInternalURL),
	}
}

func storeURL(raw string) string {
	raw = strings.TrimSpace(raw)
	u, err := url.Parse(raw)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.Opaque != "" || strings.ContainsAny(raw, "\r\n\t \\") {
		return ""
	}
	return raw
}
