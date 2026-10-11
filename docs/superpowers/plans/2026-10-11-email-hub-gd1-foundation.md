# Email Hub GĐ1 — nền tảng xác thực, TLS, chống SSRF và "cần kết nối lại" (UNI-1237)

> **Trạng thái:** in-progress — GĐ1 đã triển khai và kiểm chứng trên nhánh `feature/UNI-1237-email-hub-gd1-nen-tang-migration-netguar` (2026-10-11); PR chờ review toàn nhánh.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the foundation GĐ2 (custom IMAP/SMTP servers) and GĐ3 (OAuth) build on: credential columns and a credential version, a dial guard, mandatory TLS modes, one credential seam, and a "needs reconnect" state that keeps cached mail instead of wiping it.

**Architecture:** Migrations add auth/security/token/auth-failure columns plus `credential_version`; every write that acts on a credential snapshot is conditional on that version. `netguard` wraps every IMAP/SMTP dial (public IPs and mail ports only). `imapclient`/`smtpclient` take an explicit `Security` mode and a login `Username`. In `service`, `credentials()` is the only place a row becomes IMAP/SMTP credentials and `handleAuthError` → `markAuthFailed` is the only way an auth failure changes an account. `Connect` checks duplicates before dialling and reconnects onto the same id.

**Tech Stack:** Go (Chi, pgx, sqlc, go-imap v1.2.1, net/smtp), PostgreSQL migrations, TypeScript (TanStack Query, zod), React (packages/views), vitest.

**Spec:** `docs/superpowers/specs/2026-10-11-email-hub-oauth-custom-server-design.md` (GĐ1 row of §9). Executors read both.

## Global Constraints

- Issue: UNI-1237 (parent UNI-1236). Branch `feature/UNI-1237-email-hub-gd1-nen-tang-migration-netguar`, base `develop`. `prepare-commit-msg` adds `Refs: UNI-1237`; never type or strip it.
- Every commit: Conventional prefix (`feat(email-hub)`, `fix(email-hub)`, `test(email-hub)`, `refactor(email-hub)`, `docs`), a body with the reason, and the final line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never `--no-verify`.
- Migrations: no FK/REFERENCES; every index `CONCURRENTLY`, alone in its file; prefixes `999<unix-ms>` increasing in order auth → dedupe → index; each has a `.down.sql`.
- Every sqlc query on a tenant table constrains `organization_id`/`workspace_id` or carries a `-- tenant:` line; run `make sqlc` after editing queries.
- Every state change writes `audit_events` through `auditRecorder.Record` in the same transaction; every new action gets its row in `server/internal/service/audit_coverage_test.go`.
- Logs identify people by id, never email; connection errors are logged by classified code, never raw `err` from dial/DNS in new code.
- Only `service.Human` in handlers; membership only via `WorkspaceService.RequireMember` (through `s.workspace`).
- Response schemas lenient (`z.string()` for server enums), `parseWithFallback`, malformed-response test per endpoint change.
- `packages/views`: every JSX text via `t()`, keys in both `en.json` and `vi.json` following `docs/conventions.md`; files ≤ 500 lines; no `next/*`.
- GĐ1 hosts are still presets only: no custom host input (GĐ2), no XOAUTH2/OAuth (GĐ3). Do not add `UpdateEmailHubAccountOAuthTokens`.
- Go DB tests: `cd server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' go test -count=1 -timeout 30m ./internal/service/ -run <Name>`.
- Where a task's text and the spec disagree, the spec wins; where this plan's header and a task disagree, the header wins.

## Review Focus

1. A worker still holding the old credential fails after the user reconnects — the new credential must survive (no audit, no watcher stop). Pinned in Task 5 (stale `CredentialVersion` test).
2. An account in `needs_reconnect` while the hub is open: cached threads stay readable, the client stops heartbeating, nothing dials. Pinned in Tasks 6 and 9.
3. M365 tenant with SMTP AUTH disabled: send fails with `smtp_disabled`, IMAP keeps syncing, credential kept. Pinned in Tasks 4 and 6.
4. Duplicate connect (double click / two tabs): one succeeds, the other gets 409 without dialling. Pinned in Task 7.
5. A sent message shows exactly once after sync, for every provider. Pinned in Task 8.

Accepted GĐ1 deviations from the spec:
- §3: after a reconnect the server does not restart the IDLE watcher itself; the open client re-subscribes (`POST inbox-watch`) after the account list refetches, which the connect mutation already invalidates.
- §7: sync and watcher paths still log raw `err`. Harmless while every host is a preset; GĐ2 (custom hosts) must switch them to classified codes.

---

### Task 1: Migrations and sqlc queries

**Files:**
- Create: `server/migrations/9991791700000001_email_hub_accounts_auth.up.sql`, `.down.sql`
- Create: `server/migrations/9991791700000002_email_hub_accounts_dedupe.up.sql`, `.down.sql`
- Create: `server/migrations/9991791700000003_email_hub_accounts_active_address_uidx.up.sql`, `.down.sql`
- Modify: `server/pkg/db/queries/email_hub.sql` (lines 1-8 `CreateEmailHubAccount`, 32-50 the two Disconnect queries, 374-395 `ClaimEmailHubAccountsForSync`, plus three new queries after `UpdateEmailHubAccountSyncState` at line 52)
- Regenerate: `server/pkg/db/generated/models.go`, `server/pkg/db/generated/email_hub.sql.go` (`make sqlc`)
- Modify: `server/internal/service/email_hub.go:179-185` (`Connect` → `CreateEmailHubAccount` params)
- Modify: `server/internal/service/email_hub_integration_test.go:58-75` (seed helper)
- Modify: `server/internal/service/email_hub_sync_db_test.go:21-23, 44-46` (seed loops)
- Modify: `server/internal/handler/email_hub_test.go:205-211`, `server/internal/handler/isolation_world_test.go:687-691`
- Test: `server/migrations/email_hub_index_test.go` (append), `server/internal/service/email_hub_account_queries_test.go` (new)

**Interfaces:**
- Consumes: the existing `email_hub_accounts`, `email_hub_threads`, `email_hub_attachments`, `email_hub_thread_ai_summaries` and `email_hub_scheduled_sends` tables; `migrations.Up`, `testPool`, `lockTestDB`, `fsys`; `emailHubFixture`, `seedEmailHubAccount`.
- Produces (package `db`):
  - `EmailHubAccount` gains `AuthKind string`, `ImapSecurity string`, `SmtpSecurity string`, `Username string`, `OauthRefreshTokenEnc string`, `OauthAccessTokenEnc string`, `OauthAccessExpiresAt pgtype.Timestamptz`, `AuthFailedAt pgtype.Timestamptz`, `AuthFailedReason string`, `CredentialVersion int64`
  - `CreateEmailHubAccountParams` gains `ImapSecurity, SmtpSecurity, Username, AuthKind string`
  - `func (q *Queries) GetActiveEmailHubAccountByAddress(ctx, GetActiveEmailHubAccountByAddressParams{OrganizationID, UserID, Email string}) (EmailHubAccount, error)`
  - `func (q *Queries) UpdateEmailHubAccountCredentials(ctx, UpdateEmailHubAccountCredentialsParams{ID, OrganizationID, Provider, ImapHost string; ImapPort int32; ImapSecurity, SmtpHost string; SmtpPort int32; SmtpSecurity, Username, AuthKind, PasswordEnc string}) (EmailHubAccount, error)`: returns the NEW row
  - `func (q *Queries) MarkEmailHubAccountAuthFailed(ctx, MarkEmailHubAccountAuthFailedParams{ID, OrganizationID string; CredentialVersion int64; Reason string}) (int64, error)`
  - Index `idx_email_hub_accounts_active_address`
- Test helper (package `service`): `func seedEmailHubAccountAddr(t *testing.T, q *db.Queries, box *secretbox.Box, userID, orgID, email string) db.EmailHubAccount`

- [ ] **Step 1: Write the failing tests**

Append to `server/migrations/email_hub_index_test.go`. Add `"errors"` and `"github.com/jackc/pgx/v5/pgconn"` to its imports:

```go
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
```

Create `server/internal/service/email_hub_account_queries_test.go`:

```go
package service

import (
	"context"
	"errors"
	"slices"
	"testing"

	"github.com/jackc/pgx/v5"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The credential queries fence every write with credential_version: a write
// from an older snapshot changes nothing (spec §2.3).
func TestEmailHubAccountCredentialQueries(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	org := ws.OrganizationID
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, org)
	if acc.AuthKind != "password" || acc.ImapSecurity != "tls" || acc.SmtpSecurity != "starttls" || acc.CredentialVersion != 0 {
		t.Fatalf("new row: auth_kind=%q imap_security=%q smtp_security=%q version=%d", acc.AuthKind, acc.ImapSecurity, acc.SmtpSecurity, acc.CredentialVersion)
	}

	got, err := q.GetActiveEmailHubAccountByAddress(ctx, db.GetActiveEmailHubAccountByAddressParams{
		OrganizationID: org, UserID: user.ID, Email: "SEED@Gmail.com",
	})
	if err != nil || got.ID != acc.ID {
		t.Fatalf("lookup by address ignores case: got %q, err=%v", got.ID, err)
	}

	if err := q.UpdateEmailHubAccountSyncState(ctx, db.UpdateEmailHubAccountSyncStateParams{
		ID: acc.ID, OrganizationID: org, SyncState: []byte(`{"INBOX":{"uid_validity":7}}`),
	}); err != nil {
		t.Fatal(err)
	}

	mark := func(version int64) int64 {
		t.Helper()
		n, err := q.MarkEmailHubAccountAuthFailed(ctx, db.MarkEmailHubAccountAuthFailedParams{
			ID: acc.ID, OrganizationID: org, CredentialVersion: version, Reason: "imap_auth_failed",
		})
		if err != nil {
			t.Fatal(err)
		}
		return n
	}
	if n := mark(1); n != 0 {
		t.Fatalf("stale credential_version marked %d rows", n)
	}
	if n := mark(0); n != 1 {
		t.Fatalf("current credential_version marked %d rows, want 1", n)
	}
	if n := mark(0); n != 0 {
		t.Fatalf("an already failed account marked again: %d rows", n)
	}
	failed, err := q.GetEmailHubAccountByID(ctx, acc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !failed.AuthFailedAt.Valid || failed.AuthFailedReason != "imap_auth_failed" || failed.PasswordEnc != "" || failed.DisconnectedAt.Valid {
		t.Fatalf("failed row: auth_failed_at=%v reason=%q password_enc=%q disconnected=%v",
			failed.AuthFailedAt.Valid, failed.AuthFailedReason, failed.PasswordEnc, failed.DisconnectedAt.Valid)
	}
	if _, err := q.GetActiveEmailHubAccountByAddress(ctx, db.GetActiveEmailHubAccountByAddressParams{
		OrganizationID: org, UserID: user.ID, Email: acc.EmailAddress,
	}); err != nil {
		t.Fatalf("a failed account is still the live row for its address: %v", err)
	}
	claimed, err := q.ClaimEmailHubAccountsForSync(ctx, 50)
	if err != nil {
		t.Fatal(err)
	}
	if slices.ContainsFunc(claimed, func(a db.EmailHubAccount) bool { return a.ID == acc.ID }) {
		t.Fatal("sync claimed an account that needs reconnect")
	}

	update := func(imapHost string) db.EmailHubAccount {
		t.Helper()
		row, err := q.UpdateEmailHubAccountCredentials(ctx, db.UpdateEmailHubAccountCredentialsParams{
			ID: acc.ID, OrganizationID: org, Provider: acc.Provider,
			ImapHost: imapHost, ImapPort: acc.ImapPort, ImapSecurity: "tls",
			SmtpHost: acc.SmtpHost, SmtpPort: acc.SmtpPort, SmtpSecurity: "starttls",
			Username: "", AuthKind: "password", PasswordEnc: "sealed-new",
		})
		if err != nil {
			t.Fatal(err)
		}
		return row
	}
	same := update(acc.ImapHost)
	if same.CredentialVersion != 1 || same.AuthFailedAt.Valid || same.AuthFailedReason != "" || same.PasswordEnc != "sealed-new" {
		t.Fatalf("reconnect: version=%d auth_failed=%v reason=%q password_enc=%q",
			same.CredentialVersion, same.AuthFailedAt.Valid, same.AuthFailedReason, same.PasswordEnc)
	}
	if string(same.SyncState) == "{}" {
		t.Fatal("reconnect to the same IMAP server reset sync_state")
	}
	moved := update("imap.other.example")
	if moved.CredentialVersion != 2 || string(moved.SyncState) != "{}" {
		t.Fatalf("reconnect to another IMAP server: version=%d sync_state=%s", moved.CredentialVersion, moved.SyncState)
	}

	if n, err := q.DisconnectEmailHubAccount(ctx, db.DisconnectEmailHubAccountParams{
		ID: acc.ID, UserID: user.ID, OrganizationID: org,
	}); err != nil || n != 1 {
		t.Fatalf("disconnect: n=%d err=%v", n, err)
	}
	gone, err := q.GetEmailHubAccountByID(ctx, acc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if gone.CredentialVersion != 3 || gone.PasswordEnc != "" {
		t.Fatalf("disconnect: version=%d password_enc=%q", gone.CredentialVersion, gone.PasswordEnc)
	}
	if _, err := q.UpdateEmailHubAccountCredentials(ctx, db.UpdateEmailHubAccountCredentialsParams{
		ID: acc.ID, OrganizationID: org, AuthKind: "password", ImapSecurity: "tls", SmtpSecurity: "starttls",
	}); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("reconnecting a disconnected row: err=%v, want pgx.ErrNoRows", err)
	}
}
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
cd server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' go test ./migrations/ -run 'TestEmailHubDedupe|TestEmailHubActiveAddressIsUnique' -count=1
cd server && go vet ./internal/service/
```

Expected: the dedupe test fails with `open 9991791700000002_email_hub_accounts_dedupe.up.sql: file does not exist`. The unique test fails with `err = <nil>, want unique violation`. `go vet` fails because `acc.AuthKind`, `db.GetActiveEmailHubAccountByAddressParams`, `db.MarkEmailHubAccountAuthFailedParams` and `db.UpdateEmailHubAccountCredentialsParams` are undefined.

- [ ] **Step 3: Add the migrations**

`server/migrations/9991791700000001_email_hub_accounts_auth.up.sql`:

```sql
-- UNI-1237: per-mailbox auth kind, TLS mode and login name, OAuth tokens
-- (sealed like password_enc), the needs-reconnect state, and the version
-- that fences writes made from an older credential snapshot.
ALTER TABLE email_hub_accounts
  ADD COLUMN IF NOT EXISTS auth_kind TEXT NOT NULL DEFAULT 'password',
  ADD COLUMN IF NOT EXISTS imap_security TEXT NOT NULL DEFAULT 'tls',
  ADD COLUMN IF NOT EXISTS smtp_security TEXT NOT NULL DEFAULT 'starttls',
  ADD COLUMN IF NOT EXISTS username TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS oauth_refresh_token_enc TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS oauth_access_token_enc TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS oauth_access_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS auth_failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS auth_failed_reason TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS credential_version BIGINT NOT NULL DEFAULT 0;
```

`server/migrations/9991791700000001_email_hub_accounts_auth.down.sql`:

```sql
ALTER TABLE email_hub_accounts
  DROP COLUMN IF EXISTS credential_version,
  DROP COLUMN IF EXISTS auth_failed_reason,
  DROP COLUMN IF EXISTS auth_failed_at,
  DROP COLUMN IF EXISTS oauth_access_expires_at,
  DROP COLUMN IF EXISTS oauth_access_token_enc,
  DROP COLUMN IF EXISTS oauth_refresh_token_enc,
  DROP COLUMN IF EXISTS username,
  DROP COLUMN IF EXISTS smtp_security,
  DROP COLUMN IF EXISTS imap_security,
  DROP COLUMN IF EXISTS auth_kind;
```

`server/migrations/9991791700000002_email_hub_accounts_dedupe.up.sql`:

```sql
-- UNI-1202: before the unique index on a live mailbox address can build, each
-- (organization, owner, address) keeps only its oldest live row. The others
-- are disconnected the way Disconnect does it. Their cache goes here too,
-- because no job cleans up a disconnected mailbox. This follows
-- cleanUpDisconnectedEmailHubAccount: queued sends are cancelled, then
-- attachments, AI summaries and threads are deleted. Bodies already in object
-- storage stay for the file GC, as they do after Disconnect. It is one
-- statement because the CTEs share one snapshot, and without foreign keys the
-- order of the deletes does not matter.
WITH ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY organization_id, user_id, lower(email_address)
    ORDER BY created_at, id
  ) AS rn
  FROM email_hub_accounts
  WHERE disconnected_at IS NULL
), dup AS (
  UPDATE email_hub_accounts a
  SET disconnected_at = now(), password_enc = '',
      credential_version = a.credential_version + 1, updated_at = now()
  FROM ranked r
  WHERE a.id = r.id AND r.rn > 1
  RETURNING a.id, a.organization_id
), cancelled AS (
  UPDATE email_hub_scheduled_sends s
  SET status = 'cancelled'
  FROM dup
  WHERE s.account_id = dup.id
    AND s.organization_id = dup.organization_id
    AND s.status IN ('pending', 'failed')
), attachments AS (
  DELETE FROM email_hub_attachments
  WHERE (account_id, organization_id) IN (SELECT id, organization_id FROM dup)
), summaries AS (
  DELETE FROM email_hub_thread_ai_summaries
  WHERE (account_id, organization_id) IN (SELECT id, organization_id FROM dup)
)
DELETE FROM email_hub_threads
WHERE (account_id, organization_id) IN (SELECT id, organization_id FROM dup);
```

`server/migrations/9991791700000002_email_hub_accounts_dedupe.down.sql`:

```sql
-- The duplicate rows were disconnected and their cache deleted; there is nothing to restore.
SELECT 1;
```

`server/migrations/9991791700000003_email_hub_accounts_active_address_uidx.up.sql`:

```sql
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_email_hub_accounts_active_address
  ON email_hub_accounts (organization_id, user_id, lower(email_address))
  WHERE disconnected_at IS NULL;
```

`server/migrations/9991791700000003_email_hub_accounts_active_address_uidx.down.sql`:

```sql
DROP INDEX CONCURRENTLY IF EXISTS idx_email_hub_accounts_active_address;
```

- [ ] **Step 4: Edit the queries and regenerate**

In `server/pkg/db/queries/email_hub.sql`, replace `CreateEmailHubAccount` (lines 1-8):

```sql
-- name: CreateEmailHubAccount :one
INSERT INTO email_hub_accounts (
  id, user_id, organization_id, email_address, provider,
  imap_host, imap_port, smtp_host, smtp_port, password_enc,
  imap_security, smtp_security, username, auth_kind
) VALUES (
  $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
)
RETURNING *;
```

Replace both Disconnect queries (lines 32-50):

```sql
-- name: DisconnectEmailHubAccount :execrows
-- A disconnected mailbox is never used again (connecting the address again
-- creates a new row), so its credentials go with it.
UPDATE email_hub_accounts
SET disconnected_at = now(), password_enc = '',
    oauth_refresh_token_enc = '', oauth_access_token_enc = '', oauth_access_expires_at = NULL,
    credential_version = credential_version + 1, updated_at = now()
WHERE id = $1
  AND user_id = $2
  AND organization_id = $3
  AND disconnected_at IS NULL;

-- name: DisconnectEmailHubAccountsForUser :many
-- tenant: self
-- Account deletion (organization_id NULL: every organization) or leaving one.
UPDATE email_hub_accounts
SET disconnected_at = now(), password_enc = '',
    oauth_refresh_token_enc = '', oauth_access_token_enc = '', oauth_access_expires_at = NULL,
    credential_version = credential_version + 1, updated_at = now()
WHERE user_id = sqlc.arg('user_id')
  AND (sqlc.narg('organization_id')::text IS NULL OR organization_id = sqlc.narg('organization_id'))
  AND disconnected_at IS NULL
RETURNING id, organization_id;
```

Insert these after `UpdateEmailHubAccountSyncState` (after line 56):

```sql
-- name: GetActiveEmailHubAccountByAddress :one
-- The live row for an address, including one that needs reconnect. lower()
-- matches idx_email_hub_accounts_active_address; FOR UPDATE holds the row
-- through a reconnect transaction.
SELECT *
FROM email_hub_accounts
WHERE organization_id = sqlc.arg('organization_id')
  AND user_id = sqlc.arg('user_id')
  AND lower(email_address) = lower(sqlc.arg('email')::text)
  AND disconnected_at IS NULL
FOR UPDATE;

-- name: UpdateEmailHubAccountCredentials :one
-- Reconnect keeps the id. UIDs from another IMAP server mean nothing, so
-- sync_state resets when host or port change. The version bump fences writes
-- from older snapshots. SET expressions read the old row.
UPDATE email_hub_accounts
SET provider = sqlc.arg('provider'),
    imap_host = sqlc.arg('imap_host'),
    imap_port = sqlc.arg('imap_port'),
    imap_security = sqlc.arg('imap_security'),
    smtp_host = sqlc.arg('smtp_host'),
    smtp_port = sqlc.arg('smtp_port'),
    smtp_security = sqlc.arg('smtp_security'),
    username = sqlc.arg('username'),
    auth_kind = sqlc.arg('auth_kind'),
    password_enc = sqlc.arg('password_enc'),
    oauth_refresh_token_enc = '',
    oauth_access_token_enc = '',
    oauth_access_expires_at = NULL,
    auth_failed_at = NULL,
    auth_failed_reason = '',
    sync_state = CASE
      WHEN imap_host <> sqlc.arg('imap_host') OR imap_port <> sqlc.arg('imap_port') THEN '{}'::jsonb
      ELSE sync_state
    END,
    credential_version = credential_version + 1,
    updated_at = now()
WHERE id = sqlc.arg('id')
  AND organization_id = sqlc.arg('organization_id')
  AND disconnected_at IS NULL
RETURNING *;

-- name: MarkEmailHubAccountAuthFailed :execrows
-- Only the snapshot that failed may mark the account: a reconnect since then
-- bumped credential_version and its new credential stays.
UPDATE email_hub_accounts
SET auth_failed_at = now(),
    auth_failed_reason = sqlc.arg('reason'),
    password_enc = '',
    oauth_refresh_token_enc = '',
    oauth_access_token_enc = '',
    oauth_access_expires_at = NULL,
    updated_at = now()
WHERE id = sqlc.arg('id')
  AND organization_id = sqlc.arg('organization_id')
  AND credential_version = sqlc.arg('credential_version')
  AND disconnected_at IS NULL
  AND auth_failed_at IS NULL;
```

In `ClaimEmailHubAccountsForSync`, change the inner `WHERE disconnected_at IS NULL` to:

```sql
  WHERE disconnected_at IS NULL
    -- A mailbox that needs reconnect has no credential to sync with.
    AND auth_failed_at IS NULL
```

Regenerate from the repo root:

```bash
make sqlc
grep -n "AuthKind\|CredentialVersion" server/pkg/db/generated/models.go
grep -n "type GetActiveEmailHubAccountByAddressParams\|type UpdateEmailHubAccountCredentialsParams\|type MarkEmailHubAccountAuthFailedParams" -A 14 server/pkg/db/generated/email_hub.sql.go
```

Confirm `Email string` (the `::text` cast makes it a string), `ImapPort int32`, `SmtpPort int32` and `CredentialVersion int64`.

- [ ] **Step 5: Update callers of `CreateEmailHubAccount`**

Without these values, the new params insert `''` over the column defaults.

`server/internal/service/email_hub.go:179-185`:

```go
	row, err := s.q.CreateEmailHubAccount(ctx, db.CreateEmailHubAccountParams{
		ID: id, UserID: actor.ID, OrganizationID: ws.OrganizationID,
		EmailAddress: email, Provider: prov.Name,
		ImapHost: prov.IMAPHost, ImapPort: int32(prov.IMAPPort), ImapSecurity: "tls",
		SmtpHost: prov.SMTPHost, SmtpPort: int32(prov.SMTPPort), SmtpSecurity: "starttls",
		AuthKind:    "password",
		PasswordEnc: base64.StdEncoding.EncodeToString(sealed),
	})
```

`server/internal/service/email_hub_integration_test.go`: replace `seedEmailHubAccount` (lines 58-75):

```go
func seedEmailHubAccount(t *testing.T, q *db.Queries, box *secretbox.Box, userID, orgID string) db.EmailHubAccount {
	t.Helper()
	return seedEmailHubAccountAddr(t, q, box, userID, orgID, "seed@gmail.com")
}

// seedEmailHubAccountAddr seeds a live mailbox at email; an owner's live
// addresses are unique (idx_email_hub_accounts_active_address).
func seedEmailHubAccountAddr(t *testing.T, q *db.Queries, box *secretbox.Box, userID, orgID, email string) db.EmailHubAccount {
	t.Helper()
	sealed, err := box.Seal([]byte("app-password"))
	if err != nil {
		t.Fatal(err)
	}
	row, err := q.CreateEmailHubAccount(context.Background(), db.CreateEmailHubAccountParams{
		ID: util.NewID(), UserID: userID, OrganizationID: orgID,
		EmailAddress: email, Provider: "gmail",
		ImapHost: "127.0.0.1", ImapPort: 1, ImapSecurity: "tls",
		SmtpHost: "127.0.0.1", SmtpPort: 1, SmtpSecurity: "starttls",
		AuthKind:    "password",
		PasswordEnc: base64.StdEncoding.EncodeToString(sealed),
	})
	if err != nil {
		t.Fatal(err)
	}
	return row
}
```

`server/internal/service/email_hub_sync_db_test.go`: add `"fmt"` to the imports and give each looped seed its own address:

```go
	for i := 0; i < 21; i++ {
		last = seedEmailHubAccountAddr(t, q, svc.box, user.ID, ws.OrganizationID, fmt.Sprintf("seed%d@gmail.com", i))
	}
```

```go
	for i := 0; i < 6; i++ {
		seedEmailHubAccountAddr(t, q, svc.box, user.ID, ws.OrganizationID, fmt.Sprintf("seed%d@gmail.com", i))
	}
```

`server/internal/handler/email_hub_test.go:205-211`:

```go
	if _, err := q.CreateEmailHubAccount(ctx, db.CreateEmailHubAccountParams{
		ID: accID, UserID: userID, OrganizationID: orgID,
		EmailAddress: "seed@gmail.com", Provider: "gmail",
		ImapHost: "127.0.0.1", ImapPort: 1, ImapSecurity: "tls",
		SmtpHost: "127.0.0.1", SmtpPort: 1, SmtpSecurity: "starttls",
		AuthKind:    "password",
		PasswordEnc: base64.StdEncoding.EncodeToString(sealed),
	}); err != nil {
```

`server/internal/handler/isolation_world_test.go:687-691`:

```go
	acc, err := w.q.CreateEmailHubAccount(ctx, db.CreateEmailHubAccountParams{
		ID: util.NewID(), UserID: tn.userID, OrganizationID: tn.orgID, EmailAddress: strings.ToLower(m) + "-mailbox@example.com",
		Provider: "gmail", ImapHost: "imap.example.com", ImapPort: 993, ImapSecurity: "tls",
		SmtpHost: "smtp.example.com", SmtpPort: 465, SmtpSecurity: "starttls", AuthKind: "password",
		PasswordEnc: base64.StdEncoding.EncodeToString(enc),
	})
```

- [ ] **Step 6: Run the tests and confirm they pass**

```bash
cd server && go build ./... && go vet ./...
cd server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' go test ./migrations/ -count=1
cd server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' go test ./internal/service/ -run 'TestEmailHub|TestAuditCoverage' -count=1
cd server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' go test ./internal/handler/ -run 'TestEmailHub|TestIsolation' -count=1
cd server && gofmt -l internal migrations pkg
```

Expected: everything passes. The `./migrations/` run includes `TestNewMigrationsCreateIndexesConcurrently`, `TestMigrationPrefixesSortTheSameAsStringsAndNumbers`, `TestEveryQueryNamesItsTenant`, `TestUpIsIdempotent`, `TestSingleOwnerBackfillDemotesLaterOwners` (it runs all three new down files) and both new tests. `gofmt -l` prints nothing.

- [ ] **Step 7: Commit**

```bash
git add server/migrations/9991791700000001_email_hub_accounts_auth.up.sql server/migrations/9991791700000001_email_hub_accounts_auth.down.sql \
  server/migrations/9991791700000002_email_hub_accounts_dedupe.up.sql server/migrations/9991791700000002_email_hub_accounts_dedupe.down.sql \
  server/migrations/9991791700000003_email_hub_accounts_active_address_uidx.up.sql server/migrations/9991791700000003_email_hub_accounts_active_address_uidx.down.sql \
  server/migrations/email_hub_index_test.go server/pkg/db/queries/email_hub.sql server/pkg/db/generated \
  server/internal/service/email_hub.go server/internal/service/email_hub_integration_test.go server/internal/service/email_hub_sync_db_test.go \
  server/internal/service/email_hub_account_queries_test.go server/internal/handler/email_hub_test.go server/internal/handler/isolation_world_test.go
git commit -m "feat(email-hub): add auth columns, dedupe live addresses and fence credential writes" \
  -m "Three migrations: auth/OAuth/needs-reconnect columns with credential_version; a dedupe that disconnects duplicate live addresses and drops their cache; the unique index on (organization_id, user_id, lower(email_address)). New queries GetActiveEmailHubAccountByAddress, UpdateEmailHubAccountCredentials and MarkEmailHubAccountAuthFailed; Disconnect now bumps the version and sync claims skip accounts that need reconnect. UpdateEmailHubAccountOAuthTokens is left for GD3." \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Notes:
- **Two deliberate departures from the spec.** `UpdateEmailHubAccountCredentials` returns the new row, as the contract says; the spec says the old row. The disconnect queries still return only `id, organization_id`, without the refresh token the spec wants for revoke. Both are left for GĐ3.
- **I did not run anything.** None of the plan's steps were executed, and I did not check how sqlc types `sqlc.arg('imap_port')` when the same arg is used twice; Step 4's grep checks it. Until Task N maps unique violations to a 409, two `Connect` calls racing on the same address now return a 500.

---

### Task 2: netguard package

**Files:**
- Create: `server/internal/emailhub/netguard/netguard.go`
- Test: `server/internal/emailhub/netguard/netguard_test.go`

Nothing outside the package changes in this task. Later tasks (imapclient/smtpclient TLS modes) make `netguard.Dial` the value of their own package var `dialTCP`. `server/internal/arch_test.go` has no rule about emailhub packages, so it needs no change.

**Interfaces:**
- Consumes: only the standard library (`context`, `errors`, `net`, `net/netip`, `syscall`, `time`).
- Produces (package `netguard`, import path `github.com/unicomhub/uniwork/server/internal/emailhub/netguard`):
  - `func Dial(ctx context.Context, network, addr string) (net.Conn, error)`: `net.Dialer{Timeout: 15 * time.Second, Control: control}`. When the guard refuses, it returns the bare `ErrHostNotAllowed`, with the `*net.OpError` wrapper removed so no host, IP or port shows up in the error. Any other error, such as a context error or connection refused, is returned unchanged.
  - `var ErrHostNotAllowed error`: the message is `"email server address not allowed"` and names no host or IP.
  - `func AllowedIP(ip netip.Addr) bool`
  - `func AllowedPort(port int) bool`: true only for 25, 143, 465, 587 and 993.
  - unexported `var guard func(ip netip.Addr, port int) bool`: called by `control`, which parses the resolved address with `netip.ParseAddrPort`. Only tests inside `netguard` replace it. Nothing is exported for other packages' tests, and no env var turns it off.

- [ ] **Step 1: Write the failing test**

Create `server/internal/emailhub/netguard/netguard_test.go`:

```go
package netguard

import (
	"context"
	"errors"
	"net"
	"net/netip"
	"strings"
	"testing"
)

func TestAllowedIP(t *testing.T) {
	cases := []struct {
		ip   string
		want bool
	}{
		// IPv4 public, including the neighbours of blocked ranges.
		{"8.8.8.8", true},
		{"1.1.1.1", true},
		{"142.250.4.108", true},
		{"100.63.255.255", true},
		{"100.128.0.0", true},
		{"172.15.255.255", true},
		{"172.32.0.0", true},
		{"198.17.255.255", true},
		{"198.20.0.0", true},
		{"223.255.255.255", true},
		// Every blocked IPv4 range.
		{"0.0.0.0", false},
		{"0.255.255.255", false},
		{"10.0.0.1", false},
		{"10.255.255.255", false},
		{"100.64.0.0", false},
		{"100.127.255.255", false},
		{"127.0.0.1", false},
		{"127.255.255.254", false},
		{"169.254.0.1", false},
		{"169.254.169.254", false},
		{"172.16.0.1", false},
		{"172.31.255.255", false},
		{"192.0.0.8", false},
		{"192.0.2.1", false},
		{"192.168.0.1", false},
		{"192.168.255.255", false},
		{"198.18.0.1", false},
		{"198.19.255.255", false},
		{"198.51.100.7", false},
		{"203.0.113.9", false},
		{"224.0.0.1", false},
		{"239.255.255.255", false},
		{"240.0.0.1", false},
		{"255.255.255.255", false},
		// IPv4-mapped ::ffff:0:0/96 is judged as IPv4.
		{"::ffff:8.8.8.8", true},
		{"::ffff:127.0.0.1", false},
		{"::ffff:10.0.0.1", false},
		{"::ffff:169.254.169.254", false},
		// Unspecified, loopback and IPv4-compatible ::/96.
		{"::", false},
		{"::1", false},
		{"::8.8.8.8", false},
		{"::127.0.0.1", false},
		// NAT64 well-known 64:ff9b::/96.
		{"64:ff9b::808:808", true},
		{"64:ff9b::7f00:1", false},
		{"64:ff9b::a00:1", false},
		{"64:ff9b::a9fe:a9fe", false},
		// NAT64 local-use 64:ff9b:1::/48, /96 form only.
		{"64:ff9b:1::808:808", true},
		{"64:ff9b:1::7f00:1", false},
		{"64:ff9b:1::c0a8:1", false},
		{"64:ff9b:1:808:8::", false},
		// 6to4, Teredo and documentation inside 2000::/3.
		{"2002:808:808::1", false},
		{"2002:7f00:1::1", false},
		{"2001::1", false},
		{"2001:0:4136:e378:8000:63bf:3fff:fdd2", false},
		{"2001:db8::1", false},
		// Public 2000::/3.
		{"2607:f8b0:4023:c06::6c", true},
		{"2a00:1450:400c:c0a::6d", true},
		{"2001:4860:4860::8888", true},
		{"3fff:ffff::1", true},
		// Everything outside 2000::/3.
		{"100::1", false},
		{"fc00::1", false},
		{"fd12:3456::1", false},
		{"fe80::1", false},
		{"fe80::1%en0", false},
		{"fec0::1", false},
		{"ff02::1", false},
		{"4000::1", false},
		{"1fff:ffff::1", false},
	}
	for _, tc := range cases {
		t.Run(tc.ip, func(t *testing.T) {
			if got := AllowedIP(netip.MustParseAddr(tc.ip)); got != tc.want {
				t.Fatalf("AllowedIP(%s) = %v, want %v", tc.ip, got, tc.want)
			}
		})
	}
	if AllowedIP(netip.Addr{}) {
		t.Fatal("the zero Addr must not be allowed")
	}
}

func TestAllowedPort(t *testing.T) {
	for _, p := range []int{25, 143, 465, 587, 993} {
		if !AllowedPort(p) {
			t.Errorf("AllowedPort(%d) = false, want true", p)
		}
	}
	for _, p := range []int{0, 22, 80, 110, 443, 995, 2525, 5432, 6379, 8080, 65535} {
		if AllowedPort(p) {
			t.Errorf("AllowedPort(%d) = true, want false", p)
		}
	}
}

// assertRefused checks the error is exactly ErrHostNotAllowed and names
// neither the host nor any address it resolved to.
func assertRefused(t *testing.T, err error, leaks ...string) {
	t.Helper()
	if !errors.Is(err, ErrHostNotAllowed) {
		t.Fatalf("err = %v, want ErrHostNotAllowed", err)
	}
	if err.Error() != ErrHostNotAllowed.Error() {
		t.Fatalf("err %q carries more than ErrHostNotAllowed", err)
	}
	for _, s := range leaks {
		if strings.Contains(err.Error(), s) {
			t.Fatalf("err %q leaks %q", err, s)
		}
	}
}

func TestDialRefusesBlockedIPLiteral(t *testing.T) {
	conn, err := Dial(context.Background(), "tcp", "127.0.0.1:993")
	if conn != nil {
		_ = conn.Close()
	}
	assertRefused(t, err, "127.0.0.1", "993")
}

func TestDialRefusesHostnameResolvingToBlockedIP(t *testing.T) {
	var seen []netip.Addr
	prev := guard
	guard = func(ip netip.Addr, port int) bool {
		seen = append(seen, ip)
		return prev(ip, port)
	}
	t.Cleanup(func() { guard = prev })

	conn, err := Dial(context.Background(), "tcp", "localhost:993")
	if conn != nil {
		_ = conn.Close()
	}
	assertRefused(t, err, "localhost", "127.0.0.1", "::1")
	if len(seen) == 0 {
		t.Fatal("guard never saw a resolved IP")
	}
	for _, ip := range seen {
		if !ip.Unmap().IsLoopback() {
			t.Fatalf("guard saw %s, want the resolved loopback IP", ip)
		}
	}
}

func TestDialRefusesPortOutsideSet(t *testing.T) {
	// The guard runs before connect(), so nothing is sent to 8.8.8.8.
	conn, err := Dial(context.Background(), "tcp", "8.8.8.8:80")
	if conn != nil {
		_ = conn.Close()
	}
	assertRefused(t, err, "8.8.8.8", "80")
}

func TestDialConnectsWhenGuardAllows(t *testing.T) {
	prev := guard
	guard = func(netip.Addr, int) bool { return true }
	t.Cleanup(func() { guard = prev })

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ln.Close() })
	go func() {
		if c, err := ln.Accept(); err == nil {
			_ = c.Close()
		}
	}()

	conn, err := Dial(context.Background(), "tcp", ln.Addr().String())
	if err != nil {
		t.Fatalf("Dial: %v", err)
	}
	_ = conn.Close()
}

func TestDialPassesOtherErrorsThrough(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := Dial(ctx, "tcp", "8.8.8.8:993")
	if errors.Is(err, ErrHostNotAllowed) || !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
}
```

The tests that replace `guard` do not call `t.Parallel()`, because they mutate a package variable.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && go test ./internal/emailhub/netguard/ -count=1`
Expected: build failure with `undefined: AllowedIP`, `undefined: AllowedPort`, `undefined: Dial`, `undefined: ErrHostNotAllowed`, `undefined: guard`.

- [ ] **Step 3: Implement**

Create `server/internal/emailhub/netguard/netguard.go`:

```go
// Package netguard dials the IMAP/SMTP servers an email hub account names,
// refusing private, loopback, link-local, documentation and multicast
// addresses so a user-supplied host cannot reach the internal network.
package netguard

import (
	"context"
	"errors"
	"net"
	"net/netip"
	"syscall"
	"time"
)

// ErrHostNotAllowed deliberately names no host or IP: it reaches the client,
// and the connect form must not become a probe of internal DNS names.
var ErrHostNotAllowed = errors.New("email server address not allowed")

const dialTimeout = 15 * time.Second

// guard judges every connection attempt on the IP actually being dialled, so
// a name that rebinds to a private address after validation is still refused.
// Only this package's tests replace it; there is no switch to turn it off.
var guard = func(ip netip.Addr, port int) bool { return AllowedIP(ip) && AllowedPort(port) }

var blockedV4 = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"),
	netip.MustParsePrefix("10.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("127.0.0.0/8"),
	netip.MustParsePrefix("169.254.0.0/16"),
	netip.MustParsePrefix("172.16.0.0/12"),
	netip.MustParsePrefix("192.0.0.0/24"),
	netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("192.168.0.0/16"),
	netip.MustParsePrefix("198.18.0.0/15"),
	netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("224.0.0.0/4"),
	netip.MustParsePrefix("240.0.0.0/4"), // includes 255.255.255.255
}

var (
	globalUnicastV6 = netip.MustParsePrefix("2000::/3")
	blockedV6       = []netip.Prefix{
		netip.MustParsePrefix("2001::/32"),     // Teredo
		netip.MustParsePrefix("2001:db8::/32"), // documentation
		netip.MustParsePrefix("2002::/16"),     // 6to4
	}
	nat64WellKnown = netip.MustParsePrefix("64:ff9b::/96")
	nat64LocalUse  = netip.MustParsePrefix("64:ff9b:1::/48")
)

// Dial opens a TCP connection like net.Dialer.DialContext, refusing any
// resolved address or port the guard rejects.
func Dial(ctx context.Context, network, addr string) (net.Conn, error) {
	d := net.Dialer{Timeout: dialTimeout, Control: control}
	conn, err := d.DialContext(ctx, network, addr)
	if errors.Is(err, ErrHostNotAllowed) {
		// The *net.OpError around it prints the address; drop the wrapper.
		return nil, ErrHostNotAllowed
	}
	return conn, err
}

// control runs after DNS resolution, once per attempted IP, before connect.
func control(_, address string, _ syscall.RawConn) error {
	ap, err := netip.ParseAddrPort(address)
	if err != nil || !guard(ap.Addr(), int(ap.Port())) {
		return ErrHostNotAllowed
	}
	return nil
}

// AllowedPort reports whether port is one of the standard IMAP/SMTP ports.
func AllowedPort(port int) bool {
	switch port {
	case 25, 143, 465, 587, 993:
		return true
	}
	return false
}

// AllowedIP reports whether ip is a public unicast address an email server
// may live on. IPv6 is an allowlist (2000::/3); NAT64 addresses are judged by
// the IPv4 address they embed.
func AllowedIP(ip netip.Addr) bool {
	ip = ip.WithZone("").Unmap()
	switch {
	case ip.Is4():
		return allowedV4(ip)
	case nat64WellKnown.Contains(ip):
		return allowedV4(embeddedV4(ip))
	case nat64LocalUse.Contains(ip):
		// shortcut: only the /96 form of the local-use NAT64 prefix is understood
		// and other RFC 6052 embeddings are refused; widen if a deployment needs them.
		b := ip.As16()
		for _, x := range b[6:12] {
			if x != 0 {
				return false
			}
		}
		return allowedV4(embeddedV4(ip))
	case !globalUnicastV6.Contains(ip):
		return false
	}
	for _, p := range blockedV6 {
		if p.Contains(ip) {
			return false
		}
	}
	return true
}

func allowedV4(ip netip.Addr) bool {
	for _, p := range blockedV4 {
		if p.Contains(ip) {
			return false
		}
	}
	return true
}

func embeddedV4(ip netip.Addr) netip.Addr {
	b := ip.As16()
	return netip.AddrFrom4([4]byte(b[12:16]))
}
```

Design notes:
- `WithZone("")` is needed because a zoned IPv6 address never matches any `netip.Prefix`. Without it, `fe80::1%en0` would fall through to the `2000::/3` check. It is refused there anyway, but stripping the zone makes the comparison explicit.
- `255.255.255.255` is inside `240.0.0.0/4`.
- netguard does no logging. Per spec §7, the service logs the classified code (`host_not_allowed`) and never the raw dial error.

- [ ] **Step 4: Run tests to verify pass**

```bash
cd server && gofmt -l ./internal/emailhub/netguard/
cd server && go vet ./internal/emailhub/netguard/
cd server && go tool staticcheck ./internal/emailhub/netguard/
cd server && go test -race -count=1 -cover ./internal/emailhub/netguard/
```

Expected: `gofmt -l` prints nothing. vet and staticcheck are clean. The test run prints `ok  github.com/unicomhub/uniwork/server/internal/emailhub/netguard ... coverage: 100.0% of statements`. The tests open no outbound connection: the port-80 and blocked-IP cases are refused in `Control` before `connect()`, and the cancelled-context case fails before dialling.

- [ ] **Step 5: Commit**

```bash
git add server/internal/emailhub/netguard/netguard.go server/internal/emailhub/netguard/netguard_test.go
git commit -m "feat(email-hub): add netguard dialer that refuses private and non-mail addresses" -m "Checks every resolved IP in net.Dialer.Control so DNS rebinding cannot reach internal hosts; IPv6 is an allowlist (2000::/3 minus Teredo, 6to4, documentation), NAT64 is judged by its embedded IPv4, ports are limited to 25/143/465/587/993. ErrHostNotAllowed carries no host or IP. imapclient/smtpclient wiring is left to the TLS-mode tasks." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(`.githooks/prepare-commit-msg` adds the `Refs: UNI-1237` trailer.)

---
I ran the package and its tests in a scratch module outside the repo with go 1.27: gofmt is clean, `go vet` passes, `-race` passes and coverage is 100%. I did not run staticcheck, because it can only run from `server/`.
For the local-use NAT64 prefix `64:ff9b:1::/48`, only the `/96` form is accepted and every other embedding is refused, which is stricter than the spec. This is marked with a `shortcut:` comment. The `localhost` test needs `/etc/hosts` to resolve `localhost` on the CI runner.

---

### Task 3: imapclient TLS modes, greeting deadline, fake TLS server

**Files:**
- Modify: `server/internal/emailhub/imapclient/client.go`. Change the imports (lines 3-18), `Credentials` (lines 37-42), and the block from `dialIMAP` to `dial` (lines 144-160). `login` stays as it is.
- Rewrite: `server/internal/emailhub/imapclient/fake_server_test.go` (all of it)
- Create: `server/internal/emailhub/imapclient/dial_test.go`
- Unchanged, but they must still pass: `session_test.go`, `sync_test.go`, `mailboxes_test.go`, `move_test.go`, `attachment_fetch_test.go`, and every other `imapclient` test. They all reach the fake through `f.start(t)`/`dial`, so they now run over TLS. `session.go`, `move.go`, `backfill.go`, `search.go` and `attachments.go` all open connections through `dial(c)` and need no edit. `service/email_hub.go:150` and `service/email_hub_folders.go:31` set fields by name, so the new fields stay zero there (`Security` "" means implicit TLS, which is today's behaviour).

**Interfaces:**
- Consumes: `netguard.Dial(ctx context.Context, network, addr string) (net.Conn, error)` from Task 2 (`github.com/unicomhub/uniwork/server/internal/emailhub/netguard`).
- Produces:
  - `type Credentials struct{ Host string; Port int; Email string; Username string; Password string; Security string }`. `Security` is `"tls"`, `"starttls"`, or `""`, which means `"tls"`.
  - `var ErrTLSRequired error`. `ErrAuthFailed` and `ErrLoginRefused` are unchanged.
  - Package vars: `dialTCP = netguard.Dial`, `tlsRootCAs *x509.CertPool` (nil in prod), `greetingTimeout = imapClientTimeout`.
  - `dialIMAP` is removed.
  - The LOGIN user is `Username` when it is non-empty, otherwise `Email`.

- [ ] **Step 1: Write the failing test**

Replace all of `server/internal/emailhub/imapclient/fake_server_test.go`:

```go
package imapclient

import (
	"bufio"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"fmt"
	"math/big"
	"net"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeServerTLS / fakeRootCAs: one self-signed certificate for 127.0.0.1,
// served by every fake and trusted by dial through tlsRootCAs.
var fakeServerTLS, fakeRootCAs = newFakeTLS()

// Tests dial loopback, which netguard refuses; production keeps netguard.
func init() {
	dialTCP = (&net.Dialer{Timeout: 5 * time.Second}).DialContext
	tlsRootCAs = fakeRootCAs
}

func newFakeTLS() (*tls.Config, *x509.CertPool) {
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		panic(err)
	}
	tmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "fake imap"},
		IPAddresses:           []net.IP{net.IPv4(127, 0, 0, 1)},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		IsCA:                  true,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		panic(err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		panic(err)
	}
	pool := x509.NewCertPool()
	pool.AddCert(cert)
	return &tls.Config{
		Certificates: []tls.Certificate{{Certificate: [][]byte{der}, PrivateKey: key}},
		MinVersion:   tls.VersionTLS12,
	}, pool
}

// fakeIMAP is a scripted IMAP server. It records every command line it
// receives (tag stripped) and answers with reply when that returns true,
// otherwise with a minimal default. By default it speaks implicit TLS;
// with starttls it greets in plaintext, advertises STARTTLS and upgrades.
type fakeIMAP struct {
	caps     string
	starttls bool
	reply    func(w *bufio.Writer, tag, cmd string) bool

	mu   sync.Mutex
	cmds []string
}

func (f *fakeIMAP) start(t *testing.T) Credentials {
	t.Helper()
	var ln net.Listener
	var err error
	security := "" // empty means implicit TLS, so every default-fake test proves the default
	if f.starttls {
		ln, err = net.Listen("tcp", "127.0.0.1:0")
		security = "starttls"
	} else {
		ln, err = tls.Listen("tcp", "127.0.0.1:0", fakeServerTLS)
	}
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ln.Close() })
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go f.serve(conn)
		}
	}()
	return Credentials{
		Host: "127.0.0.1", Port: ln.Addr().(*net.TCPAddr).Port,
		Email: "user@example.com", Password: "secret", Security: security,
	}
}

func (f *fakeIMAP) commands() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.cmds...)
}

func (f *fakeIMAP) serve(conn net.Conn) {
	defer func() { _ = conn.Close() }() // conn is reassigned on STARTTLS
	r := bufio.NewReader(conn)
	w := bufio.NewWriter(conn)
	fmt.Fprint(w, "* OK fake ready\r\n")
	_ = w.Flush()
	idleTag := ""
	upgraded := false
	for {
		line, err := r.ReadString('\n')
		if err != nil {
			return
		}
		line = strings.TrimRight(line, "\r\n")
		if line == "DONE" {
			f.record("DONE")
			fmt.Fprintf(w, "%s OK IDLE terminated\r\n", idleTag)
			_ = w.Flush()
			continue
		}
		tag, cmd, _ := strings.Cut(line, " ")
		f.record(cmd)
		verb, _, _ := strings.Cut(strings.ToUpper(cmd), " ")
		if verb == "IDLE" {
			idleTag = tag
		}
		if f.reply != nil && f.reply(w, tag, cmd) {
			_ = w.Flush()
			continue
		}
		switch verb {
		case "CAPABILITY":
			caps := f.caps
			if f.starttls && !upgraded {
				caps = strings.TrimSpace(caps + " STARTTLS")
			}
			fmt.Fprintf(w, "* CAPABILITY IMAP4rev1 IDLE %s\r\n%s OK done\r\n", caps, tag)
		case "STARTTLS":
			fmt.Fprintf(w, "%s OK begin TLS\r\n", tag)
			_ = w.Flush()
			conn = tls.Server(conn, fakeServerTLS)
			r, w = bufio.NewReader(conn), bufio.NewWriter(conn)
			upgraded = true
			continue
		case "SELECT":
			fmt.Fprintf(w, "* 30 EXISTS\r\n%s OK [READ-WRITE] selected\r\n", tag)
		case "IDLE":
			fmt.Fprint(w, "+ idling\r\n")
		case "LOGOUT":
			fmt.Fprintf(w, "* BYE bye\r\n%s OK done\r\n", tag)
			_ = w.Flush()
			return
		default:
			fmt.Fprintf(w, "%s OK done\r\n", tag)
		}
		_ = w.Flush()
	}
}

func (f *fakeIMAP) record(cmd string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.cmds = append(f.cmds, cmd)
}

// sent reports whether a command starting with prefix was received.
func (f *fakeIMAP) sent(prefix string) bool {
	for _, c := range f.commands() {
		if strings.HasPrefix(c, prefix) {
			return true
		}
	}
	return false
}
```

Create `server/internal/emailhub/imapclient/dial_test.go`:

```go
package imapclient

import (
	"bufio"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"net"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestDialStartTLSUpgradesBeforeLogin(t *testing.T) {
	t.Parallel()
	f := &fakeIMAP{starttls: true}
	cl, err := dial(f.start(t))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = cl.Logout() }()
	cmds := f.commands()
	upgrade := slices.Index(cmds, "STARTTLS")
	login := slices.IndexFunc(cmds, func(c string) bool { return strings.HasPrefix(c, "LOGIN") })
	if upgrade < 0 || login < 0 || upgrade > login {
		t.Fatalf("expected STARTTLS before LOGIN, got %q", cmds)
	}
}

func TestDialStartTLSWithoutCapabilityIsTLSRequired(t *testing.T) {
	t.Parallel()
	f := &fakeIMAP{starttls: true, reply: func(w *bufio.Writer, tag, cmd string) bool {
		if cmd != "CAPABILITY" {
			return false
		}
		fmt.Fprintf(w, "* CAPABILITY IMAP4rev1\r\n%s OK done\r\n", tag)
		return true
	}}
	_, err := dial(f.start(t))
	if !errors.Is(err, ErrTLSRequired) {
		t.Fatalf("expected ErrTLSRequired, got %v", err)
	}
	if f.sent("LOGIN") || f.sent("STARTTLS") {
		t.Fatalf("the password must never cross a plaintext connection: %q", f.commands())
	}
}

func TestDialLogsInWithUsernameWhenSet(t *testing.T) {
	t.Parallel()
	f := &fakeIMAP{}
	creds := f.start(t)
	creds.Username = "login-name"
	cl, err := dial(creds)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = cl.Logout() }()
	for _, c := range f.commands() {
		if strings.HasPrefix(c, "LOGIN") {
			if !strings.Contains(c, "login-name") || strings.Contains(c, "user@example.com") {
				t.Fatalf("LOGIN must carry Username, got %q", c)
			}
			return
		}
	}
	t.Fatalf("no LOGIN sent: %q", f.commands())
}

// Not parallel: it swaps the package-wide tlsRootCAs.
func TestDialRefusesAnUntrustedCertificate(t *testing.T) {
	saved := tlsRootCAs
	tlsRootCAs = x509.NewCertPool() // trusts nothing
	t.Cleanup(func() { tlsRootCAs = saved })
	f := &fakeIMAP{}
	if _, err := dial(f.start(t)); err == nil {
		t.Fatal("expected a certificate error")
	}
	if f.sent("LOGIN") {
		t.Fatal("LOGIN sent over an unverified connection")
	}
}

// silentServer accepts TCP, writes greet (possibly nothing) and never answers.
func silentServer(t *testing.T, greet string) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ln.Close() })
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go func() {
				defer conn.Close()
				_, _ = io.WriteString(conn, greet)
				_, _ = io.Copy(io.Discard, conn) // until the client gives up and closes
			}()
		}
	}()
	return ln.Addr().(*net.TCPAddr).Port
}

// Not parallel: it shortens the package-wide greetingTimeout.
func TestDialGivesUpOnASilentServer(t *testing.T) {
	saved := greetingTimeout
	greetingTimeout = 300 * time.Millisecond
	t.Cleanup(func() { greetingTimeout = saved })
	cases := []struct{ name, greet, security string }{
		{"no greeting", "", "starttls"},
		{"tls handshake never answered", "", "tls"},
		// client.New sends CAPABILITY with no timeout when the greeting lacks it.
		{"greeting then silence", "* OK hi\r\n", "starttls"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			port := silentServer(t, tc.greet)
			done := make(chan error, 1)
			go func() {
				_, err := dial(Credentials{Host: "127.0.0.1", Port: port, Email: "u", Password: "p", Security: tc.security})
				done <- err
			}()
			select {
			case err := <-done:
				if err == nil {
					t.Fatal("expected an error from a silent server")
				}
			case <-time.After(5 * time.Second):
				t.Fatal("dial hung past the greeting timeout")
			}
		})
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && go test ./internal/emailhub/imapclient/ -count=1
```
Expected: a compile failure in the test files. `undefined: dialTCP`, `undefined: tlsRootCAs`, `undefined: greetingTimeout` and `undefined: ErrTLSRequired`, plus `unknown field Security` / `Username` in the struct literal of type `Credentials`.

- [ ] **Step 3: Implement**

In `server/internal/emailhub/imapclient/client.go`, replace the import block (lines 3-18):

```go
import (
	"bufio"
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"github.com/emersion/go-imap"
	"github.com/emersion/go-imap/client"
	"github.com/emersion/go-imap/commands"
	"github.com/emersion/go-message"
	"github.com/emersion/go-message/charset"
	"github.com/emersion/go-message/mail"
	"github.com/emersion/go-message/textproto"

	"github.com/unicomhub/uniwork/server/internal/emailhub/netguard"
)
```

Replace `Credentials` (lines 37-42):

```go
// Credentials for a single mailbox session.
type Credentials struct {
	Host     string
	Port     int
	Email    string
	Username string // LOGIN user; empty means Email
	Password string
	Security string // "tls" or "starttls"; empty means "tls"
}
```

Replace lines 144-160 (the `dialIMAP` var and `func dial`) with:

```go
// ErrTLSRequired marks a starttls server that does not offer STARTTLS: the
// password is never sent over a plaintext connection.
var ErrTLSRequired = errors.New("imap: server does not offer STARTTLS")

// dialTCP opens the TCP connection. Package tests swap in a plain dialer
// because netguard refuses loopback.
var dialTCP = netguard.Dial

// tlsRootCAs is nil in production (system roots); package tests trust the
// fake server's self-signed certificate.
var tlsRootCAs *x509.CertPool

// greetingTimeout bounds what cl.Timeout cannot: the greeting, the implicit
// TLS handshake and the CAPABILITY client.New sends with no timeout set.
// A var only so a package test can shorten it.
var greetingTimeout = imapClientTimeout

func dial(c Credentials) (*client.Client, error) {
	conn, err := dialTCP(context.Background(), "tcp", net.JoinHostPort(c.Host, strconv.Itoa(c.Port)))
	if err != nil {
		return nil, fmt.Errorf("imap dial: %w", err)
	}
	cfg := &tls.Config{ServerName: c.Host, MinVersion: tls.VersionTLS12, RootCAs: tlsRootCAs}
	starttls := c.Security == "starttls"
	if !starttls {
		conn = tls.Client(conn, cfg) // "tls", and "" for rows written before the column existed
	}
	if err := conn.SetDeadline(time.Now().Add(greetingTimeout)); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("imap dial: %w", err)
	}
	held := &deadlineHeldConn{Conn: conn}
	held.hold.Store(true)
	cl, err := client.New(held)
	if err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("imap greeting: %w", err)
	}
	held.hold.Store(false)
	_ = conn.SetDeadline(time.Time{})
	cl.Timeout = imapClientTimeout
	if starttls {
		if err := startTLS(cl, cfg); err != nil {
			_ = cl.Logout()
			return nil, err
		}
	}
	user := c.Username
	if user == "" {
		user = c.Email
	}
	if err := login(cl, user, c.Password); err != nil {
		_ = cl.Logout()
		return nil, fmt.Errorf("imap login: %w", err)
	}
	return cl, nil
}

// startTLS upgrades a plaintext session, or refuses: there is no opportunistic
// fallback. cfg carries ServerName because client.New never learned the host.
func startTLS(cl *client.Client, cfg *tls.Config) error {
	ok, err := cl.Support("STARTTLS")
	if err != nil {
		return fmt.Errorf("imap capability: %w", err)
	}
	if !ok {
		return ErrTLSRequired
	}
	if err := cl.StartTLS(cfg); err != nil {
		return fmt.Errorf("imap starttls: %w", err)
	}
	return nil
}

// deadlineHeldConn ignores go-imap's deadline calls while hold is set:
// client.New may send CAPABILITY with Timeout 0, which would clear the
// greeting deadline and let a server that greets and then stalls hang dial.
type deadlineHeldConn struct {
	net.Conn
	hold atomic.Bool
}

func (c *deadlineHeldConn) SetDeadline(t time.Time) error {
	if c.hold.Load() {
		return nil
	}
	return c.Conn.SetDeadline(t)
}
```

`login` (lines 162-186) does not change.

- [ ] **Step 4: Run tests to verify pass**

```bash
cd server && gofmt -l internal/emailhub/imapclient/
cd server && go vet ./internal/emailhub/imapclient/ && go tool staticcheck ./internal/emailhub/imapclient/
cd server && go test -race ./internal/emailhub/imapclient/ -count=1
cd server && go build ./...
```
Expected:
- `gofmt -l` prints nothing.
- vet and staticcheck are clean.
- Every `imapclient` test passes, the new ones and all the existing ones. That includes `TestWatchFolder*`, `TestDialReportsARefusedLoginAsAuthFailed`, `TestDialNetworkErrorIsNotAuthFailed`, `TestDialLogsInAndReadsPostLoginCapabilities`, `TestFetchMessagesReadsReferences`, the move, mailboxes and attachment tests, and `TestAttachmentFetchHoldsAGlobalSlotOnlyWhileFetching`. They now all run over TLS.
- `go build ./...` succeeds. The `service` package still compiles because it fills `Credentials` by field name.
- go-imap's `ErrorLog` writes `error reading response` lines to stderr during `TestDialGivesUpOnASilentServer`. That is expected.

- [ ] **Step 5: Commit**

```bash
git add server/internal/emailhub/imapclient/client.go server/internal/emailhub/imapclient/fake_server_test.go server/internal/emailhub/imapclient/dial_test.go
git commit -m "feat(email-hub): imap tls/starttls modes, greeting deadline and netguard dial" -m "dial goes through netguard, verifies certificates against tlsRootCAs, refuses a starttls server without STARTTLS (ErrTLSRequired) and bounds the greeting, implicit TLS handshake and client.New CAPABILITY with a deadline; the fake IMAP server now speaks TLS and STARTTLS. XOAUTH2 is left to GD3." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
I have not compiled or run any of this. The task depends on Task 2's `netguard.Dial`, which does not exist in the worktree yet. Beyond the contract, I added a small conn wrapper, `deadlineHeldConn`, and an untrusted-certificate test. The wrapper is needed because go-imap's `client.New` sends CAPABILITY with no timeout when the greeting lacks it, which clears the deadline. Without it, a server that greets and then goes silent would hang `dial` forever.

---

### Task 4: smtpclient TLS modes, auth sentinels and a fake SMTP server

**Files:**
- Modify: `server/internal/emailhub/smtpclient/session.go` (whole file, 85 lines, rewritten below)
- Modify: `server/internal/emailhub/smtpclient/send.go:11-17` (Credentials), `:33-42` (VerifyLogin), `:44-62` (Send doc + authenticate call)
- Modify: `server/internal/emailhub/smtpclient/auth.go:33-45` (remove `isLocalhost`, plaintext LOGIN always refused)
- Modify: `server/internal/emailhub/smtpclient/auth_test.go:60-70` (replace `TestIsLocalhost`)
- Modify: `server/internal/service/email_hub.go:157-159` and `:445-447` (pass `Security: "starttls"` until the credentials seam lands)
- Create: `server/internal/emailhub/smtpclient/fake_server_test.go` (TestMain, fake SMTP server)
- Create: `server/internal/emailhub/smtpclient/session_test.go`

**Interfaces:**
- Consumes: `netguard.Dial(ctx context.Context, network, addr string) (net.Conn, error)`, `netguard.ErrHostNotAllowed` (from the netguard task, which must land first)
- Produces:
  - `type Credentials struct { Host string; Port int; Email string; Username string; Password string; Security string }` (`Security` is `"tls"` or `"starttls"`; `""` means `"tls"`; any other value is an error before dialing)
  - `var ErrAuthFailed, ErrSMTPAuthDisabled, ErrTLSRequired error`
  - unexported package vars `dialTCP = netguard.Dial`, `tlsRootCAs *x509.CertPool` (nil in prod; only this package's TestMain sets them)
  - `VerifyLogin(c Credentials) error` and `Send(ctx, c Credentials, msg Message) (string, error)` keep their signatures. `Username` (falling back to `Email`) is used only for AUTH. MAIL FROM, the `From:` header and `newMessageID` keep using `Email`.
  - Classification: a reply whose text contains `SmtpClientAuthentication is disabled` wraps `ErrSMTPAuthDisabled`. Any other 535/534 wraps `ErrAuthFailed`. Both use `fmt.Errorf("%w: %w", sentinel, err)`, so the original `*textproto.Error` still unwraps.

- [ ] **Step 1: Write the failing test**

Create `server/internal/emailhub/smtpclient/fake_server_test.go`:

```go
package smtpclient

import (
	"bufio"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
)

var (
	// prodDialTCP keeps the production dialer so a test can prove it is netguarded.
	prodDialTCP = dialTCP
	fakeCert    tls.Certificate
)

func TestMain(m *testing.M) {
	// Borrow httptest's self-signed cert (SANs 127.0.0.1, ::1, example.com) instead of minting one.
	hs := httptest.NewTLSServer(http.NotFoundHandler())
	fakeCert = hs.TLS.Certificates[0]
	roots := x509.NewCertPool()
	roots.AddCert(hs.Certificate())
	hs.Close()

	tlsRootCAs = roots
	dialTCP = (&net.Dialer{Timeout: dialTimeout}).DialContext
	os.Exit(m.Run())
}

type fakeSMTPConfig struct {
	implicitTLS bool   // listener speaks TLS from the first byte (465 style)
	startTLS    bool   // plaintext listener that advertises and accepts STARTTLS
	authMechs   string // EHLO AUTH line; default "PLAIN LOGIN"
	authReply   string // final reply to AUTH; default "235 2.7.0 Accepted"
	plainReply  string // when set, AUTH PLAIN answers this instead (e.g. 504 to force LOGIN)
	silent      bool   // accept TCP but never send a greeting
}

type fakeSMTPLog struct {
	authUsers []string
	mailFrom  []string
	rcpts     []string
	data      string
	startTLS  int
}

type fakeSMTP struct {
	cfg  fakeSMTPConfig
	port int
	mu   sync.Mutex
	log  fakeSMTPLog
}

func newFakeSMTP(t *testing.T, cfg fakeSMTPConfig) *fakeSMTP {
	t.Helper()
	if cfg.authMechs == "" {
		cfg.authMechs = "PLAIN LOGIN"
	}
	if cfg.authReply == "" {
		cfg.authReply = "235 2.7.0 Accepted"
	}
	var (
		ln  net.Listener
		err error
	)
	if cfg.implicitTLS {
		ln, err = tls.Listen("tcp", "127.0.0.1:0", &tls.Config{Certificates: []tls.Certificate{fakeCert}})
	} else {
		ln, err = net.Listen("tcp", "127.0.0.1:0")
	}
	if err != nil {
		t.Fatalf("fake smtp listen: %v", err)
	}
	f := &fakeSMTP{cfg: cfg, port: ln.Addr().(*net.TCPAddr).Port}
	done := make(chan struct{})
	t.Cleanup(func() {
		close(done)
		_ = ln.Close()
	})
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go f.serve(conn, done)
		}
	}()
	return f
}

func (f *fakeSMTP) creds(security string) Credentials {
	return Credentials{
		Host: "127.0.0.1", Port: f.port, Email: "user@example.com",
		Password: "secret", Security: security,
	}
}

func (f *fakeSMTP) seen() fakeSMTPLog {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := f.log
	out.authUsers = append([]string(nil), f.log.authUsers...)
	out.mailFrom = append([]string(nil), f.log.mailFrom...)
	out.rcpts = append([]string(nil), f.log.rcpts...)
	return out
}

func (f *fakeSMTP) record(fn func(l *fakeSMTPLog)) {
	f.mu.Lock()
	defer f.mu.Unlock()
	fn(&f.log)
}

func (f *fakeSMTP) serve(conn net.Conn, done <-chan struct{}) {
	defer func() { _ = conn.Close() }()
	if f.cfg.silent {
		<-done
		return
	}
	r := bufio.NewReader(conn)
	reply := func(lines ...string) {
		for _, l := range lines {
			_, _ = io.WriteString(conn, l+"\r\n")
		}
	}
	tlsOn := f.cfg.implicitTLS
	reply("220 fake.smtp ESMTP")
	for {
		line, err := r.ReadString('\n')
		if err != nil {
			return
		}
		verb, arg, _ := strings.Cut(strings.TrimRight(line, "\r\n"), " ")
		switch strings.ToUpper(verb) {
		case "EHLO", "HELO":
			lines := []string{"250-fake.smtp"}
			if f.cfg.startTLS && !tlsOn {
				lines = append(lines, "250-STARTTLS")
			}
			reply(append(lines, "250 AUTH "+f.cfg.authMechs)...)
		case "STARTTLS":
			if !f.cfg.startTLS || tlsOn {
				reply("502 5.5.1 STARTTLS not supported")
				continue
			}
			reply("220 2.0.0 Ready to start TLS")
			tc := tls.Server(conn, &tls.Config{Certificates: []tls.Certificate{fakeCert}})
			if tc.Handshake() != nil {
				return
			}
			conn, r, tlsOn = tc, bufio.NewReader(tc), true
			f.record(func(l *fakeSMTPLog) { l.startTLS++ })
		case "AUTH":
			mech, initial, _ := strings.Cut(arg, " ")
			var user string
			switch strings.ToUpper(mech) {
			case "PLAIN":
				if f.cfg.plainReply != "" {
					reply(f.cfg.plainReply)
					continue
				}
				raw, _ := base64.StdEncoding.DecodeString(initial)
				if parts := strings.Split(string(raw), "\x00"); len(parts) == 3 {
					user = parts[1]
				}
			case "LOGIN":
				reply("334 " + base64.StdEncoding.EncodeToString([]byte("Username:")))
				u, err := readBase64Line(r)
				if err != nil {
					return
				}
				reply("334 " + base64.StdEncoding.EncodeToString([]byte("Password:")))
				if _, err := readBase64Line(r); err != nil {
					return
				}
				user = u
			default:
				reply("504 5.7.4 Unrecognized authentication type")
				continue
			}
			f.record(func(l *fakeSMTPLog) { l.authUsers = append(l.authUsers, user) })
			reply(f.cfg.authReply)
		case "*":
			reply("501 5.7.0 Authentication cancelled")
		case "MAIL":
			from := strings.TrimSuffix(strings.TrimPrefix(arg, "FROM:<"), ">")
			f.record(func(l *fakeSMTPLog) { l.mailFrom = append(l.mailFrom, from) })
			reply("250 2.1.0 OK")
		case "RCPT":
			to := strings.TrimSuffix(strings.TrimPrefix(arg, "TO:<"), ">")
			f.record(func(l *fakeSMTPLog) { l.rcpts = append(l.rcpts, to) })
			reply("250 2.1.5 OK")
		case "DATA":
			reply("354 Go ahead")
			var b strings.Builder
			for {
				dl, err := r.ReadString('\n')
				if err != nil {
					return
				}
				if dl == ".\r\n" {
					break
				}
				b.WriteString(dl)
			}
			f.record(func(l *fakeSMTPLog) { l.data = b.String() })
			reply("250 2.0.0 Queued")
		case "NOOP", "RSET":
			reply("250 2.0.0 OK")
		case "QUIT":
			reply("221 2.0.0 Bye")
			return
		default:
			reply("502 5.5.2 Command not recognized")
		}
	}
}

func readBase64Line(r *bufio.Reader) (string, error) {
	line, err := r.ReadString('\n')
	if err != nil {
		return "", err
	}
	raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(line))
	return string(raw), err
}
```

Create `server/internal/emailhub/smtpclient/session_test.go`:

```go
package smtpclient

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/emailhub/netguard"
)

func testMessage() Message {
	return Message{To: []string{"dest@example.com"}, Subject: "Hi", BodyText: "Hello"}
}

func testCtx(t *testing.T) context.Context {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	t.Cleanup(cancel)
	return ctx
}

func TestProductionDialIsNetguarded(t *testing.T) {
	t.Parallel()
	_, err := prodDialTCP(testCtx(t), "tcp", "127.0.0.1:587")
	if !errors.Is(err, netguard.ErrHostNotAllowed) {
		t.Fatalf("production dial to loopback: want ErrHostNotAllowed, got %v", err)
	}
}

func TestSendImplicitTLSUsesUsernameOnlyForAuth(t *testing.T) {
	t.Parallel()
	f := newFakeSMTP(t, fakeSMTPConfig{implicitTLS: true})
	c := f.creds("") // "" means implicit TLS
	c.Username = "login-id"
	msgID, err := Send(testCtx(t), c, testMessage())
	if err != nil {
		t.Fatalf("send: %v", err)
	}
	got := f.seen()
	if len(got.authUsers) != 1 || got.authUsers[0] != "login-id" {
		t.Fatalf("AUTH user = %v, want [login-id]", got.authUsers)
	}
	if len(got.mailFrom) != 1 || got.mailFrom[0] != "user@example.com" {
		t.Fatalf("MAIL FROM = %v, want [user@example.com]", got.mailFrom)
	}
	if len(got.rcpts) != 1 || got.rcpts[0] != "dest@example.com" {
		t.Fatalf("RCPT = %v", got.rcpts)
	}
	if !strings.Contains(got.data, "From: user@example.com\r\n") {
		t.Fatalf("From header not the email address:\n%s", got.data)
	}
	if !strings.HasSuffix(msgID, "@example.com>") {
		t.Fatalf("message id %q not on the sender domain", msgID)
	}
}

func TestSendRequiredStartTLS(t *testing.T) {
	t.Parallel()
	f := newFakeSMTP(t, fakeSMTPConfig{startTLS: true})
	if _, err := Send(testCtx(t), f.creds("starttls"), testMessage()); err != nil {
		t.Fatalf("send: %v", err)
	}
	got := f.seen()
	if got.startTLS != 1 {
		t.Fatalf("STARTTLS upgrades = %d, want 1", got.startTLS)
	}
	if len(got.authUsers) != 1 || got.authUsers[0] != "user@example.com" {
		t.Fatalf("AUTH user = %v, want the email when Username is empty", got.authUsers)
	}
}

func TestStartTLSNotOfferedIsTLSRequired(t *testing.T) {
	t.Parallel()
	f := newFakeSMTP(t, fakeSMTPConfig{})
	err := VerifyLogin(f.creds("starttls"))
	if !errors.Is(err, ErrTLSRequired) {
		t.Fatalf("want ErrTLSRequired, got %v", err)
	}
	if got := f.seen(); len(got.authUsers) != 0 {
		t.Fatalf("credentials sent over plaintext: %v", got.authUsers)
	}
}

func TestUnknownSecurityModeRefusedBeforeDial(t *testing.T) {
	t.Parallel()
	err := VerifyLogin(Credentials{Host: "127.0.0.1", Port: 1, Email: "a@b.co", Password: "x", Security: "ssl"})
	if err == nil || !strings.Contains(err.Error(), "security") {
		t.Fatalf("want unknown security error, got %v", err)
	}
}

func TestLoginFallbackAfterPlainUnsupported(t *testing.T) {
	t.Parallel()
	f := newFakeSMTP(t, fakeSMTPConfig{
		implicitTLS: true, authMechs: "LOGIN",
		plainReply: "504 5.7.4 Unrecognized authentication type",
	})
	c := f.creds("tls")
	c.Username = "login-id"
	if _, err := Send(testCtx(t), c, testMessage()); err != nil {
		t.Fatalf("send: %v", err)
	}
	got := f.seen()
	if len(got.authUsers) != 1 || got.authUsers[0] != "login-id" {
		t.Fatalf("LOGIN user = %v, want [login-id]", got.authUsers)
	}
	if len(got.mailFrom) != 1 || got.mailFrom[0] != "user@example.com" {
		t.Fatalf("MAIL FROM = %v", got.mailFrom)
	}
}

func TestAuthErrorsAreClassified(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name         string
		cfg          fakeSMTPConfig
		wantAuth     bool
		wantDisabled bool
	}{
		{name: "535 bad credentials", cfg: fakeSMTPConfig{authReply: "535 5.7.8 Username and Password not accepted"}, wantAuth: true},
		{name: "534 app password required", cfg: fakeSMTPConfig{authReply: "534 5.7.9 Application-specific password required"}, wantAuth: true},
		{name: "m365 smtp auth disabled", cfg: fakeSMTPConfig{authReply: "535 5.7.139 Authentication unsuccessful, SmtpClientAuthentication is disabled for the Mailbox."}, wantDisabled: true},
		{name: "m365 5.7.139 bad credentials", cfg: fakeSMTPConfig{authReply: "535 5.7.139 Authentication unsuccessful, the request did not meet the criteria to be authenticated successfully."}, wantAuth: true},
		{name: "login fallback 535", cfg: fakeSMTPConfig{authMechs: "LOGIN", plainReply: "504 5.7.4 Unrecognized authentication type", authReply: "535 5.7.8 bad"}, wantAuth: true},
		{name: "454 temporary is not an auth failure", cfg: fakeSMTPConfig{authReply: "454 4.7.0 Temporary authentication failure"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			tc.cfg.implicitTLS = true
			f := newFakeSMTP(t, tc.cfg)
			err := VerifyLogin(f.creds("tls"))
			if err == nil {
				t.Fatal("want an auth error")
			}
			if errors.Is(err, ErrAuthFailed) != tc.wantAuth {
				t.Fatalf("ErrAuthFailed = %v, want %v (err %v)", errors.Is(err, ErrAuthFailed), tc.wantAuth, err)
			}
			if errors.Is(err, ErrSMTPAuthDisabled) != tc.wantDisabled {
				t.Fatalf("ErrSMTPAuthDisabled = %v, want %v (err %v)", errors.Is(err, ErrSMTPAuthDisabled), tc.wantDisabled, err)
			}
		})
	}
}

func TestSendTimesOutWithoutGreeting(t *testing.T) {
	t.Parallel()
	f := newFakeSMTP(t, fakeSMTPConfig{silent: true})
	ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancel()
	start := time.Now()
	_, err := Send(ctx, f.creds("starttls"), testMessage())
	if err == nil {
		t.Fatal("want a timeout error from a server that never greets")
	}
	if elapsed := time.Since(start); elapsed > 5*time.Second {
		t.Fatalf("greeting wait took %v; deadline not applied before smtp.NewClient", elapsed)
	}
}
```

Change `server/internal/emailhub/smtpclient/auth_test.go`. Replace `TestIsLocalhost` (lines 60-70) with:

```go
func TestLoginAuthRejectsPlaintextLocalhost(t *testing.T) {
	t.Parallel()
	auth := &loginAuth{host: "127.0.0.1"}
	if _, _, err := auth.Start(&smtp.ServerInfo{Name: "127.0.0.1", TLS: false}); err == nil {
		t.Fatal("expected unencrypted connection error even for loopback")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && go test ./internal/emailhub/smtpclient/ -count=1
```

Expected: build failure, with errors such as `undefined: dialTCP`, `undefined: tlsRootCAs`, `undefined: ErrTLSRequired`, `undefined: ErrAuthFailed`, `undefined: ErrSMTPAuthDisabled`, `unknown field Security in struct literal of type Credentials`, `c.Username undefined`. `TestLoginAuthRejectsPlaintextLocalhost` would also fail at runtime against the current `isLocalhost` exemption.

- [ ] **Step 3: Implement**

Replace `server/internal/emailhub/smtpclient/session.go` with:

```go
package smtpclient

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"net"
	"net/smtp"
	"net/textproto"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/unicomhub/uniwork/server/internal/emailhub/netguard"
)

const (
	dialTimeout    = 15 * time.Second
	sessionTimeout = 30 * time.Second
)

var (
	// ErrAuthFailed means the server rejected the credentials (535/534).
	ErrAuthFailed = errors.New("smtp authentication failed")
	// ErrSMTPAuthDisabled means the mailbox has SMTP AUTH turned off (M365); the credential may still be valid.
	ErrSMTPAuthDisabled = errors.New("smtp auth disabled for mailbox")
	// ErrTLSRequired means a starttls account's server does not offer STARTTLS.
	ErrTLSRequired = errors.New("smtp server does not offer STARTTLS")
)

// Only this package's tests replace these.
var (
	dialTCP    = netguard.Dial
	tlsRootCAs *x509.CertPool
)

func openSession(ctx context.Context, c Credentials) (*smtp.Client, error) {
	security := c.Security
	if security == "" {
		security = "tls"
	}
	if security != "tls" && security != "starttls" {
		return nil, fmt.Errorf("smtp: unknown security mode %q", security)
	}
	tlsCfg := &tls.Config{
		ServerName: c.Host,
		MinVersion: tls.VersionTLS12,
		RootCAs:    tlsRootCAs,
	}
	conn, err := dialTCP(ctx, "tcp", net.JoinHostPort(c.Host, strconv.Itoa(c.Port)))
	if err != nil {
		return nil, fmt.Errorf("smtp dial: %w", err)
	}

	// The deadline covers the greeting (and the implicit TLS handshake) that smtp.NewClient blocks on.
	deadline := time.Now().Add(sessionTimeout)
	if d, ok := ctx.Deadline(); ok && d.Before(deadline) {
		deadline = d
	}
	if err := conn.SetDeadline(deadline); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("smtp set deadline: %w", err)
	}
	if security == "tls" {
		conn = tls.Client(conn, tlsCfg)
	}

	client, err := smtp.NewClient(conn, c.Host)
	if err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("smtp client: %w", err)
	}
	if hostname, err := os.Hostname(); err == nil {
		hostname = strings.TrimSpace(hostname)
		if hostname != "" {
			if err := client.Hello(hostname); err != nil {
				_ = client.Close()
				return nil, fmt.Errorf("smtp ehlo: %w", err)
			}
		}
	}
	if security == "starttls" {
		if ok, _ := client.Extension("STARTTLS"); !ok {
			_ = client.Close()
			return nil, ErrTLSRequired
		}
		if err := client.StartTLS(tlsCfg); err != nil {
			_ = client.Close()
			return nil, fmt.Errorf("smtp starttls: %w", err)
		}
	}
	return client, nil
}

func authenticate(ctx context.Context, c Credentials) (*smtp.Client, error) {
	user := c.Username
	if user == "" {
		user = c.Email
	}
	client, err := openSession(ctx, c)
	if err != nil {
		return nil, err
	}
	fallback, authErr := smtpAuthWithFallback(client, c.Host, user, c.Password)
	if authErr != nil {
		_ = client.Close()
		if !fallback {
			return nil, fmt.Errorf("smtp auth: %w", classifyAuthErr(authErr))
		}
		client, err = openSession(ctx, c)
		if err != nil {
			return nil, fmt.Errorf("smtp auth: plain failed (%v); reconnect: %w", authErr, err)
		}
		if err = client.Auth(&loginAuth{username: user, password: c.Password, host: c.Host}); err != nil {
			_ = client.Close()
			return nil, fmt.Errorf("smtp auth: plain failed (%v); login: %w", authErr, classifyAuthErr(err))
		}
	}
	return client, nil
}

// classifyAuthErr matches M365's disabled-AUTH text, not its 5.7.139 code, which M365 also uses for bad credentials.
func classifyAuthErr(err error) error {
	var te *textproto.Error
	switch {
	case !errors.As(err, &te):
		return err
	case strings.Contains(te.Msg, "SmtpClientAuthentication is disabled"):
		return fmt.Errorf("%w: %w", ErrSMTPAuthDisabled, err)
	case te.Code == 535 || te.Code == 534:
		return fmt.Errorf("%w: %w", ErrAuthFailed, err)
	}
	return err
}
```

`server/internal/emailhub/smtpclient/send.go`. Credentials (lines 11-17):

```go
// Credentials for authenticated SMTP submission.
type Credentials struct {
	Host  string
	Port  int
	Email string // envelope sender, From header and Message-ID domain
	// Username is the AUTH login; empty means Email.
	Username string
	Password string
	// Security is "tls" (implicit TLS) or "starttls" (required); empty means "tls".
	Security string
}
```

VerifyLogin body (line 37):

```diff
-	client, err := authenticate(ctx, c.Host, c.Port, c.Email, c.Password)
+	client, err := authenticate(ctx, c)
```

Send doc comment (line 44) and authenticate call (line 60):

```diff
-// Send delivers a message via STARTTLS on the configured port (587 by default).
+// Send delivers a message over implicit TLS or required STARTTLS, per c.Security.
 func Send(ctx context.Context, c Credentials, msg Message) (string, error) {
@@
-	client, err := authenticate(ctx, c.Host, c.Port, c.Email, c.Password)
+	client, err := authenticate(ctx, c)
```

(`client.Mail(c.Email)`, `buildRaw(c.Email, ...)` and `newMessageID(c.Email)` stay unchanged.)

`server/internal/emailhub/smtpclient/auth.go`. Delete `isLocalhost` (lines 33-35) and tighten `loginAuth.Start`:

```diff
-func isLocalhost(name string) bool {
-	return name == "localhost" || name == "127.0.0.1" || name == "::1"
-}
-
 type loginAuth struct {
@@
 func (a *loginAuth) Start(server *smtp.ServerInfo) (string, []byte, error) {
-	if !server.TLS && !isLocalhost(server.Name) {
+	if !server.TLS {
 		return "", nil, errors.New("unencrypted connection")
 	}
```

`server/internal/service/email_hub.go`. Now that `""` means implicit TLS, the two existing callers must name STARTTLS explicitly. Without this, submission to the preset 587 hosts breaks.

```diff
 	if err := smtpclient.VerifyLogin(smtpclient.Credentials{
-		Host: prov.SMTPHost, Port: prov.SMTPPort, Email: email, Password: password,
+		// shortcut: every preset submits on 587 STARTTLS; the credentials seam task replaces this with acc.SmtpSecurity.
+		Host: prov.SMTPHost, Port: prov.SMTPPort, Email: email, Password: password, Security: "starttls",
 	}); err != nil {
@@
 	msgID, err := smtpclient.Send(ctx, smtpclient.Credentials{
-		Host: acc.SmtpHost, Port: int(acc.SmtpPort), Email: acc.EmailAddress, Password: password,
+		// shortcut: every connected account is a 587 STARTTLS preset; the credentials seam task replaces this with acc.SmtpSecurity.
+		Host: acc.SmtpHost, Port: int(acc.SmtpPort), Email: acc.EmailAddress, Password: password, Security: "starttls",
 	}, smtpclient.Message{
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd server && gofmt -l ./internal/emailhub/smtpclient ./internal/service
cd server && go vet ./internal/emailhub/smtpclient/ && go tool staticcheck ./internal/emailhub/smtpclient/
cd server && go test ./internal/emailhub/smtpclient/ -race -count=1
cd server && go build ./...
```

Expected: `gofmt -l` prints nothing. Vet and staticcheck are clean. Every smtpclient test passes, including the new ones and the existing `TestSendDialFailure` and `TestVerifyLoginUnreachable` (they dial `127.0.0.1:1` through the test dialer and still fail as intended). The whole server builds.

- [ ] **Step 5: Commit**

```bash
git add server/internal/emailhub/smtpclient/session.go server/internal/emailhub/smtpclient/send.go \
  server/internal/emailhub/smtpclient/auth.go server/internal/emailhub/smtpclient/auth_test.go \
  server/internal/emailhub/smtpclient/fake_server_test.go server/internal/emailhub/smtpclient/session_test.go \
  server/internal/service/email_hub.go
git commit -m "feat(email-hub): require TLS on SMTP and classify auth failures" \
  -m "Implicit TLS or required STARTTLS through netguard, a greeting deadline before smtp.NewClient, Username only for AUTH, and the ErrAuthFailed / ErrSMTPAuthDisabled / ErrTLSRequired sentinels, tested against a new fake SMTP server. The plaintext localhost exemption is gone. Service callers pin starttls until the credentials seam reads smtp_security; XOAUTH2 is left for GĐ3." \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
Not checked: I didn't compile or run any of this (the task was read-only). It assumes the netguard task lands first and that wrapping by `net.Dialer.Control` keeps `errors.Is(err, netguard.ErrHostNotAllowed)` working. The fake server's TLS cert is borrowed from `httptest`.
Risk: after this commit, any caller that leaves `Security` empty gets implicit TLS, so 587 STARTTLS hosts break. That is why both service call sites are pinned to `"starttls"` until the credentials-seam task switches them to `acc.SmtpSecurity`.

---

### Task 5: Service credentials seam, markAuthFailed, watcher and claim

**Files:**
- Modify: `server/internal/audit/actions.go:190-192`. Add `ActionEmailHubAccountAuthFailed` and reword the Disconnected comment.
- Modify: `server/internal/service/email_hub.go`. Imports (add `audit`), the error var block (lines 26-34), `Disconnect` (201-234), the `sendOutboundMail` credential/send block (441-454), and `syncMark*OnIMAP` (600, 617, 634).
- Modify: `server/internal/service/email_hub_folders.go`. Change lines 1-87 (`accountCredentials` becomes `emailHubCreds` + `credentials`; the open helpers take `ctx`) and `MoveThread` lines 118-134.
- Modify: `server/internal/service/email_hub_sync.go`. Change `syncAccount` (105-145), `syncSingleFolder` (285-326) and `WatchInbox` (401-412).
- Modify: `server/internal/service/email_hub_watcher.go`. Change `runHubWatchLoop` (191-211), replace `disconnectOnAuthFailure`/`disconnectRefusedAccount` (236-290) with `handleAuthError`/`markAuthFailed`, and change `waitInboxIDLE` (297-306).
- Modify (pass `ctx` to the open helpers): `server/internal/service/email_hub_body.go:170,214`, `server/internal/service/email_hub_imap_search.go:32`, `server/internal/service/email_hub_attachments.go:133`, `server/internal/service/email_hub_backfill.go:38`
- Test: `server/internal/service/email_hub_auth_failure_test.go` (full rewrite)
- Test: `server/internal/service/audit_coverage_test.go:1280-1288` (two rows), `:1421` (`auditActions()`)

**Interfaces:**
- Consumes. Task 1 (sqlc):
  - `db.EmailHubAccount{AuthKind, ImapSecurity, SmtpSecurity, Username, AuthFailedAt pgtype.Timestamptz, AuthFailedReason, CredentialVersion int64}`
  - `q.MarkEmailHubAccountAuthFailed(ctx, db.MarkEmailHubAccountAuthFailedParams{ID, OrganizationID, CredentialVersion, Reason}) (int64, error)`
  - `q.UpdateEmailHubAccountCredentials(ctx, db.UpdateEmailHubAccountCredentialsParams{...}) (db.EmailHubAccount, error)`
  - `ClaimEmailHubAccountsForSync` filtering `auth_failed_at IS NULL`
  - `seedEmailHubAccount` already filling the new Create params
- Consumes. Tasks 3 and 4:
  - `imapclient.Credentials{Host, Port, Email, Username, Password, Security}`
  - `smtpclient.Credentials{Host, Port, Email, Username, Password, Security}`
  - `smtpclient.ErrAuthFailed`, `smtpclient.ErrSMTPAuthDisabled`
- Produces:
  - `var ErrEmailHubReauthRequired = errors.New("email hub account needs reconnect")`
  - `type emailHubCreds struct{ IMAP imapclient.Credentials; SMTP smtpclient.Credentials; Version int64 }`
  - `func (s *EmailHubService) credentials(ctx context.Context, acc db.EmailHubAccount) (emailHubCreds, error)`
  - `func (s *EmailHubService) handleAuthError(ctx context.Context, acc db.EmailHubAccount, version int64, err error) bool`
  - `func (s *EmailHubService) markAuthFailed(ctx context.Context, acc db.EmailHubAccount, version int64, reason string) bool`
  - `func (s *EmailHubService) openIMAPInteractive(ctx context.Context, acc db.EmailHubAccount) (*imapclient.Session, imapclient.MailboxMap, error)`
  - `func (s *EmailHubService) openIMAPWithMailboxes(ctx context.Context, acc db.EmailHubAccount) (*imapclient.Session, imapclient.MailboxMap, error)`
  - `audit.ActionEmailHubAccountAuthFailed = "email_hub_account.auth_failed"`
  - `Disconnect` records `audit.ActionEmailHubAccountDisconnected` with the human actor.
- Removed: `accountCredentials`, `disconnectOnAuthFailure`, `disconnectRefusedAccount`.
- Left to later tasks (do not add here):
  - `ActionEmailHubAccountConnected` (Connect task)
  - `ErrEmailHubSMTPDisabled`, the `smtp_disabled`/`auth_required` scheduled-send reasons and the handler 409 mapping (needs_reconnect/API task)
  - the GetThread no-dial path

- [ ] **Step 1: Write the failing test**

Replace `server/internal/service/email_hub_auth_failure_test.go` entirely:

```go
package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/emailhub/imapclient"
	"github.com/unicomhub/uniwork/server/internal/emailhub/smtpclient"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// countingHandler counts log records whose message contains match.
type countingHandler struct {
	match string
	n     *atomic.Int32
}

func (h countingHandler) Enabled(context.Context, slog.Level) bool { return true }
func (h countingHandler) WithAttrs([]slog.Attr) slog.Handler       { return h }
func (h countingHandler) WithGroup(string) slog.Handler            { return h }
func (h countingHandler) Handle(_ context.Context, r slog.Record) error {
	if strings.Contains(r.Message, h.match) {
		h.n.Add(1)
	}
	return nil
}

func emailHubCount(t *testing.T, pool *pgxpool.Pool, query string, args ...any) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), query, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

const emailHubInboxChangedFor = `SELECT count(*) FROM outbox_events
	WHERE topic = 'email_hub.inbox_changed' AND payload::jsonb->>'account_id' = $1`

func TestEmailHubWatchLoopBacksOffAfterIMAPFailures(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	// The seeded account points at 127.0.0.1:1, so every IDLE attempt fails at once.
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	var failures atomic.Int32
	svc.log = slog.New(countingHandler{match: "watcher idle failed", n: &failures})
	svc.hubWatch.lastSeen[acc.ID] = time.Now() // a live client lease, so only backoff paces the loop

	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	svc.runHubWatchLoop(ctx, acc.ID)

	if n := failures.Load(); n > 2 {
		t.Fatalf("expected at most 2 IMAP attempts in 1s, got %d", n)
	}
	if svc.gov.isWatching(acc.ID) {
		t.Fatal("the loop must release its watch on exit")
	}
}

func TestEmailHubCredentialsOpenTheStoredPassword(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)

	creds, err := svc.credentials(context.Background(), acc)
	if err != nil {
		t.Fatal(err)
	}
	if creds.IMAP.Password != "app-password" || creds.SMTP.Password != "app-password" {
		t.Fatal("both protocols must carry the opened app password")
	}
	if creds.IMAP.Host != acc.ImapHost || creds.IMAP.Port != int(acc.ImapPort) ||
		creds.IMAP.Security != acc.ImapSecurity || creds.IMAP.Email != acc.EmailAddress || creds.IMAP.Username != acc.Username {
		t.Fatalf("imap credentials do not mirror the row: %+v", creds.IMAP)
	}
	if creds.SMTP.Host != acc.SmtpHost || creds.SMTP.Port != int(acc.SmtpPort) ||
		creds.SMTP.Security != acc.SmtpSecurity || creds.SMTP.Email != acc.EmailAddress || creds.SMTP.Username != acc.Username {
		t.Fatalf("smtp credentials do not mirror the row: %+v", creds.SMTP)
	}
	if creds.Version != acc.CredentialVersion {
		t.Fatalf("snapshot version %d, row %d", creds.Version, acc.CredentialVersion)
	}
}

func TestEmailHubAuthFailureMarksTheAccountAndKeepsItsMail(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	seedEmailHubThread(t, q, acc.ID, ws.OrganizationID)
	root, stopRoot := context.WithCancel(ctx)
	defer stopRoot()
	svc.hubWatch.setRoot(root)
	if err := svc.SubscribeInboxWatch(ctx, Human(user.ID), ws.ID, acc.ID); err != nil {
		t.Fatal(err)
	}

	refused := fmt.Errorf("imap login: %w", imapclient.ErrAuthFailed)
	if svc.handleAuthError(ctx, acc, acc.CredentialVersion, errors.New("imap dial: connection refused")) {
		t.Fatal("a network error is not a bad credential")
	}
	if !svc.handleAuthError(ctx, acc, acc.CredentialVersion, refused) {
		t.Fatal("AUTHENTICATIONFAILED must mark the account")
	}
	if svc.handleAuthError(ctx, acc, acc.CredentialVersion, refused) {
		t.Fatal("an account already marked is not marked again")
	}

	row, err := q.GetEmailHubAccountByID(ctx, acc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !row.AuthFailedAt.Valid || row.AuthFailedReason != "imap_auth_failed" {
		t.Fatalf("expected auth_failed_at with imap_auth_failed, got valid=%v reason=%q", row.AuthFailedAt.Valid, row.AuthFailedReason)
	}
	if row.DisconnectedAt.Valid {
		t.Fatal("an auth failure asks for a reconnect; it does not disconnect")
	}
	if row.PasswordEnc != "" {
		t.Fatal("the refused credential must be dropped")
	}
	if n := emailHubCount(t, pool, `SELECT count(*) FROM email_hub_threads WHERE account_id = $1`, acc.ID); n != 1 {
		t.Fatalf("cached mail must survive an auth failure, %d threads left", n)
	}
	claimed, err := q.ClaimEmailHubAccountsForSync(ctx, 100)
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range claimed {
		if c.ID == acc.ID {
			t.Fatal("the background worker must not pick an account that needs reconnect")
		}
	}
	if n := emailHubCount(t, pool, `SELECT count(*) FROM audit_events
		WHERE action = $1 AND resource_id = $2 AND actor_kind = 'system'`,
		audit.ActionEmailHubAccountAuthFailed, acc.ID); n != 1 {
		t.Fatalf("expected one system auth_failed audit row, got %d", n)
	}
	if n := emailHubCount(t, pool, `SELECT count(*) FROM audit_events WHERE action = $1 AND resource_id = $2`,
		audit.ActionEmailHubAccountDisconnected, acc.ID); n != 0 {
		t.Fatalf("an auth failure must not audit a disconnect, got %d", n)
	}
	if n := emailHubCount(t, pool, emailHubInboxChangedFor, acc.ID); n != 1 {
		t.Fatalf("the open client must hear about it, got %d inbox_changed events", n)
	}
	waitWatchStopped(t, svc, acc.ID)
	svc.hubWatch.mu.Lock()
	_, leased := svc.hubWatch.lastSeen[acc.ID]
	svc.hubWatch.mu.Unlock()
	if leased {
		t.Fatal("the watcher must drop its subscription")
	}

	if _, err := svc.credentials(ctx, row); !errors.Is(err, ErrEmailHubReauthRequired) {
		t.Fatalf("credentials of a marked account: want ErrEmailHubReauthRequired, got %v", err)
	}
	if _, _, err := svc.syncSingleFolder(ctx, row, emailHubFolderInbox, false, true, false, true); !errors.Is(err, ErrEmailHubReauthRequired) {
		t.Fatalf("a sync must stop before dialing, got %v", err)
	}
}

func TestEmailHubStaleCredentialVersionDoesNotMarkTheAccount(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	stale := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	root, stopRoot := context.WithCancel(ctx)
	defer stopRoot()
	svc.hubWatch.setRoot(root)
	if err := svc.SubscribeInboxWatch(ctx, Human(user.ID), ws.ID, stale.ID); err != nil {
		t.Fatal(err)
	}
	// The owner reconnects while an operation still holds the old snapshot.
	fresh, err := q.UpdateEmailHubAccountCredentials(ctx, db.UpdateEmailHubAccountCredentialsParams{
		ID: stale.ID, OrganizationID: stale.OrganizationID, Provider: stale.Provider,
		ImapHost: stale.ImapHost, ImapPort: stale.ImapPort, ImapSecurity: stale.ImapSecurity,
		SmtpHost: stale.SmtpHost, SmtpPort: stale.SmtpPort, SmtpSecurity: stale.SmtpSecurity,
		Username: stale.Username, AuthKind: stale.AuthKind, PasswordEnc: stale.PasswordEnc,
	})
	if err != nil {
		t.Fatal(err)
	}
	if fresh.CredentialVersion <= stale.CredentialVersion {
		t.Fatalf("a reconnect must bump credential_version: %d -> %d", stale.CredentialVersion, fresh.CredentialVersion)
	}

	if svc.handleAuthError(ctx, stale, stale.CredentialVersion, fmt.Errorf("imap login: %w", imapclient.ErrAuthFailed)) {
		t.Fatal("a failure seen with the replaced credential must not mark the reconnected account")
	}
	row, err := q.GetEmailHubAccountByID(ctx, stale.ID)
	if err != nil {
		t.Fatal(err)
	}
	if row.AuthFailedAt.Valid || row.PasswordEnc != fresh.PasswordEnc {
		t.Fatal("the new credential must stay untouched")
	}
	if n := emailHubCount(t, pool, `SELECT count(*) FROM audit_events WHERE action = $1 AND resource_id = $2`,
		audit.ActionEmailHubAccountAuthFailed, stale.ID); n != 0 {
		t.Fatalf("a stale failure writes no audit row, got %d", n)
	}
	if n := emailHubCount(t, pool, emailHubInboxChangedFor, stale.ID); n != 0 {
		t.Fatalf("a stale failure emits nothing, got %d events", n)
	}
	svc.hubWatch.mu.Lock()
	_, running := svc.hubWatch.stop[stale.ID]
	svc.hubWatch.mu.Unlock()
	if !running {
		t.Fatal("the watcher belongs to the new credential and must keep running")
	}
}

// A bare NO to LOGIN is also how a throttling provider answers, so it must repeat.
func TestEmailHubBareLoginRefusalMarksOnlyWhenItRepeats(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	seedEmailHubThread(t, q, acc.ID, ws.OrganizationID)
	refused := fmt.Errorf("imap login: %w", imapclient.ErrLoginRefused)

	for i := range emailHubRefusedLoginsBeforeDisconnect - 1 {
		if svc.handleAuthError(ctx, acc, acc.CredentialVersion, refused) {
			t.Fatalf("refusal %d must not mark the account", i+1)
		}
	}
	svc.gov.loginSucceeded(acc.ID) // a good LOGIN in between restarts the run
	for i := range emailHubRefusedLoginsBeforeDisconnect - 1 {
		if svc.handleAuthError(ctx, acc, acc.CredentialVersion, refused) {
			t.Fatalf("refusal %d after a good login must not mark the account", i+1)
		}
	}
	if row, err := q.GetEmailHubAccountByID(ctx, acc.ID); err != nil || row.AuthFailedAt.Valid {
		t.Fatalf("account must stay active, err=%v", err)
	}

	if !svc.handleAuthError(ctx, acc, acc.CredentialVersion, refused) {
		t.Fatalf("refusal %d in a row must mark the account", emailHubRefusedLoginsBeforeDisconnect)
	}
	row, err := q.GetEmailHubAccountByID(ctx, acc.ID)
	if err != nil || !row.AuthFailedAt.Valid || row.AuthFailedReason != "imap_login_refused" {
		t.Fatalf("expected imap_login_refused, err=%v reason=%q", err, row.AuthFailedReason)
	}
	if n := emailHubCount(t, pool, `SELECT count(*) FROM email_hub_threads WHERE account_id = $1`, acc.ID); n == 0 {
		t.Fatal("cached mail must survive")
	}
	if n := emailHubCount(t, pool, emailHubInboxChangedFor, acc.ID); n != 1 {
		t.Fatalf("the open client must hear about it, got %d inbox_changed events", n)
	}
}

func TestEmailHubSMTPAuthFailureMarksButDisabledSMTPDoesNot(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)

	if svc.handleAuthError(ctx, acc, acc.CredentialVersion, fmt.Errorf("smtp auth: %w", smtpclient.ErrSMTPAuthDisabled)) {
		t.Fatal("SMTP AUTH switched off for the mailbox is not a bad credential")
	}
	if !svc.handleAuthError(ctx, acc, acc.CredentialVersion, fmt.Errorf("smtp auth: %w", smtpclient.ErrAuthFailed)) {
		t.Fatal("a 535 must mark the account")
	}
	row, err := q.GetEmailHubAccountByID(ctx, acc.ID)
	if err != nil || !row.AuthFailedAt.Valid || row.AuthFailedReason != "smtp_auth_failed" {
		t.Fatalf("expected smtp_auth_failed, err=%v reason=%q", err, row.AuthFailedReason)
	}
}

func TestEmailHubWatchLoopExitsOnceTheAccountNeedsReconnect(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	if n, err := q.MarkEmailHubAccountAuthFailed(ctx, db.MarkEmailHubAccountAuthFailedParams{
		ID: acc.ID, OrganizationID: acc.OrganizationID, CredentialVersion: acc.CredentialVersion, Reason: "imap_auth_failed",
	}); err != nil || n != 1 {
		t.Fatalf("mark: n=%d err=%v", n, err)
	}
	var attempts atomic.Int32
	svc.log = slog.New(countingHandler{match: "watcher idle failed", n: &attempts})
	svc.hubWatch.lastSeen[acc.ID] = time.Now()

	loopCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	start := time.Now()
	svc.runHubWatchLoop(loopCtx, acc.ID)
	if time.Since(start) > time.Second {
		t.Fatal("the loop must end at once for an account that needs reconnect")
	}
	if n := attempts.Load(); n != 0 {
		t.Fatalf("no IDLE attempt may be made, got %d", n)
	}
	if svc.gov.isWatching(acc.ID) {
		t.Fatal("the loop must release its watch on exit")
	}
}

func TestEmailHubDisconnectAuditsTheOwner(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)

	if err := svc.Disconnect(ctx, Human(user.ID), ws.ID, acc.ID); err != nil {
		t.Fatal(err)
	}
	if err := svc.Disconnect(ctx, Human(user.ID), ws.ID, acc.ID); err != nil {
		t.Fatalf("a repeated disconnect stays a no-op, got %v", err)
	}
	if n := emailHubCount(t, pool, `SELECT count(*) FROM audit_events
		WHERE action = $1 AND resource_id = $2 AND actor_kind = $3 AND actor_id = $4`,
		audit.ActionEmailHubAccountDisconnected, acc.ID, string(audit.KindHuman), user.ID); n != 1 {
		t.Fatalf("expected one human disconnect audit row, got %d", n)
	}
}
```

In `server/internal/service/audit_coverage_test.go`, replace the row at 1280-1288 with the two rows below:

```go
		// The owner disconnects the mailbox (UNI-1237: an auth failure no longer does).
		audit.ActionEmailHubAccountDisconnected: func(t *testing.T, f *auditFixture) {
			workspace := f.build(t)
			svc := NewEmailHubService(f.q, f.ws, testEmailHubBox(t))
			acc := seedEmailHubAccount(t, f.q, svc.box, f.owner.ID, f.orgID)
			if err := svc.Disconnect(f.ctx, Human(f.owner.ID), workspace.ID, acc.ID); err != nil {
				t.Fatal(err)
			}
		},
		// UNI-1237: the provider refused the mailbox's credential; it needs reconnect.
		audit.ActionEmailHubAccountAuthFailed: func(t *testing.T, f *auditFixture) {
			f.build(t)
			svc := NewEmailHubService(f.q, f.ws, testEmailHubBox(t))
			acc := seedEmailHubAccount(t, f.q, svc.box, f.owner.ID, f.orgID)
			if !svc.handleAuthError(f.ctx, acc, acc.CredentialVersion, imapclient.ErrAuthFailed) {
				t.Fatal("expected the account to be marked needs-reconnect")
			}
		},
```

In `auditActions()` (line 1421), directly after `audit.ActionEmailHubAccountDisconnected,`, add:

```go
		audit.ActionEmailHubAccountAuthFailed,
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' go test ./internal/service/ -run 'TestEmailHub(Credentials|AuthFailure|StaleCredential|BareLogin|SMTPAuth|WatchLoop|DisconnectAudits)|TestEveryAuditedCommandWritesItsRow' -count=1
```

Expected: the build fails with `svc.credentials undefined`, `svc.handleAuthError undefined`, `undefined: ErrEmailHubReauthRequired` and `undefined: audit.ActionEmailHubAccountAuthFailed`.

- [ ] **Step 3: Implement**

`server/internal/audit/actions.go`: replace lines 190-192 with:

```go
	// Email Hub (UNI-1237): the owner disconnects a mailbox (cache dropped);
	// a mailbox whose provider refused its credential is marked needs-reconnect
	// instead (cache kept), so no node keeps retrying a revoked password.
	ActionEmailHubAccountDisconnected = "email_hub_account.disconnected"
	ActionEmailHubAccountAuthFailed   = "email_hub_account.auth_failed"
```

`server/internal/service/email_hub.go`:

1. In the import block, add `"github.com/unicomhub/uniwork/server/internal/audit"`.
2. In the error var block, add the following after `ErrEmailHubSendFailed`:

```go
	// ErrEmailHubReauthRequired: the mailbox's credential was refused; only a
	// reconnect by the owner brings it back.
	ErrEmailHubReauthRequired = errors.New("email hub account needs reconnect")
```

3. Replace the body of `Disconnect` from the first `n, err := s.q.DisconnectEmailHubAccount(` down to `if n == 0 {` with the code below. Keep the comment block above it and the `if n == 0 { ... }` block after it unchanged.

```go
	tx, err := s.ws.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)
	n, err := qtx.DisconnectEmailHubAccount(ctx, db.DisconnectEmailHubAccountParams{
		ID: accountID, UserID: actor.ID, OrganizationID: ws.OrganizationID,
	})
	if err != nil {
		return err
	}
	if n > 0 {
		if err := auditRecorder.Record(ctx, qtx, audit.Entry{
			OrganizationID: ws.OrganizationID,
			Actor:          actor,
			Action:         audit.ActionEmailHubAccountDisconnected,
			ResourceType:   "email_hub_account",
			ResourceID:     accountID,
		}); err != nil {
			return err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	if n == 0 {
```

4. In `sendOutboundMail`, replace lines 441-454 (from `password, err := s.openPassword(...)` to the `ErrEmailHubSendFailed` return) with:

```go
	creds, err := s.credentials(ctx, acc)
	if err != nil {
		return EmailHubThreadView{}, err
	}
	msgID, err := smtpclient.Send(ctx, creds.SMTP, smtpclient.Message{
		To: to, Cc: cleanEmailList(in.Cc), Bcc: cleanEmailList(in.Bcc), Subject: subject,
		BodyText: body, BodyHTML: bodyHTML, Attachments: attachments, InReplyTo: inReplyTo, References: references,
	})
	if err != nil {
		if s.handleAuthError(ctx, acc, creds.Version, err) {
			return EmailHubThreadView{}, ErrEmailHubReauthRequired
		}
		s.log.Warn("email hub send failed", "account_id", acc.ID, "err", err)
		return EmailHubThreadView{}, fmt.Errorf("%w: %v", ErrEmailHubSendFailed, err)
	}
```

5. In `syncMarkUnreadOnIMAP`, `syncMarkReadOnIMAP` and `syncMarkStarredOnIMAP`, change `s.openIMAPWithMailboxes(acc)` to `s.openIMAPWithMailboxes(context.Background(), acc)`. These run detached from the request.

`server/internal/service/email_hub_folders.go`: replace lines 1-87 (imports through the end of `openIMAPWithMailboxes`) with:

```go
package service

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/emailhub"
	"github.com/unicomhub/uniwork/server/internal/emailhub/imapclient"
	"github.com/unicomhub/uniwork/server/internal/emailhub/smtpclient"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	emailHubFolderInbox = emailhub.FolderInbox
	emailHubFolderSent  = emailhub.FolderSent
)

func normalizeEmailHubFolder(folder string) string {
	if folder == "" {
		return emailHubFolderInbox
	}
	return folder
}

// emailHubCreds is one snapshot of a mailbox credential. Version is the
// credential_version it was read at; every auth-failure write compares it.
type emailHubCreds struct {
	IMAP    imapclient.Credentials
	SMTP    smtpclient.Credentials
	Version int64
}

// credentials is the one place a mailbox credential is opened. An account
// that needs reconnect answers ErrEmailHubReauthRequired before any dial.
func (s *EmailHubService) credentials(_ context.Context, acc db.EmailHubAccount) (emailHubCreds, error) {
	if acc.AuthFailedAt.Valid {
		return emailHubCreds{}, ErrEmailHubReauthRequired
	}
	password, err := s.openPassword(acc.PasswordEnc)
	if err != nil {
		return emailHubCreds{}, err
	}
	return emailHubCreds{
		IMAP: imapclient.Credentials{
			Host: acc.ImapHost, Port: int(acc.ImapPort), Email: acc.EmailAddress,
			Username: acc.Username, Password: password, Security: acc.ImapSecurity,
		},
		SMTP: smtpclient.Credentials{
			Host: acc.SmtpHost, Port: int(acc.SmtpPort), Email: acc.EmailAddress,
			Username: acc.Username, Password: password, Security: acc.SmtpSecurity,
		},
		Version: acc.CredentialVersion,
	}, nil
}

func (s *EmailHubService) mailboxFor(acc db.EmailHubAccount, logicalFolder string) string {
	if m, ok := s.gov.mailboxes(acc.ID); ok {
		return m.Resolve(logicalFolder)
	}
	return emailhub.MailboxName(acc.Provider, logicalFolder)
}

func (s *EmailHubService) openIMAPInteractive(ctx context.Context, acc db.EmailHubAccount) (*imapclient.Session, imapclient.MailboxMap, error) {
	return s.openIMAPMailboxes(ctx, acc, imapclient.OpenSessionInteractive)
}

func (s *EmailHubService) openIMAPWithMailboxes(ctx context.Context, acc db.EmailHubAccount) (*imapclient.Session, imapclient.MailboxMap, error) {
	return s.openIMAPMailboxes(ctx, acc, imapclient.OpenSession)
}

func (s *EmailHubService) openIMAPMailboxes(
	ctx context.Context, acc db.EmailHubAccount, open func(imapclient.Credentials) (*imapclient.Session, error),
) (*imapclient.Session, imapclient.MailboxMap, error) {
	creds, err := s.credentials(ctx, acc)
	if err != nil {
		return nil, nil, err
	}
	sess, err := open(creds.IMAP)
	if err != nil {
		if s.handleAuthError(ctx, acc, creds.Version, err) {
			err = ErrEmailHubReauthRequired
		}
		return nil, nil, err
	}
	defaults := imapclient.MailboxMap(emailhub.DefaultMailboxMap(acc.Provider))
	if cached, ok := s.gov.mailboxes(acc.ID); ok {
		return sess, cached, nil
	}
	mailboxes, listErr := sess.MailboxMap(defaults)
	if listErr != nil {
		s.log.Warn("email hub list mailboxes failed", "account_id", acc.ID, "err", listErr)
		return sess, defaults, nil
	}
	s.gov.setMailboxes(acc.ID, mailboxes)
	return sess, mailboxes, nil
}
```

Then make two changes in `MoveThread`:
- Replace `creds, _, err := s.accountCredentials(acc)` with `creds, err := s.credentials(ctx, acc)`.
- Replace the move loop's error branch with:

```go
		if err := imapclient.MoveMessage(creds.IMAP, s.mailboxFor(acc, r.Folder), uint32(r.ImapUid), toMailbox); err != nil {
			if s.handleAuthError(ctx, acc, creds.Version, err) {
				return ErrEmailHubReauthRequired
			}
			s.log.Warn("email hub move failed", "thread_id", r.ID, "target", targetFolder, "err", err)
			return err
		}
```

Pass `ctx` to the open helpers in their remaining callers:
- `server/internal/service/email_hub_body.go:170`: `s.openIMAPWithMailboxes(ctx, acc)`
- `server/internal/service/email_hub_body.go:214`: `s.openIMAPInteractive(ctx, acc)`
- `server/internal/service/email_hub_imap_search.go:32`: `s.openIMAPInteractive(ctx, acc)`
- `server/internal/service/email_hub_attachments.go:133`: `s.openIMAPInteractive(ctx, acc)`
- `server/internal/service/email_hub_backfill.go:38`: `s.openIMAPInteractive(ctx, acc)`

`server/internal/service/email_hub_sync.go`:

`syncAccount`: replace lines 105-145 (from `state := parseEmailHubSyncState(acc.SyncState)` through the closing `}` of the `withIMAP` error branch) with:

```go
	state := parseEmailHubSyncState(acc.SyncState)
	creds, err := s.credentials(ctx, acc)
	if err != nil {
		return false, 0, err
	}
	var lastErr error
	inboxOK := false
	newUnread := 0
	if err := s.gov.withIMAP(acc.ID, func() error {
		sess, err := imapclient.OpenSession(creds.IMAP)
		if err != nil {
			return err
		}
		defer sess.Close()

		defaults := imapclient.MailboxMap(emailhub.DefaultMailboxMap(acc.Provider))
		mailboxes, listErr := sess.MailboxMap(defaults)
		if listErr != nil {
			s.log.Warn("email hub list mailboxes failed", "account_id", acc.ID, "err", listErr)
			mailboxes = defaults
		}
		s.gov.setMailboxes(acc.ID, mailboxes)

		for _, folder := range emailhub.SyncableFolders() {
			var folderErr error
			var folderNewUnread int
			state, folderNewUnread, folderErr = s.syncAccountFolderSession(ctx, acc, folder, state, reconcile, sess, mailboxes)
			if folderErr != nil {
				s.log.Warn("email hub folder sync failed", "account_id", acc.ID, "folder", folder, "err", folderErr)
				lastErr = folderErr
				continue
			}
			if folder == emailHubFolderInbox {
				inboxOK = true
				newUnread += folderNewUnread
			}
		}
		return nil
	}); err != nil {
		if s.handleAuthError(ctx, acc, creds.Version, err) {
			err = ErrEmailHubReauthRequired
		}
		return false, 0, err
	}
	s.gov.loginSucceeded(acc.ID)
```

Leave the later `raw, err := json.Marshal(state)` as it is: `raw` is new there, so `:=` still compiles.

`syncSingleFolder`: replace lines 285-326 (from `defer release()` through `s.gov.loginSucceeded(acc.ID)`) with:

```go
	defer release()

	creds, err := s.credentials(ctx, acc)
	if err != nil {
		return false, 0, err
	}
	newUnread := 0
	runSync := func() error {
		sess, err := imapclient.OpenSession(creds.IMAP)
		if err != nil {
			return err
		}
		defer sess.Close()

		mailboxes, ok := s.gov.mailboxes(acc.ID)
		if !ok {
			defaults := imapclient.MailboxMap(emailhub.DefaultMailboxMap(acc.Provider))
			var listErr error
			mailboxes, listErr = sess.MailboxMap(defaults)
			if listErr != nil {
				s.log.Warn("email hub list mailboxes failed", "account_id", acc.ID, "err", listErr)
				mailboxes = defaults
			}
			s.gov.setMailboxes(acc.ID, mailboxes)
		}

		var syncErr error
		state, newUnread, syncErr = s.syncAccountFolderSession(ctx, acc, logicalFolder, state, reconcile, sess, mailboxes)
		return syncErr
	}
	if blockIMAP {
		err = s.gov.withIMAP(acc.ID, runSync)
	} else if !s.gov.tryWithIMAP(acc.ID, func() error { err = runSync(); return err }) {
		s.log.Debug("email hub sync deferred", "account_id", acc.ID, "folder", logicalFolder, "reason", "imap_busy")
		return false, 0, nil
	}
	if err != nil {
		if s.handleAuthError(ctx, acc, creds.Version, err) {
			err = ErrEmailHubReauthRequired
		}
		return false, 0, err
	}
	s.gov.loginSucceeded(acc.ID)
```

Leave the `raw, err := json.Marshal(state)` that follows as it is (`raw` is new there).

`WatchInbox`: replace lines 404-411 with:

```go
	creds, err := s.credentials(ctx, acc)
	if err != nil {
		return false, err
	}
	sess, err := imapclient.OpenSessionIdle(creds.IMAP)
	if err != nil {
		if s.handleAuthError(ctx, acc, creds.Version, err) {
			err = ErrEmailHubReauthRequired
		}
		return false, err
	}
```

`server/internal/service/email_hub_watcher.go`:

1. In the import block, add `"github.com/unicomhub/uniwork/server/internal/emailhub/smtpclient"`.
2. In `runHubWatchLoop`, replace lines 191-211 with:

```go
		if acc.DisconnectedAt.Valid || acc.AuthFailedAt.Valid {
			return
		}
		changed, err := s.waitInboxIDLE(ctx, acc)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			if isEmailHubWatchRoundEnd(err) {
				backoff = emailHubWatchBackoffMin
				s.gov.loginSucceeded(accountID)
				continue
			}
			if errors.Is(err, ErrEmailHubReauthRequired) {
				return
			}
			s.log.Warn("email hub watcher idle failed", "account_id", accountID, "err", err)
			if !retry() {
				return
			}
			continue
		}
```

3. Replace lines 236-290 (the constant, `disconnectOnAuthFailure` and `disconnectRefusedAccount`) with:

```go
// emailHubRefusedLoginsBeforeDisconnect is how many bare-NO LOGINs in a row
// count as a revoked password; the watcher backoff spaces them out.
const emailHubRefusedLoginsBeforeDisconnect = 3

// handleAuthError marks acc needs-reconnect when err says the provider refused
// the credential read at version, so no node keeps retrying it. It reports
// whether it did; network errors, timeouts and busy servers stay transient.
func (s *EmailHubService) handleAuthError(ctx context.Context, acc db.EmailHubAccount, version int64, err error) bool {
	var reason string
	switch {
	case errors.Is(err, imapclient.ErrAuthFailed):
		reason = "imap_auth_failed"
	case errors.Is(err, imapclient.ErrLoginRefused):
		if s.gov.loginRefused(acc.ID) < emailHubRefusedLoginsBeforeDisconnect {
			return false
		}
		reason = "imap_login_refused"
	case errors.Is(err, smtpclient.ErrAuthFailed):
		reason = "smtp_auth_failed"
	default:
		return false
	}
	return s.markAuthFailed(ctx, acc, version, reason)
}

// markAuthFailed records that the credential at version was refused, keeping
// the cached mail for the reconnect onto the same id. Zero rows means a
// reconnect, a disconnect or another node got there first; the watcher running
// now belongs to that newer state, so nothing else happens.
func (s *EmailHubService) markAuthFailed(ctx context.Context, acc db.EmailHubAccount, version int64, reason string) bool {
	tx, err := s.ws.pool.Begin(ctx)
	if err != nil {
		s.log.Warn("email hub mark auth failed", "account_id", acc.ID, "err", err)
		return false
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)
	n, err := qtx.MarkEmailHubAccountAuthFailed(ctx, db.MarkEmailHubAccountAuthFailedParams{
		ID: acc.ID, OrganizationID: acc.OrganizationID, CredentialVersion: version, Reason: reason,
	})
	if err != nil {
		s.log.Warn("email hub mark auth failed", "account_id", acc.ID, "err", err)
		return false
	}
	if n == 0 {
		return false
	}
	if err := auditRecorder.Record(ctx, qtx, audit.Entry{
		OrganizationID: acc.OrganizationID,
		Actor:          audit.System("email-hub"),
		Action:         audit.ActionEmailHubAccountAuthFailed,
		ResourceType:   "email_hub_account",
		ResourceID:     acc.ID,
		Metadata:       map[string]any{"reason": reason},
	}, audit.Event{
		Topic:   "email_hub.inbox_changed",
		Version: 1,
		Payload: map[string]string{"account_id": acc.ID, "user_id": acc.UserID},
	}); err != nil {
		s.log.Warn("email hub mark auth failed", "account_id", acc.ID, "err", err)
		return false
	}
	if err := tx.Commit(ctx); err != nil {
		s.log.Warn("email hub mark auth failed", "account_id", acc.ID, "err", err)
		return false
	}
	s.log.Warn("email hub account needs reconnect", "account_id", acc.ID, "reason", reason)
	s.hubWatch.forceStop(acc.ID) // last: it may cancel ctx when the watcher calls us
	return true
}
```

4. In `waitInboxIDLE`, replace lines 298-305 with:

```go
	creds, err := s.credentials(ctx, acc)
	if err != nil {
		return false, err
	}
	sess, err := imapclient.OpenSessionIdle(creds.IMAP)
	if err != nil {
		if s.handleAuthError(ctx, acc, creds.Version, err) {
			err = ErrEmailHubReauthRequired
		}
		return false, err
	}
```

Check that nothing still references the removed functions:

```bash
cd server && grep -rn "accountCredentials\|disconnectOnAuthFailure\|disconnectRefusedAccount" internal/ ; test $? -eq 1
```

- [ ] **Step 4: Run tests to verify pass**

```bash
cd server && gofmt -l internal/ && go build ./... && go vet ./internal/service/ ./internal/audit/ && go tool staticcheck ./internal/service/ ./internal/audit/
cd server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' go test ./internal/service/ -run 'TestEmailHub|TestEveryAuditedCommandWritesItsRow' -count=1 -race
cd server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' go test ./internal/handler/ -run 'EmailHub|TestIsolationMatrix' -count=1
cd server && go test ./internal/ -run 'TestActorConstructedOnlyInService|TestArch' -count=1
```

Expected: `gofmt -l` prints nothing and every package reports `ok`.

- [ ] **Step 5: Commit**

```bash
git add server/internal/audit/actions.go server/internal/service/email_hub.go server/internal/service/email_hub_folders.go server/internal/service/email_hub_sync.go server/internal/service/email_hub_watcher.go server/internal/service/email_hub_body.go server/internal/service/email_hub_imap_search.go server/internal/service/email_hub_attachments.go server/internal/service/email_hub_backfill.go server/internal/service/email_hub_auth_failure_test.go server/internal/service/audit_coverage_test.go
git commit -m "fix(email-hub): mark a refused mailbox needs-reconnect instead of disconnecting it

A refused IMAP/SMTP credential now sets auth_failed_at through one
credentials() seam and handleAuthError at every session open. The write is
guarded by credential_version and audited as email_hub_account.auth_failed.
Cached mail, attachments and summaries are kept for the reconnect. The
owner's own Disconnect now audits email_hub_account.disconnected with the
human actor, because it is the only remaining writer of that action. Left
out: SMTP-disabled mapping, scheduled-send reasons, handler 409 and the
GetThread no-dial path (later GD1 tasks).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
Notes for the orchestrator:
- **Two deviations from the contract.** (1) `markAuthFailed` emits `email_hub.inbox_changed` inside the audit transaction through `Record(..., audit.Event)`, because spec §3 step 3 says so; the contract had it as a call to `emitInboxChanged` after commit. (2) This task owns the user-`Disconnect` audit. Removing `disconnectOnAuthFailure` would otherwise turn the audit coverage row for `disconnected` red.
- **Not tested here, and not compiled.** The SMTP 535 path inside `sendOutboundMail` has no test: netguard blocks loopback, and the smtpclient dial hook is unexported. The plan assumes three things from Tasks 1, 3 and 4: the generated sqlc field names, an updated `seedEmailHubAccount`, and `smtpclient.ErrAuthFailed`/`ErrSMTPAuthDisabled`.

---

### Task 6: needs_reconnect gates, send classification, scheduled sends

**Files:**
- Modify: `server/internal/service/email_hub.go`: var block (lines 26-34), struct (lines 37-52), `GetThread` (lines 318-320), `markThreadReadIfNeeded` (line 361), `sendOutboundMail` (credential lookup through the Send error branch, now lines 441-454), `MarkThreadRead` (after line 520), `MarkThreadStarred` (after line 574), `Sync` (after line 664)
- Modify: `server/internal/service/email_hub_folders.go`: `MoveThread` (after line 109)
- Modify: `server/internal/service/email_hub_search.go`: `ListThreads` (lines 56-58 and line 99)
- Modify: `server/internal/service/email_hub_attachments.go`: `OpenAttachment` (before line 133)
- Modify: `server/internal/service/email_hub_sync.go`: `WatchInbox` (before `s.gov.beginWatch`)
- Modify: `server/internal/service/email_hub_watcher.go`: `SubscribeInboxWatch` (before line 80)
- Modify: `server/internal/service/email_hub_schedule.go`: `ScheduleSend` (after line 62), `deliverScheduledSend` (lines 153-165)
- Modify: `server/internal/handler/auth.go`: `mapServiceError` (next to the `ErrEmailHubNotConfigured` case, line 175)
- Test (create): `server/internal/service/email_hub_needs_reconnect_test.go`
- Test (modify): `server/internal/handler/error_class_test.go`

Line numbers are from the current tree (before Task 5). If Task 5 moved code, find each spot by the code quoted in its step.

**Interfaces:**
- Consumes (Tasks 1 and 5):
  - `db.EmailHubAccount.AuthFailedAt pgtype.Timestamptz`, `.AuthFailedReason string`, `.CredentialVersion int64`
  - `q.MarkEmailHubAccountAuthFailed(ctx, db.MarkEmailHubAccountAuthFailedParams{ID, OrganizationID, CredentialVersion int64, Reason string}) (int64, error)`
  - `ErrEmailHubReauthRequired`
  - `type emailHubCreds struct{ IMAP imapclient.Credentials; SMTP smtpclient.Credentials; Version int64 }`
  - `(s *EmailHubService) credentials(ctx, acc) (emailHubCreds, error)`, which returns `ErrEmailHubReauthRequired` when `acc.AuthFailedAt.Valid`
  - `(s *EmailHubService) handleAuthError(ctx, acc db.EmailHubAccount, version int64, err error) bool`
  - `smtpclient.ErrAuthFailed`, `smtpclient.ErrSMTPAuthDisabled`
  - Test helper `countingHandler` from `email_hub_auth_failure_test.go`
- Produces:
  - `var ErrEmailHubSMTPDisabled = errors.New("smtp auth disabled for mailbox")`, declared here. The Connect task reuses it.
  - Field `testHookSMTPSend func(context.Context, smtpclient.Credentials, smtpclient.Message) (string, error)`. It is set only in tests; `nil` means `smtpclient.Send`.
  - Wire mapping: `ErrEmailHubReauthRequired` → `409 email_hub_reauth_required`; `ErrEmailHubSMTPDisabled` → `400 email_hub_smtp_disabled`.
  - Scheduled-send `last_error` values `auth_required` and `smtp_disabled`.

- [ ] **Step 1: Write the failing service tests**

Create `server/internal/service/email_hub_needs_reconnect_test.go`:

```go
package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/emailhub"
	"github.com/unicomhub/uniwork/server/internal/emailhub/smtpclient"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// markSeedAccountAuthFailed puts acc into needs_reconnect the way markAuthFailed does.
func markSeedAccountAuthFailed(t *testing.T, q *db.Queries, acc db.EmailHubAccount) db.EmailHubAccount {
	t.Helper()
	ctx := context.Background()
	n, err := q.MarkEmailHubAccountAuthFailed(ctx, db.MarkEmailHubAccountAuthFailedParams{
		ID: acc.ID, OrganizationID: acc.OrganizationID, CredentialVersion: acc.CredentialVersion, Reason: "imap_auth_failed",
	})
	if err != nil || n != 1 {
		t.Fatalf("mark auth failed: n=%d err=%v", n, err)
	}
	row, err := q.GetEmailHubAccountByID(ctx, acc.ID)
	if err != nil || !row.AuthFailedAt.Valid {
		t.Fatalf("auth_failed_at not set: err=%v", err)
	}
	return row
}

func seedDueEmailHubScheduledSend(t *testing.T, q *db.Queries, ws db.Workspace, userID, accountID string) string {
	t.Helper()
	payload, err := json.Marshal(scheduledSendPayload{
		To: []string{"dest@example.com"}, Subject: "Later", BodyText: "Hello",
	})
	if err != nil {
		t.Fatal(err)
	}
	id := util.NewID()
	if _, err := q.CreateEmailHubScheduledSend(context.Background(), db.CreateEmailHubScheduledSendParams{
		ID: id, WorkspaceID: ws.ID, AccountID: accountID, OrganizationID: ws.OrganizationID,
		UserID: userID, Payload: payload, SendAt: pgtype.Timestamptz{Time: time.Now().UTC().Add(-time.Minute), Valid: true},
	}); err != nil {
		t.Fatal(err)
	}
	return id
}

func scheduledSendOutcome(t *testing.T, pool *pgxpool.Pool, id string) (status, lastErr string) {
	t.Helper()
	if err := pool.QueryRow(context.Background(),
		`SELECT status, coalesce(last_error, '') FROM email_hub_scheduled_sends WHERE id = $1`, id,
	).Scan(&status, &lastErr); err != nil {
		t.Fatal(err)
	}
	return status, lastErr
}

func countSMTPSends(svc *EmailHubService, err error) *atomic.Int32 {
	var calls atomic.Int32
	svc.testHookSMTPSend = func(context.Context, smtpclient.Credentials, smtpclient.Message) (string, error) {
		calls.Add(1)
		if err != nil {
			return "", err
		}
		return "<sent@example.com>", nil
	}
	return &calls
}

// Every operation that has to reach the mail server answers 409 before it dials
// or writes anything, while the account waits for its owner to reconnect.
func TestEmailHubNeedsReconnectRefusesServerWorkBeforeDial(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	actor := Human(user.ID)
	acc := markSeedAccountAuthFailed(t, q, seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID))
	thread := seedEmailHubThread(t, q, acc.ID, ws.OrganizationID)
	att, err := q.CreateEmailHubAttachment(ctx, db.CreateEmailHubAttachmentParams{
		ID: util.NewID(), ThreadID: thread.ID, AccountID: acc.ID, OrganizationID: ws.OrganizationID,
		Filename: "a.pdf", MimeType: "application/pdf", SizeBytes: 10, PartID: "2",
	})
	if err != nil {
		t.Fatal(err)
	}
	smtpCalls := countSMTPSends(svc, nil)
	root, stopRoot := context.WithCancel(ctx)
	defer stopRoot()
	svc.hubWatch.setRoot(root)
	mail := SendEmailHubInput{AccountID: acc.ID, To: []string{"dest@example.com"}, Subject: "Hi", BodyText: "Body"}

	calls := map[string]func() error{
		"mark read": func() error {
			_, err := svc.MarkThreadRead(ctx, actor, ws.ID, acc.ID, thread.ID, true)
			return err
		},
		"star": func() error {
			_, err := svc.MarkThreadStarred(ctx, actor, ws.ID, acc.ID, thread.ID, true)
			return err
		},
		"move": func() error {
			return svc.MoveThread(ctx, actor, ws.ID, acc.ID, thread.ID, emailhub.FolderTrash)
		},
		"send": func() error {
			_, err := svc.Send(ctx, actor, ws.ID, mail)
			return err
		},
		"schedule send": func() error {
			_, err := svc.ScheduleSend(ctx, actor, ws.ID, mail, time.Now().Add(time.Hour))
			return err
		},
		"attachment": func() error {
			_, _, err := svc.OpenAttachment(ctx, actor, ws.ID, acc.ID, thread.ID, att.ID)
			return err
		},
		"sync": func() error {
			_, err := svc.Sync(ctx, actor, ws.ID, acc.ID, "", true, false, false)
			return err
		},
		"watch": func() error {
			_, err := svc.WatchInbox(ctx, actor, ws.ID, acc.ID)
			return err
		},
		"subscribe watch": func() error {
			return svc.SubscribeInboxWatch(ctx, actor, ws.ID, acc.ID)
		},
	}
	for name, call := range calls {
		if err := call(); !errors.Is(err, ErrEmailHubReauthRequired) {
			t.Errorf("%s: err = %v, want ErrEmailHubReauthRequired", name, err)
		}
	}

	if n := smtpCalls.Load(); n != 0 {
		t.Fatalf("SMTP called %d times for a needs_reconnect account", n)
	}
	row, err := q.GetEmailHubThread(ctx, db.GetEmailHubThreadParams{
		ID: thread.ID, AccountID: acc.ID, OrganizationID: ws.OrganizationID,
	})
	if err != nil {
		t.Fatalf("the thread must survive a refused move: %v", err)
	}
	if row.IsRead || row.IsStarred {
		t.Fatalf("a refused PATCH must not write the cache: read=%v starred=%v", row.IsRead, row.IsStarred)
	}
	var queued int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM email_hub_scheduled_sends WHERE account_id = $1`, acc.ID).Scan(&queued); err != nil {
		t.Fatal(err)
	}
	if queued != 0 {
		t.Fatalf("a refused schedule must not queue a send, got %d", queued)
	}
	svc.hubWatch.mu.Lock()
	_, running := svc.hubWatch.stop[acc.ID]
	svc.hubWatch.mu.Unlock()
	if running || svc.gov.isWatching(acc.ID) {
		t.Fatal("a refused subscribe must not start the watcher")
	}

	// The cached list stays readable, and a search answers from the cache only
	// (no IMAP SEARCH): spec §3 blocks only the IMAP half of a search.
	page, err := svc.ListThreads(ctx, actor, ws.ID, ListEmailHubThreadsInput{
		AccountID: acc.ID, Folder: emailhub.FolderInbox, Limit: 50,
	})
	if err != nil || len(page.Threads) != 1 {
		t.Fatalf("cached list: err=%v threads=%d", err, len(page.Threads))
	}
	searched, err := svc.ListThreads(ctx, actor, ws.ID, ListEmailHubThreadsInput{
		AccountID: acc.ID, Folder: emailhub.FolderInbox, Query: thread.Subject, Limit: 50,
	})
	if err != nil || len(searched.Threads) != 1 {
		t.Fatalf("cache search on a needs_reconnect account: err=%v threads=%d", err, len(searched.Threads))
	}
}

func TestEmailHubNeedsReconnectGetThreadServesCacheWithoutDialing(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	actor := Human(user.ID)
	acc := markSeedAccountAuthFailed(t, q, seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID))
	cached := seedEmailHubThread(t, q, acc.ID, ws.OrganizationID)
	uncached, err := q.UpsertEmailHubThread(ctx, db.UpsertEmailHubThreadParams{
		ID: util.NewID(), AccountID: acc.ID, OrganizationID: ws.OrganizationID,
		Folder: emailhub.FolderInbox, ImapUid: 43, Subject: "Other",
		Snippet: "other", FromAddr: "c@d.co", ToAddrs: []string{"seed@gmail.com"},
		SentAt:     pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true},
		ImapLabels: []string{}, ConversationKey: "",
	})
	if err != nil {
		t.Fatal(err)
	}
	const html = "<p>The whole message body.</p>"
	if _, err := q.UpdateEmailHubThreadBody(ctx, db.UpdateEmailHubThreadBodyParams{
		ID:       cached.ID,
		BodyText: pgtype.Text{String: "The whole message body.", Valid: true},
		BodyHtml: pgtype.Text{String: html, Valid: true},
	}); err != nil {
		t.Fatal(err)
	}
	var failures atomic.Int32
	svc.log = slog.New(countingHandler{match: "failed", n: &failures})

	view, err := svc.GetThread(ctx, actor, ws.ID, acc.ID, cached.ID, true, true)
	if err != nil {
		t.Fatalf("GetThread must never refuse a needs_reconnect account: %v", err)
	}
	if view.BodyHTML != html || !view.IsRead {
		t.Fatalf("cached body/read: html=%q read=%v", view.BodyHTML, view.IsRead)
	}
	view, err = svc.GetThread(ctx, actor, ws.ID, acc.ID, uncached.ID, true, false)
	if err != nil || view.BodyCached || view.BodyText != "" || view.BodyHTML != "" {
		t.Fatalf("uncached: err=%v cached=%v", err, view.BodyCached)
	}
	row, err := q.GetEmailHubThread(ctx, db.GetEmailHubThreadParams{
		ID: cached.ID, AccountID: acc.ID, OrganizationID: ws.OrganizationID,
	})
	if err != nil || !row.IsRead {
		t.Fatalf("opening must still mark the cache read: err=%v", err)
	}
	time.Sleep(300 * time.Millisecond) // a spawned IMAP mark-read would have logged by now
	if n := failures.Load(); n != 0 {
		t.Fatalf("%d IMAP attempts logged; a needs_reconnect account must not dial", n)
	}
}

func TestEmailHubNeedsReconnectAfterSMTPRejectsCredentials(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	seedEmailHubThread(t, q, acc.ID, ws.OrganizationID)
	countSMTPSends(svc, fmt.Errorf("smtp auth: %w", smtpclient.ErrAuthFailed))

	_, err := svc.Send(ctx, Human(user.ID), ws.ID, SendEmailHubInput{
		AccountID: acc.ID, To: []string{"dest@example.com"}, Subject: "Hi", BodyText: "Body",
	})
	if !errors.Is(err, ErrEmailHubReauthRequired) || errors.Is(err, ErrEmailHubSendFailed) {
		t.Fatalf("err = %v, want bare ErrEmailHubReauthRequired", err)
	}
	row, err := q.GetEmailHubAccountByID(ctx, acc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !row.AuthFailedAt.Valid || row.AuthFailedReason != "smtp_auth_failed" || row.DisconnectedAt.Valid {
		t.Fatalf("want needs_reconnect/smtp_auth_failed, got failed=%v reason=%q disconnected=%v",
			row.AuthFailedAt.Valid, row.AuthFailedReason, row.DisconnectedAt.Valid)
	}
	var sent, total int
	if err := pool.QueryRow(ctx, `SELECT count(*) FILTER (WHERE folder = $2), count(*)
		FROM email_hub_threads WHERE account_id = $1`, acc.ID, emailhub.FolderSent).Scan(&sent, &total); err != nil {
		t.Fatal(err)
	}
	if sent != 0 || total != 1 {
		t.Fatalf("no Sent row for a refused send and the cache kept: sent=%d total=%d", sent, total)
	}
}

func TestEmailHubNeedsReconnectNotSetWhenSMTPAuthDisabled(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	countSMTPSends(svc, fmt.Errorf("smtp auth: %w", smtpclient.ErrSMTPAuthDisabled))

	_, err := svc.Send(ctx, Human(user.ID), ws.ID, SendEmailHubInput{
		AccountID: acc.ID, To: []string{"dest@example.com"}, Subject: "Hi", BodyText: "Body",
	})
	if !errors.Is(err, ErrEmailHubSMTPDisabled) || errors.Is(err, ErrEmailHubSendFailed) {
		t.Fatalf("err = %v, want bare ErrEmailHubSMTPDisabled", err)
	}
	row, err := q.GetEmailHubAccountByID(ctx, acc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if row.AuthFailedAt.Valid || row.PasswordEnc != acc.PasswordEnc {
		t.Fatalf("SMTP AUTH disabled is not an auth failure: failed=%v password kept=%v",
			row.AuthFailedAt.Valid, row.PasswordEnc == acc.PasswordEnc)
	}
}

func TestEmailHubNeedsReconnectScheduledSendFailsAuthRequired(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	acc := markSeedAccountAuthFailed(t, q, seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID))
	id := seedDueEmailHubScheduledSend(t, q, ws, user.ID, acc.ID)
	calls := countSMTPSends(svc, nil)

	svc.runScheduledSendOnce(context.Background())

	if status, lastErr := scheduledSendOutcome(t, pool, id); status != "failed" || lastErr != "auth_required" {
		t.Fatalf("status=%q last_error=%q, want failed/auth_required", status, lastErr)
	}
	if n := calls.Load(); n != 0 {
		t.Fatalf("a due send of a needs_reconnect account went to SMTP %d times", n)
	}
}

func TestEmailHubNeedsReconnectScheduledSendSMTPAuthFailure(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	id := seedDueEmailHubScheduledSend(t, q, ws, user.ID, acc.ID)
	countSMTPSends(svc, fmt.Errorf("smtp auth: %w", smtpclient.ErrAuthFailed))

	svc.runScheduledSendOnce(context.Background())

	if status, lastErr := scheduledSendOutcome(t, pool, id); status != "failed" || lastErr != "auth_required" {
		t.Fatalf("status=%q last_error=%q, want failed/auth_required", status, lastErr)
	}
	row, err := q.GetEmailHubAccountByID(context.Background(), acc.ID)
	if err != nil || !row.AuthFailedAt.Valid {
		t.Fatalf("a 535 on a scheduled send must mark the account: err=%v", err)
	}
}

func TestEmailHubNeedsReconnectScheduledSendSMTPDisabled(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
	id := seedDueEmailHubScheduledSend(t, q, ws, user.ID, acc.ID)
	countSMTPSends(svc, fmt.Errorf("smtp auth: %w", smtpclient.ErrSMTPAuthDisabled))

	svc.runScheduledSendOnce(context.Background())

	if status, lastErr := scheduledSendOutcome(t, pool, id); status != "failed" || lastErr != "smtp_disabled" {
		t.Fatalf("status=%q last_error=%q, want failed/smtp_disabled", status, lastErr)
	}
	row, err := q.GetEmailHubAccountByID(context.Background(), acc.ID)
	if err != nil || row.AuthFailedAt.Valid {
		t.Fatalf("SMTP AUTH disabled must leave the account active: err=%v", err)
	}
}
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' go test ./internal/service/ -run TestEmailHubNeedsReconnect -count=1`

Expected: a build failure: `svc.testHookSMTPSend undefined (type *EmailHubService has no field or method testHookSMTPSend)` and `undefined: ErrEmailHubSMTPDisabled`.

- [ ] **Step 3: Implement the service changes**

`server/internal/service/email_hub.go`, var block: add after `ErrEmailHubSendFailed`:

```go
	ErrEmailHubSMTPDisabled  = errors.New("smtp auth disabled for mailbox")
```

`server/internal/service/email_hub.go`, struct: replace the test-only field group with:

```go
	// scheduleWorkerOwnerFn, testHookScheduledSend and testHookSMTPSend are set only in tests.
	scheduleWorkerOwnerFn func() string
	testHookScheduledSend func(context.Context, db.EmailHubAccount, string, SendEmailHubInput) error
	testHookSMTPSend      func(context.Context, smtpclient.Credentials, smtpclient.Message) (string, error)
```

(`testHookVerify` is added later by Task 7; do not add it here.)

`GetThread`: replace

```go
	if !s.Enabled() {
		return view, nil
	}
	s.gov.beginInteractive(accountID)
```

with

```go
	// needs_reconnect: serve what is cached, never dial (spec §3).
	if !s.Enabled() || acc.AuthFailedAt.Valid {
		return view, nil
	}
	s.gov.beginInteractive(accountID)
```

`markThreadReadIfNeeded`: replace `go s.syncMarkReadOnIMAP(acc, r, r.ID)` with

```go
		if !acc.AuthFailedAt.Valid {
			go s.syncMarkReadOnIMAP(acc, r, r.ID)
		}
```

`sendOutboundMail`: replace everything from the credential lookup through the Send error branch with the block below. In the current tree that is lines 441-454, `password, err := s.openPassword(...)` through `return ..., fmt.Errorf("%w: %v", ErrEmailHubSendFailed, err)` followed by `}`. After Task 5 the same region starts at the `s.credentials(ctx, acc)` call.

```go
	creds, err := s.credentials(ctx, acc)
	if err != nil {
		return EmailHubThreadView{}, err
	}
	send := smtpclient.Send
	if s.testHookSMTPSend != nil {
		send = s.testHookSMTPSend
	}
	msgID, err := send(ctx, creds.SMTP, smtpclient.Message{
		To: to, Cc: cleanEmailList(in.Cc), Bcc: cleanEmailList(in.Bcc), Subject: subject,
		BodyText: body, BodyHTML: bodyHTML, Attachments: attachments, InReplyTo: inReplyTo, References: references,
	})
	if err != nil {
		s.log.Warn("email hub send failed", "account_id", acc.ID, "err", err)
		// Classified before wrapping: the handler maps these sentinels, not ErrEmailHubSendFailed.
		switch {
		case errors.Is(err, smtpclient.ErrSMTPAuthDisabled):
			return EmailHubThreadView{}, ErrEmailHubSMTPDisabled
		case errors.Is(err, smtpclient.ErrAuthFailed):
			s.handleAuthError(ctx, acc, creds.Version, err)
			return EmailHubThreadView{}, ErrEmailHubReauthRequired
		}
		return EmailHubThreadView{}, fmt.Errorf("%w: %v", ErrEmailHubSendFailed, err)
	}
```

`MarkThreadRead` and `MarkThreadStarred`: right after each `GetEmailHubAccount` error block, insert:

```go
	if acc.AuthFailedAt.Valid {
		return EmailHubThreadView{}, ErrEmailHubReauthRequired
	}
```

`Sync`: right after its `GetEmailHubAccount` error block, insert:

```go
	if acc.AuthFailedAt.Valid {
		return false, ErrEmailHubReauthRequired
	}
```

`server/internal/service/email_hub_folders.go`, `MoveThread`: right after the `GetEmailHubAccount` error block, insert:

```go
	if acc.AuthFailedAt.Valid {
		return ErrEmailHubReauthRequired
	}
```

`server/internal/service/email_hub_search.go`, `ListThreads`: replace

```go
	query := strings.TrimSpace(in.Query)
```

with

```go
	query := strings.TrimSpace(in.Query)
```

and change the IMAP search guard `if query != "" {` (the loop over `searchScopeFolders`) to

```go
	if query != "" && !acc.AuthFailedAt.Valid { // needs_reconnect: search the cache only, never IMAP
```

Then replace the backfill condition

```go
	if len(rows) == 0 && in.BeforeID != "" && cursorUID > 1 && listAllowsBackfill(in) && backfillSupportedFolder(folder) {
```

with

```go
	if len(rows) == 0 && in.BeforeID != "" && cursorUID > 1 && !acc.AuthFailedAt.Valid &&
		listAllowsBackfill(in) && backfillSupportedFolder(folder) {
```

`server/internal/service/email_hub_attachments.go`, `OpenAttachment`: replace

```go
	sess, mailboxes, err := s.openIMAPInteractive(acc)
```

with

```go
	// Attachment bytes are never cached, so every download dials.
	if acc.AuthFailedAt.Valid {
		return EmailHubAttachmentView{}, nil, ErrEmailHubReauthRequired
	}
	sess, mailboxes, err := s.openIMAPInteractive(acc)
```

(After Task 5 the open call may carry `ctx`; keep its form and insert the gate above it.)

`server/internal/service/email_hub_sync.go`, `WatchInbox`: replace

```go
	s.gov.beginWatch(accountID)
	defer s.gov.endWatch(accountID)
```

with

```go
	if acc.AuthFailedAt.Valid {
		return false, ErrEmailHubReauthRequired
	}
	s.gov.beginWatch(accountID)
	defer s.gov.endWatch(accountID)
```

`server/internal/service/email_hub_watcher.go`, `SubscribeInboxWatch`: replace

```go
	s.hubWatch.subscribe(acc)
	return nil
```

with

```go
	if acc.AuthFailedAt.Valid {
		return ErrEmailHubReauthRequired
	}
	s.hubWatch.subscribe(acc)
	return nil
```

(`runHubWatchLoop` already exits on `AuthFailedAt` since Task 5; no change here.)

`server/internal/service/email_hub_schedule.go`, `ScheduleSend`: right after the `GetEmailHubAccount` error block, insert:

```go
	if acc.AuthFailedAt.Valid {
		return EmailHubScheduledSendView{}, ErrEmailHubReauthRequired
	}
```

`deliverScheduledSend`: replace

```go
	if acc.DisconnectedAt.Valid { // disconnected after the claim
		markFailed("mailbox disconnected")
		return
	}
```

with

```go
	if acc.DisconnectedAt.Valid { // disconnected after the claim
		markFailed("mailbox disconnected")
		return
	}
	if acc.AuthFailedAt.Valid { // never a silent late send after the owner reconnects
		markFailed("auth_required")
		return
	}
```

Then replace

```go
	if sendErr != nil {
		markFailed(sendErr.Error())
		return
	}
```

with

```go
	if sendErr != nil {
		switch {
		case errors.Is(sendErr, ErrEmailHubReauthRequired):
			markFailed("auth_required")
		case errors.Is(sendErr, ErrEmailHubSMTPDisabled):
			markFailed("smtp_disabled")
		default:
			markFailed(sendErr.Error())
		}
		return
	}
```

- [ ] **Step 4: Run the service tests and confirm they pass**

Run: `cd server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' go test ./internal/service/ -run 'TestEmailHub' -count=1`

Expected: `ok`. The new `TestEmailHubNeedsReconnect*` tests pass, and the existing email hub tests (scheduled send, auth failure, lifecycle) still pass.

- [ ] **Step 5: Write the failing handler test**

`server/internal/handler/error_class_test.go`: add `"fmt"` to the imports, and append these two rows to the `cases` slice in `TestMapServiceErrorStampsErrorClass` (after `{"generic conflict", ...}`):

```go
		{"email hub reauth", service.ErrEmailHubReauthRequired, 409, "email_hub_reauth_required", ""},
		{"email hub smtp disabled", service.ErrEmailHubSMTPDisabled, 400, "email_hub_smtp_disabled", ""},
```

Then append this new test at the end of the file:

```go
// Send answers with the reconnect sentinels bare, so they win over the generic
// 502 send failure on both the send and the schedule path.
func TestMapEmailHubSendErrorKeepsReconnectCodes(t *testing.T) {
	h := &handlers{Deps: Deps{Log: slog.Default()}}
	cases := []struct {
		err    error
		status int
		code   string
	}{
		{service.ErrEmailHubReauthRequired, http.StatusConflict, "email_hub_reauth_required"},
		{service.ErrEmailHubSMTPDisabled, http.StatusBadRequest, "email_hub_smtp_disabled"},
		{fmt.Errorf("%w: dial", service.ErrEmailHubSendFailed), http.StatusBadGateway, "email_hub_send_failed"},
	}
	for _, tc := range cases {
		rec := httptest.NewRecorder()
		h.mapEmailHubSendError(rec, tc.err)
		if rec.Code != tc.status {
			t.Fatalf("%v: status = %d, want %d", tc.err, rec.Code, tc.status)
		}
		if got := decodeErrBody(t, rec)["code"]; got != tc.code {
			t.Fatalf("%v: code = %v, want %q", tc.err, got, tc.code)
		}
	}
}
```

- [ ] **Step 6: Run the handler test and confirm it fails**

Run: `cd server && go test ./internal/handler/ -run 'TestMapServiceErrorStampsErrorClass|TestMapEmailHubSendErrorKeepsReconnectCodes' -count=1`

Expected: FAIL with `status = 500, want 409` for `email hub reauth` and `status = 500, want 400` for `email hub smtp disabled`.

- [ ] **Step 7: Implement the handler mapping**

`server/internal/handler/auth.go`, `mapServiceError`: insert after the `ErrEmailHubNotConfigured` case:

```go
	case errors.Is(err, service.ErrEmailHubReauthRequired):
		respondError(w, http.StatusConflict, "email_hub_reauth_required", "Email Hub account needs to be reconnected")
	case errors.Is(err, service.ErrEmailHubSMTPDisabled):
		respondError(w, http.StatusBadRequest, "email_hub_smtp_disabled", "SMTP AUTH is disabled for this mailbox")
```

`mapServiceError` is already the default branch of `mapEmailHubSendError`, `watchEmailHub` and `subscribeEmailHubInboxWatch`. It is also what the PATCH, sync and attachment handlers call. No other handler needs to change.

- [ ] **Step 8: Run the tests and confirm they pass**

Run:
```bash
cd server && go test ./internal/handler/ -run 'TestMapServiceErrorStampsErrorClass|TestMapEmailHubSendErrorKeepsReconnectCodes' -count=1
cd server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' go test ./internal/handler/ -run 'TestEmailHub' -count=1
cd server && gofmt -l ./internal/service ./internal/handler && go vet ./internal/service/ ./internal/handler/
```

Expected: `ok` for both test runs, no files listed by `gofmt -l`, and `go vet` clean.

- [ ] **Step 8b: Expose needs_reconnect on the account view and SDO**

Add to `TestEmailHubNeedsReconnectRefusesServerWorkBeforeDial` (top, after the seed):

```go
	views, err := svc.ListAccounts(ctx, actor, ws.ID)
	if err != nil || len(views) != 1 || !views[0].NeedsReconnect || views[0].AuthFailedReason != "imap_auth_failed" || views[0].AuthKind != "password" {
		t.Fatalf("ListAccounts must expose needs_reconnect: %+v err=%v", views, err)
	}
```

(`markSeedAccountAuthFailed` must set reason `imap_auth_failed`; adjust the helper if it uses another value.) Run it and see it fail to compile (`views[0].NeedsReconnect undefined`).

`server/internal/service/email_hub.go`, `EmailHubAccountView`: add three fields after `LastSyncAt`:

```go
	AuthKind         string
	NeedsReconnect   bool
	AuthFailedReason string
```

`accountView` (near the end of `email_hub.go`): set them:

```go
		AuthKind: r.AuthKind, NeedsReconnect: r.AuthFailedAt.Valid, AuthFailedReason: r.AuthFailedReason,
```

`server/internal/handler/dto/sdo/email_hub.go`, inside `EmailHubAccountSDO`:

```go
	AuthKind         string `json:"auth_kind" description:"How the mailbox signs in" example:"password"`
	NeedsReconnect   bool   `json:"needs_reconnect" description:"The provider refused the stored credential; reconnect to resume sync and send" example:"false"`
	AuthFailedReason string `json:"auth_failed_reason" description:"Why the credential was refused; empty while connected" example:"imap_auth_failed"`
```

`server/internal/handler/email_hub.go`, `toEmailHubAccountSDO`: copy the three fields (`AuthKind: a.AuthKind, NeedsReconnect: a.NeedsReconnect, AuthFailedReason: a.AuthFailedReason`). If `server/internal/handler/dto/sdo/email_hub_sdo_test.go` pins the SDO's field list, add the three fields there.

Run: `cd server && go test ./internal/handler/dto/sdo/ -count=1` and the service test above; both pass. The commit below includes `server/internal/handler/dto/sdo/email_hub.go` and `server/internal/handler/email_hub.go` (add the sdo test too if it changed).

- [ ] **Step 9: Commit**

```bash
git add server/internal/service/email_hub.go server/internal/service/email_hub_folders.go \
  server/internal/service/email_hub_search.go server/internal/service/email_hub_attachments.go \
  server/internal/service/email_hub_sync.go server/internal/service/email_hub_watcher.go \
  server/internal/service/email_hub_schedule.go server/internal/service/email_hub_needs_reconnect_test.go \
  server/internal/handler/auth.go server/internal/handler/error_class_test.go \
  server/internal/handler/dto/sdo/email_hub.go server/internal/handler/email_hub.go
git commit -m "feat(email-hub): gate server work on needs_reconnect and classify SMTP auth failures" \
  -m "A needs_reconnect account answers 409 email_hub_reauth_required before any dial for PATCH, move, IMAP search, send, attachments, sync and watch. GetThread keeps serving the cache and skips the IMAP mark-read. An SMTP 535 marks the account through handleAuthError; SMTP AUTH disabled returns 400 email_hub_smtp_disabled and leaves the account active. Due scheduled sends fail with auth_required or smtp_disabled. Snooze stays local and allowed." \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Notes:
- **`ListThreads` with a search query on a needs_reconnect account** skips IMAP SEARCH and backfill and answers from the cache (spec §3 blocks only the IMAP half).
- **Send relies on Task 5.** It has no gate of its own; it depends on `credentials()` returning `ErrEmailHubReauthRequired`. `ScheduleSend` is gated because it shares the send route.
- **Every attachment download returns 409.** No attachment bytes are cached in this codebase.
- **Unchecked against Task 5.** Task 5's final code was not available, so the anchors in its files (and the `countingHandler` test helper) still need checking when this task is applied.

---

### Task 7: Connect rewrite, user disconnect audit, connect rate limit

**Files:**
- Create: `server/internal/service/email_hub_connect.go`
- Create: `server/internal/service/email_hub_connect_test.go`
- Create: `server/internal/handler/router/email_hub_ratelimit_test.go`
- Modify: `server/internal/service/email_hub.go`. Delete `type ConnectEmailHubInput` and `func (s *EmailHubService) Connect`, which move to the new file. Add two test-hook fields to `EmailHubService`. `Disconnect` now calls the audited helper.
- Modify: `server/internal/audit/actions.go` (Email Hub block, around line 190)
- Modify: `server/internal/service/email_hub_integration_test.go` (`TestEmailHubConnectValidation`, around line 92)
- Modify: `server/internal/service/audit_coverage_test.go`: the Email Hub cases (around line 1281) and `auditActions()` (around line 1421)
- Modify: `server/internal/handler/email_hub.go` (`connectEmailHubAccount`)
- Modify: `server/internal/handler/email_hub_test.go` (new test at the end)
- Modify: `server/internal/handler/router/email_hub.go` (`registerEmailHub` signature and the `POST …/accounts` route)
- Modify: `server/internal/handler/router/router.go` (around line 151)

**Interfaces:**
- Consumes from earlier GĐ1 tasks:
  - `db.GetActiveEmailHubAccountByAddress` / `db.GetActiveEmailHubAccountByAddressParams{OrganizationID, UserID, Email}`
  - `db.UpdateEmailHubAccountCredentials` / `…Params{ID, OrganizationID, Provider, ImapHost, ImapPort, ImapSecurity, SmtpHost, SmtpPort, SmtpSecurity, Username, AuthKind, PasswordEnc}`. Returns the new row.
  - `db.MarkEmailHubAccountAuthFailed` / `…Params{ID, OrganizationID, CredentialVersion, Reason}`
  - `db.CreateEmailHubAccountParams` gains `ImapSecurity`, `SmtpSecurity`, `Username`, `AuthKind`
  - `db.EmailHubAccount.{AuthKind, AuthFailedAt, AuthFailedReason, CredentialVersion}`
  - The unique index `idx_email_hub_accounts_active_address`
  - `imapclient.Credentials{…, Security}`, `imapclient.ErrAuthFailed`, `ErrLoginRefused`, `ErrTLSRequired`
  - `smtpclient.Credentials{…, Security}`, `smtpclient.ErrAuthFailed`, `ErrSMTPAuthDisabled`, `ErrTLSRequired`
  - `netguard.ErrHostNotAllowed`
  - `service.ErrEmailHubSMTPDisabled`
  - `EmailHubAccountView.{AuthKind, NeedsReconnect}`
  - `audit.ActionEmailHubAccountAuthFailed`
- Produces:
  - `var ErrEmailHubAlreadyConnected = errors.New("email already connected")`, `ErrEmailHubTLSRequired`, `ErrEmailHubUnreachable`
  - Fields `testHookVerify func(ctx context.Context, imap imapclient.Credentials, smtp smtpclient.Credentials) error` and `testHookInitialSync func(ctx context.Context, acc db.EmailHubAccount)`. The second keeps service tests off the network, because the preset hosts are real.
  - `func (s *EmailHubService) Connect(ctx context.Context, actor Actor, workspaceID string, in ConnectEmailHubInput) (EmailHubAccountView, error)` (signature unchanged)
  - `func classifyEmailHubConnectError(err error) (string, error)`
  - `func sameEmailHubConnection(acc db.EmailHubAccount, authKind, imapHost string, imapPort int) bool`
  - `audit.ActionEmailHubAccountConnected = "email_hub_account.connected"`
  - HTTP errors:
    - 409 `email_hub_already_connected`
    - 400 `email_hub_tls_required`
    - 400 `email_hub_unreachable`
    - 400 `email_hub_smtp_disabled`
  - `registerEmailHub(r api, h Routes, connectLimit func(http.Handler) http.Handler)`

- [ ] **Step 1: Write the failing tests**

Create `server/internal/service/email_hub_connect_test.go`:

```go
package service

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/emailhub"
	"github.com/unicomhub/uniwork/server/internal/emailhub/imapclient"
	"github.com/unicomhub/uniwork/server/internal/emailhub/netguard"
	"github.com/unicomhub/uniwork/server/internal/emailhub/smtpclient"
	"github.com/unicomhub/uniwork/server/internal/util"
	"github.com/unicomhub/uniwork/server/internal/util/secretbox"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// stubEmailHubDial keeps Connect off the network: the login check answers err
// and the initial sync is skipped. It returns how many logins Connect tried.
func stubEmailHubDial(svc *EmailHubService, err error) *atomic.Int32 {
	var calls atomic.Int32
	svc.testHookVerify = func(context.Context, imapclient.Credentials, smtpclient.Credentials) error {
		calls.Add(1)
		return err
	}
	svc.testHookInitialSync = func(context.Context, db.EmailHubAccount) {}
	return &calls
}

// seedPresetEmailHubAccount stores a password mailbox on its provider's
// preset server, the row a Connect for the same address would produce.
func seedPresetEmailHubAccount(t *testing.T, q *db.Queries, box *secretbox.Box, userID, orgID, email string) db.EmailHubAccount {
	t.Helper()
	prov, ok := emailhub.ProviderForEmail(email)
	if !ok {
		t.Fatalf("no preset for %s", email)
	}
	sealed, err := box.Seal([]byte("old-app-password"))
	if err != nil {
		t.Fatal(err)
	}
	row, err := q.CreateEmailHubAccount(context.Background(), db.CreateEmailHubAccountParams{
		ID: util.NewID(), UserID: userID, OrganizationID: orgID,
		EmailAddress: email, Provider: prov.Name,
		ImapHost: prov.IMAPHost, ImapPort: int32(prov.IMAPPort), ImapSecurity: "tls",
		SmtpHost: prov.SMTPHost, SmtpPort: int32(prov.SMTPPort), SmtpSecurity: "starttls",
		AuthKind: "password", PasswordEnc: base64.StdEncoding.EncodeToString(sealed),
	})
	if err != nil {
		t.Fatal(err)
	}
	return row
}

// connectedAudit reads the connected rows of one account: how many, the
// actor kind, and the reconnected flag.
func connectedAudit(t *testing.T, pool *pgxpool.Pool, accountID string) (int, string, string) {
	t.Helper()
	var n int
	var kind, reconnected string
	if err := pool.QueryRow(context.Background(), `SELECT count(*), coalesce(max(actor_kind), ''),
		coalesce(max(metadata::jsonb->>'reconnected'), '')
		FROM audit_events WHERE action = $1 AND resource_id = $2`,
		audit.ActionEmailHubAccountConnected, accountID).Scan(&n, &kind, &reconnected); err != nil {
		t.Fatal(err)
	}
	return n, kind, reconnected
}

func TestEmailHubConnectCreatesThePasswordAccount(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	var gotIMAP imapclient.Credentials
	var gotSMTP smtpclient.Credentials
	stubEmailHubDial(svc, nil)
	svc.testHookVerify = func(_ context.Context, imap imapclient.Credentials, smtp smtpclient.Credentials) error {
		gotIMAP, gotSMTP = imap, smtp
		return nil
	}

	view, err := svc.Connect(ctx, Human(user.ID), ws.ID, ConnectEmailHubInput{
		EmailAddress: " New@Gmail.com ", AppPassword: "app-password-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	wantIMAP := imapclient.Credentials{Host: "imap.gmail.com", Port: 993, Email: "new@gmail.com", Password: "app-password-1", Security: "tls"}
	wantSMTP := smtpclient.Credentials{Host: "smtp.gmail.com", Port: 587, Email: "new@gmail.com", Password: "app-password-1", Security: "starttls"}
	if gotIMAP != wantIMAP || gotSMTP != wantSMTP {
		t.Fatalf("verify got imap=%+v smtp=%+v", gotIMAP, gotSMTP)
	}
	row, err := q.GetEmailHubAccountByID(ctx, view.ID)
	if err != nil {
		t.Fatal(err)
	}
	if row.AuthKind != "password" || view.AuthKind != "password" || view.NeedsReconnect {
		t.Fatalf("row auth_kind=%q view=%+v", row.AuthKind, view)
	}
	if n, kind, reconnected := connectedAudit(t, pool, view.ID); n != 1 || kind != "human" || reconnected != "false" {
		t.Fatalf("connected audit: n=%d kind=%q reconnected=%q", n, kind, reconnected)
	}
}

// The duplicate check runs before any dial (spec §5.2 step 3): a second
// Connect of a live mailbox never spends a LOGIN at the provider.
func TestEmailHubConnectRefusesADuplicateBeforeDialing(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	seedPresetEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID, "dup@gmail.com")
	calls := stubEmailHubDial(svc, nil)

	_, err := svc.Connect(context.Background(), Human(user.ID), ws.ID, ConnectEmailHubInput{
		EmailAddress: "DUP@gmail.com", AppPassword: "app-password-1",
	})
	if !errors.Is(err, ErrEmailHubAlreadyConnected) {
		t.Fatalf("expected already connected, got %v", err)
	}
	if n := calls.Load(); n != 0 {
		t.Fatalf("a duplicate must be refused before the login check, verify ran %d times", n)
	}
}

func TestEmailHubReconnectKeepsTheAccountAndItsMail(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	acc := seedPresetEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID, "back@gmail.com")
	seedEmailHubThread(t, q, acc.ID, ws.OrganizationID)
	if n, err := q.MarkEmailHubAccountAuthFailed(ctx, db.MarkEmailHubAccountAuthFailedParams{
		ID: acc.ID, OrganizationID: ws.OrganizationID, CredentialVersion: acc.CredentialVersion, Reason: "imap_auth_failed",
	}); err != nil || n != 1 {
		t.Fatalf("mark auth failed: n=%d err=%v", n, err)
	}
	for range emailHubRefusedLoginsBeforeDisconnect - 1 {
		svc.gov.loginRefused(acc.ID)
	}
	calls := stubEmailHubDial(svc, nil)

	view, err := svc.Connect(ctx, Human(user.ID), ws.ID, ConnectEmailHubInput{
		EmailAddress: "Back@Gmail.com", AppPassword: "new-app-password",
	})
	if err != nil {
		t.Fatal(err)
	}
	if view.ID != acc.ID || view.NeedsReconnect {
		t.Fatalf("reconnect must keep id %s and clear needs_reconnect, got %+v", acc.ID, view)
	}
	if calls.Load() != 1 {
		t.Fatalf("a reconnect verifies the new password once, got %d", calls.Load())
	}
	row, err := q.GetEmailHubAccountByID(ctx, acc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if row.AuthFailedAt.Valid || row.AuthFailedReason != "" || row.DisconnectedAt.Valid {
		t.Fatalf("reconnect must clear the failure: %+v", row)
	}
	if row.CredentialVersion <= acc.CredentialVersion {
		t.Fatalf("credential_version must move past %d, got %d", acc.CredentialVersion, row.CredentialVersion)
	}
	if pw, err := svc.openPassword(row.PasswordEnc); err != nil || pw != "new-app-password" {
		t.Fatalf("stored password=%q err=%v", pw, err)
	}
	var threads int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM email_hub_threads WHERE account_id = $1`, acc.ID).Scan(&threads); err != nil || threads != 1 {
		t.Fatalf("cached mail must survive a reconnect, threads=%d err=%v", threads, err)
	}
	if n := svc.gov.loginRefused(acc.ID); n != 1 {
		t.Fatalf("a reconnect must restart the refused-LOGIN run, count=%d", n)
	}
	if n, kind, reconnected := connectedAudit(t, pool, acc.ID); n != 1 || kind != "human" || reconnected != "true" {
		t.Fatalf("connected audit: n=%d kind=%q reconnected=%q", n, kind, reconnected)
	}
}

// Both requests pass the pre-dial check; the unique index settles it.
func TestEmailHubConcurrentConnectsLeaveOneAccount(t *testing.T) {
	svc, _, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	stubEmailHubDial(svc, nil)
	var ready sync.WaitGroup
	ready.Add(2)
	svc.testHookVerify = func(context.Context, imapclient.Credentials, smtpclient.Credentials) error {
		ready.Done()
		ready.Wait() // both requests are past the duplicate check before either writes
		return nil
	}
	in := ConnectEmailHubInput{EmailAddress: "race@gmail.com", AppPassword: "app-password-1"}
	errs := make(chan error, 2)
	for range 2 {
		go func() {
			_, err := svc.Connect(ctx, Human(user.ID), ws.ID, in)
			errs <- err
		}()
	}
	var ok, conflict int
	for range 2 {
		switch err := <-errs; {
		case err == nil:
			ok++
		case errors.Is(err, ErrEmailHubAlreadyConnected):
			conflict++
		default:
			t.Fatalf("unexpected connect error: %v", err)
		}
	}
	if ok != 1 || conflict != 1 {
		t.Fatalf("want one success and one conflict, got ok=%d conflict=%d", ok, conflict)
	}
	var active int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM email_hub_accounts
		WHERE user_id = $1 AND lower(email_address) = 'race@gmail.com' AND disconnected_at IS NULL`, user.ID).Scan(&active); err != nil || active != 1 {
		t.Fatalf("want one active row, got %d err=%v", active, err)
	}
}

func TestEmailHubConnectClassifiesVerifyErrorsWithoutLeakingTheHost(t *testing.T) {
	svc, _, user, ws, _ := emailHubFixture(t)
	var logs bytes.Buffer
	svc.log = slog.New(slog.NewTextHandler(&logs, nil))
	const host = "mail.secret-intranet.example"
	cases := []struct {
		name string
		err  error
		want error
	}{
		{"imap auth", fmt.Errorf("imap login %s: %w", host, imapclient.ErrAuthFailed), ErrEmailHubConnectFailed},
		{"imap refused", fmt.Errorf("imap login %s: %w", host, imapclient.ErrLoginRefused), ErrEmailHubConnectFailed},
		{"smtp auth", fmt.Errorf("smtp auth %s: %w", host, smtpclient.ErrAuthFailed), ErrEmailHubConnectFailed},
		{"smtp disabled", fmt.Errorf("smtp auth %s: %w", host, smtpclient.ErrSMTPAuthDisabled), ErrEmailHubSMTPDisabled},
		{"imap tls", fmt.Errorf("imap %s: %w", host, imapclient.ErrTLSRequired), ErrEmailHubTLSRequired},
		{"smtp tls", fmt.Errorf("smtp %s: %w", host, smtpclient.ErrTLSRequired), ErrEmailHubTLSRequired},
		{"blocked host", fmt.Errorf("dial %s:993: %w", host, netguard.ErrHostNotAllowed), ErrEmailHubUnreachable},
		{"dns", fmt.Errorf("dial: %w", &net.DNSError{Err: "no such host", Name: host, IsNotFound: true}), ErrEmailHubUnreachable},
		{"certificate", fmt.Errorf("tls: %w", &tls.CertificateVerificationError{Err: errors.New("x509: unknown authority for " + host)}), ErrEmailHubUnreachable},
		{"protocol", errors.New("imap: unexpected BYE from " + host), ErrEmailHubConnectFailed},
	}
	for _, tc := range cases {
		stubEmailHubDial(svc, tc.err)
		_, err := svc.Connect(context.Background(), Human(user.ID), ws.ID, ConnectEmailHubInput{
			EmailAddress: "probe@gmail.com", AppPassword: "app-password-1",
		})
		if !errors.Is(err, tc.want) {
			t.Errorf("%s: got %v, want %v", tc.name, err, tc.want)
			continue
		}
		if strings.Contains(err.Error(), host) {
			t.Errorf("%s: the returned error carries the host: %v", tc.name, err)
		}
	}
	if strings.Contains(logs.String(), host) {
		t.Fatalf("the log carries the host:\n%s", logs.String())
	}
	if !strings.Contains(logs.String(), "code=unreachable") || !strings.Contains(logs.String(), "code=auth_failed") {
		t.Fatalf("the log must carry the classified codes:\n%s", logs.String())
	}
}

```

Replace `TestEmailHubConnectValidation` in `server/internal/service/email_hub_integration_test.go` with the version below. Its imports already cover `auth` and `time`.

```go
func TestEmailHubConnectValidation(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	actor := Human(user.ID)
	calls := stubEmailHubDial(svc, nil)

	// Membership is decided first: an outsider learns nothing about the input.
	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	outsider := registerVerified(t, q, as, "eh-outsider@example.com", "Outsider")
	_, err := svc.Connect(ctx, Human(outsider.ID), ws.ID, ConnectEmailHubInput{})
	if !errors.Is(err, ErrForbidden) && !errors.Is(err, ErrNotFound) {
		t.Fatalf("non-member must be refused before validation, got %v", err)
	}

	_, err = svc.Connect(ctx, actor, ws.ID, ConnectEmailHubInput{})
	var ve ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("expected empty connect to fail validation, got %v", err)
	}

	_, err = svc.Connect(ctx, actor, ws.ID, ConnectEmailHubInput{
		EmailAddress: "user@unknown.example", AppPassword: "secret",
	})
	if !errors.Is(err, ErrEmailHubUnsupported) {
		t.Fatalf("expected unsupported provider, got %v", err)
	}
	if n := calls.Load(); n != 0 {
		t.Fatalf("refused input must never reach the login check, verify ran %d times", n)
	}
}
```

Append to `server/internal/handler/email_hub_test.go`:

```go
// A live mailbox is refused with a stable 409 before any dial (spec §3).
func TestEmailHubConnectAlreadyConnectedIs409(t *testing.T) {
	srv, token, wsID, userID, box := setupEmailHubHTTP(t)
	q := db.New(testPool)
	orgID := orgIDFromWorkspace(t, q, wsID)
	sealed, err := box.Seal([]byte("app-password"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := q.CreateEmailHubAccount(context.Background(), db.CreateEmailHubAccountParams{
		ID: util.NewID(), UserID: userID, OrganizationID: orgID,
		EmailAddress: "dup@gmail.com", Provider: "gmail",
		ImapHost: "imap.gmail.com", ImapPort: 993, ImapSecurity: "tls",
		SmtpHost: "smtp.gmail.com", SmtpPort: 587, SmtpSecurity: "starttls",
		AuthKind: "password", PasswordEnc: base64.StdEncoding.EncodeToString(sealed),
	}); err != nil {
		t.Fatal(err)
	}
	res, out := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/email-hub/accounts", token, map[string]string{
		"email_address": "Dup@Gmail.com", "app_password": "another-app-password",
	})
	if res.StatusCode != http.StatusConflict || errorCode(out) != "email_hub_already_connected" {
		t.Fatalf("duplicate connect: %d %v", res.StatusCode, out)
	}
}
```

Create `server/internal/handler/router/email_hub_ratelimit_test.go`:

```go
package router

import (
	"net/http"
	"testing"
)

// UNI-1197: a connect dials a third party with a password the caller picked,
// so each signed-in person gets 10 tries per 10 minutes on the route, not per
// workspace, and an office NAT does not pool everyone's budget.
func TestEmailHubConnectBudgetsEachSignedInUser(t *testing.T) {
	h, minter := limitedMux(t)
	const office = "10.20.0.9"
	const path = "/api/v1/workspaces/w1/email-hub/accounts"
	a := caller{ip: office, bearer: mustMint(t, minter, "user-a")}
	a.spend(t, h, http.MethodPost, path, 10)
	a.wantRefused(t, h, http.MethodPost, path, "10 connects per 10 minutes")
	a.wantRefused(t, h, http.MethodPost, "/api/v1/workspaces/w2/email-hub/accounts", "the budget is per route, not per workspace")
	a.spend(t, h, http.MethodGet, path, 5) // listing mailboxes is not connecting one

	b := caller{ip: office, bearer: mustMint(t, minter, "user-b")}
	b.spend(t, h, http.MethodPost, path, 10)
}
```

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
cd server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' go test ./internal/service/ -run 'TestEmailHubConnect|TestEmailHubReconnect|TestEmailHubConcurrentConnects|TestEmailHubDisconnectAudits' -count=1
```
Expected: build failure listing `undefined: ErrEmailHubAlreadyConnected`, `svc.testHookVerify undefined`, `svc.testHookInitialSync undefined`, `undefined: audit.ActionEmailHubAccountConnected`, `undefined: ErrEmailHubTLSRequired` and `undefined: ErrEmailHubUnreachable`.

```bash
cd server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' go test ./internal/handler/router/ -run TestEmailHubConnectBudgetsEachSignedInUser -count=1
```
Expected: `POST /api/v1/workspaces/w1/email-hub/accounts: status 200, want 429 (10 connects per 10 minutes)`.

```bash
cd server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' go test ./internal/handler/ -run TestEmailHubConnectAlreadyConnectedIs409 -count=1
```
Expected: `duplicate connect: 400 …`. Today `Connect` dials first and returns `email_hub_connect_failed` or `invalid_request`.

- [ ] **Step 3: Implement**

3a. `server/internal/audit/actions.go`: add one line under the Email Hub constants (Task 5 already added `ActionEmailHubAccountAuthFailed`):

```go
	ActionEmailHubAccountConnected    = "email_hub_account.connected"
```

3b. `server/internal/service/email_hub.go`:
- Delete `type ConnectEmailHubInput struct {…}` and the whole `func (s *EmailHubService) Connect(…)`.
- In the `EmailHubService` struct, after `testHookScheduledSend`, add:

```go
	// testHookVerify replaces the IMAP+SMTP login check and testHookInitialSync
	// the first sync after Connect; both are set only in tests.
	testHookVerify      func(ctx context.Context, imap imapclient.Credentials, smtp smtpclient.Credentials) error
	testHookInitialSync func(ctx context.Context, acc db.EmailHubAccount)
```
Run `goimports`/`gofmt`; delete only an import `go build` reports unused. Do not touch `Disconnect`: Task 5 already writes its audit row.

3c. Create `server/internal/service/email_hub_connect.go`:

```go
package service

import (
	"context"
	"crypto/tls"
	"encoding/base64"
	"errors"
	"net"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/emailhub"
	"github.com/unicomhub/uniwork/server/internal/emailhub/imapclient"
	"github.com/unicomhub/uniwork/server/internal/emailhub/netguard"
	"github.com/unicomhub/uniwork/server/internal/emailhub/smtpclient"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

var (
	ErrEmailHubAlreadyConnected = errors.New("email already connected")
	ErrEmailHubTLSRequired      = errors.New("mail server does not offer the required tls mode")
	ErrEmailHubUnreachable      = errors.New("mail server unreachable")
)

type ConnectEmailHubInput struct {
	EmailAddress string
	AppPassword  string
}

// Connect verifies a mailbox and stores it in the order spec §5.2 fixes:
// membership, fields, the duplicate check (before any dial), the login, then
// one transaction for the row and its audit. An address that needs a
// reconnect keeps its id and its cached mail.
func (s *EmailHubService) Connect(ctx context.Context, actor Actor, workspaceID string, in ConnectEmailHubInput) (EmailHubAccountView, error) {
	if !s.Enabled() {
		return EmailHubAccountView{}, ErrEmailHubNotConfigured
	}
	ws, err := s.workspace(ctx, actor, workspaceID)
	if err != nil {
		return EmailHubAccountView{}, err
	}
	email := strings.ToLower(strings.TrimSpace(in.EmailAddress))
	password := strings.TrimSpace(in.AppPassword)
	if email == "" || password == "" {
		return EmailHubAccountView{}, Invalid("email and app password required")
	}
	prov, ok := emailhub.ProviderForEmail(email)
	if !ok {
		return EmailHubAccountView{}, ErrEmailHubUnsupported
	}
	byAddress := db.GetActiveEmailHubAccountByAddressParams{
		OrganizationID: ws.OrganizationID, UserID: actor.ID, Email: email,
	}
	existing, err := s.q.GetActiveEmailHubAccountByAddress(ctx, byAddress)
	switch {
	case err == nil && sameEmailHubConnection(existing, "password", prov.IMAPHost, prov.IMAPPort):
		return EmailHubAccountView{}, ErrEmailHubAlreadyConnected
	case err != nil && !errors.Is(err, pgx.ErrNoRows):
		return EmailHubAccountView{}, err
	}
	imapCreds := imapclient.Credentials{
		Host: prov.IMAPHost, Port: prov.IMAPPort, Email: email, Password: password, Security: "tls",
	}
	smtpCreds := smtpclient.Credentials{
		Host: prov.SMTPHost, Port: prov.SMTPPort, Email: email, Password: password, Security: "starttls",
	}
	if err := s.verifyEmailHubLogin(ctx, imapCreds, smtpCreds); err != nil {
		code, mapped := classifyEmailHubConnectError(err)
		s.log.Warn("email hub connect verify failed", "code", code, "provider", prov.Name, "user_id", actor.ID)
		return EmailHubAccountView{}, mapped
	}
	sealed, err := s.box.Seal([]byte(password))
	if err != nil {
		return EmailHubAccountView{}, err
	}
	row, err := s.saveEmailHubConnection(ctx, actor, byAddress, prov, base64.StdEncoding.EncodeToString(sealed))
	if err != nil {
		return EmailHubAccountView{}, err
	}
	s.gov.loginSucceeded(row.ID) // a reconnect starts a fresh run of refused LOGINs
	if s.testHookInitialSync != nil {
		s.testHookInitialSync(ctx, row)
	} else if _, _, syncErr := s.syncAccount(ctx, row, false, true); syncErr != nil {
		s.log.Warn("email hub initial sync failed", "account_id", row.ID, "err", syncErr)
	}
	updated, err := s.q.GetEmailHubAccount(ctx, db.GetEmailHubAccountParams{
		ID: row.ID, UserID: actor.ID, OrganizationID: ws.OrganizationID,
	})
	if err != nil {
		return accountView(row), nil
	}
	return accountView(updated), nil
}

func (s *EmailHubService) verifyEmailHubLogin(ctx context.Context, imap imapclient.Credentials, smtp smtpclient.Credentials) error {
	if s.testHookVerify != nil {
		return s.testHookVerify(ctx, imap, smtp)
	}
	if err := imapclient.VerifyLogin(imap); err != nil {
		return err
	}
	return smtpclient.VerifyLogin(smtp)
}

// saveEmailHubConnection writes verified credentials and the connected audit
// row in one transaction. It re-reads the address inside it, because a racing
// request may have connected or disconnected the mailbox since the pre-dial
// check. The UPDATE takes the row lock itself (so markAuthFailed with the old
// credential_version then matches nothing), and a disconnect that committed
// first shows on the row it returns.
func (s *EmailHubService) saveEmailHubConnection(
	ctx context.Context, actor Actor, byAddress db.GetActiveEmailHubAccountByAddressParams,
	prov emailhub.Provider, passwordEnc string,
) (db.EmailHubAccount, error) {
	tx, err := s.ws.pool.Begin(ctx)
	if err != nil {
		return db.EmailHubAccount{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)
	existing, err := qtx.GetActiveEmailHubAccountByAddress(ctx, byAddress)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return db.EmailHubAccount{}, err
	}
	reconnected := err == nil
	var row db.EmailHubAccount
	switch {
	case reconnected && sameEmailHubConnection(existing, "password", prov.IMAPHost, prov.IMAPPort):
		return db.EmailHubAccount{}, ErrEmailHubAlreadyConnected
	case reconnected:
		row, err = qtx.UpdateEmailHubAccountCredentials(ctx, db.UpdateEmailHubAccountCredentialsParams{
			ID: existing.ID, OrganizationID: byAddress.OrganizationID, Provider: prov.Name,
			ImapHost: prov.IMAPHost, ImapPort: int32(prov.IMAPPort), ImapSecurity: "tls",
			SmtpHost: prov.SMTPHost, SmtpPort: int32(prov.SMTPPort), SmtpSecurity: "starttls",
			Username: "", AuthKind: "password", PasswordEnc: passwordEnc,
		})
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && row.DisconnectedAt.Valid) {
			return db.EmailHubAccount{}, ErrConflict // disconnected between the read and the write
		}
	default:
		row, err = qtx.CreateEmailHubAccount(ctx, db.CreateEmailHubAccountParams{
			ID: util.NewID(), UserID: byAddress.UserID, OrganizationID: byAddress.OrganizationID,
			EmailAddress: byAddress.Email, Provider: prov.Name,
			ImapHost: prov.IMAPHost, ImapPort: int32(prov.IMAPPort), ImapSecurity: "tls",
			SmtpHost: prov.SMTPHost, SmtpPort: int32(prov.SMTPPort), SmtpSecurity: "starttls",
			Username: "", AuthKind: "password", PasswordEnc: passwordEnc,
		})
		if isUniqueViolation(err) {
			return db.EmailHubAccount{}, ErrEmailHubAlreadyConnected // a concurrent Connect inserted first
		}
	}
	if err != nil {
		return db.EmailHubAccount{}, err
	}
	if err := auditRecorder.Record(ctx, qtx, audit.Entry{
		OrganizationID: byAddress.OrganizationID,
		Actor:          actor,
		Action:         audit.ActionEmailHubAccountConnected,
		ResourceType:   "email_hub_account",
		ResourceID:     row.ID,
		Metadata:       map[string]any{"auth_kind": row.AuthKind, "provider": row.Provider, "reconnected": reconnected},
	}); err != nil {
		return db.EmailHubAccount{}, err
	}
	return row, tx.Commit(ctx)
}

// sameEmailHubConnection reports whether acc is a live connection Connect
// would only duplicate: same auth kind and IMAP server, not awaiting a
// reconnect (spec §3).
func sameEmailHubConnection(acc db.EmailHubAccount, authKind, imapHost string, imapPort int) bool {
	return !acc.AuthFailedAt.Valid && acc.AuthKind == authKind &&
		strings.EqualFold(acc.ImapHost, imapHost) && int(acc.ImapPort) == imapPort
}

// classifyEmailHubConnectError maps a login-check failure to the code the log
// carries and the stable error the client sees. The raw error goes to neither:
// it holds the host and the server's replies (spec §7).
func classifyEmailHubConnectError(err error) (string, error) {
	var netErr net.Error
	var certErr *tls.CertificateVerificationError
	switch {
	case errors.Is(err, imapclient.ErrTLSRequired), errors.Is(err, smtpclient.ErrTLSRequired):
		return "tls_required", ErrEmailHubTLSRequired
	case errors.Is(err, smtpclient.ErrSMTPAuthDisabled):
		return "smtp_disabled", ErrEmailHubSMTPDisabled
	case errors.Is(err, imapclient.ErrAuthFailed), errors.Is(err, imapclient.ErrLoginRefused),
		errors.Is(err, smtpclient.ErrAuthFailed):
		return "auth_failed", ErrEmailHubConnectFailed
	case errors.Is(err, netguard.ErrHostNotAllowed):
		// A blocked host answers like an unknown one, so Connect is no DNS oracle; only the log tells them apart.
		return "host_not_allowed", ErrEmailHubUnreachable
	case errors.As(err, &netErr), errors.As(err, &certErr):
		return "unreachable", ErrEmailHubUnreachable
	default:
		return "connect_failed", ErrEmailHubConnectFailed
	}
}
```

3d. `server/internal/handler/email_hub.go`: in `connectEmailHubAccount`, add these cases to the `switch` after the `ErrEmailHubConnectFailed` case:

```go
		case errors.Is(err, service.ErrEmailHubAlreadyConnected):
			respondError(w, http.StatusConflict, "email_hub_already_connected", "This mailbox is already connected")
		case errors.Is(err, service.ErrEmailHubTLSRequired):
			respondError(w, http.StatusBadRequest, "email_hub_tls_required", "The mail server does not offer the required TLS mode")
		case errors.Is(err, service.ErrEmailHubUnreachable):
			respondError(w, http.StatusBadRequest, "email_hub_unreachable", "Could not reach the mail server")
```
`ErrEmailHubSMTPDisabled` is already mapped by `mapServiceError` (Task 6), the default branch. `ErrConflict` from a reconnect that races a disconnect falls through to `mapServiceError` and returns 409 `conflict`.

3e. `server/internal/handler/router/email_hub.go`: add `"net/http"` to the imports and change the signature and the connect route:

```go
func registerEmailHub(r api, h Routes, connectLimit func(http.Handler) http.Handler) {
```

```go
	r.With(connectLimit).Post("/workspaces/{workspaceID}/email-hub/accounts", h.ConnectEmailHubAccount, apiOp{
		summary: "Connect IMAP mailbox",
		description: "Verifies IMAP and SMTP login with an App Password, stores encrypted credentials, and runs an initial sync. " +
			"An address that needs a reconnect keeps its id and cached mail; a live one answers 409 email_hub_already_connected " +
			"before any dial. 10 requests per 10 minutes per user.",
		tags: []string{"email-hub"},
		sdi:  sdi.ConnectEmailHubAccountSDI{},
		sdo:  sdo.EmailHubAccountSDO{},
		auth: true,
	})
```

3f. `server/internal/handler/router/router.go`: replace `registerEmailHub(authed, h)` with:

```go
			// Connect dials a third party with a password the caller chose
			// (UNI-1197): per signed-in person and route, 10 per 10 minutes.
			emailHubConnectLimit := mw.RateLimitPerRoute(d.Redis, 10, 10*time.Minute, proxies, bearerUser(d.Minter))
			registerEmailHub(authed, h, emailHubConnectLimit)
```

3g. `server/internal/service/audit_coverage_test.go`: add this case (leave the Disconnected and AuthFailed cases Task 5 wrote as they are):

```go
		// UNI-1132: the owner connects a mailbox.
		audit.ActionEmailHubAccountConnected: func(t *testing.T, f *auditFixture) {
			w := f.build(t)
			svc := NewEmailHubService(f.q, f.ws, testEmailHubBox(t))
			stubEmailHubDial(svc, nil)
			if _, err := svc.Connect(f.ctx, Human(f.owner.ID), w.ID, ConnectEmailHubInput{
				EmailAddress: "audit-mailbox@gmail.com", AppPassword: "app-password-1",
			}); err != nil {
				t.Fatal(err)
			}
		},
```
In `auditActions()`, add `audit.ActionEmailHubAccountConnected,` right before `audit.ActionEmailHubAccountDisconnected,`.

- [ ] **Step 4: Run the tests and confirm they pass**

```bash
cd server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' go test ./internal/service/ -run 'TestEmailHubConnect|TestEmailHubReconnect|TestEmailHubConcurrentConnects|TestEmailHubListAndThreadLifecycle|TestEveryAuditedCommandWritesItsRow' -count=1 -race
cd server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' go test ./internal/handler/ -run 'TestEmailHub|TestIsolationMatrix|TestEveryBodyIDFieldHasAReferenceCase' -count=1
cd server && REDIS_TEST_URL='redis://localhost:6379/15' go test ./internal/handler/router/ -count=1
cd server && go test ./internal/ -run 'TestActorConstructedOnlyInService|TestLayering' -count=1
cd server && gofmt -l ./internal && go vet ./... && go tool staticcheck ./internal/service/ ./internal/handler/... ./internal/audit/
cd .. && node --test scripts/no-pii-log.test.mjs
```
Expected: every command passes, and `gofmt -l` prints nothing. The router run includes the OpenAPI catalogue tests, because `apiOp` changed.

- [ ] **Step 5: Commit**

```bash
git add server/internal/service/email_hub_connect.go server/internal/service/email_hub_connect_test.go \
  server/internal/service/email_hub.go server/internal/service/email_hub_integration_test.go \
  server/internal/service/audit_coverage_test.go server/internal/audit/actions.go \
  server/internal/handler/email_hub.go server/internal/handler/email_hub_test.go \
  server/internal/handler/router/email_hub.go server/internal/handler/router/router.go \
  server/internal/handler/router/email_hub_ratelimit_test.go
git commit -m "feat(email-hub): refuse duplicates before dialing and reconnect on the same id" \
  -m "Connect now checks membership, then input, then the active address before any login; a live mailbox answers 409 email_hub_already_connected, one that needs a reconnect keeps its id, cache and audit trail, and the unique index turns a racing insert into the same 409. Verify failures log a classified code, never the raw error. Connect writes email_hub_account.connected in the same transaction (UNI-1132); POST accounts is limited to 10 per 10 minutes per user (UNI-1197). Left out: cache cleanup on a server change and the custom-server fields (GD2), and the client's already_connected copy (client task)." \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Not done or not checked in this draft:
- **Row lock:** `GetActiveEmailHubAccountByAddress` (Task 1) ends in `FOR UPDATE`, so the re-read inside the transaction holds the row lock.
- **No watcher restart.** In GĐ1, `markAuthFailed` already stopped the watcher, and the client starts a new one when it subscribes again.
- **No cache cleanup on a server change.** That is left to GĐ2.
- Anchors were drafted before Tasks 1–6 existed; re-check them against the code when applying.

Risks:
- **Duplicate declarations.** This task declares `testHookVerify` and the three new error sentinels. If an earlier task already declared them, the build will fail on duplicates.
- **Disconnected row.** The case for `ActionEmailHubAccountDisconnected` in `audit_coverage_test.go` assumes the earlier `markAuthFailed` task stopped calling `disconnectOnAuthFailure`.

---

### Task 8: Sent copy dedupe by message_id

**Files:**
- Modify: `server/pkg/db/queries/email_hub.sql` (add `AdoptEmailHubSentCopy` right after `ListEmailHubThreadUIDsByFolder`, around line 403)
- Regenerate: `server/pkg/db/generated/email_hub.sql.go` (`make sqlc`)
- Modify: `server/internal/service/email_hub_sync.go`. In `syncAccountFolderSession` (around lines 203-211), replace the prune-then-upsert block. Add `cacheFolderItems` next to `pruneReconciledFolderCache`. In `upsertThreadItems` (around lines 343-381), adopt the matching row before each upsert in the Sent folder.
- Test: `server/internal/service/email_hub_sync_db_test.go` (append)

**Interfaces:**
- Consumes: `db.UpsertEmailHubThread`, `db.UpdateEmailHubThreadBody`, `db.GetEmailHubThread`, `db.ListEmailHubThreadUIDsByFolder`, `emailhub.FolderSent`, `emailhub.NormalizeMessageID`, `(*EmailHubService).upsertThreadItems`, `(*EmailHubService).pruneReconciledFolderCache`, and the test helpers `emailHubFixture` and `seedEmailHubAccount`.
- Produces:
  - `func (q *Queries) AdoptEmailHubSentCopy(ctx context.Context, arg AdoptEmailHubSentCopyParams) (int64, error)` with `AdoptEmailHubSentCopyParams{ImapUid int32; AccountID string; OrganizationID string; Folder string; MessageID string}`
  - `func (s *EmailHubService) cacheFolderItems(ctx context.Context, acc db.EmailHubAccount, logicalFolder string, items []imapclient.ThreadMeta, reconcile bool) error`

Why the order changes: `sendOutboundMail` writes the local Sent row with the placeholder UID `now.Unix() & 0x7fffffff`. That UID is larger than any real UID, so the reconcile prune (`imap_uid >= min(keep) AND NOT IN keep`) deletes the row before the upsert ever sees it. The fix runs the upsert, which now includes the adoption, first. The prune runs after it. The prune result does not change, because every upserted UID is in `keep`.

- [ ] **Step 1: Write the failing test**

Append to `server/internal/service/email_hub_sync_db_test.go`. `fmt` is already imported (Task 1); add no imports. `context`, `slices`, `testing`, `time`, `pgtype`, `emailhub`, `imapclient`, `util` and `db` are already imported.

```go
// A sent message is cached locally under a placeholder UID; when sync meets the
// server's copy (Gmail/M365 file it in Sent themselves) the local row takes the
// real UID and keeps its id and cached body, so the message shows once.
func TestEmailHubSentSyncAdoptsTheLocalSentRow(t *testing.T) {
	for _, reconcile := range []bool{false, true} {
		t.Run(fmt.Sprintf("reconcile=%v", reconcile), func(t *testing.T) {
			svc, q, user, ws, _ := emailHubFixture(t)
			ctx := context.Background()
			acc := seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID)
			now := time.Now().UTC()

			// The row sendOutboundMail writes after a successful SMTP send.
			local, err := q.UpsertEmailHubThread(ctx, db.UpsertEmailHubThreadParams{
				ID: util.NewID(), AccountID: acc.ID, OrganizationID: ws.OrganizationID,
				Folder: emailhub.FolderSent, ImapUid: int32(now.Unix() & 0x7fffffff),
				MessageID: pgtype.Text{String: "<abc123@gmail.com>", Valid: true},
				Subject:   "Quarterly report", Snippet: "see attached", FromAddr: acc.EmailAddress,
				ToAddrs: []string{"boss@example.com"}, SentAt: pgtype.Timestamptz{Time: now, Valid: true},
				IsRead: true, ImapLabels: []string{}, ConversationKey: "mid:<abc123@gmail.com>",
			})
			if err != nil {
				t.Fatal(err)
			}
			if _, err := q.UpdateEmailHubThreadBody(ctx, db.UpdateEmailHubThreadBodyParams{
				ID: local.ID, BodyText: pgtype.Text{String: "see attached", Valid: true},
			}); err != nil {
				t.Fatal(err)
			}

			// The server's Sent folder: our message (header case differs) and an older one.
			items := []imapclient.ThreadMeta{
				{
					UID: 5, MessageID: "<older@gmail.com>", Subject: "Older", FromAddr: acc.EmailAddress,
					ToAddrs: []string{"x@example.com"}, SentAt: now.Add(-time.Hour), IsRead: true,
				},
				{
					UID: 7, MessageID: "<ABC123@gmail.com>", Subject: "Quarterly report", FromAddr: acc.EmailAddress,
					ToAddrs: []string{"boss@example.com"}, SentAt: now, IsRead: true,
				},
			}
			for range 2 { // a second sync must not change anything
				if err := svc.cacheFolderItems(ctx, acc, emailhub.FolderSent, items, reconcile); err != nil {
					t.Fatal(err)
				}
			}

			uids, err := q.ListEmailHubThreadUIDsByFolder(ctx, db.ListEmailHubThreadUIDsByFolderParams{
				AccountID: acc.ID, OrganizationID: ws.OrganizationID, Folder: emailhub.FolderSent,
			})
			if err != nil {
				t.Fatal(err)
			}
			slices.Sort(uids)
			if !slices.Equal(uids, []int32{5, 7}) {
				t.Fatalf("Sent UIDs = %v, want [5 7] (the sent message exactly once)", uids)
			}
			got, err := q.GetEmailHubThread(ctx, db.GetEmailHubThreadParams{
				ID: local.ID, AccountID: acc.ID, OrganizationID: ws.OrganizationID,
			})
			if err != nil {
				t.Fatalf("local Sent row must survive with its id: %v", err)
			}
			if got.ImapUid != 7 || !got.BodyCached {
				t.Fatalf("adopted row: uid=%d body_cached=%v, want uid 7 with the body kept", got.ImapUid, got.BodyCached)
			}
		})
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' go test ./internal/service/ -run TestEmailHubSentSyncAdoptsTheLocalSentRow -count=1
```

Expected: build failure `svc.cacheFolderItems undefined (type *EmailHubService has no field or method cacheFolderItems)`.

- [ ] **Step 3: Add the query and regenerate**

In `server/pkg/db/queries/email_hub.sql`, directly after the `ListEmailHubThreadUIDsByFolder` block, add:

```sql
-- name: AdoptEmailHubSentCopy :execrows
-- The Sent row the send path cached under a placeholder UID takes the UID of
-- the server's copy (same Message-ID), keeping its id, cached body and AI
-- summary. One row at most; a no-op when a row already owns that UID.
UPDATE email_hub_threads t
SET imap_uid = sqlc.arg('imap_uid')
WHERE t.id = (
    SELECT cur.id
    FROM email_hub_threads cur
    WHERE cur.account_id = sqlc.arg('account_id')
      AND cur.organization_id = sqlc.arg('organization_id')
      AND cur.folder = sqlc.arg('folder')
      AND lower(cur.message_id) = lower(sqlc.arg('message_id')::text)
      AND cur.imap_uid <> sqlc.arg('imap_uid')
    ORDER BY cur.id
    LIMIT 1
  )
  AND NOT EXISTS (
    SELECT 1
    FROM email_hub_threads o
    WHERE o.account_id = sqlc.arg('account_id')
      AND o.folder = sqlc.arg('folder')
      AND o.imap_uid = sqlc.arg('imap_uid')
  );
```

`organization_id = sqlc.arg(` satisfies `paramTenantForward` in `server/migrations/query_scope_test.go`, so the query needs no `-- tenant:` line. No migration is needed: `message_id`, `folder` and `imap_uid` already exist, and `idx_email_hub_threads_account_folder_uid` covers the `(account_id, folder)` prefix.

```bash
make sqlc
```

- [ ] **Step 4: Adopt the row before each Sent upsert**

In `server/internal/service/email_hub_sync.go`, inside the `upsertThreadItems` loop, insert this block between the `convKey := ...` line and `row, err := s.q.UpsertEmailHubThread(...)`:

```go
		if logicalFolder == emailhub.FolderSent && it.MessageID != "" {
			// The local copy written after SMTP send becomes this server row, so
			// the upsert below updates it instead of inserting a duplicate.
			if _, err := s.q.AdoptEmailHubSentCopy(ctx, db.AdoptEmailHubSentCopyParams{
				ImapUid: int32(it.UID), AccountID: acc.ID, OrganizationID: acc.OrganizationID,
				Folder: logicalFolder, MessageID: emailhub.NormalizeMessageID(it.MessageID),
			}); err != nil {
				s.log.Warn("email hub sent copy adopt failed",
					"account_id", acc.ID, "uid", it.UID, "err", err)
			}
		}
```

- [ ] **Step 5: Upsert before the reconcile prune**

In `syncAccountFolderSession`, replace:

```go
	if reconcile {
		if err := s.pruneReconciledFolderCache(ctx, acc, logicalFolder, result.Items); err != nil {
			return state, 0, err
		}
	}

	if _, err := s.upsertThreadItems(ctx, acc, logicalFolder, result.Items); err != nil {
		return state, 0, err
	}
```

with:

```go
	if err := s.cacheFolderItems(ctx, acc, logicalFolder, result.Items, reconcile); err != nil {
		return state, 0, err
	}
```

Add the helper directly above `emailHubReconcileKeepUIDs`:

```go
// cacheFolderItems writes one fetched batch. The upsert runs before the
// reconcile prune so a Sent row cached under a placeholder UID can adopt its
// server UID first; the prune still runs when an upsert failed, as before.
func (s *EmailHubService) cacheFolderItems(
	ctx context.Context, acc db.EmailHubAccount, logicalFolder string, items []imapclient.ThreadMeta, reconcile bool,
) error {
	_, upsertErr := s.upsertThreadItems(ctx, acc, logicalFolder, items)
	if reconcile {
		if err := s.pruneReconciledFolderCache(ctx, acc, logicalFolder, items); err != nil {
			return err
		}
	}
	return upsertErr
}
```

- [ ] **Step 6: Run tests to verify pass**

```bash
cd server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' REDIS_TEST_URL='redis://localhost:6379/15' go test ./internal/service/ -run 'TestEmailHubSentSyncAdoptsTheLocalSentRow|TestEmailHubReconcilePruneStaysInsideTheFetchedWindow|TestEmailHubUpsertThreadItems|TestEmailHubUpsertKeepsBodySnippet' -count=1
cd server && TEST_DATABASE_URL='postgres://uniwork:uniwork@localhost:5432/uniwork_uni_1237_498_test?sslmode=disable' go test ./migrations/ -run 'TestEveryQueryNamesItsTenant|TestTenantReasonsSitOnTenantQueries' -count=1
cd server && gofmt -l ./internal/service && go vet ./internal/service/ && go tool staticcheck ./internal/service/
```

Expected: all PASS, and `gofmt -l` prints nothing.

- [ ] **Step 7: Commit**

```bash
git add server/pkg/db/queries/email_hub.sql server/pkg/db/generated/email_hub.sql.go server/internal/service/email_hub_sync.go server/internal/service/email_hub_sync_db_test.go
git commit -m "fix(email-hub): merge the local Sent row with the server copy by Message-ID" -m "Gmail/M365 file sent mail in Sent themselves, so the row cached after SMTP send (placeholder UID) showed twice. Sync now moves that row onto the server UID, keeping its id, body and AI summary, and the upsert runs before the reconcile prune so the prune no longer drops it first. Left out: APPEND for custom servers (GD2); duplicates already in the cache are left alone, and the next reconcile removes the placeholder row."
```

---

I didn't check the full send → IMAP sync path. The service package has no fake IMAP or SMTP, so the test seeds the row the way `sendOutboundMail` writes it and calls `cacheFolderItems` directly. Line numbers will move once earlier GĐ1 tasks change `email_hub_sync.go`.

Risk: if a server's Sent folder holds the same Message-ID under two UIDs, one cached row can move between those UIDs from one sync to the next. It is still shown only once, but which UID it carries is not fixed.

---

### Task 9: Client — account schema, live-sync gating, reconnect UI, i18n

**Files:**
- Modify: `packages/core/types/email-hub.ts:3-9` (`EmailHubAccountSchema`)
- Test: `packages/core/api/endpoints/email-hub.test.ts` (after the `listEmailHubAccounts degrades…` case, ~line 58)
- Modify: `packages/core/email-hub/hooks-sync.ts:1-4, 189-261` (`useEmailHubLiveSync`)
- Modify: `packages/core/email-hub/query-cache.ts:119` (comment only)
- Test: `packages/core/email-hub/hooks-sync.test.tsx`
- Modify: `packages/core/i18n/locales/vi.json`, `packages/core/i18n/locales/en.json` (`email_hub.connect.*`, new `email_hub.reconnect.*`)
- Create: `packages/views/email-hub/email-hub-reconnect-banner.tsx`
- Modify: `packages/views/email-hub/email-hub-account-menu.tsx`
- Modify: `packages/views/email-hub/use-email-hub-account-panel.ts`
- Modify: `packages/views/email-hub/email-hub-view-list-panel.tsx:216-245`
- Modify: `packages/views/email-hub/connect-account-dialog.tsx`
- Modify: `packages/views/email-hub/email-hub-view-dialogs.tsx`
- Modify: `packages/views/email-hub/email-hub-view.tsx` (lines 69, 104, 204, 275, 341-342, 366, 409). This file is already at 495 of the 500 counted lines, so it gets at most +2 lines.
- Test: `packages/views/email-hub/email-hub-redesign.test.tsx` (fixtures plus new cases), Create `packages/views/email-hub/connect-account-dialog.test.tsx`

**Interfaces:**
- Consumes: `EmailHubAccountSDO` JSON fields `auth_kind`, `needs_reconnect`, `auth_failed_reason` (Task 6). API error codes `email_hub_reauth_required` (409), `email_hub_already_connected` (409), `email_hub_smtp_disabled`, `email_hub_tls_required`, `email_hub_unreachable` (400). Existing `ApiError` / `errorCode` from `packages/core/api/http.ts` and `emailHubKeys.accounts(wsId)` from `packages/core/email-hub/query-cache.ts`.
- Produces:
  - `EmailHubAccount` gains `auth_kind: string; needs_reconnect: boolean; auth_failed_reason: string`. All three are required in the output type, because `.default()` fills them.
  - `useEmailHubLiveSync(wsId, accountId, enabled = true, readingEmail = false)`: same signature. A 409 `email_hub_reauth_required` from subscribe or pull invalidates `emailHubKeys.accounts(wsId)` once for each `(wsId, accountId, enabled)` run.
  - `EmailHubAccountMenuProps.onReconnect: (accountId: string) => void`
  - `useEmailHubAccountPanel(accountList, accountId, setAccountId, setSelectedId, openConnect: (email: string) => void, disconnect, onDisconnectError)`
  - `ConnectAccountDialog` prop `reconnectEmail?: string`
  - `EmailHubViewDialogs` props `connectEmail: string | null; onConnectEmailChange: (email: string | null) => void`. These replace `connectOpen` / `onConnectOpenChange`.
  - `EmailHubViewListPanel` prop `reconnect?: () => void`
  - `export function EmailHubReconnectBanner({ onReconnect }: { onReconnect: () => void })`

---

- [ ] **Step 1: Write the failing core tests**

Append to `packages/core/api/endpoints/email-hub.test.ts`, inside `describe("email hub endpoints", …)`, right after the `listEmailHubAccounts degrades to empty list when malformed` case:

```ts
  it("listEmailHubAccounts fills the reconnect fields an older server leaves out", async () => {
    const acc = { id: "acc1", email_address: "a@gmail.com", provider: "gmail", connected_at: "2026-09-01T00:00:00Z" };
    vi.mocked(fetch).mockResolvedValueOnce(json({ accounts: [acc] }));
    await expect(listEmailHubAccounts("ws1")).resolves.toEqual({
      accounts: [{ ...acc, auth_kind: "password", needs_reconnect: false, auth_failed_reason: "" }],
    });
  });

  it("listEmailHubAccounts keeps needs_reconnect and degrades when it is not a boolean", async () => {
    const acc = {
      id: "acc1",
      email_address: "a@gmail.com",
      provider: "gmail",
      connected_at: "2026-09-01T00:00:00Z",
      auth_kind: "password",
      needs_reconnect: true,
      auth_failed_reason: "imap_auth_failed",
    };
    vi.mocked(fetch).mockResolvedValueOnce(json({ accounts: [acc] }));
    await expect(listEmailHubAccounts("ws1")).resolves.toEqual({ accounts: [acc] });

    vi.mocked(fetch).mockResolvedValueOnce(json({ accounts: [{ ...acc, needs_reconnect: "yes" }] }));
    await expect(listEmailHubAccounts("ws1")).resolves.toEqual({ accounts: [] });
  });
```

Replace `packages/core/email-hub/hooks-sync.test.tsx` with:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/http";
import { useEmailHubLiveSync } from "./hooks-sync";

vi.mock("../api/endpoints/email-hub", () => ({
  subscribeEmailHubInboxWatch: vi.fn(() => Promise.resolve({ subscribed: true })),
  unsubscribeEmailHubInboxWatch: vi.fn(() => Promise.resolve({ subscribed: false })),
  syncEmailHub: vi.fn(() => Promise.resolve({ synced: false })),
}));

const api = await import("../api/endpoints/email-hub");

function wrapperFor(qc: QueryClient) {
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(() => vi.clearAllMocks());

describe("useEmailHubLiveSync", () => {
  it("keeps the server watch when the reader opens a message, and drops it on unmount", () => {
    const qc = new QueryClient();
    const { rerender, unmount } = renderHook(
      ({ reading }: { reading: boolean }) => useEmailHubLiveSync("ws1", "acc1", true, reading),
      { wrapper: wrapperFor(qc), initialProps: { reading: false } },
    );
    rerender({ reading: true });
    // The server stops the watch on DELETE, so a toggle must not send one.
    expect(api.unsubscribeEmailHubInboxWatch).not.toHaveBeenCalled();
    expect(api.subscribeEmailHubInboxWatch).toHaveBeenCalledTimes(1);

    unmount();
    expect(api.unsubscribeEmailHubInboxWatch).toHaveBeenCalledTimes(1);
  });

  it("sends neither a watch nor a pull while disabled", () => {
    const qc = new QueryClient();
    renderHook(() => useEmailHubLiveSync("ws1", "acc1", false), { wrapper: wrapperFor(qc) });
    expect(api.subscribeEmailHubInboxWatch).not.toHaveBeenCalled();
    expect(api.syncEmailHub).not.toHaveBeenCalled();
  });

  it("refetches the account list once when the mailbox needs reconnecting", async () => {
    const reauth = () => new ApiError("needs reconnect", "email_hub_reauth_required", 409);
    vi.mocked(api.subscribeEmailHubInboxWatch).mockRejectedValueOnce(reauth());
    vi.mocked(api.syncEmailHub).mockRejectedValueOnce(reauth());
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");

    renderHook(() => useEmailHubLiveSync("ws1", "acc1"), { wrapper: wrapperFor(qc) });

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["email-hub", "ws1", "accounts"] }));
    await waitFor(() => expect(api.syncEmailHub).toHaveBeenCalled());
    // Both the watch and the pull answered 409; one refetch is enough to bring needs_reconnect.
    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it("does not touch the account list on an ordinary failure", async () => {
    vi.mocked(api.subscribeEmailHubInboxWatch).mockRejectedValueOnce(new Error("offline"));
    vi.mocked(api.syncEmailHub).mockRejectedValueOnce(new ApiError("boom", "internal", 500));
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");

    renderHook(() => useEmailHubLiveSync("ws1", "acc1"), { wrapper: wrapperFor(qc) });

    await waitFor(() => expect(api.syncEmailHub).toHaveBeenCalled());
    await Promise.resolve();
    expect(invalidate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the core tests to verify they fail**

```bash
pnpm --filter @uniwork/core exec vitest run api/endpoints/email-hub.test.ts email-hub/hooks-sync.test.tsx
```

Expected:
- `fills the reconnect fields…` fails: `toEqual` reports that `auth_kind`, `needs_reconnect` and `auth_failed_reason` are missing.
- `keeps needs_reconnect…` fails, because zod strips the unknown keys.
- `refetches the account list once…` fails, because `invalidateQueries` is never called (the `catch {}` swallows the 409).

- [ ] **Step 3: Implement the schema and hook**

`packages/core/types/email-hub.ts`, replacing lines 3-9:

```ts
export const EmailHubAccountSchema = z.object({
  id: z.string(),
  email_address: z.string(),
  provider: z.string(),
  connected_at: z.string(),
  last_sync_at: z.string().optional(),
  // An older server sends none of these; the defaults read as a healthy password account.
  auth_kind: z.string().default("password"),
  needs_reconnect: z.boolean().default(false),
  auth_failed_reason: z.string().default(""),
});
```

`packages/core/email-hub/hooks-sync.ts`, replacing lines 1-4:

```ts
import { useEffect, useRef, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { errorCode } from "../api/http";
import * as api from "../api/endpoints/email-hub";
import { emailHubKeys, invalidateEmailHubThreadsForAccount, invalidateEmailHubUnread } from "./query-cache";
```

In the same file, replace everything from `const emailHubLivePollMs = 45_000;` to the end of the file with:

```ts
const emailHubLivePollMs = 45_000;
const emailHubSafetyPollMs = 5 * 60_000;

/**
 * A 409 email_hub_reauth_required means the cached account list is stale. Refetch it
 * once: it brings needs_reconnect, and the page then turns this hook off.
 */
function refetchAccountsOnReauth(err: unknown, seen: { current: boolean }, qc: QueryClient, wsId: string) {
  if (seen.current || errorCode(err) !== "email_hub_reauth_required") return;
  seen.current = true;
  void qc.invalidateQueries({ queryKey: emailHubKeys.accounts(wsId) });
}

/**
 * Server-side INBOX watch while Email Hub is open. Changes arrive via WebSocket;
 * heartbeat re-subscribes after reconnect. Rare poll when not reading a message.
 */
export function useEmailHubLiveSync(
  wsId: string,
  accountId: string | null,
  enabled = true,
  readingEmail = false,
) {
  const qc = useQueryClient();
  const reauthSeen = useRef(false);
  // The server stops the watch on DELETE and keeps it while heartbeats renew
  // its lease, so this effect must not re-run when the reader opens a message.
  useEffect(() => {
    if (!enabled || !accountId) return;
    reauthSeen.current = false;
    let cancelled = false;

    const subscribe = async () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      try {
        await api.subscribeEmailHubInboxWatch(wsId, accountId);
      } catch (err) {
        refetchAccountsOnReauth(err, reauthSeen, qc, wsId);
      }
    };

    void subscribe();
    const heartbeat = window.setInterval(() => {
      if (!cancelled) void subscribe();
    }, emailHubLivePollMs);
    const onVisible = () => void subscribe();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", onVisible);
      void api.unsubscribeEmailHubInboxWatch(wsId, accountId).catch(() => {});
    };
  }, [wsId, accountId, enabled, qc]);

  useEffect(() => {
    if (!enabled || !accountId) return;

    const pullInbox = async () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      try {
        const res = await api.syncEmailHub(wsId, accountId, "INBOX", false, true, false);
        if (res.synced) {
          invalidateEmailHubThreadsForAccount(qc, wsId, accountId);
          invalidateEmailHubUnread(qc, wsId);
        }
      } catch (err) {
        refetchAccountsOnReauth(err, reauthSeen, qc, wsId);
      }
    };

    void pullInbox();
    let fallbackTimer: number | undefined;
    if (!readingEmail) {
      fallbackTimer = window.setInterval(() => {
        void pullInbox();
      }, emailHubSafetyPollMs);
    }
    const onVisible = () => void pullInbox();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (fallbackTimer !== undefined) window.clearInterval(fallbackTimer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [wsId, accountId, enabled, readingEmail, qc]);
}
```

`packages/core/email-hub/query-cache.ts:119`, comment only:

```ts
  // inbox_changed also announces a mailbox whose login the server now refuses (needs_reconnect).
```

- [ ] **Step 4: Run the core tests to verify they pass**

```bash
pnpm --filter @uniwork/core exec vitest run api/endpoints/email-hub.test.ts email-hub/hooks-sync.test.tsx
```

Expected: all cases pass.

- [ ] **Step 5: Add the i18n keys (vi first, then en)**

In `packages/core/i18n/locales/vi.json`, replace the `connect` block's last line `      "submitting": "Đang kết nối…"` with:

```json
      "submitting": "Đang kết nối…",
      "error_already_connected": "Hộp thư này đã được kết nối.",
      "error_reauth_required": "Hộp thư này cần kết nối lại. Nhập App Password mới rồi thử lại.",
      "error_smtp_disabled": "Đăng nhập được nhưng máy chủ đã tắt gửi thư qua SMTP cho hộp thư này. Nhờ quản trị viên bật SMTP AUTH rồi thử lại.",
      "error_tls_required": "Máy chủ thư không hỗ trợ kết nối mã hóa nên UniWork không kết nối. Kiểm tra cài đặt máy chủ rồi thử lại.",
      "error_unreachable": "Không kết nối được tới máy chủ thư. Kiểm tra địa chỉ email rồi thử lại sau."
```

In the same file, replace `    "disconnect_error": "Không ngắt kết nối được hộp thư. Thử lại.",` with:

```json
    "disconnect_error": "Không ngắt kết nối được hộp thư. Thử lại.",
    "reconnect": {
      "badge": "Cần kết nối lại",
      "menu": "Kết nối lại {{email}}",
      "action": "Kết nối lại",
      "banner_title": "Hộp thư cần kết nối lại",
      "banner_body": "UniWork không đăng nhập được vào hộp thư này nên chưa nhận hay gửi được thư mới. Thư đã tải về vẫn đọc được.",
      "dialog_title": "Kết nối lại {{email}}",
      "dialog_description": "Nhập App Password mới cho hộp thư này. Thư đã tải về được giữ nguyên."
    },
```

In `packages/core/i18n/locales/en.json`, replace `      "submitting": "Connecting…"` with:

```json
      "submitting": "Connecting…",
      "error_already_connected": "This mailbox is already connected.",
      "error_reauth_required": "This mailbox needs reconnecting. Enter a new App Password and try again.",
      "error_smtp_disabled": "Signed in, but the server has SMTP sending turned off for this mailbox. Ask your admin to enable SMTP AUTH, then try again.",
      "error_tls_required": "The mail server doesn't support an encrypted connection, so UniWork won't connect. Check the server settings and try again.",
      "error_unreachable": "Couldn't reach the mail server. Check the email address and try again later."
```

In the same file, replace `    "disconnect_error": "Could not disconnect the mailbox. Try again.",` with:

```json
    "disconnect_error": "Could not disconnect the mailbox. Try again.",
    "reconnect": {
      "badge": "Needs reconnecting",
      "menu": "Reconnect {{email}}",
      "action": "Reconnect",
      "banner_title": "This mailbox needs reconnecting",
      "banner_body": "UniWork can't sign in to this mailbox, so new mail isn't arriving and nothing can be sent. Mail already synced is still readable.",
      "dialog_title": "Reconnect {{email}}",
      "dialog_description": "Enter a new App Password for this mailbox. Mail already synced stays as it is."
    },
```

The error keys stay flat `connect.error_*`, following the existing `error_connect_failed` / `error_unsupported` pattern. The spec's `errors.*` nesting is left for GĐ2, when the custom-server copy is rewritten.

- [ ] **Step 6: Write the failing views tests**

Edit `packages/views/email-hub/email-hub-redesign.test.tsx`.

1. Add an import below the existing `EmailHubAccountMenu` import:

```tsx
import { EmailHubReconnectBanner } from "./email-hub-reconnect-banner";
```

2. Replace the `account` fixture (lines 12-17). `.default()` makes the three fields required on `EmailHubAccount`, so the fixture needs them:

```tsx
const account = {
  id: "acc1",
  email_address: "ha.do@unicomhub.com",
  provider: "gmail",
  connected_at: "2026-09-01T00:00:00Z",
  auth_kind: "password",
  needs_reconnect: false,
  auth_failed_reason: "",
};
```

3. In the existing `asks before disconnecting a mailbox` case, add the `onReconnect={() => {}}` prop after `onAddAccount={() => {}}`. After the `findByRole("menuitem", { name: /Ngắt kết nối …/ })` line's click, the menu is closed, so put this assertion **before** that click:

```tsx
    expect(screen.queryByRole("menuitem", { name: /Kết nối lại/ })).not.toBeInTheDocument();
```

The full modified opening of that case:

```tsx
  it("asks before disconnecting a mailbox", async () => {
    const onDisconnect = vi.fn();
    render(
      <EmailHubAccountMenu
        accounts={[account]}
        activeAccountId="acc1"
        disconnectPending={false}
        onSelectAccount={() => {}}
        onDisconnect={onDisconnect}
        onAddAccount={() => {}}
        onReconnect={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Hộp thư: ha.do@unicomhub.com/ }));
    const disconnectItem = await screen.findByRole("menuitem", { name: /Ngắt kết nối ha.do@unicomhub.com/ });
    expect(screen.queryByRole("menuitem", { name: /Kết nối lại/ })).not.toBeInTheDocument();
    fireEvent.click(disconnectItem);
```

The rest of the case stays unchanged.

4. Add a new case inside `describe("EmailHubAccountMenu", …)`:

```tsx
  it("flags a mailbox that needs reconnecting and offers to reconnect it", async () => {
    const onReconnect = vi.fn();
    render(
      <EmailHubAccountMenu
        accounts={[{ ...account, needs_reconnect: true, auth_failed_reason: "imap_auth_failed" }]}
        activeAccountId="acc1"
        disconnectPending={false}
        onSelectAccount={() => {}}
        onDisconnect={() => {}}
        onAddAccount={() => {}}
        onReconnect={onReconnect}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Hộp thư: ha.do@unicomhub.com/ }));
    expect(await screen.findByText("Cần kết nối lại")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: /Kết nối lại ha.do@unicomhub.com/ }));
    expect(onReconnect).toHaveBeenCalledWith("acc1");
  });
```

5. Add a new describe block at the end of the file:

```tsx
describe("EmailHubReconnectBanner", () => {
  it("says the mailbox needs reconnecting, that synced mail stays, and offers the way back", () => {
    const onReconnect = vi.fn();
    render(<EmailHubReconnectBanner onReconnect={onReconnect} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Hộp thư cần kết nối lại");
    expect(alert).toHaveTextContent("Thư đã tải về vẫn đọc được.");
    fireEvent.click(within(alert).getByRole("button", { name: "Kết nối lại" }));
    expect(onReconnect).toHaveBeenCalled();
  });
});
```

6. In the `EmailHubFolderSidebar` case's `accountMenu` object, add `onReconnect: () => {},` after `onAddAccount: () => {},`.

Create `packages/views/email-hub/connect-account-dialog.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api/http";
import { requestMock, wrap } from "../test/api-mock";
import { ConnectAccountDialog } from "./connect-account-dialog";

const accountJSON = {
  id: "acc1",
  email_address: "ha.do@unicomhub.com",
  provider: "gmail",
  connected_at: "2026-09-01T00:00:00Z",
  auth_kind: "password",
  needs_reconnect: false,
  auth_failed_reason: "",
};

beforeEach(() => requestMock.mockReset());

function fillAndSubmit(email: string | null, submitName: string) {
  if (email !== null) fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("App Password"), { target: { value: "abcd efgh ijkl mnop" } });
  fireEvent.click(screen.getByRole("button", { name: submitName }));
}

describe("ConnectAccountDialog", () => {
  it("reconnects the named mailbox with a new app password, without letting the address change", async () => {
    requestMock.mockResolvedValue(accountJSON);
    const onConnected = vi.fn();
    render(
      wrap(
        <ConnectAccountDialog
          wsId="ws1"
          open
          reconnectEmail="ha.do@unicomhub.com"
          onOpenChange={() => {}}
          onConnected={onConnected}
        />,
      ),
    );

    expect(screen.getByText("Kết nối lại ha.do@unicomhub.com")).toBeInTheDocument();
    const email = screen.getByLabelText("Email");
    expect(email).toHaveValue("ha.do@unicomhub.com");
    expect(email).toHaveAttribute("readonly");

    fillAndSubmit(null, "Kết nối lại");

    await waitFor(() => expect(onConnected).toHaveBeenCalledWith("acc1"));
    expect(requestMock).toHaveBeenCalledWith("/api/v1/workspaces/ws1/email-hub/accounts", {
      method: "POST",
      body: { email_address: "ha.do@unicomhub.com", app_password: "abcdefghijklmnop" },
    });
  });

  it("puts an already-connected mailbox next to the email field", async () => {
    requestMock.mockRejectedValueOnce(new ApiError("already connected", "email_hub_already_connected", 409));
    render(wrap(<ConnectAccountDialog wsId="ws1" open onOpenChange={() => {}} />));

    fillAndSubmit("an@gmail.com", "Kết nối");

    const error = await screen.findByText("Hộp thư này đã được kết nối.");
    expect(error).toHaveAttribute("id", "email-hub-email-error");
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
  });

  it.each([
    ["email_hub_smtp_disabled", 400, "Đăng nhập được nhưng máy chủ đã tắt gửi thư qua SMTP"],
    ["email_hub_tls_required", 400, "Máy chủ thư không hỗ trợ kết nối mã hóa"],
    ["email_hub_unreachable", 400, "Không kết nối được tới máy chủ thư."],
    ["email_hub_reauth_required", 409, "Hộp thư này cần kết nối lại."],
  ])("reads %s out as a sentence for the whole form", async (code, status, text) => {
    requestMock.mockRejectedValueOnce(new ApiError("refused", code, status));
    render(wrap(<ConnectAccountDialog wsId="ws1" open onOpenChange={() => {}} />));

    fillAndSubmit("an@gmail.com", "Kết nối");

    expect(await screen.findByRole("alert")).toHaveTextContent(text);
  });
});
```

- [ ] **Step 7: Run the views tests to verify they fail**

```bash
pnpm --filter @uniwork/views exec vitest run email-hub/email-hub-redesign.test.tsx email-hub/connect-account-dialog.test.tsx
```

Expected:
- `email-hub-redesign.test.tsx` fails to import `./email-hub-reconnect-banner`, because the module does not exist yet.
- `connect-account-dialog.test.tsx` fails in two ways. The reconnect case cannot find the text "Kết nối lại ha.do@unicomhub.com". The error cases fall back to "Không kết nối được. Kiểm tra email và App Password." instead of the expected sentence.

- [ ] **Step 8: Implement the views**

Create `packages/views/email-hub/email-hub-reconnect-banner.tsx`:

```tsx
"use client";

import { CircleAlert, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@uniwork/ui/components/ui/alert";
import { Button } from "@uniwork/ui/components/ui/button";

/** Shown over the cached list while the mailbox's login is refused; synced mail stays readable below. */
export function EmailHubReconnectBanner({ onReconnect }: { onReconnect: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="px-3 pt-3 lg:px-4">
      <Alert variant="destructive">
        <CircleAlert aria-hidden />
        <AlertTitle>{t("email_hub.reconnect.banner_title")}</AlertTitle>
        <AlertDescription>{t("email_hub.reconnect.banner_body")}</AlertDescription>
        <div className="col-start-2 mt-2">
          <Button type="button" size="sm" variant="outline" onClick={onReconnect}>
            <RefreshCw aria-hidden />
            {t("email_hub.reconnect.action")}
          </Button>
        </div>
      </Alert>
    </div>
  );
}
```

`packages/views/email-hub/email-hub-account-menu.tsx`:

```diff
-import { ChevronsUpDown, Plus, Unplug } from "lucide-react";
+import { ChevronsUpDown, Plus, RefreshCw, Unplug } from "lucide-react";
 import { useTranslation } from "react-i18next";
 import type { EmailHubAccount } from "@uniwork/core/types/email-hub";
+import { Badge } from "@uniwork/ui/components/ui/badge";
 import {
```

```diff
   onDisconnect: (accountId: string, onDone: () => void) => void;
   onAddAccount: () => void;
+  onReconnect: (accountId: string) => void;
 }
```

```diff
   onDisconnect,
   onAddAccount,
+  onReconnect,
   className,
```

```diff
               {accounts.map((acc) => (
                 <DropdownMenuRadioItem key={acc.id} value={acc.id}>
                   <span className="truncate">{acc.email_address}</span>
+                  {acc.needs_reconnect ? (
+                    <Badge variant="destructive" className="ml-auto">
+                      {t("email_hub.reconnect.badge")}
+                    </Badge>
+                  ) : null}
                 </DropdownMenuRadioItem>
               ))}
```

```diff
           <DropdownMenuSeparator />
+          {active?.needs_reconnect ? (
+            <DropdownMenuItem onClick={() => onReconnect(active.id)}>
+              <RefreshCw aria-hidden />
+              {t("email_hub.reconnect.menu", { email: active.email_address })}
+            </DropdownMenuItem>
+          ) : null}
           <DropdownMenuItem onClick={onAddAccount}>
```

Replace `packages/views/email-hub/use-email-hub-account-panel.ts` with:

```ts
import { useCallback, useMemo } from "react";
import type { EmailHubAccount } from "@uniwork/core/types/email-hub";
import type { EmailHubAccountMenuProps } from "./email-hub-account-menu";

export function useEmailHubAccountPanel(
  accountList: EmailHubAccount[],
  accountId: string | null,
  setAccountId: (id: string | null) => void,
  setSelectedId: (id: string | null) => void,
  /** "" opens the connect dialog empty; an address reopens it to reconnect that mailbox. */
  openConnect: (email: string) => void,
  disconnect: {
    mutate: (id: string, opts?: { onSuccess?: () => void; onError?: (err: unknown) => void; onSettled?: () => void }) => void;
    isPending: boolean;
  },
  onDisconnectError: (err: unknown) => void,
): EmailHubAccountMenuProps {
  const selectAccount = useCallback(
    (id: string) => {
      setAccountId(id);
      setSelectedId(null);
    },
    [setAccountId, setSelectedId],
  );

  const disconnectAccount = useCallback(
    (id: string, onDone: () => void) => {
      disconnect.mutate(id, {
        onSuccess: () => {
          if (accountId === id) {
            setAccountId(null);
            setSelectedId(null);
          }
        },
        onError: onDisconnectError,
        onSettled: onDone,
      });
    },
    [accountId, disconnect, onDisconnectError, setAccountId, setSelectedId],
  );

  // GĐ1 accounts are all app-password accounts; GĐ3 picks the OAuth popup here by auth_kind.
  const reconnectAccount = useCallback(
    (id: string) => {
      const acc = accountList.find((item) => item.id === id);
      if (acc) openConnect(acc.email_address);
    },
    [accountList, openConnect],
  );

  return useMemo(
    () => ({
      accounts: accountList,
      activeAccountId: accountId,
      disconnectPending: disconnect.isPending,
      onSelectAccount: selectAccount,
      onDisconnect: disconnectAccount,
      onAddAccount: () => openConnect(""),
      onReconnect: reconnectAccount,
    }),
    [accountId, accountList, disconnect.isPending, disconnectAccount, openConnect, reconnectAccount, selectAccount],
  );
}
```

`packages/views/email-hub/email-hub-view-list-panel.tsx`:

```diff
 import { EmailHubListHeader, type EmailHubListHeaderProps } from "./email-hub-list-header";
+import { EmailHubReconnectBanner } from "./email-hub-reconnect-banner";
 import { EmailHubScheduledListItem } from "./email-hub-scheduled-list-item";
```

```diff
 export function EmailHubViewListPanel({
   header,
   state,
   handlers,
   returnFocusId,
+  reconnect,
 }: {
   header: EmailHubListHeaderProps;
   state: EmailHubListBodyState;
   handlers: EmailHubListRowHandlers;
   /** The email just closed: its row takes focus back, so Esc returns you to your place in the list. */
   returnFocusId: string | null;
+  /** Set while the mailbox's login is refused: a banner over the cached list offers to reconnect it. */
+  reconnect?: () => void;
 }) {
```

```diff
       <EmailHubListHeader {...header} />
+      {reconnect ? <EmailHubReconnectBanner onReconnect={reconnect} /> : null}
       <div className="@container min-h-0 flex-1 overflow-y-auto overscroll-contain">
```

`packages/views/email-hub/connect-account-dialog.tsx`:

```diff
 interface ConnectAccountDialogProps {
   wsId: string;
   open: boolean;
   onOpenChange: (open: boolean) => void;
   onConnected?: (accountId: string) => void;
+  /** Reconnect this mailbox: the address is fixed, only the password is asked again. */
+  reconnectEmail?: string;
 }
```

```diff
     case "email_hub_not_configured":
       return { field: "form", key: "email_hub.connect.error_not_configured" };
+    case "email_hub_already_connected":
+      return { field: "email", key: "email_hub.connect.error_already_connected" };
+    case "email_hub_reauth_required":
+      return { field: "form", key: "email_hub.connect.error_reauth_required" };
+    case "email_hub_smtp_disabled":
+      return { field: "form", key: "email_hub.connect.error_smtp_disabled" };
+    case "email_hub_tls_required":
+      return { field: "form", key: "email_hub.connect.error_tls_required" };
+    case "email_hub_unreachable":
+      return { field: "form", key: "email_hub.connect.error_unreachable" };
     default:
```

```diff
-export function ConnectAccountDialog({ wsId, open, onOpenChange, onConnected }: ConnectAccountDialogProps) {
+export function ConnectAccountDialog({ wsId, open, onOpenChange, onConnected, reconnectEmail }: ConnectAccountDialogProps) {
   const { t } = useTranslation();
   const [email, setEmail] = useState("");
+  const address = reconnectEmail ?? email;
   const [password, setPassword] = useState("");
```

```diff
   const submit = (event: FormEvent) => {
     event.preventDefault();
-    const trimmed = email.trim();
+    const trimmed = address.trim();
     if (!EMAIL_RE.test(trimmed)) {
```

```diff
-          <FormDialogHeader title={t("email_hub.connect.title")} description={t("email_hub.connect.description")} />
+          <FormDialogHeader
+            title={reconnectEmail ? t("email_hub.reconnect.dialog_title", { email: reconnectEmail }) : t("email_hub.connect.title")}
+            description={reconnectEmail ? t("email_hub.reconnect.dialog_description") : t("email_hub.connect.description")}
+          />
```

```diff
                   spellCheck={false}
-                  value={email}
+                  value={address}
+                  readOnly={reconnectEmail !== undefined}
                   onChange={(e) => {
```

```diff
-            submitLabel={t("email_hub.connect.submit")}
+            submitLabel={reconnectEmail ? t("email_hub.reconnect.action") : t("email_hub.connect.submit")}
             submittingLabel={t("email_hub.connect.submitting")}
             submitting={connect.isPending}
-            submitDisabled={!email.trim() || !password.trim()}
+            submitDisabled={!address.trim() || !password.trim()}
```

`packages/views/email-hub/email-hub-view-dialogs.tsx`:

```diff
 export function EmailHubViewDialogs({
   wsId,
   accountId,
-  connectOpen,
-  onConnectOpenChange,
+  connectEmail,
+  onConnectEmailChange,
   onConnected,
```

```diff
   accountId: string | null;
-  connectOpen: boolean;
-  onConnectOpenChange: (open: boolean) => void;
+  /** null: closed; "": connect a new mailbox; an address: reconnect that one. */
+  connectEmail: string | null;
+  onConnectEmailChange: (email: string | null) => void;
   onConnected: (id: string) => void;
```

```diff
-      <ConnectAccountDialog wsId={wsId} open={connectOpen} onOpenChange={onConnectOpenChange} onConnected={onConnected} />
+      <ConnectAccountDialog
+        wsId={wsId}
+        open={connectEmail !== null}
+        reconnectEmail={connectEmail || undefined}
+        onOpenChange={(open) => {
+          if (!open) onConnectEmailChange(null);
+        }}
+        onConnected={onConnected}
+      />
```

`packages/views/email-hub/email-hub-view.tsx`. The file has room for 5 more counted lines; this diff adds 1. The live-sync call moves below `activeAccount` because it now reads that value. It stays above the early returns, so the hook order does not change.

```diff
-  const [connectOpen, setConnectOpen] = useState(false);
+  const [connectEmail, setConnectEmail] = useState<string | null>(null);
```

```diff
   const hoverPrefetchTimers = useRef(new Map<string, number>());
-  useEmailHubLiveSync(wsId, accountId, folder === "INBOX" || folder === "STARRED", readingEmail && !isScheduledFolder);
 
   useEffect(() => {
```

```diff
   const activeAccount = accountList.find((acc) => acc.id === accountId);
+  // A mailbox that needs reconnecting answers every watch and pull with 409: keep them off.
+  useEmailHubLiveSync(wsId, accountId, (folder === "INBOX" || folder === "STARRED") && !activeAccount?.needs_reconnect, readingEmail && !isScheduledFolder);
   const aiOpen = wideAi ? aiRailOpen : aiSheetOpen;
```

```diff
     setSelectedId,
-    setConnectOpen,
+    setConnectEmail,
     disconnect,
```

```diff
       accountId={accountId}
-      connectOpen={connectOpen}
-      onConnectOpenChange={setConnectOpen}
+      connectEmail={connectEmail}
+      onConnectEmailChange={setConnectEmail}
       onConnected={(id) => {
```

```diff
-        <EmailHubConnectEmpty aiEnabled={aiEnabled} onConnect={() => setConnectOpen(true)} />
+        <EmailHubConnectEmpty aiEnabled={aiEnabled} onConnect={() => setConnectEmail("")} />
```

```diff
         <EmailHubViewListPanel
           returnFocusId={lastOpenedRef.current}
+          reconnect={activeAccount?.needs_reconnect ? () => accountMenu.onReconnect(activeAccount.id) : undefined}
           header={{
```

- [ ] **Step 9: Run the tests to verify they pass, then run the gates**

```bash
pnpm --filter @uniwork/views exec vitest run email-hub/email-hub-redesign.test.tsx email-hub/connect-account-dialog.test.tsx settings/components/integrations-tab.test.tsx
pnpm --filter @uniwork/core exec vitest run api/endpoints/email-hub.test.ts email-hub/hooks-sync.test.tsx
pnpm --filter @uniwork/core test
pnpm --filter @uniwork/views test
pnpm typecheck
pnpm lint
pnpm knip
```

Expected:
- All tests pass, including the core i18n parity test inside `pnpm --filter @uniwork/core test`.
- Typecheck is clean. Because `EmailHubAccount` now has required fields, the only typed fixture that had to change is the redesign test's `account`. `integrations-tab.test.tsx` passes raw JSON through `requestMock`.
- `pnpm lint` shows 0 problems. Read the output rather than trusting the exit code, since `GATE_LEVEL=fast` reports without failing. The `max-lines` rule must still hold for `email-hub-view.tsx` (about 496 counted lines).
- `knip` reports no unused exports. `EmailHubReconnectBanner` is used by the list panel.

- [ ] **Step 10: Commit**

```bash
git add packages/core/types/email-hub.ts packages/core/api/endpoints/email-hub.test.ts \
  packages/core/email-hub/hooks-sync.ts packages/core/email-hub/hooks-sync.test.tsx packages/core/email-hub/query-cache.ts \
  packages/core/i18n/locales/vi.json packages/core/i18n/locales/en.json \
  packages/views/email-hub/email-hub-reconnect-banner.tsx packages/views/email-hub/email-hub-account-menu.tsx \
  packages/views/email-hub/use-email-hub-account-panel.ts packages/views/email-hub/email-hub-view-list-panel.tsx \
  packages/views/email-hub/connect-account-dialog.tsx packages/views/email-hub/connect-account-dialog.test.tsx \
  packages/views/email-hub/email-hub-view-dialogs.tsx packages/views/email-hub/email-hub-view.tsx \
  packages/views/email-hub/email-hub-redesign.test.tsx
git commit -m "feat(email-hub): show needs-reconnect and reconnect app-password mailboxes in place" \
  -m "The account schema reads auth_kind, needs_reconnect and auth_failed_reason with defaults for older servers. Live sync stays off for a mailbox that needs reconnecting, and a 409 email_hub_reauth_required refetches the account list once. The menu badge, list banner and reconnect dialog (address fixed, password only) keep cached mail readable. The connect dialog names the new server codes. Left out: OAuth reconnect and the custom-server form (GD2/GD3)."
```

---

Not checked: I did not run any of these commands, so the line counts and the jsdom behaviour of the Base UI menu and dialog in the new tests come from reading the code. One risk: the banner puts the button in a third grid row (`col-start-2`) instead of using `AlertAction`, because the absolute `AlertAction` would overlap the description at `pr-18`. Check it visually in both themes.

---

### Task 10: Runbook, coverage floor, full verification, PR

**Files:**
- Create: `docs/ops/RUNBOOK_EMAIL_HUB.md`
- Modify: `docs/superpowers/specs/2026-10-11-email-hub-oauth-custom-server-design.md` (lines 3 and 6: status line and `**Issue:**` line)
- Modify, only if the measured number is higher: `server/coverage.floor` (now `70`), `packages/core/vitest.config.ts:27` (`statements: 62, branches: 60, functions: 50, lines: 63`), `packages/views/vitest.config.ts:29` (`statements: 64, branches: 56, functions: 57, lines: 65`)
- Test (unchanged, must stay green): `scripts/alerts-runbooks.test.mjs` (scans only `docs/runbooks/`), `scripts/governance.test.mjs` (status line on plans)

**Interfaces:**
- Consumes (runbook text only, no code): column `email_hub_accounts.auth_failed_at` / `auth_failed_reason` / `credential_version`; reason codes `imap_auth_failed`, `imap_login_refused`, `smtp_auth_failed` (from `handleAuthError`); scheduled-send `last_error` values `auth_required` and `smtp_disabled`; audit actions `email_hub_account.connected`, `email_hub_account.auth_failed`, `email_hub_account.disconnected`; API codes `email_hub_reauth_required`, `email_hub_already_connected`, `email_hub_smtp_disabled`, `email_hub_tls_required`, `email_hub_unreachable`; index `idx_email_hub_accounts_active_address`; migration file `server/migrations/999*_email_hub_accounts_dedupe.up.sql`; metric `uniwork_audit_events_total{action}` (already exists, see `docs/ops/RUNBOOK_OUTBOX.md`).
- Produces: no Go/TS symbols.

No new repo test. `docs/ops/` has no guard, and a test that only checks one Markdown file exists adds nothing. Step 1 is a shell check that fails today.

- [ ] **Step 1: Write the failing check**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237
test -f docs/ops/RUNBOOK_EMAIL_HUB.md \
  && sed -n 3p docs/ops/RUNBOOK_EMAIL_HUB.md | grep -q '^> \*\*Trạng thái:\*\* shipped' \
  && grep -q '^### Tài khoản Email Hub cần kết nối lại' docs/ops/RUNBOOK_EMAIL_HUB.md \
  && echo OK || echo MISSING
```

- [ ] **Step 2: Run it to confirm it fails**

Run the block above. Expected: `MISSING`.

Before writing the runbook, check that the strings it quotes are the ones Tasks 1–9 actually shipped. Each grep must print at least one hit; if one comes back empty, use the real string in Step 3:

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237
grep -rn '"imap_auth_failed"\|"imap_login_refused"\|"smtp_auth_failed"' server/internal/service/
grep -rn '"auth_required"\|"smtp_disabled"' server/internal/service/
grep -rn 'email_hub_account.auth_failed\|email_hub_account.connected' server/internal/audit/actions.go
grep -rn 'email_hub_reauth_required\|email_hub_already_connected\|email_hub_tls_required\|email_hub_unreachable\|email_hub_smtp_disabled' server/internal/handler/
ls server/migrations/ | grep -E 'email_hub_accounts_(auth|dedupe|active_address)'
```

- [ ] **Step 3: Write the runbook**

Create `docs/ops/RUNBOOK_EMAIL_HUB.md`:

````markdown
# Runbook — Email Hub: xác thực hộp thư và kết nối lại

> **Trạng thái:** shipped · **Cập nhật:** 2026-10-11 · **Thành phần:** `EmailHubService` trong tiến trình API (`server/internal/service/email_hub*.go`), worker sync và watcher IDLE · **Liên quan:** ADR 0022, ADR 0025, spec `2026-10-11-email-hub-oauth-custom-server-design.md`, UNI-1237

Một tài khoản Email Hub (`email_hub_accounts`) ở một trong ba trạng thái:

| Trạng thái | Điều kiện trên dòng | Ý nghĩa |
| --- | --- | --- |
| `active` | `disconnected_at IS NULL AND auth_failed_at IS NULL` | Sync, watcher, gửi chạy bình thường |
| `needs_reconnect` | `disconnected_at IS NULL AND auth_failed_at IS NOT NULL` | Máy chủ thư từ chối credential. Thư đã cache **còn nguyên** và vẫn đọc được; mọi thao tác chạm máy chủ trả `409 email_hub_reauth_required` |
| `disconnected` | `disconnected_at IS NOT NULL` | Người dùng ngắt kết nối hoặc rời tổ chức; cache đã bị dọn |

Mất xác thực **không** xoá thư nữa. Tài khoản chỉ quay lại `active` khi người dùng
kết nối lại cùng địa chỉ (cùng id, `credential_version` tăng, `auth_failed_*` bị xoá).
Không có metric hay alert riêng cho Email Hub, nên runbook này nằm ở `docs/ops/`
chứ không ở `docs/runbooks/`.

## Số cần nhìn

| Nguồn | Ý nghĩa | Ngưỡng |
| --- | --- | --- |
| `uniwork_audit_events_total{action="email_hub_account.auth_failed"}` | Số lần một tài khoản chuyển sang `needs_reconnect` | Tăng đột biến trên nhiều tổ chức cùng lúc = phía nhà cung cấp đổi chính sách, không phải người dùng đổi mật khẩu |
| `uniwork_audit_events_total{action="email_hub_account.connected"}` | Kết nối mới và kết nối lại | Phẳng trong khi `auth_failed` tăng = người dùng không thấy banner *Kết nối lại* |
| `uniwork_audit_events_total{action="email_hub_account.disconnected"}` | Ngắt kết nối (người dùng, rời tổ chức) | Chỉ để nhìn |

## Triệu chứng và cách xử lý

### Tài khoản Email Hub cần kết nối lại

Người dùng thấy badge và banner *Kết nối lại*, hoặc gặp `409 email_hub_reauth_required`.

1. Đếm theo lý do:

```sql
SELECT auth_failed_reason, provider, count(*), min(auth_failed_at), max(auth_failed_at)
FROM email_hub_accounts
WHERE auth_failed_at IS NOT NULL AND disconnected_at IS NULL
GROUP BY auth_failed_reason, provider
ORDER BY 3 DESC;
```

2. Đọc mã:

| `auth_failed_reason` | Nguồn | Nguyên nhân thường gặp | Xử lý |
| --- | --- | --- | --- |
| `imap_auth_failed` | IMAP `NO [AUTHENTICATIONFAILED]` | Người dùng đổi mật khẩu tài khoản hoặc thu hồi App Password; Google tắt App Password khi tắt 2FA | Người dùng bấm *Kết nối lại* và nhập App Password mới |
| `imap_login_refused` | 3 lần liên tiếp IMAP trả NO không kèm mã (`emailHubRefusedLoginsBeforeDisconnect`) | IMAP bị tắt trong cài đặt hộp thư; máy chủ chặn IP; mật khẩu sai với máy chủ không trả mã chuẩn | Bật IMAP trong cài đặt hộp thư rồi kết nối lại |
| `smtp_auth_failed` | SMTP 535/534 (không phải trường hợp SMTP AUTH bị tắt) | Mật khẩu SMTP khác mật khẩu IMAP, hoặc đã bị thu hồi | Kết nối lại |

   Sau GĐ3 (OAuth) sẽ có thêm lý do từ refresh token. Google để client ở chế độ *Testing*
   cho tới khi qua verification, và trong chế độ đó refresh token hết hạn sau 7 ngày, nên
   các tài khoản Gmail sẽ đồng loạt rơi về `needs_reconnect` theo chu kỳ 7 ngày.

3. Không có thao tác SQL nào "sửa" một tài khoản. Đặt `auth_failed_at = NULL` bằng tay
   chỉ làm worker dial lại bằng credential đã bị từ chối, và nhà cung cấp có thể khoá
   hộp thư vì đăng nhập sai lặp lại. Chỉ người dùng kết nối lại mới đưa tài khoản về `active`.

4. Xem lịch sử một tài khoản:

```sql
SELECT action, actor_kind, actor_id, metadata, occurred_at
FROM audit_events
WHERE action LIKE 'email_hub_account.%' AND resource_id = '<account_id>'
ORDER BY occurred_at DESC LIMIT 20;
```

### Gửi thất bại với `smtp_disabled` (Microsoft 365)

Tenant M365 tắt SMTP AUTH (`SmtpClientAuthentication is disabled`, mã `535 5.7.139`).
Đây **không** phải lỗi xác thực: tài khoản vẫn `active`, IMAP vẫn sync, credential
được giữ. Lần gửi trả `400 email_hub_smtp_disabled`; hẹn giờ gửi đến hạn kết thúc `failed`:

```sql
SELECT last_error, count(*), max(send_at)
FROM email_hub_scheduled_sends
WHERE status = 'failed' AND last_error IN ('smtp_disabled', 'auth_required')
GROUP BY last_error;
```

Xử lý: quản trị viên M365 bật *Authenticated SMTP* cho hộp thư đó (Microsoft 365 admin
center → Users → Mail → *Manage email apps*) hoặc cho cả tenant
(`Set-TransportConfig -SmtpClientAuthenticationDisabled $false`). Không cần kết nối lại.
`auth_required` là hẹn giờ gửi đến hạn khi tài khoản đang `needs_reconnect`; thư không
được gửi trễ âm thầm, nên người dùng phải gửi lại sau khi kết nối lại.

### Kết nối thất bại

| Mã API | Ý nghĩa | Xử lý |
| --- | --- | --- |
| `email_hub_already_connected` (409) | Địa chỉ đã có tài khoản `active` cùng kiểu xác thực, cùng máy chủ; kiểm tra chạy trước khi dial | Không phải lỗi; người dùng đã kết nối rồi |
| `email_hub_unreachable` (400) | DNS không phân giải, TCP/TLS không xong trong hạn, **hoặc** host phân giải ra IP bị `netguard` chặn | Cố ý gộp chung để API không thành công cụ dò mạng nội bộ |
| `email_hub_tls_required` (400) | Máy chủ không có TLS ngầm định, hoặc không quảng bá `STARTTLS` | Hộp thư không có TLS sẽ không được hỗ trợ |
| `email_hub_smtp_disabled` (400) | Như mục M365 ở trên, phát hiện ngay lúc kết nối | Bật SMTP AUTH rồi kết nối lại |

Route kết nối giới hạn 10 lần / 10 phút cho mỗi người dùng (cần Redis). Bị `429` thì chờ.
Log chỉ ghi mã đã phân loại (`host_not_allowed`, `tls_required`, `unreachable`,
`auth_failed`, `smtp_disabled`) kèm `account_id` / `user_id` / `provider`. Host, email và
phản hồi thô của IMAP/SMTP không bao giờ vào log, nên đừng đi tìm chúng ở đó.

### Migration dedupe và unique index

`999*_email_hub_accounts_dedupe` ngắt các dòng trùng `(organization_id, user_id,
lower(email_address))` còn active, giữ dòng tạo sớm nhất, huỷ hẹn giờ gửi `pending`/`failed`
và xoá threads, attachments, AI summaries của dòng bị ngắt. Không đảo ngược được (down là
`SELECT 1`). Body trên object storage để GC file dọn như thường.

Migration sau đó build `idx_email_hub_accounts_active_address` bằng `CREATE UNIQUE INDEX
CONCURRENTLY`. Nếu build thất bại (thường do pod cũ trong cửa sổ rolling update đã tạo
thêm một dòng trùng sau khi dedupe chạy), PostgreSQL để lại một index `INVALID` và
`schema_migrations` không ghi version đó:

```sql
SELECT c.relname, i.indisvalid
FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
WHERE c.relname = 'idx_email_hub_accounts_active_address';

SELECT organization_id, user_id, lower(email_address), count(*)
FROM email_hub_accounts WHERE disconnected_at IS NULL
GROUP BY 1, 2, 3 HAVING count(*) > 1;
```

Khắc phục:

1. `DROP INDEX CONCURRENTLY IF EXISTS idx_email_hub_accounts_active_address;`
2. Chạy lại file dedupe bằng tay. File này idempotent: nhóm nào chỉ còn một dòng active thì
   không bị đụng tới.
   `psql "$DATABASE_URL" -f server/migrations/999*_email_hub_accounts_dedupe.up.sql`
3. Chạy lại migrate (`bin/migrate up`, hoặc `cd server && go run ./cmd/migrate up`).
````

Update the spec header (lines 3 and 6). GĐ2/GĐ3 are still open, so the spec stays `in-progress`:

```diff
-> **Trạng thái:** in-progress — thiết kế đã duyệt từng phần trong phiên brainstorm (2026-10-11, quangpd); spec đã qua một vòng review đối kháng (độ chính xác so với mã, bảo mật, quy tắc repo) và chờ duyệt. Chưa có kế hoạch thực thi.
+> **Trạng thái:** in-progress — spec đã duyệt (2026-10-11, quangpd). GĐ1 (UNI-1237) triển khai theo plan GĐ1 trong `docs/superpowers/plans/`, PR mở vào `develop`; GĐ2 (máy chủ tùy chỉnh) và GĐ3 (OAuth) chưa bắt đầu.
@@
-**Issue:** chưa tạo — cần một issue cha và ba sub-issue (GĐ1–GĐ3, §9). Gộp vào đây UNI-1130, UNI-1132, UNI-1197, UNI-1202 vì cùng chạm `Connect` và tầng dial.
+**Issue:** GĐ1 = UNI-1237; GĐ2, GĐ3 chưa có issue. Gộp vào đây UNI-1130, UNI-1132, UNI-1197, UNI-1202 vì cùng chạm `Connect` và tầng dial.
```

- [ ] **Step 4: Run the check and the doc contract tests**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237
# Step 1 block again → expected: OK
node --test scripts/alerts-runbooks.test.mjs scripts/governance.test.mjs scripts/no-pii-log.test.mjs
```

Expected: all pass. `alerts-runbooks` reads only `docs/runbooks/`, so the new `docs/ops/` file is not an orphan.

- [ ] **Step 5: Measure coverage, raise floors only if higher**

Go (from the repo root, worktree env):

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237
make test-go ENV_FILE=.env.worktree
cd server && go tool cover -func=../.go-tmp/cover.out | tail -1
```

If `total` is at least 71.0, set `server/coverage.floor` to the integer part of `total` (example: `72.4` → `72`). Otherwise leave it at `70`. The floor never goes down. If `make test-go` reports `below the floor`, the tests from Tasks 1–9 are missing cases: add them, and do not lower the number.

TS:

```bash
pnpm --filter @uniwork/core test
pnpm --filter @uniwork/views test
```

Read the `Statements / Branches / Functions / Lines` lines of the `text-summary` reporter. For each metric whose measured integer part is above the current threshold, raise that number in `coverageThresholds({...})` (`packages/core/vitest.config.ts:27`, `packages/views/vitest.config.ts:29`) to the measured integer part. Leave every other number as it is.

- [ ] **Step 6: Full verification**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237
make check-worktree 2>&1 | tee /private/tmp/claude-501/-Users-ducquang-UNICOM-uniwork/9c0b8bf7-cd73-4cef-9f16-e818bead0b9a/scratchpad/check.log
grep -nE 'error|✖|FAIL|below the floor|problems? \(' /private/tmp/claude-501/-Users-ducquang-UNICOM-uniwork/9c0b8bf7-cd73-4cef-9f16-e818bead0b9a/scratchpad/check.log | head -50
pnpm knip
```

`GATE_LEVEL` is `fast`, so lint errors and TS coverage drops print without failing the run (ADR 0014). Read the grep output, not the exit code. Fix every lint error, typecheck error, failing test and knip finding in the files Tasks 1–10 touched, then re-run `make check-worktree`. E2E is skipped at `fast`. Say so in the PR and do not claim it passed.

- [ ] **Step 7: Commit**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237
git add docs/ops/RUNBOOK_EMAIL_HUB.md docs/superpowers/specs/2026-10-11-email-hub-oauth-custom-server-design.md docs/superpowers/plans/2026-10-11-email-hub-gd1-foundation.md server/coverage.floor packages/core/vitest.config.ts packages/views/vitest.config.ts
git commit -m "docs(email-hub): add the reconnect runbook and mark GD1 in the spec" \
  -m "Runbook lives in docs/ops because docs/runbooks is reserved for alert-backed runbooks and GD1 adds no metric or alert. Coverage floors move only where the measured number is higher. Left out: OAuth-specific reasons beyond a GD3 note." \
  -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(`git add` on an unchanged file is a no-op. If Step 5 raised nothing, the coverage files are simply absent from the commit. If a fix from Step 6 touched code, commit it separately first with a `fix(email-hub): …` subject naming the check that failed.)

- [ ] **Step 8: UniAI comment and PR**

```bash
cd /Users/ducquang/UNICOM/uniwork/.claude/worktrees/uni-1237
make issue-note KEY=UNI-1237 MSG="[agent] GĐ1 xong: migration + dedupe + unique index, netguard, TLS IMAP/SMTP, seam credentials, needs_reconnect, audit connect/disconnect/auth_failed, rate limit connect, hợp nhất Sent, UI Kết nối lại, runbook docs/ops/RUNBOOK_EMAIL_HUB.md. make check-worktree đã chạy (E2E bỏ qua ở GATE_LEVEL=fast). Mở PR vào develop."
make issue-pr KEY=UNI-1237
```

`issue-pr` pushes the branch, opens `UNI-1237: <title>` against `develop` (`BASE_BRANCH` defaults to `develop`) from `.github/pull_request_template.md`, and sets `in_review`. Then fill in the body with the real results:

```bash
gh pr edit --body-file /private/tmp/claude-501/-Users-ducquang-UNICOM-uniwork/9c0b8bf7-cd73-4cef-9f16-e818bead0b9a/scratchpad/pr-body.md
```

`pr-body.md` keeps the template headings. **Issue:** `UNI-1237`. **Thay đổi gì:** mất xác thực chuyển tài khoản sang `needs_reconnect` thay vì xoá thư; chặn SSRF ở tầng dial; bắt buộc TLS; thư đã gửi hiện một lần. **Đã cố ý bỏ ra ngoài:** GĐ2 (máy chủ tùy chỉnh, APPEND), GĐ3 (OAuth), lỗi 401 ở callback của lịch. **Kiểm chứng:** the exact commands from Steps 4–6 with their real results; E2E listed as skipped, with the reason. **DoD:** tick the four `[fast]` boxes; tick "Nền có runbook" with `docs/ops/RUNBOOK_EMAIL_HUB.md`; mark the rest "n/a — fast". End the body with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

Not checked: the strings quoted in the runbook depend on what Tasks 1–9 actually ship, so Step 2's greps must run before Step 3 is written. The new runbook file has no guard test, so nothing catches it drifting later.