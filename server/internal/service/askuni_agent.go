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

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// The Ask UNI agent (spec 2026-10-16 §6, P1): the model looks things up with
// the read tools of askuni_agent_tools.go and answers in Markdown, citing the
// [S#] numbers the tool results carried. It runs behind ask_uni_agent; with
// the flag off Ask is P0, unchanged.

const askAgentFlag = "ask_uni_agent"

// askThinkingFlag shows how UNI reasons: the model's adaptive thinking
// streamed as reasoning and kept on the steps, and a dock prompt (@8 to @11)
// that says one sentence before each tool call.
const askThinkingFlag = "ask_uni_thinking"

// askNarrated is the dock prompt with the narrate line for each one without.
var askNarrated = map[string]string{
	ai.PromptCopilotAnswerV4: ai.PromptCopilotAnswerV8, ai.PromptCopilotAnswerV5: ai.PromptCopilotAnswerV9,
	ai.PromptCopilotAnswerV6: ai.PromptCopilotAnswerV10, ai.PromptCopilotAnswerV7: ai.PromptCopilotAnswerV11,
}

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
	// askAgentThinkingOutputBudget replaces askAgentOutputBudget when the
	// model thinks: its thinking is billed as output.
	askAgentThinkingOutputBudget = 16_000
	// A step keeps at most askThoughtRunes of thinking and askNoteRunes of
	// the model's sentence before its tools.
	askThoughtRunes = 4_000
	askNoteRunes    = 400
	// askAgentToolResultMax caps one tool result, the focus block (ruling
	// P11) and a round's results together (ruling P18), in bytes: whole
	// sources are dropped from the end.
	askAgentToolResultMax = 64 << 10
	// askAgentDeadline bounds a run; with less than askAgentFinalReserve left
	// the next call is the answer round.
	askAgentDeadline     = 120 * time.Second
	askAgentFinalReserve = 40 * time.Second
	// askAgentStoreTimeout bounds storing a turn past its deadline or its
	// request: a failed, stopped or interrupted run, and a stopped P0 turn.
	askAgentStoreTimeout = 5 * time.Second
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
	// refused, rate_limited (a vendor or quota limit too), busy, timeout,
	// stopped (by the asker) or interrupted (by Shutdown);
	// rounds counts its tool rounds, at most askAgentMaxToolRounds.
	ObserveAskRun(outcome string, rounds int, seconds float64)
	// ObserveAskTool reports one tool call: status is ok, error or truncated.
	ObserveAskTool(tool, status string, seconds float64)
	// ObserveAskAction reports one proposal row of a write tool: outcome is
	// proposed, auto_applied, applied, rejected, failed or undone (R19).
	ObserveAskAction(tool, outcome string)
	// ObserveAskTaintDowngrade reports an Auto turn whose level-1 rows wait
	// for the asker because the turn read someone else's words.
	ObserveAskTaintDowngrade()
	// ObserveAskMemory reports one memory event: outcome is proposed, applied,
	// rejected, undone, expired, used, import_split or import_saved (R19).
	ObserveAskMemory(outcome string)
	// ObserveAskMemoryEntries reports how many entries a turn's memory held.
	ObserveAskMemoryEntries(n int)
}

// SetAgentMetrics wires the agent's metrics; nil reports nothing.
func (s *AskUNIService) SetAgentMetrics(m AskAgentMetrics) { s.agentMetrics = m }

// sourceRef is an inline citation in an answer.
var sourceRef = regexp.MustCompile(`\[(S\d+)\]`)

// mdMarks are Markdown heading, emphasis and code marks; mdEscape is a
// backslash escape. A quote shows neither.
var (
	mdMarks  = regexp.MustCompile("(?m)^#{1,6}[ \t]+|\\*\\*|__|[*`]")
	mdEscape = regexp.MustCompile(`\\([\\*_{}\[\]()#+\-.!|>~])`)
)

// quoteText is a source's body as one line of plain text for the hover card.
func quoteText(body string) string {
	s := mdEscape.ReplaceAllString(mdMarks.ReplaceAllString(body, ""), "$1")
	return strings.Join(strings.Fields(s), " ")
}

// agentOn reports whether this turn runs as the agent: the flag on for the
// asker and their organization, the read tools wired, and a copilot_agent
// model on the provider (Ollama has none: no tool-result turn), so a
// deployment without one stays on P0.
func (s *AskUNIService) agentOn(ctx context.Context, tc ai.ToolContext) bool {
	if s.reads == nil || s.flags == nil || s.gw.DefaultModel(ai.CapCopilotAgent) == "" {
		return false
	}
	f, _ := featureflags.Lookup(askAgentFlag)
	ctx = featureflag.WithEvalContext(ctx, featureflag.EvalContext{UserID: tc.ActorID, OrganizationID: tc.OrganizationID, WorkspaceID: tc.WorkspaceID})
	return s.flags.IsEnabled(ctx, askAgentFlag, f.Default)
}

// thinkingOn reports whether this turn shows how UNI reasons (askThinkingFlag).
func (s *AskUNIService) thinkingOn(ctx context.Context, tc ai.ToolContext) bool {
	if s.flags == nil {
		return false
	}
	f, _ := featureflags.Lookup(askThinkingFlag)
	ctx = featureflag.WithEvalContext(ctx, featureflag.EvalContext{UserID: tc.ActorID, OrganizationID: tc.OrganizationID, WorkspaceID: tc.WorkspaceID})
	return s.flags.IsEnabled(ctx, askThinkingFlag, f.Default)
}

// askStepNote is a tool round's text as its first step's note: untrusted tags
// stripped, capped.
func askStepNote(text string) string {
	return capRunes(strings.TrimSpace(ai.StripUntrustedTags(text)), askNoteRunes, "…")
}

// sourceBook numbers what a conversation's tools found: an object keeps the
// S# it was first cited under on every later turn, and a new one takes the
// next number (R2). byKey maps an item's Key (its href) to its S#; byID holds
// what a citation of each number stores.
type sourceBook struct {
	next  int
	byKey map[string]string
	byID  map[string]AskCitation
	// counted holds the keys this run's steps already counted.
	counted map[string]bool
}

// newSourceBook rebuilds the numbers from the citations the conversation's
// answers stored, oldest first. A P0 turn numbered from S1 again, so a number
// that names another object later is that later object's.
func newSourceBook(cited [][]AskCitation) *sourceBook {
	b := &sourceBook{next: 1, byKey: map[string]string{}, byID: map[string]AskCitation{}, counted: map[string]bool{}}
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
	quote := quoteText(it.Body)
	if quote == "" {
		quote = it.Title
	}
	if r := []rune(quote); len(r) > askQuoteMax {
		quote = string(r[:askQuoteMax])
	}
	b.byID[id] = AskCitation{SourceID: id, Quote: quote, Kind: it.Kind, Title: it.Title, Href: it.Href, ObjectID: it.ID}
}

// since is the citations of the numbers handed out from first on, in order:
// the sources a step or the focus numbered for the first time.
func (b *sourceBook) since(first int) []AskCitation {
	var out []AskCitation
	for n := first; n < b.next; n++ {
		if c, ok := b.byID["S"+strconv.Itoa(n)]; ok {
			out = append(out, c)
		}
	}
	return out
}

// render is the numbered sources, then any note or error text (ruling P10),
// within limit bytes: a source that does not fit is neither sent nor
// numbered, nor is any after it, and the block ends askAgentTruncated.
func (b *sourceBook) render(items []agentItem, limit int) (out string, truncated bool) {
	var notes []string
	for _, it := range items {
		if it.Key == "" {
			notes = append(notes, ai.EscapeUntrusted(it.Text))
		}
	}
	tail := strings.Join(notes, "\n")
	room := limit - len(tail) - len("\n"+askAgentTruncated)
	if room < 0 && tail != "" { // the notes alone are past the cap: cut them, and send no source
		tail = strings.ToValidUTF8(tail[:max(0, len(tail)+room)], "")
		truncated = true
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

// toolResult is what the model reads back for one call, within limit bytes,
// and its status for the metric; "no results" for nothing.
func (b *sourceBook) toolResult(items []agentItem, limit int) (string, string) {
	out, truncated := b.render(items, limit)
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
// once its tags and any follow-up block are stripped, cut at the output
// ceiling, or still calling tools.
func agentMalformed(r ai.Response) bool {
	body, _ := splitFollowups(strings.TrimSpace(ai.StripUntrustedTags(r.Text)))
	return len(r.ToolCalls) > 0 || r.StopReason == "max_tokens" || r.StopReason == "length" || body == ""
}

// agentCallOver counts one model call against the organization's minute and
// reports whether it is past askAgentOrgCallsPerMinute. Without Redis it
// counts in this service's memory; a Redis error fails open, in the limiters'
// 100 ms.
func (s *AskUNIService) agentCallOver(ctx context.Context, orgID string) bool {
	n, ok := s.askCount(ctx, askAgentOrgCallKey+orgID)
	return ok && n > askAgentOrgCallsPerMinute
}

// askAgent is one turn run as the agent: the model calls read tools, as the
// asker and inside the asked workspace, until it answers or a bound of R10
// makes the next call the answer round; the answer and its citations are
// stored like P0's.
func (s *AskUNIService) askAgent(ctx context.Context, userID string, w db.GetWorkspaceWithOrgRow, conv db.AiConversation, base askTurn, in AskInput, ctxItems []agentItem, emit AskSink) (out AskResult, err error) {
	question := base.Question
	res := AskResult{ConversationID: conv.ID, RunID: util.NewID()}
	tc := ai.ToolContext{ActorID: userID, OrganizationID: w.OrganizationID, WorkspaceID: w.ID}
	// What the turn read that the asker did not write (R8): a tainted turn
	// never auto-applies a row.
	taint := askTaint{conv: convTainted(conv)}
	started := s.now()
	// ranFor is the run's own time, taken before the title call that follows it.
	var ranFor time.Duration
	calls, rounds, outcome := 0, 0, ""
	// The outcome is read once the run has returned, after the store, so a
	// turn that failed to store is never reported answered.
	defer func() {
		p := recover()
		switch {
		case p != nil:
			outcome = ai.NoticeAgentFailed
		case outcome != "": // a gate refused the run, failed stored it, or a regenerate kept the old answer
		case err == nil && out.Message.Notice.String != "":
			outcome = out.Message.Notice.String
		case err == nil:
			outcome = "answered"
		case errors.As(err, new(ValidationError)): // a regenerate that lost the race at the store
			outcome = "rejected"
		case errors.Is(err, ai.ErrProviderTimeout) || errors.Is(err, context.DeadlineExceeded):
			outcome = "timeout"
		case errors.Is(err, ai.ErrRateLimited) || errors.Is(err, ai.ErrQuotaExceeded): // ruling P20
			outcome = "rate_limited"
		default:
			outcome = ai.NoticeAgentFailed
		}
		slog.Info("ask uni: agent run", "run_id", res.RunID, "organization_id", w.OrganizationID, "workspace_id", w.ID, "calls", calls, "rounds", rounds, "outcome", outcome)
		if s.agentMetrics != nil {
			s.agentMetrics.ObserveAskRun(outcome, rounds, ranFor.Seconds())
		}
		if p != nil {
			panic(p)
		}
	}()
	// The name comes last, once the run slot below is free (defers run in
	// reverse): a slow title call never keeps an organization's slot.
	var nameWith string
	defer func() {
		ranFor = s.now().Sub(started)
		if nameWith == "" || err != nil {
			return
		}
		// The call is billed even when cancelled, so it outlives an asker who
		// left (askTitleTimeout bounds it); only the frame needs them.
		title, ok := s.generateTitle(context.WithoutCancel(ctx), Human(userID), w.OrganizationID, w.ID, conv.ID, question, nameWith)
		if ok && ctx.Err() == nil {
			emit.emit(AskEvent{Name: "title", Title: &AskTitleEvent{ConversationID: conv.ID, Title: title}})
		}
	}()
	release, err := s.agentRuns.Acquire(ctx, w.OrganizationID)
	if err != nil {
		outcome = "busy"
		return AskResult{}, ai.RateLimited(5 * time.Second)
	}
	defer release()
	// The run's calls and tools stop at the deadline or on Shutdown, which
	// cancels the run with errAskShutdown as its cause; the store uses ctx,
	// so an answer that arrived in time is kept.
	runCtx, done := s.runContext(ctx)
	defer done()
	runCtx, cancel := context.WithTimeout(runCtx, askAgentDeadline)
	defer cancel()
	deadline := started.Add(askAgentDeadline)

	rows, err := s.q.AiListMessages(runCtx, conv.ID)
	if err != nil {
		return AskResult{}, err
	}
	// A conversation with no stored answer yet gets its name from this one (a
	// refused or failed turn stored only a notice); a regenerate never does.
	first := base.Regenerates == "" && !slices.ContainsFunc(rows, func(r db.AiMessage) bool {
		return r.Role == "assistant" && r.Content != "" && r.Notice.String == ""
	})
	var regenerated db.AiMessage // the question a regenerate answers again
	if base.Regenerates != "" {
		// The model sees the conversation as it was before the question it
		// answers again: neither that question nor the old answer.
		i := slices.IndexFunc(rows, func(r db.AiMessage) bool { return r.ID == base.Regenerates })
		if i < 1 {
			outcome = "rejected" // a refusal, not a failed run
			return AskResult{}, Invalid(errRegenerateTarget)
		}
		regenerated, rows = rows[i-1], rows[:i-1]
	}
	// The turn reads its question's files and those of the questions history
	// replays (UNI-2119); a regenerate reads its question's again. The flag
	// turned off stops the earlier files, never the ones this question sent.
	window := historyWindow(rows)
	if regenerated.ID != "" {
		window = append(slices.Clip(window), regenerated)
	}
	var plan askFilePlan
	if len(base.Files) > 0 || s.attachmentsEnabled(runCtx, userID, w) {
		var release func()
		if plan, release, err = s.turnFilePlan(runCtx, files.Scope{OrganizationID: w.OrganizationID, WorkspaceID: w.ID}, window, base.Files); err != nil {
			if errors.Is(err, ai.ErrAttachmentUnreadable) {
				outcome = "rejected"
			}
			return AskResult{}, err
		}
		// Held until the run returns, before the title call that follows it.
		defer release()
	}
	withFiles := len(plan.Files) > 0
	if withFiles || len(base.Files) > 0 { // a file is never the asker's own words (R8)
		s.taintNow(runCtx, w.OrganizationID, conv.ID, &taint)
	}
	base.FileNotes = plan.Notes
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
	// The focus and mentions were read before the run, in AskStream; here they
	// are numbered and rendered for the prompt's focus block, capped like a
	// tool result (ruling P11).
	firstNew := book.next
	s.taintFrom(runCtx, tc, conv.ID, &taint, ctxItems)
	focus, _ := book.render(ctxItems, askAgentToolResultMax)

	// The first call's organization budget is counted here, before run, so a
	// refusal comes before any event (R5); the loop reuses the count.
	firstOver := s.agentCallOver(runCtx, w.OrganizationID)
	if firstOver {
		outcome = "rate_limited"
		return AskResult{}, ai.RateLimited(askRateWindow)
	}
	emit.emit(AskEvent{Name: "run", Run: &AskRunEvent{RunID: res.RunID, ConversationID: conv.ID}})
	if cs := book.since(firstNew); len(cs) > 0 {
		emit.emit(AskEvent{Name: "sources", Sources: cs})
	}

	// The write tools go to a dock turn only, with the actions open (R2).
	writes := s.turnWrites(runCtx, tc, in)
	vars := map[string]any{"locale": in.Locale, "today": s.now().Format("2006-01-02"), "focus": focus, "question": question}
	promptID := ai.PromptCopilotAnswerV3
	if in.Dock {
		promptID = ai.PromptCopilotAnswerV4
	}
	// A turn with files runs @5, the dock's prompt with them, on either route,
	// so its follow-ups are split off on either route too.
	splitOff := in.Dock || withFiles
	if withFiles {
		promptID, vars["files"] = ai.PromptCopilotAnswerV5, plan.Files
	}
	if writes != nil { // @4 and @5 with the action rules (R12)
		promptID = ai.PromptCopilotAnswerV6
		if withFiles {
			promptID = ai.PromptCopilotAnswerV7
		}
	}
	// Reasoning shows only where it streams: the dock's route.
	thinking := emit != nil && s.thinkingOn(runCtx, tc)
	if narrated, ok := askNarrated[promptID]; ok && thinking {
		promptID = narrated
	}
	// The asker's own memory rides the dock's prompt (P4, R8); it is their
	// own words, so it does not taint the turn.
	memory, err := s.turnMemory(runCtx, tc, in)
	if err != nil {
		return AskResult{}, err
	}
	if memory != nil {
		promptID, vars["memory"] = askWithMemory[promptID], memory.promptEntries()
	}
	prompt, _ := ai.LookupPrompt(promptID)
	hist := history(rows, true)
	if err := s.historyProposals(runCtx, w.OrganizationID, rows, hist); err != nil {
		return AskResult{}, err
	}
	// The rendered question as the gateway sends it on the first call, with
	// the files; later calls replay it byte for byte, so the cached prefix
	// holds, and send the files again on it (a tool-result turn or a
	// continuation takes no Attachments).
	msgs := append(slices.Clip(hist), provider.Message{Role: "user", Content: prompt.Render(vars), Parts: plan.Parts})
	tools := s.agentTools()
	model, effort := s.resolveAskModel(runCtx, w.OrganizationID, in.Model, in.Effort)
	// The answer records the choice when it held, Auto ("") when it fell back.
	if model != "" {
		base.Model = in.Model
	}
	req := ai.Request{
		Actor: Human(userID), OrganizationID: w.OrganizationID, WorkspaceID: w.ID,
		Capability: ai.CapCopilotAgent, PromptID: promptID, Vars: vars, History: hist,
		Tools: agentToolRegistry(tools, writes.offered()), FilterToolCalls: true, RunID: res.RunID, Model: model, Effort: effort,
		Attachments: plan.Parts,
	}
	// Every call streams its text to the asker as it arrives (R2); without a
	// sink nothing streams.
	draft := &askDraft{emit: emit, cutFollowups: splitOff}
	if emit != nil {
		req.OnDelta = draft.add
	}
	outputBudget := askAgentOutputBudget
	if thinking {
		req.Thinking, req.OnThinking = true, draft.think
		outputBudget = askAgentThinkingOutputBudget
	}
	var steps []AskStep // the tool steps so far, stored with the turn
	// withThought is steps and, when the current call has thought, a think
	// step: the thinking that led to the answer (or to where a stop cut it).
	withThought := func() []AskStep {
		if t := draft.takeThought(); t != "" {
			return append(steps, AskStep{Kind: "think", Thought: t, Counts: map[string]int{}})
		}
		return steps
	}
	spentInput := 0 // the input budget's count, cached tokens included (P12)
	billed := ""    // the usage row of the last call that answered
	call := func() (ai.Response, error) {
		draft.reset()
		req.MeterKey = "ask-uni:" + res.RunID + ":" + strconv.Itoa(calls)
		r, err := s.gw.Complete(runCtx, req)
		calls++
		req.Attachments = nil // from here on the files ride the question in msgs
		res.InputTokens += r.InputTokens
		res.OutputTokens += r.OutputTokens
		res.Usage.add(r.InputTokens, r.OutputTokens, r.CacheReadTokens, r.CacheWriteTokens)
		if withFiles {
			// The files are sent again every round and mostly read back from the
			// cache, which counts a tenth here, as it is priced (spec §5.6).
			spentInput += r.InputTokens + r.CacheWriteTokens + r.CacheReadTokens/10
		} else {
			spentInput += r.InputTokens + r.CacheReadTokens + r.CacheWriteTokens
		}
		if err == nil {
			billed = r.UsageEventID
		}
		return r, err
	}
	// The gateway hands back no Response with an error, so a call that was
	// billed and failed has its tokens read from its usage row.
	rowUsage := func(ctx context.Context, id string) {
		if row, rerr := s.q.AiGetUsageEvent(ctx, id); rerr == nil && row.OrganizationID == w.OrganizationID {
			res.InputTokens += int(row.InputTokens)
			res.OutputTokens += int(row.OutputTokens)
			res.Usage.add(int(row.InputTokens), int(row.OutputTokens), 0, 0)
		}
	}
	// A regenerate that ends with no answer stores nothing and supersedes
	// nothing: the answer it was to replace stays, and the error ends the
	// stream with no done. Its calls stay billed.
	regen := base.Regenerates != ""
	keepOld := func(o string, err error) (AskResult, error) {
		outcome = o
		return AskResult{}, err
	}
	// A refusal on any call stores the notice.
	refused := func(err error) (AskResult, error) {
		var e *ai.Error
		errors.As(err, &e)
		rowUsage(ctx, e.UsageEventID)
		if regen {
			return keepOld(ai.NoticeRefused, err)
		}
		return s.finishAgent(ctx, emit, res, w, conv, base, "", ai.NoticeRefused, []AskCitation{}, e.UsageEventID, steps, nil, nil)
	}
	// A stop (askStopNotice) stores the text the asker saw streamed for the
	// last call, with what it cites, on a context that outlives the request,
	// and ends with done (the asker may be gone; the next read shows the turn).
	stop := func(notice string, err error) (AskResult, error) {
		if regen && draft.sent == "" {
			return keepOld(notice, err)
		}
		sctx, cancel := outliving(ctx)
		defer cancel()
		usage := billed
		var e *ai.Error
		if errors.As(err, &e) && e.UsageEventID != "" {
			usage = e.UsageEventID
			rowUsage(sctx, usage)
		}
		// The dock's draft stops before the follow-up block, so a stop keeps the
		// answer cut there and no question.
		return s.finishAgent(sctx, emit, res, w, conv, base, draft.sent, notice, agentCitations(draft.sent, book), usage, withThought(), nil, nil)
	}
	// Any other error after a call was billed stores the turn with
	// agent_failed (ruling P19), on a context that outlives the run's
	// deadline, so the asker keeps the question and a trace of the spend.
	// Before that it is the error, as P0's.
	failed := func(err error) (AskResult, error) {
		if billed == "" {
			return AskResult{}, err
		}
		outcome = ai.NoticeAgentFailed
		if errors.Is(err, ai.ErrProviderTimeout) || errors.Is(err, context.DeadlineExceeded) {
			outcome = "timeout"
		} else if errors.Is(err, ai.ErrRateLimited) || errors.Is(err, ai.ErrQuotaExceeded) {
			outcome = "rate_limited"
		}
		usage := billed
		var e *ai.Error
		if errors.As(err, &e) && e.UsageEventID != "" {
			usage = e.UsageEventID
		}
		slog.Warn("ask uni: agent run failed", "run_id", res.RunID, "organization_id", w.OrganizationID, "err", err)
		if regen {
			return AskResult{}, err
		}
		sctx, cancel := outliving(ctx)
		defer cancel()
		return s.finishAgent(sctx, emit, res, w, conv, base, "", ai.NoticeAgentFailed, []AskCitation{}, usage, steps, nil, nil)
	}

	var resp ai.Response
	for final := false; ; {
		over := firstOver
		if calls > 0 {
			over = s.agentCallOver(runCtx, w.OrganizationID)
		}
		if calls > 0 {
			final = over || rounds == askAgentMaxToolRounds || spentInput >= askAgentInputBudget ||
				res.OutputTokens >= outputBudget || deadline.Sub(s.now()) < askAgentFinalReserve
		}
		if final {
			msgs[len(msgs)-1].Content += askAgentBudgetNote
		}
		resp, err = call()
		if errors.Is(err, ai.ErrRefused) {
			return refused(err)
		}
		if err != nil {
			if n := askStopNotice(ctx, runCtx, err); n != "" {
				return stop(n, err)
			}
			return failed(err)
		}
		if len(resp.ToolCalls) == 0 || final {
			break
		}
		rounds++
		msgs = append(msgs, provider.Message{Role: "assistant", Content: resp.Text, ToolCalls: resp.ToolCalls, Raw: resp.Raw})
		// The round's results share what is left of the input budget, at a
		// conservative 3 bytes a token (ruling P18), so one round cannot carry
		// the next call far past it.
		room := min(askAgentToolResultMax, max(0, (askAgentInputBudget-spentInput)*3))
		// What the model said and thought before asking rides the round's first step.
		note, thought := askStepNote(resp.Text), draft.takeThought()
		for i, c := range resp.ToolCalls {
			before := book.next
			content, step, items, err := s.agentToolCall(runCtx, tools, writes, tc, c, book, i, room)
			if err != nil {
				if n := askStopNotice(ctx, runCtx, err); n != "" {
					return stop(n, err)
				}
				return failed(err)
			}
			// The step follows its tool, which supplies the counts; the client
			// clears the text of the call that asked for it.
			step.Round = rounds
			stored := AskStep{Tool: step.Tool, Label: step.Label, Counts: step.Counts}
			if i == 0 {
				step.Note, stored.Note, stored.Thought = note, note, thought
			}
			s.taintFrom(runCtx, tc, conv.ID, &taint, items)
			draft.step(step)
			steps = append(steps, stored)
			if cs := book.since(before); len(cs) > 0 {
				emit.emit(AskEvent{Name: "sources", Sources: cs})
			}
			room = max(0, room-len(content))
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
		retried := AskStep{Counts: map[string]int{}, Thought: draft.takeThought()}
		draft.step(AskStepEvent{Round: rounds + 1, Phase: "retry", Counts: map[string]int{}})
		steps = append(steps, retried) // stored steps equal the streamed ones
		resp, err = call()
		if errors.Is(err, ai.ErrRefused) {
			return refused(err)
		}
		if err != nil {
			if n := askStopNotice(ctx, runCtx, err); n != "" {
				return stop(n, err)
			}
			return failed(err)
		}
	}
	// The final call answered and was charged: a Stop from here on keeps it
	// (R6), so the store outlives the request.
	sctx, cancelStore := outliving(ctx)
	defer cancelStore()
	if agentMalformed(resp) {
		if regen {
			return keepOld(ai.NoticeAgentFailed, ai.ErrOutputInvalid)
		}
		return s.finishAgent(sctx, emit, res, w, conv, base, "", ai.NoticeAgentFailed, []AskCitation{}, resp.UsageEventID, steps, nil, nil)
	}
	answer := strings.TrimSpace(ai.StripUntrustedTags(resp.Text))
	var followups []string
	if splitOff {
		answer, followups = splitFollowups(answer)
	}
	// Only an answered turn stores its rows, with the taint it ended with.
	if writes != nil {
		writes.tainted = taint.tainted()
	}
	res, err = s.finishAgent(sctx, emit, res, w, conv, base, answer, "", agentCitations(answer, book), resp.UsageEventID, withThought(), followups, writes)
	if first && in.Dock {
		nameWith = namedSources(answer, book)
	}
	return res, err
}

// spacedSourceRef is a citation with the space before it, if any.
var spacedSourceRef = regexp.MustCompile(`( ?)\[(S\d+)\]`)

// namedSources is the answer with each [S#] replaced by its source's title,
// one the book does not know dropped with its space: the title call names
// objects, not numbers.
func namedSources(answer string, b *sourceBook) string {
	return spacedSourceRef.ReplaceAllStringFunc(answer, func(m string) string {
		g := spacedSourceRef.FindStringSubmatch(m)
		if c, ok := b.byID[g[2]]; ok {
			return g[1] + oneLine(c.Title)
		}
		return ""
	})
}

// finishAgent stores the turn with the last call's usage row, and with the
// rows writes recorded (nil on every turn that did not answer). Its text
// already streamed, so it ends with any proposals, citations, any follow-ups
// and done.
func (s *AskUNIService) finishAgent(ctx context.Context, emit AskSink, res AskResult, w db.GetWorkspaceWithOrgRow, conv db.AiConversation, base askTurn, answer, notice string, citations []AskCitation, usageEventID string, steps []AskStep, followups []string, writes *askWrites) (AskResult, error) {
	turn := askTurn{Question: base.Question, Answer: answer, Notice: notice, Citations: citations, UsageEventID: usageEventID, Steps: steps, Followups: followups, Focus: base.Focus, Mentions: base.Mentions, Regenerates: base.Regenerates, Model: base.Model, Files: base.Files, UserID: base.UserID, WorkspaceID: base.WorkspaceID, FileNotes: base.FileNotes}
	if writes != nil {
		turn.Proposals, turn.Mode, turn.Tainted, turn.RunID = writes.rows, writes.mode, writes.tainted, res.RunID
	}
	msg, err := s.store(ctx, w.OrganizationID, conv.ID, turn)
	if err != nil {
		return AskResult{}, err
	}
	res.Message, res.Citations = msg, citations
	if len(turn.Proposals) > 0 {
		if res.Proposals = s.turnProposals(ctx, base.UserID, w.OrganizationID, msg.ID, writes); len(res.Proposals) > 0 {
			emit.emit(AskEvent{Name: "proposal", Proposals: res.Proposals})
		}
	}
	emit.emitDone(res, followups)
	return res, nil
}

// agentToolCall answers the i-th tool call of a reply: past
// askAgentMaxCallsPerRound it is refused unrun, a tool the agent lacks is
// answered unrun, a write tool records a proposal row (agentWriteCall), and
// any other call runs and is rendered within limit bytes. The step reports
// it, counting the sources it found by kind (errors and notes carry no Key).
// It returns the items the tool found or read, for the taint rules. A Go
// error is the server's and ends the run.
func (s *AskUNIService) agentToolCall(ctx context.Context, tools []agentTool, writes *askWrites, tc ai.ToolContext, c provider.ToolCall, b *sourceBook, i, limit int) (string, AskStepEvent, []agentItem, error) {
	started := s.now()
	j := slices.IndexFunc(tools, func(t agentTool) bool { return t.Name == c.Name })
	wt, isWrite := writes.tool(c.Name)
	name := "unknown" // the model's own name would be an unbounded metric label
	if j >= 0 || isWrite {
		name = c.Name
	}
	content, status := "error: too_many_calls", "error"
	step := AskStepEvent{Phase: "tool", Tool: name, Counts: map[string]int{}}
	var err error
	var items []agentItem
	switch {
	case i >= askAgentMaxCallsPerRound:
	case isWrite:
		content, status, step.Label, items, err = s.agentWriteCall(ctx, writes, wt, tc, c.Input)
	case j < 0:
		content = "error: unknown_tool"
	default:
		if items, err = tools[j].run(ctx, tc, c.Input); err == nil {
			content, status = b.toolResult(items, limit)
			step.Label = stepLabel(name, c.Input, items)
		}
		for _, it := range items {
			if it.Key != "" && !b.counted[it.Key] {
				b.counted[it.Key] = true
				step.Counts[it.Kind]++
			}
		}
	}
	// The run's deadline reached inside a tool is the same refusal as one
	// reached inside a model call.
	if errors.Is(err, context.DeadlineExceeded) {
		err = &ai.Error{Code: ai.ErrProviderTimeout.Code, Status: ai.ErrProviderTimeout.Status, Msg: ai.ErrProviderTimeout.Msg, Err: err}
	}
	if s.agentMetrics != nil {
		s.agentMetrics.ObserveAskTool(name, status, s.now().Sub(started).Seconds())
	}
	return content, step, items, err
}

// stepLabelMax is the longest step label, in runes.
const stepLabelMax = 60

// stepLabel names what a step looked at: the object a get_* tool or
// read_chat_room opened (get_project lists its tasks after it), else the
// query a tool was given; "" for any other step. It is object or query text,
// one line, never a UI string.
func stepLabel(tool string, args json.RawMessage, items []agentItem) string {
	var label string
	if strings.HasPrefix(tool, "get_") || tool == "read_chat_room" {
		if len(items) > 0 && items[0].Key != "" {
			label = strings.TrimPrefix(items[0].Title, "Chat: ")
		}
	} else {
		var a struct{ Query string }
		_ = json.Unmarshal(args, &a)
		label = a.Query
	}
	return clipLabel(label)
}

// clipLabel is a step label on one line, at most stepLabelMax runes.
func clipLabel(label string) string {
	label = oneLine(label)
	if r := []rune(label); len(r) > stepLabelMax {
		label = strings.TrimSpace(string(r[:stepLabelMax]))
	}
	return label
}
