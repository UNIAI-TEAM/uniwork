package projector

import (
	"sort"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/graph"
)

type topicRef struct {
	typ graph.NodeType
	key string // payload key holding the source id
}

// topicNodes is spec §5.2: which node an event makes dirty. Payloads carry
// ids only; the projector re-reads the source, so one id is enough.
var topicNodes = map[string]topicRef{
	"task.created":             {graph.NodeTask, "task_id"},
	"task.updated":             {graph.NodeTask, "task_id"},
	"task.deleted":             {graph.NodeTask, "task_id"},
	"chat.thread.linked":       {graph.NodeTask, "task_id"},
	"chat.thread.unlinked":     {graph.NodeTask, "task_id"},
	"meeting.created":          {graph.NodeMeeting, "meeting_id"},
	"meeting.updated":          {graph.NodeMeeting, "meeting_id"},
	"meeting.started":          {graph.NodeMeeting, "meeting_id"},
	"meeting.ended":            {graph.NodeMeeting, "meeting_id"},
	"meeting.canceled":         {graph.NodeMeeting, "meeting_id"},
	"meeting.deleted":          {graph.NodeMeeting, "meeting_id"},
	"participant.invited":      {graph.NodeMeeting, "meeting_id"},
	"participant.removed":      {graph.NodeMeeting, "meeting_id"},
	"join_request.approved":    {graph.NodeMeeting, "meeting_id"},
	"project.created":          {graph.NodeProject, "project_id"},
	"project.updated":          {graph.NodeProject, "project_id"},
	"project.deleted":          {graph.NodeProject, "project_id"},
	"member.joined":            {graph.NodeActor, "user_id"},
	"member.deactivated":       {graph.NodeActor, "user_id"},
	"member.reactivated":       {graph.NodeActor, "user_id"},
	"member.left":              {graph.NodeActor, "user_id"},
	"profile.updated":          {graph.NodeActor, "user_id"},
	"agent.created":            {graph.NodeActor, "agent_id"},
	"agent.updated":            {graph.NodeActor, "agent_id"},
	"agent.archived":           {graph.NodeActor, "agent_id"},
	"department.created":       {graph.NodeTeam, "department_id"},
	"department.updated":       {graph.NodeTeam, "department_id"},
	"department.archived":      {graph.NodeTeam, "department_id"},
	"chat.channel.created":     {graph.NodeThread, "room_id"},
	"chat.channel.updated":     {graph.NodeThread, "room_id"},
	"chat.channel.archived":    {graph.NodeThread, "room_id"},
	"chat.room.created":        {graph.NodeThread, "room_id"},
	"chat.room.member_added":   {graph.NodeThread, "room_id"},
	"chat.room.member_removed": {graph.NodeThread, "room_id"},
}

// Topics is every topic the marker listens to, sorted.
func Topics() []string {
	out := make([]string, 0, len(topicNodes))
	for t := range topicNodes {
		out = append(out, t)
	}
	sort.Strings(out)
	return out
}

// Refs returns the nodes one outbox row makes dirty.
func Refs(topic string, payload map[string]string) []NodeRef {
	tr, ok := topicNodes[topic]
	if !ok {
		return nil
	}
	id := strings.TrimSpace(payload[tr.key])
	if id == "" {
		return nil
	}
	return []NodeRef{{Type: tr.typ, SourceID: id}}
}
