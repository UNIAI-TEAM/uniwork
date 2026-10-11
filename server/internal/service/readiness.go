package service

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/unicomhub/uniwork/server/migrations"
)

// Readiness answers /readyz (spec F-11 §6.4). Only the database gates it:
// the db answers within readinessTimeout and its schema is not older than
// the version this binary embeds. Redis and - once a storage adapter is
// wired - the storage destination are probed and reported, but their failure
// leaves the node ready: with one API pod, a Redis or S3 blip must degrade
// the features that need them, not pull every route out of the Service (H14).
// /healthz stays a bare liveness answer.
type Readiness struct {
	pool    *pgxpool.Pool
	rdb     *redis.Client
	storage StorageProber
	metrics ReadinessMetrics
}

// ReadinessMetrics records the advisory checks, so a Redis or storage outage
// that leaves the node ready still raises an alert (RedisUnreachable).
type ReadinessMetrics interface {
	SetDependencyUp(dependency string, up bool)
}

// readinessTimeout bounds the db and schema checks. It is generous on
// purpose: a pool briefly saturated under load is still a working node, and
// the kubelet readinessProbe timeout in deploy/ sits above it.
const readinessTimeout = 2 * time.Second

// storageProbeTimeout bounds each advisory check (Redis, storage), so a slow
// dependency adds little to the probe. The storage probe itself is cheap - a
// HeadBucket / stat - never an upload or a delete (spec §3.3.5).
const storageProbeTimeout = 300 * time.Millisecond

// StorageProber is the narrow capability the wired storage adapter exposes to
// readiness. It is implemented by the storage.ObjectStore adapters; a nil
// prober means storage is not wired and the check is skipped.
type StorageProber interface {
	// Probe answers whether the storage destination is reachable. It must be
	// cheap and honor the caller's deadline.
	Probe(ctx context.Context) error
}

func NewReadiness(pool *pgxpool.Pool, rdb *redis.Client) *Readiness {
	return &Readiness{pool: pool, rdb: rdb}
}

// WithStorageProber attaches the storage dependency probe and returns the
// same Readiness, so the composition root can write
// NewReadiness(pool, rdb).WithStorageProber(store). A nil prober disables the
// storage check - for deployments and tests that never configure one.
func (r *Readiness) WithStorageProber(p StorageProber) *Readiness {
	if r != nil {
		r.storage = p
	}
	return r
}

// SetMetrics attaches the dependency gauge; nil (metrics off) records nothing.
func (r *Readiness) SetMetrics(m ReadinessMetrics) {
	if r != nil {
		r.metrics = m
	}
}

// ReadinessCheck is one probe's outcome.
type ReadinessCheck struct {
	Name   string `json:"name"`
	OK     bool   `json:"ok"`
	Detail string `json:"detail,omitempty"`
}

// ReadinessReport is the whole answer; Ready is false when the db or
// migrations check fails. A failing redis or storage check is advisory.
type ReadinessReport struct {
	Ready  bool             `json:"ready"`
	Checks []ReadinessCheck `json:"checks"`
}

func (r *Readiness) Check(ctx context.Context) ReadinessReport {
	ctx, cancel := context.WithTimeout(ctx, readinessTimeout)
	defer cancel()
	rep := ReadinessReport{Ready: true}
	add := func(name string, err error, detail string) {
		c := ReadinessCheck{Name: name, OK: err == nil, Detail: detail}
		if err != nil {
			c.Detail = err.Error()
			if name == "db" || name == "migrations" {
				rep.Ready = false
			}
		}
		rep.Checks = append(rep.Checks, c)
	}
	if r == nil || r.pool == nil {
		rep.Ready = false
		rep.Checks = append(rep.Checks, ReadinessCheck{Name: "db", Detail: "no pool"})
		return rep
	}
	var one int
	add("db", r.pool.QueryRow(ctx, "SELECT 1").Scan(&one), "")
	applied, err := migrations.Applied(ctx, r.pool)
	if err == nil && migrations.Behind(applied) {
		err = errMigrationDrift{applied: applied, latest: migrations.Latest()}
	}
	add("migrations", err, applied)
	if r.rdb != nil {
		rctx, cancel := context.WithTimeout(ctx, storageProbeTimeout)
		err := r.rdb.Ping(rctx).Err()
		cancel()
		add("redis", err, "")
		r.recordUp("redis", err)
	}
	if r.storage != nil {
		sctx, cancel := context.WithTimeout(ctx, storageProbeTimeout)
		err := r.storage.Probe(sctx)
		cancel()
		add("storage", err, "")
		r.recordUp("storage", err)
	}
	return rep
}

func (r *Readiness) recordUp(dependency string, err error) {
	if r.metrics != nil {
		r.metrics.SetDependencyUp(dependency, err == nil)
	}
}

type errMigrationDrift struct{ applied, latest string }

func (e errMigrationDrift) Error() string {
	return "schema at " + e.applied + ", binary embeds " + e.latest
}
