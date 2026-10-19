package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/ai"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The Ask UNI agent's tools (spec 2026-10-19 P1, rulings R6/R7). Every tool
// reads, as the asker, only the workspace the question was asked in
// (tc.WorkspaceID); the model never names a workspace. Eight of them call the
// MCP connector's read methods, so the two share one read path and one set
// of filters; chat, members and workload are Ask UNI's own. Nothing here
// writes: TestAskAgentToolsAreReadOnly pins the registry.

// agentItem is one thing a tool found. Key is its identity across a
// conversation, the Href, so the same task keeps its S# on every turn. An
// error item has Kind "error", no Key, and Text "error: <code>".
type agentItem struct{ Kind, Key, Title, Href, Text string }

// agentTool is a read tool the agent loop runs itself: Handle stays nil.
type agentTool struct {
	ai.Tool
	run func(ctx context.Context, tc ai.ToolContext, args json.RawMessage) ([]agentItem, error)
}

// agentRegistry is what the gateway sends the model.
func agentRegistry(ts []agentTool) ai.Registry {
	r := make(ai.Registry, 0, len(ts))
	for _, t := range ts {
		r = append(r, t.Tool)
	}
	return r
}

type agentProp struct {
	Type        string `json:"type"`
	Description string `json:"description"`
}

// agentSchema is a strict-safe schema: flat scalars, every one required, no
// others. encoding/json writes map keys sorted and required is sorted, so the
// bytes never change between builds (they are part of the cache prefix).
func agentSchema(props map[string]agentProp) json.RawMessage {
	if props == nil {
		props = map[string]agentProp{}
	}
	b, _ := json.Marshal(struct {
		Type                 string               `json:"type"`
		Properties           map[string]agentProp `json:"properties"`
		Required             []string             `json:"required"`
		AdditionalProperties bool                 `json:"additionalProperties"`
	}{"object", props, append([]string{}, slices.Sorted(maps.Keys(props))...), false})
	return b
}

func strArg(desc string) agentProp  { return agentProp{"string", desc} }
func boolArg(desc string) agentProp { return agentProp{"boolean", desc} }

// agentError is the code a tool failure reads as, when the model can act on
// it: absent or not the asker's to see (one answer for both), a bad argument
// with what to fix, or a refusal code such as documents_unavailable. Anything
// else (a database down, a cancelled run) stays a Go error.
func agentError(err error) (string, bool) {
	err = mcpMapError(err)
	var invalid McpInvalidArgs
	var refusal McpToolError
	switch {
	case errors.Is(err, ErrNotFound):
		return "not_found", true
	case errors.As(err, &invalid):
		return "invalid_args: " + invalid.Msg, true
	case errors.As(err, &refusal):
		return refusal.Code, true
	}
	return "", false
}

func readTool(name, desc string, props map[string]agentProp, run func(context.Context, ai.ToolContext, json.RawMessage) ([]agentItem, error)) agentTool {
	return agentTool{
		Tool: ai.Tool{Name: name, Description: desc, Kind: ai.ToolRead, Risk: ai.RiskLow, Schema: agentSchema(props), Strict: true},
		run: func(ctx context.Context, tc ai.ToolContext, args json.RawMessage) ([]agentItem, error) {
			items, err := run(ctx, tc, args)
			if err == nil {
				return items, nil
			}
			if code, ok := agentError(err); ok {
				return []agentItem{{Kind: "error", Text: "error: " + code}}, nil
			}
			return nil, err
		},
	}
}

// agentArgs decodes a call's arguments; strict mode makes a mismatch rare.
func agentArgs(raw json.RawMessage, v any) error {
	if err := json.Unmarshal(raw, v); err != nil {
		return McpInvalidArgs{Msg: "arguments must match the tool's schema"}
	}
	return nil
}

// agentTools is the agent's registry, in a fixed order: it is part of the
// prompt-cache prefix (TestAskAgentToolBytesAreStable).
func (s *AskUNIService) agentTools() []agentTool {
	return []agentTool{
		readTool("search", "Keyword search over the workspace's tasks, meetings, chat rooms the user belongs to and documents, best matches first. Use it when the question names a topic rather than an exact object.",
			map[string]agentProp{"query": strArg("Keywords to look for, as the user would write them; \"\" lists the latest items.")}, s.agentSearch),
		readTool("list_tasks", "Tasks of the workspace matching every filter given, grouped by status. Overdue means due before today and not done or cancelled.",
			map[string]agentProp{
				"status":      strArg("A task status key such as todo, in_progress or done; \"\" for any."),
				"project_id":  strArg("A project id from list_projects; \"\" for any."),
				"assignee_id": strArg("A user id from list_members, or \"me\" for the user asking; \"\" for anyone."),
				"priority":    strArg("none, low, medium, high or urgent; \"\" for any."),
				"due_from":    strArg("Due on or after this date, YYYY-MM-DD; \"\" for no bound."),
				"due_to":      strArg("Due on or before this date, YYYY-MM-DD; \"\" for no bound."),
				"overdue":     boolArg("true for overdue tasks only."),
				"limit":       {"integer", "How many tasks, 1-50; 0 for 20."},
			}, s.agentListTasks),
		readTool("get_task", "One task with its description and latest comments.",
			map[string]agentProp{"task": strArg("The task's id or its PREFIX-N reference.")}, s.agentGetTask),
		readTool("list_meetings", "Meetings of the workspace starting between two times, in calendar order.",
			map[string]agentProp{
				"from":         strArg("ISO 8601 with offset, e.g. 2026-10-15T00:00:00+07:00; \"\" for 7 days before now (or 14 days before to)."),
				"to":           strArg("ISO 8601 with offset; \"\" for 7 days after now (or 14 days after from). At most 92 days after from."),
				"hosted_by_me": boolArg("true for meetings the user asking hosts."),
				"status":       strArg("SCHEDULED, IN_PROGRESS, ENDED, CANCELED or MISSED; \"\" for any."),
			}, s.agentListMeetings),
		readTool("get_meeting", "One meeting with its attendees, description and AI summary (decisions and action items). No transcript.",
			map[string]agentProp{"meeting_id": strArg("The meeting's id.")}, s.agentGetMeeting),
		readTool("list_projects", "Projects of the workspace, open ones unless asked otherwise, with task counts.",
			map[string]agentProp{
				"query":          strArg("Words in the title or description; \"\" lists all."),
				"include_closed": boolArg("true to include completed and cancelled projects."),
			}, s.agentListProjects),
		readTool("get_project", "One project with its description and its first 20 tasks.",
			map[string]agentProp{"project_id": strArg("The project's id.")}, s.agentGetProject),
		readTool("get_document", "One document: a page as Markdown, a text file's text, or another file's name and type.",
			map[string]agentProp{"document_id": strArg("The document's id.")}, s.agentGetDocument),
		readTool("list_chat_rooms", "Chat rooms the user belongs to in the workspace: name, type and last activity.", nil, s.agentListChatRooms),
		readTool("read_chat_room", "The latest 30 messages of one chat room the user may read.",
			map[string]agentProp{
				"room_id": strArg("A room id from list_chat_rooms."),
				"query":   strArg("Keep only messages with these words; \"\" keeps all."),
			}, s.agentReadChatRoom),
		readTool("list_members", "Members of the workspace: name, role and user id.",
			map[string]agentProp{"query": strArg("Part of a name; \"\" lists everyone.")}, s.agentListMembers),
		readTool("member_workload", "Open and overdue task counts per member of the workspace, most overdue first.", nil, s.agentMemberWorkload),
	}
}

func orNone(v string) string {
	if v == "" {
		return "none"
	}
	return v
}

// nameOf is a member's name by id, never an email.
func nameOf(names map[string]string, id string) string {
	if id == "" {
		return "none"
	}
	if n := names[id]; n != "" {
		return n
	}
	return "unknown"
}

// href is an MCP item's URL as the app path a source carries.
func (s *AskUNIService) href(url string) string { return strings.TrimPrefix(url, s.reads.frontend) }

// withText appends a block of text after the field lines when there is one.
func withText(fields, text string) string {
	if text == "" {
		return fields
	}
	return fields + "\n" + text
}

func (s *AskUNIService) agentSearch(ctx context.Context, tc ai.ToolContext, raw json.RawMessage) ([]agentItem, error) {
	var a struct{ Query string }
	if err := agentArgs(raw, &a); err != nil {
		return nil, err
	}
	found, err := s.searchWorkspace(ctx, tc, a.Query)
	if err != nil {
		return nil, err
	}
	out := make([]agentItem, 0, len(found))
	for _, src := range found {
		out = append(out, agentItem{Kind: src.Kind, Key: src.Href, Title: src.Title, Href: src.Href, Text: src.Excerpt})
	}
	return out, nil
}

// taskLabels is what a task's text names by: the workspace's task prefix,
// member names and project titles.
type taskLabels struct {
	prefix          string
	names, projects map[string]string
}

func (s *AskUNIService) taskLabels(ctx context.Context, tc ai.ToolContext, tasks []McpTask) (taskLabels, error) {
	w, err := s.q.GetWorkspaceWithOrg(ctx, tc.WorkspaceID)
	if err != nil {
		return taskLabels{}, err
	}
	l := taskLabels{prefix: w.TaskPrefix, names: s.memberNames(ctx, tc), projects: map[string]string{}}
	if !slices.ContainsFunc(tasks, func(t McpTask) bool { return t.ProjectID != "" }) {
		return l, nil
	}
	prs, err := s.tasks.ListProjects(ctx, Human(tc.ActorID), tc.WorkspaceID, ListProjectsFilter{})
	if err != nil {
		return taskLabels{}, err
	}
	for _, p := range prs {
		l.projects[p.ID] = p.Title
	}
	return l, nil
}

func (l taskLabels) ref(t McpTask) string { return l.prefix + "-" + strconv.FormatInt(t.number, 10) }

func (s *AskUNIService) taskItem(l taskLabels, t McpTask, text string) agentItem {
	project := "none"
	if t.ProjectID != "" {
		project = orNone(l.projects[t.ProjectID]) + " (" + t.ProjectID + ")"
	}
	fields := fmt.Sprintf("Ref: %s\nStatus: %s\nPriority: %s\nDue: %s\nAssignee: %s\nProject: %s",
		l.ref(t), t.Status, orNone(t.Priority), orNone(t.DueDate), nameOf(l.names, t.AssigneeID), project)
	h := s.href(t.URL)
	return agentItem{Kind: "task", Key: h, Title: t.Title, Href: h, Text: withText(fields, text)}
}

func (s *AskUNIService) agentListTasks(ctx context.Context, tc ai.ToolContext, raw json.RawMessage) ([]agentItem, error) {
	in := mcpListTasksIn{}
	if err := agentArgs(raw, &in); err != nil {
		return nil, err
	}
	in.WorkspaceID = tc.WorkspaceID
	list, err := s.reads.ListTasks(ctx, principalOf(tc), in)
	if err != nil {
		return nil, err
	}
	l, err := s.taskLabels(ctx, tc, list.Tasks)
	if err != nil {
		return nil, err
	}
	out := make([]agentItem, 0, len(list.Tasks))
	for _, t := range list.Tasks {
		out = append(out, s.taskItem(l, t, t.Excerpt))
	}
	return out, nil
}

func (s *AskUNIService) agentGetTask(ctx context.Context, tc ai.ToolContext, raw json.RawMessage) ([]agentItem, error) {
	var a struct{ Task string }
	if err := agentArgs(raw, &a); err != nil {
		return nil, err
	}
	t, err := s.reads.GetTask(ctx, principalOf(tc), tc.WorkspaceID, a.Task)
	if err != nil {
		return nil, err
	}
	l, err := s.taskLabels(ctx, tc, []McpTask{t})
	if err != nil {
		return nil, err
	}
	var b strings.Builder
	if t.Description != nil {
		b.WriteString(*t.Description)
	}
	if len(t.Comments) > 0 {
		if b.Len() > 0 {
			b.WriteString("\n")
		}
		b.WriteString("Comments:")
		for _, c := range t.Comments {
			fmt.Fprintf(&b, "\n- %s (%s): %s", c.Author, c.CreatedAt[:len("2006-01-02")], c.Body)
		}
	}
	return []agentItem{s.taskItem(l, t, b.String())}, nil
}

func (s *AskUNIService) meetingItem(names map[string]string, m McpMeeting, extra, text string) agentItem {
	fields := fmt.Sprintf("ID: %s\nStatus: %s\nStarts: %s\nEnds: %s\nHost: %s%s", m.ID, m.Status, orNone(m.StartsAt), orNone(m.EndsAt), nameOf(names, m.HostUserID), extra)
	h := s.href(m.URL)
	return agentItem{Kind: "meeting", Key: h, Title: m.Title, Href: h, Text: withText(fields, text)}
}

func (s *AskUNIService) agentListMeetings(ctx context.Context, tc ai.ToolContext, raw json.RawMessage) ([]agentItem, error) {
	in := mcpListMeetingsIn{}
	if err := agentArgs(raw, &in); err != nil {
		return nil, err
	}
	// An open end is a 14-day window: around now, or from the end given.
	const week = 7 * 24 * time.Hour
	if in.From == "" || in.To == "" {
		center := s.now()
		if in.From != "" {
			from, err := mcpParseTime("from", in.From)
			if err != nil {
				return nil, err
			}
			center = from.Add(week)
		}
		if in.To != "" {
			to, err := mcpParseTime("to", in.To)
			if err != nil {
				return nil, err
			}
			center = to.Add(-week)
		}
		in.From, in.To = center.Add(-week).Format(time.RFC3339), center.Add(week).Format(time.RFC3339)
	}
	in.WorkspaceID = tc.WorkspaceID
	list, err := s.reads.ListMeetings(ctx, principalOf(tc), in)
	if err != nil {
		return nil, err
	}
	names := s.memberNames(ctx, tc)
	out := make([]agentItem, 0, len(list.Meetings))
	for _, m := range list.Meetings {
		out = append(out, s.meetingItem(names, m, "", m.Excerpt))
	}
	return out, nil
}

func (s *AskUNIService) agentGetMeeting(ctx context.Context, tc ai.ToolContext, raw json.RawMessage) ([]agentItem, error) {
	var a struct {
		MeetingID string `json:"meeting_id"`
	}
	if err := agentArgs(raw, &a); err != nil {
		return nil, err
	}
	m, err := s.reads.GetMeeting(ctx, principalOf(tc), tc.WorkspaceID, a.MeetingID)
	if err != nil {
		return nil, err
	}
	var who []string
	for _, at := range m.Attendees {
		if at.Status != "REMOVED" {
			who = append(who, at.Name+" ("+strings.ToLower(at.Role)+")")
		}
	}
	text := ""
	if m.Description != nil {
		text = *m.Description
	}
	if m.Excerpt != "" {
		text = withText(text, "Summary:\n"+m.Excerpt)
	}
	return []agentItem{s.meetingItem(s.memberNames(ctx, tc), m, "\nAttendees: "+orNone(strings.Join(who, ", ")), strings.TrimPrefix(text, "\n"))}, nil
}

func (s *AskUNIService) projectItem(names map[string]string, p McpProject, text string) agentItem {
	fields := fmt.Sprintf("ID: %s\nStatus: %s\nPriority: %s\nDue: %s\nLead: %s\nTask count: %d (%d done)",
		p.ID, p.Status, orNone(p.Priority), orNone(p.DueDate), nameOf(names, p.LeadID), p.TaskCount, p.DoneCount)
	h := s.href(p.URL)
	return agentItem{Kind: "project", Key: h, Title: p.Title, Href: h, Text: withText(fields, text)}
}

func (s *AskUNIService) agentListProjects(ctx context.Context, tc ai.ToolContext, raw json.RawMessage) ([]agentItem, error) {
	in := mcpListProjectsIn{}
	if err := agentArgs(raw, &in); err != nil {
		return nil, err
	}
	in.WorkspaceID = tc.WorkspaceID
	list, err := s.reads.ListProjects(ctx, principalOf(tc), in)
	if err != nil {
		return nil, err
	}
	names := s.memberNames(ctx, tc)
	out := make([]agentItem, 0, len(list.Projects))
	for _, p := range list.Projects {
		// A search honours include_closed itself; a plain list returns every status.
		if in.Query == "" && !in.IncludeClosed && (p.Status == "completed" || p.Status == "cancelled") {
			continue
		}
		out = append(out, s.projectItem(names, p, p.Excerpt))
	}
	return out, nil
}

func (s *AskUNIService) agentGetProject(ctx context.Context, tc ai.ToolContext, raw json.RawMessage) ([]agentItem, error) {
	in := mcpProjectRef{}
	if err := agentArgs(raw, &in); err != nil {
		return nil, err
	}
	in.WorkspaceID = tc.WorkspaceID
	p, err := s.reads.GetProject(ctx, principalOf(tc), in)
	if err != nil {
		return nil, err
	}
	l, err := s.taskLabels(ctx, tc, nil)
	if err != nil {
		return nil, err
	}
	var b strings.Builder
	if p.Description != nil {
		b.WriteString(*p.Description)
	}
	if len(p.Tasks) > 0 {
		if b.Len() > 0 {
			b.WriteString("\n")
		}
		b.WriteString("Tasks:")
		for _, t := range p.Tasks {
			fmt.Fprintf(&b, "\n- %s %s (%s)", l.ref(t), t.Title, t.Status)
		}
	}
	return []agentItem{s.projectItem(l.names, p, b.String())}, nil
}

func (s *AskUNIService) agentGetDocument(ctx context.Context, tc ai.ToolContext, raw json.RawMessage) ([]agentItem, error) {
	in := mcpDocumentRef{}
	if err := agentArgs(raw, &in); err != nil {
		return nil, err
	}
	in.WorkspaceID = tc.WorkspaceID
	d, err := s.reads.GetDocument(ctx, principalOf(tc), in)
	if err != nil {
		return nil, err
	}
	fields := "ID: " + d.ID + "\nType: " + d.DocKind
	if d.Filename != "" {
		fields += "\nFile: " + d.Filename + " (" + d.MimeType + ")"
	}
	if d.Note != "" {
		fields += "\nNote: " + d.Note
	}
	h := s.href(d.URL)
	return []agentItem{{Kind: "document", Key: h, Title: d.Title, Href: h, Text: withText(fields, d.Content)}}, nil
}

// roomTitle is what the sidebar calls a room: its name, else the dm peer's.
func roomTitle(r ChatRoomSummary) string {
	if r.Name != "" {
		return r.Name
	}
	return orNone(r.PeerDisplayName)
}

func (s *AskUNIService) agentListChatRooms(ctx context.Context, tc ai.ToolContext, _ json.RawMessage) ([]agentItem, error) {
	rooms, err := s.chat.ListChatRooms(ctx, tc.ActorID, tc.WorkspaceID)
	if err != nil {
		return nil, err
	}
	base, err := s.base(ctx, tc.WorkspaceID)
	if err != nil {
		return nil, err
	}
	out := make([]agentItem, 0, len(rooms))
	for _, r := range rooms {
		last := "none"
		if r.LastMessageAt != nil {
			last = r.LastMessageAt.UTC().Format(time.RFC3339)
		}
		h := base + "/chat?room=" + r.ID
		out = append(out, agentItem{Kind: "chat", Key: h, Title: roomTitle(r), Href: h, Text: "ID: " + r.ID + "\nType: " + r.Kind + "\nLast activity: " + last})
	}
	return out, nil
}

// agentChatMessages is how many of a room's latest messages read_chat_room reads.
const agentChatMessages = 30

func (s *AskUNIService) agentReadChatRoom(ctx context.Context, tc ai.ToolContext, raw json.RawMessage) ([]agentItem, error) {
	var a struct {
		RoomID string `json:"room_id"`
		Query  string
	}
	if err := agentArgs(raw, &a); err != nil {
		return nil, err
	}
	if strings.TrimSpace(a.RoomID) == "" {
		return nil, McpInvalidArgs{Msg: "room_id is required"}
	}
	// Reading for an answer is not opening the room: the read pointer stays.
	msgs, err := s.chat.ListRoomMessages(ctx, tc.ActorID, tc.WorkspaceID, a.RoomID, ListChatMessagesInput{Limit: agentChatMessages, SkipMarkRead: true})
	if err != nil {
		return nil, err
	}
	ts := searchTerms(a.Query)
	var b strings.Builder
	for _, m := range msgs {
		if a.Query != "" && score(m.Body, ts) == 0 {
			continue
		}
		body := m.Body
		if body == "" {
			body = "[" + m.Kind + "]"
		}
		fmt.Fprintf(&b, "- %s (%s): %s\n", m.SenderDisplayName, m.CreatedAt.UTC().Format("2006-01-02 15:04"), body)
	}
	if b.Len() == 0 {
		return nil, nil
	}
	rooms, err := s.chat.ListChatRooms(ctx, tc.ActorID, tc.WorkspaceID)
	if err != nil {
		return nil, err
	}
	title := "Chat"
	for _, r := range rooms {
		if r.ID == a.RoomID {
			title = "Chat: " + roomTitle(r)
		}
	}
	base, err := s.base(ctx, tc.WorkspaceID)
	if err != nil {
		return nil, err
	}
	h := base + "/chat?room=" + a.RoomID
	return []agentItem{{Kind: "chat", Key: h, Title: title, Href: h, Text: strings.TrimSuffix(b.String(), "\n")}}, nil
}

func (s *AskUNIService) agentListMembers(ctx context.Context, tc ai.ToolContext, raw json.RawMessage) ([]agentItem, error) {
	var a struct{ Query string }
	if err := agentArgs(raw, &a); err != nil {
		return nil, err
	}
	list, err := s.reads.ListMembers(ctx, principalOf(tc), mcpListMembersIn{WorkspaceID: tc.WorkspaceID, Query: a.Query})
	if err != nil {
		return nil, err
	}
	if len(list.Members) == 0 {
		return nil, nil
	}
	var b strings.Builder
	for _, m := range list.Members {
		fmt.Fprintf(&b, "- %s (%s), user id %s\n", m.Name, m.Role, m.UserID)
	}
	if list.Truncated {
		b.WriteString("More members match; narrow the query.\n")
	}
	base, err := s.base(ctx, tc.WorkspaceID)
	if err != nil {
		return nil, err
	}
	return []agentItem{{Kind: "members", Key: base + "/members", Title: "Thành viên workspace", Href: base + "/members", Text: strings.TrimSuffix(b.String(), "\n")}}, nil
}

// agentMemberWorkload counts open tasks per assignee. The query is not a
// service read, so RequireMember runs first and names the organization.
func (s *AskUNIService) agentMemberWorkload(ctx context.Context, tc ai.ToolContext, _ json.RawMessage) ([]agentItem, error) {
	m, err := s.ws.RequireMember(ctx, tc.WorkspaceID, tc.ActorID)
	if err != nil {
		return nil, err
	}
	rows, err := s.q.CountOpenTasksByAssignee(ctx, db.CountOpenTasksByAssigneeParams{
		Today:          pgtype.Date{Time: s.now().UTC().Truncate(24 * time.Hour), Valid: true},
		OrganizationID: m.OrganizationID, WorkspaceID: tc.WorkspaceID,
	})
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	names := s.memberNames(ctx, tc)
	var b strings.Builder
	for _, r := range rows {
		fmt.Fprintf(&b, "- %s: %d open, %d overdue\n", nameOf(names, r.AssigneeID), r.OpenCount, r.OverdueCount)
	}
	base, err := s.base(ctx, tc.WorkspaceID)
	if err != nil {
		return nil, err
	}
	return []agentItem{{Kind: "workload", Key: base + "/tasks", Title: "Khối lượng việc", Href: base + "/tasks", Text: strings.TrimSuffix(b.String(), "\n")}}, nil
}
