package migrations

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Database-level proof for the FileService schema (UNI-739 / T1b): locator
// uniqueness, tenant isolation, the NULL-tenant avatar branch, CHECK
// constraints, transactional rollback, the actor pair and the job fencing
// rules. Everything runs inside the shared advisory lock because these tests
// mutate the test database.

const (
	fsOrgA   = "01ORGFS00000000000000000A"
	fsOrgB   = "01ORGFS00000000000000000B"
	fsWsA    = "01WSFS000000000000000000A"
	fsUserA  = "01USRFS00000000000000000A"
	fsActorA = "01USRFS00000000000000000A"
)

var fsSha = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

func fileServicePool(t *testing.T) (*pgxpool.Pool, context.Context) {
	t.Helper()
	pool := testPool(t)
	ctx := context.Background()
	lock, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := WaitAdvisoryLock(ctx, lock, 727273); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = lock.Exec(ctx, "SELECT pg_advisory_unlock($1)", 727273); lock.Release() })
	if err := Up(ctx, pool); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `TRUNCATE file_jobs, file_upload_sessions, files`); err != nil {
		t.Fatal(err)
	}
	return pool, ctx
}

func wantPgError(t *testing.T, err error, code, constraint string) {
	t.Helper()
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		t.Fatalf("expected *pgconn.PgError (%s), got %v", code, err)
	}
	if pgErr.Code != code {
		t.Fatalf("expected SQLSTATE %s, got %s: %s", code, pgErr.Code, pgErr.Message)
	}
	if constraint != "" && pgErr.ConstraintName != constraint {
		t.Fatalf("expected constraint %s, got %s", constraint, pgErr.ConstraintName)
	}
}

func insertFile(t *testing.T, pool *pgxpool.Pool, ctx context.Context, id string, org any, storage string, bucket any, key string) {
	t.Helper()
	_, err := pool.Exec(ctx, `
		INSERT INTO files (id, organization_id, storage, bucket, object_key, original_filename)
		VALUES ($1, $2, $3, $4, $5, 'a.png')`, id, org, storage, bucket, key)
	if err != nil {
		t.Fatalf("insert file %s: %v", id, err)
	}
}

func insertSession(t *testing.T, pool *pgxpool.Pool, ctx context.Context, id, fileID, purpose string, org, ws, user any, key string) {
	t.Helper()
	_, err := pool.Exec(ctx, `
		INSERT INTO file_upload_sessions (
		  id, file_id, created_by, created_by_kind, purpose,
		  organization_id, workspace_id, user_id,
		  idempotency_key, command_fingerprint
		) VALUES ($1, $2, $9, 'human', $3, $4, $5, $6, $7, $8)`,
		id, fileID, purpose, org, ws, user, key, "fp-"+id, fsActorA)
	if err != nil {
		t.Fatalf("insert session %s: %v", id, err)
	}
}

func TestFileServiceLocatorUniqueness(t *testing.T) {
	pool, ctx := fileServicePool(t)

	insertFile(t, pool, ctx, "01FILE0000000000000000000A", fsOrgA, "s3", "bucket-a", "k/obj-1")

	// Same locator in the same tenant: rejected.
	_, err := pool.Exec(ctx, `
		INSERT INTO files (id, organization_id, storage, bucket, object_key, original_filename)
		VALUES ('01FILE0000000000000000000B', $1, 's3', 'bucket-a', 'k/obj-1', 'b.png')`, fsOrgA)
	wantPgError(t, err, "23505", "uidx_files_locator")

	// Same locator claimed by a DIFFERENT tenant: still rejected - the locator
	// key is global, not tenant-scoped.
	_, err = pool.Exec(ctx, `
		INSERT INTO files (id, organization_id, storage, bucket, object_key, original_filename)
		VALUES ('01FILE0000000000000000000C', $1, 's3', 'bucket-a', 'k/obj-1', 'c.png')`, fsOrgB)
	wantPgError(t, err, "23505", "uidx_files_locator")

	// local rows have bucket NULL; the COALESCE in the index still makes the
	// locator unique across tenants.
	insertFile(t, pool, ctx, "01FILE0000000000000000000D", fsOrgA, "local", nil, "l/obj-2")
	_, err = pool.Exec(ctx, `
		INSERT INTO files (id, organization_id, storage, bucket, object_key, original_filename)
		VALUES ('01FILE0000000000000000000E', $1, 'local', NULL, 'l/obj-2', 'e.png')`, fsOrgB)
	wantPgError(t, err, "23505", "uidx_files_locator")

	// A deleted tombstone still owns its locator: object keys are never
	// reused, so GC must not open a hole (spec 9.5).
	insertFile(t, pool, ctx, "01FILE0000000000000000000F", fsOrgA, "s3", "bucket-a", "k/obj-3")
	if _, err := pool.Exec(ctx, `
		UPDATE files SET status='ready', content_type='image/png', size_bytes=1, ready_at=now() WHERE id='01FILE0000000000000000000F'`); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE files SET status='deleting' WHERE id='01FILE0000000000000000000F'`); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE files SET status='deleted', deleted_at=now() WHERE id='01FILE0000000000000000000F'`); err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `
		INSERT INTO files (id, organization_id, storage, bucket, object_key, original_filename)
		VALUES ('01FILE0000000000000000000G', $1, 's3', 'bucket-a', 'k/obj-3', 'g.png')`, fsOrgA)
	wantPgError(t, err, "23505", "uidx_files_locator")
}

func TestFileServiceTenantIsolation(t *testing.T) {
	pool, ctx := fileServicePool(t)
	q := db.New(pool)

	insertFile(t, pool, ctx, "01FILE0000000000000000001A", fsOrgA, "s3", "bucket-a", "k/ten-1")

	// The tenant-facing read returns the file only inside its organization.
	if _, err := q.GetOrgFile(ctx, db.GetOrgFileParams{
		ID:             "01FILE0000000000000000001A",
		OrganizationID: pgtype.Text{String: fsOrgA, Valid: true},
	}); err != nil {
		t.Fatalf("own-tenant read: %v", err)
	}
	if _, err := q.GetOrgFile(ctx, db.GetOrgFileParams{
		ID:             "01FILE0000000000000000001A",
		OrganizationID: pgtype.Text{String: fsOrgB, Valid: true},
	}); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("foreign-tenant read must be file_not_found-shaped (ErrNoRows), got %v", err)
	}

	// Batch resolve is tenant-filtered too.
	files, err := q.ListOrgFilesByIDs(ctx, db.ListOrgFilesByIDsParams{
		OrganizationID: pgtype.Text{String: fsOrgB, Valid: true},
		FileIds:        []string{"01FILE0000000000000000001A"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 0 {
		t.Fatalf("tenant B resolved tenant A's file")
	}

	// Quota is counted per shared file inside the organization (T1-Q9).
	if _, err := pool.Exec(ctx, `
		UPDATE files SET status='ready', content_type='image/png', size_bytes=7, ready_at=now()
		WHERE id='01FILE0000000000000000001A'`); err != nil {
		t.Fatal(err)
	}
	sum, err := q.SumOrgReadyFileBytes(ctx, pgtype.Text{String: fsOrgA, Valid: true})
	if err != nil {
		t.Fatal(err)
	}
	if sum != 7 {
		t.Fatalf("org quota sum = %d, want 7", sum)
	}
	if sumB, err := q.SumOrgReadyFileBytes(ctx, pgtype.Text{String: fsOrgB, Valid: true}); err != nil || sumB != 0 {
		t.Fatalf("org B quota sum = %d (err %v), want 0", sumB, err)
	}
}

func TestFileServiceNullTenantAvatarBranch(t *testing.T) {
	pool, ctx := fileServicePool(t)
	q := db.New(pool)

	// files.organization_id accepts NULL (the avatar branch writes it) but
	// never an empty string.
	insertFile(t, pool, ctx, "01FILE0000000000000000002A", nil, "s3", "bucket-a", "k/av-1")
	_, err := pool.Exec(ctx, `
		INSERT INTO files (id, organization_id, storage, bucket, object_key, original_filename)
		VALUES ('01FILE0000000000000000002B', '', 's3', 'bucket-a', 'k/av-2', 'b.png')`)
	wantPgError(t, err, "23514", "files_organization_id_nonempty")

	// A session on the avatar branch needs the user scope and NULL workspace.
	insertSession(t, pool, ctx, "01SESS0000000000000000002A", "01FILE0000000000000000002A",
		"user_avatar", nil, nil, fsUserA, "idem-av-1")

	// user_avatar without user_id is refused.
	_, err = pool.Exec(ctx, `
		INSERT INTO file_upload_sessions (
		  id, file_id, created_by, created_by_kind, purpose,
		  organization_id, workspace_id, user_id,
		  idempotency_key, command_fingerprint
		) VALUES ('01SESS0000000000000000002B', '01FILE0000000000000000002A', $1, 'human', 'user_avatar',
		  NULL, NULL, NULL, 'idem-av-2', 'fp-x')`, fsActorA)
	wantPgError(t, err, "23514", "file_upload_sessions_scope_matches_purpose")

	// Any other purpose with a NULL tenant is refused: NULL is only the
	// avatar branch.
	for _, purpose := range []string{"task_attachment", "chat_attachment", "audit_export"} {
		_, err = pool.Exec(ctx, `
			INSERT INTO file_upload_sessions (
			  id, file_id, created_by, created_by_kind, purpose,
			  organization_id, workspace_id, user_id,
			  idempotency_key, command_fingerprint
			) VALUES (concat('01SESS0', md5($2::text)), '01FILE0000000000000000002A', $1, 'human', $2,
			  NULL, NULL, NULL, concat('idem-', $2), 'fp-x')`, fsActorA, purpose)
		wantPgError(t, err, "23514", "file_upload_sessions_scope_matches_purpose")
	}

	// The identity read resolves the avatar file for its uploader only.
	if _, err := q.GetAvatarFileForUser(ctx, db.GetAvatarFileForUserParams{
		ID:     "01FILE0000000000000000002A",
		UserID: pgtype.Text{String: fsUserA, Valid: true},
	}); err != nil {
		t.Fatalf("avatar read for owning user: %v", err)
	}
	if _, err := q.GetAvatarFileForUser(ctx, db.GetAvatarFileForUserParams{
		ID:     "01FILE0000000000000000002A",
		UserID: pgtype.Text{String: "01USRFS00000000000000000B", Valid: true},
	}); !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("avatar read for another user must be not-found, got %v", err)
	}
}

func TestFileServiceCheckConstraints(t *testing.T) {
	pool, ctx := fileServicePool(t)

	cases := []struct {
		name       string
		sql        string
		args       []any
		constraint string
	}{
		{"bad storage", `INSERT INTO files (id, organization_id, storage, bucket, object_key, original_filename) VALUES ('01FSCK00000000000000000001', $1, 'gcs', 'b', 'k', 'a')`, []any{fsOrgA}, "files_storage_check"},
		{"bad status", `INSERT INTO files (id, organization_id, storage, bucket, object_key, original_filename, status) VALUES ('01FSCK00000000000000000002', $1, 's3', 'b', 'k', 'a', 'weird')`, []any{fsOrgA}, "files_status_check"},
		{"s3 without bucket", `INSERT INTO files (id, organization_id, storage, bucket, object_key, original_filename) VALUES ('01FSCK00000000000000000003', $1, 's3', NULL, 'k', 'a')`, []any{fsOrgA}, "files_bucket_matches_storage"},
		{"local with bucket", `INSERT INTO files (id, organization_id, storage, bucket, object_key, original_filename) VALUES ('01FSCK00000000000000000004', $1, 'local', 'b', 'k', 'a')`, []any{fsOrgA}, "files_bucket_matches_storage"},
		{"bad checksum", `INSERT INTO files (id, organization_id, storage, bucket, object_key, original_filename, checksum_sha256) VALUES ('01FSCK00000000000000000005', $1, 's3', 'b', 'k', 'a', 'zz')`, []any{fsOrgA}, "files_checksum_sha256_hex"},
		{"uppercase checksum", `INSERT INTO files (id, organization_id, storage, bucket, object_key, original_filename, checksum_sha256) VALUES ('01FSCK00000000000000000006', $1, 's3', 'b', 'k', 'a', upper($2::text))`, []any{fsOrgA, fsSha}, "files_checksum_sha256_hex"},
		{"negative size", `INSERT INTO files (id, organization_id, storage, bucket, object_key, original_filename, size_bytes) VALUES ('01FSCK00000000000000000007', $1, 's3', 'b', 'k', 'a', -1)`, []any{fsOrgA}, "files_size_bytes_nonneg"},
		{"traversal key", `INSERT INTO files (id, organization_id, storage, bucket, object_key, original_filename) VALUES ('01FSCK00000000000000000008', $1, 's3', 'b', '../x', 'a')`, []any{fsOrgA}, "files_object_key_safe"},
		{"absolute key", `INSERT INTO files (id, organization_id, storage, bucket, object_key, original_filename) VALUES ('01FSCK00000000000000000009', $1, 's3', 'b', '/abs', 'a')`, []any{fsOrgA}, "files_object_key_safe"},
		{"metadata not object", `INSERT INTO files (id, organization_id, storage, bucket, object_key, original_filename, metadata) VALUES ('01FSCK0000000000000000000A', $1, 's3', 'b', 'k', 'a', '[]'::jsonb)`, []any{fsOrgA}, "files_metadata_is_object"},
		{"ready missing metadata", `INSERT INTO files (id, organization_id, storage, bucket, object_key, original_filename, status) VALUES ('01FSCK0000000000000000000B', $1, 's3', 'b', 'k', 'a', 'ready')`, []any{fsOrgA}, "files_ready_has_metadata"},
		{"ready without ready_at", `INSERT INTO files (id, organization_id, storage, bucket, object_key, original_filename, status, content_type, size_bytes) VALUES ('01FSCK0000000000000000000C', $1, 's3', 'b', 'k', 'a', 'ready', 'image/png', 1)`, []any{fsOrgA}, "files_ready_has_metadata"},
		{"ready_at on pending", `INSERT INTO files (id, organization_id, storage, bucket, object_key, original_filename, ready_at) VALUES ('01FSCK0000000000000000000D', $1, 's3', 'b', 'k', 'a', now())`, []any{fsOrgA}, "files_ready_at_after_ready"},
		{"deleted_at without deleted", `INSERT INTO files (id, organization_id, storage, bucket, object_key, original_filename, deleted_at) VALUES ('01FSCK0000000000000000000E', $1, 's3', 'b', 'k', 'a', now())`, []any{fsOrgA}, "files_deleted_at_marks_terminal"},
		{"empty org", `INSERT INTO files (id, organization_id, storage, bucket, object_key, original_filename) VALUES ('01FSCK0000000000000000000F', '', 's3', 'b', 'k', 'a')`, nil, "files_organization_id_nonempty"},
	}
	for _, c := range cases {
		_, err := pool.Exec(ctx, c.sql, c.args...)
		wantPgError(t, err, "23514", c.constraint)
	}

	// A valid ready row passes every CHECK, checksum included.
	if _, err := pool.Exec(ctx, `
		INSERT INTO files (id, organization_id, storage, bucket, object_key, original_filename,
		  status, content_type, size_bytes, checksum_sha256, ready_at, metadata)
		VALUES ('01FSCK00000000000000000010', $1, 'minio', 'b', 'k', 'a',
		  'ready', 'image/png', 10, $2, now(), '{"schema_version":1,"width":4}'::jsonb)`,
		fsOrgA, fsSha); err != nil {
		t.Fatalf("valid ready row rejected: %v", err)
	}
	// And a ready row with NULL checksum is legal (T1-Q2).
	if _, err := pool.Exec(ctx, `
		INSERT INTO files (id, organization_id, storage, bucket, object_key, original_filename,
		  status, content_type, size_bytes, ready_at)
		VALUES ('01FSCK00000000000000000011', $1, 's3', 'b', 'k2', 'a',
		  'ready', 'image/png', 10, now())`, fsOrgA); err != nil {
		t.Fatalf("ready row with NULL checksum rejected: %v", err)
	}
}

func TestFileServiceAttributionPair(t *testing.T) {
	pool, ctx := fileServicePool(t)

	insertFile(t, pool, ctx, "01FILE0000000000000000003A", fsOrgA, "s3", "b", "k/attr-1")

	// created_by without a valid kind is refused; 'human'|'agent'|'system' pass.
	_, err := pool.Exec(ctx, `
		INSERT INTO file_upload_sessions (
		  id, file_id, created_by, created_by_kind, purpose,
		  organization_id, idempotency_key, command_fingerprint
		) VALUES ('01SESS0000000000000000003A', '01FILE0000000000000000003A', $1, 'robot', 'audit_export',
		  $2, 'idem-attr-1', 'fp')`, fsActorA, fsOrgA)
	wantPgError(t, err, "23514", "file_upload_sessions_actor_kind_check")

	for i, kind := range []string{"human", "agent", "system"} {
		fileID := fmt.Sprintf("01FILE0000000000000000003%d", 'B'+i)
		insertFile(t, pool, ctx, fileID, fsOrgA, "s3", "b", "k/attr-"+kind)
		if _, err := pool.Exec(ctx, `
			INSERT INTO file_upload_sessions (
			  id, file_id, created_by, created_by_kind, purpose,
			  organization_id, idempotency_key, command_fingerprint
			) VALUES (concat('01SESS', md5($3::text)), $4, $1, $3, 'audit_export',
			  $2, concat('idem-', $3), 'fp')`, fsActorA, fsOrgA, kind, fileID); err != nil {
			t.Fatalf("kind %s refused: %v", kind, err)
		}
	}
}

func TestFileServiceIdempotencyBinding(t *testing.T) {
	pool, ctx := fileServicePool(t)
	q := db.New(pool)

	insertFile(t, pool, ctx, "01FILE0000000000000000004A", fsOrgA, "s3", "b", "k/id-1")
	insertFile(t, pool, ctx, "01FILE0000000000000000004B", fsOrgA, "s3", "b", "k/id-2")
	insertFile(t, pool, ctx, "01FILE0000000000000000004C", fsOrgB, "s3", "b", "k/id-3")

	// Org branch: the key is unique per organization whatever the rest of the
	// command was - same key with a different purpose must collide so the
	// service can answer idempotency_conflict on the stored fingerprint.
	insertSession(t, pool, ctx, "01SESS0000000000000000004A", "01FILE0000000000000000004A",
		"audit_export", fsOrgA, nil, nil, "same-key")
	_, err := pool.Exec(ctx, `
		INSERT INTO file_upload_sessions (
		  id, file_id, created_by, created_by_kind, purpose,
		  organization_id, idempotency_key, command_fingerprint
		) VALUES ('01SESS0000000000000000004B', '01FILE0000000000000000004B', $1, 'human', 'chat_attachment',
		  $2, 'same-key', 'fp-other')`, fsActorA, fsOrgA)
	wantPgError(t, err, "23505", "uidx_file_upload_sessions_idempotency")

	// Same key in a different tenant is a different namespace and allowed.
	insertSession(t, pool, ctx, "01SESS0000000000000000004C", "01FILE0000000000000000004C",
		"audit_export", fsOrgB, nil, nil, "same-key")

	// The org lookup resolves any same-key replay to the stored session.
	stored, err := q.FindUploadSessionByIdempotencyKey(ctx, db.FindUploadSessionByIdempotencyKeyParams{
		OrganizationID: pgtype.Text{String: fsOrgA, Valid: true},
		IdempotencyKey: "same-key",
	})
	if err != nil {
		t.Fatal(err)
	}
	if stored.ID != "01SESS0000000000000000004A" || stored.CommandFingerprint != "fp-01SESS0000000000000000004A" {
		t.Fatalf("org idempotency lookup returned %s/%s", stored.ID, stored.CommandFingerprint)
	}

	// Identity branch: NULL tenant keys are unique per uploader instead.
	insertFile(t, pool, ctx, "01FILE0000000000000000004D", nil, "s3", "b", "k/id-4")
	insertFile(t, pool, ctx, "01FILE0000000000000000004E", nil, "s3", "b", "k/id-5")
	insertFile(t, pool, ctx, "01FILE0000000000000000004F", nil, "s3", "b", "k/id-6")
	insertSession(t, pool, ctx, "01SESS0000000000000000004D", "01FILE0000000000000000004D",
		"user_avatar", nil, nil, fsUserA, "av-key")
	_, err = pool.Exec(ctx, `
		INSERT INTO file_upload_sessions (
		  id, file_id, created_by, created_by_kind, purpose,
		  organization_id, workspace_id, user_id,
		  idempotency_key, command_fingerprint
		) VALUES ('01SESS0000000000000000004E', '01FILE0000000000000000004E', $1, 'human', 'user_avatar',
		  NULL, NULL, $2, 'av-key', 'fp')`, fsActorA, fsUserA)
	wantPgError(t, err, "23505", "uidx_file_upload_sessions_avatar_idempotency")
	// A different uploader may reuse the key - different binding (the avatar
	// index is per uploader actor, so created_by differs here).
	if _, err := pool.Exec(ctx, `
		INSERT INTO file_upload_sessions (
		  id, file_id, created_by, created_by_kind, purpose,
		  organization_id, workspace_id, user_id,
		  idempotency_key, command_fingerprint
		) VALUES ('01SESS0000000000000000004F', '01FILE0000000000000000004F', $1, 'human', 'user_avatar',
		  NULL, NULL, $1, 'av-key', 'fp')`, "01USRFS00000000000000000B"); err != nil {
		t.Fatalf("second uploader avatar session: %v", err)
	}

	avStored, err := q.FindUserUploadSessionByIdempotencyKey(ctx, db.FindUserUploadSessionByIdempotencyKeyParams{
		CreatedBy:      fsActorA,
		IdempotencyKey: "av-key",
	})
	if err != nil {
		t.Fatal(err)
	}
	if avStored.ID != "01SESS0000000000000000004D" {
		t.Fatalf("avatar idempotency lookup returned %s", avStored.ID)
	}
}

func TestFileServiceSessionClaimWindow(t *testing.T) {
	pool, ctx := fileServicePool(t)
	q := db.New(pool)

	insertFile(t, pool, ctx, "01FILE0000000000000000005A", fsOrgA, "s3", "b", "k/cl-1")
	insertFile(t, pool, ctx, "01FILE0000000000000000005B", fsOrgA, "s3", "b", "k/cl-2")
	insertFile(t, pool, ctx, "01FILE0000000000000000005C", fsOrgA, "s3", "b", "k/cl-3")

	// staged requires claim_expires_at.
	_, err := pool.Exec(ctx, `
		INSERT INTO file_upload_sessions (
		  id, file_id, created_by, created_by_kind, purpose,
		  organization_id, idempotency_key, command_fingerprint, status
		) VALUES ('01SESS0000000000000000005A', '01FILE0000000000000000005A', $1, 'human', 'audit_export',
		  $2, 'idem-cl-1', 'fp', 'staged')`, fsActorA, fsOrgA)
	wantPgError(t, err, "23514", "file_upload_sessions_claim_deadline")

	// A staged session inside the window consumes; a second consume hits the
	// terminal claimed state and changes zero rows. The caller supplies `now`.
	now := time.Now()
	insertSession(t, pool, ctx, "01SESS0000000000000000005B", "01FILE0000000000000000005B",
		"audit_export", fsOrgA, nil, nil, "idem-cl-2")
	if _, err := pool.Exec(ctx, `
		UPDATE file_upload_sessions SET status='staged', claim_expires_at=$1
		WHERE id='01SESS0000000000000000005B'`, now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if n, err := q.ConsumeUploadSession(ctx, db.ConsumeUploadSessionParams{
		ID:  "01SESS0000000000000000005B",
		Now: pgtype.Timestamptz{Time: now, Valid: true},
	}); err != nil || n != 1 {
		t.Fatalf("consume inside window: n=%d err=%v, want 1", n, err)
	}
	if n, err := q.ConsumeUploadSession(ctx, db.ConsumeUploadSessionParams{
		ID:  "01SESS0000000000000000005B",
		Now: pgtype.Timestamptz{Time: now, Valid: true},
	}); err != nil || n != 0 {
		t.Fatalf("re-consume of a claimed session: n=%d err=%v, want 0", n, err)
	}

	// A caller-supplied `now` past the deadline refuses even while the wall
	// clock is still inside the window - the param is the clock (T1-Q5).
	insertSession(t, pool, ctx, "01SESS0000000000000000005D", "01FILE0000000000000000005A",
		"audit_export", fsOrgA, nil, nil, "idem-cl-4")
	if _, err := pool.Exec(ctx, `
		UPDATE file_upload_sessions SET status='staged', claim_expires_at=$1
		WHERE id='01SESS0000000000000000005D'`, now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if n, err := q.ConsumeUploadSession(ctx, db.ConsumeUploadSessionParams{
		ID:  "01SESS0000000000000000005D",
		Now: pgtype.Timestamptz{Time: now.Add(2 * time.Hour), Valid: true},
	}); err != nil || n != 0 {
		t.Fatalf("consume with caller now past deadline: n=%d err=%v, want 0", n, err)
	}

	// Past the deadline, consume refuses even before the sweep runs (T1-Q5).
	insertSession(t, pool, ctx, "01SESS0000000000000000005C", "01FILE0000000000000000005C",
		"audit_export", fsOrgA, nil, nil, "idem-cl-3")
	if _, err := pool.Exec(ctx, `
		UPDATE file_upload_sessions SET status='staged', claim_expires_at=$1
		WHERE id='01SESS0000000000000000005C'`, now.Add(-time.Minute)); err != nil {
		t.Fatal(err)
	}
	if n, err := q.ConsumeUploadSession(ctx, db.ConsumeUploadSessionParams{
		ID:  "01SESS0000000000000000005C",
		Now: pgtype.Timestamptz{Time: now, Valid: true},
	}); err != nil || n != 0 {
		t.Fatalf("consume past deadline: n=%d err=%v, want 0 (file_claim_expired)", n, err)
	}

	// The sweep marks it expired at the caller's instant - a `now` before the
	// deadline leaves it staged, one after marks it.
	if _, err := q.ExpireUploadSessions(ctx, pgtype.Timestamptz{Time: now.Add(-2 * time.Minute), Valid: true}); err != nil {
		t.Fatal(err)
	}
	var staged string
	if err := pool.QueryRow(ctx, `SELECT status FROM file_upload_sessions WHERE id='01SESS0000000000000000005C'`).Scan(&staged); err != nil {
		t.Fatal(err)
	}
	if staged != "staged" {
		t.Fatalf("session expired early by an early caller now: status=%s", staged)
	}
	expired, err := q.ExpireUploadSessions(ctx, pgtype.Timestamptz{Time: now, Valid: true})
	if err != nil {
		t.Fatal(err)
	}
	var found bool
	for _, s := range expired {
		if s.ID == "01SESS0000000000000000005C" {
			found = true
		}
	}
	if !found {
		t.Fatal("sweep did not expire the overdue staged session")
	}
}

func TestFileServiceRollback(t *testing.T) {
	pool, ctx := fileServicePool(t)

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO files (id, organization_id, storage, bucket, object_key, original_filename)
		VALUES ('01FILE0000000000000000006A', $1, 's3', 'b', 'k/rb-1', 'a')`, fsOrgA); err != nil {
		t.Fatal(err)
	}
	if err := tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM files WHERE id='01FILE0000000000000000006A'`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatal("rolled-back file row is visible")
	}
}

func TestFileServiceJobLeaseAndDedupe(t *testing.T) {
	pool, ctx := fileServicePool(t)
	q := db.New(pool)

	insertFile(t, pool, ctx, "01FILE0000000000000000007A", fsOrgA, "s3", "b", "k/job-1")

	// A pending job carries no lease; a leased row carries the pair.
	_, err := pool.Exec(ctx, `
		INSERT INTO file_jobs (id, file_id, organization_id, operation, status, next_attempt_at, lease_owner)
		VALUES ('01JOB0000000000000000007A', '01FILE0000000000000000007A', $1, 'cleanup', 'pending', now(), 'w1')`, fsOrgA)
	wantPgError(t, err, "23514", "file_jobs_lease_state")
	_, err = pool.Exec(ctx, `
		INSERT INTO file_jobs (id, file_id, organization_id, operation, status, next_attempt_at, lease_owner)
		VALUES ('01JOB0000000000000000007A', '01FILE0000000000000000007A', $1, 'cleanup', 'leased', now(), 'w1')`, fsOrgA)
	wantPgError(t, err, "23514", "file_jobs_lease_state")

	// Enqueue dedupes a live (file, operation) pair via the partial unique index.
	q2 := db.New(pool)
	if err := q2.EnqueueFileJob(ctx, db.EnqueueFileJobParams{
		ID:             "01JOB0000000000000000007B",
		FileID:         "01FILE0000000000000000007A",
		OrganizationID: pgtype.Text{String: fsOrgA, Valid: true},
		Operation:      "cleanup",
		NextAttemptAt:  pgtype.Timestamptz{Time: time.Now().Add(-time.Minute), Valid: true},
		Details:        []byte(`{}`),
	}); err != nil {
		t.Fatal(err)
	}
	if err := q2.EnqueueFileJob(ctx, db.EnqueueFileJobParams{
		ID:             "01JOB0000000000000000007C",
		FileID:         "01FILE0000000000000000007A",
		OrganizationID: pgtype.Text{String: fsOrgA, Valid: true},
		Operation:      "cleanup",
		NextAttemptAt:  pgtype.Timestamptz{Time: time.Now().Add(-time.Minute), Valid: true},
		Details:        []byte(`{}`),
	}); err != nil {
		t.Fatal(err)
	}
	var live int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM file_jobs WHERE file_id='01FILE0000000000000000007A' AND operation='cleanup'`).Scan(&live); err != nil {
		t.Fatal(err)
	}
	if live != 1 {
		t.Fatalf("live dedupe: %d cleanup jobs, want 1", live)
	}

	// Claim leases the pending job, bumps its generation and fences with the
	// owner: a stale generation cannot complete it. A `now` before
	// next_attempt_at claims nothing - the caller's clock decides runnability.
	now := time.Now()
	if claimed, err := q.ClaimFileJobs(ctx, db.ClaimFileJobsParams{
		LeaseOwner:     pgtype.Text{String: "worker-0", Valid: true},
		LeaseExpiresAt: pgtype.Timestamptz{Time: now.Add(time.Minute), Valid: true},
		Now:            pgtype.Timestamptz{Time: now.Add(-time.Hour), Valid: true},
		LimitN:         10,
	}); err != nil || len(claimed) != 0 {
		t.Fatalf("claim with early now got %d jobs err=%v, want 0", len(claimed), err)
	}
	claimed, err := q.ClaimFileJobs(ctx, db.ClaimFileJobsParams{
		LeaseOwner:     pgtype.Text{String: "worker-1", Valid: true},
		LeaseExpiresAt: pgtype.Timestamptz{Time: now.Add(time.Minute), Valid: true},
		Now:            pgtype.Timestamptz{Time: now, Valid: true},
		LimitN:         10,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(claimed) != 1 {
		t.Fatalf("claimed %d jobs, want 1", len(claimed))
	}
	job := claimed[0]
	if job.Generation != 1 {
		t.Fatalf("generation after first lease = %d, want 1", job.Generation)
	}
	if n, err := q.CompleteFileJob(ctx, db.CompleteFileJobParams{
		ID: job.ID, Generation: job.Generation - 1,
		LeaseOwner: pgtype.Text{String: "worker-1", Valid: true},
		FinishedAt: pgtype.Timestamptz{Time: now, Valid: true},
	}); err != nil || n != 0 {
		t.Fatalf("stale generation completed n=%d err=%v, want 0", n, err)
	}
	if n, err := q.CompleteFileJob(ctx, db.CompleteFileJobParams{
		ID: job.ID, Generation: job.Generation,
		LeaseOwner: pgtype.Text{String: "worker-other", Valid: true},
		FinishedAt: pgtype.Timestamptz{Time: now, Valid: true},
	}); err != nil || n != 0 {
		t.Fatalf("foreign owner completed n=%d err=%v, want 0", n, err)
	}
	if n, err := q.CompleteFileJob(ctx, db.CompleteFileJobParams{
		ID: job.ID, Generation: job.Generation,
		LeaseOwner: pgtype.Text{String: "worker-1", Valid: true},
		FinishedAt: pgtype.Timestamptz{Time: now, Valid: true},
	}); err != nil || n != 1 {
		t.Fatalf("rightful completion: n=%d err=%v, want 1", n, err)
	}

	// A retried failure goes back to pending with a later attempt slot.
	insertFile(t, pool, ctx, "01FILE0000000000000000007D", fsOrgA, "s3", "b", "k/job-2")
	if err := q2.EnqueueFileJob(ctx, db.EnqueueFileJobParams{
		ID:             "01JOB0000000000000000007D",
		FileID:         "01FILE0000000000000000007D",
		OrganizationID: pgtype.Text{String: fsOrgA, Valid: true},
		Operation:      "reconcile",
		NextAttemptAt:  pgtype.Timestamptz{Time: time.Now().Add(-time.Minute), Valid: true},
		Details:        []byte(`{}`),
	}); err != nil {
		t.Fatal(err)
	}
	claimed, err = q.ClaimFileJobs(ctx, db.ClaimFileJobsParams{
		LeaseOwner:     pgtype.Text{String: "worker-2", Valid: true},
		LeaseExpiresAt: pgtype.Timestamptz{Time: now.Add(time.Minute), Valid: true},
		Now:            pgtype.Timestamptz{Time: now, Valid: true},
		LimitN:         10,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(claimed) != 1 {
		t.Fatalf("second claim got %d jobs, want 1", len(claimed))
	}
	if n, err := q.RetryFileJob(ctx, db.RetryFileJobParams{
		ID:            claimed[0].ID,
		Generation:    claimed[0].Generation,
		LeaseOwner:    pgtype.Text{String: "worker-2", Valid: true},
		NextAttemptAt: pgtype.Timestamptz{Time: time.Now().Add(24 * time.Hour), Valid: true},
		ErrorCode:     pgtype.Text{String: "storage_unavailable", Valid: true},
	}); err != nil || n != 1 {
		t.Fatalf("retry release: n=%d err=%v, want 1", n, err)
	}
	var status string
	var attempt int32
	if err := pool.QueryRow(ctx, `SELECT status, attempt FROM file_jobs WHERE id=$1`, claimed[0].ID).Scan(&status, &attempt); err != nil {
		t.Fatal(err)
	}
	if status != "pending" || attempt != 1 {
		t.Fatalf("after retry: status=%s attempt=%d, want pending/1", status, attempt)
	}
}
