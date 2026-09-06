package service

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/unicomhub/uniwork/server/migrations"
)

// Readiness answers /readyz (spec F-11 §6.4): the database answers within
// readinessTimeout, Redis pings when configured, and the schema is at the
// version this binary embeds. /healthz stays a bare liveness answer.
type Readiness struct {
	pool *pgxpool.Pool
	rdb  *redis.Client
}

const readinessTimeout = 500 * time.Millisecond

func NewReadiness(pool *pgxpool.Pool, rdb *redis.Client) *Readiness {
	return &Readiness{pool: pool, rdb: rdb}
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
	return rep
}

type errMigrationDrift struct{ applied, latest string }

func (e errMigrationDrift) Error() string {
	return "schema at " + e.applied + ", binary embeds " + e.latest
}
