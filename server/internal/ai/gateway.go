// Package ai is the AI Gateway: the one door every LLM call in UniWork goes
// through (spec F-09). Pipeline per call: policy → quota → usage row
// (pending) → provider → tool allowlist → usage row (final, priced) → quota
// meter → ai.usage.updated → metrics. Nothing here reads a business table;
// context comes in from the caller, already permission-checked.
package ai

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Quota is the entitlement gate seen from here. Check refuses with
// ErrQuotaExceeded before the provider is asked; Record meters what the
// provider actually charged and never refuses.
type Quota interface {
	Check(ctx context.Context, organizationID string) error
	Record(ctx context.Context, in UsageRecord) error
}

type UsageRecord struct {
	OrganizationID string
	WorkspaceID    string
	Actor          audit.Actor
	Tokens         int64
	UsageEventID   string
}

// Metrics is satisfied by metrics.AI; nil is fine.
type Metrics interface {
	ObserveAICall(capability, status string, latency time.Duration)
	// ObserveAIUsage is called once per priced call with tokens and cost.
	ObserveAIUsage(provider, model, organizationID string, inputTokens, outputTokens int, costUSD float64)
}

type Request struct {
	Actor          audit.Actor
	OrganizationID string
	WorkspaceID    string
	Capability     Capability
	PromptID       string
	Vars           map[string]any
	// History is prior turns of a conversation, oldest first; the rendered
	// prompt becomes the final user message.
	History []provider.Message
	// Sources is the context pack, for the audit columns only — the caller
	// renders it into Vars.
	Sources   []Source
	Truncated bool
	// Tools the model may call this turn. A call to anything else fails the
	// request with ErrToolNotAllowed.
	Tools Registry
}

type Response struct {
	Text         string
	ToolCalls    []provider.ToolCall
	UsageEventID string
	Model        string
	Provider     string
	InputTokens  int
	OutputTokens int
}

type Gateway struct {
	q       *db.Queries
	p       provider.Provider
	quota   Quota
	rec     *audit.Recorder
	opts    Options
	metrics Metrics
	log     *slog.Logger
	now     func() time.Time
}

// NewGateway wires the pipeline. p == nil yields a disabled gateway that
// refuses with ErrDisabled and reports Enabled() == false.
func NewGateway(q *db.Queries, p provider.Provider, quota Quota, rec *audit.Recorder, opts Options) *Gateway {
	if opts.Timeout <= 0 {
		opts.Timeout = 60 * time.Second
	}
	return &Gateway{q: q, p: p, quota: quota, rec: rec, opts: opts, log: slog.Default(), now: time.Now}
}

func (g *Gateway) Enabled() bool { return g != nil && g.p != nil }

func (g *Gateway) Provider() string {
	if !g.Enabled() {
		return ""
	}
	return g.p.Name()
}

func (g *Gateway) SetMetrics(m Metrics) { g.metrics = m }

func (g *Gateway) Complete(ctx context.Context, req Request) (Response, error) {
	if !g.Enabled() {
		return Response{}, ErrDisabled
	}
	prompt, ok := LookupPrompt(req.PromptID)
	if !ok {
		return Response{}, errPolicy("unknown prompt " + req.PromptID)
	}
	policy, model, err := ResolveModel(req.Capability, g.p.Name(), g.opts.Env, g.opts.ExtraAllow)
	if err != nil {
		return Response{}, err
	}
	if g.quota != nil {
		if err := g.quota.Check(ctx, req.OrganizationID); err != nil {
			if errors.Is(err, ErrQuotaExceeded) {
				_, _ = g.insertUsage(ctx, req, model, "rejected", ErrQuotaExceeded.Code)
				g.observe(req.Capability, "rejected", 0)
			}
			return Response{}, err
		}
	}
	row, err := g.insertUsage(ctx, req, model, "pending", "")
	if err != nil {
		return Response{}, err
	}
	creq := provider.CompletionRequest{
		Model: model, System: prompt.System, MaxTokens: policy.MaxTokens, Temperature: policy.Temperature,
		JSONSchema: prompt.OutputSchema,
	}
	creq.Messages = append(creq.Messages, req.History...)
	creq.Messages = append(creq.Messages, provider.Message{Role: "user", Content: prompt.Render(req.Vars)})
	for _, t := range req.Tools {
		creq.Tools = append(creq.Tools, provider.ToolSpec{Name: t.Name, Description: t.Description, Schema: t.Schema})
	}
	cctx, cancel := context.WithTimeout(ctx, g.opts.Timeout)
	started := g.now()
	resp, perr := g.p.Complete(cctx, creq)
	cancel()
	latency := g.now().Sub(started)
	if perr != nil {
		_ = g.finish(ctx, row.ID, row.OrganizationID, resp, "failed", ErrProviderError.Code, latency, nil)
		g.observe(req.Capability, "failed", latency)
		g.log.Warn("ai: provider error", "usage_event_id", row.ID, "capability", req.Capability, "latency_ms", latency.Milliseconds(), "err", perr)
		return Response{}, ErrProviderError.wrap(perr)
	}
	calls, denied := auditToolCalls(resp.ToolCalls, req.Tools)
	if denied != "" {
		_ = g.finish(ctx, row.ID, row.OrganizationID, resp, "failed", ErrToolNotAllowed.Code, latency, calls)
		g.observe(req.Capability, "failed", latency)
		return Response{}, ErrToolNotAllowed.wrap(errors.New("tool " + denied))
	}
	if err := g.finish(ctx, row.ID, row.OrganizationID, resp, "succeeded", "", latency, calls); err != nil {
		return Response{}, err
	}
	if g.quota != nil {
		if err := g.quota.Record(ctx, UsageRecord{
			OrganizationID: req.OrganizationID, WorkspaceID: req.WorkspaceID, Actor: req.Actor,
			Tokens: int64(resp.InputTokens + resp.OutputTokens), UsageEventID: row.ID,
		}); err != nil {
			g.log.Warn("ai: quota record", "usage_event_id", row.ID, "err", err)
		}
	}
	if g.rec != nil {
		if err := g.rec.Emit(ctx, g.q, req.Actor, audit.Event{
			Topic: "ai.usage.updated", OrganizationID: req.OrganizationID, WorkspaceID: req.WorkspaceID,
			Payload: map[string]string{"organization_id": req.OrganizationID, "workspace_id": req.WorkspaceID},
		}); err != nil {
			g.log.Warn("ai: emit usage event", "usage_event_id", row.ID, "err", err)
		}
	}
	g.observe(req.Capability, "succeeded", latency)
	g.log.Info("ai: call", "usage_event_id", row.ID, "capability", req.Capability, "latency_ms", latency.Milliseconds())
	return Response{
		Text: resp.Text, ToolCalls: resp.ToolCalls, UsageEventID: row.ID, Model: resp.Model, Provider: g.p.Name(),
		InputTokens: resp.InputTokens, OutputTokens: resp.OutputTokens,
	}, nil
}

type toolCallAudit struct {
	Name    string `json:"name"`
	Risk    string `json:"risk"`
	Allowed bool   `json:"allowed"`
}

// auditToolCalls turns the model's calls into the audit column and names the
// first call outside the allowlist, if any.
func auditToolCalls(calls []provider.ToolCall, allowed Registry) ([]toolCallAudit, string) {
	out := make([]toolCallAudit, 0, len(calls))
	denied := ""
	for _, c := range calls {
		t, ok := allowed.Get(c.Name)
		a := toolCallAudit{Name: c.Name, Allowed: ok}
		if ok {
			a.Risk = string(t.Risk)
		} else if denied == "" {
			denied = c.Name
		}
		out = append(out, a)
	}
	return out, denied
}

// ---- Metering (spec §3.7): a row before the call, a priced row after ----

func (g *Gateway) insertUsage(ctx context.Context, req Request, model, status, reason string) (db.AiUsageEvent, error) {
	kind := string(req.Actor.Kind)
	if kind == "" {
		kind = "system" // a gateway job with nobody's authority
	}
	return g.q.AiInsertUsageEvent(ctx, db.AiInsertUsageEventParams{
		ID: util.NewID(), OrganizationID: req.OrganizationID, WorkspaceID: optText(req.WorkspaceID),
		ActorID: req.Actor.ID, ActorKind: kind, Capability: string(req.Capability), PromptID: req.PromptID,
		Provider: g.p.Name(), Model: model, Status: status, ReasonCode: optText(reason),
		SourceCount: int32(len(req.Sources)), Truncated: req.Truncated, CorrelationID: audit.CorrelationID(ctx),
	})
}

func (g *Gateway) finish(ctx context.Context, id, orgID string, resp provider.CompletionResponse, status, reason string, latency time.Duration, calls []toolCallAudit) error {
	var rateID pgtype.Text
	var cost int64
	if status == "succeeded" {
		rate, err := g.q.AiLatestRate(ctx, db.AiLatestRateParams{
			Provider: g.p.Name(), Model: resp.Model, EffectiveAt: pgtype.Timestamptz{Time: g.now(), Valid: true},
		})
		if err == nil {
			rateID = pgtype.Text{String: rate.ID, Valid: true}
			cost = int64(resp.InputTokens)*rate.InputMicrosPerMtok/1_000_000 + int64(resp.OutputTokens)*rate.OutputMicrosPerMtok/1_000_000
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
	}
	if calls == nil {
		calls = []toolCallAudit{}
	}
	callsJSON, _ := json.Marshal(calls)
	if status == "succeeded" && g.metrics != nil {
		g.metrics.ObserveAIUsage(g.p.Name(), resp.Model, orgID, resp.InputTokens, resp.OutputTokens, float64(cost)/1_000_000)
	}
	_, err := g.q.AiFinishUsageEvent(ctx, db.AiFinishUsageEventParams{
		ID: id, Status: status, ReasonCode: optText(reason), RateID: rateID,
		InputTokens: int32(resp.InputTokens), OutputTokens: int32(resp.OutputTokens), CostMicros: cost,
		LatencyMs: pgtype.Int4{Int32: int32(latency.Milliseconds()), Valid: true}, ToolCalls: string(callsJSON),
	})
	return err
}

func (g *Gateway) observe(c Capability, status string, latency time.Duration) {
	if g.metrics != nil {
		g.metrics.ObserveAICall(string(c), status, latency)
	}
}

func optText(s string) pgtype.Text { return pgtype.Text{String: s, Valid: s != ""} }
