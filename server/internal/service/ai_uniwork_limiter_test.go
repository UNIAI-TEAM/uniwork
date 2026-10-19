package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/util"
)

// BE3A-16 (design §10, G6-03b W-B): the shared concurrency bound must not
// leak a slot when a later step of the take refuses, and the release must
// still land when the request is already gone. Both need Redis — the global
// bound exists only with one — so these skip where REDIS_TEST_URL is not set
// (the cloud round runs them).

// A take refused by the whole-deployment bound unwinds what it already took:
// the organization lease and the pod slot go back, the global set still holds
// exactly the lease that won, and a later take is not blocked by a ghost.
func TestAIUniworkConcurrencyGlobalRefusalUnwinds(t *testing.T) {
	rdb := uniworkRedis(t)
	ctx := context.Background()
	limiter := newUniworkConcurrency(rdb, "ai:uniwork:", 2, 4, 1, UniworkDeadline+10*time.Second)
	orgA, orgB := util.NewID(), util.NewID()
	t.Cleanup(func() {
		cctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_ = rdb.Del(cctx, uniworkOrgLeasePrefix+orgA, uniworkOrgLeasePrefix+orgB, uniworkGlobalLeasePrefix).Err()
	})

	releaseA, err := limiter.Acquire(ctx, orgA)
	if err != nil {
		t.Fatalf("first Acquire: %v", err)
	}
	// org B's take gets past the pod and organization bounds and is refused
	// by the global one (globalMax is 1).
	if _, err := limiter.Acquire(ctx, orgB); err == nil {
		t.Fatal("a second organization at the global bound was admitted")
	} else {
		var ce CodedError
		if !errors.As(err, &ce) || ce.Code != "ai_uniwork_busy" {
			t.Fatalf("global refusal = %v, want ai_uniwork_busy", err)
		}
	}
	if n := rdb.ZCard(ctx, uniworkOrgLeasePrefix+orgB).Val(); n != 0 {
		t.Fatalf("the refused take leaked %d organization leases for org B", n)
	}
	if n := rdb.ZCard(ctx, uniworkGlobalLeasePrefix).Val(); n != 1 {
		t.Fatalf("the global set holds %d leases after the refusal, want the first one only", n)
	}
	// The refused take's pod slot went back: only org A's slot is held, so
	// the pod bound of 2 has one free.
	if got := len(limiter.pod); got != 1 {
		t.Fatalf("the refused take leaked a pod slot: %d held, want 1", got)
	}
	releaseA()
	if got := len(limiter.pod); got != 0 {
		t.Fatalf("release after the refused take left %d pod slots held, want 0", got)
	}
	releaseB, err := limiter.Acquire(ctx, orgB)
	if err != nil {
		t.Fatalf("Acquire after the refused take released org A: %v", err)
	}
	releaseB()
	if n := rdb.ZCard(ctx, uniworkGlobalLeasePrefix).Val(); n != 0 {
		t.Fatalf("the global set holds %d leases after every release, want none", n)
	}
}

// The release runs on a context detached from the request (design §7.1): a
// client that hung up mid-turn still gives its pod slot, organization lease
// and global lease back, so a cancelled request cannot hold a bound until its
// lease expires.
func TestAIUniworkConcurrencyReleaseOnCancelledRequest(t *testing.T) {
	rdb := uniworkRedis(t)
	limiter := newUniworkConcurrency(rdb, "ai:uniwork:", 4, 1, 1, UniworkDeadline+10*time.Second)
	orgID := util.NewID()
	t.Cleanup(func() {
		cctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_ = rdb.Del(cctx, uniworkOrgLeasePrefix+orgID, uniworkGlobalLeasePrefix).Err()
	})

	reqCtx, cancel := context.WithCancel(context.Background())
	release, err := limiter.Acquire(reqCtx, orgID)
	if err != nil {
		t.Fatalf("Acquire: %v", err)
	}
	cancel()
	release()

	live := context.Background()
	if n := rdb.ZCard(live, uniworkOrgLeasePrefix+orgID).Val(); n != 0 {
		t.Fatalf("the canceled request's organization lease survived the release: %d", n)
	}
	if n := rdb.ZCard(live, uniworkGlobalLeasePrefix).Val(); n != 0 {
		t.Fatalf("the canceled request's global lease survived the release: %d", n)
	}
	// Both bounds are free again: a fresh request (same organization) gets in
	// while each bound is at 1.
	again, err := limiter.Acquire(live, orgID)
	if err != nil {
		t.Fatalf("Acquire after the cancelled request's release: %v", err)
	}
	again()
}

// Each limiter leases under its own prefix: Ask UNI's agent runs ("ai:ask:")
// never count against UniWork AI's bounds, nor UniWork AI's against theirs.
func TestAIUniworkConcurrencyKeysUnderItsPrefix(t *testing.T) {
	rdb := uniworkRedis(t)
	ctx := context.Background()
	orgID := util.NewID()
	ask := newUniworkConcurrency(rdb, "ai:ask:", 4, 1, 64, time.Minute)
	uniwork := newUniworkConcurrency(rdb, "ai:uniwork:", 4, 1, 64, time.Minute)
	t.Cleanup(func() {
		cctx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_ = rdb.Del(cctx, "ai:ask:org:"+orgID, "ai:ask:global", uniworkOrgLeasePrefix+orgID).Err()
	})
	release, err := ask.Acquire(ctx, orgID)
	if err != nil {
		t.Fatal(err)
	}
	if a, u := rdb.ZCard(ctx, "ai:ask:org:"+orgID).Val(), rdb.ZCard(ctx, uniworkOrgLeasePrefix+orgID).Val(); a != 1 || u != 0 {
		t.Fatalf("organization leases: ask %d, uniwork %d; want 1 and 0", a, u)
	}
	if n := rdb.ZCard(ctx, "ai:ask:global").Val(); n != 1 {
		t.Fatalf("ask global leases %d, want 1", n)
	}
	if _, err := ask.Acquire(ctx, orgID); err == nil {
		t.Fatal("the organization is at its ask bound")
	}
	other, err := uniwork.Acquire(ctx, orgID)
	if err != nil {
		t.Fatalf("an ask lease counted against UniWork AI: %v", err)
	}
	other()
	release()
}
