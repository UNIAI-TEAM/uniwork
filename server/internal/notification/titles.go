package notification

import "strings"

// Server-side titles, one per kind and locale, for the two channels that
// cannot run the client's t(): push payloads and the email digest. The
// strings are the same as notifications.kind.* in packages/core/i18n/locales
// so a person sees one wording everywhere; titles_test.go reads the JSON files
// and fails when they drift.
var titles = map[string]map[string]string{
	"vi": {
		KindTaskAssigned:           "{{actor}} đã giao bạn việc “{{task}}”",
		KindTaskStatusChanged:      "{{actor}} chuyển “{{task}}” sang {{status}}",
		KindTaskCommented:          "{{actor}} đã bình luận trong “{{task}}”",
		KindMentioned:              "{{actor}} đã nhắc đến bạn trong “{{task}}”",
		KindMeetingInvited:         "{{actor}} đã mời bạn họp “{{meeting}}”",
		KindMeetingStarting:        "“{{meeting}}” bắt đầu sau {{minutes}} phút",
		KindMeetingSummaryReminder: "“{{meeting}}” đã kết thúc · Tóm tắt và tạo việc",
		KindMemberAdded:            "{{actor}} đã thêm bạn vào workspace {{workspace}}",
		KindRoleChanged:            "{{actor}} đã đổi vai trò của bạn thành {{role}}",
		KindAuditExportReady:       "Bản xuất nhật ký của bạn đã sẵn sàng",
		KindChatFollowUp:           "Bạn đã gắn Follow-up cho một tin nhắn",
		KindChatReminder:           "Nhắc hẹn: {{body}}",
		KindEmailHubNewMail:        "Bạn có {{count}} thư chưa đọc · {{mailbox}}",
		KindDocumentCommented:      "{{actor}} đã bình luận trong “{{document}}”",
		KindDocumentMentioned:      "{{actor}} đã nhắc đến bạn trong “{{document}}”",
		KindChatMentioned:          "{{actor}} đã nhắc đến bạn trong {{room}}",
		KindChatDM:                 "{{actor}} đã nhắn tin cho bạn",
		KindChatThreadReplied:      "{{actor}} đã trả lời thread trong {{room}}",
	},
	"en": {
		KindTaskAssigned:           "{{actor}} assigned you “{{task}}”",
		KindTaskStatusChanged:      "{{actor}} moved “{{task}}” to {{status}}",
		KindTaskCommented:          "{{actor}} commented on “{{task}}”",
		KindMentioned:              "{{actor}} mentioned you in “{{task}}”",
		KindMeetingInvited:         "{{actor}} invited you to “{{meeting}}”",
		KindMeetingStarting:        "“{{meeting}}” starts in {{minutes}} minutes",
		KindMeetingSummaryReminder: "“{{meeting}}” ended · Summarize it and create tasks",
		KindMemberAdded:            "{{actor}} added you to workspace {{workspace}}",
		KindRoleChanged:            "{{actor}} changed your role to {{role}}",
		KindAuditExportReady:       "Your audit export is ready",
		KindChatFollowUp:           "You saved a follow-up on a message",
		KindChatReminder:           "Reminder: {{body}}",
		KindEmailHubNewMail:        "You have {{count}} unread message(s) · {{mailbox}}",
		KindDocumentCommented:      "{{actor}} commented on “{{document}}”",
		KindDocumentMentioned:      "{{actor}} mentioned you in “{{document}}”",
		KindChatMentioned:          "{{actor}} mentioned you in {{room}}",
		KindChatDM:                 "{{actor}} sent you a message",
		KindChatThreadReplied:      "{{actor}} replied to a thread in {{room}}",
	},
}

// Title renders the kind's title in locale with params, i18next-style
// {{name}} substitution. Unknown locale falls back to en.
func Title(locale, kind string, params map[string]string) string {
	loc := titles[locale]
	if loc == nil {
		loc = titles["en"]
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
