package notification

import "strings"

// Server-side titles, one per kind and locale, for the two channels that
// cannot run the client's t(): push payloads and the email digest. The
// strings are the same as notifications.kind.* in packages/core/i18n/locales
// so a person sees one wording everywhere; titles_test.go reads the JSON files
// and fails when they drift.
var titles = map[string]map[string]string{
	"vi": {
		KindTaskAssigned:      "{{actor}} đã giao bạn việc “{{task}}”",
		KindTaskStatusChanged: "{{actor}} chuyển “{{task}}” sang {{status}}",
		KindTaskCommented:     "{{actor}} đã bình luận trong “{{task}}”",
		KindMentioned:         "{{actor}} đã nhắc đến bạn trong “{{task}}”",
		KindMeetingInvited:    "{{actor}} đã mời bạn họp “{{meeting}}”",
		KindMeetingStarting:   "“{{meeting}}” bắt đầu sau {{minutes}} phút",
		KindMemberAdded:       "{{actor}} đã thêm bạn vào workspace {{workspace}}",
		KindRoleChanged:       "{{actor}} đã đổi vai trò của bạn thành {{role}}",
		KindAuditExportReady:  "Bản xuất nhật ký của bạn đã sẵn sàng",
	},
	"en": {
		KindTaskAssigned:      "{{actor}} assigned you “{{task}}”",
		KindTaskStatusChanged: "{{actor}} moved “{{task}}” to {{status}}",
		KindTaskCommented:     "{{actor}} commented on “{{task}}”",
		KindMentioned:         "{{actor}} mentioned you in “{{task}}”",
		KindMeetingInvited:    "{{actor}} invited you to “{{meeting}}”",
		KindMeetingStarting:   "“{{meeting}}” starts in {{minutes}} minutes",
		KindMemberAdded:       "{{actor}} added you to workspace {{workspace}}",
		KindRoleChanged:       "{{actor}} changed your role to {{role}}",
		KindAuditExportReady:  "Your audit export is ready",
	},
}

// Title renders the kind's title in locale with params, i18next-style
// {{name}} substitution. Unknown locale falls back to vi.
func Title(locale, kind string, params map[string]string) string {
	loc := titles[locale]
	if loc == nil {
		loc = titles["vi"]
	}
	s := loc[kind]
	if s == "" {
		return kind
	}
	for k, v := range params {
		s = strings.ReplaceAll(s, "{{"+k+"}}", v)
	}
	return s
}
