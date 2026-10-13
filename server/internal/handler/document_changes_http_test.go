package handler

// Handler-level tests for the Office change-feed route (G5-01a, UNI-1344):
// the real Chi router over a real database with the real service, so the wire
// answers (status, code, envelope, fields), the limit parsing and the
// revision wire form are the ones under test. Snapshot/cursor semantics live
// in internal/service; these pin the HTTP surface the client sees.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type changeFeedWorld struct {
	srv    *httptest.Server
	token  string
	userID string
	orgID  string
	wsID   string
	q      *db.Queries
}

// newChangeFeedWorld builds the full handler stack with the real
// DocumentChangesService and one workspace-visible page. office_sync_feed is
// on by default, so a caller passes the member gate and the flag gate.
func newChangeFeedWorld(t *testing.T) *changeFeedWorld {
	t.Helper()
	d, pool := newTestDeps(t, nil, discardOutbox{})
	q := db.New(pool)
	docs := service.NewDocumentService(pool, q, d.Organizations, d.Workspaces)
	docs.SetEntitlements(service.NewEntitlementService(pool, q))
	d.Documents = docs
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)

	w := &changeFeedWorld{srv: srv, q: q}
	w.token, w.userID = filesRegister(t, srv, "change-feed@example.com")
	res, out := doJSON(t, srv, "POST", "/api/v1/orgs", w.token, map[string]string{"name": "Change Org", "slug": "change-org"})
	if res.StatusCode != 201 {
		t.Fatalf("create org: %d %v", res.StatusCode, out)
	}
	w.orgID = out["organization"].(map[string]any)["id"].(string)
	res, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+w.orgID+"/workspaces", w.token, map[string]string{"name": "Change WS", "slug": "change-ws"})
	if res.StatusCode != 201 {
		t.Fatalf("create ws: %d %v", res.StatusCode, out)
	}
	w.wsID = out["workspace"].(map[string]any)["id"].(string)
	w.seedDoc(t, util.NewID())
	return w
}

// seedDoc inserts one page document straight into the database: the HTTP
// create route is behind the documents flag, which this suite does not need.
func (w *changeFeedWorld) seedDoc(t *testing.T, id string) {
	t.Helper()
	row := map[string]any{
		"id": id, "organization_id": w.orgID, "workspace_id": w.wsID,
		"kind": "page", "title": "Tài liệu", "visibility": "workspace",
		"created_by": w.userID, "created_by_kind": "human", "updated_by": w.userID, "updated_by_kind": "human",
	}
	names, args, marks := make([]string, 0, len(row)), make([]any, 0, len(row)), make([]string, 0, len(row))
	for k, v := range row {
		names, args = append(names, k), append(args, v)
		marks = append(marks, fmt.Sprintf("$%d", len(args)))
	}
	if _, err := testPool.Exec(context.Background(), fmt.Sprintf(
		"INSERT INTO documents (%s) VALUES (%s)", strings.Join(names, ","), strings.Join(marks, ",")), args...); err != nil {
		t.Fatal(err)
	}
}

func (w *changeFeedWorld) feed(t *testing.T, query string) (int, map[string]any) {
	t.Helper()
	path := "/api/v1/workspaces/" + w.wsID + "/documents/changes"
	if query != "" {
		path += "?" + query
	}
	res, out := doJSON(t, w.srv, "GET", path, w.token, nil)
	return res.StatusCode, out
}

// changeErrorCode pulls error.code out of the decoded envelope doJSON read.
func changeErrorCode(out map[string]any) string {
	errObj, _ := out["error"].(map[string]any)
	code, _ := errObj["code"].(string)
	return code
}

// TestDocumentChangesHTTPErrorAnswers pins the wire answers the T-3 items
// name: a genuine cursor whose snapshot was swept answers 410
// change_cursor_expired (never a short page), a malformed cursor answers 400
// change_cursor_invalid with no scope text in the body, and office_sync_feed
// off answers 403 office_capability_off with fields.capability.
func TestDocumentChangesHTTPErrorAnswers(t *testing.T) {
	w := newChangeFeedWorld(t)
	// Two documents and limit=1: the cold start hands out a mid-pagination
	// SNAPSHOT cursor, the only kind that names the snapshot. A single-page
	// snapshot hands out the feed cursor, which answers 501 until G5-01b.
	w.seedDoc(t, util.NewID())

	status, out := w.feed(t, "limit=1")
	if status != http.StatusOK {
		t.Fatalf("cold start = %d %v, want 200", status, out)
	}
	cursor, _ := out["next_cursor"].(string)
	if more, _ := out["has_more"].(bool); cursor == "" || !more {
		t.Fatalf("cold start hands out no snapshot cursor: %v", out)
	}
	// The snapshot is swept before the next page: the cursor itself is
	// genuine and unexpired, so the honest answer is a full resync, never a
	// short or empty 200.
	if _, err := testPool.Exec(context.Background(), `DELETE FROM document_change_snapshot_items`); err != nil {
		t.Fatal(err)
	}
	if _, err := testPool.Exec(context.Background(), `DELETE FROM document_change_snapshots`); err != nil {
		t.Fatal(err)
	}
	status, out = w.feed(t, "limit=1&cursor="+url.QueryEscape(cursor))
	if status != http.StatusGone || changeErrorCode(out) != "change_cursor_expired" {
		t.Fatalf("swept snapshot = %d %v, want 410 change_cursor_expired", status, out)
	}

	status, out = w.feed(t, "cursor=not-a-cursor")
	if status != http.StatusBadRequest || changeErrorCode(out) != "change_cursor_invalid" {
		t.Fatalf("malformed cursor = %d %v, want 400 change_cursor_invalid", status, out)
	}
	body, _ := json.Marshal(out)
	for _, leak := range []string{w.orgID, w.wsID, w.userID} {
		if strings.Contains(string(body), leak) {
			t.Errorf("the 400 body names %q: %s", leak, body)
		}
	}

	// The flag hides the capability: 403 with fields.capability, shaped the
	// same way the X-03 capability route shapes it.
	if _, err := w.q.UpsertFlagOverride(context.Background(), db.UpsertFlagOverrideParams{
		ID: util.NewID(), FlagKey: "office_sync_feed", ScopeType: featureflags.ScopeOrganization,
		ScopeID: w.orgID, Enabled: false, Note: "change feed handler test", CreatedBy: "test",
	}); err != nil {
		t.Fatal(err)
	}
	if testFlagOverrides != nil {
		testFlagOverrides.Invalidate()
	}
	status, out = w.feed(t, "")
	if status != http.StatusForbidden || changeErrorCode(out) != "office_capability_off" {
		t.Fatalf("flag off = %d %v, want 403 office_capability_off", status, out)
	}
	errObj, _ := out["error"].(map[string]any)
	fields, _ := errObj["fields"].(map[string]any)
	if fields["capability"] != "sync_feed" {
		t.Fatalf("flag off fields = %v, want capability=sync_feed", fields)
	}
}

// TestDocumentChangesHTTPLimitParsing pins limit parsing at the handler
// (T-4): non-integer and negative fail 400 before any work, zero reads as
// unset, a valid bound is honoured, and an oversized one is clamped to the
// contract maximum rather than refused.
func TestDocumentChangesHTTPLimitParsing(t *testing.T) {
	w := newChangeFeedWorld(t)
	w.seedDoc(t, util.NewID())
	w.seedDoc(t, util.NewID())

	for _, raw := range []string{"abc", "-1", "1.5"} {
		status, out := w.feed(t, "limit="+raw)
		if status != http.StatusBadRequest || changeErrorCode(out) != "invalid_request" {
			t.Fatalf("limit=%s = %d %v, want 400 invalid_request", raw, status, out)
		}
	}

	for _, tc := range []struct {
		name    string
		query   string
		want    int
		hasMore bool
	}{
		{"zero reads as unset", "limit=0", 3, false},
		{"explicit bound is honoured", "limit=1", 1, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			status, out := w.feed(t, tc.query)
			if status != http.StatusOK {
				t.Fatalf("%s = %d %v, want 200", tc.name, status, out)
			}
			changes, _ := out["changes"].([]any)
			if len(changes) != tc.want {
				t.Fatalf("%s: %d rows, want %d", tc.name, len(changes), tc.want)
			}
			if more, _ := out["has_more"].(bool); more != tc.hasMore {
				t.Fatalf("%s: has_more = %v, want %v", tc.name, more, tc.hasMore)
			}
		})
	}

	status, out := w.feed(t, "limit=100000")
	if status != http.StatusOK {
		t.Fatalf("oversized limit = %d %v, want 200 (clamped)", status, out)
	}
	changes, _ := out["changes"].([]any)
	if len(changes) != 3 {
		t.Fatalf("oversized limit returned %d rows, want all 3", len(changes))
	}
}

// BE-F1-1: a revision larger than JavaScript's safe-integer range crosses the
// HTTP wire as an exact decimal string, never a rounded JSON number (spec §3
// invariant 2). The test parses the raw body, so it also proves the JSON type.
func TestDocumentChangesRevisionWireIsDecimalString(t *testing.T) {
	w := newChangeFeedWorld(t)
	const big = int64(9007199254740993) // 2^53 + 1, not representable in float64
	if _, err := testPool.Exec(context.Background(),
		`UPDATE documents SET revision = $1 WHERE workspace_id = $2`, big, w.wsID); err != nil {
		t.Fatal(err)
	}
	status, out := w.feed(t, "")
	if status != http.StatusOK {
		t.Fatalf("feed = %d %v", status, out)
	}
	changes, _ := out["changes"].([]any)
	if len(changes) != 1 {
		t.Fatalf("feed returned %d rows, want 1", len(changes))
	}
	row, _ := changes[0].(map[string]any)
	revision, ok := row["revision"].(string)
	if !ok {
		t.Fatalf("revision is %T (%v), want a decimal string", row["revision"], row["revision"])
	}
	if revision != strconv.FormatInt(big, 10) {
		t.Fatalf("revision = %q, want %q", revision, strconv.FormatInt(big, 10))
	}
}

// TestDocumentChangesHTTPFeedRows pins the incremental feed's wire row
// (G5-01b): a feed page fills `feed` and leaves `changes` empty, and a removal
// carries the document id, the change kind and its reason - no title, no path,
// no metadata - on the raw body.
func TestDocumentChangesHTTPFeedRows(t *testing.T) {
	w := newChangeFeedWorld(t)
	docID := util.NewID()
	w.seedDoc(t, docID)

	// The empty cold start over one document hands out the feed cursor.
	status, out := w.feed(t, "")
	if status != http.StatusOK {
		t.Fatalf("cold start = %d %v, want 200", status, out)
	}
	cursor, _ := out["next_cursor"].(string)
	if cursor == "" {
		t.Fatalf("cold start hands out no cursor: %v", out)
	}

	// The document is purged, with the audit row a purge writes.
	if _, err := testPool.Exec(context.Background(), `DELETE FROM documents WHERE id = $1`, docID); err != nil {
		t.Fatal(err)
	}
	if _, err := testPool.Exec(context.Background(),
		`INSERT INTO audit_events (id, organization_id, workspace_id, actor_kind, actor_id, action, resource_type, resource_id, correlation_id)
		 VALUES ($1, $2, $3, 'system', 'documents.purge', 'document.deleted', 'document', $4, $5)`,
		util.NewID(), w.orgID, w.wsID, docID, util.NewID()); err != nil {
		t.Fatal(err)
	}

	status, out = w.feed(t, "cursor="+url.QueryEscape(cursor))
	if status != http.StatusOK {
		t.Fatalf("feed page = %d %v, want 200", status, out)
	}
	if phase, _ := out["phase"].(string); phase != "feed" {
		t.Fatalf("phase = %q, want feed", phase)
	}
	if changes, _ := out["changes"].([]any); len(changes) != 0 {
		t.Fatalf("a feed page carries %d snapshot rows, want none", len(changes))
	}
	feed, _ := out["feed"].([]any)
	if len(feed) != 1 {
		t.Fatalf("feed page = %v, want one row", out["feed"])
	}
	row, _ := feed[0].(map[string]any)
	if row["document_id"] != docID || row["change_kind"] != "removal" ||
		row["kind"] != "" || row["revision"] != "0" || row["removal"] != "document_deleted" {
		t.Fatalf("removal row = %v", row)
	}
	if _, ok := row["title"]; ok {
		t.Fatalf("removal row carries a title: %v", row)
	}
}
