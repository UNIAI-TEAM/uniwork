package migrations

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
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

// UNI-1202: the dedupe migration keeps a mailbox address's oldest live row per
// owner, disconnects the rest and drops their cache, so the unique index builds.
func TestEmailHubDedupeKeepsOldestActiveAddress(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	lockTestDB(t, pool)
	if err := Up(ctx, pool); err != nil {
		t.Fatal(err)
	}
	up, err := fsys.ReadFile("9991791700000002_email_hub_accounts_dedupe.up.sql")
	if err != nil {
		t.Fatal(err)
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	// Duplicates predate the index; drop it inside the transaction to seed them.
	if _, err := tx.Exec(ctx, `DROP INDEX IF EXISTS idx_email_hub_accounts_active_address`); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO email_hub_accounts (id, user_id, organization_id, email_address, imap_host, smtp_host, password_enc, created_at, disconnected_at) VALUES
		  ('dedupe-keep',  'dedupe-u1', 'dedupe-org', 'dup@example.com', 'imap', 'smtp', 'k', now() - interval '2 days', NULL),
		  ('dedupe-dup',   'dedupe-u1', 'dedupe-org', 'Dup@Example.com', 'imap', 'smtp', 'd', now() - interval '1 day',  NULL),
		  ('dedupe-other', 'dedupe-u2', 'dedupe-org', 'dup@example.com', 'imap', 'smtp', 'o', now(),                     NULL),
		  ('dedupe-gone',  'dedupe-u1', 'dedupe-org', 'dup@example.com', 'imap', 'smtp', '',  now() - interval '3 days', now() - interval '3 days');
		INSERT INTO email_hub_threads (id, account_id, organization_id, imap_uid, sent_at) VALUES
		  ('dedupe-thr-keep', 'dedupe-keep', 'dedupe-org', 1, now()),
		  ('dedupe-thr-dup',  'dedupe-dup',  'dedupe-org', 1, now());
		INSERT INTO email_hub_attachments (id, thread_id, account_id, organization_id, part_id) VALUES
		  ('dedupe-att-keep', 'dedupe-thr-keep', 'dedupe-keep', 'dedupe-org', '1'),
		  ('dedupe-att-dup',  'dedupe-thr-dup',  'dedupe-dup',  'dedupe-org', '1');
		INSERT INTO email_hub_thread_ai_summaries (id, organization_id, thread_id, account_id, locale, source_fingerprint, summary, created_by, created_by_kind) VALUES
		  ('dedupe-sum-keep', 'dedupe-org', 'dedupe-thr-keep', 'dedupe-keep', 'vi', 'fp', 's', 'dedupe-u1', 'system'),
		  ('dedupe-sum-dup',  'dedupe-org', 'dedupe-thr-dup',  'dedupe-dup',  'vi', 'fp', 's', 'dedupe-u1', 'system');
		INSERT INTO email_hub_scheduled_sends (id, workspace_id, account_id, organization_id, user_id, payload, send_at, status) VALUES
		  ('dedupe-send-keep',    'ws', 'dedupe-keep', 'dedupe-org', 'dedupe-u1', '{}', now(), 'pending'),
		  ('dedupe-send-pending', 'ws', 'dedupe-dup',  'dedupe-org', 'dedupe-u1', '{}', now(), 'pending'),
		  ('dedupe-send-failed',  'ws', 'dedupe-dup',  'dedupe-org', 'dedupe-u1', '{}', now(), 'failed'),
		  ('dedupe-send-sent',    'ws', 'dedupe-dup',  'dedupe-org', 'dedupe-u1', '{}', now(), 'sent')`); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, string(up)); err != nil {
		t.Fatal(err)
	}

	for id, wantLive := range map[string]bool{"dedupe-keep": true, "dedupe-dup": false, "dedupe-other": true, "dedupe-gone": false} {
		var live bool
		var password string
		if err := tx.QueryRow(ctx, `SELECT disconnected_at IS NULL, password_enc FROM email_hub_accounts WHERE id = $1`, id).Scan(&live, &password); err != nil {
			t.Fatal(err)
		}
		if live != wantLive {
			t.Errorf("%s: live = %v, want %v", id, live, wantLive)
		}
		if !live && password != "" {
			t.Errorf("%s: a disconnected row keeps password_enc %q", id, password)
		}
	}
	for table, wantKeep := range map[string]string{
		"email_hub_threads":             "dedupe-thr-keep",
		"email_hub_attachments":         "dedupe-att-keep",
		"email_hub_thread_ai_summaries": "dedupe-sum-keep",
	} {
		var ids []string
		if err := tx.QueryRow(ctx, `SELECT coalesce(array_agg(id ORDER BY id), '{}') FROM `+table+` WHERE organization_id = 'dedupe-org'`).Scan(&ids); err != nil {
			t.Fatal(err)
		}
		if len(ids) != 1 || ids[0] != wantKeep {
			t.Errorf("%s: rows %v, want only %s", table, ids, wantKeep)
		}
	}
	for id, want := range map[string]string{
		"dedupe-send-keep": "pending", "dedupe-send-pending": "cancelled",
		"dedupe-send-failed": "cancelled", "dedupe-send-sent": "sent",
	} {
		var status string
		if err := tx.QueryRow(ctx, `SELECT status FROM email_hub_scheduled_sends WHERE id = $1`, id).Scan(&status); err != nil {
			t.Fatal(err)
		}
		if status != want {
			t.Errorf("%s: status %q, want %q", id, status, want)
		}
	}
	// What the migration exists for: the unique index now builds.
	if _, err := tx.Exec(ctx, `CREATE UNIQUE INDEX idx_email_hub_accounts_active_address
		ON email_hub_accounts (organization_id, user_id, lower(email_address)) WHERE disconnected_at IS NULL`); err != nil {
		t.Fatalf("unique index after dedupe: %v", err)
	}
}

// UNI-1202: one live row per (organization, owner, address), compared case-insensitively.
func TestEmailHubActiveAddressIsUnique(t *testing.T) {
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
	// A disconnected twin and another owner's live twin are both allowed.
	if _, err := tx.Exec(ctx, `
		INSERT INTO email_hub_accounts (id, user_id, organization_id, email_address, imap_host, smtp_host, password_enc, disconnected_at) VALUES
		  ('uniq-a',    'uniq-u1', 'uniq-org', 'box@example.com', 'imap', 'smtp', 'x', NULL),
		  ('uniq-gone', 'uniq-u1', 'uniq-org', 'box@example.com', 'imap', 'smtp', '',  now()),
		  ('uniq-b',    'uniq-u2', 'uniq-org', 'box@example.com', 'imap', 'smtp', 'x', NULL)`); err != nil {
		t.Fatal(err)
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO email_hub_accounts (id, user_id, organization_id, email_address, imap_host, smtp_host, password_enc)
		VALUES ('uniq-c', 'uniq-u1', 'uniq-org', 'BOX@Example.com', 'imap', 'smtp', 'x')`)
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23505" || pgErr.ConstraintName != "idx_email_hub_accounts_active_address" {
		t.Fatalf("second live row for the same address: err = %v, want unique violation on idx_email_hub_accounts_active_address", err)
	}
}
