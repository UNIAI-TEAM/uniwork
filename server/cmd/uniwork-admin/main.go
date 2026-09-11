// uniwork-admin grants and revokes users.platform_role (spec F-11 §5.3). It
// is the only way to create the first platform admin: there is no UI for it.
// Runs on the host with DATABASE_URL; every change lands in admin_actions
// (actor "cli") and audit_events with the reason given.
//
//	uniwork-admin grant-platform-role --email a@b.c --role admin --reason "..."
//	uniwork-admin revoke-platform-role --email a@b.c --reason "..."
//	uniwork-admin list-platform-roles
package main

import (
	"context"
	"flag"
	"fmt"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func main() {
	if len(os.Args) < 2 {
		usage()
	}
	ctx := context.Background()
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		fail("DATABASE_URL is required")
	}
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		fail(err.Error())
	}
	defer pool.Close()
	q := db.New(pool)
	admin := service.NewAdminService(pool, q, nil, nil)

	switch os.Args[1] {
	case "grant-platform-role", "revoke-platform-role":
		fs := flag.NewFlagSet(os.Args[1], flag.ExitOnError)
		email := fs.String("email", "", "user email")
		role := fs.String("role", "admin", "admin | support (grant only)")
		reason := fs.String("reason", "", "why (≥ 10 characters), recorded in admin_actions")
		_ = fs.Parse(os.Args[2:])
		if *email == "" {
			fail("--email is required")
		}
		if os.Args[1] == "revoke-platform-role" {
			*role = ""
		}
		u, err := admin.SetPlatformRole(ctx, service.CLIActor, *email, *role, *reason)
		if err != nil {
			fail(err.Error())
		}
		fmt.Printf("%s platform_role=%q\n", u.ID, u.PlatformRole.String)
	case "list-platform-roles":
		rows, err := admin.ListPlatformRoles(ctx)
		if err != nil {
			fail(err.Error())
		}
		for _, r := range rows {
			fmt.Printf("%-8s %s %s granted_by=%s at=%s\n", r.PlatformRole.String, r.ID, r.Email, r.PlatformRoleGrantedBy.String, r.PlatformRoleGrantedAt.Time.Format("2006-01-02"))
		}
	default:
		usage()
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: uniwork-admin grant-platform-role|revoke-platform-role --email E [--role admin|support] --reason R\n       uniwork-admin list-platform-roles")
	os.Exit(2)
}

func fail(msg string) {
	fmt.Fprintln(os.Stderr, "uniwork-admin:", msg)
	os.Exit(1)
}
