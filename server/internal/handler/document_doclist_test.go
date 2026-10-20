package handler

// UNI-2045 DOCLIST-UNIFIED (server w1): the list items the unified documents
// table needs, over the real router and a real database. Each test names the
// SV item of the contract it holds.

import (
	"context"
	"fmt"
	"net/http"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/util"
)

// dlGet is one authenticated GET returning the decoded body.
func dlGet(t *testing.T, w *docsWorld, token, path string) (*http.Response, map[string]any) {
	t.Helper()
	return doJSON(t, w.srv, "GET", path, token, nil)
}

// dlIDs is the ids of one page of a DocumentListSDO.
func dlIDs(out map[string]any) []string {
	raw, _ := out["documents"].([]any)
	ids := make([]string, 0, len(raw))
	for _, item := range raw {
		ids = append(ids, item.(map[string]any)["id"].(string))
	}
	return ids
}

// dlWalk follows next_cursor from path (which already has its query) with the
// given page size and returns every page's ids; it fails on a non-200 page or
// an endless walk.
func dlWalk(t *testing.T, w *docsWorld, token, path string, limit int) [][]string {
	t.Helper()
	sep := "?"
	if strings.Contains(path, "?") {
		sep = "&"
	}
	var pages [][]string
	cursor := ""
	for i := 0; i < 50; i++ {
		url := fmt.Sprintf("%s%slimit=%d", path, sep, limit)
		if cursor != "" {
			url += "&cursor=" + cursor
		}
		res, out := dlGet(t, w, token, url)
		if res.StatusCode != 200 {
			t.Fatalf("GET %s: %d %v", url, res.StatusCode, out)
		}
		pages = append(pages, dlIDs(out))
		next, _ := out["next_cursor"].(string)
		if next == "" {
			return pages
		}
		cursor = next
	}
	t.Fatalf("GET %s: next_cursor never ended", path)
	return nil
}

func dlFlatten(pages [][]string) []string {
	var out []string
	for _, p := range pages {
		out = append(out, p...)
	}
	return out
}

// dlExec runs seed SQL on the handler test pool.
func dlExec(t *testing.T, sql string, args ...any) {
	t.Helper()
	if _, err := testPool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("seed: %v\n%s", err, sql)
	}
}

// dlSortedIDs orders ids by (key, id) the way a sorted list does: ids
// byte-wise in the same direction as the key.
func dlSortedIDs(keys map[string]time.Time, desc bool) []string {
	ids := make([]string, 0, len(keys))
	for id := range keys {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool {
		a, b := keys[ids[i]], keys[ids[j]]
		if !a.Equal(b) {
			return a.Before(b) != desc
		}
		return (ids[i] < ids[j]) != desc
	})
	return ids
}

// dlCreatePages creates one workspace-visible page per title and returns the
// ids in creation order.
func dlCreatePages(t *testing.T, w *docsWorld, token string, titles ...string) []string {
	t.Helper()
	ids := make([]string, 0, len(titles))
	for _, title := range titles {
		_, id := docsCreatePageBody(t, w, token, map[string]any{"title": title, "visibility": "workspace"})
		ids = append(ids, id)
	}
	return ids
}

func dlBase(w *docsWorld) string { return "/api/v1/workspaces/" + w.wsID + "/documents" }

// SV-0: the trash and the archive shelf take the S3 keys plus their own
// (deleted = archived_at, shelved = shelved_at), 3 pages with shared keys in
// both directions; a key that does not fit the route is 400.
func TestDoclistTrashAndShelfSortKeys(t *testing.T) {
	w := newDocsWorld(t)
	base := dlBase(w)
	t0 := time.Now().UTC().Add(-72 * time.Hour).Truncate(time.Second)
	ids := dlCreatePages(t, w, w.token, "Zed", "Đào", "alpha", "Beta", "ca", "Eta", "Fox")
	trash, shelf := ids[:4], ids[4:]
	for _, id := range trash {
		if res, out := doJSON(t, w.srv, "POST", "/api/v1/documents/"+id+"/archive", w.token, nil); res.StatusCode != 200 {
			t.Fatalf("archive: %d %v", res.StatusCode, out)
		}
	}
	for _, id := range shelf {
		if res, out := doJSON(t, w.srv, "POST", "/api/v1/documents/"+id+"/shelve", w.token, nil); res.StatusCode != 200 {
			t.Fatalf("shelve: %d %v", res.StatusCode, out)
		}
	}
	// duplicate keys on purpose: two rows share every timestamp.
	archivedAt := map[string]time.Time{trash[0]: t0, trash[1]: t0, trash[2]: t0.Add(time.Hour), trash[3]: t0.Add(time.Hour)}
	shelvedAt := map[string]time.Time{shelf[0]: t0, shelf[1]: t0, shelf[2]: t0.Add(time.Hour)}
	for id, at := range archivedAt {
		dlExec(t, `UPDATE documents SET archived_at = $1 WHERE id = $2`, at, id)
	}
	for id, at := range shelvedAt {
		dlExec(t, `UPDATE documents SET shelved_at = $1 WHERE id = $2`, at, id)
	}

	for _, c := range []struct {
		name, route, key string
		at               map[string]time.Time
	}{
		{"trash", "?archived=1", "deleted", archivedAt},
		{"shelf", "?shelved=1", "shelved", shelvedAt},
	} {
		for _, order := range []string{"asc", "desc", ""} {
			desc := order != "asc"
			q := c.route + "&sort=" + c.key
			if order != "" {
				q += "&order=" + order
			}
			want := dlSortedIDs(c.at, desc)
			got := dlFlatten(dlWalk(t, w, w.token, base+q, 2))
			if !reflect.DeepEqual(got, want) {
				t.Errorf("%s %s: order = %v, want %v", c.name, q, got, want)
			}
		}
		// the S3 keys are accepted too: name runs A to Z under the Vietnamese collation.
		res, out := dlGet(t, w, w.token, base+c.route+"&sort=name")
		if res.StatusCode != 200 {
			t.Errorf("%s sort=name: %d %v", c.name, res.StatusCode, out)
		}
		// no sort: the old order (key desc, id desc) and the old cursor.
		wantOld := dlSortedIDs(c.at, true)
		if got := dlFlatten(dlWalk(t, w, w.token, base+c.route, 2)); !reflect.DeepEqual(got, wantOld) {
			t.Errorf("%s without sort: order = %v, want %v", c.name, got, wantOld)
		}
	}

	// sort=name on the trash is the vi order of the titles.
	res, out := dlGet(t, w, w.token, base+"?archived=1&sort=name")
	if got, want := docTitles(t, out), []string{"alpha", "Beta", "Đào", "Zed"}; res.StatusCode != 200 || !reflect.DeepEqual(got, want) {
		t.Errorf("trash sort=name = %v (%d), want %v", got, res.StatusCode, want)
	}

	// a key that does not fit its route is 400 invalid_request.
	for _, q := range []string{
		"?archived=1&sort=shelved", "?shelved=1&sort=deleted", "?sort=deleted", "?sort=shelved",
		"?archived=1&sort=nope", "?archived=1&order=asc", "?shelved=1&order=desc",
	} {
		res, out := dlGet(t, w, w.token, base+q)
		wantErr(t, res, out, 400, "invalid_request", "")
	}
	// a cursor belongs to its sort: the trash cursor of deleted/asc under another sort or none.
	res, out = dlGet(t, w, w.token, base+"?archived=1&sort=deleted&order=asc&limit=1")
	cursor, _ := out["next_cursor"].(string)
	if res.StatusCode != 200 || cursor == "" {
		t.Fatalf("first trash page: %d %v", res.StatusCode, out)
	}
	for _, q := range []string{"&sort=deleted&order=desc", "&sort=name", ""} {
		res, out := dlGet(t, w, w.token, base+"?archived=1&cursor="+cursor+q)
		wantErr(t, res, out, 400, "invalid_request", "")
	}
}

// The web's trash screen always asks for sort=deleted&order=asc: oldest first,
// three pages, nothing repeated.
func TestDoclistTrashOldestFirstThreePages(t *testing.T) {
	w := newDocsWorld(t)
	base := dlBase(w)
	t0 := time.Now().UTC().Add(-96 * time.Hour).Truncate(time.Second)
	ids := dlCreatePages(t, w, w.token, "a1", "a2", "a3", "a4", "a5", "a6", "a7")
	at := map[string]time.Time{}
	for i, id := range ids {
		if res, out := doJSON(t, w.srv, "POST", "/api/v1/documents/"+id+"/archive", w.token, nil); res.StatusCode != 200 {
			t.Fatalf("archive: %d %v", res.StatusCode, out)
		}
		at[id] = t0.Add(time.Duration(i/3) * time.Hour) // 3 + 3 + 1 share keys
		dlExec(t, `UPDATE documents SET archived_at = $1 WHERE id = $2`, at[id], id)
	}
	pages := dlWalk(t, w, w.token, base+"?archived=1&sort=deleted&order=asc", 3)
	if len(pages) != 3 {
		t.Fatalf("pages = %d (%v), want 3", len(pages), pages)
	}
	if got, want := dlFlatten(pages), dlSortedIDs(at, false); !reflect.DeepEqual(got, want) {
		t.Errorf("trash oldest first = %v, want %v", got, want)
	}
}

// dlLog seeds one access-log row of a human at a time.
func dlLog(t *testing.T, w *docsWorld, docID, actorID, action string, at time.Time) {
	t.Helper()
	dlExec(t, `INSERT INTO document_access_logs (id, organization_id, workspace_id, document_id, action, actor_kind, actor_id, via, correlation_id, occurred_at)
		VALUES ($1, $2, $3, $4, $5, 'human', $6, 'member', 'dl-test', $7)`, newTestID(), w.orgID, w.wsID, docID, action, actorID, at)
}

// dlComment seeds one document comment of a person at a time.
func dlComment(t *testing.T, w *docsWorld, docID, authorID string, at time.Time) {
	t.Helper()
	dlExec(t, `INSERT INTO document_comments (id, organization_id, workspace_id, document_id, author_id, author_kind, body, comment_type, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, 'human', 'x', 'discussion', $6, $6)`, newTestID(), w.orgID, w.wsID, docID, authorID, at)
}

func newTestID() string { return util.NewID() }

// dlActivity pulls last_activity{kind, at} of each listed document by id.
func dlActivity(out map[string]any) map[string][2]string {
	res := map[string][2]string{}
	raw, _ := out["documents"].([]any)
	for _, item := range raw {
		m := item.(map[string]any)
		la, _ := m["last_activity"].(map[string]any)
		if la == nil {
			res[m["id"].(string)] = [2]string{}
			continue
		}
		res[m["id"].(string)] = [2]string{la["kind"].(string), la["at"].(string)}
	}
	return res
}

// SV-1: /documents/recent says what the caller did last on each row (the
// latest of an access-log row, an edit and a comment of their own), comments
// make a document recent, sort=activity orders by it, activity= filters.
func TestDoclistRecentLastActivity(t *testing.T) {
	w := newDocsWorld(t)
	memberTok, memberID := docsJoinWorkspace(t, w, "dl-recent-member@example.com")
	base := dlBase(w) + "/recent"
	now := time.Now().UTC().Truncate(time.Second)
	at := func(h int) time.Time { return now.Add(time.Duration(-h) * time.Hour) }
	ids := dlCreatePages(t, w, w.token, "opened", "edited", "commented", "opened-then-commented", "edited-then-opened", "untouched")
	opened, edited, commented, openedCommented, editedOpened, untouched := ids[0], ids[1], ids[2], ids[3], ids[4], ids[5]
	dlLog(t, w, opened, memberID, "view", at(5))
	dlExec(t, `UPDATE documents SET updated_by = $1, updated_by_kind = 'human', updated_at = $2 WHERE id = $3`, memberID, at(4), edited)
	dlComment(t, w, commented, memberID, at(3))
	dlLog(t, w, openedCommented, memberID, "view", at(8))
	dlComment(t, w, openedCommented, memberID, at(2))
	dlExec(t, `UPDATE documents SET updated_by = $1, updated_by_kind = 'human', updated_at = $2 WHERE id = $3`, memberID, at(9), editedOpened)
	dlLog(t, w, editedOpened, memberID, "view", at(1))
	// somebody else's activity on a row never counts for the caller.
	dlLog(t, w, untouched, w.userID, "view", at(1))
	dlComment(t, w, untouched, w.userID, at(1))

	res, out := dlGet(t, w, memberTok, base+"?sort=activity")
	if res.StatusCode != 200 {
		t.Fatalf("recent sort=activity: %d %v", res.StatusCode, out)
	}
	got := dlActivity(out)
	want := map[string][2]string{
		opened:          {"opened", at(5).Format(time.RFC3339)},
		edited:          {"edited", at(4).Format(time.RFC3339)},
		commented:       {"commented", at(3).Format(time.RFC3339)},
		openedCommented: {"commented", at(2).Format(time.RFC3339)},
		editedOpened:    {"opened", at(1).Format(time.RFC3339)},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("last_activity = %v, want %v", got, want)
	}
	// newest activity first: editedOpened(1h) openedCommented(2h) commented(3h) edited(4h) opened(5h)
	if gotIDs, wantIDs := dlIDs(out), []string{editedOpened, openedCommented, commented, edited, opened}; !reflect.DeepEqual(gotIDs, wantIDs) {
		t.Errorf("sort=activity order = %v, want %v", gotIDs, wantIDs)
	}
	res, out = dlGet(t, w, memberTok, base+"?sort=activity&order=asc")
	if gotIDs, wantIDs := dlIDs(out), []string{opened, edited, commented, openedCommented, editedOpened}; res.StatusCode != 200 || !reflect.DeepEqual(gotIDs, wantIDs) {
		t.Errorf("sort=activity&order=asc = %v (%d), want %v", gotIDs, res.StatusCode, wantIDs)
	}

	// activity=opened: a row with an access-log row of the caller; edited: rows the caller edited.
	res, out = dlGet(t, w, memberTok, base+"?sort=activity&activity=opened")
	if gotIDs, wantIDs := dlIDs(out), []string{editedOpened, openedCommented, opened}; res.StatusCode != 200 || !reflect.DeepEqual(gotIDs, wantIDs) {
		t.Errorf("activity=opened = %v (%d), want %v", gotIDs, res.StatusCode, wantIDs)
	}
	res, out = dlGet(t, w, memberTok, base+"?sort=activity&activity=edited")
	if gotIDs, wantIDs := dlIDs(out), []string{editedOpened, edited}; res.StatusCode != 200 || !reflect.DeepEqual(gotIDs, wantIDs) {
		t.Errorf("activity=edited = %v (%d), want %v", gotIDs, res.StatusCode, wantIDs)
	}
	for _, q := range []string{"?activity=commented", "?activity=all", "?activity=", "?activity=OPENED"} {
		res, out := dlGet(t, w, memberTok, base+q)
		if q == "?activity=" { // empty = absent
			if res.StatusCode != 200 {
				t.Errorf("GET recent%s = %d %v, want 200", q, res.StatusCode, out)
			}
			continue
		}
		wantErr(t, res, out, 400, "invalid_filter", "")
	}
	// a screen key of another route, and a column key, on recent.
	for _, q := range []string{"?sort=starred", "?sort=shared", "?sort=deleted"} {
		res, out := dlGet(t, w, memberTok, base+q)
		wantErr(t, res, out, 400, "invalid_request", "")
	}
	if res, out := dlGet(t, w, memberTok, base+"?sort=name"); res.StatusCode != 200 {
		t.Errorf("recent sort=name: %d %v", res.StatusCode, out)
	}
	// the cursor is bound to the sort.
	res, out = dlGet(t, w, memberTok, base+"?sort=activity&limit=1")
	cursor, _ := out["next_cursor"].(string)
	if res.StatusCode != 200 || cursor == "" {
		t.Fatalf("first activity page: %d %v", res.StatusCode, out)
	}
	for _, q := range []string{"&sort=updated", ""} {
		res, out := dlGet(t, w, memberTok, base+"?cursor="+cursor+q)
		wantErr(t, res, out, 400, "invalid_request", "")
	}
}

// Three pages with shared activity times, both directions: the order is
// (activity, id) in one direction and each row comes once.
func TestDoclistRecentActivityPagesWithSharedKeys(t *testing.T) {
	w := newDocsWorld(t)
	memberTok, memberID := docsJoinWorkspace(t, w, "dl-recent-pages@example.com")
	base := dlBase(w) + "/recent"
	t0 := time.Now().UTC().Add(-30 * time.Hour).Truncate(time.Second)
	ids := dlCreatePages(t, w, w.token, "p1", "p2", "p3", "p4", "p5", "p6", "p7")
	key := map[string]time.Time{}
	for i, id := range ids {
		key[id] = t0.Add(time.Duration(i/3) * time.Hour) // 3 + 3 + 1 rows share a time
		switch i % 3 {
		case 0:
			dlLog(t, w, id, memberID, "view", key[id])
		case 1:
			dlComment(t, w, id, memberID, key[id])
		default:
			dlExec(t, `UPDATE documents SET updated_by = $1, updated_by_kind = 'human', updated_at = $2 WHERE id = $3`, memberID, key[id], id)
		}
	}
	for _, order := range []string{"asc", "desc", ""} {
		q := "?sort=activity"
		if order != "" {
			q += "&order=" + order
		}
		pages := dlWalk(t, w, memberTok, base+q, 3)
		if len(pages) != 3 {
			t.Errorf("%s: pages = %d, want 3", q, len(pages))
		}
		if got, want := dlFlatten(pages), dlSortedIDs(key, order != "asc"); !reflect.DeepEqual(got, want) {
			t.Errorf("%s: order = %v, want %v", q, got, want)
		}
	}
}
