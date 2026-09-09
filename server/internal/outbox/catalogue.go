package outbox

import "sort"

// The event catalogue: the machine-readable half of the contract described in
// docs/events/CATALOGUE.md. packages/core/types/events.ts is the third copy,
// and scripts/events-catalogue.test.mjs fails when the three disagree.
//
// Names are `<entity>.<verb>`, verb in the past. The version is a column, never
// part of the name: a breaking payload change bumps Version and consumers
// switch on it, so both shapes can be in flight during a release.

// Scope says where a realtime consumer delivers the event.
type Scope string

const (
	// ScopeWorkspace fans out to everyone connected to the workspace.
	ScopeWorkspace Scope = "workspace"
	// ScopeUser goes to one user's own connections, on every device.
	ScopeUser Scope = "user"
	// ScopeChat is a DM/group room scope, narrower than the workspace: the
	// client must already be subscribed to the room to receive it.
	ScopeChat Scope = "chat"
	// ScopeRoom fans out to each member's own user scope, resolved at delivery
	// time. Room membership events need this: a member who has just been added
	// to a room is not subscribed to it yet, so ScopeChat would deliver the
	// event to everyone except the person it is about.
	ScopeRoom Scope = "room"
	// ScopeOrganization fans out to everyone connected from anywhere in one
	// organization. Directory and department changes belong to the company,
	// not to a workspace, so a per-workspace fan-out would both miss people
	// and repeat itself (F-03 §6.4).
	ScopeOrganization Scope = "organization"
	// ScopeNone is infrastructure work with no client to notify.
	ScopeNone Scope = ""
)

// Delivery says how the event reaches its consumers.
type Delivery string

const (
	// DeliveryOutbox is the default: written in the command's transaction and
	// delivered by this dispatcher, so a crash cannot lose it.
	DeliveryOutbox Delivery = "outbox"
	// DeliveryEphemeral is published straight to the socket and never stored.
	// The bar for this is "losing it costs nobody anything" — typing
	// indicators, voice signalling, a transcript line that the next line
	// supersedes. Anything a user would ask about later is DeliveryOutbox.
	DeliveryEphemeral Delivery = "ephemeral"
)

// EventDef is one row of the catalogue.
type EventDef struct {
	Topic    string
	Version  int
	Payload  []string
	Scope    Scope
	Delivery Delivery
}

var catalogue = []EventDef{
	// Tasks
	{Topic: "task.created", Version: 1, Payload: []string{"task_id", "workspace_id"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "task.updated", Version: 1, Payload: []string{"task_id", "workspace_id"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "task.deleted", Version: 1, Payload: []string{"task_id", "workspace_id"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "task.comment_added", Version: 1, Payload: []string{"task_id", "comment_id", "workspace_id"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "task.comment_updated", Version: 1, Payload: []string{"task_id", "comment_id", "workspace_id"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "task.comment_deleted", Version: 1, Payload: []string{"task_id", "comment_id", "workspace_id"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "task.comment_resolved", Version: 1, Payload: []string{"task_id", "comment_id", "workspace_id"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "task.comment_unresolved", Version: 1, Payload: []string{"task_id", "comment_id", "workspace_id"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "comment.reaction_added", Version: 1, Payload: []string{"task_id", "comment_id", "workspace_id"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "comment.reaction_removed", Version: 1, Payload: []string{"task_id", "comment_id", "workspace_id"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "task.reaction_added", Version: 1, Payload: []string{"task_id", "workspace_id"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "task.reaction_removed", Version: 1, Payload: []string{"task_id", "workspace_id"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "task.subscribed", Version: 1, Payload: []string{"task_id", "workspace_id"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "task.unsubscribed", Version: 1, Payload: []string{"task_id", "workspace_id"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "attachment.uploaded", Version: 1, Payload: []string{"attachment_id", "task_id", "workspace_id"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "attachment.deleted", Version: 1, Payload: []string{"attachment_id", "task_id", "workspace_id"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "task_label.created", Version: 1, Payload: []string{"label_id", "workspace_id"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "task_label.deleted", Version: 1, Payload: []string{"label_id", "workspace_id"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "task_label.updated", Version: 1, Payload: []string{"label_id", "workspace_id"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "task_pin.created", Version: 1, Payload: []string{"pin_id", "workspace_id"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "task_pin.deleted", Version: 1, Payload: []string{"pin_id", "workspace_id"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "task_pin.reordered", Version: 1, Payload: []string{"workspace_id", "user_id"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "task_property.created", Version: 1, Payload: []string{"property_id", "workspace_id"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "task_property.updated", Version: 1, Payload: []string{"property_id", "workspace_id"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "task_status.created", Version: 1, Payload: []string{"status_id", "workspace_id"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "task_status.deleted", Version: 1, Payload: []string{"status_id", "workspace_id"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "task_status.updated", Version: 1, Payload: []string{"status_id", "workspace_id"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "task_view.created", Version: 1, Payload: []string{"view_id", "workspace_id"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "task_view.deleted", Version: 1, Payload: []string{"view_id", "workspace_id"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "task_view.updated", Version: 1, Payload: []string{"view_id", "workspace_id"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "task_view_preference.updated", Version: 1, Payload: []string{"workspace_id", "user_id", "scope_id"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "project.created", Version: 1, Payload: []string{"project_id", "workspace_id"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "project.deleted", Version: 1, Payload: []string{"project_id", "workspace_id"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "project.updated", Version: 1, Payload: []string{"project_id", "workspace_id"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "project_resource.created", Version: 1, Payload: []string{"resource_id", "project_id", "workspace_id"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "project_resource.deleted", Version: 1, Payload: []string{"resource_id", "project_id", "workspace_id"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "project_resource.updated", Version: 1, Payload: []string{"resource_id", "project_id", "workspace_id"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},

	// Agents (ADR 0007): the picker in a workspace refreshes when one joins.
	{Topic: "workspace_agent.added", Version: 1, Payload: []string{"workspace_id", "agent_id"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},

	// Organization and workspace membership
	{Topic: "organization.created", Version: 1, Payload: []string{"organization_id"}, Scope: ScopeUser, Delivery: DeliveryOutbox},
	{Topic: "organization.updated", Version: 1, Payload: []string{"organization_id"}, Scope: ScopeUser, Delivery: DeliveryOutbox},
	// Platform admin (F-11): the owner's client shows the suspended page.
	{Topic: "organization.suspended", Version: 1, Payload: []string{"organization_id", "user_id"}, Scope: ScopeUser, Delivery: DeliveryOutbox},
	{Topic: "organization.unsuspended", Version: 1, Payload: []string{"organization_id", "user_id"}, Scope: ScopeUser, Delivery: DeliveryOutbox},
	{Topic: "member.invited", Version: 1, Payload: []string{"organization_id", "user_id", "workspace_id"}, Scope: ScopeUser, Delivery: DeliveryOutbox},
	{Topic: "member.joined", Version: 1, Payload: []string{"organization_id", "user_id", "workspace_id"}, Scope: ScopeUser, Delivery: DeliveryOutbox},
	{Topic: "member.role_changed", Version: 1, Payload: []string{"organization_id", "user_id", "workspace_id"}, Scope: ScopeUser, Delivery: DeliveryOutbox},
	{Topic: "member.removed", Version: 1, Payload: []string{"organization_id", "user_id", "workspace_id"}, Scope: ScopeUser, Delivery: DeliveryOutbox},
	// Organization membership lifecycle (F-03). Each one reaches the person it
	// is about on their user scope, so a deactivated member's own tabs switch
	// to the blocked screen without waiting for a poll.
	{Topic: "invitation.revoked", Version: 1, Payload: []string{"organization_id", "invitation_id"}, Scope: ScopeOrganization, Delivery: DeliveryOutbox},
	{Topic: "member.deactivated", Version: 1, Payload: []string{"organization_id", "user_id"}, Scope: ScopeUser, Delivery: DeliveryOutbox},
	{Topic: "member.reactivated", Version: 1, Payload: []string{"organization_id", "user_id"}, Scope: ScopeUser, Delivery: DeliveryOutbox},
	{Topic: "member.left", Version: 1, Payload: []string{"organization_id", "user_id"}, Scope: ScopeUser, Delivery: DeliveryOutbox},
	{Topic: "organization.ownership_transferred", Version: 1, Payload: []string{"organization_id", "user_id"}, Scope: ScopeUser, Delivery: DeliveryOutbox},

	// Directory and departments (F-03): everyone in the organization sees the
	// same list, so they refresh on the organization scope.
	{Topic: "profile.updated", Version: 1, Payload: []string{"organization_id", "user_id"}, Scope: ScopeOrganization, Delivery: DeliveryOutbox},
	{Topic: "department.created", Version: 1, Payload: []string{"organization_id", "department_id"}, Scope: ScopeOrganization, Delivery: DeliveryOutbox},
	{Topic: "department.updated", Version: 1, Payload: []string{"organization_id", "department_id"}, Scope: ScopeOrganization, Delivery: DeliveryOutbox},
	{Topic: "department.archived", Version: 1, Payload: []string{"organization_id", "department_id"}, Scope: ScopeOrganization, Delivery: DeliveryOutbox},
	// Exporting the directory is an audited act with nothing to redraw.
	{Topic: "people.exported", Version: 1, Payload: []string{"organization_id", "user_id"}, Scope: ScopeNone, Delivery: DeliveryOutbox},
	{Topic: "workspace.created", Version: 1, Payload: []string{"workspace_id", "organization_id"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "workspace.updated", Version: 1, Payload: []string{"workspace_id", "organization_id"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},

	// Chat room administration. Message create/update stay ephemeral-fast on
	// the chat scope; only room membership changes are durable events.
	{Topic: "chat.room.created", Version: 1, Payload: []string{"room_id"}, Scope: ScopeRoom, Delivery: DeliveryOutbox},
	{Topic: "chat.room.member_added", Version: 1, Payload: []string{"room_id", "user_id"}, Scope: ScopeRoom, Delivery: DeliveryOutbox},
	{Topic: "chat.room.member_removed", Version: 1, Payload: []string{"room_id", "user_id"}, Scope: ScopeRoom, Delivery: DeliveryOutbox},
	{Topic: "chat.room.updated", Version: 1, Payload: []string{"room_id", "workspace_id"}, Scope: ScopeWorkspace, Delivery: DeliveryEphemeral},
	{Topic: "chat.room.activity", Version: 1, Payload: []string{"room_id", "workspace_id"}, Scope: ScopeWorkspace, Delivery: DeliveryEphemeral},
	{Topic: "chat.message.created", Version: 1, Payload: []string{"room_id", "message_id"}, Scope: ScopeChat, Delivery: DeliveryEphemeral},
	{Topic: "chat.message.updated", Version: 1, Payload: []string{"room_id", "message_id"}, Scope: ScopeChat, Delivery: DeliveryEphemeral},
	{Topic: "chat.message.deleted", Version: 1, Payload: []string{"room_id", "message_id"}, Scope: ScopeChat, Delivery: DeliveryEphemeral},
	// A mention is addressed to the person mentioned, not to the room, so it
	// goes out on that user's own scope alongside the room's message event.
	{Topic: "chat.mention.created", Version: 1, Payload: []string{"room_id", "message_id", "sender_id"}, Scope: ScopeUser, Delivery: DeliveryEphemeral},
	{Topic: "chat.typing", Version: 1, Payload: []string{"room_id", "user_id"}, Scope: ScopeChat, Delivery: DeliveryEphemeral},
	{Topic: "chat.voice.invite", Version: 1, Payload: []string{"room_id", "user_id"}, Scope: ScopeUser, Delivery: DeliveryEphemeral},
	{Topic: "chat.voice.accept", Version: 1, Payload: []string{"room_id", "user_id"}, Scope: ScopeUser, Delivery: DeliveryEphemeral},
	{Topic: "chat.voice.hangup", Version: 1, Payload: []string{"room_id", "user_id"}, Scope: ScopeUser, Delivery: DeliveryEphemeral},

	// Meetings
	{Topic: "meeting.created", Version: 1, Payload: []string{"meeting_id", "version"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "meeting.updated", Version: 1, Payload: []string{"meeting_id", "version"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "meeting.deleted", Version: 1, Payload: []string{"meeting_id", "version"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "meeting.started", Version: 1, Payload: []string{"meeting_id", "version"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "meeting.ended", Version: 1, Payload: []string{"meeting_id", "version"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "meeting.canceled", Version: 1, Payload: []string{"meeting_id", "version"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "host.transferred", Version: 1, Payload: []string{"meeting_id", "version"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "participant.invited", Version: 1, Payload: []string{"meeting_id", "version"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "participant.removed", Version: 1, Payload: []string{"meeting_id", "version"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "invitation.responded", Version: 1, Payload: []string{"meeting_id", "version"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "join_request.created", Version: 1, Payload: []string{"meeting_id", "version"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "join_request.approved", Version: 1, Payload: []string{"meeting_id", "version"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "join_request.rejected", Version: 1, Payload: []string{"meeting_id", "version"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "join_request.canceled", Version: 1, Payload: []string{"meeting_id", "version"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "invite_link.revoked", Version: 1, Payload: []string{"meeting_id", "version"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "conference.session_ready", Version: 1, Payload: []string{"meeting_id", "version"}, Scope: ScopeWorkspace, Delivery: DeliveryEphemeral},
	{Topic: "transcript.appended", Version: 1, Payload: []string{"meeting_id"}, Scope: ScopeWorkspace, Delivery: DeliveryEphemeral},
	{Topic: "chat.message", Version: 1, Payload: []string{"meeting_id"}, Scope: ScopeWorkspace, Delivery: DeliveryEphemeral},
	{Topic: "summary.created", Version: 1, Payload: []string{"meeting_id"}, Scope: ScopeWorkspace, Delivery: DeliveryEphemeral},
	{Topic: "recording.started", Version: 1, Payload: []string{"meeting_id"}, Scope: ScopeWorkspace, Delivery: DeliveryEphemeral},
	{Topic: "recording.stopped", Version: 1, Payload: []string{"meeting_id"}, Scope: ScopeWorkspace, Delivery: DeliveryEphemeral},
	{Topic: "recording.ready", Version: 1, Payload: []string{"meeting_id"}, Scope: ScopeWorkspace, Delivery: DeliveryEphemeral},

	// Billing (F-02). Both go to each owner/admin, one row per person, because
	// the realtime consumer resolves user scope from payload.user_id.
	{Topic: "subscription.changed", Version: 1, Payload: []string{"organization_id", "subscription_id", "user_id"}, Scope: ScopeUser, Delivery: DeliveryOutbox},
	{Topic: "quota.threshold", Version: 1, Payload: []string{"organization_id", "user_id"}, Scope: ScopeUser, Delivery: DeliveryOutbox},

	// Notifications (F-07). created goes to the recipient's own connections so
	// the badge refreshes; push is infrastructure work for the push consumer.
	{Topic: "notification.created", Version: 1, Payload: []string{"notification_id", "user_id"}, Scope: ScopeUser, Delivery: DeliveryOutbox},
	{Topic: "notification.push", Version: 1, Payload: []string{"notification_id", "user_id"}, Scope: ScopeNone, Delivery: DeliveryOutbox},

	// AI gateway (F-09): a usage row completed; Settings → AI refreshes.
	{Topic: "ai.usage.updated", Version: 1, Payload: []string{"organization_id", "workspace_id"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},

	// Feature flags (F-11): every node drops its override cache.
	{Topic: "flag.updated", Version: 1, Payload: []string{"flag_key"}, Scope: ScopeNone, Delivery: DeliveryOutbox},

	// Audit itself
	{Topic: "audit.export_requested", Version: 1, Payload: []string{"export_id", "organization_id"}, Scope: ScopeNone, Delivery: DeliveryOutbox},
	{Topic: "audit.exported", Version: 1, Payload: []string{"export_id", "organization_id", "user_id"}, Scope: ScopeUser, Delivery: DeliveryOutbox},

	// Infrastructure. provider.* asks the conference provider to change a
	// room; webhook.deliver is reserved so an outbound-webhook consumer can be
	// added without renaming anything.
	{Topic: "provider.ensure_session", Version: 1, Payload: []string{"meeting_id", "room_name", "session_id"}, Scope: ScopeNone, Delivery: DeliveryOutbox},
	{Topic: "provider.remove_participant", Version: 1, Payload: []string{"room_name", "identity"}, Scope: ScopeNone, Delivery: DeliveryOutbox},
	{Topic: "provider.end_session", Version: 1, Payload: []string{"room_name"}, Scope: ScopeNone, Delivery: DeliveryOutbox},
	{Topic: "webhook.deliver", Version: 1, Payload: []string{"subscription_id", "event_id"}, Scope: ScopeNone, Delivery: DeliveryOutbox},
}

var byTopic = func() map[string]EventDef {
	m := make(map[string]EventDef, len(catalogue))
	for _, d := range catalogue {
		m[d.Topic] = d
	}
	return m
}()

// Catalogue returns every defined event, ordered by topic.
func Catalogue() []EventDef {
	out := append([]EventDef(nil), catalogue...)
	sort.Slice(out, func(i, j int) bool { return out[i].Topic < out[j].Topic })
	return out
}

// Lookup returns the definition for a topic.
func Lookup(topic string) (EventDef, bool) {
	d, ok := byTopic[topic]
	return d, ok
}

// RealtimeTopics are the outbox-delivered topics a realtime consumer serves:
// everything with a scope that is not published straight to the socket.
func RealtimeTopics() []string {
	var out []string
	for _, d := range Catalogue() {
		if d.Scope != ScopeNone && d.Delivery == DeliveryOutbox {
			out = append(out, d.Topic)
		}
	}
	return out
}
