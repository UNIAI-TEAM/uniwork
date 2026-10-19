package handler

// Handler-level tests for the DOC-07 access-request routes (UNI-1631, §4.3).
// They drive the real Chi router over a real database with a real
// DocumentService, so the flag gate, the limiter, the error envelope and the
// uniform 202 are the ones under test. The agent -> 403 case is not here: no
// HTTP path can build an agent actor (every handler builds service.Human, and
// internal/arch_test.go forbids constructing KindAgent outside the service
// tier), so w1's TestDocumentAccessRequestUniform holds it at the service.

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/util"
)

// accessRequestCreate posts one create and returns the raw body so a case can
// assert the exact bytes of the uniform 202.
func accessRequestCreate(t *testing.T, w *docsWorld, docID string, body any) (*http.Response, map[string]any, []byte) {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		_ = json.NewEncoder(&buf).Encode(body)
	}
	req, _ := http.NewRequest(http.MethodPost, w.srv.URL+"/api/v1/documents/"+docID+"/access-requests", &buf)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+w.token)
	res, err := w.srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := readAll(res)
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	return res, out, raw
}

// A01: a well-formed send answers exactly 202 {"status":"sent"}; the body is
// byte-for-byte the contract the web client parses.
func TestDocumentAccessRequestCreateIsUniform202(t *testing.T) {
	w := newDocsWorld(t)
	docID := unreadablePage(t, w)

	res, out, raw := accessRequestCreate(t, w, docID, map[string]any{"requested_level": "view", "message": "please"})
	if res.StatusCode != http.StatusAccepted {
		t.Fatalf("create = %d, want 202: %s", res.StatusCode, raw)
	}
	if got := string(bytes.TrimSpace(raw)); got != `{"status":"sent"}` {
		t.Fatalf("202 body = %s, want {\"status\":\"sent\"}", got)
	}
	if out["status"] != "sent" {
		t.Fatalf("status = %v, want sent", out["status"])
	}
}

// A02: the answer never reveals whether the document exists. A document the
// caller already reads and a nonexistent id both answer the same 202 with the
// same bytes.
func TestDocumentAccessRequestCreateHidesExistence(t *testing.T) {
	w := newDocsWorld(t)
	_, readableID := createPage(t, w, "Own page", nil)

	_, _, readable := accessRequestCreate(t, w, readableID, map[string]any{"requested_level": "view"})
	// The caller created the page, so they already read it: the request is
	// swallowed and the answer is the uniform 202.
	if got := string(bytes.TrimSpace(readable)); got != `{"status":"sent"}` {
		t.Fatalf("readable document = %s, want the uniform sent body", got)
	}

	res, _, unknown := accessRequestCreate(t, w, "01J8X4NONEN1P2Q3R4S5T6U7V8", map[string]any{"requested_level": "view"})
	if res.StatusCode != http.StatusAccepted || !bytes.Equal(bytes.TrimSpace(unknown), bytes.TrimSpace(readable)) {
		t.Fatalf("nonexistent id = %d %s, want the same 202 as a readable one %s", res.StatusCode, unknown, readable)
	}
}

// A09/A10: a syntactically bad body is a 400 whatever the document is, because
// the answer depends on the body alone and so leaks nothing.
func TestDocumentAccessRequestCreateRejectsBadBody(t *testing.T) {
	w := newDocsWorld(t)
	docID := unreadablePage(t, w)

	for name, body := range map[string]any{
		"level manage":      map[string]any{"requested_level": "manage"},
		"level nonsense":    map[string]any{"requested_level": "owner"},
		"lone source kind":  map[string]any{"source_kind": "task"},
		"lone source id":    map[string]any{"source_id": "01J8X4TASK0N1P2Q3R4S5T6U7"},
		"bad source kind":   map[string]any{"source_kind": "chat", "source_id": "01J8X4TASK0N1P2Q3R4S5T6U7"},
		"source not a ULID": map[string]any{"source_kind": "task", "source_id": "not-a-ulid"},
		"message too long":  map[string]any{"message": longMessage(501)},
	} {
		t.Run(name, func(t *testing.T) {
			res, out, raw := accessRequestCreate(t, w, docID, body)
			if res.StatusCode != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400: %s", res.StatusCode, raw)
			}
			if code, _ := errCodeClass(out); code != "invalid_request" {
				t.Fatalf("code = %q, want invalid_request", code)
			}
		})
	}

	// A message of exactly the cap is accepted, so the boundary is the cap and
	// not one character below it.
	res, _, raw := accessRequestCreate(t, w, docID, map[string]any{"message": longMessage(500)})
	if res.StatusCode != http.StatusAccepted {
		t.Fatalf("500-character message = %d, want 202: %s", res.StatusCode, raw)
	}
}

// A03 (wire half): a second send while the first is pending answers 409
// access_request_pending with error_class conflict, so the card moves to
// "already requested" instead of showing a failure.
func TestDocumentAccessRequestCreateSecondSendIsPending409(t *testing.T) {
	w := newDocsWorld(t)
	docID := unreadablePage(t, w)

	if res, _, raw := accessRequestCreate(t, w, docID, map[string]any{"requested_level": "view"}); res.StatusCode != http.StatusAccepted {
		t.Fatalf("first send = %d, want 202: %s", res.StatusCode, raw)
	}
	res, out, raw := accessRequestCreate(t, w, docID, map[string]any{"requested_level": "edit"})
	if res.StatusCode != http.StatusConflict {
		t.Fatalf("second send = %d, want 409: %s", res.StatusCode, raw)
	}
	code, class := errCodeClass(out)
	if code != "access_request_pending" || class != "conflict" {
		t.Fatalf("code/class = %q/%q, want access_request_pending/conflict", code, class)
	}
}

// A09 (wire half): a send inside the cooldown after a decline answers 429
// access_request_cooldown, and the Retry-After header equals the seconds in
// fields.retry_after_seconds. The handler reads that key by name, not the
// retry_after one the shared helper reads.
func TestDocumentAccessRequestCreateCooldownCarriesRetryAfter(t *testing.T) {
	w := newDocsWorld(t)
	docID := unreadablePage(t, w)

	// A decline of the caller's own request one minute ago: 59 minutes of the
	// one-hour cooldown are left, so retry_after_seconds is 3540.
	declined := util.NewID()
	if _, err := testPool.Exec(context.Background(), `INSERT INTO document_access_requests
		(id, organization_id, workspace_id, document_id, created_by, created_by_kind, requested_level, message,
		 status, decided_by, decided_by_kind, decided_at, expires_at)
		VALUES ($1, $2, $3, $4, $5, 'human', 'view', '', 'declined', $5, 'human', now() - interval '1 minute', now() + interval '30 days')`,
		declined, w.orgID, w.wsID, docID, w.userID); err != nil {
		t.Fatalf("seed declined request: %v", err)
	}

	res, out, raw := accessRequestCreate(t, w, docID, map[string]any{"requested_level": "view"})
	if res.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("send inside the cooldown = %d, want 429: %s", res.StatusCode, raw)
	}
	code, class := errCodeClass(out)
	if code != "access_request_cooldown" {
		t.Fatalf("code = %q, want access_request_cooldown", code)
	}
	if class != "" {
		t.Fatalf("error_class = %q, want none (deliberately unclassified)", class)
	}
	// fields.retry_after_seconds is the remaining seconds rounded up, and the
	// Retry-After header carries the same value.
	errObj, _ := out["error"].(map[string]any)
	fields, _ := errObj["fields"].(map[string]any)
	seconds, ok := fields["retry_after_seconds"].(float64)
	if !ok {
		t.Fatalf("fields.retry_after_seconds missing: %s", raw)
	}
	if got, want := res.Header.Get("Retry-After"), int(seconds); got != strconv.Itoa(want) {
		t.Fatalf("Retry-After = %q, want %d (fields.retry_after_seconds)", got, want)
	}
	if seconds < 1 {
		t.Fatalf("retry_after_seconds = %v, want >= 1", seconds)
	}
}

// longMessage builds a message of exactly n characters.
func longMessage(n int) string {
	b := make([]rune, n)
	for i := range b {
		b[i] = 'x'
	}
	return string(b)
}

// unreadablePage creates a page the caller administers but does not read: it is
// restricted and its ACL owner is NULL, so the caller (the workspace owner)
// holds AdminScope with no read level and an access request is stored rather
// than swallowed. That is the only shape in which the create reaches its
// 409/429 branches.
func unreadablePage(t *testing.T, w *docsWorld) string {
	t.Helper()
	_, docID := createPage(t, w, "Restricted page", nil)
	if _, err := testPool.Exec(context.Background(),
		`UPDATE documents SET visibility = 'restricted', acl_owner_id = NULL WHERE id = $1`, docID); err != nil {
		t.Fatalf("restrict document: %v", err)
	}
	return docID
}
