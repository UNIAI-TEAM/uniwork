package service

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/unicomhub/uniwork/server/migrations"
)

// Readiness answers /readyz (spec F-11 §6.4): the database answers within
// readinessTimeout, Redis pings when configured, the schema is at the
// version this binary embeds, and - once a storage adapter is wired - the
// storage destination still answers. /healthz stays a bare liveness answer:
// losing storage must never restart-loop the process (spec §3.3.5).
type Readiness struct {
	pool    *pgxpool.Pool
	rdb     *redis.Client
	storage StorageProber
}

const readinessTimeout = 500 * time.Millisecond

// storageProbeTimeout is the storage check's own deadline, smaller than the
// overall readiness budget so a slow endpoint cannot starve the db or schema
// checks. The probe itself is cheap - a HeadBucket / stat - never an upload
// or a delete (spec §3.3.5).
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

// ReadinessCheck is one probe's outcome.
type ReadinessCheck struct {
	Name   string `json:"name"`
	OK     bool   `json:"ok"`
	Detail string `json:"detail,omitempty"`
}

// ReadinessReport is the whole answer; Ready is false when any check fails.
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
			rep.Ready = false
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
	if err == nil && applied != migrations.Latest() {
		err = errMigrationDrift{applied: applied, latest: migrations.Latest()}
	}
	add("migrations", err, applied)
	if r.rdb != nil {
		add("redis", r.rdb.Ping(ctx).Err(), "")
	}
	if r.storage != nil {
		sctx, cancel := context.WithTimeout(ctx, storageProbeTimeout)
		add("storage", r.storage.Probe(sctx), "")
		cancel()
	}
	return rep
}

type errMigrationDrift struct{ applied, latest string }

func (e errMigrationDrift) Error() string {
	return "schema at " + e.applied + ", binary embeds " + e.latest
}
