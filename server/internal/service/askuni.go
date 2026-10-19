package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// AskUNIService is the read-only copilot (spec F-09 §1 #3). It owns the
// conversation rows and the usage reports; the model call itself is the
// gateway's. Nothing here writes a business table.
type AskUNIService struct {
	pool     *pgxpool.Pool
	q        *db.Queries
	ws       *WorkspaceService
	orgs     *OrganizationService
	tasks    *TaskService
	meetings *MeetingService
	chat     *ChatService
	emailHub *EmailHubService
	docs     *DocumentService
	flags    McpFlags
	reads    *McpToolService // nil until SetReadTools; the agent's tools read through it
	gw       *ai.Gateway
	ent      *EntitlementService
	rdb      *redis.Client
	now      func() time.Time
}

// SetEmailHub wires Email Hub for focus reads (optional; set from main after construction).
func (s *AskUNIService) SetEmailHub(hub *EmailHubService) {
	s.emailHub = hub
}

// SetDocuments wires document search (optional; set from main after construction).
func (s *AskUNIService) SetDocuments(d *DocumentService) { s.docs = d }

// SetFlags wires the feature-flag evaluator; without it the documents flag
// reads as off (fail closed, as in McpToolService).
func (s *AskUNIService) SetFlags(f McpFlags) { s.flags = f }

// SetReadTools wires the MCP connector's read methods, which the agent's tools
// call as the asker (set from main after construction).
func (s *AskUNIService) SetReadTools(m *McpToolService) { s.reads = m }

// taskRow is what the source reader renders; it is the sqlc row.
type taskRow = db.Task

func NewAskUNIService(pool *pgxpool.Pool, q *db.Queries, ws *WorkspaceService, orgs *OrganizationService, tasks *TaskService, meetings *MeetingService, chat *ChatService, gw *ai.Gateway, rdb *redis.Client) *AskUNIService {
	return &AskUNIService{
		pool: pool, q: q, ws: ws, orgs: orgs, tasks: tasks, meetings: meetings, chat: chat, gw: gw,
		ent: NewEntitlementService(pool, q), rdb: rdb, now: time.Now,
	}
}

func (s *AskUNIService) Enabled() bool { return s.gw.Enabled() }

type AICapabilities struct {
	Enabled        bool
	AskUni         bool
	MeetingSummary bool
	UsedTokens     int64
	LimitTokens    *int64
}

type AskInput struct {
	ConversationID string
	Question       string
	Focus          *ai.Focus
	Locale         string
}

// AskCitation is a validated citation enriched with what the client needs to
// render a link; it is what ai_messages.citations stores.
type AskCitation struct {
	SourceID string `json:"source_id"`
	Quote    string `json:"quote"`
	Kind     string `json:"kind"`
	Title    string `json:"title"`
	Href     string `json:"href"`
}

type AskResult struct {
	ConversationID string
	Message        db.AiMessage
	Citations      []AskCitation
	InputTokens    int
	OutputTokens   int
	// RunID is the agent run's id, the run_id on its usage rows; empty on
	// the P0 path.
	RunID string
}

const (
	askRateLimit  = 20
	askRateWindow = time.Minute
	askHistory    = 6
)

// rateLimit is per user, fail-closed (OPEN_QUESTIONS G5): a Redis error is a
// 429, because an unmetered burst here costs real money. No Redis at all
// (local development) means no limit.
func (s *AskUNIService) rateLimit(ctx context.Context, userID string) error {
	if s.rdb == nil {
		return nil
	}
	key := "uw:ai:ask:" + userID
	n, err := s.rdb.Incr(ctx, key).Result()
	if err != nil {
		return &ai.Error{Code: ai.ErrRateLimited.Code, Status: ai.ErrRateLimited.Status, Msg: ai.ErrRateLimited.Msg, Err: err}
	}
	if n == 1 {
		_ = s.rdb.Expire(ctx, key, askRateWindow).Err()
	}
	if n > askRateLimit {
		return ai.ErrRateLimited
	}
	return nil
}

func (s *AskUNIService) requireMember(ctx context.Context, userID, workspaceID string) (db.GetWorkspaceWithOrgRow, error) {
	if _, err := s.ws.RequireMember(ctx, workspaceID, userID); err != nil {
		if errors.Is(err, ErrForbidden) {
			return db.GetWorkspaceWithOrgRow{}, ai.ErrContextForbidden
		}
		return db.GetWorkspaceWithOrgRow{}, err
	}
	return s.q.GetWorkspaceWithOrg(ctx, workspaceID)
}

func (s *AskUNIService) Capabilities(ctx context.Context, userID, workspaceID string) (AICapabilities, error) {
	w, err := s.requireMember(ctx, userID, workspaceID)
	if err != nil {
		return AICapabilities{}, err
	}
	out := AICapabilities{Enabled: s.gw.Enabled()}
	if !out.Enabled {
		return out, nil
	}
	out.AskUni = true
	out.MeetingSummary = s.ent.Can(ctx, w.OrganizationID, FeatureMeetingAISummary) == nil
	snap, err := s.ent.Snapshot(ctx, w.OrganizationID)
	if err != nil {
		return out, nil // capabilities never fail on a billing read; quota just stays unknown
	}
	for _, e := range snap.Entitlements {
		if e.Key == FeatureAITokens {
			out.UsedTokens, out.LimitTokens = e.Current, e.Limit
		}
	}
	return out, nil
}

// Ask is one turn: membership → rate limit → conversation → permitted
// sources → gateway → validated citations → two message rows.
func (s *AskUNIService) Ask(ctx context.Context, userID, workspaceID string, in AskInput) (AskResult, error) {
	question := strings.TrimSpace(in.Question)
	if question == "" {
		return AskResult{}, Invalid("câu hỏi không được để trống")
	}
	if len([]rune(question)) > 2000 {
		return AskResult{}, Invalid("câu hỏi tối đa 2000 ký tự")
	}
	w, err := s.requireMember(ctx, userID, workspaceID)
	if err != nil {
		return AskResult{}, err
	}
	if !s.gw.Enabled() {
		return AskResult{}, ai.ErrDisabled
	}
	if err := s.rateLimit(ctx, userID); err != nil {
		return AskResult{}, err
	}
	conv, err := s.conversation(ctx, userID, w, in.ConversationID)
	if err != nil {
		return AskResult{}, err
	}
	// Behind ask_uni_agent the model looks its sources up itself; P0's
	// lookup below does not run.
	if s.agentOn(ctx, ai.ToolContext{ActorID: userID, OrganizationID: w.OrganizationID, WorkspaceID: workspaceID}) {
		return s.askAgent(ctx, userID, w, conv, question, in)
	}
	sources, err := s.Sources(ctx, ai.SourceQuery{UserID: userID, OrganizationID: w.OrganizationID, WorkspaceID: workspaceID, Question: question, Focus: in.Focus})
	if err != nil {
		if errors.Is(err, ErrForbidden) {
			return AskResult{}, ai.ErrContextForbidden
		}
		return AskResult{}, err
	}
	rows, err := s.q.AiListMessages(ctx, conv.ID)
	if err != nil {
		return AskResult{}, err
	}
	if !hasOwnSubject(question, w.TaskPrefix, in.Focus, sources) {
		if sources, err = s.withLastTopic(ctx, rows, userID, w.OrganizationID, workspaceID, question, sources); err != nil {
			return AskResult{}, err
		}
	}
	pack, truncated := ai.BuildContext(sources)

	answer := ai.Answer{Citations: []ai.Citation{}}
	notice := ai.NoticeNoSources
	var resp ai.Response
	if len(pack) > 0 {
		notice = ""
		resp, err = s.gw.Complete(ctx, ai.Request{
			Actor: Human(userID), OrganizationID: w.OrganizationID, WorkspaceID: workspaceID,
			Capability: ai.CapCopilotAnswer, PromptID: ai.PromptCopilotAnswer,
			Vars: map[string]any{
				"question": ai.EscapeUntrusted(question), "locale": in.Locale, "today": s.now().Format("2006-01-02"),
				"sources": ai.RenderSources(pack),
			},
			History: history(rows), Sources: pack, Truncated: truncated, Tools: AskUniTools(s),
		})
		if err != nil {
			return AskResult{}, err
		}
		answer, err = ai.ParseAnswer(resp.Text, pack)
		if err != nil {
			return AskResult{}, err
		}
		answer.Answer = ai.StripUntrustedTags(answer.Answer)
		if strings.TrimSpace(answer.Answer) == "" {
			answer.Answer, notice = "", ai.NoticeEmptyAnswer
		}
	}
	citations := make([]AskCitation, 0, len(answer.Citations))
	for _, c := range answer.Citations {
		for _, src := range pack {
			if src.ID == c.SourceID {
				citations = append(citations, AskCitation{SourceID: c.SourceID, Quote: c.Quote, Kind: src.Kind, Title: src.Title, Href: src.Href})
			}
		}
	}
	msg, err := s.store(ctx, w.OrganizationID, conv.ID, question, answer.Answer, notice, citations, resp.UsageEventID)
	if err != nil {
		return AskResult{}, err
	}
	return AskResult{ConversationID: conv.ID, Message: msg, Citations: citations, InputTokens: resp.InputTokens, OutputTokens: resp.OutputTokens}, nil
}

func (s *AskUNIService) conversation(ctx context.Context, userID string, w db.GetWorkspaceWithOrgRow, id string) (db.AiConversation, error) {
	if id == "" {
		return s.q.AiCreateConversation(ctx, db.AiCreateConversationParams{
			ID: util.NewID(), OrganizationID: w.OrganizationID, WorkspaceID: w.ID, UserID: userID,
		})
	}
	return s.ownConversation(ctx, userID, id, w.ID)
}

// ownConversation: a conversation belongs to one person; anyone else gets
// 404, never 403, so the id leaks nothing.
func (s *AskUNIService) ownConversation(ctx context.Context, userID, id, workspaceID string) (db.AiConversation, error) {
	conv, err := s.q.AiGetConversation(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (conv.UserID != userID || (workspaceID != "" && conv.WorkspaceID != workspaceID))) {
		return db.AiConversation{}, ErrNotFound
	}
	return conv, err
}

// hasOwnSubject reports whether the question names something of its own: a
// focused object, a reference with the workspace's task prefix, a question
// about overdue work, or a task, meeting or document whose title holds one of
// its terms. A body match is not enough ("giao cho" is in every welcome task),
// members and chat lines never are, and a question that points back keeps the
// last topic even when a title shares a word with it ("bắt đầu" is the
// welcome task's title) or asks about lateness ("Nó có trễ không?").
func hasOwnSubject(question, taskPrefix string, focus *ai.Focus, sources []ai.Source) bool {
	if focus != nil {
		return true
	}
	for _, m := range taskIdentifierRe.FindAllStringSubmatch(question, 5) {
		if strings.EqualFold(m[1], taskPrefix) { // "Q1-2027" or "COVID-19" names no task
			return true
		}
	}
	if pointsBack(question) {
		return false
	}
	if asksOverdue(question) {
		return true
	}
	ts := searchTerms(question)
	for _, src := range sources {
		if namesIt(src, ts) {
			return true
		}
	}
	return false
}

// namesIt reports whether a task, meeting or document source's title holds one
// of the question's terms.
func namesIt(src ai.Source, ts []string) bool {
	return src.Kind != "members" && src.Kind != "chat" && score(src.Title, ts) > 0
}

// pointsBack reports whether the question refers to what was said before:
// "cái đó", "nó", "anh ấy", "that". Phrases match as typed, not folded: "ít"
// folds to "it", "thật" to "that", and "việc do Lan làm" is not "việc đó", so
// only the unaccented spelling of each phrase counts.
func pointsBack(q string) bool {
	ws := words(q)
	for _, w := range ws {
		switch w {
		case "đó", "đấy", "ấy", "nó":
			return true
		}
	}
	hay := " " + strings.Join(ws, " ") + " "
	for _, p := range []string{"cai do", "viec do", "task do", "nguoi do", "cai nay", "viec nay", "cai kia", "that", "it"} {
		if strings.Contains(hay, " "+p+" ") {
			return true
		}
	}
	return false
}

// previousQuestion is the raw text of the conversation's last question, not
// the wrapped history copy. When it points back, the nearest earlier question
// that does not (the one that named the topic) comes before it, so a drill-down
// keeps its topic at any length; "" for a new conversation.
func previousQuestion(rows []db.AiMessage) string {
	last, topic := "", ""
	for i := len(rows) - 1; i >= 0; i-- {
		if rows[i].Role != "user" {
			continue
		}
		if last == "" {
			last = rows[i].Content
		}
		topic = rows[i].Content
		if !pointsBack(topic) {
			break
		}
	}
	if topic == last {
		return last
	}
	return topic + " " + last
}

// maxCarried caps the cited objects a follow-up carries: a model cites a few,
// the fake provider cites its whole pack.
const maxCarried = 5

// citedPaths is the href segment before the id, per kind a turn can carry.
var citedPaths = map[string]string{"task": "/tasks/", "meeting": "/meetings/", "document": "/documents/"}

// withLastTopic adds what the last turn was about to the current sources, so a
// follow-up like "who owns that?" or a bare "Ai nhận?" keeps its topic. That
// is the objects the last answers cited (see citedTopic), read again as the
// asker; when there are none, the tasks, meetings and documents found for
// "<previous question> <question>" stand in. The topic comes after the sources the question names
// by title and before its body hits, which a bare "Ai nhận?" can find twenty
// of: BuildContext keeps the first ai.MaxSources. Focus is not repeated: the
// first lookup already carries it.
func (s *AskUNIService) withLastTopic(ctx context.Context, rows []db.AiMessage, userID, orgID, workspaceID, question string, sources []ai.Source) ([]ai.Source, error) {
	current := map[string]ai.Source{}
	for _, src := range sources {
		current[src.Href] = src
	}
	topic, err := s.citedTopic(ctx, ai.ToolContext{ActorID: userID, OrganizationID: orgID, WorkspaceID: workspaceID}, rows, current)
	if prev := previousQuestion(rows); err == nil && len(topic) == 0 && prev != "" {
		var found []ai.Source
		found, err = s.Sources(ctx, ai.SourceQuery{UserID: userID, OrganizationID: orgID, WorkspaceID: workspaceID, Question: prev + " " + question})
		for _, src := range found {
			if citedPaths[src.Kind] != "" { // chat and members are never a turn's subject
				topic = append(topic, src)
			}
		}
	}
	if err != nil {
		if errors.Is(err, ErrForbidden) {
			return nil, ai.ErrContextForbidden
		}
		return nil, err
	}
	inTopic := map[string]bool{}
	var carried []ai.Source
	for _, src := range topic {
		if !inTopic[src.Href] && len(carried) < maxCarried {
			inTopic[src.Href] = true
			carried = append(carried, src)
		}
	}
	ts := searchTerms(question)
	var named, rest []ai.Source
	for _, src := range sources {
		switch {
		case inTopic[src.Href]: // placed with the topic
		case namesIt(src, ts):
			named = append(named, src)
		default:
			rest = append(rest, src)
		}
	}
	if room := ai.MaxSources - len(carried); len(named) > room {
		named = named[:room]
	}
	return append(append(named, carried...), rest...), nil
}

// citedTopic reads again, through the asker's own services, the tasks, meetings
// and documents the latest answer cited, maxCarried at most; one the current
// lookup already holds is taken from it. An answer that cited none of them is
// passed over only when its question pointed back, three answers back at most:
// "Mua quà ai duyệt?" answered from chat is a new topic, "Cái đó ai duyệt?" is
// not. An object the asker can no longer read is left out; chat and members are
// never a turn's subject, and an email thread comes back only as focus.
func (s *AskUNIService) citedTopic(ctx context.Context, tc ai.ToolContext, rows []db.AiMessage, current map[string]ai.Source) ([]ai.Source, error) {
	var cited []AskCitation
	for i, answers := len(rows)-1, 0; i >= 0 && answers < 3; i-- {
		if rows[i].Role != "assistant" {
			continue
		}
		answers++
		var cs []AskCitation
		if json.Unmarshal([]byte(rows[i].Citations), &cs) != nil {
			cs = nil // a row that does not decode cites nothing
		}
		for _, c := range cs {
			if citedPaths[c.Kind] != "" {
				cited = append(cited, c)
			}
		}
		if len(cited) > 0 || !pointsBack(questionOf(rows, i)) {
			break
		}
	}
	var out []ai.Source
	seen := map[string]bool{}
	for _, c := range cited {
		if len(out) == maxCarried {
			break
		}
		if seen[c.Href] {
			continue
		}
		seen[c.Href] = true
		if src, ok := current[c.Href]; ok {
			out = append(out, src)
			continue
		}
		id, ok := citedID(c)
		if !ok {
			continue
		}
		var srcs []ai.Source
		var err error
		switch c.Kind {
		case "task":
			srcs, err = s.taskContext(ctx, tc, id)
		case "meeting":
			srcs, err = s.meetingContext(ctx, tc, id)
		case "document":
			srcs = s.documentContext(ctx, tc, id)
		}
		if isGateRefusal(err) {
			continue
		}
		if err != nil {
			return nil, err
		}
		out = append(out, srcs...)
	}
	return out, nil
}

// questionOf is the question the answer at rows[i] replied to.
func questionOf(rows []db.AiMessage, i int) string {
	for j := i - 1; j >= 0; j-- {
		if rows[j].Role == "user" {
			return rows[j].Content
		}
	}
	return ""
}

// citedID is the id at the end of a citation's href when the href has the
// shape its kind is stored with ("…/tasks/<id>"); any other href names nothing.
func citedID(c AskCitation) (string, bool) {
	seg := citedPaths[c.Kind]
	i := strings.LastIndex(c.Href, seg)
	if seg == "" || i < 0 {
		return "", false
	}
	id := c.Href[i+len(seg):]
	return id, id != "" && !strings.ContainsAny(id, "/?#")
}

// history replays the conversation's last turns, wrapped as untrusted.
func history(rows []db.AiMessage) []provider.Message {
	// Drop notice replies (no sources, empty answer, or the fixed text older
	// rows stored) before windowing, so they neither mislead the model nor eat a turn.
	var kept []db.AiMessage
	for _, r := range rows {
		if r.Role == "assistant" && (r.Notice.String != "" || r.Content == ai.NoSourcesAnswer) {
			continue
		}
		kept = append(kept, r)
	}
	if len(kept) > askHistory {
		kept = kept[len(kept)-askHistory:]
	}
	out := make([]provider.Message, 0, len(kept))
	for _, r := range kept {
		src := "question"
		if r.Role == "assistant" {
			src = "prior_answer"
		}
		out = append(out, provider.Message{Role: r.Role, Content: ai.WrapUntrusted(src, r.Content)})
	}
	return out
}

func (s *AskUNIService) store(ctx context.Context, orgID, convID, question, answer, notice string, citations []AskCitation, usageEventID string) (db.AiMessage, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.AiMessage{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.q.WithTx(tx)
	if _, err := q.AiInsertMessage(ctx, db.AiInsertMessageParams{
		ID: util.NewID(), OrganizationID: orgID, ConversationID: convID, Role: "user", Content: question, Citations: "[]",
	}); err != nil {
		return db.AiMessage{}, err
	}
	cj, _ := json.Marshal(citations)
	msg, err := q.AiInsertMessage(ctx, db.AiInsertMessageParams{
		ID: util.NewID(), OrganizationID: orgID, ConversationID: convID, Role: "assistant", Content: answer,
		Citations: string(cj), UsageEventID: strText(usageEventID), Notice: strText(notice),
	})
	if err != nil {
		return db.AiMessage{}, err
	}
	title := question
	if r := []rune(title); len(r) > 80 {
		title = string(r[:80]) + "…"
	}
	if err := q.AiTouchConversation(ctx, db.AiTouchConversationParams{ID: convID, Title: title}); err != nil {
		return db.AiMessage{}, err
	}
	return msg, tx.Commit(ctx)
}

func (s *AskUNIService) ListConversations(ctx context.Context, userID, workspaceID string) ([]db.AiConversation, error) {
	if _, err := s.requireMember(ctx, userID, workspaceID); err != nil {
		return nil, err
	}
	return s.q.AiListConversations(ctx, db.AiListConversationsParams{WorkspaceID: workspaceID, UserID: userID})
}

func (s *AskUNIService) Messages(ctx context.Context, userID, conversationID string) ([]db.AiMessage, error) {
	if _, err := s.ownConversation(ctx, userID, conversationID, ""); err != nil {
		return nil, err
	}
	return s.q.AiListMessages(ctx, conversationID)
}

func (s *AskUNIService) DeleteConversation(ctx context.Context, userID, conversationID string) error {
	if _, err := s.ownConversation(ctx, userID, conversationID, ""); err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.q.WithTx(tx)
	if err := q.AiDeleteMessages(ctx, conversationID); err != nil {
		return err
	}
	if err := q.AiDeleteConversation(ctx, conversationID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ---- Usage reports (spec §5) ----------------------------------------------

type AIUsageRow struct {
	Day          time.Time
	Capability   string
	ActorKind    string
	WorkspaceID  string
	Calls        int64
	InputTokens  int64
	OutputTokens int64
	CostMicros   int64
}

type AIUsageSummary struct {
	From, To time.Time
	Rows     []AIUsageRow
}

// usageRange fills in the window the caller left open. The end is only ever
// reported, never queried with, when the caller named none — see usage.
func usageRange(now, from, to time.Time) (time.Time, time.Time) {
	if to.IsZero() {
		to = now
	}
	if from.IsZero() {
		from = to.AddDate(0, 0, -30)
	}
	return from, to
}

func (s *AskUNIService) usage(ctx context.Context, orgID, workspaceID string, from, to time.Time) (AIUsageSummary, error) {
	// "Everything so far" is asked of the database as an open end, not as this
	// process's clock. `created_at` comes from PostgreSQL, so an app host whose
	// clock lags the database's by milliseconds — two machines in production, a
	// VM on a laptop — would otherwise hide the call the caller just made. An
	// end the caller named is a date they chose and is still applied.
	toAt := pgtype.Timestamptz{}
	if !to.IsZero() {
		toAt = pgtype.Timestamptz{Time: to, Valid: true}
	}
	from, to = usageRange(s.now(), from, to)
	rows, err := s.q.AiUsageByDay(ctx, db.AiUsageByDayParams{
		OrganizationID: orgID, WorkspaceID: strText(workspaceID),
		FromAt: pgtype.Timestamptz{Time: from, Valid: true}, ToAt: toAt,
	})
	if err != nil {
		return AIUsageSummary{}, err
	}
	out := AIUsageSummary{From: from, To: to, Rows: make([]AIUsageRow, 0, len(rows))}
	for _, r := range rows {
		out.Rows = append(out.Rows, AIUsageRow{
			Day: r.Day.Time, Capability: r.Capability, ActorKind: r.ActorKind, WorkspaceID: r.WorkspaceID,
			Calls: r.Calls, InputTokens: r.InputTokens, OutputTokens: r.OutputTokens, CostMicros: r.CostMicros,
		})
	}
	return out, nil
}

// WorkspaceUsage: workspace owners/admins (organization admins implicitly).
func (s *AskUNIService) WorkspaceUsage(ctx context.Context, userID, workspaceID string, from, to time.Time) (AIUsageSummary, error) {
	m, err := s.ws.RequireMember(ctx, workspaceID, userID)
	if err != nil {
		return AIUsageSummary{}, err
	}
	if !adminLikeRole(m.Role) {
		return AIUsageSummary{}, ErrForbidden
	}
	w, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return AIUsageSummary{}, err
	}
	return s.usage(ctx, w.OrganizationID, workspaceID, from, to)
}

// OrganizationUsage: organization owners/admins, every workspace.
func (s *AskUNIService) OrganizationUsage(ctx context.Context, userID, orgID string, from, to time.Time) (AIUsageSummary, error) {
	m, err := s.orgs.RequireMember(ctx, orgID, userID)
	if err != nil {
		return AIUsageSummary{}, err
	}
	if !adminLikeRole(m.Role) {
		return AIUsageSummary{}, ErrForbidden
	}
	return s.usage(ctx, orgID, "", from, to)
}
