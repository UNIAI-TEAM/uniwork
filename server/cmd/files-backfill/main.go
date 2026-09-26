// Command files-backfill is the T9b (UNI-747) operator tool that migrates
// pre-FileService storage references to files rows + claimed upload sessions
// + business file_id columns.
//
// Subcommands:
//
//	plan      read-only classification report (this slice)
//	dry-run   classification + storage reachability, writes nothing   [planned]
//	apply     batched, checkpointed, resumable write of the mapping    [planned]
//	verify    files rows vs objects vs business references             [planned]
//
// Usage:
//
//	files-backfill plan [--cohort task-attachments,...] [--batch-size 500]
//	  [--format text|json] [--items] [--out FILE]
//
// The command connects with DATABASE_URL (via internal/config). plan and
// dry-run are safe to run against production; apply writes and must follow
// the runbook rehearsal (plan → dry-run → apply → crash mid-batch → resume →
// verify). Destructive object operations do not exist in this tool.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/service/backfill"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func main() {
	if err := run(context.Background(), os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "files-backfill:", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("usage: files-backfill <plan|dry-run|apply|verify> [flags]")
	}
	cmd := args[0]
	switch cmd {
	case "plan":
		return runPlan(ctx, args[1:])
	default:
		return fmt.Errorf("subcommand %q is not implemented yet (only plan)", cmd)
	}
}

func runPlan(ctx context.Context, args []string) error {
	fs := flag.NewFlagSet("plan", flag.ContinueOnError)
	cohort := fs.String("cohort", "", "comma-separated cohort list (default: all implemented)")
	batch := fs.Int("batch-size", 500, "keyset page size")
	format := fs.String("format", "text", "text|json")
	items := fs.Bool("items", false, "include the per-row item list in the report")
	out := fs.String("out", "", "write the report to this file instead of stdout")
	if err := fs.Parse(args); err != nil {
		return err
	}

	cfg, err := config.Load()
	if err != nil {
		return err
	}
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("connect: %w", err)
	}
	defer pool.Close()

	rep, err := backfill.New(db.New(pool), backfill.ResolverFromEnv()).Plan(ctx, backfill.Options{
		Cohorts:      splitList(*cohort),
		BatchSize:    int32(*batch),
		IncludeItems: *items,
	})
	if err != nil {
		return err
	}
	return emit(*format, *out, rep)
}

func splitList(s string) []string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func emit(format, out string, rep *backfill.Report) error {
	var data []byte
	var err error
	switch format {
	case "json":
		data, err = json.MarshalIndent(rep, "", "  ")
	case "text":
		data = []byte(rep.Human())
	default:
		return fmt.Errorf("unknown --format %q", format)
	}
	if err != nil {
		return err
	}
	if out == "" {
		_, err = os.Stdout.Write(append(data, '\n'))
		return err
	}
	return os.WriteFile(out, append(data, '\n'), 0o600)
}
