// document-text-reindex requests the text index of file documents uploaded
// before document.text_index_requested existed.
//
//	document-text-reindex --org <organization id> [--dry-run] [--batch-size 20] [--max-pending 20]
//	document-text-reindex --all [--dry-run] [--batch-size 20] [--max-pending 20]
//
// It emits one request per file document's current version, one transaction
// per batch; the document_text_index consumer on the slow lane does the
// extraction. Before each batch it waits until fewer than --max-pending
// requests are still open, so the run never floods the slow lane that link
// previews, thumbnails and exports share. --dry-run counts and writes
// nothing, and never waits. Running it twice only
// repeats work: the consumer overwrites the same text. An --org id that does
// not exist, or any positional argument, is an error. Like cmd/graph-rebuild
// it reads only DATABASE_URL.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// topicTextIndexRequested is only read here, to count open requests; it must
// equal topicDocumentTextIndexRequested in internal/service/document_files.go.
const topicTextIndexRequested = "document.text_index_requested"

const usage = "usage: document-text-reindex (--org <id> | --all) [--dry-run] [--batch-size 20] [--max-pending 20]"

// pollEvery is how often a run that waits for the slow lane looks again.
const pollEvery = 2 * time.Second

func main() {
	if err := run(context.Background(), os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "document-text-reindex:", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string, out io.Writer) error {
	fs := flag.NewFlagSet("document-text-reindex", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	org := fs.String("org", "", "organization id to reindex")
	all := fs.Bool("all", false, "reindex every organization")
	dry := fs.Bool("dry-run", false, "count the requests without writing")
	batch := fs.Int("batch-size", 20, "documents per transaction")
	maxPending := fs.Int("max-pending", 20, "wait before each batch until fewer requests than this are open")
	if err := fs.Parse(args); err != nil {
		return fmt.Errorf("%w; %s", err, usage)
	}
	if fs.NArg() > 0 {
		return fmt.Errorf("unexpected arguments %q; %s", fs.Args(), usage)
	}
	if (*org == "") == !*all || *batch < 1 || *maxPending < 1 {
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
	scope := pgtype.Text{}
	if !*all {
		// An unknown id would request nothing and look like a clean run.
		found, err := q.GraphOrganizationExists(ctx, *org)
		if err != nil {
			return err
		}
		if !found {
			return fmt.Errorf("organization %q does not exist", *org)
		}
		scope = pgtype.Text{String: *org, Valid: true}
	}
	total, after := 0, ""
	for {
		rows, err := q.ListFileDocumentsForTextIndex(ctx, db.ListFileDocumentsForTextIndexParams{
			OrganizationID: scope, AfterID: after, PageLimit: int32(*batch),
		})
		if err != nil {
			return err
		}
		if len(rows) == 0 {
			break
		}
		after = rows[len(rows)-1].ID
		total += len(rows)
		if *dry {
			continue
		}
		if err := waitForRoom(ctx, q, *maxPending); err != nil {
			return err
		}
		if err := emitBatch(ctx, pool, rows); err != nil {
			return err
		}
	}
	if *dry {
		fmt.Fprintf(out, "would request=%d\n", total)
	} else {
		fmt.Fprintf(out, "requested=%d\n", total)
	}
	return nil
}

// waitForRoom blocks until fewer than maxPending requests of the topic are
// pending or processing; only a cancelled ctx or a failing query ends it early.
func waitForRoom(ctx context.Context, q *db.Queries, maxPending int) error {
	for {
		open, err := q.CountOpenOutboxByTopic(ctx, topicTextIndexRequested)
		if err != nil {
			return err
		}
		if open < int64(maxPending) {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(pollEvery):
		}
	}
}

func emitBatch(ctx context.Context, pool *pgxpool.Pool, rows []db.ListFileDocumentsForTextIndexRow) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if err := service.RequestFileTextIndex(ctx, db.New(tx), rows); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
