package ai

import (
	"context"
	"errors"
	"math"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// UniWork cloud tools (GO-A7, ADR 0029): search, image generation and
// transcription paid by UniWork. Each call is metered like a completion — a
// pending usage row, the vendor call, a finished row, the ai.tokens meter —
// but a tool has no token count of its own, so it charges a fixed
// token-equivalent from the one table below. Media analysis is a completion
// with media parts (Complete + Request.Attachments) and charges real tokens.

// Token-equivalents per tool call (contract D5). Changing a number changes
// what organizations pay; it belongs to the product owner, not a refactor.
const (
	CloudSearchTokens              int64 = 500
	CloudImageTokensPerImage       int64 = 4000
	CloudTranscribeTokensPerMinute int64 = 1000
)

// TranscribeCharge is the token-equivalent of seconds of audio: per started
// minute, at least one.
func TranscribeCharge(seconds float64) int64 {
	minutes := int64(math.Ceil(seconds / 60))
	if minutes < 1 {
		minutes = 1
	}
	return minutes * CloudTranscribeTokensPerMinute
}

// CloudTools are the vendors behind the tools; a nil one is "unavailable".
type CloudTools struct {
	Search      provider.Searcher
	Images      provider.ImageGenerator
	Transcriber provider.Transcriber
}

// CloudFromEnv reads AI_CLOUD_*_PROVIDER and their keys. An unknown name or a
// missing key leaves the tool nil: the route answers 503 cloud_unavailable,
// nothing else breaks.
func CloudFromEnv(get func(string) string) CloudTools {
	var c CloudTools
	name := func(k string) string { return strings.ToLower(strings.TrimSpace(get(k))) }
	switch name("AI_CLOUD_SEARCH_PROVIDER") {
	case "tavily":
		if key := get("AI_CLOUD_SEARCH_API_KEY"); key != "" {
			c.Search = provider.NewTavily("", key)
		}
	case "brave":
		if key := get("AI_CLOUD_SEARCH_API_KEY"); key != "" {
			c.Search = provider.NewBrave("", key)
		}
	case "fake":
		c.Search = &provider.FakeSearch{}
	}
	switch name("AI_CLOUD_IMAGE_PROVIDER") {
	case "openai":
		if key := get("AI_CLOUD_IMAGE_API_KEY"); key != "" {
			c.Images = provider.NewOpenAIImages(get("AI_CLOUD_IMAGE_BASE_URL"), key, strings.TrimSpace(get("AI_CLOUD_IMAGE_MODEL")))
		}
	case "fake":
		c.Images = &provider.FakeImages{}
	}
	switch name("AI_CLOUD_TRANSCRIBE_PROVIDER") {
	case "openai":
		if key := get("AI_CLOUD_TRANSCRIBE_API_KEY"); key != "" {
			c.Transcriber = provider.NewOpenAITranscriber(get("AI_CLOUD_TRANSCRIBE_BASE_URL"), key, strings.TrimSpace(get("AI_CLOUD_TRANSCRIBE_MODEL")))
		}
	case "fake":
		c.Transcriber = &provider.FakeTranscriber{}
	}
	return c
}

// CloudAvailability is which tools this server can run at all.
type CloudAvailability struct {
	WebSearch, ImageSearch, ImageGenerate, MediaAnalyze, Transcribe bool
}

func (g *Gateway) SetCloud(c CloudTools) { g.cloud = c }

func (g *Gateway) CloudAvailability() CloudAvailability {
	if g == nil {
		return CloudAvailability{}
	}
	return CloudAvailability{
		WebSearch: g.cloud.Search != nil, ImageSearch: g.cloud.Search != nil,
		ImageGenerate: g.cloud.Images != nil, Transcribe: g.cloud.Transcriber != nil,
		MediaAnalyze: g.Enabled(),
	}
}

// CloudCall is who pays: the actor and the organization whose credits the
// call spends. Cloud tools are organization-tier; there is no workspace.
type CloudCall struct {
	Actor          audit.Actor
	OrganizationID string
}

// CloudSearch runs one web or image search.
func (g *Gateway) CloudSearch(ctx context.Context, call CloudCall, req provider.SearchRequest) (provider.SearchResponse, error) {
	if g == nil || g.cloud.Search == nil {
		return provider.SearchResponse{}, ErrCloudUnavailable
	}
	var out provider.SearchResponse
	err := g.cloudRun(ctx, call, CapCloudSearch, g.cloud.Search.Name(), "search-"+req.Kind, func(ctx context.Context) (int64, error) {
		resp, err := g.cloud.Search.Search(ctx, req)
		out = resp
		return CloudSearchTokens, err
	})
	return out, err
}

// CloudImage generates images from a prompt and optional reference images.
func (g *Gateway) CloudImage(ctx context.Context, call CloudCall, req provider.ImageRequest) (provider.ImageResponse, error) {
	if g == nil || g.cloud.Images == nil {
		return provider.ImageResponse{}, ErrCloudUnavailable
	}
	var out provider.ImageResponse
	err := g.cloudRun(ctx, call, CapCloudImage, g.cloud.Images.Name(), g.cloud.Images.Model(), func(ctx context.Context) (int64, error) {
		resp, err := g.cloud.Images.Generate(ctx, req)
		out = resp
		return int64(len(resp.Images)) * CloudImageTokensPerImage, err
	})
	return out, err
}

// CloudTranscribe turns audio into text.
func (g *Gateway) CloudTranscribe(ctx context.Context, call CloudCall, req provider.TranscribeRequest) (provider.TranscribeResponse, error) {
	if g == nil || g.cloud.Transcriber == nil {
		return provider.TranscribeResponse{}, ErrCloudUnavailable
	}
	var out provider.TranscribeResponse
	err := g.cloudRun(ctx, call, CapCloudTranscribe, g.cloud.Transcriber.Name(), g.cloud.Transcriber.Model(), func(ctx context.Context) (int64, error) {
		resp, err := g.cloud.Transcriber.Transcribe(ctx, req)
		out = resp
		return TranscribeCharge(BilledAudioSeconds(resp.Seconds, req.Audio)), err
	})
	return out, err
}

// cloudRun is the metering pipeline of a fixed-cost tool: quota check →
// pending row → vendor → finished row → ai.tokens meter. The charge lands in
// the row's input_tokens so the usage report sums to what the meter counted.
func (g *Gateway) cloudRun(ctx context.Context, call CloudCall, c Capability, providerName, model string, run func(context.Context) (int64, error)) error {
	insert := func(status, reason string) (db.AiUsageEvent, error) {
		kind := string(call.Actor.Kind)
		if kind == "" {
			kind = "system"
		}
		return g.q.AiInsertUsageEvent(ctx, db.AiInsertUsageEventParams{
			ID: util.NewID(), OrganizationID: call.OrganizationID, ActorID: call.Actor.ID, ActorKind: kind,
			Capability: string(c), PromptID: string(c) + "@1", Provider: providerName, Model: model,
			Status: status, ReasonCode: optText(reason), CorrelationID: audit.CorrelationID(ctx),
		})
	}
	if g.quota != nil {
		if err := g.quota.Check(ctx, call.OrganizationID); err != nil {
			if errors.Is(err, ErrQuotaExceeded) {
				_, _ = insert("rejected", ErrQuotaExceeded.Code)
				g.observe(c, "rejected", 0)
			}
			return err
		}
	}
	row, err := insert("pending", "")
	if err != nil {
		return err
	}
	started := g.now()
	// A started paid call is always metered: the vendor call and the
	// settlement outlive a client that hung up, each with its own bound.
	vctx, cancelVendor := context.WithTimeout(context.WithoutCancel(ctx), cloudCallTimeout)
	charge, perr := run(vctx)
	cancelVendor()
	latency := g.now().Sub(started)
	sctx, cancelSettle := settleContext(ctx)
	defer cancelSettle()
	finish := func(status, reason string, tokens int64) error {
		_, err := g.q.AiFinishUsageEvent(sctx, db.AiFinishUsageEventParams{
			ID: row.ID, Status: status, ReasonCode: optText(reason), InputTokens: int32(tokens),
			LatencyMs: pgInt4(latency), ToolCalls: "[]",
		})
		return err
	}
	if perr != nil {
		_ = finish("failed", ErrProviderError.Code, 0)
		g.observe(c, "failed", latency)
		g.log.Warn("ai: cloud tool error", "usage_event_id", row.ID, "capability", c, "latency_ms", latency.Milliseconds(), "err", perr)
		return ErrProviderError.wrap(perr)
	}
	// The vendor has been paid; a row that will not settle must not also lose
	// the charge or the result.
	if err := finish("succeeded", "", charge); err != nil {
		g.log.Warn("ai: cloud usage finish", "usage_event_id", row.ID, "err", err)
	}
	if g.quota != nil {
		if err := g.quota.Record(sctx, UsageRecord{
			OrganizationID: call.OrganizationID, Actor: call.Actor, Tokens: charge, UsageEventID: row.ID,
		}); err != nil {
			g.log.Warn("ai: quota record", "usage_event_id", row.ID, "err", err)
		}
	}
	g.observe(c, "succeeded", latency)
	g.log.Info("ai: cloud call", "usage_event_id", row.ID, "capability", c, "latency_ms", latency.Milliseconds())
	return nil
}

// Bounds of a cloud call that outlives its request: the vendor call (the HTTP
// client's own timeout is shorter) and the settlement that follows it.
const (
	cloudCallTimeout   = 4 * time.Minute
	cloudSettleTimeout = 10 * time.Second
)

// settleContext is the context for finishing a usage row and recording the
// meter: it keeps the request's values (correlation id) but not its
// cancellation, so a client hang-up cannot leave a row pending or a paid call
// uncharged (the BYOK proxy settles the same way).
func settleContext(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.WithoutCancel(ctx), cloudSettleTimeout)
}

func pgInt4(d time.Duration) pgtype.Int4 {
	return pgtype.Int4{Int32: int32(d.Milliseconds()), Valid: true}
}
