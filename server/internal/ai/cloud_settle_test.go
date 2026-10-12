package ai

// UNI-1008 F2 (review M2): a paid call is metered even when the client hangs
// up. The vendor call and the settlement outlive the request context, and the
// usage row never stays pending.

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/ai/provider"
	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// liveQuota records a charge only when the context it is handed is alive, as a
// database write would.
type liveQuota struct{ recorded []UsageRecord }

func (q *liveQuota) Check(context.Context, string) error { return nil }
func (q *liveQuota) Record(ctx context.Context, in UsageRecord) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	q.recorded = append(q.recorded, in)
	return nil
}

// hangUpSearch is a vendor during whose call the client goes away.
type hangUpSearch struct {
	cancel context.CancelFunc
	err    error
	live   bool // the context the vendor call got was still alive
}

func (h *hangUpSearch) Name() string { return "fake" }
func (h *hangUpSearch) Search(ctx context.Context, _ provider.SearchRequest) (provider.SearchResponse, error) {
	h.cancel()
	h.live = ctx.Err() == nil
	return provider.SearchResponse{Results: []provider.SearchResult{}}, h.err
}

func TestGatewayCloudSettlesAfterClientHangUp(t *testing.T) {
	quota := &liveQuota{}
	g, q, pool := settleFixture(t, &provider.Fake{}, quota)
	call := CloudCall{Actor: audit.User("u1"), OrganizationID: "org1"}

	ctx, cancel := context.WithCancel(context.Background())
	vendor := &hangUpSearch{cancel: cancel}
	g.SetCloud(CloudTools{Search: vendor})
	if _, err := g.CloudSearch(ctx, call, provider.SearchRequest{Query: "q", Kind: "web", MaxResults: 1}); err != nil {
		t.Fatalf("a call the vendor answered must succeed after a hang-up: %v", err)
	}
	if !vendor.live {
		t.Fatal("the vendor call was cancelled by the client hang-up")
	}
	if len(quota.recorded) != 1 || quota.recorded[0].Tokens != CloudSearchTokens {
		t.Fatalf("a paid call was not charged: %+v", quota.recorded)
	}
	row, err := q.AiGetUsageEvent(context.Background(), quota.recorded[0].UsageEventID)
	if err != nil || row.Status != "succeeded" || row.InputTokens != int32(CloudSearchTokens) {
		t.Fatalf("row after hang-up: %+v %v", row, err)
	}

	// A vendor error after the hang-up settles the row as failed, not pending.
	ctx, cancel = context.WithCancel(context.Background())
	vendor = &hangUpSearch{cancel: cancel, err: errors.New("vendor down")}
	g.SetCloud(CloudTools{Search: vendor})
	if _, err := g.CloudSearch(ctx, call, provider.SearchRequest{Query: "q", Kind: "web", MaxResults: 1}); !errors.Is(err, ErrProviderError) {
		t.Fatalf("vendor error: %v", err)
	}
	var pending int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM ai_usage_events WHERE status = 'pending'`).Scan(&pending); err != nil || pending != 0 {
		t.Fatalf("usage rows left pending: %d %v", pending, err)
	}
}

// settleFixture is gatewayFixture with the pool, for a test that reads rows
// the gateway does not hand back.
func settleFixture(t *testing.T, p provider.Provider, quota Quota) (*Gateway, *db.Queries, *pgxpool.Pool) {
	t.Helper()
	pool := testutil.DB(t)
	if _, err := pool.Exec(context.Background(), "DELETE FROM ai_model_rates WHERE provider = 'fake'"); err != nil {
		t.Fatal(err)
	}
	q := db.New(pool)
	return NewGateway(q, p, quota, nil, Options{Timeout: time.Second}), q, pool
}

// cancelOnComplete is a model provider whose caller hangs up while it answers.
type cancelOnComplete struct {
	*provider.Fake
	cancel context.CancelFunc
}

func (c *cancelOnComplete) Complete(ctx context.Context, req provider.CompletionRequest) (provider.CompletionResponse, error) {
	resp, err := c.Fake.Complete(ctx, req)
	c.cancel()
	return resp, err
}

// Media analysis is a completion; it settles after a hang-up the same way.
func TestGatewayCompleteSettlesAfterClientHangUp(t *testing.T) {
	quota := &liveQuota{}
	ctx, cancel := context.WithCancel(context.Background())
	fp := &cancelOnComplete{Fake: &provider.Fake{Reply: FakeReply}, cancel: cancel}
	g, q := gatewayFixture(t, fp, quota)
	resp, err := g.Complete(ctx, Request{
		Actor: audit.User("u1"), OrganizationID: "org1", Capability: CapMediaAnalysis, PromptID: PromptMediaAnalysis,
		Vars:        map[string]any{"requirements": "mô tả", "locale": "vi", "files": "image/png"},
		Attachments: []provider.Part{{MIME: "image/png", Data: []byte{1}}},
	})
	if err != nil {
		t.Fatalf("complete after hang-up: %v", err)
	}
	if len(quota.recorded) != 1 {
		t.Fatalf("not charged: %+v", quota.recorded)
	}
	row, err := q.AiGetUsageEvent(context.Background(), resp.UsageEventID)
	if err != nil || row.Status != "succeeded" {
		t.Fatalf("row after hang-up: %+v %v", row, err)
	}
}
