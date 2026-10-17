// Package notification turns committed domain events into per-user
// notifications and delivers them over three channels: the in-app inbox, Web
// Push and a daily email digest (spec F-07).
//
// Nothing here is called by a handler or a business service. The consumer
// reads the outbox, so adding a kind is a rule in this package and a line in
// the catalogue, never an edit to Tasks or Meetings.
package notification

// The kinds. Each is a rule in rules.go, a title in titles.go and a row in
// the preference matrix; NOTIFICATION_KINDS in packages/core mirrors the list.
const (
	KindTaskAssigned      = "task_assigned"
	KindTaskStatusChanged = "task_status_changed"
	KindTaskCommented     = "task_commented"
	KindMentioned         = "mentioned"
	KindMeetingInvited    = "meeting_invited"
	KindMeetingStarting   = "meeting_starting"
	// Nudge after a meeting ends with something to summarize (C-11 §9.1 V1).
	KindMeetingSummaryReminder = "meeting_summary_reminder"
	KindMemberAdded            = "member_added"
	KindRoleChanged            = "role_changed"
	KindAuditExportReady       = "audit_export_ready"
	KindChatFollowUp           = "chat_follow_up"
	// A chat reminder came due (H16), fired by the server's reminder worker.
	KindChatReminder    = "chat_reminder"
	KindEmailHubNewMail = "email_hub_new_mail"
	// Document comments (G1-07, UNI-681): distinct kinds because the gate is
	// document read access, not workspace membership - and the titles name
	// the document, not a task.
	KindDocumentCommented = "document_commented"
	KindDocumentMentioned = "document_mentioned"
	// The G8-05 kinds (contract-collab section 8.3): a mention in a
	// Discussion, a reply in either flow, and resolving a Comment. The
	// old document_commented stays registered for rows written before the
	// UNI-1337 recipient table landed - the rules never emit it again.
	KindDocumentCommentReplied      = "document_comment_replied"
	KindDocumentDiscussionMentioned = "document_discussion_mentioned"
	KindDocumentDiscussionReplied   = "document_discussion_replied"
	KindDocumentCommentResolved     = "document_comment_resolved"
	// The edit lock (UNI-1645, addendum §5.2): someone asks the holder to
	// stop editing, the holder's answer, and a manager taking the lock.
	KindDocumentEditRequested       = "document_edit_requested"
	KindDocumentEditRequestAnswered = "document_edit_request_answered"
	KindDocumentEditTakenOver       = "document_edit_taken_over"
	// A workspace admin opened emergency view access to a restricted
	// document (DOC-05; UNI-1628). Sent to the document's ACL owner; the
	// params carry ids only.
	KindDocumentBreakGlass = "document_break_glass"
	// Chat (H1): one row per room or thread while unread, so a burst of
	// messages is one notification and one push.
	KindChatMentioned     = "chat_mentioned"
	KindChatDM            = "chat_dm"
	KindChatThreadReplied = "chat_thread_replied"
	// Document access requests (W-DOC07): registered so the inbox, titles and
	// preference matrix know them; the producers land with S-DOC07.
	KindDocumentAccessRequested = "document_access_requested"
	KindDocumentAccessApproved  = "document_access_approved"
	KindDocumentAccessDeclined  = "document_access_declined"
	// Direct user document share that raises effective access (SH-S3, UNI-1782).
	KindDocumentShared = "document_shared"
)

// Kinds is the list in display order.
var Kinds = []string{
	KindTaskAssigned, KindTaskStatusChanged, KindTaskCommented, KindMentioned,
	KindMeetingInvited, KindMeetingStarting, KindMeetingSummaryReminder,
	KindMemberAdded, KindRoleChanged, KindAuditExportReady, KindChatFollowUp, KindChatReminder, KindEmailHubNewMail,
	KindDocumentCommented, KindDocumentMentioned,
	KindDocumentCommentReplied, KindDocumentDiscussionMentioned, KindDocumentDiscussionReplied, KindDocumentCommentResolved,
	KindDocumentEditRequested, KindDocumentEditRequestAnswered, KindDocumentEditTakenOver,
	KindDocumentBreakGlass,
	KindChatMentioned, KindChatDM, KindChatThreadReplied,
	KindDocumentAccessRequested, KindDocumentAccessApproved, KindDocumentAccessDeclined,
	KindDocumentShared,
}

var kindSet = func() map[string]bool {
	m := make(map[string]bool, len(Kinds))
	for _, k := range Kinds {
		m[k] = true
	}
	return m
}()

// ValidKind reports whether k is one of Kinds.
func ValidKind(k string) bool { return kindSet[k] }

// TitleKey is the i18n key the client renders for a kind.
func TitleKey(kind string) string { return "notifications.kind." + kind }

// Topics this package listens to on the outbox. notification.created and
// notification.push are what it emits.
const (
	TopicCreated = "notification.created"
	TopicPush    = "notification.push"
)
