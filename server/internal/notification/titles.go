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
		KindTaskAssigned:                  "{{actor}} đã giao bạn việc \"{{task}}\"",
		KindTasksAssigned:                 "{{actor}} đã giao bạn {{count}} việc từ cuộc họp \"{{meeting}}\"",
		tasksAssignedNoMeetingTitleKey:    "{{actor}} đã giao bạn {{count}} việc",
		KindTaskStatusChanged:             "{{actor}} chuyển \"{{task}}\" sang {{status}}",
		KindTaskCommented:                 "{{actor}} đã bình luận trong \"{{task}}\"",
		KindMentioned:                     "{{actor}} đã nhắc đến bạn trong \"{{task}}\"",
		KindMeetingInvited:                "{{actor}} đã mời bạn họp \"{{meeting}}\"",
		KindMeetingStarting:               "\"{{meeting}}\" bắt đầu sau {{minutes}} phút",
		KindMeetingSummaryReminder:        "\"{{meeting}}\" đã kết thúc · Tóm tắt và tạo việc",
		KindMeetingSummaryReady:           "Tóm tắt \"{{meeting}}\" đã sẵn sàng · Xem và giao việc",
		KindMeetingRecapReady:             "Đã có tóm tắt cuộc họp \"{{meeting}}\" · Xem các quyết định và việc cần làm",
		KindMeetingActionItemsPending:     "\"{{meeting}}\" còn {{count}} việc chưa giao · Xem và giao việc",
		KindMeetingTaskDue:                "Việc \"{{task}}\" từ cuộc họp \"{{meeting}}\" đến hạn hôm nay",
		taskOverdueTitleKey:               "Việc \"{{task}}\" từ cuộc họp \"{{meeting}}\" đã quá hạn",
		recapMinutesTitleKey:              "Biên bản \"{{meeting}}\" đã chốt · Xem lại các quyết định và việc được giao",
		KindMeetingTranscriptReady:        "Đã có bản ghi lời thoại cho tệp ghi âm của \"{{meeting}}\"",
		KindMeetingTranscriptFailed:       "Không tạo được bản ghi lời thoại cho tệp ghi âm của \"{{meeting}}\". Mở cuộc họp để tải lại tệp.",
		KindMemberAdded:                   "{{actor}} đã thêm bạn vào workspace {{workspace}}",
		KindRoleChanged:                   "{{actor}} đã đổi vai trò của bạn thành {{role}}",
		KindAuditExportReady:              "Bản xuất nhật ký của bạn đã sẵn sàng",
		KindChatFollowUp:                  "Bạn đã gắn Follow-up cho một tin nhắn",
		KindChatReminder:                  "Nhắc hẹn: {{body}}",
		KindEmailHubNewMail:               "Bạn có {{count}} thư chưa đọc · {{mailbox}}",
		KindDocumentCommented:             "{{actor}} đã bình luận trong \"{{document}}\"",
		KindDocumentMentioned:             "{{actor}} đã nhắc đến bạn trong bình luận tại tài liệu \"{{document}}\".",
		KindDocumentBodyMentioned:         "{{actor}} đã nhắc đến bạn trong tài liệu \"{{document}}\".",
		KindDocumentCommentReplied:        "{{actor}} đã phản hồi bình luận của bạn trong tài liệu \"{{document}}\".",
		KindDocumentDiscussionMentioned:   "{{actor}} đã nhắc đến bạn trong thảo luận của tài liệu \"{{document}}\".",
		KindDocumentDiscussionReplied:     "{{actor}} đã phản hồi nội dung thảo luận của bạn trong tài liệu \"{{document}}\".",
		KindDocumentCommentResolved:       "{{actor}} đã đánh dấu một bình luận trong tài liệu \"{{document}}\" là đã giải quyết.",
		KindDocumentEditRequested:         "{{actor}} muốn sửa \"{{document}}\"",
		KindDocumentEditRequestAnswered:   "{{actor}} đã nhường quyền sửa \"{{document}}\" cho bạn",
		editRequestDeclinedTitleKey:       "{{actor}} chưa nhả quyền sửa \"{{document}}\"",
		KindDocumentEditTakenOver:         "{{actor}} đã lấy quyền sửa \"{{document}}\". Thay đổi chưa lưu của bạn vẫn còn trong tài liệu đang mở.",
		KindDocumentBreakGlass:            "{{actor}} đã mở truy cập khẩn cấp (chỉ xem, 24 giờ) vào tài liệu \"{{document}}\".",
		KindChatMentioned:                 "{{actor}} đã nhắc đến bạn trong {{room}}",
		KindChatDM:                        "{{actor}} đã nhắn tin cho bạn",
		KindChatMessage:                   "{{actor}} đã nhắn trong {{room}}",
		KindChatCallIncoming:              "{{actor}} đang gọi",
		KindChatThreadReplied:             "{{actor}} đã trả lời thread trong {{room}}",
		KindDocumentAccessRequested:       "{{actor}} xin quyền truy cập tài liệu \"{{document}}\".",
		KindDocumentAccessApproved:        "{{actor}} đã cấp cho bạn quyền truy cập \"{{document}}\".",
		KindDocumentAccessDeclined:        "Yêu cầu truy cập tài liệu của bạn đã bị từ chối.",
		KindDocumentShared:                "{{actor}} đã chia sẻ tài liệu \"{{document}}\" với bạn. Quyền: {{level}}.",
		KindDocumentTrashedByOther:        "{{actor}} đã chuyển tài liệu của bạn vào thùng rác, khôi phục trước {{date}}",
		KindDocumentChanged:               "{{actor}} đã thay đổi {{document_count}} tài liệu",
		KindDocumentOwnerTransferred:      "{{actor}} đã chuyển cho bạn quyền sở hữu tài liệu \"{{document}}\".",
		KindDocumentOwnersBulkTransferred: "{{actor}} đã chuyển cho bạn quyền sở hữu các tài liệu của {{name}}.",
		bulkTransferUntitledTitleKey:      "{{actor}} đã chuyển cho bạn quyền sở hữu các tài liệu của một thành viên.",
	},
	"en": {
		KindTaskAssigned:                  "{{actor}} assigned you \"{{task}}\"",
		KindTasksAssigned:                 "{{actor}} assigned you {{count}} tasks from the meeting \"{{meeting}}\"",
		tasksAssignedNoMeetingTitleKey:    "{{actor}} assigned you {{count}} tasks",
		KindTaskStatusChanged:             "{{actor}} moved \"{{task}}\" to {{status}}",
		KindTaskCommented:                 "{{actor}} commented on \"{{task}}\"",
		KindMentioned:                     "{{actor}} mentioned you in \"{{task}}\"",
		KindMeetingInvited:                "{{actor}} invited you to \"{{meeting}}\"",
		KindMeetingStarting:               "\"{{meeting}}\" starts in {{minutes}} minutes",
		KindMeetingSummaryReminder:        "\"{{meeting}}\" ended · Summarize it and create tasks",
		KindMeetingSummaryReady:           "\"{{meeting}}\" summary is ready · Review it and assign tasks",
		KindMeetingRecapReady:             "The recap of \"{{meeting}}\" is ready · See the decisions and next steps",
		KindMeetingActionItemsPending:     "\"{{meeting}}\" still has {{count}} items to assign · Review and assign them",
		KindMeetingTaskDue:                "\"{{task}}\" from the meeting \"{{meeting}}\" is due today",
		taskOverdueTitleKey:               "\"{{task}}\" from the meeting \"{{meeting}}\" is overdue",
		recapMinutesTitleKey:              "The minutes of \"{{meeting}}\" are final · Review the decisions and assigned tasks",
		KindMeetingTranscriptReady:        "The transcript of the recording for \"{{meeting}}\" is ready",
		KindMeetingTranscriptFailed:       "Couldn't transcribe the recording for \"{{meeting}}\". Open the meeting to upload the file again.",
		KindMemberAdded:                   "{{actor}} added you to workspace {{workspace}}",
		KindRoleChanged:                   "{{actor}} changed your role to {{role}}",
		KindAuditExportReady:              "Your audit export is ready",
		KindChatFollowUp:                  "You saved a follow-up on a message",
		KindChatReminder:                  "Reminder: {{body}}",
		KindEmailHubNewMail:               "You have {{count}} unread message(s) · {{mailbox}}",
		KindDocumentCommented:             "{{actor}} commented on \"{{document}}\"",
		KindDocumentMentioned:             "{{actor}} mentioned you in a comment on \"{{document}}\".",
		KindDocumentBodyMentioned:         "{{actor}} mentioned you in \"{{document}}\".",
		KindDocumentCommentReplied:        "{{actor}} replied to your comment in \"{{document}}\".",
		KindDocumentDiscussionMentioned:   "{{actor}} mentioned you in a discussion on \"{{document}}\".",
		KindDocumentDiscussionReplied:     "{{actor}} replied to your discussion post in \"{{document}}\".",
		KindDocumentCommentResolved:       "{{actor}} marked a comment in \"{{document}}\" as resolved.",
		KindDocumentEditRequested:         "{{actor}} wants to edit \"{{document}}\"",
		KindDocumentEditRequestAnswered:   "{{actor}} handed you editing of \"{{document}}\"",
		editRequestDeclinedTitleKey:       "{{actor}} is still editing \"{{document}}\"",
		KindDocumentEditTakenOver:         "{{actor}} took over editing of \"{{document}}\". Your unsaved changes are still in the open document.",
		KindDocumentBreakGlass:            "{{actor}} opened emergency view access (24h) to \"{{document}}\".",
		KindChatMentioned:                 "{{actor}} mentioned you in {{room}}",
		KindChatDM:                        "{{actor}} sent you a message",
		KindChatMessage:                   "{{actor}} sent a message in {{room}}",
		KindChatCallIncoming:              "{{actor}} is calling",
		KindChatThreadReplied:             "{{actor}} replied to a thread in {{room}}",
		KindDocumentAccessRequested:       "{{actor}} requested access to \"{{document}}\".",
		KindDocumentAccessApproved:        "{{actor}} gave you access to \"{{document}}\".",
		KindDocumentAccessDeclined:        "Your request to access a document was declined.",
		KindDocumentShared:                "{{actor}} shared \"{{document}}\" with you ({{level}}).",
		KindDocumentTrashedByOther:        "{{actor}} moved your document to trash. Restore it before {{date}}",
		KindDocumentChanged:               "{{actor}} changed {{document_count}} documents",
		KindDocumentOwnerTransferred:      "{{actor}} transferred ownership of \"{{document}}\" to you.",
		KindDocumentOwnersBulkTransferred: "{{actor}} transferred {{name}}'s documents to you.",
		bulkTransferUntitledTitleKey:      "{{actor}} transferred a member's documents to you.",
	},
}

// documentLevelLabels translates the wire share level on server-rendered
// document_shared titles (digest / push fallback) so a raw enum never leaks;
// unknown values stay as-is.
var documentLevelLabels = map[string]map[string]string{
	"vi": {
		"view":    "Chỉ xem",
		"comment": "Nhận xét",
		"edit":    "Chỉnh sửa",
		"manage":  "Quản lý",
	},
	"en": {
		"view":    "View",
		"comment": "Comment",
		"edit":    "Edit",
		"manage":  "Manage",
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
		KindDocumentMentioned:             "Bạn được nhắc tên trong bình luận",
		KindDocumentBodyMentioned:         "Bạn được nhắc đến trong tài liệu",
		KindDocumentCommentReplied:        "Có phản hồi bình luận mới",
		KindDocumentDiscussionMentioned:   "Bạn được nhắc tên trong thảo luận",
		KindDocumentDiscussionReplied:     "Có phản hồi thảo luận mới",
		KindDocumentCommentResolved:       "Bình luận đã được giải quyết",
		KindDocumentBreakGlass:            "Truy cập khẩn cấp vào tài liệu",
		KindDocumentAccessRequested:       "Yêu cầu truy cập tài liệu",
		KindDocumentAccessApproved:        "Đã được cấp quyền",
		KindDocumentAccessDeclined:        "Yêu cầu bị từ chối",
		KindDocumentShared:                "Tài liệu được chia sẻ",
		KindDocumentTrashedByOther:        "Tài liệu của bạn đã vào thùng rác",
		KindDocumentChanged:               "Tài liệu đã thay đổi",
		KindDocumentOwnerTransferred:      "Bạn là chủ sở hữu tài liệu",
		KindDocumentOwnersBulkTransferred: "Bạn nhận quyền sở hữu nhiều tài liệu",
	},
	"en": {
		KindDocumentMentioned:             "You were mentioned in a comment",
		KindDocumentBodyMentioned:         "You were mentioned in a document",
		KindDocumentCommentReplied:        "New reply to your comment",
		KindDocumentDiscussionMentioned:   "You were mentioned in a discussion",
		KindDocumentDiscussionReplied:     "New reply in a discussion",
		KindDocumentCommentResolved:       "Comment resolved",
		KindDocumentBreakGlass:            "Emergency access to document",
		KindDocumentAccessRequested:       "Document access request",
		KindDocumentAccessApproved:        "Access granted",
		KindDocumentAccessDeclined:        "Request declined",
		KindDocumentShared:                "Document shared",
		KindDocumentTrashedByOther:        "Your document was moved to trash",
		KindDocumentChanged:               "Documents changed",
		KindDocumentOwnerTransferred:      "You now own a document",
		KindDocumentOwnersBulkTransferred: "You now own documents",
	},
}

// editRequestDeclinedTitleKey keys the declined sentence of
// document_edit_request_answered in titles and in notifications.kind.* of the
// client locales; it is not a kind.
const editRequestDeclinedTitleKey = KindDocumentEditRequestAnswered + "_declined"

// bulkTransferUntitledTitleKey is the sentence of a bulk transfer whose source
// member no longer resolves (name empty): same wording as the client's
// document_owners_bulk_transferred_untitled key (FE-R1-6).
const bulkTransferUntitledTitleKey = KindDocumentOwnersBulkTransferred + "_untitled"

// tasksAssignedNoMeetingTitleKey keys the tasks_assigned sentence for a batch
// that did not come from one meeting (or a row from before the meeting
// param); it is not a kind.
const tasksAssignedNoMeetingTitleKey = KindTasksAssigned + "_nomeeting"

// recapMinutesTitleKey keys the meeting_recap_ready sentence for finalized
// minutes (params.stage = "minutes"); it is not a kind.
const recapMinutesTitleKey = KindMeetingRecapReady + "_minutes"

// taskOverdueTitleKey keys the meeting_task_due sentence of an overdue task
// (params.stage = "overdue"); it is not a kind.
const taskOverdueTitleKey = KindMeetingTaskDue + "_overdue"

// Title renders the kind's title in locale with params, i18next-style
// {{name}} substitution. Unknown locale falls back to en.
func Title(locale, kind string, params map[string]string) string {
	loc := titles[locale]
	if loc == nil {
		locale = "en"
		loc = titles["en"]
	}
	if kind == KindDocumentEditRequestAnswered && params["decision"] == editDecisionDecline {
		kind = editRequestDeclinedTitleKey
	}
	if kind == KindDocumentOwnersBulkTransferred && strings.TrimSpace(params["name"]) == "" {
		kind = bulkTransferUntitledTitleKey
	}
	if kind == KindMeetingRecapReady && params["stage"] == recapStageMinutes {
		kind = recapMinutesTitleKey
	}
	if kind == KindMeetingTaskDue && params["stage"] == taskStageOverdue {
		kind = taskOverdueTitleKey
	}
	if kind == KindTasksAssigned && strings.TrimSpace(params["meeting"]) == "" {
		kind = tasksAssignedNoMeetingTitleKey
	}
	s := loc[kind]
	if s == "" {
		return kind
	}
	for k, v := range params {
		if k == "level" && kind == KindDocumentShared {
			if label := documentLevelLabels[locale][v]; label != "" {
				v = label
			}
		}
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

// missedCallTitles name a DM call nobody answered. The row is a chat_dm about
// the call's log message, which has no text to preview, so the push says
// what it is instead of "X đã nhắn tin cho bạn" over an empty body. Not a
// kind: the inbox keeps showing the chat_dm sentence.
var missedCallTitles = map[string]map[bool]string{
	"vi": {false: "Cuộc gọi nhỡ từ {{actor}}", true: "Cuộc gọi video nhỡ từ {{actor}}"},
	"en": {false: "Missed call from {{actor}}", true: "Missed video call from {{actor}}"},
}

// MissedCallTitle is the push title of an unanswered DM call, in locale (en
// when unknown).
func MissedCallTitle(locale string, video bool, actor string) string {
	loc := missedCallTitles[locale]
	if loc == nil {
		loc = missedCallTitles["en"]
	}
	return strings.ReplaceAll(loc[video], "{{actor}}", actor)
}
