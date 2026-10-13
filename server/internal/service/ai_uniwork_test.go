package service

import (
	"context"
	"errors"
	"net"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/util"
)

// The pod bound of A11 refuses the turn past its cap and gives the slot back
// on release; without Redis the shared bounds are dropped and this one still
// holds. The refusal carries the Retry-After the handler sets.
func TestAIUniworkConcurrencyBound(t *testing.T) {
	limiter := newUniworkConcurrency(nil, 1, UniworkOrgMax, UniworkGlobalMax, UniworkDeadline+10*time.Second)
	ctx := context.Background()
	release, err := limiter.Acquire(ctx, "01HZZZZZZZZZZZZZZZZZZZZZZZ")
	if err != nil {
		t.Fatalf("first Acquire: %v", err)
	}
	_, err = limiter.Acquire(ctx, "01HZZZZZZZZZZZZZZZZZZZZZZZ")
	var ce CodedError
	if !errors.As(err, &ce) {
		t.Fatalf("Acquire past the pod bound = %v, want a CodedError", err)
	}
	if ce.Code != "ai_uniwork_busy" || ce.Status != http.StatusTooManyRequests {
		t.Fatalf("Acquire past the pod bound = %s/%d, want ai_uniwork_busy/429", ce.Code, ce.Status)
	}
	if retry, _ := ce.Fields["retry_after"].(int); retry != UniworkBusyRetryAfter {
		t.Fatalf("retry_after = %v, want %d", ce.Fields["retry_after"], UniworkBusyRetryAfter)
	}
	release()
	again, err := limiter.Acquire(ctx, "01HZZZZZZZZZZZZZZZZZZZZZZZ")
	if err != nil {
		t.Fatalf("Acquire after release: %v", err)
	}
	again()
}

// The module → format table is derived from the two tables the app already
// reads: every module it names is a genoffice web module, and every token is
// one of the per-format flags office_ai_uniwork_<token>.
func TestAIUniworkFormatTokens(t *testing.T) {
	modules := make(map[string]bool, len(officeFrameModules))
	for _, m := range officeFrameModules {
		modules[m.module] = true
	}
	formats := make(map[string]bool, len(officeAIUniworkFormats))
	for _, f := range officeAIUniworkFormats {
		formats[f] = true
	}
	for module, token := range uniworkModuleFormats {
		if !modules[module] {
			t.Errorf("uniworkModuleFormats names %q, which officeFrameModules does not know", module)
		}
		if !formats[token] {
			t.Errorf("uniworkModuleFormats maps %q to %q, which is not in officeAIUniworkFormats", module, token)
		}
		if got := uniworkFormatToken(module); got != token {
			t.Errorf("uniworkFormatToken(%q) = %q, want %q", module, got, token)
		}
	}
	if token := uniworkFormatToken("not-a-module"); token != "" {
		t.Fatalf("uniworkFormatToken of an unknown module = %q, want \"\" so only the kill switch applies", token)
	}
	for _, module := range []string{OfficeFrameModuleDocs, OfficeFrameModuleSheets} {
		if uniworkFormatToken(module) == "" {
			t.Errorf("module %q has no format token; a per-format flag would never be checked", module)
		}
	}
}

// The instruction pack (G6-14) assembles its system text by module and the
// Gateway refuses a missing or unknown one before the usage row, so every
// module the service can put on a turn — the frame modules a frame claim, a
// document or the org route's body produce — must map to a pack module, and
// the pack must accept it.
func TestAIUniworkEveryFrameModuleReachesThePack(t *testing.T) {
	for _, m := range officeFrameModules {
		pack, ok := ai.UniworkPackModule(m.module)
		if !ok {
			t.Errorf("module %q maps to no pack module; the Gateway would refuse the turn", m.module)
			continue
		}
		if _, err := ai.OfficeSystemPrompt(pack); err != nil {
			t.Errorf("module %q maps to %q, which the pack refuses: %v", m.module, pack, err)
		}
	}
}

// A deployment without Redis still bounds each organization per pod (A11:
// "không Redis → 8 mỗi pod (không chia sẻ)"): orgMax turns for one
// organization, and another organization is not affected. Only the
// whole-deployment bound is the one a Redis-less deployment drops.
func TestAIUniworkOrgBoundWithoutRedis(t *testing.T) {
	limiter := newUniworkConcurrency(nil, UniworkPodMax, UniworkOrgMax, UniworkGlobalMax, UniworkDeadline+10*time.Second)
	ctx := context.Background()
	orgA, orgB := "01HZZZZZZZZZZZZZZZZZZZZZZA", "01HZZZZZZZZZZZZZZZZZZZZZZB"

	releases := make([]func(), 0, UniworkOrgMax)
	for i := 0; i < UniworkOrgMax; i++ {
		release, err := limiter.Acquire(ctx, orgA)
		if err != nil {
			t.Fatalf("Acquire %d of %d for one organization: %v", i+1, UniworkOrgMax, err)
		}
		releases = append(releases, release)
	}
	_, err := limiter.Acquire(ctx, orgA)
	var ce CodedError
	if !errors.As(err, &ce) || ce.Code != "ai_uniwork_busy" || ce.Status != http.StatusTooManyRequests {
		t.Fatalf("Acquire past the org bound = %v, want ai_uniwork_busy/429", err)
	}
	releaseB, err := limiter.Acquire(ctx, orgB)
	if err != nil {
		t.Fatalf("another organization at org A's cap: %v", err)
	}
	releases[len(releases)-1]()
	again, err := limiter.Acquire(ctx, orgA)
	if err != nil {
		t.Fatalf("Acquire for org A after one release: %v", err)
	}
	again()
	releaseB()
	for _, release := range releases[:len(releases)-1] {
		release()
	}
}

// uniworkRedisTestDB keeps this package's limiter keys away from every other
// package's test database (each helper flushes and uses its own).
const uniworkRedisTestDB = 10

// uniworkRedis connects to REDIS_TEST_URL, skipping the test when it is
// unset, on this package's own database.
func uniworkRedis(t *testing.T) *redis.Client {
	t.Helper()
	url := os.Getenv("REDIS_TEST_URL")
	if url == "" {
		t.Skip("REDIS_TEST_URL not set")
	}
	opts, err := redis.ParseURL(url)
	if err != nil {
		t.Fatalf("parse REDIS_TEST_URL: %v", err)
	}
	opts.DB = uniworkRedisTestDB
	rdb := redis.NewClient(opts)
	t.Cleanup(func() { _ = rdb.Close() })
	return rdb
}

// A crashed pod's lease recovers on its own while live leases still count: the
// lease entries expire independently, so traffic under other leases never
// refreshes the abandoned one (the bug a per-key TTL had: a crashed slot
// stayed counted until a quiet gap, and the org was refused ai_uniwork_busy).
func TestAIUniworkLeasesExpireIndependently(t *testing.T) {
	rdb := uniworkRedis(t)
	ttl := 2 * time.Second
	limiter := newUniworkConcurrency(rdb, 100, 2, 100, ttl)
	ctx := context.Background()
	orgID := util.NewID()
	orgKey, globalKey := uniworkOrgLeasePrefix+orgID, uniworkGlobalLeasePrefix
	t.Cleanup(func() {
		cctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_ = rdb.Del(cctx, orgKey, globalKey).Err()
	})

	// A pod that died mid-turn: its org lease is never released.
	if _, err := limiter.Acquire(ctx, orgID); err != nil {
		t.Fatalf("crashed pod's Acquire: %v", err)
	}
	// One live lease, taken while the crashed one is still inside its TTL, so
	// the org is at its cap.
	time.Sleep(ttl - 500*time.Millisecond)
	releaseLive, err := limiter.Acquire(ctx, orgID)
	if err != nil {
		t.Fatalf("live lease at the org cap: %v", err)
	}
	// Past the crashed lease's TTL, still inside the live one's: the abandoned
	// slot is free again ...
	time.Sleep(700 * time.Millisecond)
	releaseRecovered, err := limiter.Acquire(ctx, orgID)
	if err != nil {
		t.Fatalf("the crashed lease did not expire: %v", err)
	}
	// ... and the live lease still counts against the cap.
	if _, err := limiter.Acquire(ctx, orgID); err == nil {
		t.Fatal("a live lease stopped counting after another one expired")
	}
	releaseRecovered()
	releaseLive()
	release, err := limiter.Acquire(ctx, orgID)
	if err != nil {
		t.Fatalf("Acquire after every release: %v", err)
	}
	release()
}

// A Redis error keeps today's fail-open stance (design §7.1): the pod slot is
// taken and the shared bounds are skipped, so a Redis outage sheds no UniWork
// AI turns, while the pod bound itself still refuses past its cap.
func TestAIUniworkRedisErrorFailsOpen(t *testing.T) {
	// A port nothing listens on: dialling fails at once, as a dead Redis does.
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	addr := l.Addr().String()
	_ = l.Close()
	rdb := redis.NewClient(&redis.Options{Addr: addr, MaxRetries: 0})
	defer func() { _ = rdb.Close() }()
	limiter := newUniworkConcurrency(rdb, 1, 1, 1, UniworkDeadline+10*time.Second)
	ctx := context.Background()
	release, err := limiter.Acquire(ctx, "01HZZZZZZZZZZZZZZZZZZZZZZZ")
	if err != nil {
		t.Fatalf("Acquire with a dead Redis = %v, want the pod-bound-only answer", err)
	}
	_, err = limiter.Acquire(ctx, "01HZZZZZZZZZZZZZZZZZZZZZZZ")
	var ce CodedError
	if !errors.As(err, &ce) || ce.Code != "ai_uniwork_busy" {
		t.Fatalf("Acquire past the pod bound with a dead Redis = %v, want ai_uniwork_busy", err)
	}
	release()
}
