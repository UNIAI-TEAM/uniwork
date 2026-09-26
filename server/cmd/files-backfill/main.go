// Command files-backfill is the T9b (UNI-747) operator tool that migrates
// pre-FileService storage references to files rows + claimed upload sessions
// + business file_id columns.
//
// Subcommands:
//
//	plan      read-only classification report (SELECTs only, no run row)
//	dry-run   classification + object Stat per locator; writes nothing
//	apply     batched, checkpointed, resumable write of the mapping
//	verify    files rows vs sessions vs business refs vs object Stat
//	rollback  undo one apply run's business references and minted rows
//
// Usage:
//
//	files-backfill <subcommand> [--cohort a,b] [--batch-size 500]
//	  [--format text|json] [--items] [--out FILE]
//	  [--assume-backend s3] [--assume-bucket NAME]   (locators with no backend)
//	files-backfill apply   [--run RUN_ID]            (resume token)
//	files-backfill verify  [--run RUN_ID]            (ledger cross-check)
//	files-backfill rollback --run RUN_ID
//
// The command connects with DATABASE_URL (via internal/config) and builds the
// T2 object adapters from the same environment the API reads, so Stat goes to
// the deployment's real backends. plan and dry-run are safe against
// production; apply writes and follows the rehearsal in
// docs/ops/RUNBOOK_FILE_BACKFILL.md. No object is ever written or deleted.
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
	"github.com/unicomhub/uniwork/server/internal/storage"
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
		return fmt.Errorf("usage: files-backfill <plan|dry-run|apply|verify|rollback> [flags]")
	}
	switch args[0] {
	case "plan":
		return runCmd(ctx, "plan", args[1:])
	case "dry-run":
		return runCmd(ctx, "dry-run", args[1:])
	case "apply":
		return runCmd(ctx, "apply", args[1:])
	case "verify":
		return runCmd(ctx, "verify", args[1:])
	case "rollback":
		return runCmd(ctx, "rollback", args[1:])
	default:
		return fmt.Errorf("unknown subcommand %q (want plan|dry-run|apply|verify|rollback)", args[0])
	}
}

// cmdFlags are the flags every subcommand shares.
type cmdFlags struct {
	cohort  *string
	batch   *int
	format  *string
	items   *bool
	out     *string
	run     *string
	backend *string
	bucket  *string
}

func parseFlags(cmd string, args []string) (*cmdFlags, error) {
	fs := flag.NewFlagSet(cmd, flag.ContinueOnError)
	f := &cmdFlags{
		cohort:  fs.String("cohort", "", "comma-separated cohort list (default: all implemented)"),
		batch:   fs.Int("batch-size", 500, "keyset page size / apply transaction size"),
		format:  fs.String("format", "text", "text|json"),
		items:   fs.Bool("items", false, "include the per-row item list in the report"),
		out:     fs.String("out", "", "write the report to this file instead of stdout"),
		run:     fs.String("run", "", "apply: resume this run; verify: cross-check this run's ledger; rollback: required"),
		backend: fs.String("assume-backend", "", "backend for locators the source rows did not record (default: STORAGE_BACKEND)"),
		bucket:  fs.String("assume-bucket", "", "bucket for assumed-backend locators (default: the configured bucket)"),
	}
	return f, fs.Parse(args)
}

func runCmd(ctx context.Context, cmd string, args []string) error {
	f, err := parseFlags(cmd, args)
	if err != nil {
		return err
	}
	if cmd == "rollback" && *f.run == "" {
		return fmt.Errorf("rollback requires --run")
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

	eng := backfill.New(db.New(pool), backfill.ResolverFromEnv())
	opts := backfill.Options{
		Cohorts:      splitList(*f.cohort),
		BatchSize:    int32(*f.batch),
		IncludeItems: *f.items,
	}

	var rep *backfill.Report
	switch cmd {
	case "plan":
		rep, err = eng.Plan(ctx, opts)
	case "dry-run":
		// Real adapters when storage is configured; when it is not, every
		// object reports not-found so the report stays honest instead of
		// pretending reachability.
		stat := backfill.Statter(statter{})
		d := defaults(*f.backend, *f.bucket)
		if deps, derr := writeDeps(ctx, *f.backend, *f.bucket); derr == nil {
			stat, d = deps.stat, deps.defaults
		}
		eng.WithWriteDeps(backfill.WriteDeps{Stat: stat, Defaults: d})
		rep, err = eng.DryRun(ctx, opts)
	case "apply":
		deps, derr := writeDeps(ctx, *f.backend, *f.bucket)
		if derr != nil {
			return derr
		}
		eng.WithWriteDeps(backfill.WriteDeps{Pool: pool, Stat: deps.stat, Defaults: deps.defaults})
		rep, err = eng.Apply(ctx, backfill.ApplyOptions{Options: opts, RunID: *f.run})
	case "verify":
		deps, derr := writeDeps(ctx, *f.backend, *f.bucket)
		if derr != nil {
			return derr
		}
		eng.WithWriteDeps(backfill.WriteDeps{Pool: pool, Stat: deps.stat, Defaults: deps.defaults})
		rep, err = eng.Verify(ctx, backfill.VerifyOptions{Options: opts, RunID: *f.run})
	case "rollback":
		eng.WithWriteDeps(backfill.WriteDeps{Pool: pool})
		rep, err = eng.Rollback(ctx, *f.run)
	}
	if err != nil {
		return err
	}
	if eerr := emit(*f.format, *f.out, rep); eerr != nil {
		return eerr
	}
	if rep != nil && rep.Command == "verify" && rep.Totals.Failed > 0 {
		return fmt.Errorf("verify: %d failing checks", rep.Totals.Failed)
	}
	return nil
}

// statter is the no-store prober for dry-run when the deployment's storage is
// not configured: every object reports not-found rather than guessing.
type statter struct{}

func (statter) Stat(context.Context, storage.ObjectLocator) (storage.ObjectInfo, error) {
	return storage.ObjectInfo{}, storage.ErrNotFound
}

// statSet dispatches Stat to the adapter owning the locator's backend and
// bucket — the recording bucket can differ from the storage bucket
// (inventory §9.1 #4), so dispatch keys on both.
type statSet struct {
	stores map[string]storage.ObjectStore // key: backend + "\x00" + bucket
}

func storeKey(b storage.Backend, bucket string) string { return string(b) + "\x00" + bucket }

func (s statSet) Stat(ctx context.Context, loc storage.ObjectLocator) (storage.ObjectInfo, error) {
	store, ok := s.stores[storeKey(loc.Storage, loc.Bucket)]
	if !ok {
		// A locator whose backend/bucket pair was never configured cannot be
		// probed — report not-found instead of guessing at another adapter.
		return storage.ObjectInfo{}, storage.ErrNotFound
	}
	return store.Stat(ctx, loc)
}

// resolvedDeps is what the write path needs: the stat dispatcher plus the
// assumed-backend defaults for locators the source rows never recorded.
type resolvedDeps struct {
	stat     backfill.Statter
	defaults backfill.Defaults
}

// writeDeps builds the T2 adapters for every declared provider group plus a
// dedicated store for the recording bucket when it differs from the storage
// bucket.
func writeDeps(ctx context.Context, backendFlag, bucketFlag string) (resolvedDeps, error) {
	reg := storage.NewDefaultRegistry()
	cfg, err := storage.LoadConfigFromEnv(reg)
	if err != nil {
		return resolvedDeps{}, fmt.Errorf("storage config: %w", err)
	}
	stores, err := storage.BuildStores(ctx, cfg, reg)
	if err != nil {
		return resolvedDeps{}, fmt.Errorf("storage adapters: %w", err)
	}
	set := statSet{stores: map[string]storage.ObjectStore{}}
	for b, s := range stores {
		set.stores[storeKey(b, storeBucket(cfg, b))] = s
	}
	if rb := strings.TrimSpace(os.Getenv("LIVEKIT_RECORDING_BUCKET")); rb != "" && rb != cfgBucket(cfg) {
		rs, err := recordingStore(ctx, cfg, rb)
		if err != nil {
			return resolvedDeps{}, fmt.Errorf("recording bucket adapter: %w", err)
		}
		set.stores[storeKey(storage.BackendS3, rb)] = rs
	}
	return resolvedDeps{stat: set, defaults: defaults(backendFlag, bucketFlag, cfg)}, nil
}

// storeBucket names the bucket one built adapter serves.
func storeBucket(cfg storage.Config, b storage.Backend) string {
	switch b {
	case storage.BackendS3:
		return cfg.S3.Bucket
	case storage.BackendMinIO:
		return cfg.MinIO.Bucket
	default:
		return ""
	}
}

func cfgBucket(cfg storage.Config) string { return storeBucket(cfg, cfg.Backend) }

// recordingStore builds an s3 adapter scoped to the egress bucket using the
// same credential/endpoint variables cmd/server reads.
func recordingStore(ctx context.Context, cfg storage.Config, bucket string) (storage.ObjectStore, error) {
	endpoint := os.Getenv("LIVEKIT_RECORDING_S3_ENDPOINT")
	if endpoint == "" {
		endpoint = os.Getenv("AWS_ENDPOINT_URL")
	}
	region := os.Getenv("AWS_REGION")
	if region == "" {
		region = os.Getenv("S3_REGION")
	}
	if region == "" && cfg.S3 != nil {
		region = cfg.S3.Region
	}
	recCfg := storage.Config{
		Backend: storage.BackendS3,
		S3: &storage.S3Config{
			Bucket:          bucket,
			Region:          region,
			EndpointURL:     endpoint,
			AccessKeyID:     os.Getenv("AWS_ACCESS_KEY_ID"),
			SecretAccessKey: os.Getenv("AWS_SECRET_ACCESS_KEY"),
			SessionToken:    os.Getenv("AWS_SESSION_TOKEN"),
		},
	}
	f, err := storage.NewDefaultRegistry().Get(storage.BackendS3)
	if err != nil {
		return nil, err
	}
	return f.New(ctx, recCfg)
}

// defaults resolves the assumed coordinates for locatorless rows: the flags
// win, then the configured backend and its bucket.
func defaults(backendFlag, bucketFlag string, cfgs ...storage.Config) backfill.Defaults {
	d := backfill.Defaults{Storage: backendFlag, Bucket: bucketFlag}
	if len(cfgs) > 0 {
		cfg := cfgs[0]
		if d.Storage == "" {
			d.Storage = string(cfg.Backend)
		}
		if d.Bucket == "" {
			d.Bucket = cfgBucket(cfg)
		}
	}
	return d
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
