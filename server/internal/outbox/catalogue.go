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
	// ScopeChat is a DM/group room scope, narrower than the workspace.
	ScopeChat Scope = "chat"
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

	// Organization and workspace membership
	{Topic: "organization.created", Version: 1, Payload: []string{"organization_id"}, Scope: ScopeUser, Delivery: DeliveryOutbox},
	{Topic: "organization.updated", Version: 1, Payload: []string{"organization_id"}, Scope: ScopeUser, Delivery: DeliveryOutbox},
	{Topic: "member.invited", Version: 1, Payload: []string{"organization_id", "user_id", "workspace_id"}, Scope: ScopeUser, Delivery: DeliveryOutbox},
	{Topic: "member.joined", Version: 1, Payload: []string{"organization_id", "user_id", "workspace_id"}, Scope: ScopeUser, Delivery: DeliveryOutbox},
	{Topic: "member.role_changed", Version: 1, Payload: []string{"organization_id", "user_id", "workspace_id"}, Scope: ScopeUser, Delivery: DeliveryOutbox},
	{Topic: "member.removed", Version: 1, Payload: []string{"organization_id", "user_id", "workspace_id"}, Scope: ScopeUser, Delivery: DeliveryOutbox},
	{Topic: "workspace.created", Version: 1, Payload: []string{"workspace_id", "organization_id"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "workspace.updated", Version: 1, Payload: []string{"workspace_id", "organization_id"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},

	// Chat room administration. Message create/update stay ephemeral-fast on
	// the chat scope; only room membership changes are durable events.
	{Topic: "chat.room.created", Version: 1, Payload: []string{"room_id", "workspace_id"}, Scope: ScopeWorkspace, Delivery: DeliveryOutbox},
	{Topic: "chat.room.updated", Version: 1, Payload: []string{"room_id", "workspace_id"}, Scope: ScopeWorkspace, Delivery: DeliveryEphemeral},
	{Topic: "chat.room.activity", Version: 1, Payload: []string{"room_id", "workspace_id"}, Scope: ScopeWorkspace, Delivery: DeliveryEphemeral},
	{Topic: "chat.message.created", Version: 1, Payload: []string{"room_id", "message_id"}, Scope: ScopeChat, Delivery: DeliveryEphemeral},
	{Topic: "chat.message.updated", Version: 1, Payload: []string{"room_id", "message_id"}, Scope: ScopeChat, Delivery: DeliveryEphemeral},
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
