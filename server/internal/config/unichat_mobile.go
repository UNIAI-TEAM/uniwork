package config

import (
	"fmt"
	"regexp"
	"strings"
)

// mobileVersionPattern is the app.config.ts `version` shape of UniChat mobile:
// three dot-separated integers without leading zeros, nothing else.
var mobileVersionPattern = regexp.MustCompile(`^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$`)

// parseMobileVersion reads UNICHAT_MOBILE_MIN_SUPPORTED_VERSION: empty (or
// blank) is "no gate"; anything else must be MAJOR.MINOR.PATCH, because the
// app compares it number by number against its own version.
func parseMobileVersion(raw string) (string, error) {
	v := strings.TrimSpace(raw)
	if v == "" {
		return "", nil
	}
	if !mobileVersionPattern.MatchString(v) {
		return "", fmt.Errorf("must be MAJOR.MINOR.PATCH (for example 0.3.0), got %q", raw)
	}
	return v, nil
}
