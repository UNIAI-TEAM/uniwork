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
	KindMemberAdded       = "member_added"
	KindRoleChanged       = "role_changed"
	KindAuditExportReady  = "audit_export_ready"
	KindChatFollowUp      = "chat_follow_up"
)

// Kinds is the list in display order.
var Kinds = []string{
	KindTaskAssigned, KindTaskStatusChanged, KindTaskCommented, KindMentioned,
	KindMeetingInvited, KindMeetingStarting,
	KindMemberAdded, KindRoleChanged, KindAuditExportReady, KindChatFollowUp,
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
