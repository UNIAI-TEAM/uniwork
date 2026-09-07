package service

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"
	"unicode"

	"github.com/unicomhub/uniwork/server/internal/ai"
)

// The Ask UNI tool registry (spec F-09 §3.4) and the permission-aware source
// reader behind it (§3.5). Every handler runs as the asker: it calls the
// same service methods a screen would, so RequireMember decides what comes
// back and there is no system-privilege read path. Phase F registers read
// tools only — TestAskUniToolsAreReadOnly pins MutationCount() == 0.

const (
	askToolSearch  = "search_workspace"
	askToolTask    = "get_task_context"
	askToolMeeting = "get_meeting_context"
	askToolMember  = "get_member_context"
	askToolChat    = "get_chat_context"
)

var objectSchema = json.RawMessage(`{"type":"object","properties":{"query":{"type":"string"},"id":{"type":"string"}}}`)

// AskUniTools is the registry Ask UNI hands the gateway. It is a function of
// the service so handlers can close over it; the list itself never changes
// at runtime.
func AskUniTools(s *AskUNIService) ai.Registry {
	read := func(name, desc string, fn func(context.Context, ai.ToolContext, string) ([]ai.Source, error)) ai.Tool {
		return ai.Tool{
			Name: name, Description: desc, Kind: ai.ToolRead, Risk: ai.RiskLow, Schema: objectSchema,
			Handle: func(ctx context.Context, tc ai.ToolContext, input json.RawMessage) (json.RawMessage, error) {
				var in struct {
					Query string `json:"query"`
					ID    string `json:"id"`
				}
				_ = json.Unmarshal(input, &in)
				arg := in.Query
				if in.ID != "" {
					arg = in.ID
				}
				out, err := fn(ctx, tc, arg)
				if err != nil {
					return nil, err
				}
				return json.Marshal(out)
			},
		}
	}
	return ai.Registry{
		read(askToolSearch, "Tasks, meetings and chat in the workspace that match a query", s.searchWorkspace),
		read(askToolTask, "One task with its comments", s.taskContext),
		read(askToolMeeting, "One meeting with its summary", s.meetingContext),
		read(askToolMember, "Workspace members by name and role", s.memberContext),
		read(askToolChat, "Recent messages in rooms the asker belongs to", s.chatContext),
	}
}

// Sources implements ai.SourceReader: the focus object first, then the best
// matches, capped by ai.BuildContext downstream.
func (s *AskUNIService) Sources(ctx context.Context, in ai.SourceQuery) ([]ai.Source, error) {
	tc := ai.ToolContext{ActorID: in.UserID, OrganizationID: in.OrganizationID, WorkspaceID: in.WorkspaceID}
	var out []ai.Source
	if in.Focus != nil {
		var fn func(context.Context, ai.ToolContext, string) ([]ai.Source, error)
		switch in.Focus.Kind {
		case "task":
			fn = s.taskContext
		case "meeting":
			fn = s.meetingContext
		}
		if fn != nil {
			focus, err := fn(ctx, tc, in.Focus.ID)
			if err != nil {
				return nil, err
			}
			out = append(out, focus...)
		}
	}
	found, err := s.searchWorkspace(ctx, tc, in.Question)
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	for _, src := range out {
		seen[src.Href] = true
	}
	for _, src := range found {
		if !seen[src.Href] {
			out = append(out, src)
			seen[src.Href] = true
		}
	}
	return out, nil
}

// ---- scoring ------------------------------------------------------------

// ponytail: keyword overlap; swap for the A-04 search index when it exists.
func terms(q string) []string {
	fields := strings.FieldsFunc(strings.ToLower(q), func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) })
	out := fields[:0]
	for _, f := range fields {
		if len([]rune(f)) >= 2 {
			out = append(out, f)
		}
	}
	return out
}

func score(text string, ts []string) int {
	low := strings.ToLower(text)
	n := 0
	for _, t := range ts {
		if strings.Contains(low, t) {
			n++
		}
	}
	return n
}

func asksOverdue(q string) bool {
	low := strings.ToLower(q)
	for _, k := range []string{"quá hạn", "qua han", "trễ hạn", "overdue", "late", "trễ"} {
		if strings.Contains(low, k) {
			return true
		}
	}
	return false
}

func asksMembers(q string) bool {
	low := strings.ToLower(q)
	for _, k := range []string{"thành viên", "thanh vien", "member", "ai ", "who", "nhân sự", "đội"} {
		if strings.Contains(low, k) {
			return true
		}
	}
	return false
}

type scored struct {
	src   ai.Source
	score int
	when  time.Time
}

func topSources(items []scored, limit int) []ai.Source {
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].score != items[j].score {
			return items[i].score > items[j].score
		}
		return items[i].when.After(items[j].when)
	})
	out := make([]ai.Source, 0, limit)
	for _, it := range items {
		if len(out) == limit {
			break
		}
		out = append(out, it.src)
	}
	return out
}

// ---- tool handlers -------------------------------------------------------

func (s *AskUNIService) base(ctx context.Context, workspaceID string) (string, error) {
	w, err := s.q.GetWorkspaceWithOrg(ctx, workspaceID)
	if err != nil {
		return "", err
	}
	return "/" + w.OrganizationSlug + "/" + w.Slug, nil
}

func (s *AskUNIService) memberNames(ctx context.Context, tc ai.ToolContext) map[string]string {
	names := map[string]string{}
	rows, err := s.ws.Members(ctx, tc.ActorID, tc.WorkspaceID)
	if err != nil {
		return names
	}
	for _, r := range rows {
		names[r.UserID] = r.DisplayName
	}
	return names
}

func (s *AskUNIService) searchWorkspace(ctx context.Context, tc ai.ToolContext, query string) ([]ai.Source, error) {
	base, err := s.base(ctx, tc.WorkspaceID)
	if err != nil {
		return nil, err
	}
	ts := terms(query)
	overdue := asksOverdue(query)
	today := s.now().UTC().Truncate(24 * time.Hour)
	names := s.memberNames(ctx, tc)
	var items []scored

	tasks, err := s.tasks.List(ctx, tc.ActorID, tc.WorkspaceID)
	if err != nil {
		return nil, err
	}
	for _, t := range tasks {
		sc := score(t.Title+" "+t.Description, ts)
		isOverdue := t.DueDate.Valid && t.DueDate.Time.Before(today) && t.Status != "done"
		if overdue && isOverdue {
			sc += 3
		}
		if t.AssigneeID.Valid && score(names[t.AssigneeID.String], ts) > 0 {
			sc += 2
		}
		if sc == 0 && !(overdue && isOverdue) && len(ts) > 0 {
			continue
		}
		items = append(items, scored{src: taskSource(base, t, names), score: sc, when: t.UpdatedAt.Time})
	}

	meetings, err := s.meetings.List(ctx, tc.ActorID, tc.WorkspaceID)
	if err != nil {
		return nil, err
	}
	for _, m := range meetings {
		sc := score(m.Title+" "+m.Description, ts)
		if sc == 0 && len(ts) > 0 {
			continue
		}
		items = append(items, scored{src: ai.Source{
			Kind: "meeting", Title: m.Title, Href: base + "/meetings/" + m.ID,
			Excerpt: fmt.Sprintf("Trạng thái: %s · Bắt đầu: %s\n%s", m.Status, m.StartsAt.Time.Format(time.RFC3339), m.Description),
		}, score: sc, when: m.StartsAt.Time})
	}

	chat, err := s.chatContext(ctx, tc, query)
	if err != nil {
		return nil, err
	}
	for _, c := range chat {
		items = append(items, scored{src: c, score: 1, when: s.now()})
	}
	if asksMembers(query) {
		members, err := s.memberContext(ctx, tc, query)
		if err != nil {
			return nil, err
		}
		for _, m := range members {
			items = append(items, scored{src: m, score: 1})
		}
	}
	return topSources(items, ai.MaxSources), nil
}

func taskSource(base string, t taskRow, names map[string]string) ai.Source {
	var b strings.Builder
	fmt.Fprintf(&b, "Trạng thái: %s · Ưu tiên: %s", t.Status, t.Priority)
	if t.DueDate.Valid {
		fmt.Fprintf(&b, " · Hạn: %s", t.DueDate.Time.Format("2006-01-02"))
	}
	if t.AssigneeID.Valid {
		fmt.Fprintf(&b, " · Người nhận: %s", names[t.AssigneeID.String])
	}
	if t.Description != "" {
		b.WriteString("\n" + t.Description)
	}
	return ai.Source{Kind: "task", Title: t.Title, Href: base + "/tasks/" + t.ID, Excerpt: b.String()}
}

func (s *AskUNIService) taskContext(ctx context.Context, tc ai.ToolContext, taskID string) ([]ai.Source, error) {
	t, err := s.tasks.Get(ctx, tc.ActorID, taskID)
	if err != nil {
		return nil, err
	}
	if t.WorkspaceID != tc.WorkspaceID {
		return nil, ErrNotFound
	}
	base, err := s.base(ctx, tc.WorkspaceID)
	if err != nil {
		return nil, err
	}
	src := taskSource(base, t, s.memberNames(ctx, tc))
	comments, err := s.tasks.Comments(ctx, tc.ActorID, taskID)
	if err != nil {
		return nil, err
	}
	if len(comments) > 0 {
		var b strings.Builder
		b.WriteString(src.Excerpt + "\nBình luận:")
		for _, c := range comments {
			fmt.Fprintf(&b, "\n- %s: %s", c.DisplayName, c.Body)
		}
		src.Excerpt = b.String()
	}
	return []ai.Source{src}, nil
}

func (s *AskUNIService) meetingContext(ctx context.Context, tc ai.ToolContext, meetingID string) ([]ai.Source, error) {
	m, err := s.meetings.Get(ctx, tc.ActorID, meetingID)
	if err != nil {
		return nil, err
	}
	if m.WorkspaceID != tc.WorkspaceID {
		return nil, ErrNotFound
	}
	base, err := s.base(ctx, tc.WorkspaceID)
	if err != nil {
		return nil, err
	}
	excerpt := fmt.Sprintf("Trạng thái: %s · Bắt đầu: %s\n%s", m.Status, m.StartsAt.Time.Format(time.RFC3339), m.Description)
	if sum, err := s.meetings.Summary(ctx, tc.ActorID, meetingID); err == nil && sum != nil {
		excerpt += "\nTóm tắt: " + sum.Summary + "\nQuyết định: " + sum.Decisions + "\nViệc cần làm: " + sum.ActionItems
	}
	return []ai.Source{{Kind: "meeting", Title: m.Title, Href: base + "/meetings/" + m.ID, Excerpt: excerpt}}, nil
}

// memberContext lists names and roles only. Email and phone never enter a
// prompt (spec §7, OPEN_QUESTIONS P3).
func (s *AskUNIService) memberContext(ctx context.Context, tc ai.ToolContext, _ string) ([]ai.Source, error) {
	rows, err := s.ws.Members(ctx, tc.ActorID, tc.WorkspaceID)
	if err != nil {
		return nil, err
	}
	base, err := s.base(ctx, tc.WorkspaceID)
	if err != nil {
		return nil, err
	}
	var b strings.Builder
	for _, r := range rows {
		fmt.Fprintf(&b, "- %s (%s)\n", r.DisplayName, r.Role)
	}
	return []ai.Source{{Kind: "members", Title: "Thành viên workspace", Href: base + "/members", Excerpt: b.String()}}, nil
}

// chatContext: rooms the asker is a member of, newest 20 messages each, one
// source per room that has a keyword hit.
func (s *AskUNIService) chatContext(ctx context.Context, tc ai.ToolContext, query string) ([]ai.Source, error) {
	rooms, err := s.chat.ListChatRooms(ctx, tc.ActorID, tc.WorkspaceID)
	if err != nil {
		return nil, err
	}
	base, err := s.base(ctx, tc.WorkspaceID)
	if err != nil {
		return nil, err
	}
	ts := terms(query)
	var out []ai.Source
	for i, room := range rooms {
		if i == 5 {
			break
		}
		msgs, err := s.chat.ListRoomMessages(ctx, tc.ActorID, tc.WorkspaceID, room.ID, ListChatMessagesInput{Limit: 20})
		if err != nil {
			return nil, err
		}
		var b strings.Builder
		for _, m := range msgs {
			if score(m.Body, ts) > 0 {
				fmt.Fprintf(&b, "- %s (%s): %s\n", m.SenderDisplayName, m.CreatedAt.Format("2006-01-02 15:04"), m.Body)
			}
		}
		if b.Len() == 0 {
			continue
		}
		title := room.Name
		if title == "" {
			title = room.PeerDisplayName
		}
		out = append(out, ai.Source{Kind: "chat", Title: "Chat: " + title, Href: base + "/chat?room=" + room.ID, Excerpt: b.String()})
	}
	return out, nil
}
