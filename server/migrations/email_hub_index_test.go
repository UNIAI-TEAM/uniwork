package migrations

import (
	"context"
	"strings"
	"testing"
)

// UNI-1123: sync and thread open delete/list attachments by thread_id; without
// an index each call scans every organization's rows.
func TestEmailHubAttachmentsThreadIndexUsed(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	lockTestDB(t, pool)
	if err := Up(ctx, pool); err != nil {
		t.Fatal(err)
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, "SET LOCAL enable_seqscan = off"); err != nil {
		t.Fatal(err)
	}
	rows, err := tx.Query(ctx, "EXPLAIN DELETE FROM email_hub_attachments WHERE thread_id = 'thr'")
	if err != nil {
		t.Fatal(err)
	}
	var plan strings.Builder
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			t.Fatal(err)
		}
		plan.WriteString(line + "\n")
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(plan.String(), "idx_email_hub_attachments_thread") {
		t.Fatalf("plan does not use the thread index:\n%s", plan.String())
	}
}

// A Sent row the app wrote after an SMTP send has a made-up UID (the send's unix
// second), so IMAP cannot serve its body again: the refetch migration must keep it.
func TestEmailHubRefetchBodiesKeepsLocallySentBodies(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	lockTestDB(t, pool)
	if err := Up(ctx, pool); err != nil {
		t.Fatal(err)
	}
	up, err := fsys.ReadFile("9991791644787028_email_hub_refetch_bodies.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `
		INSERT INTO email_hub_threads (id, account_id, organization_id, folder, imap_uid, sent_at, body_text, body_cached) VALUES
		  ('refetch-imap', 'acc', 'org', 'INBOX', 42, now(), 'fetched', true),
		  ('refetch-local', 'acc', 'org', 'SENT', 1791644787, to_timestamp(1791644787.5), 'composed', true)`); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, string(up)); err != nil {
		t.Fatal(err)
	}
	for id, wantCached := range map[string]bool{"refetch-imap": false, "refetch-local": true} {
		var cached bool
		if err := tx.QueryRow(ctx, `SELECT body_cached FROM email_hub_threads WHERE id = $1`, id).Scan(&cached); err != nil {
			t.Fatal(err)
		}
		if cached != wantCached {
			t.Errorf("%s: body_cached = %v, want %v", id, cached, wantCached)
		}
	}
}
