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
	"net/http"
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
	// MeterKey overrides the idempotency key of this charge (G6-03b): a
	// caller that can name the logical call (UniWork AI: "uniwork-ai:<run
	// id>:<seq>") makes a replayed or reconciled charge a no-op. Empty keeps
	// the per-event key the quota adapter builds from UsageEventID.
	MeterKey string
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
	// Module is the genoffice module of an Office turn (xlsx, docx, pptx,
	// pdf, md, html); G6-03a sets it. A prompt with Sections
	// (office_uniwork_ai) sends OfficeSystemPrompt(Module) as its system text
	// and refuses a missing or unknown module before the usage row; every
	// other prompt ignores it.
	Module string
	Vars   map[string]any
	// History is prior turns of a conversation, oldest first; the rendered
	// prompt becomes the final user message. A prompt without Render
	// (office_uniwork_ai) renders nothing: History is sent as is and must end
	// with the user's message, which the caller writes (G6-03a).
	History []provider.Message
	// ToolResultTurn sends History as is, with no rendered user message: it
	// answers the assistant's tool calls, so History must end with that
	// assistant message (ToolCalls with ids) followed by one role "tool"
	// message per answered call. Vars and Attachments are not used; the
	// prompt still supplies the system text. One Complete per tool-result
	// round (G6-03a); every existing caller leaves it false.
	ToolResultTurn bool
	// Sources is the context pack, for the audit columns only — the caller
	// renders it into Vars.
	Sources   []Source
	Truncated bool
	// Tools the model may call this turn. A call to anything else fails the
	// request with ErrToolNotAllowed, unless FilterToolCalls is set.
	Tools Registry
	// FilterToolCalls hands the model's calls back whole instead of failing
	// the request: the caller owns the tool contract, filters the answer and
	// reports the drops itself (x_uniwork, G6-03a). The usage row still
	// records every call with allowed:false. Every existing caller leaves
	// this false and keeps today's behaviour.
	FilterToolCalls bool
	// Attachments are media parts sent with the rendered prompt (media
	// analysis); the vendor adapter refuses a type it cannot send.
	Attachments []provider.Part
	// MeterKey is the idempotency key of this call's charge when the caller
	// can name it (G6-03b); empty uses the usage event's own id.
	MeterKey string
}

type Response struct {
	Text         string
	ToolCalls    []provider.ToolCall
	UsageEventID string
	Model        string
	Provider     string
	InputTokens  int
	OutputTokens int
	// UsagePresent reports whether the vendor sent a usage block (G6-03b
	// reads it): false means the usage row is the unknown/reconciliation
	// branch, not a zero-token call (A16, design §6.3).
	UsagePresent bool
}

// The reason_code values of A16's unknown-usage branch (design §6.3): a row
// whose vendor sent no usage block is the reconciliation queue, and the pass
// marks it reconciled once it has priced the row from the transcript.
const (
	UsageUnknownReason    = "usage_unknown"
	UsageReconciledReason = "usage_unknown_reconciled"
)

type Gateway struct {
	q       *db.Queries
	p       provider.Provider
	quota   Quota
	rec     *audit.Recorder
	opts    Options
	metrics Metrics
	log     *slog.Logger
	now     func() time.Time
	// byok is the guarded transport of the BYOK proxy (proxy.go).
	byok  *provider.BYOKClient
	cloud CloudTools
}

// NewGateway wires the pipeline. p == nil yields a disabled gateway that
// refuses with ErrDisabled and reports Enabled() == false.
func NewGateway(q *db.Queries, p provider.Provider, quota Quota, rec *audit.Recorder, opts Options) *Gateway {
	if opts.Timeout <= 0 {
		opts.Timeout = 60 * time.Second
	}
	return &Gateway{q: q, p: p, quota: quota, rec: rec, opts: opts, log: slog.Default(), now: time.Now,
		byok: provider.NewBYOKClient(provider.BYOKClientOptions{}), cloud: opts.Cloud}
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
	system, err := systemText(req, prompt)
	if err != nil {
		return Response{}, err
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
	msgs, err := requestMessages(req, prompt)
	if err != nil {
		return Response{}, err
	}
	row, err := g.insertUsage(ctx, req, model, "pending", "")
	if err != nil {
		return Response{}, err
	}
	creq := provider.CompletionRequest{
		Model: model, System: system, MaxTokens: officeMaxTokens(req, policy), Temperature: policy.Temperature,
		JSONSchema: prompt.OutputSchema,
	}
	creq.Messages = msgs
	// Structured JSON output and tool-calling fight each other on OpenAI-compatible
	// hosts (400 / empty content → 502 ai_provider_error). When the prompt pins a
	// schema, context must already be in Vars — do not advertise tools.
	if len(prompt.OutputSchema) == 0 {
		for _, t := range req.Tools {
			creq.Tools = append(creq.Tools, provider.ToolSpec{Name: t.Name, Description: t.Description, Schema: t.Schema})
		}
	}
	cctx, cancel := context.WithTimeout(ctx, g.opts.Timeout)
	started := g.now()
	resp, perr := g.p.Complete(cctx, creq)
	cancel()
	latency := g.now().Sub(started)
	// The request may be gone (client hung up) while the vendor answered: the
	// row still settles and the call is still charged.
	sctx, cancelSettle := settleContext(ctx)
	defer cancelSettle()
	if perr != nil {
		// A call that ran out of time is a deadline, not an outage: the
		// façade's 55 s deadline (A14) or the gateway's own timeout. The row
		// is still settled, with the code the client will see.
		if errors.Is(perr, context.DeadlineExceeded) || errors.Is(ctx.Err(), context.DeadlineExceeded) {
			_ = g.finish(sctx, row.ID, row.OrganizationID, resp, "failed", ErrProviderTimeout.Code, latency, nil)
			g.observe(req.Capability, "failed", latency)
			g.log.Warn("ai: provider timeout", "usage_event_id", row.ID, "capability", req.Capability, "latency_ms", latency.Milliseconds())
			return Response{}, ErrProviderTimeout.wrap(perr)
		}
		// A vendor rate limit is a throttle, not an outage (design §6.4/§3.4):
		// the caller is told to slow down and how long to wait — the vendor's
		// Retry-After, clamped per A5 — carried in the refusal's fields so the
		// handler sets Retry-After from it.
		var statusErr *provider.StatusError
		if errors.As(perr, &statusErr) && statusErr.Status == http.StatusTooManyRequests {
			limited := errRateLimited(statusErr.RetryAfter)
			_ = g.finish(sctx, row.ID, row.OrganizationID, resp, "failed", limited.Code, latency, nil)
			g.observe(req.Capability, "failed", latency)
			g.log.Warn("ai: provider rate limited", "usage_event_id", row.ID, "capability", req.Capability,
				"retry_after_s", limited.Fields["retry_after"], "latency_ms", latency.Milliseconds())
			return Response{}, limited
		}
		// A structured answer cut at max_tokens is bad output, not an outage:
		// the vendor answered, and the tokens it spent are on resp.
		if errors.Is(perr, provider.ErrTruncated) {
			_ = g.finish(sctx, row.ID, row.OrganizationID, resp, "failed", ErrOutputInvalid.Code, latency, nil)
			g.observe(req.Capability, "failed", latency)
			g.log.Warn("ai: output truncated", "usage_event_id", row.ID, "capability", req.Capability, "output_tokens", resp.OutputTokens)
			return Response{}, ErrOutputInvalid.wrap(perr)
		}
		_ = g.finish(sctx, row.ID, row.OrganizationID, resp, "failed", ErrProviderError.Code, latency, nil)
		g.observe(req.Capability, "failed", latency)
		g.log.Warn("ai: provider error", "usage_event_id", row.ID, "capability", req.Capability, "latency_ms", latency.Milliseconds(), "err", perr)
		if errors.Is(perr, provider.ErrUnsupportedMedia) {
			return Response{}, ErrMediaUnsupported.wrap(perr)
		}
		return Response{}, ErrProviderError.wrap(perr)
	}
	calls, denied := auditToolCalls(resp.ToolCalls, req.Tools)
	if denied != "" && !req.FilterToolCalls {
		_ = g.finish(sctx, row.ID, row.OrganizationID, resp, "failed", ErrToolNotAllowed.Code, latency, calls)
		g.observe(req.Capability, "failed", latency)
		return Response{}, ErrToolNotAllowed.wrap(errors.New("tool " + denied))
	}
	// UsagePresent is false only when the vendor positively reported no usage
	// block. A response that carries token counts did report usage, whatever
	// its flag says: a path that never learned the field leaves the zero value
	// (provider/anthropic.go:104, openai.go:149, ollama.go:85 and the fakes
	// all set it explicitly), and reading that zero as "no usage" would turn
	// every existing provider path into the reconciliation queue (G6-03b
	// regression of TestGatewayMetersBeforeAndAfter, ai_test.go:396).
	if !resp.UsagePresent && (resp.InputTokens > 0 || resp.OutputTokens > 0) {
		resp.UsagePresent = true
	}
	// A vendor that sent no usage block is A16's unknown branch, not a
	// zero-token call (design §6.3): the row settles succeeded with
	// reason_code usage_unknown — the reconciliation queue — and the meter is
	// left alone, because recording zero would claim nobody counted anything.
	//
	// The branch belongs to UniWork AI alone (design §6.3): it is the one
	// capability whose rows a reconciler prices from the stored transcript
	// (AiUniworkUnknownUsageEvents filters capability = 'office_uniwork_ai'),
	// and its run meter already keeps a charge idempotent. Every other
	// capability keeps the pre-03b priced path — a vendor that omitted the
	// usage block settles succeeded at cost 0, as it did before this branch
	// existed — so no capability accumulates rows nobody reconciles and
	// ObserveAIUsage keeps being sampled for them.
	if !resp.UsagePresent && req.Capability == CapOfficeUniworkAI {
		if err := g.finish(sctx, row.ID, row.OrganizationID, resp, "succeeded", UsageUnknownReason, latency, calls); err != nil {
			return Response{}, err
		}
		g.observe(req.Capability, "succeeded", latency)
		g.log.Info("ai: call", "usage_event_id", row.ID, "capability", req.Capability, "latency_ms", latency.Milliseconds())
		return g.response(resp, row.ID), nil
	}
	if err := g.finish(sctx, row.ID, row.OrganizationID, resp, "succeeded", "", latency, calls); err != nil {
		return Response{}, err
	}
	if g.quota != nil {
		if err := g.quota.Record(sctx, UsageRecord{
			OrganizationID: req.OrganizationID, WorkspaceID: req.WorkspaceID, Actor: req.Actor,
			Tokens: int64(resp.InputTokens + resp.OutputTokens), UsageEventID: row.ID,
			MeterKey: req.MeterKey,
		}); err != nil {
			g.log.Warn("ai: quota record", "usage_event_id", row.ID, "err", err)
		}
	}
	// ai.usage.updated is workspace-scoped; an organization-tier call (media
	// analysis for Office) has no workspace audience to tell.
	if g.rec != nil && req.WorkspaceID != "" {
		if err := g.rec.Emit(sctx, g.q, req.Actor, audit.Event{
			Topic: "ai.usage.updated", OrganizationID: req.OrganizationID, WorkspaceID: req.WorkspaceID,
			Payload: map[string]string{"organization_id": req.OrganizationID, "workspace_id": req.WorkspaceID},
		}); err != nil {
			g.log.Warn("ai: emit usage event", "usage_event_id", row.ID, "err", err)
		}
	}
	g.observe(req.Capability, "succeeded", latency)
	g.log.Info("ai: call", "usage_event_id", row.ID, "capability", req.Capability, "latency_ms", latency.Milliseconds())
	return g.response(resp, row.ID), nil
}

// response is the answered call as the caller reads it: the usage row id it
// settled under and whether the vendor reported usage at all (A16).
func (g *Gateway) response(resp provider.CompletionResponse, usageEventID string) Response {
	return Response{
		Text: resp.Text, ToolCalls: resp.ToolCalls, UsageEventID: usageEventID, Model: resp.Model, Provider: g.p.Name(),
		InputTokens: resp.InputTokens, OutputTokens: resp.OutputTokens, UsagePresent: resp.UsagePresent,
	}
}

// systemText is the system text the provider is sent: Prompt.System, or for a
// prompt with Sections the variant assembled for req.Module. Only the office
// pack carries Sections; a missing or unknown module is refused, never
// defaulted to a section.
func systemText(req Request, prompt Prompt) (string, error) {
	if prompt.Sections == nil {
		return prompt.System, nil
	}
	if prompt.Key() != PromptOfficeUniworkAI {
		return "", errPolicy("prompt " + prompt.Key() + " has sections but no assembler")
	}
	text, err := officeAssemble(prompt, req.Module)
	if err != nil {
		return "", errPolicy(err.Error())
	}
	return text, nil
}

// requestMessages is what the provider is sent: History plus the rendered
// prompt as the final user message; for a prompt without Render, History
// exactly, refused unless it ends with a user message; or, on a tool-result
// turn, History exactly — refused unless it ends with tool results that
// answer every call of the assistant message just before them, each exactly
// once.
func requestMessages(req Request, prompt Prompt) ([]provider.Message, error) {
	if !req.ToolResultTurn && prompt.Render == nil {
		if len(req.Attachments) > 0 {
			return nil, errPolicy("prompt " + prompt.Key() + " renders no user message to carry attachments")
		}
		if len(req.History) == 0 || req.History[len(req.History)-1].Role != "user" {
			return nil, errPolicy("prompt " + prompt.Key() + " needs History ending with the user's message")
		}
		return req.History, nil
	}
	if !req.ToolResultTurn {
		msgs := make([]provider.Message, 0, len(req.History)+1)
		msgs = append(msgs, req.History...)
		return append(msgs, provider.Message{Role: "user", Content: prompt.Render(req.Vars), Parts: req.Attachments}), nil
	}
	if len(req.Attachments) > 0 {
		return nil, errPolicy("tool-result turn carries attachments")
	}
	for _, m := range req.History {
		if m.Role == "tool" && len(m.Parts) > 0 {
			return nil, errPolicy("tool-result turn carries media parts on a tool message")
		}
	}
	i := len(req.History)
	for i > 0 && req.History[i-1].Role == "tool" {
		i--
	}
	if i == len(req.History) || i == 0 || req.History[i-1].Role != "assistant" {
		return nil, errPolicy("tool-result turn must end with tool results after the assistant's calls")
	}
	turn := &req.History[i-1]
	pending := make(map[string]bool, len(turn.ToolCalls))
	for _, c := range turn.ToolCalls {
		if c.ID == "" {
			return nil, errPolicy("assistant tool call without an id")
		}
		if pending[c.ID] {
			return nil, errPolicy("assistant tool call " + c.ID + " repeats a call id")
		}
		pending[c.ID] = true
	}
	for _, m := range req.History[i:] {
		if m.ToolCallID == "" || !pending[m.ToolCallID] {
			return nil, errPolicy("tool result " + m.ToolCallID + " answers no call of the assistant turn")
		}
		delete(pending, m.ToolCallID)
	}
	for _, c := range turn.ToolCalls {
		if pending[c.ID] {
			return nil, errPolicy("tool-result turn leaves call " + c.ID + " unanswered")
		}
	}
	return req.History, nil
}

type toolCallAudit struct {
	// ID is the vendor's call id, so a tool result can be traced to the call
	// it answered; empty for a vendor that sends none.
	ID      string `json:"id,omitempty"`
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
		a := toolCallAudit{ID: c.ID, Name: c.Name, Allowed: ok}
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
	// A row the vendor sent no usage for is not priced and not observed as a
	// priced call: the reconciliation pass owns those numbers (A16).
	priced := status == "succeeded" && reason != UsageUnknownReason
	if priced {
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
	if priced && g.metrics != nil {
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
