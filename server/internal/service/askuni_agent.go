package service

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// The Ask UNI agent (spec 2026-10-16 §6, P1): the model looks things up with
// the read tools of askuni_agent_tools.go and answers in Markdown, citing the
// [S#] numbers the tool results carried. It runs behind ask_uni_agent; with
// the flag off Ask is P0, unchanged.

const askAgentFlag = "ask_uni_agent"

const (
	// askAgentMaxToolRounds caps the tool rounds of one run: the call after
	// the last round is the answer, whatever it says.
	askAgentMaxToolRounds = 4
	// askAgentEffort is the Auto effort, always sent explicitly (R4).
	askAgentEffort = "medium"
	// askQuoteMax is the length of a citation's quote, cut from the item text.
	askQuoteMax = 240
)

// sourceRef is an inline citation in an answer.
var sourceRef = regexp.MustCompile(`\[(S\d+)\]`)

// agentOn reports whether this turn runs as the agent: the flag on for the
// asker and their organization, and the read tools wired.
func (s *AskUNIService) agentOn(ctx context.Context, tc ai.ToolContext) bool {
	if s.reads == nil || s.flags == nil {
		return false
	}
	f, _ := featureflags.Lookup(askAgentFlag)
	ctx = featureflag.WithEvalContext(ctx, featureflag.EvalContext{UserID: tc.ActorID, OrganizationID: tc.OrganizationID, WorkspaceID: tc.WorkspaceID})
	return s.flags.IsEnabled(ctx, askAgentFlag, f.Default)
}

// sourceBook numbers what a conversation's tools found: an object keeps the
// S# it was first cited under on every later turn, and a new one takes the
// next number (R2). byKey maps an item's Key (its href) to its S#; byID holds
// what a citation of each number stores.
type sourceBook struct {
	next  int
	byKey map[string]string
	byID  map[string]AskCitation
}

// newSourceBook rebuilds the numbers from the citations the conversation's
// answers stored, oldest first. A P0 turn numbered from S1 again, so a number
// that names another object later is that later object's.
func newSourceBook(cited [][]AskCitation) *sourceBook {
	b := &sourceBook{next: 1, byKey: map[string]string{}, byID: map[string]AskCitation{}}
	for _, cs := range cited {
		for _, c := range cs {
			n := sourceNum(c.SourceID)
			if n == 0 || c.Href == "" {
				continue
			}
			if old, ok := b.byID[c.SourceID]; ok && b.byKey[old.Href] == c.SourceID {
				delete(b.byKey, old.Href)
			}
			b.byKey[c.Href], b.byID[c.SourceID] = c.SourceID, c
			b.next = max(b.next, n+1)
		}
	}
	return b
}

// sourceNum is n for "Sn" written canonically, 0 for anything else.
func sourceNum(id string) int {
	n, err := strconv.Atoi(strings.TrimPrefix(id, "S"))
	if err != nil || n < 1 || "S"+strconv.Itoa(n) != id {
		return 0
	}
	return n
}

// source numbers an item a tool returned: the S# its Key already has, else
// the next one. Only items with a Key are sources (ruling P7).
func (b *sourceBook) source(it agentItem) ai.Source {
	id, ok := b.byKey[it.Key]
	if !ok {
		id = "S" + strconv.Itoa(b.next)
		b.next++
		b.byKey[it.Key] = id
	}
	quote := strings.TrimSpace(it.Text)
	if quote == "" {
		quote = it.Title
	}
	if r := []rune(quote); len(r) > askQuoteMax {
		quote = string(r[:askQuoteMax])
	}
	b.byID[id] = AskCitation{SourceID: id, Quote: quote, Kind: it.Kind, Title: it.Title, Href: it.Href}
	return ai.Source{ID: id, Kind: it.Kind, Title: it.Title, Href: it.Href, Excerpt: it.Text}
}

// toolResult is what the model reads back for one call (ruling P10): the
// numbered sources, then any note or error text; "no results" for nothing.
func (b *sourceBook) toolResult(items []agentItem) string {
	var srcs []ai.Source
	var notes []string
	for _, it := range items {
		if it.Key == "" {
			notes = append(notes, ai.EscapeUntrusted(it.Text))
			continue
		}
		srcs = append(srcs, b.source(it))
	}
	if out := ai.RenderSources(srcs) + strings.Join(notes, "\n"); out != "" {
		return out
	}
	return "no results"
}

// agentCitations is every [S#] the answer names that the book knows, in
// order of first appearance, once each; a number nobody gave is left as text.
func agentCitations(answer string, b *sourceBook) []AskCitation {
	out := []AskCitation{}
	seen := map[string]bool{}
	for _, m := range sourceRef.FindAllStringSubmatch(answer, -1) {
		if c, ok := b.byID[m[1]]; ok && !seen[m[1]] {
			seen[m[1]] = true
			out = append(out, c)
		}
	}
	return out
}

// askAgent is one turn run as the agent: the model calls read tools, as the
// asker and inside the asked workspace, until it answers or the rounds run
// out; the answer and its citations are stored like P0's.
func (s *AskUNIService) askAgent(ctx context.Context, userID string, w db.GetWorkspaceWithOrgRow, conv db.AiConversation, question string, in AskInput) (AskResult, error) {
	res := AskResult{ConversationID: conv.ID, RunID: util.NewID()}
	tc := ai.ToolContext{ActorID: userID, OrganizationID: w.OrganizationID, WorkspaceID: w.ID}
	calls, outcome := 0, "error"
	defer func() {
		slog.Info("ask uni: agent run", "run_id", res.RunID, "organization_id", w.OrganizationID, "workspace_id", w.ID, "calls", calls, "outcome", outcome)
	}()
	rows, err := s.q.AiListMessages(ctx, conv.ID)
	if err != nil {
		return AskResult{}, err
	}
	stored, err := s.q.AiListConversationCitations(ctx, db.AiListConversationCitationsParams{OrganizationID: w.OrganizationID, ConversationID: conv.ID})
	if err != nil {
		return AskResult{}, err
	}
	cited := make([][]AskCitation, 0, len(stored))
	for _, raw := range stored {
		var cs []AskCitation
		if json.Unmarshal([]byte(raw), &cs) == nil { // a row that does not decode cites nothing
			cited = append(cited, cs)
		}
	}
	book := newSourceBook(cited)
	focus, err := s.agentFocus(ctx, tc, in.Focus, book)
	if err != nil {
		return AskResult{}, err
	}

	vars := map[string]any{"locale": in.Locale, "today": s.now().Format("2006-01-02"), "focus": focus, "question": question}
	prompt, _ := ai.LookupPrompt(ai.PromptCopilotAnswerV2)
	hist := history(rows)
	// The rendered question as the gateway sends it on the first call; later
	// calls replay it byte for byte, so the cached prefix holds.
	msgs := append(slices.Clip(hist), provider.Message{Role: "user", Content: prompt.Render(vars)})
	tools := s.agentTools()
	req := ai.Request{
		Actor: Human(userID), OrganizationID: w.OrganizationID, WorkspaceID: w.ID,
		Capability: ai.CapCopilotAgent, PromptID: ai.PromptCopilotAnswerV2, Vars: vars, History: hist,
		Tools: agentRegistry(tools), FilterToolCalls: true, RunID: res.RunID, Effort: askAgentEffort, // Model "" is Auto
	}
	var resp ai.Response
	for rounds := 0; ; rounds++ {
		req.MeterKey = "ask-uni:" + res.RunID + ":" + strconv.Itoa(calls)
		resp, err = s.gw.Complete(ctx, req)
		calls++
		if errors.Is(err, ai.ErrRefused) {
			outcome = ai.NoticeRefused
			var refused *ai.Error
			errors.As(err, &refused)
			return s.finishAgent(ctx, res, w, conv, question, "", ai.NoticeRefused, []AskCitation{}, refused.UsageEventID)
		}
		if err != nil {
			return AskResult{}, err
		}
		res.InputTokens += resp.InputTokens
		res.OutputTokens += resp.OutputTokens
		if len(resp.ToolCalls) == 0 || rounds == askAgentMaxToolRounds {
			break
		}
		msgs = append(msgs, provider.Message{Role: "assistant", Content: resp.Text, ToolCalls: resp.ToolCalls, Raw: resp.Raw})
		for _, c := range resp.ToolCalls {
			out, err := runAgentCall(ctx, tools, tc, c, book)
			if err != nil {
				return AskResult{}, err
			}
			msgs = append(msgs, provider.Message{Role: "tool", ToolCallID: c.ID, Content: out})
		}
		req.History, req.Vars, req.ToolResultTurn = msgs, nil, true
	}
	answer := strings.TrimSpace(ai.StripUntrustedTags(resp.Text))
	if answer == "" {
		outcome = ai.NoticeAgentFailed
		return s.finishAgent(ctx, res, w, conv, question, "", ai.NoticeAgentFailed, []AskCitation{}, resp.UsageEventID)
	}
	outcome = "answered"
	return s.finishAgent(ctx, res, w, conv, question, answer, "", agentCitations(answer, book), resp.UsageEventID)
}

// finishAgent stores the turn with the last call's usage row.
func (s *AskUNIService) finishAgent(ctx context.Context, res AskResult, w db.GetWorkspaceWithOrgRow, conv db.AiConversation, question, answer, notice string, citations []AskCitation, usageEventID string) (AskResult, error) {
	msg, err := s.store(ctx, w.OrganizationID, conv.ID, question, answer, notice, citations, usageEventID)
	if err != nil {
		return AskResult{}, err
	}
	res.Message, res.Citations = msg, citations
	return res, nil
}

// runAgentCall runs one tool call and renders its result. A call to a tool
// the agent does not have is answered, not run; a Go error is the server's
// and ends the run.
func runAgentCall(ctx context.Context, tools []agentTool, tc ai.ToolContext, c provider.ToolCall, b *sourceBook) (string, error) {
	i := slices.IndexFunc(tools, func(t agentTool) bool { return t.Name == c.Name })
	if i < 0 {
		return "error: unknown_tool", nil
	}
	items, err := tools[i].run(ctx, tc, c.Input)
	if err != nil {
		return "", err
	}
	return b.toolResult(items), nil
}

// agentFocus reads the object the asker is looking at, numbers it, and
// renders it for the prompt's focus block; "" without one.
func (s *AskUNIService) agentFocus(ctx context.Context, tc ai.ToolContext, focus *ai.Focus, b *sourceBook) (string, error) {
	if focus == nil {
		return "", nil
	}
	var read func(context.Context, ai.ToolContext, string) ([]ai.Source, error)
	switch focus.Kind {
	case "task":
		read = s.taskContext
	case "meeting":
		read = s.meetingContext
	case "email_thread":
		read = s.emailThreadContext
	default:
		return "", nil
	}
	found, err := read(ctx, tc, focus.ID)
	if errors.Is(err, ErrForbidden) {
		return "", ai.ErrContextForbidden
	}
	if err != nil {
		return "", err
	}
	srcs := make([]ai.Source, 0, len(found))
	for _, src := range found {
		srcs = append(srcs, b.source(agentItem{Kind: src.Kind, Key: src.Href, Title: src.Title, Href: src.Href, Text: src.Excerpt}))
	}
	return ai.RenderSources(srcs), nil
}
