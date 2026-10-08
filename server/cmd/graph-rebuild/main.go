// graph-rebuild projects the Work Graph from the business tables (C-11 §5.4).
//
//	graph-rebuild --org <organization id> [--verify] [--format text|json]
//	graph-rebuild --all [--verify] [--format text|json]
//
// --verify writes nothing and exits 1 when any drift is found. An --org id
// that does not exist, or any positional argument, is an error. Like cmd/seed
// and cmd/uniwork-admin it reads only DATABASE_URL.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/graph/projector"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func main() {
	if err := run(context.Background(), os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "graph-rebuild:", err)
		os.Exit(1)
	}
}

const usage = "usage: graph-rebuild (--org <id> | --all) [--verify] [--format text|json]"

func run(ctx context.Context, args []string, out io.Writer) error {
	fs := flag.NewFlagSet("graph-rebuild", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	org := fs.String("org", "", "organization id to rebuild")
	all := fs.Bool("all", false, "rebuild every organization")
	verify := fs.Bool("verify", false, "count drift without writing; exit 1 when drift > 0")
	format := fs.String("format", "text", "text|json")
	if err := fs.Parse(args); err != nil {
		return fmt.Errorf("%w; %s", err, usage)
	}
	// Parsing stops at the first positional argument: "--org a b" would
	// rebuild a alone and "--org a b --verify" would drop --verify and write.
	if fs.NArg() > 0 {
		return fmt.Errorf("unexpected arguments %q; %s", fs.Args(), usage)
	}
	if (*org == "") == !*all || (*format != "text" && *format != "json") {
		return errors.New(usage)
	}
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		return errors.New("DATABASE_URL is not set")
	}
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return fmt.Errorf("connect: %w", err)
	}
	defer pool.Close()
	q := db.New(pool)
	orgs := []string{*org}
	if *all {
		if orgs, err = q.GraphListOrganizations(ctx); err != nil {
			return err
		}
	} else {
		// An unknown id has no rows, so it would rebuild nothing and report a
		// clean run; a typo in the rollout must fail instead.
		found, err := q.GraphOrganizationExists(ctx, *org)
		if err != nil {
			return err
		}
		if !found {
			return fmt.Errorf("organization %q does not exist", *org)
		}
	}
	var reports []projector.Report
	drift := 0
	for _, o := range orgs {
		rep, err := projector.RebuildOrg(ctx, pool, q, o, projector.RebuildOptions{Verify: *verify})
		if err != nil {
			return fmt.Errorf("organization %s: %w", o, err)
		}
		reports = append(reports, rep)
		drift += rep.Drift.Total()
	}
	if *format == "json" {
		enc := json.NewEncoder(out)
		enc.SetIndent("", "  ")
		if err := enc.Encode(reports); err != nil {
			return err
		}
	} else {
		for _, r := range reports {
			d := r.Drift
			fmt.Fprintf(out, "%s nodes=%d drift=%d (nodes +%d -%d ~%d, edges +%d -%d, facts +%d -%d ~%d)\n",
				r.OrganizationID, r.Nodes, d.Total(), d.MissingNodes, d.ExtraNodes, d.ChangedNodes,
				d.MissingEdges, d.ExtraEdges, d.MissingFacts, d.ExtraFacts, d.ChangedFacts)
		}
	}
	if *verify && drift > 0 {
		return fmt.Errorf("verify: %d drifted rows", drift)
	}
	return nil
}
