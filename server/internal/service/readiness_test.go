package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/unicomhub/uniwork/server/internal/testutil"
)

// fakeProber is a StorageProber stand-in: it records the deadline it was
// handed so the test can prove the storage check runs under its own bound.
type fakeProber struct {
	err      error
	calls    int
	deadline time.Duration
}

func (p *fakeProber) Probe(ctx context.Context) error {
	p.calls++
	if dl, ok := ctx.Deadline(); ok {
		p.deadline = time.Until(dl)
	}
	return p.err
}

func checkByName(rep ReadinessReport, name string) *ReadinessCheck {
	for i := range rep.Checks {
		if rep.Checks[i].Name == name {
			return &rep.Checks[i]
		}
	}
	return nil
}

// TestReadinessStorageProbeHealthy: a wired prober adds a "storage" check
// that passes when the adapter answers.
func TestReadinessStorageProbeHealthy(t *testing.T) {
	pool := testutil.DB(t)
	prober := &fakeProber{}
	r := NewReadiness(pool, nil).WithStorageProber(prober)

	rep := r.Check(context.Background())
	if prober.calls != 1 {
		t.Fatalf("Probe calls = %d, want 1", prober.calls)
	}
	c := checkByName(rep, "storage")
	if c == nil {
		t.Fatal("no storage check in the report")
	}
	if !c.OK || !rep.Ready {
		t.Fatalf("storage check OK=%v ready=%v, want both true", c.OK, rep.Ready)
	}
	// The storage deadline is its own bound, inside the overall readiness
	// budget.
	if prober.deadline <= 0 || prober.deadline > storageProbeTimeout {
		t.Fatalf("probe deadline = %v, want within %v", prober.deadline, storageProbeTimeout)
	}
}

// TestReadinessStorageFailureIsAdvisory: a storage failure is reported by
// name but leaves the node ready - an S3 blip must not pull the only API pod
// out of the Service (H14).
func TestReadinessStorageFailureIsAdvisory(t *testing.T) {
	pool := testutil.DB(t)
	prober := &fakeProber{err: errors.New("bucket unreachable")}
	r := NewReadiness(pool, nil).WithStorageProber(prober)

	rep := r.Check(context.Background())
	if !rep.Ready {
		t.Fatal("a failed storage probe made the node not ready")
	}
	c := checkByName(rep, "storage")
	if c == nil || c.OK {
		t.Fatalf("storage check = %+v, want present and failing", c)
	}
	if c.Detail == "" {
		t.Fatal("failing storage check carries no detail")
	}
	if db := checkByName(rep, "db"); db == nil || !db.OK {
		t.Fatal("a storage failure must not mark the db check failed")
	}
}

// TestReadinessRedisFailureIsAdvisory: Redis down is visible in the report
// (and to the admin console) without failing readiness.
func TestReadinessRedisFailureIsAdvisory(t *testing.T) {
	pool := testutil.DB(t)
	rdb := redis.NewClient(&redis.Options{Addr: "127.0.0.1:1", MaxRetries: -1})
	t.Cleanup(func() { _ = rdb.Close() })

	gauge := fakeReadinessMetrics{}
	r := NewReadiness(pool, rdb).WithStorageProber(&fakeProber{})
	r.SetMetrics(gauge)
	rep := r.Check(context.Background())
	if !rep.Ready {
		t.Fatalf("an unreachable Redis made the node not ready: %+v", rep)
	}
	if c := checkByName(rep, "redis"); c == nil || c.OK || c.Detail == "" {
		t.Fatalf("redis check = %+v, want present and failing with detail", c)
	}
	// The gauge is the only alert left for a dead Redis (RedisUnreachable).
	if up, ok := gauge["redis"]; !ok || up {
		t.Fatalf("redis dependency gauge = %v (set %v), want down", up, ok)
	}
	if up := gauge["storage"]; !up {
		t.Fatal("storage dependency gauge not up for a healthy prober")
	}
	if _, ok := gauge["db"]; ok {
		t.Fatal("db gates readiness itself; it has no dependency gauge")
	}
}

type fakeReadinessMetrics map[string]bool

func (m fakeReadinessMetrics) SetDependencyUp(dependency string, up bool) { m[dependency] = up }

// TestReadinessBudgetOutlastsAGCPause: the db budget is at least 2s so one
// slow pool acquire under load does not flap the only pod out of rotation;
// the kubelet probe timeout in deploy/ is set above it.
func TestReadinessBudgetOutlastsAGCPause(t *testing.T) {
	if readinessTimeout < 2*time.Second {
		t.Fatalf("readinessTimeout = %v, want >= 2s", readinessTimeout)
	}
}

// TestReadinessStorageProbeSlowHonorsDeadline: a probe that outruns its budget
// is cut off at the storage deadline, so a slow endpoint cannot starve the
// other checks.
func TestReadinessStorageProbeSlowHonorsDeadline(t *testing.T) {
	pool := testutil.DB(t)
	prober := &ctxProber{block: storageProbeTimeout + time.Second}
	r := NewReadiness(pool, nil).WithStorageProber(prober)

	start := time.Now()
	rep := r.Check(context.Background())
	c := checkByName(rep, "storage")
	if c == nil || c.OK {
		t.Fatalf("storage check = %+v, want failing", c)
	}
	if time.Since(start) > storageProbeTimeout+500*time.Millisecond {
		t.Fatalf("Check ran %v - the probe was not bounded", time.Since(start))
	}
}

// ctxProber blocks until the ctx it was given ends - the shape of a hanging
// endpoint.
type ctxProber struct {
	block time.Duration
}

func (p *ctxProber) Probe(ctx context.Context) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(p.block):
		return nil
	}
}

// TestReadinessWithoutProberSkipsStorage: a nil prober (not wired) leaves no
// storage check, so deployments without storage stay ready.
func TestReadinessWithoutProberSkipsStorage(t *testing.T) {
	pool := testutil.DB(t)
	r := NewReadiness(pool, nil)
	rep := r.Check(context.Background())
	if checkByName(rep, "storage") != nil {
		t.Fatal("storage check present without a prober")
	}

	// WithStorageProber(nil) is the same as never wiring it.
	r = NewReadiness(pool, nil).WithStorageProber(nil)
	rep = r.Check(context.Background())
	if checkByName(rep, "storage") != nil {
		t.Fatal("storage check present with a nil prober")
	}
}

// TestReadinessNilReceiverSafe: the nil-Readiness path stays a plain "no
// pool" answer - the storage wiring must not change it.
func TestReadinessNilReceiverSafe(t *testing.T) {
	var r *Readiness
	rep := r.WithStorageProber(&fakeProber{}).Check(context.Background())
	if rep.Ready {
		t.Fatal("a nil Readiness reports ready")
	}
}
