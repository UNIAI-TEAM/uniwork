package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/testutil"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// TestIdempotentCreateReplaysSameResponse: two CreateTask with the same
// Idempotency-Key produce one task row and an identical response body.
func TestIdempotentCreateReplaysSameResponse(t *testing.T) {
	s, _, ua, _, w := taskFixture(t)
	ctx := context.Background()
	q := s.q
	key := util.NewID()
	scope := "tasks.create"

	createOnce := func() (db.Task, []byte, int) {
		t.Helper()
		replay, commit, err := BeginIdempotent(ctx, q, w.OrganizationID, w.ID, scope, key, ua.ID, IdempotencyOptions{})
		if err != nil {
			t.Fatal(err)
		}
		if replay != nil {
			var task db.Task
			if err := json.Unmarshal(replay.Body, &task); err != nil {
				t.Fatal(err)
			}
			return task, replay.Body, replay.Status
		}
		task, err := s.Create(ctx, Human(ua.ID), w.ID, CreateTaskInput{Title: "Idempotent", Priority: "medium"})
		if err != nil {
			t.Fatal(err)
		}
		body, err := json.Marshal(task)
		if err != nil {
			t.Fatal(err)
		}
		if err := commit(http.StatusCreated, body); err != nil {
			t.Fatal(err)
		}
		return task, body, http.StatusCreated
	}

	first, body1, status1 := createOnce()
	second, body2, status2 := createOnce()

	if status1 != http.StatusCreated || status2 != http.StatusCreated {
		t.Fatalf("status: first=%d second=%d", status1, status2)
	}
	if first.ID != second.ID {
		t.Fatalf("expected one task, got %s and %s", first.ID, second.ID)
	}
	if string(body1) != string(body2) {
		t.Fatalf("response bodies differ:\n%s\n%s", body1, body2)
	}
	list, err := s.List(ctx, ua.ID, w.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 {
		t.Fatalf("task rows: got %d want 1", len(list))
	}
	n, err := q.CountIdempotencyKeys(ctx, db.CountIdempotencyKeysParams{
		OrganizationID: w.OrganizationID,
		WorkspaceID:    w.ID,
		Scope:          scope,
		Key:            key,
	})
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("idempotency_keys rows: got %d want 1", n)
	}
}

func TestRevisionConflictOnStaleUpdate(t *testing.T) {
	// update with revision=1 after server already at 2 → CodedError revision_conflict
	err := CheckTaskRevision(1, 2)
	var ce CodedError
	if !errors.As(err, &ce) {
		t.Fatalf("want CodedError, got %v", err)
	}
	if ce.Code != "revision_conflict" {
		t.Fatalf("code: got %q want revision_conflict", ce.Code)
	}
	if ce.Status != http.StatusUnprocessableEntity {
		t.Fatalf("status: got %d want 422", ce.Status)
	}
	if CheckTaskRevision(2, 2) != nil {
		t.Fatal("matching revision should pass")
	}
}

// DOC-005 §3.1: a key bound to a fingerprint replays only the same payload;
// a row with no fingerprint is "unknown", never "matches"; the zero options
// keep the legacy replay.
func TestIdempotencyFingerprintOptions(t *testing.T) {
	s, _, ua, ub, w := taskFixture(t)
	ctx := context.Background()
	q := s.q
	fp := IdempotencyFingerprint("op", "doc", "1", "sum")
	opts := IdempotencyOptions{Fingerprint: fp, RequireFingerprint: true}

	if IdempotencyFingerprint("a", "bc") == IdempotencyFingerprint("ab", "c") {
		t.Fatal("fingerprint parts collide")
	}
	if _, _, err := BeginIdempotent(ctx, q, w.OrganizationID, w.ID, "docs", util.NewID(), ua.ID, IdempotencyOptions{RequireFingerprint: true}); !errors.Is(err, errIdempotencyFingerprintRequired) {
		t.Fatalf("missing fingerprint = %v", err)
	}

	key := util.NewID()
	replay, commit, err := BeginIdempotent(ctx, q, w.OrganizationID, w.ID, "docs", key, ua.ID, opts)
	if err != nil || replay != nil {
		t.Fatalf("first claim: replay=%v err=%v", replay, err)
	}
	if err := commit(http.StatusOK, []byte(`{"ok":true}`)); err != nil {
		t.Fatal(err)
	}
	replay, _, err = BeginIdempotent(ctx, q, w.OrganizationID, w.ID, "docs", key, ua.ID, opts)
	if err != nil || replay == nil || string(replay.Body) != `{"ok":true}` {
		t.Fatalf("same payload: replay=%v err=%v", replay, err)
	}
	if peek, err := PeekIdempotent(ctx, q, w.OrganizationID, w.ID, "docs", key, ua.ID, opts); err != nil || peek == nil {
		t.Fatalf("peek: %v %v", peek, err)
	}
	other := IdempotencyOptions{Fingerprint: IdempotencyFingerprint("op", "doc", "2", "sum"), RequireFingerprint: true}
	if _, _, err := BeginIdempotent(ctx, q, w.OrganizationID, w.ID, "docs", key, ua.ID, other); !codedIs(err, "idempotency_payload_mismatch") {
		t.Fatalf("different payload = %v", err)
	}
	if _, _, err := BeginIdempotent(ctx, q, w.OrganizationID, w.ID, "docs", key, ub.ID, opts); !codedIs(err, "idempotency_key_reuse") {
		t.Fatalf("different actor = %v", err)
	}
	// Legacy callers still replay whatever they stored, fingerprint or not.
	if replay, _, err := BeginIdempotent(ctx, q, w.OrganizationID, w.ID, "docs", key, ua.ID, IdempotencyOptions{}); err != nil || replay == nil {
		t.Fatalf("legacy replay: %v %v", replay, err)
	}

	legacy := util.NewID()
	_, commit, err = BeginIdempotent(ctx, q, w.OrganizationID, w.ID, "docs", legacy, ua.ID, IdempotencyOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if err := commit(http.StatusOK, []byte(`{}`)); err != nil {
		t.Fatal(err)
	}
	if _, _, err := BeginIdempotent(ctx, q, w.OrganizationID, w.ID, "docs", legacy, ua.ID, opts); !codedIs(err, "idempotency_payload_mismatch") {
		t.Fatalf("row without fingerprint = %v, want mismatch (never replay)", err)
	}
	if _, err := PeekIdempotent(ctx, q, w.OrganizationID, w.ID, "docs", legacy, ua.ID, opts); !codedIs(err, "idempotency_payload_mismatch") {
		t.Fatalf("peek row without fingerprint = %v", err)
	}
}

func TestSweepIdempotencyKeysCutoffAndStatus(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `DELETE FROM idempotency_keys`); err != nil {
		t.Fatal(err)
	}

	svc := NewDocumentService(pool, q, nil, nil)
	now := time.Now().UTC().Truncate(time.Microsecond)
	cutoff := now.Add(-DefaultIdempotencyKeyRetention)
	orgID, wsID, actorID := util.NewID(), util.NewID(), util.NewID()

	seedKey := func(createdAt time.Time, status *int32, body []byte) string {
		t.Helper()
		key := util.NewID()
		var st pgtype.Int4
		if status != nil {
			st = pgtype.Int4{Int32: *status, Valid: true}
		}
		if _, err := pool.Exec(ctx, `
			INSERT INTO idempotency_keys (
				id, organization_id, workspace_id, scope, key, actor_id, response_status, response_body, created_at
			) VALUES ($1, $2, $3, 'tasks.create', $4, $5, $6, $7, $8)
		`, util.NewID(), orgID, wsID, key, actorID, st, body, createdAt); err != nil {
			t.Fatal(err)
		}
		return key
	}

	countKey := func(key string) int64 {
		t.Helper()
		n, err := q.CountIdempotencyKeys(ctx, db.CountIdempotencyKeysParams{
			OrganizationID: orgID,
			WorkspaceID:    wsID,
			Scope:          "tasks.create",
			Key:            key,
		})
		if err != nil {
			t.Fatal(err)
		}
		return n
	}

	status201 := int32(http.StatusCreated)
	status200 := int32(http.StatusOK)
	oldCompleted := seedKey(cutoff.Add(-time.Second), &status201, []byte(`{"id":"1"}`))
	oldInFlight := seedKey(cutoff.Add(-time.Microsecond), nil, nil)
	atBoundary := seedKey(cutoff, &status200, []byte(`{"id":"2"}`))
	freshCompleted := seedKey(now.Add(-time.Hour), &status201, []byte(`{"id":"3"}`))
	freshInFlight := seedKey(now.Add(-time.Minute), nil, nil)

	swept, err := svc.SweepIdempotencyKeys(ctx, now)
	if err != nil {
		t.Fatalf("SweepIdempotencyKeys: %v", err)
	}
	if swept != 2 {
		t.Fatalf("swept = %d, want 2 (oldCompleted + oldInFlight)", swept)
	}
	if n := countKey(oldCompleted); n != 0 {
		t.Fatalf("old completed row survived sweep (count=%d)", n)
	}
	if n := countKey(oldInFlight); n != 0 {
		t.Fatalf("old in-flight row survived sweep (count=%d)", n)
	}
	if n := countKey(atBoundary); n != 1 {
		t.Fatalf("row exactly at cutoff boundary was deleted (count=%d)", n)
	}
	if n := countKey(freshCompleted); n != 1 {
		t.Fatalf("fresh completed row was deleted (count=%d)", n)
	}
	if n := countKey(freshInFlight); n != 1 {
		t.Fatalf("fresh in-flight row was deleted (count=%d)", n)
	}

	// Configured policy Retention overrides the 168h default.
	svc.SetIdempotencyKeyPolicy(IdempotencyKeyPolicy{Retention: 30 * time.Minute})
	sweptCustom, err := svc.SweepIdempotencyKeys(ctx, now)
	if err != nil {
		t.Fatalf("SweepIdempotencyKeys with custom retention: %v", err)
	}
	if sweptCustom != 2 {
		t.Fatalf("swept with 30m retention = %d, want 2 (atBoundary + freshCompleted at -1h)", sweptCustom)
	}
	if n := countKey(freshInFlight); n != 1 {
		t.Fatalf("row at -1m was deleted under 30m retention (count=%d)", n)
	}
}

func TestSweepIdempotencyKeysBatched(t *testing.T) {
	pool := testutil.DB(t)
	q := db.New(pool)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `DELETE FROM idempotency_keys`); err != nil {
		t.Fatal(err)
	}

	svc := NewDocumentService(pool, q, nil, nil)
	now := time.Now().UTC().Truncate(time.Microsecond)
	cutoff := now.Add(-DefaultIdempotencyKeyRetention)
	orgID, wsID, actorID := util.NewID(), util.NewID(), util.NewID()

	seedExpired := func(prefix string, total int) {
		t.Helper()
		if _, err := pool.Exec(ctx, `
			INSERT INTO idempotency_keys (
				id, organization_id, workspace_id, scope, key, actor_id, response_status, created_at
			)
			SELECT
				$1 || '-' || g::text,
				$2, $3, 'tasks.create', $1 || '-key-' || g::text, $4,
				CASE WHEN g % 2 = 0 THEN 201 ELSE NULL END,
				$5::timestamptz - (g || ' seconds')::interval
			FROM generate_series(1, $6::int) AS g
		`, prefix, orgID, wsID, actorID, cutoff, total); err != nil {
			t.Fatal(err)
		}
	}

	// Seed 1201 expired rows and 3 fresh rows.
	seedExpired("batch1", 1201)
	if _, err := pool.Exec(ctx, `
		INSERT INTO idempotency_keys (
			id, organization_id, workspace_id, scope, key, actor_id, response_status, created_at
		)
		SELECT
			'fresh-' || g::text,
			$1, $2, 'tasks.create', 'fresh-key-' || g::text, $3, 200, $4::timestamptz
		FROM generate_series(1, 3) AS g
	`, orgID, wsID, actorID, now); err != nil {
		t.Fatal(err)
	}

	// 1. Prove the single-batch sqlc statement is bounded by idempotencyKeySweepBatch (500).
	oneBatch, err := q.SweepIdempotencyKeys(ctx, db.SweepIdempotencyKeysParams{
		Cutoff:  pgtype.Timestamptz{Time: cutoff, Valid: true},
		MaxRows: idempotencyKeySweepBatch,
	})
	if err != nil {
		t.Fatalf("single-batch SweepIdempotencyKeys query: %v", err)
	}
	if oneBatch != idempotencyKeySweepBatch {
		t.Fatalf("single-batch query deleted %d rows, want exactly %d", oneBatch, idempotencyKeySweepBatch)
	}

	// Top up another 500 expired rows so 1201 expired rows remain across 3 batches (500 + 500 + 201).
	seedExpired("batch2", 500)

	// 2. Prove the service method loops until a batch comes back short, removing all 1201 expired rows.
	swept, err := svc.SweepIdempotencyKeys(ctx, now)
	if err != nil {
		t.Fatalf("service SweepIdempotencyKeys: %v", err)
	}
	if swept != 1201 {
		t.Fatalf("service SweepIdempotencyKeys deleted %d rows, want 1201 across 3 batches", swept)
	}

	var remaining int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM idempotency_keys`).Scan(&remaining); err != nil {
		t.Fatal(err)
	}
	if remaining != 3 {
		t.Fatalf("remaining rows in idempotency_keys = %d, want 3 fresh rows", remaining)
	}
}

func TestSweepIdempotencyKeysTenantSafe(t *testing.T) {
	taskSvc, _, ua, ub, wsA := taskFixture(t)
	pool := taskSvc.pool
	q := taskSvc.q
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `DELETE FROM idempotency_keys`); err != nil {
		t.Fatal(err)
	}

	// Create a real task in wsA so we can verify other business tables are untouched.
	createdTask, err := taskSvc.Create(ctx, Human(ua.ID), wsA.ID, CreateTaskInput{Title: "keep-me"})
	if err != nil {
		t.Fatalf("Create task: %v", err)
	}

	orgA, wsAID, actorA := wsA.OrganizationID, wsA.ID, ua.ID
	orgB, wsBID, actorB := util.NewID(), util.NewID(), ub.ID
	now := time.Now().UTC().Truncate(time.Microsecond)
	cutoff := now.Add(-DefaultIdempotencyKeyRetention)

	insertRow := func(orgID, wsID, actorID, key string, createdAt time.Time, status *int32) {
		t.Helper()
		var st pgtype.Int4
		if status != nil {
			st = pgtype.Int4{Int32: *status, Valid: true}
		}
		if _, err := pool.Exec(ctx, `
			INSERT INTO idempotency_keys (
				id, organization_id, workspace_id, scope, key, actor_id, response_status, created_at
			) VALUES ($1, $2, $3, 'tasks.create', $4, $5, $6, $7)
		`, util.NewID(), orgID, wsID, key, actorID, st, createdAt); err != nil {
			t.Fatal(err)
		}
	}

	st201 := int32(http.StatusCreated)
	insertRow(orgA, wsAID, actorA, "a-exp-done", cutoff.Add(-2*time.Hour), &st201)
	insertRow(orgA, wsAID, actorA, "a-exp-inflight", cutoff.Add(-time.Minute), nil)
	insertRow(orgA, wsAID, actorA, "a-fresh-done", now.Add(-time.Minute), &st201)
	insertRow(orgA, wsAID, actorA, "a-fresh-inflight", now, nil)

	insertRow(orgB, wsBID, actorB, "b-exp-done", cutoff.Add(-3*time.Hour), &st201)
	insertRow(orgB, wsBID, actorB, "b-exp-inflight", cutoff.Add(-time.Second), nil)
	insertRow(orgB, wsBID, actorB, "b-fresh-done", now.Add(-2*time.Minute), &st201)
	insertRow(orgB, wsBID, actorB, "b-fresh-inflight", now, nil)

	var tasksBefore int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM tasks WHERE id = $1`, createdTask.ID).Scan(&tasksBefore); err != nil {
		t.Fatal(err)
	}

	docSvc := NewDocumentService(pool, q, nil, nil)
	swept, err := docSvc.SweepIdempotencyKeys(ctx, now)
	if err != nil {
		t.Fatalf("SweepIdempotencyKeys: %v", err)
	}
	if swept != 4 {
		t.Fatalf("swept = %d, want 4 (2 expired in orgA + 2 expired in orgB)", swept)
	}

	var countA, countB int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM idempotency_keys WHERE organization_id = $1`, orgA).Scan(&countA); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM idempotency_keys WHERE organization_id = $1`, orgB).Scan(&countB); err != nil {
		t.Fatal(err)
	}
	if countA != 2 || countB != 2 {
		t.Fatalf("surviving rows: orgA=%d orgB=%d, want 2 and 2", countA, countB)
	}

	var tasksAfter int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM tasks WHERE id = $1`, createdTask.ID).Scan(&tasksAfter); err != nil {
		t.Fatal(err)
	}
	if tasksAfter != tasksBefore || tasksAfter != 1 {
		t.Fatalf("tasks row count changed: before=%d after=%d", tasksBefore, tasksAfter)
	}
}
