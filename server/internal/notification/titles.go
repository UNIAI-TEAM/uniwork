package notification

import "strings"

// Server-side titles, one per kind and locale, for the two channels that
// cannot run the client's t(): push payloads and the email digest. The
// strings are the same as notifications.kind.* in packages/core/i18n/locales
// so a person sees one wording everywhere; titles_test.go reads the JSON files
// and fails when they drift.
//
// document_edit_request_answered has two sentences, one per decision
// (UNI-1645 addendum §5.2): the kind's own entry is the accepted one and
// editRequestDeclinedTitleKey - not a kind - the declined one, picked by
// Title when params["decision"] is "decline".
var titles = map[string]map[string]string{
	"vi": {
		KindTaskAssigned:                "{{actor}} đã giao bạn việc “{{task}}”",
		KindTaskStatusChanged:           "{{actor}} chuyển “{{task}}” sang {{status}}",
		KindTaskCommented:               "{{actor}} đã bình luận trong “{{task}}”",
		KindMentioned:                   "{{actor}} đã nhắc đến bạn trong “{{task}}”",
		KindMeetingInvited:              "{{actor}} đã mời bạn họp “{{meeting}}”",
		KindMeetingStarting:             "“{{meeting}}” bắt đầu sau {{minutes}} phút",
		KindMeetingSummaryReminder:      "“{{meeting}}” đã kết thúc · Tóm tắt và tạo việc",
		KindMemberAdded:                 "{{actor}} đã thêm bạn vào workspace {{workspace}}",
		KindRoleChanged:                 "{{actor}} đã đổi vai trò của bạn thành {{role}}",
		KindAuditExportReady:            "Bản xuất nhật ký của bạn đã sẵn sàng",
		KindChatFollowUp:                "Bạn đã gắn Follow-up cho một tin nhắn",
		KindChatReminder:                "Nhắc hẹn: {{body}}",
		KindEmailHubNewMail:             "Bạn có {{count}} thư chưa đọc · {{mailbox}}",
		KindDocumentCommented:           "{{actor}} đã bình luận trong “{{document}}”",
		KindDocumentMentioned:           "{{actor}} đã nhắc đến bạn trong bình luận tại tài liệu “{{document}}”.",
		KindDocumentCommentReplied:      "{{actor}} đã phản hồi bình luận của bạn trong tài liệu “{{document}}”.",
		KindDocumentDiscussionMentioned: "{{actor}} đã nhắc đến bạn trong thảo luận của tài liệu “{{document}}”.",
		KindDocumentDiscussionReplied:   "{{actor}} đã phản hồi nội dung thảo luận của bạn trong tài liệu “{{document}}”.",
		KindDocumentCommentResolved:     "{{actor}} đã đánh dấu bình luận của bạn trong tài liệu “{{document}}” là đã giải quyết.",
		KindDocumentEditRequested:       "{{actor}} muốn sửa “{{document}}”",
		KindDocumentEditRequestAnswered: "{{actor}} đã nhường quyền sửa “{{document}}” cho bạn",
		editRequestDeclinedTitleKey:     "{{actor}} chưa nhả quyền sửa “{{document}}”",
		KindDocumentEditTakenOver:       "{{actor}} đã lấy quyền sửa “{{document}}”. Thay đổi chưa lưu của bạn vẫn còn trong tài liệu đang mở.",
		KindChatMentioned:               "{{actor}} đã nhắc đến bạn trong {{room}}",
		KindChatDM:                      "{{actor}} đã nhắn tin cho bạn",
		KindChatThreadReplied:           "{{actor}} đã trả lời thread trong {{room}}",
	},
	"en": {
		KindTaskAssigned:                "{{actor}} assigned you “{{task}}”",
		KindTaskStatusChanged:           "{{actor}} moved “{{task}}” to {{status}}",
		KindTaskCommented:               "{{actor}} commented on “{{task}}”",
		KindMentioned:                   "{{actor}} mentioned you in “{{task}}”",
		KindMeetingInvited:              "{{actor}} invited you to “{{meeting}}”",
		KindMeetingStarting:             "“{{meeting}}” starts in {{minutes}} minutes",
		KindMeetingSummaryReminder:      "“{{meeting}}” ended · Summarize it and create tasks",
		KindMemberAdded:                 "{{actor}} added you to workspace {{workspace}}",
		KindRoleChanged:                 "{{actor}} changed your role to {{role}}",
		KindAuditExportReady:            "Your audit export is ready",
		KindChatFollowUp:                "You saved a follow-up on a message",
		KindChatReminder:                "Reminder: {{body}}",
		KindEmailHubNewMail:             "You have {{count}} unread message(s) · {{mailbox}}",
		KindDocumentCommented:           "{{actor}} commented on “{{document}}”",
		KindDocumentMentioned:           "{{actor}} mentioned you in a comment on “{{document}}”.",
		KindDocumentCommentReplied:      "{{actor}} replied to your comment in “{{document}}”.",
		KindDocumentDiscussionMentioned: "{{actor}} mentioned you in a discussion on “{{document}}”.",
		KindDocumentDiscussionReplied:   "{{actor}} replied to your discussion post in “{{document}}”.",
		KindDocumentCommentResolved:     "{{actor}} marked your comment in “{{document}}” as resolved.",
		KindDocumentEditRequested:       "{{actor}} wants to edit “{{document}}”",
		KindDocumentEditRequestAnswered: "{{actor}} handed you editing of “{{document}}”",
		editRequestDeclinedTitleKey:     "{{actor}} is still editing “{{document}}”",
		KindDocumentEditTakenOver:       "{{actor}} took over editing of “{{document}}”. Your unsaved changes are still in the open document.",
		KindChatMentioned:               "{{actor}} mentioned you in {{room}}",
		KindChatDM:                      "{{actor}} sent you a message",
		KindChatThreadReplied:           "{{actor}} replied to a thread in {{room}}",
	},
}

// kindTitles are the short titles OQ-C8 splits out for the title line of a
// push payload. The Inbox renders the same client keys (G8-07); this map is
// the server's mirror for the channel that cannot run t(), and titles_test.go
// fails when it drifts from notifications.kindTitle.*. Only kinds with a
// short title are listed; PushTitle falls back to the content sentence for
// every other kind.
var kindTitles = map[string]map[string]string{
	"vi": {
		KindDocumentMentioned:           "Bạn được nhắc tên trong bình luận",
		KindDocumentCommentReplied:      "Có phản hồi bình luận mới",
		KindDocumentDiscussionMentioned: "Bạn được nhắc tên trong thảo luận",
		KindDocumentDiscussionReplied:   "Có phản hồi thảo luận mới",
		KindDocumentCommentResolved:     "Bình luận đã được giải quyết",
	},
	"en": {
		KindDocumentMentioned:           "You were mentioned in a comment",
		KindDocumentCommentReplied:      "New reply to your comment",
		KindDocumentDiscussionMentioned: "You were mentioned in a discussion",
		KindDocumentDiscussionReplied:   "New reply in a discussion",
		KindDocumentCommentResolved:     "Comment resolved",
	},
}

// editRequestDeclinedTitleKey keys the declined sentence of
// document_edit_request_answered in titles and in notifications.kind.* of the
// client locales; it is not a kind.
const editRequestDeclinedTitleKey = KindDocumentEditRequestAnswered + "_declined"

// Title renders the kind's title in locale with params, i18next-style
// {{name}} substitution. Unknown locale falls back to en.
func Title(locale, kind string, params map[string]string) string {
	loc := titles[locale]
	if loc == nil {
		loc = titles["en"]
	}
	if kind == KindDocumentEditRequestAnswered && params["decision"] == editDecisionDecline {
		kind = editRequestDeclinedTitleKey
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

// PushTitle renders the title a push payload shows: the short kindTitle for a
// kind that has one (OQ-C8), the content sentence otherwise, so every other
// push is unchanged. Params are substituted verbatim - a document name with
// quotes or angle brackets reaches the payload as it is.
func PushTitle(locale, kind string, params map[string]string) string {
	loc := kindTitles[locale]
	if loc == nil {
		loc = kindTitles["en"]
	}
	if s := loc[kind]; s != "" {
		for k, v := range params {
			s = strings.ReplaceAll(s, "{{"+k+"}}", v)
		}
		return s
	}
	return Title(locale, kind, params)
}
