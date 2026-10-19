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
	"time"

	"github.com/redis/go-redis/v9"

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

// The bounds of one run (R10, R11). They are starting values, tuned by the
// eval.
const (
	// askAgentMaxToolRounds caps the tool rounds: the call after the last one
	// is the answer round.
	askAgentMaxToolRounds = 4
	// askAgentMaxCallsPerRound caps the tool calls one reply may run; the
	// rest are answered "error: too_many_calls", unrun.
	askAgentMaxCallsPerRound = 6
	// A run that has spent either budget, in tokens, answers on its next call.
	// Input counts cache reads and writes too (ruling P12): Anthropic's
	// input_tokens leaves them out.
	askAgentInputBudget  = 60_000
	askAgentOutputBudget = 4_000
	// askAgentToolResultMax caps one tool result, and the focus block (ruling
	// P11), in bytes: whole sources are dropped from the end.
	askAgentToolResultMax = 64 << 10
	// askAgentDeadline bounds a run; with less than askAgentFinalReserve left
	// the next call is the answer round.
	askAgentDeadline     = 120 * time.Second
	askAgentFinalReserve = 40 * time.Second
	// Runs in flight per pod, per organization and across the deployment,
	// leased like UniWork AI's turns.
	askAgentPodMax    = 32
	askAgentOrgMax    = 8
	askAgentGlobalMax = 64
	// askAgentOrgCallsPerMinute caps an organization's agent model calls.
	askAgentOrgCallsPerMinute = 600

	// askAgentEffort is the Auto effort, always sent explicitly (R4).
	askAgentEffort = "medium"
	// askQuoteMax is the length of a citation's quote, cut from the item text.
	askQuoteMax = 240
)

const (
	// askAgentBudgetNote ends the last tool result before the answer round.
	askAgentBudgetNote = "\n\n[system] Tool budget reached. Answer now from the sources above without calling tools."
	// askAgentFormatReminder is the user turn of the one retry after a reply
	// that cannot be stored as the answer.
	askAgentFormatReminder = "Your last reply was empty, cut off, or asked for tools after the budget. Reply now in Markdown, citing [S#], without calling tools."
	// askAgentTruncated ends a result or focus block that dropped sources.
	askAgentTruncated = "[truncated]"
	// askAgentOrgCallKey counts an organization's agent model calls per minute.
	askAgentOrgCallKey = "uw:ai:ask:org:"
)

// AskAgentMetrics is the agent's run and tool surface; nil reports nothing.
type AskAgentMetrics interface {
	// ObserveAskRun reports a run: outcome is answered, agent_failed,
	// refused, rate_limited, busy or timeout; rounds counts its tool rounds.
	ObserveAskRun(outcome string, rounds int, seconds float64)
	// ObserveAskTool reports one tool call: status is ok, error or truncated.
	ObserveAskTool(tool, status string, seconds float64)
}

// SetAgentMetrics wires the agent's metrics; nil reports nothing.
func (s *AskUNIService) SetAgentMetrics(m AskAgentMetrics) { s.agentMetrics = m }

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

// number is the S# key already has, else the one it would take next.
func (b *sourceBook) number(key string) (id string, known bool) {
	if id, ok := b.byKey[key]; ok {
		return id, true
	}
	return "S" + strconv.Itoa(b.next), false
}

// source numbers an item a tool returned and records what citing it stores.
// Only items with a Key are sources (ruling P7).
func (b *sourceBook) source(it agentItem) {
	id, known := b.number(it.Key)
	if !known {
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
}

// render is the numbered sources, then any note or error text (ruling P10),
// within askAgentToolResultMax bytes: a source that does not fit is neither
// sent nor numbered, nor is any after it, and the block ends
// askAgentTruncated.
func (b *sourceBook) render(items []agentItem) (out string, truncated bool) {
	var notes []string
	for _, it := range items {
		if it.Key == "" {
			notes = append(notes, ai.EscapeUntrusted(it.Text))
		}
	}
	tail := strings.Join(notes, "\n")
	room := askAgentToolResultMax - len(tail) - len("\n"+askAgentTruncated)
	if room < 0 { // the notes alone are past the cap: cut them, and send no source
		tail = strings.ToValidUTF8(tail[:len(tail)+room], "")
		room, truncated = 0, true
	}
	var srcs strings.Builder
	for _, it := range items {
		if it.Key == "" || truncated {
			continue
		}
		id, _ := b.number(it.Key)
		block := ai.RenderSources([]ai.Source{{ID: id, Kind: it.Kind, Title: it.Title, Href: it.Href, Excerpt: it.Text}})
		if srcs.Len()+len(block) > room {
			truncated = true
			break
		}
		b.source(it)
		srcs.WriteString(block)
	}
	out = srcs.String() + tail
	if truncated {
		if tail != "" {
			out += "\n"
		}
		out += askAgentTruncated
	}
	return out, truncated
}

// toolResult is what the model reads back for one call, and its status for
// the metric; "no results" for nothing.
func (b *sourceBook) toolResult(items []agentItem) (string, string) {
	out, truncated := b.render(items)
	switch {
	case truncated:
		return out, "truncated"
	case out == "":
		return "no results", "ok"
	case slices.ContainsFunc(items, func(it agentItem) bool { return it.Kind == "error" }):
		return out, "error"
	}
	return out, "ok"
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

// agentMalformed is a reply that cannot be stored as the answer (R11): empty
// once its tags are stripped, cut at the output ceiling, or still calling
// tools.
func agentMalformed(r ai.Response) bool {
	return len(r.ToolCalls) > 0 || r.StopReason == "max_tokens" || r.StopReason == "length" ||
		strings.TrimSpace(ai.StripUntrustedTags(r.Text)) == ""
}

// askAgentOrgCallScript counts a call and gives the key its window in one
// step, so the count cannot outlive the window: a key without a TTL (a split
// INCR/EXPIRE would leave one) is a permanent 429 for the organization.
var askAgentOrgCallScript = redis.NewScript(`
local count = redis.call('INCR', KEYS[1])
if count == 1 or redis.call('PTTL', KEYS[1]) < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return count
`)

// agentCallOver counts one model call against the organization's minute and
// reports whether it is past askAgentOrgCallsPerMinute. Without Redis nothing
// is counted; a Redis error fails open, in the limiters' 100 ms.
func (s *AskUNIService) agentCallOver(ctx context.Context, orgID string) bool {
	if s.rdb == nil {
		return false
	}
	ctx, cancel := context.WithTimeout(ctx, uniworkLeaseTimeout)
	defer cancel()
	n, err := askAgentOrgCallScript.Run(ctx, s.rdb, []string{askAgentOrgCallKey + orgID}, askRateWindow.Milliseconds()).Int64()
	if err != nil {
		return false
	}
	return n > askAgentOrgCallsPerMinute
}

// askAgent is one turn run as the agent: the model calls read tools, as the
// asker and inside the asked workspace, until it answers or a bound of R10
// makes the next call the answer round; the answer and its citations are
// stored like P0's.
func (s *AskUNIService) askAgent(ctx context.Context, userID string, w db.GetWorkspaceWithOrgRow, conv db.AiConversation, question string, in AskInput) (out AskResult, err error) {
	res := AskResult{ConversationID: conv.ID, RunID: util.NewID()}
	tc := ai.ToolContext{ActorID: userID, OrganizationID: w.OrganizationID, WorkspaceID: w.ID}
	started := s.now()
	calls, rounds, outcome := 0, 0, ""
	// The outcome is read once the run has returned, after the store, so a
	// turn that failed to store is never reported answered.
	defer func() {
		p := recover()
		switch {
		case p != nil:
			outcome = ai.NoticeAgentFailed
		case outcome != "": // a gate refused the run
		case err == nil && out.Message.Notice.String != "":
			outcome = out.Message.Notice.String
		case err == nil:
			outcome = "answered"
		case errors.Is(err, ai.ErrProviderTimeout) || errors.Is(err, context.DeadlineExceeded):
			outcome = "timeout"
		case errors.Is(err, ai.ErrRateLimited):
			outcome = "rate_limited"
		default:
			outcome = ai.NoticeAgentFailed
		}
		slog.Info("ask uni: agent run", "run_id", res.RunID, "organization_id", w.OrganizationID, "workspace_id", w.ID, "calls", calls, "rounds", rounds, "outcome", outcome)
		if s.agentMetrics != nil {
			s.agentMetrics.ObserveAskRun(outcome, rounds, s.now().Sub(started).Seconds())
		}
		if p != nil {
			panic(p)
		}
	}()
	release, err := s.agentRuns.Acquire(ctx, w.OrganizationID)
	if err != nil {
		outcome = "busy"
		return AskResult{}, ai.RateLimited(5 * time.Second)
	}
	defer release()
	// The run's calls and tools stop at the deadline; the store uses ctx, so
	// an answer that arrived in time is kept.
	runCtx, cancel := context.WithTimeout(ctx, askAgentDeadline)
	defer cancel()
	deadline := started.Add(askAgentDeadline)

	rows, err := s.q.AiListMessages(runCtx, conv.ID)
	if err != nil {
		return AskResult{}, err
	}
	stored, err := s.q.AiListConversationCitations(runCtx, db.AiListConversationCitationsParams{OrganizationID: w.OrganizationID, ConversationID: conv.ID})
	if err != nil {
		return AskResult{}, err
	}
	cited := make([][]AskCitation, 0, len(stored))
	for _, raw := range stored {
		var cs []AskCitation
		if json.Unmarshal([]byte(raw), &cs) != nil { // a row that does not decode cites nothing
			slog.Warn("ask uni: stored citations do not decode", "organization_id", w.OrganizationID, "conversation_id", conv.ID)
			continue
		}
		cited = append(cited, cs)
	}
	book := newSourceBook(cited)
	focus, err := s.agentFocus(runCtx, tc, in.Focus, book)
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
	model, effort := s.resolveAskModel(runCtx, w.OrganizationID, in.Model, in.Effort)
	req := ai.Request{
		Actor: Human(userID), OrganizationID: w.OrganizationID, WorkspaceID: w.ID,
		Capability: ai.CapCopilotAgent, PromptID: ai.PromptCopilotAnswerV2, Vars: vars, History: hist,
		Tools: agentRegistry(tools), FilterToolCalls: true, RunID: res.RunID, Model: model, Effort: effort,
	}
	spentInput := 0 // the input budget's count, cached tokens included (P12)
	call := func() (ai.Response, error) {
		req.MeterKey = "ask-uni:" + res.RunID + ":" + strconv.Itoa(calls)
		r, err := s.gw.Complete(runCtx, req)
		calls++
		res.InputTokens += r.InputTokens
		res.OutputTokens += r.OutputTokens
		spentInput += r.InputTokens + r.CacheReadTokens + r.CacheWriteTokens
		return r, err
	}
	// A refusal on any call stores the notice. The gateway hands back no
	// Response with it, so the refused call's billed tokens are read from its
	// usage row.
	refused := func(err error) (AskResult, error) {
		var e *ai.Error
		errors.As(err, &e)
		if row, rerr := s.q.AiGetUsageEvent(ctx, e.UsageEventID); rerr == nil && row.OrganizationID == w.OrganizationID {
			res.InputTokens += int(row.InputTokens)
			res.OutputTokens += int(row.OutputTokens)
		}
		return s.finishAgent(ctx, res, w, conv, question, "", ai.NoticeRefused, []AskCitation{}, e.UsageEventID)
	}

	var resp ai.Response
	for final := false; ; {
		over := s.agentCallOver(runCtx, w.OrganizationID)
		if over && calls == 0 {
			outcome = "rate_limited"
			return AskResult{}, ai.RateLimited(askRateWindow)
		}
		if calls > 0 {
			final = over || rounds == askAgentMaxToolRounds || spentInput >= askAgentInputBudget ||
				res.OutputTokens >= askAgentOutputBudget || deadline.Sub(s.now()) < askAgentFinalReserve
		}
		if final {
			msgs[len(msgs)-1].Content += askAgentBudgetNote
		}
		resp, err = call()
		if errors.Is(err, ai.ErrRefused) {
			return refused(err)
		}
		if err != nil {
			return AskResult{}, err
		}
		if len(resp.ToolCalls) == 0 || final {
			break
		}
		rounds++
		msgs = append(msgs, provider.Message{Role: "assistant", Content: resp.Text, ToolCalls: resp.ToolCalls, Raw: resp.Raw})
		for i, c := range resp.ToolCalls {
			content, err := s.agentToolCall(runCtx, tools, tc, c, book, i)
			if err != nil {
				return AskResult{}, err
			}
			msgs = append(msgs, provider.Message{Role: "tool", ToolCallID: c.ID, Content: content})
		}
		req.History, req.Vars, req.ToolResultTurn = msgs, nil, true
	}
	if agentMalformed(resp) {
		// One retry (R11): what the answer round sent, then a user turn
		// asking for the answer; the bad reply is not sent back, the tools
		// still are. It is counted against the organization, never refused.
		msgs = append(msgs, provider.Message{Role: "user", Content: askAgentFormatReminder})
		req.History, req.Vars, req.ToolResultTurn, req.Continuation = msgs, nil, false, true
		s.agentCallOver(runCtx, w.OrganizationID)
		resp, err = call()
		if errors.Is(err, ai.ErrRefused) {
			return refused(err)
		}
		if err != nil {
			return AskResult{}, err
		}
		if agentMalformed(resp) {
			return s.finishAgent(ctx, res, w, conv, question, "", ai.NoticeAgentFailed, []AskCitation{}, resp.UsageEventID)
		}
	}
	answer := strings.TrimSpace(ai.StripUntrustedTags(resp.Text))
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

// agentToolCall answers the i-th tool call of a reply: past
// askAgentMaxCallsPerRound it is refused unrun, a tool the agent lacks is
// answered unrun, and any other call runs and is rendered. A Go error is the
// server's and ends the run.
func (s *AskUNIService) agentToolCall(ctx context.Context, tools []agentTool, tc ai.ToolContext, c provider.ToolCall, b *sourceBook, i int) (string, error) {
	started := s.now()
	j := slices.IndexFunc(tools, func(t agentTool) bool { return t.Name == c.Name })
	name := "unknown" // the model's own name would be an unbounded metric label
	if j >= 0 {
		name = c.Name
	}
	content, status := "error: too_many_calls", "error"
	var err error
	switch {
	case i >= askAgentMaxCallsPerRound:
	case j < 0:
		content = "error: unknown_tool"
	default:
		var items []agentItem
		if items, err = tools[j].run(ctx, tc, c.Input); err == nil {
			content, status = b.toolResult(items)
		}
		// The run's deadline reached inside a tool is the same refusal as one
		// reached inside a model call.
		if errors.Is(err, context.DeadlineExceeded) {
			err = &ai.Error{Code: ai.ErrProviderTimeout.Code, Status: ai.ErrProviderTimeout.Status, Msg: ai.ErrProviderTimeout.Msg, Err: err}
		}
	}
	if s.agentMetrics != nil {
		s.agentMetrics.ObserveAskTool(name, status, s.now().Sub(started).Seconds())
	}
	return content, err
}

// agentFocus reads the object the asker is looking at, numbers it, and
// renders it for the prompt's focus block, capped like a tool result (ruling
// P11); "" without one.
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
	items := make([]agentItem, 0, len(found))
	for _, src := range found {
		items = append(items, agentItem{Kind: src.Kind, Key: src.Href, Title: src.Title, Href: src.Href, Text: src.Excerpt})
	}
	out, _ := b.render(items)
	return out, nil
}
