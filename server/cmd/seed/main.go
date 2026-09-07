// seed fills a database with a synthetic dataset for the nightly k6 run
// (spec F-11 §6.6): organizations, users, workspaces, memberships,
// subscriptions and tasks, written with COPY. Run against an empty database;
// nothing here is idempotent. Every user's password is "password123" and
// emails follow user<N>@perf.local, which perf/k6/lib.js relies on.
//
//	go run ./cmd/seed --orgs 50 --users 5000 --tasks 1000000
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/util"
)

func main() {
	orgs := flag.Int("orgs", 50, "organizations")
	users := flag.Int("users", 5000, "users, spread across organizations")
	tasks := flag.Int("tasks", 1_000_000, "tasks, spread across workspaces")
	flag.Parse()
	if *orgs < 1 || *users < *orgs || *tasks < 0 {
		fail("need orgs ≥ 1, users ≥ orgs, tasks ≥ 0")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		fail(err.Error())
	}
	defer pool.Close()
	var planID string
	if err := pool.QueryRow(ctx, `SELECT id FROM plans WHERE is_default LIMIT 1`).Scan(&planID); err != nil {
		fail("default plan (run migrations first): " + err.Error())
	}
	hash, err := auth.HashPassword("password123")
	if err != nil {
		fail(err.Error())
	}
	start := time.Now()
	now := time.Now()

	// users
	userIDs := make([]string, *users)
	userRows := make([][]any, *users)
	for i := range userIDs {
		userIDs[i] = util.NewID()
		userRows[i] = []any{userIDs[i], fmt.Sprintf("user%d@perf.local", i), hash, fmt.Sprintf("Perf User %d", i), now, now, "vi"}
	}
	copyRows(ctx, pool, "users", []string{"id", "email", "password_hash", "display_name", "email_verified_at", "onboarded_at", "locale"}, userRows)

	// organizations, one workspace each, owner = first user of the org
	perOrg := *users / *orgs
	orgIDs := make([]string, *orgs)
	wsIDs := make([]string, *orgs)
	var orgRows, wsRows, subRows, orgMembers, wsMembers [][]any
	for o := range orgIDs {
		orgIDs[o], wsIDs[o] = util.NewID(), util.NewID()
		owner := userIDs[o*perOrg]
		orgRows = append(orgRows, []any{orgIDs[o], fmt.Sprintf("perf-org-%d", o), fmt.Sprintf("Perf Org %d", o), owner})
		wsRows = append(wsRows, []any{wsIDs[o], fmt.Sprintf("perf-ws-%d", o), fmt.Sprintf("Perf WS %d", o), owner, orgIDs[o]})
		subRows = append(subRows, []any{util.NewID(), orgIDs[o], planID, "active", "manual", owner, "system", owner, "system"})
		for u := o * perOrg; u < (o+1)*perOrg && u < *users; u++ {
			role := "member"
			if u == o*perOrg {
				role = "owner"
			}
			orgMembers = append(orgMembers, []any{orgIDs[o], userIDs[u], role})
			wsMembers = append(wsMembers, []any{wsIDs[o], userIDs[u], role})
		}
	}
	copyRows(ctx, pool, "organizations", []string{"id", "slug", "name", "created_by"}, orgRows)
	copyRows(ctx, pool, "workspaces", []string{"id", "slug", "name", "created_by", "organization_id"}, wsRows)
	copyRows(ctx, pool, "subscriptions", []string{"id", "organization_id", "plan_id", "status", "provider", "created_by", "created_by_kind", "updated_by", "updated_by_kind"}, subRows)
	copyRows(ctx, pool, "organization_members", []string{"organization_id", "user_id", "role"}, orgMembers)
	copyRows(ctx, pool, "workspace_members", []string{"workspace_id", "user_id", "role"}, wsMembers)

	// tasks, in batches so a million rows do not sit in memory at once
	statuses := []string{"todo", "in_progress", "done", "cancelled"}
	const batch = 50_000
	for done := 0; done < *tasks; done += batch {
		n := min(batch, *tasks-done)
		rows := make([][]any, n)
		for i := 0; i < n; i++ {
			k := done + i
			o := k % *orgs
			rows[i] = []any{util.NewID(), wsIDs[o], fmt.Sprintf("Task %d", k), statuses[k%4], "medium", float64(k), userIDs[o*perOrg], userIDs[o*perOrg+(k%perOrg)]}
		}
		copyRows(ctx, pool, "tasks", []string{"id", "workspace_id", "title", "status", "priority", "position", "created_by", "assignee_id"}, rows)
		fmt.Fprintf(os.Stderr, "tasks %d/%d\n", done+n, *tasks)
	}
	fmt.Printf("seeded orgs=%d users=%d tasks=%d in %s\nworkspace_ids=%s...\n", *orgs, *users, *tasks, time.Since(start).Round(time.Millisecond), wsIDs[0])
}

func copyRows(ctx context.Context, pool *pgxpool.Pool, table string, cols []string, rows [][]any) {
	if _, err := pool.CopyFrom(ctx, pgx.Identifier{table}, cols, pgx.CopyFromRows(rows)); err != nil {
		fail(table + ": " + err.Error())
	}
}

func fail(msg string) {
	fmt.Fprintln(os.Stderr, "seed:", msg)
	os.Exit(1)
}
