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
	gw       *ai.Gateway
	ent      *EntitlementService
	rdb      *redis.Client
	now      func() time.Time
}

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
	sources, err := s.Sources(ctx, ai.SourceQuery{UserID: userID, OrganizationID: w.OrganizationID, WorkspaceID: workspaceID, Question: question, Focus: in.Focus})
	if err != nil {
		if errors.Is(err, ErrForbidden) {
			return AskResult{}, ai.ErrContextForbidden
		}
		return AskResult{}, err
	}
	pack, truncated := ai.BuildContext(sources)

	answer := ai.Answer{Answer: ai.NoSourcesAnswer, Citations: []ai.Citation{}}
	var resp ai.Response
	if len(pack) > 0 {
		history, err := s.history(ctx, conv.ID)
		if err != nil {
			return AskResult{}, err
		}
		resp, err = s.gw.Complete(ctx, ai.Request{
			Actor: Human(userID), OrganizationID: w.OrganizationID, WorkspaceID: workspaceID,
			Capability: ai.CapCopilotAnswer, PromptID: ai.PromptCopilotAnswer,
			Vars: map[string]any{
				"question": question, "locale": in.Locale, "today": s.now().Format("2006-01-02"),
				"sources": ai.RenderSources(pack),
			},
			History: history, Sources: pack, Truncated: truncated, Tools: AskUniTools(s),
		})
		if err != nil {
			return AskResult{}, err
		}
		answer, err = ai.ParseAnswer(resp.Text, pack)
		if err != nil {
			return AskResult{}, err
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
	msg, err := s.store(ctx, w.OrganizationID, conv.ID, question, answer.Answer, citations, resp.UsageEventID)
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

func (s *AskUNIService) history(ctx context.Context, convID string) ([]provider.Message, error) {
	rows, err := s.q.AiListMessages(ctx, convID)
	if err != nil {
		return nil, err
	}
	if len(rows) > askHistory {
		rows = rows[len(rows)-askHistory:]
	}
	out := make([]provider.Message, 0, len(rows))
	for _, r := range rows {
		out = append(out, provider.Message{Role: r.Role, Content: r.Content})
	}
	return out, nil
}

func (s *AskUNIService) store(ctx context.Context, orgID, convID, question, answer string, citations []AskCitation, usageEventID string) (db.AiMessage, error) {
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
		Citations: string(cj), UsageEventID: strText(usageEventID),
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
	from, to = usageRange(s.now(), from, to)
	rows, err := s.q.AiUsageByDay(ctx, db.AiUsageByDayParams{
		OrganizationID: orgID, WorkspaceID: strText(workspaceID),
		FromAt: pgtype.Timestamptz{Time: from, Valid: true}, ToAt: pgtype.Timestamptz{Time: to, Valid: true},
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
