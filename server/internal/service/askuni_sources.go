package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"slices"
	"sort"
	"strings"
	"time"
	"unicode"

	"golang.org/x/text/unicode/norm"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
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
		case "email_thread":
			fn = s.emailThreadContext
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

// tokens splits the diacritic-folded text into words.
func tokens(q string) []string {
	return strings.FieldsFunc(foldForSearch(q), notWordRune)
}

// words splits the lowercased text into words as written. NFC keeps a letter
// and its marks one rune, so a decomposed "Hà" is the same word as a composed one.
func words(q string) []string {
	return strings.FieldsFunc(norm.NFC.String(strings.ToLower(q)), notWordRune)
}

func notWordRune(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) }

// ponytail: keyword overlap; swap for the A-04 search index when it exists.
// Terms are the question's words of 3+ runes or all digits, as typed, so
// "do"/"co"/"la" do not match half the workspace while "10" still finds "tháng 10".
func terms(q string) []string {
	var out []string
	for _, f := range words(q) {
		if len([]rune(f)) >= 3 || strings.IndexFunc(f, func(r rune) bool { return !unicode.IsDigit(r) }) < 0 {
			out = append(out, f)
		}
	}
	return out
}

// searchTerms is terms, except that a query made only of 2-rune words (names
// such as "Hà", "An") scores with those words instead of nothing.
func searchTerms(q string) []string {
	if ts := terms(q); len(ts) > 0 {
		return ts
	}
	return wordsOfTwo(q)
}

// wordsOfTwo returns the words of 2 or more runes, as typed.
func wordsOfTwo(q string) []string {
	var out []string
	for _, f := range words(q) {
		if len([]rune(f)) >= 2 {
			out = append(out, f)
		}
	}
	return out
}

// score counts the terms the text holds as whole words. A term typed with
// diacritics matches only as written ("năm" is not "nằm", "hà" is not "hàng");
// one typed without them matches the folded text ("tet" finds "Tết").
func score(text string, ts []string) int {
	asWritten, folded := map[string]bool{}, map[string]bool{}
	for _, w := range words(text) {
		asWritten[w] = true
		folded[foldForSearch(w)] = true
	}
	n := 0
	for _, t := range ts {
		if f := foldForSearch(t); (f != t && asWritten[t]) || (f == t && folded[t]) {
			n++
		}
	}
	return n
}

// hasPhrase reports whether any folded keyword occurs as whole adjacent tokens.
func hasPhrase(q string, keywords ...string) bool {
	hay := " " + strings.Join(tokens(q), " ") + " "
	for _, k := range keywords {
		if strings.Contains(hay, " "+k+" ") {
			return true
		}
	}
	return false
}

// asksOverdue: "trễ" alone counts only with its accent ("tre" is bamboo);
// unaccented questions need a phrase.
func asksOverdue(q string) bool {
	return slices.Contains(words(q), "trễ") ||
		hasPhrase(q, "qua han", "tre han", "bi tre", "dang tre", "tre deadline", "overdue", "late")
}

func asksMembers(q string) bool {
	return hasPhrase(q, "thanh vien", "member", "members", "ai", "who", "nhan su", "doi ngu", "doi minh")
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

// searchWorkItems scores the tasks and meetings of one workspace against a
// query. Ask UNI adds chat and members on top; the MCP connector stops here
// because chat is other people's words (spec 2026-10-12 §2).
func (s *AskUNIService) searchWorkItems(ctx context.Context, tc ai.ToolContext, query string) ([]scored, error) {
	base, err := s.base(ctx, tc.WorkspaceID)
	if err != nil {
		return nil, err
	}
	ts := searchTerms(query)
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
	return items, nil
}

func (s *AskUNIService) searchWorkspace(ctx context.Context, tc ai.ToolContext, query string) ([]ai.Source, error) {
	items, err := s.searchWorkItems(ctx, tc, query)
	if err != nil {
		return nil, err
	}
	if items, err = s.addIdentifierHits(ctx, tc, query, items); err != nil {
		return nil, err
	}
	chat, err := s.chatContext(ctx, tc, query)
	if err != nil {
		return nil, err
	}
	for _, c := range chat {
		items = append(items, scored{src: c, score: 1, when: s.now()})
	}
	items = append(items, s.searchDocumentSources(ctx, tc, query)...)
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

// documentsOn mirrors McpToolService.documentsOn: DocumentService wired and the
// `documents` flag on for the asker's organization and person; no evaluator = off.
func (s *AskUNIService) documentsOn(ctx context.Context, tc ai.ToolContext) bool {
	if s.docs == nil || s.flags == nil {
		return false
	}
	def := false
	if f, ok := featureflags.Lookup(mcpDocumentsFlag); ok {
		def = f.Default
	}
	ctx = featureflag.WithEvalContext(ctx, featureflag.EvalContext{UserID: tc.ActorID, OrganizationID: tc.OrganizationID})
	return s.flags.IsEnabled(ctx, mcpDocumentsFlag, def)
}

// searchDocumentSources finds documents the asker may read by the question's
// three longest terms. Excerpt is the 160-char list Snippet at P0. Any error
// drops the document half only; the turn still runs.
func (s *AskUNIService) searchDocumentSources(ctx context.Context, tc ai.ToolContext, query string) []scored {
	if !s.documentsOn(ctx, tc) {
		return nil
	}
	ts := terms(query)
	sort.SliceStable(ts, func(i, j int) bool { return len([]rune(ts[i])) > len([]rune(ts[j])) })
	if len(ts) > 3 {
		ts = ts[:3]
	}
	if len(ts) == 0 {
		return nil
	}
	base, err := s.base(ctx, tc.WorkspaceID)
	if err != nil {
		slog.Warn("ask uni: document search skipped", "user_id", tc.ActorID, "workspace_id", tc.WorkspaceID, "error", err)
		return nil
	}
	byID := map[string]*scored{}
	var order []string
	for _, term := range ts {
		page, err := s.docs.ListDocuments(ctx, Human(tc.ActorID), tc.WorkspaceID, ListDocumentsInput{Query: term, Kind: DocumentKindDocument, Limit: 5})
		if err != nil {
			slog.Warn("ask uni: document search skipped", "user_id", tc.ActorID, "workspace_id", tc.WorkspaceID, "error", err)
			return nil
		}
		for _, it := range page.Items {
			d := it.Document
			if byID[d.ID] != nil {
				continue
			}
			byID[d.ID] = &scored{
				src:   ai.Source{Kind: "document", Title: d.Title, Href: base + "/documents/" + d.ID, Excerpt: it.Snippet},
				score: score(d.Title+" "+it.Snippet, ts), when: d.UpdatedAt.Time,
			}
			order = append(order, d.ID)
		}
	}
	out := make([]scored, 0, len(order))
	for _, id := range order {
		// The store matches folded substrings; a document none of whose words
		// the question holds as typed is not about it.
		if byID[id].score > 0 {
			out = append(out, *byID[id])
		}
	}
	return out
}

var taskIdentifierRe = regexp.MustCompile(`(?i)\b([a-z][a-z0-9]{1,9})-(\d{1,9})\b`)

// addIdentifierHits boosts (or adds) the task a PREFIX-N reference in the
// question names. Ask-only: searchWorkItems is shared with MCP search.
// shortcut: GetByRefIn ignores retired prefixes (workspace_aliases); old-prefix questions fall back to keyword search until the lookup learns aliases.
func (s *AskUNIService) addIdentifierHits(ctx context.Context, tc ai.ToolContext, query string, items []scored) ([]scored, error) {
	for _, ref := range taskIdentifierRe.FindAllString(query, 5) {
		t, err := s.tasks.GetByRefIn(ctx, Human(tc.ActorID), tc.WorkspaceID, ref)
		if errors.Is(err, ErrNotFound) || errors.Is(err, ErrForbidden) {
			continue
		}
		if err != nil {
			return nil, err
		}
		found := false
		for i := range items {
			if strings.HasSuffix(items[i].src.Href, "/tasks/"+t.ID) {
				items[i].score += 10
				found = true
				break
			}
		}
		if found {
			continue
		}
		srcs, err := s.taskContext(ctx, tc, t.ID)
		if err != nil {
			return nil, err
		}
		items = append(items, scored{src: srcs[0], score: 10, when: t.UpdatedAt.Time})
	}
	return items, nil
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
