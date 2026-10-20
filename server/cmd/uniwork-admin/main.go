// uniwork-admin grants and revokes users.platform_role (spec F-11 §5.3) and
// revokes a user's desktop device on their behalf, or every offline lease of
// one organization (G5-D1 row 8: the offline policy epoch bump). It is the only way to
// create the first platform admin: there is no UI for it.
// Runs on the host with DATABASE_URL; every change lands in admin_actions
// (actor "cli") and audit_events with the reason given.
//
//	uniwork-admin grant-platform-role --email a@b.c --role admin --reason "..."
//	uniwork-admin revoke-platform-role --email a@b.c --reason "..."
//	uniwork-admin list-platform-roles
//	uniwork-admin revoke-desktop-device --user-id U --device-id D --reason "..."
//	uniwork-admin revoke-offline-leases --org-id O --reason "..."
//	uniwork-admin folders-unshare [--dry-run] [--batch-size N]
package main

import (
	"context"
	"errors"
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
	case "revoke-desktop-device":
		fs := flag.NewFlagSet(os.Args[1], flag.ExitOnError)
		userID := fs.String("user-id", "", "owner of the device")
		deviceID := fs.String("device-id", "", "device session id (GET /auth/desktop/devices)")
		reason := fs.String("reason", "", "why (≥ 10 characters), recorded in admin_actions")
		_ = fs.Parse(os.Args[2:])
		if *userID == "" || *deviceID == "" {
			fail("--user-id and --device-id are required")
		}
		res, err := admin.RevokeDesktopDevice(ctx, service.CLIActor, *userID, *deviceID, *reason)
		if errors.Is(err, service.ErrNotFound) {
			fail("no desktop device " + *deviceID + " for user " + *userID)
		}
		if err != nil {
			fail(err.Error())
		}
		if res.AlreadyRevoked {
			fmt.Printf("%s already revoked, nothing changed\n", res.DeviceID)
			return
		}
		fmt.Printf("%s revoked (session family %s, %d device session(s) and %d refresh token(s) closed)\n", res.DeviceID, res.SessionFamilyID, res.Revoked, res.TokensRevoked)
	case "revoke-offline-leases":
		fs := flag.NewFlagSet(os.Args[1], flag.ExitOnError)
		orgID := fs.String("org-id", "", "organization whose offline leases end")
		reason := fs.String("reason", "", "why (≥ 10 characters), recorded in admin_actions")
		_ = fs.Parse(os.Args[2:])
		if *orgID == "" {
			fail("--org-id is required")
		}
		res, err := admin.RevokeOrganizationOfflineLeases(ctx, service.CLIActor, *orgID, *reason)
		if errors.Is(err, service.ErrNotFound) {
			fail("no organization " + *orgID)
		}
		if err != nil {
			fail(err.Error())
		}
		fmt.Printf("%s offline policy epoch now %d, %d live lease(s) revoked\n", res.OrganizationID, res.Epoch, res.Revoked)
	case "folders-unshare":
		// UNI-1974: a folder is never shared. Makes every shared folder private
		// and revokes its shares through the audited writers (one transaction
		// per folder, idempotent). Documents inside keep their own access.
		// docs/runbooks/folders-unshare.md.
		fs := flag.NewFlagSet(os.Args[1], flag.ExitOnError)
		dryRun := fs.Bool("dry-run", false, "count the folders and shares, write nothing")
		batch := fs.Int("batch-size", 200, "folders read per page")
		_ = fs.Parse(os.Args[2:])
		res, err := service.NewDocumentService(pool, q, nil, nil).UnshareFolders(ctx, *dryRun, *batch)
		if err != nil {
			fail(err.Error())
		}
		mode := "unshared"
		if res.DryRun {
			mode = "would unshare"
		}
		fmt.Printf("%s %d folder(s): %d workspace-visible, %d live share(s) revoked\n", mode, res.Folders, res.HomeRows, res.Shares)
	default:
		usage()
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: uniwork-admin grant-platform-role|revoke-platform-role --email E [--role admin|support] --reason R\n       uniwork-admin list-platform-roles\n       uniwork-admin revoke-desktop-device --user-id U --device-id D --reason R\n       uniwork-admin revoke-offline-leases --org-id O --reason R\n       uniwork-admin folders-unshare [--dry-run] [--batch-size N]")
	os.Exit(2)
}

func fail(msg string) {
	fmt.Fprintln(os.Stderr, "uniwork-admin:", msg)
	os.Exit(1)
}
