package service

import (
	"context"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"
)

// uniworkConcurrency bounds the UniWork AI turns running at once (G6-D1 A11):
// a pod semaphore, a per-organization bound, and a whole-deployment bound in
// Redis when one is configured. Without Redis the shared bounds are dropped
// (fail open, like every Redis-backed limiter in this repo) and only the pod
// bound holds. Exceeding a bound is 429 ai_uniwork_busy with Retry-After: 5.
type uniworkConcurrency struct {
	rdb       *redis.Client
	pod       chan struct{}
	orgMax    int
	globalMax int
	leaseTTL  time.Duration
}

// uniworkLeaseTimeout bounds each Redis call of a take or a release, the same
// 100 ms budget the rate limiters give theirs: a stalled Redis must not hold
// an AI turn open.
const uniworkLeaseTimeout = 100 * time.Millisecond

// uniworkConcurrencyLeasePrefix names the two lease counters. They live
// outside the feature's own namespace on purpose: nothing else may read them.
const (
	uniworkOrgLeasePrefix    = "ai:uniwork:org:"
	uniworkGlobalLeasePrefix = "ai:uniwork:global"
)

func newUniworkConcurrency(rdb *redis.Client, podMax, orgMax, globalMax int, leaseTTL time.Duration) *uniworkConcurrency {
	return &uniworkConcurrency{
		rdb: rdb, pod: make(chan struct{}, podMax), orgMax: orgMax, globalMax: globalMax, leaseTTL: leaseTTL,
	}
}

// Acquire takes one slot and returns the release to defer. It never blocks: a
// bound at its cap answers immediately. Order is pod -> organization -> whole
// deployment and the release unwinds in reverse. A Redis error fails open:
// the already-taken slots stay and the shared bounds are skipped for this
// call, so a Redis outage sheds no AI turns (design §7.1).
func (c *uniworkConcurrency) Acquire(ctx context.Context, orgID string) (release func(), err error) {
	select {
	case c.pod <- struct{}{}:
	default:
		return nil, errUniworkBusy()
	}
	releasePod := func() { <-c.pod }
	if c.rdb == nil {
		return releasePod, nil
	}
	releaseOrg, ok, err := c.takeLease(ctx, uniworkOrgLeasePrefix+orgID, c.orgMax)
	if err != nil {
		return releasePod, nil
	}
	if !ok {
		releasePod()
		return nil, errUniworkBusy()
	}
	releaseGlobal, ok, err := c.takeLease(ctx, uniworkGlobalLeasePrefix, c.globalMax)
	if err != nil {
		releaseOrg()
		return releasePod, nil
	}
	if !ok {
		releaseOrg()
		releasePod()
		return nil, errUniworkBusy()
	}
	return func() {
		releaseGlobal()
		releaseOrg()
		releasePod()
	}, nil
}

// takeLease counts one live turn under key and reports false when the bound is
// already full. The counter carries leaseTTL (≈ 65 s: the 55 s turn deadline
// plus a margin), so every pod that dies mid-turn gives its slots back on
// their own; a take refreshes it while turns keep arriving. The release
// decrements and deletes the key at zero, and it runs on a context detached
// from the request: a client that hung up must still give its slot back.
func (c *uniworkConcurrency) takeLease(ctx context.Context, key string, max int) (release func(), ok bool, err error) {
	lctx, cancel := context.WithTimeout(ctx, uniworkLeaseTimeout)
	defer cancel()
	n, err := c.rdb.Incr(lctx, key).Result()
	if err != nil {
		return nil, false, err
	}
	if n > int64(max) {
		_ = c.rdb.Decr(lctx, key).Err()
		return nil, false, nil
	}
	if err := c.rdb.Expire(lctx, key, c.leaseTTL).Err(); err != nil {
		_ = c.rdb.Decr(lctx, key).Err()
		return nil, false, err
	}
	released := false
	detached := context.WithoutCancel(ctx)
	return func() {
		if released {
			return
		}
		released = true
		rctx, cancel := context.WithTimeout(detached, uniworkLeaseTimeout)
		defer cancel()
		if left, err := c.rdb.Decr(rctx, key).Result(); err == nil && left <= 0 {
			_ = c.rdb.Del(rctx, key).Err()
		}
	}, true, nil
}

// errUniworkBusy is A11: every concurrency bound full at once. Fields carries
// the Retry-After the handler sets; the code is deliberately unclassified
// (contract-p0 §4).
func errUniworkBusy() error {
	return CodedError{
		Code: "ai_uniwork_busy", Status: http.StatusTooManyRequests,
		Msg:    "UniWork AI đang xử lý quá nhiều lượt, thử lại sau ít giây",
		Fields: map[string]any{"retry_after": UniworkBusyRetryAfter},
	}
}
