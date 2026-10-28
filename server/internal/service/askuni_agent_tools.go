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
// error item has Kind "error", no Key, and Text "error: <code>". Body is the
// object's own words within Text, without the field lines: what a citation quotes.
// ID is the one object the item is (a task, a person...); empty for a note or error.
// Mine and Foreign serve the taint rules (R8) and never reach the model: Mine says
// everything the item shows is the asker's own or only a label; Foreign says the
// item carries words somebody else wrote that the object's audit trail cannot
// show (a comment, an AI summary).
type agentItem struct {
	Kind, Key, Title, Href, Text, Body, ID string
	Mine, Foreign                          bool
}

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

// agentRunFunc is agentTool.run.
type agentRunFunc = func(ctx context.Context, tc ai.ToolContext, args json.RawMessage) ([]agentItem, error)

// errAskReadsNotWired is a server fault, never the model's: main did not call
// SetReadTools.
var errAskReadsNotWired = errors.New("ask uni: read tools not wired")

// needsReads guards a tool that reads through the MCP connector's methods.
func (s *AskUNIService) needsReads(run agentRunFunc) agentRunFunc {
	return func(ctx context.Context, tc ai.ToolContext, args json.RawMessage) ([]agentItem, error) {
		if s.reads == nil {
			return nil, errAskReadsNotWired
		}
		return run(ctx, tc, args)
	}
}

// moreNote ends a list the service cut short. The loop does not number it as
// a source: it has no Key.
func moreNote(text string) agentItem { return agentItem{Kind: "note", Text: text} }

// oneLine keeps a body on its "- author (date): body" line.
func oneLine(v string) string { return strings.Join(strings.Fields(v), " ") }

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

func readTool(name, desc string, props map[string]agentProp, run agentRunFunc) agentTool {
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
		readTool("search", "Keyword search over the workspace's tasks, meetings, chat rooms the user belongs to and documents, best matches first. Use it when the question names a topic rather than an exact object. Documents hold the team's own procedures, policies and templates. Search here first before writing an email, a request or a template, then open the best match with get_document.",
			map[string]agentProp{"query": strArg("Keywords to look for, as the user would write them; \"\" lists the latest items.")}, s.agentSearch),
		readTool("list_tasks", "Tasks of the workspace matching every filter given, grouped by status. Overdue means due before today and not done or cancelled.",
			map[string]agentProp{
				"status":      strArg("A task status as the tools show it, such as Cần làm, or its key such as todo; \"\" for any."),
				"project_id":  strArg("A project id from list_projects; \"\" for any."),
				"assignee_id": strArg("A user id from list_members, or \"me\" for the user asking; \"\" for anyone."),
				"priority":    strArg("none, low, medium, high or urgent; \"\" for any."),
				"due_from":    strArg("Due on or after this date, YYYY-MM-DD; \"\" for no bound."),
				"due_to":      strArg("Due on or before this date, YYYY-MM-DD; \"\" for no bound."),
				"overdue":     boolArg("true for overdue tasks only."),
				"limit":       {"integer", "How many tasks, 1-50; 0 for 20."},
			}, s.needsReads(s.agentListTasks)),
		readTool("get_task", "One task with its description and latest comments.",
			map[string]agentProp{"task": strArg("The task's id or its PREFIX-N reference.")}, s.needsReads(s.agentGetTask)),
		readTool("list_meetings", "Meetings of the workspace starting between two times, in calendar order.",
			map[string]agentProp{
				"from":         strArg("ISO 8601 with offset, e.g. 2026-10-15T00:00:00+07:00; \"\" for 7 days before now (or 14 days before to)."),
				"to":           strArg("ISO 8601 with offset; \"\" for 7 days after now (or 14 days after from). At most 92 days after from."),
				"hosted_by_me": boolArg("true for meetings the user asking hosts."),
				"status":       strArg("SCHEDULED, IN_PROGRESS, ENDED, CANCELED or MISSED; \"\" for any."),
			}, s.needsReads(s.agentListMeetings)),
		readTool("get_meeting", "One meeting with its attendees, description and AI summary (decisions and action items). No transcript: get_meeting_transcript reads it.",
			map[string]agentProp{"meeting_id": strArg("The meeting's id.")}, s.needsReads(s.agentGetMeeting)),
		readTool(askToolTranscript, transcriptToolDesc, transcriptToolProps(), s.agentMeetingTranscript),
		readTool("list_projects", "Projects of the workspace, open ones unless asked otherwise, with task counts.",
			map[string]agentProp{
				"query":          strArg("Words in the title or description; \"\" lists all."),
				"include_closed": boolArg("true to include completed and cancelled projects."),
			}, s.needsReads(s.agentListProjects)),
		readTool("get_project", "One project with its description; its first 20 tasks follow as their own sources.",
			map[string]agentProp{"project_id": strArg("The project's id.")}, s.needsReads(s.agentGetProject)),
		readTool("get_document", "One document: a page as Markdown; a text file's text; a docx, xlsx, pptx, odt or csv file's text read paragraph by paragraph, slide by slide or row by row (no formatting); any other file's name and type.",
			map[string]agentProp{"document_id": strArg("The document's id.")}, s.needsReads(s.agentGetDocument)),
		readTool("list_documents", "Pages, files and folders directly under one folder or page of the workspace (the top level when parent_id is \"\"), in the order of the document tree, 50 at a time. Use it to browse a folder; open a row with get_document.",
			map[string]agentProp{
				"parent_id": strArg("A folder or page id from list_documents or search; \"\" for the top level."),
				"cursor":    strArg("The cursor a previous list_documents call gave; \"\" for the first page."),
			}, s.needsReads(s.agentListDocuments)),
		readTool("list_chat_rooms", "Chat rooms the user belongs to in the workspace: name, type and last activity.", nil, s.agentListChatRooms),
		readTool("read_chat_room", "The latest 30 messages of one chat room the user may read.",
			map[string]agentProp{
				"room_id": strArg("A room id from list_chat_rooms."),
				"query":   strArg("Keep only messages with these words; \"\" keeps all."),
			}, s.agentReadChatRoom),
		readTool("list_members", "Members of the workspace: name, role and user id.",
			map[string]agentProp{"query": strArg("Part of a name; \"\" lists everyone.")}, s.needsReads(s.agentListMembers)),
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

// sourceItem is a search or focus source as a tool item. Its text starts with
// the object's id, taken from the href, so the model can open it with the get_*
// tool: rendered sources show the title and excerpt, never the href.
func sourceItem(src ai.Source) agentItem {
	text := src.Excerpt
	id := sourceObjectID(src.Kind, src.Href)
	if id != "" {
		text = withText("ID: "+id, src.Excerpt)
	}
	return agentItem{Kind: src.Kind, Key: src.Href, Title: src.Title, Href: src.Href, Text: text, Body: src.Excerpt, ID: id}
}

// sourceObjectID is the id at the end of a source's href ("…/tasks/<id>",
// "…/meetings/<id>", "…/documents/<id>", "…/chat?room=<id>"); the members page
// names no single object.
func sourceObjectID(kind, href string) string {
	switch kind {
	case "chat":
		_, id, _ := strings.Cut(href, "?room=")
		return id
	case "task", "meeting", "document":
		return href[strings.LastIndexByte(href, '/')+1:]
	}
	return ""
}

func (s *AskUNIService) agentSearch(ctx context.Context, tc ai.ToolContext, raw json.RawMessage) ([]agentItem, error) {
	var a struct{ Query string }
	if err := agentArgs(raw, &a); err != nil {
		return nil, err
	}
	found, marks, err := s.searchWorkspaceMarks(ctx, tc, a.Query)
	if err != nil {
		return nil, err
	}
	out := make([]agentItem, 0, len(found))
	for _, src := range found {
		it := sourceItem(src)
		it.Mine = it.Kind == "chat" && marks.chatMine[src.Href]
		it.Foreign = marks.foreign[src.Href]
		out = append(out, it)
	}
	return out, nil
}

// taskLabels is what a task's text names by: the workspace's task prefix,
// member names, project titles and status labels.
type taskLabels struct {
	prefix                    string
	names, projects, statuses map[string]string
}

func (s *AskUNIService) taskLabels(ctx context.Context, tc ai.ToolContext, tasks []McpTask) (taskLabels, error) {
	w, err := s.q.GetWorkspaceWithOrg(ctx, tc.WorkspaceID)
	if err != nil {
		return taskLabels{}, err
	}
	l := taskLabels{prefix: w.TaskPrefix, names: s.memberNames(ctx, tc), projects: map[string]string{}, statuses: s.taskStatusLabels(ctx, tc)}
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
		l.ref(t), statusLabel(l.statuses, t.Status), orNone(t.Priority), orNone(t.DueDate), nameOf(l.names, t.AssigneeID), project)
	h := s.href(t.URL)
	return agentItem{Kind: "task", ID: t.ID, Key: h, Title: t.Title, Href: h, Text: withText(fields, text), Body: text}
}

func (s *AskUNIService) agentListTasks(ctx context.Context, tc ai.ToolContext, raw json.RawMessage) ([]agentItem, error) {
	in := mcpListTasksIn{}
	if err := agentArgs(raw, &in); err != nil {
		return nil, err
	}
	in.WorkspaceID = tc.WorkspaceID
	if in.Status != "" {
		// The model reads a status by its label (statusLabel) and may pass that back.
		in.Status = statusKey(s.taskStatusLabels(ctx, tc), in.Status)
	}
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
	if list.Truncated {
		out = append(out, moreNote("More tasks match than are listed; narrow the filters, or raise limit up to 50."))
	}
	return out, nil
}

func (s *AskUNIService) agentGetTask(ctx context.Context, tc ai.ToolContext, raw json.RawMessage) ([]agentItem, error) {
	var a struct{ Task string }
	if err := agentArgs(raw, &a); err != nil {
		return nil, err
	}
	if strings.TrimSpace(a.Task) == "" {
		return nil, McpInvalidArgs{Msg: "task is required"}
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
	foreign := false
	if t.Description != nil {
		b.WriteString(*t.Description)
	}
	if len(t.Comments) > 0 {
		if b.Len() > 0 {
			b.WriteString("\n")
		}
		b.WriteString("Comments:")
		for _, c := range t.Comments {
			foreign = foreign || c.authorID != tc.ActorID
			fmt.Fprintf(&b, "\n- %s (%s): %s", c.Author, c.CreatedAt[:len("2006-01-02")], oneLine(c.Body))
		}
	}
	it := s.taskItem(l, t, b.String())
	it.Foreign = foreign
	return []agentItem{it}, nil
}

func (s *AskUNIService) meetingItem(names map[string]string, m McpMeeting, extra, text string) agentItem {
	fields := fmt.Sprintf("ID: %s\nStatus: %s\nStarts: %s\nEnds: %s\nHost: %s%s", m.ID, statusLabel(viMeetingStatus, m.Status), orNone(m.StartsAt), orNone(m.EndsAt), nameOf(names, m.HostUserID), extra)
	h := s.href(m.URL)
	return agentItem{Kind: "meeting", ID: m.ID, Key: h, Title: m.Title, Href: h, Text: withText(fields, text), Body: text}
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
	if list.Truncated {
		out = append(out, moreNote("More meetings match than are listed; narrow from and to, or filter by status."))
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
	it := s.meetingItem(s.memberNames(ctx, tc), m, "\nAttendees: "+orNone(strings.Join(who, ", ")), strings.TrimPrefix(text, "\n"))
	it.Foreign = m.Excerpt != "" // the AI summary
	return []agentItem{it}, nil
}

func (s *AskUNIService) projectItem(names map[string]string, p McpProject, text string) agentItem {
	fields := fmt.Sprintf("ID: %s\nStatus: %s\nPriority: %s\nDue: %s\nLead: %s\nTask count: %d (%d done)",
		p.ID, statusLabel(viProjectStatus, p.Status), orNone(p.Priority), orNone(p.DueDate), nameOf(names, p.LeadID), p.TaskCount, p.DoneCount)
	h := s.href(p.URL)
	return agentItem{Kind: "project", ID: p.ID, Key: h, Title: p.Title, Href: h, Text: withText(fields, text), Body: text}
}

func (s *AskUNIService) agentListProjects(ctx context.Context, tc ai.ToolContext, raw json.RawMessage) ([]agentItem, error) {
	in := mcpListProjectsIn{}
	if err := agentArgs(raw, &in); err != nil {
		return nil, err
	}
	in.WorkspaceID = tc.WorkspaceID
	// A search honours include_closed itself; a plain list drops closed
	// projects before its cut, so open ones past it are not lost.
	in.openOnly = in.Query == "" && !in.IncludeClosed
	list, err := s.reads.ListProjects(ctx, principalOf(tc), in)
	if err != nil {
		return nil, err
	}
	names := s.memberNames(ctx, tc)
	out := make([]agentItem, 0, len(list.Projects)+1)
	for _, p := range list.Projects {
		out = append(out, s.projectItem(names, p, p.Excerpt))
	}
	if list.Truncated {
		out = append(out, moreNote("More projects match than are listed; narrow the query."))
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
	// The project's own title names its tasks' Project line; no ListProjects needed.
	l.projects[p.ID] = p.Title
	var b strings.Builder
	if p.Description != nil {
		b.WriteString(*p.Description)
	}
	out := []agentItem{s.projectItem(l.names, p, b.String())}
	if len(p.Tasks) > 0 {
		// Text only: Body is what a citation quotes to the person.
		out[0].Text = withText(out[0].Text, fmt.Sprintf("Its first %d tasks follow as their own sources.", len(p.Tasks)))
	}
	for _, t := range p.Tasks {
		out = append(out, s.taskItem(l, t, t.Excerpt))
	}
	if p.TaskCount > int64(len(p.Tasks)) {
		out = append(out, moreNote("The project has more tasks than are listed; use list_tasks with project_id for the rest."))
	}
	return out, nil
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
	// An uploaded file is somebody's document from outside, like an attachment:
	// no audit row says who wrote its text (R8).
	return []agentItem{{Kind: "document", ID: d.ID, Key: h, Title: d.Title, Href: h, Text: withText(fields, d.Content), Body: d.Content, Foreign: d.Filename != ""}}, nil
}

func (s *AskUNIService) agentListDocuments(ctx context.Context, tc ai.ToolContext, raw json.RawMessage) ([]agentItem, error) {
	var a struct {
		ParentID string `json:"parent_id"`
		Cursor   string `json:"cursor"`
	}
	if err := agentArgs(raw, &a); err != nil {
		return nil, err
	}
	l, err := s.reads.ListDocuments(ctx, principalOf(tc), mcpListDocumentsIn{WorkspaceID: tc.WorkspaceID, ParentID: a.ParentID, Cursor: a.Cursor})
	if err != nil {
		return nil, err
	}
	out := make([]agentItem, 0, len(l.Documents)+1)
	for _, d := range l.Documents {
		h := s.href(d.URL)
		// Like search's document rows: Foreign stays unset, authorship decides Mine.
		out = append(out, agentItem{Kind: "document", ID: d.ID, Key: h, Href: h, Title: d.Title, Text: "ID: " + d.ID + "\nType: " + d.DocKind})
	}
	if l.NextCursor != "" {
		out = append(out, moreNote("More documents follow; call list_documents again with cursor "+l.NextCursor+"."))
	}
	return out, nil
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
		out = append(out, agentItem{Kind: "chat", ID: r.ID, Key: h, Title: roomTitle(r), Href: h, Text: "ID: " + r.ID + "\nType: " + r.Kind + "\nLast activity: " + last, Mine: true}) // a label, no messages
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
	optOuts, err := loadAIOptOuts(ctx, s.q, chatSenderIDs(msgs))
	if err != nil {
		return nil, err
	}
	ts := searchTerms(a.Query)
	var b strings.Builder
	mine := true // every message shown is the asker's (R8)
	for _, m := range msgs {
		if a.Query != "" && score(m.Body, ts) == 0 {
			continue
		}
		// A member who declined AI processing never reaches the model or the connector (Apple 5.1.2(i)).
		if optOuts.excludes(m.SenderID) {
			continue
		}
		mine = mine && askerOwnWords(m, tc.ActorID)
		body := oneLine(m.Body)
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
	text := strings.TrimSuffix(b.String(), "\n")
	return []agentItem{{Kind: "chat", ID: a.RoomID, Key: h, Title: title, Href: h, Text: text, Body: text, Mine: mine}}, nil
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
	base, err := s.base(ctx, tc.WorkspaceID)
	if err != nil {
		return nil, err
	}
	out := make([]agentItem, 0, len(list.Members)+1)
	for _, m := range list.Members {
		out = append(out, personItem(base, m.UserID, m.Name, "Role: "+m.Role))
	}
	if list.Truncated {
		out = append(out, moreNote("More members match; narrow the query."))
	}
	return out, nil
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
	base, err := s.base(ctx, tc.WorkspaceID)
	if err != nil {
		return nil, err
	}
	out := make([]agentItem, 0, len(rows))
	for _, r := range rows {
		if names[r.AssigneeID] == "" { // not a member (any more): no person page to link
			continue
		}
		out = append(out, personItem(base, r.AssigneeID, names[r.AssigneeID], fmt.Sprintf("Open tasks: %d\nOverdue: %d", r.OpenCount, r.OverdueCount)))
	}
	return out, nil
}

// personItem is one person as a source: list_members and member_workload give
// the same person the same Key, so they share one S#.
func personItem(base, userID, name, text string) agentItem {
	h := base + "/people/" + userID
	return agentItem{Kind: "member", ID: userID, Key: h, Title: name, Href: h, Text: withText("ID: "+userID, text)}
}
