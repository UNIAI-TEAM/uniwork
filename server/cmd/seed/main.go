// seed fills a database with a synthetic dataset for the nightly k6 run
// (spec F-11 §6.6): organizations, users, workspaces, memberships,
// subscriptions, tasks and chat rooms with messages, written with COPY. Run
// against an empty database; nothing here is idempotent. Every user's
// password is "password123" and emails follow user<N>@perf.local, which
// scripts/load/perf-lib.js and scripts/load/chat rely on.
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
	chatGroups := flag.Int("chat-groups", 20, "chat groups per workspace, each with the owner and 4 other members")
	chatMessages := flag.Int("chat-messages", 200, "chat messages per workspace, half in the default channel")
	flag.Parse()
	if *orgs < 1 || *users < *orgs || *tasks < 0 || *chatGroups < 0 || *chatMessages < 0 {
		fail("need orgs ≥ 1, users ≥ orgs, tasks ≥ 0, chat counts ≥ 0")
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
		// Task k lands in workspace k % orgs with number k/orgs + 1 (below), so
		// the counter starts at that workspace's task count and the next task
		// created through the API takes the next free number.
		taskCounter := int64((*tasks - o + *orgs - 1) / *orgs)
		wsRows = append(wsRows, []any{wsIDs[o], fmt.Sprintf("perf-ws-%d", o), fmt.Sprintf("Perf WS %d", o), owner, orgIDs[o], taskCounter})
		subRows = append(subRows, []any{util.NewID(), orgIDs[o], planID, "active", "manual", owner, "system", owner, "system"})
		for u := o * perOrg; u < (o+1)*perOrg && u < *users; u++ {
			role := "member"
			if u == o*perOrg {
				role = "owner"
			}
			orgMembers = append(orgMembers, []any{orgIDs[o], userIDs[u], role})
			wsMembers = append(wsMembers, []any{wsIDs[o], orgIDs[o], userIDs[u], role})
		}
	}
	copyRows(ctx, pool, "organizations", []string{"id", "slug", "name", "created_by"}, orgRows)
	copyRows(ctx, pool, "workspaces", []string{"id", "slug", "name", "created_by", "organization_id", "task_counter"}, wsRows)
	copyRows(ctx, pool, "subscriptions", []string{"id", "organization_id", "plan_id", "status", "provider", "created_by", "created_by_kind", "updated_by", "updated_by_kind"}, subRows)
	copyRows(ctx, pool, "organization_members", []string{"organization_id", "user_id", "role"}, orgMembers)
	copyRows(ctx, pool, "workspace_members", []string{"workspace_id", "organization_id", "user_id", "role"}, wsMembers)

	// tasks, in batches so a million rows do not sit in memory at once
	statuses := []string{"todo", "in_progress", "done", "cancelled"}
	const batch = 50_000
	for done := 0; done < *tasks; done += batch {
		n := min(batch, *tasks-done)
		rows := make([][]any, n)
		for i := 0; i < n; i++ {
			k := done + i
			o := k % *orgs
			creator := userIDs[o*perOrg]
			rows[i] = []any{
				util.NewID(), orgIDs[o], wsIDs[o], int64(k / *orgs + 1), fmt.Sprintf("Task %d", k), statuses[k%4], "medium", float64(k),
				creator, creator, "member", userIDs[o*perOrg+(k%perOrg)], "member", now,
			}
		}
		copyRows(ctx, pool, "tasks", []string{
			"id", "organization_id", "workspace_id", "number", "title", "status", "priority", "position",
			"created_by", "creator_id", "creator_type", "assignee_id", "assignee_type", "last_activity_at",
		}, rows)
		fmt.Fprintf(os.Stderr, "tasks %d/%d\n", done+n, *tasks)
	}

	// chat: per workspace the default channel with every member, chatGroups
	// groups that all hold the owner (so user<o*perOrg> carries the biggest
	// sidebar), and chatMessages messages alternating between the two kinds,
	// one second apart and all unread.
	var roomRows, memberRows, msgRows [][]any
	for o := range orgIDs {
		first := o * perOrg
		owner := userIDs[first]
		room := func(kind, name, visibility string, isDefault bool, members []int) string {
			id := util.NewID()
			key := any(nil)
			if kind == "group" {
				key = "seed:" + id
			}
			roomRows = append(roomRows, []any{id, kind, wsIDs[o], orgIDs[o], name, key, "uw-voice-" + id, owner, visibility, isDefault})
			for _, u := range members {
				role := "member"
				if u == first {
					role = "admin"
				}
				memberRows = append(memberRows, []any{util.NewID(), id, wsIDs[o], userIDs[u], role, "active", orgIDs[o], now})
			}
			return id
		}
		all := make([]int, 0, perOrg)
		for u := first; u < first+perOrg; u++ {
			all = append(all, u)
		}
		type seededRoom struct {
			id      string
			members []int
		}
		channelID := room("channel", fmt.Sprintf("Perf WS %d", o), "public", true, all)
		var groups []seededRoom
		for g := 0; g < *chatGroups && perOrg >= 5; g++ {
			members := []int{first}
			for k := range 4 {
				members = append(members, first+1+(g*4+k)%(perOrg-1))
			}
			groups = append(groups, seededRoom{room("group", fmt.Sprintf("Perf group %d", g), "private", false, members), members})
		}
		for m := 0; m < *chatMessages; m++ {
			roomID, sender := channelID, first+m%perOrg
			if m%2 == 1 && len(groups) > 0 {
				g := groups[(m/2)%len(groups)]
				roomID, sender = g.id, g.members[m%len(g.members)]
			}
			at := now.Add(-time.Duration(*chatMessages-m) * time.Second)
			msgRows = append(msgRows, []any{util.NewID(), roomID, wsIDs[o], orgIDs[o], userIDs[sender], "text", fmt.Sprintf("Perf message %d", m), at})
		}
	}
	copyRows(ctx, pool, "chat_rooms", []string{"id", "kind", "workspace_id", "organization_id", "name", "member_set_key", "livekit_room_name", "created_by", "visibility", "is_default"}, roomRows)
	copyRows(ctx, pool, "chat_room_members", []string{"id", "room_id", "workspace_id", "user_id", "role", "status", "organization_id", "joined_at"}, memberRows)
	copyRows(ctx, pool, "chat_messages", []string{"id", "room_id", "workspace_id", "organization_id", "sender_id", "kind", "body", "created_at"}, msgRows)

	fmt.Printf("seeded orgs=%d users=%d tasks=%d chat_rooms=%d chat_messages=%d in %s\nworkspace_ids=%s...\n",
		*orgs, *users, *tasks, len(roomRows), len(msgRows), time.Since(start).Round(time.Millisecond), wsIDs[0])
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
