package service

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/unicomhub/uniwork/server/internal/util"
)

// uniworkConcurrency bounds the UniWork AI turns running at once (G6-D1 A11):
// a pod semaphore, a per-organization bound, and a whole-deployment bound in
// Redis when one is configured. Without Redis the organization bound lives in
// this process (A11: 8 per pod, not shared) and the whole-deployment bound is
// the one that is dropped (fail open, like every Redis-backed limiter in this
// repo). Exceeding a bound is 429 ai_uniwork_busy with Retry-After: 5.
type uniworkConcurrency struct {
	rdb       *redis.Client
	pod       chan struct{}
	orgMax    int
	globalMax int
	leaseTTL  time.Duration

	// org is the no-Redis organization counter: a Redis-less deployment must
	// still bound one tenant, or one organization fills the pod for everyone.
	mu  sync.Mutex
	org map[string]int
}

// uniworkLeaseTimeout bounds each Redis call of a take or a release, the same
// 100 ms budget the rate limiters give theirs: a stalled Redis must not hold
// an AI turn open.
const uniworkLeaseTimeout = 100 * time.Millisecond

// The lease keys of the two shared bounds. They live outside the feature's
// own namespace on purpose: nothing else may read them.
const (
	uniworkOrgLeasePrefix    = "ai:uniwork:org:"
	uniworkGlobalLeasePrefix = "ai:uniwork:global"
)

// The two lease operations are one Lua script each, so pruning, counting,
// taking and releasing are atomic: many pods take and release concurrently
// without one of them counting a slot twice or dropping a live one.
//
// A lease is a sorted-set member whose score is its expiry, read from the
// Redis server clock — never a pod's own clock. Every lease expires on its
// own, so a pod that dies mid-turn gives its slots back after leaseTTL
// whatever the traffic, while a live turn (bounded by the 55 s deadline) is
// still counted. The set's own TTL is only a safety net for a key nothing
// touches any more.
var (
	uniworkTakeLeaseScript = redis.NewScript(`
local now = redis.call('TIME')
local ms = tonumber(now[1]) * 1000 + math.floor(tonumber(now[2]) / 1000)
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ms)
local live = redis.call('ZCARD', KEYS[1])
if live >= tonumber(ARGV[1]) then
  return 0
end
redis.call('ZADD', KEYS[1], ms + tonumber(ARGV[2]), ARGV[3])
redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[2]) * 2)
return 1
`)
	uniworkReleaseLeaseScript = redis.NewScript(`
redis.call('ZREM', KEYS[1], ARGV[1])
if redis.call('ZCARD', KEYS[1]) == 0 then
  redis.call('DEL', KEYS[1])
end
return 1
`)
)

func newUniworkConcurrency(rdb *redis.Client, podMax, orgMax, globalMax int, leaseTTL time.Duration) *uniworkConcurrency {
	return &uniworkConcurrency{
		rdb: rdb, pod: make(chan struct{}, podMax), orgMax: orgMax, globalMax: globalMax, leaseTTL: leaseTTL,
		org: make(map[string]int),
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
		releaseOrg, ok := c.takeOrgSlot(orgID)
		if !ok {
			releasePod()
			return nil, errUniworkBusy()
		}
		return func() {
			releaseOrg()
			releasePod()
		}, nil
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

// takeOrgSlot is the organization bound of a deployment without Redis: orgMax
// turns at a time for one organization, counted in this process (A11,
// design §7.1).
func (c *uniworkConcurrency) takeOrgSlot(orgID string) (release func(), ok bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.org[orgID] >= c.orgMax {
		return nil, false
	}
	c.org[orgID]++
	return func() {
		c.mu.Lock()
		defer c.mu.Unlock()
		if c.org[orgID] > 1 {
			c.org[orgID]--
			return
		}
		delete(c.org, orgID)
	}, true
}

// takeLease takes one lease under key and reports false when the bound is
// already full. Each lease carries its own expiry (≈ 65 s: the 55 s turn
// deadline plus a margin) in its score, so a pod that dies mid-turn gives its
// slots back on their own and continued traffic under other leases never
// keeps an abandoned slot counted. The release removes the lease and cleans
// up an empty set, and it runs on a context detached from the request: a
// client that hung up must still give its slot back.
func (c *uniworkConcurrency) takeLease(ctx context.Context, key string, max int) (release func(), ok bool, err error) {
	member := util.NewID()
	lctx, cancel := context.WithTimeout(ctx, uniworkLeaseTimeout)
	defer cancel()
	taken, err := uniworkTakeLeaseScript.Run(lctx, c.rdb, []string{key}, max, c.leaseTTL.Milliseconds(), member).Int()
	if err != nil {
		return nil, false, err
	}
	if taken != 1 {
		return nil, false, nil
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
		_ = uniworkReleaseLeaseScript.Run(rctx, c.rdb, []string{key}, member).Err()
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
