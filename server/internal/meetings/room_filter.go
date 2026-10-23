package meetings

import "strings"

// IsUniWorkLiveKitRoom reports whether a LiveKit room belongs to UniWork.
// Empty names are accepted so egress-only webhooks can still match by egress id.
func IsUniWorkLiveKitRoom(name string) bool {
	name = strings.TrimSpace(name)
	if name == "" {
		return true
	}
	return strings.HasPrefix(name, "uw_mtg_") || strings.HasPrefix(name, "uw-voice-")
}
