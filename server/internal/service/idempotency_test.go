package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"testing"

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
