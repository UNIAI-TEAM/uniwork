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

// dlFavorite stars a document as one person.
func dlFavorite(t *testing.T, w *docsWorld, token, docID string) {
	t.Helper()
	if res, out := doJSON(t, w.srv, "POST", "/api/v1/documents/"+docID+"/favorite", token, nil); res.StatusCode != 200 {
		t.Fatalf("favorite %s: %d %v", docID, res.StatusCode, out)
	}
}

// SV-2: GET /workspaces/{ws}/documents/favorites lists the caller's own stars
// in that workspace with favorited_at, newest star first, same cursor paging
// and S3 sort keys, and only rows the caller can still read.
func TestDoclistFavorites(t *testing.T) {
	w := newDocsWorld(t)
	memberTok, memberID := docsJoinWorkspace(t, w, "dl-fav-member@example.com")
	base := dlBase(w) + "/favorites"
	t0 := time.Now().UTC().Add(-40 * time.Hour).Truncate(time.Second)
	ids := dlCreatePages(t, w, w.token, "Zed", "Đào", "alpha", "Beta", "ca", "Eta", "Fox")
	for _, id := range ids {
		dlFavorite(t, w, memberTok, id)
	}
	// somebody else's star never shows up for the caller.
	other := dlCreatePages(t, w, w.token, "only-the-owner-starred")
	dlFavorite(t, w, w.token, other[0])
	// 3 + 3 + 1 stars share a time.
	key := map[string]time.Time{}
	for i, id := range ids {
		key[id] = t0.Add(time.Duration(i/3) * time.Hour)
		dlExec(t, `UPDATE document_favorites SET created_at = $1 WHERE document_id = $2 AND user_id = $3`, key[id], id, memberID)
	}
	for _, order := range []string{"asc", "desc", ""} {
		q := "?sort=starred"
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
	// no sort at all = starred, newest star first, and its cursor pages on.
	if got, want := dlFlatten(dlWalk(t, w, memberTok, base, 3)), dlSortedIDs(key, true); !reflect.DeepEqual(got, want) {
		t.Errorf("default order = %v, want %v", got, want)
	}

	// the row is a DocumentSummaryDTO plus favorited_at.
	res, out := dlGet(t, w, memberTok, base+"?sort=starred&limit=1")
	if res.StatusCode != 200 {
		t.Fatalf("favorites: %d %v", res.StatusCode, out)
	}
	row := out["documents"].([]any)[0].(map[string]any)
	for _, f := range []string{"id", "title", "kind", "updated_at", "my_level", "size_bytes"} {
		if _, ok := row[f]; !ok {
			t.Errorf("favorites row lacks %s: %v", f, row)
		}
	}
	if got, want := row["favorited_at"], key[dlSortedIDs(key, true)[0]].Format(time.RFC3339); got != want {
		t.Errorf("favorited_at = %v, want %v", got, want)
	}

	// the S3 keys sort the starred rows too: name is the Vietnamese order.
	res, out = dlGet(t, w, memberTok, base+"?sort=name")
	want := []string{"alpha", "Beta", "ca", "Đào", "Eta", "Fox", "Zed"}
	if got := docTitles(t, out); res.StatusCode != 200 || !reflect.DeepEqual(got, want) {
		t.Errorf("favorites sort=name = %v (%d), want %v", got, res.StatusCode, want)
	}
	// the same filters as the flat list where cheap.
	res, out = dlGet(t, w, memberTok, base+"?kind=folder")
	if got := dlIDs(out); res.StatusCode != 200 || len(got) != 0 {
		t.Errorf("favorites kind=folder = %v (%d), want none", got, res.StatusCode)
	}
	res, out = dlGet(t, w, memberTok, base+"?kind=page")
	if res.StatusCode != 200 || len(dlIDs(out)) != len(ids) {
		t.Errorf("favorites kind=page = %v (%d), want %d rows", dlIDs(out), res.StatusCode, len(ids))
	}
	for _, q := range []string{"?kind=bogus", "?format=bogus", "?kind=page&format=pdf", "?sort=nope", "?order=asc", "?sort=shared", "?sort=activity", "?sort=deleted"} {
		res, out := dlGet(t, w, memberTok, base+q)
		if res.StatusCode != 400 {
			t.Errorf("GET favorites%s = %d %v, want 400", q, res.StatusCode, out)
		}
	}
	// the cursor of a favorites page is bound to its sort and direction.
	res, out = dlGet(t, w, memberTok, base+"?sort=starred&order=asc&limit=1")
	cursor, _ := out["next_cursor"].(string)
	if res.StatusCode != 200 || cursor == "" {
		t.Fatalf("first page: %d %v", res.StatusCode, out)
	}
	for _, q := range []string{"", "&sort=starred", "&sort=name&order=asc"} {
		res, out := dlGet(t, w, memberTok, base+"?cursor="+cursor+q)
		wantErr(t, res, out, 400, "invalid_request", "")
	}
	// the star key is for this route only.
	res, out = dlGet(t, w, memberTok, dlBase(w)+"?sort=starred")
	wantErr(t, res, out, 400, "invalid_request", "")

	// a trashed star and a revoked share drop out; the star row stays.
	trashed := ids[0]
	if res, out := doJSON(t, w.srv, "POST", "/api/v1/documents/"+trashed+"/archive", w.token, nil); res.StatusCode != 200 {
		t.Fatalf("archive: %d %v", res.StatusCode, out)
	}
	_, secret := docsCreatePageBody(t, w, w.token, map[string]any{"title": "secret", "visibility": "restricted"})
	res, out = doJSON(t, w.srv, "POST", "/api/v1/documents/"+secret+"/shares", w.token, map[string]any{
		"principal_type": "user", "principal_id": memberID, "level": "view",
	})
	if res.StatusCode != 201 && res.StatusCode != 200 {
		t.Fatalf("share: %d %v", res.StatusCode, out)
	}
	dlFavorite(t, w, memberTok, secret)
	if _, out := dlGet(t, w, memberTok, base+"?sort=name"); !contains(docTitles(t, out), "secret") {
		t.Errorf("a starred document the caller can read is missing: %v", docTitles(t, out))
	}
	shareID := dlOneShareID(t, w, secret, memberID)
	if res, out := doJSON(t, w.srv, "DELETE", "/api/v1/documents/"+secret+"/shares/"+shareID, w.token, nil); res.StatusCode != 204 && res.StatusCode != 200 {
		t.Fatalf("revoke: %d %v", res.StatusCode, out)
	}
	res, out = dlGet(t, w, memberTok, base+"?sort=name")
	titles := docTitles(t, out)
	if res.StatusCode != 200 || contains(titles, "secret") || contains(titles, "Zed") {
		t.Errorf("revoked/trashed stars still listed: %v (%d)", titles, res.StatusCode)
	}
	// an outsider who is not in the workspace cannot read the route.
	res, out = dlGet(t, w, w.outsider, base)
	if res.StatusCode != 403 && res.StatusCode != 404 {
		t.Errorf("outsider favorites = %d %v, want 403/404", res.StatusCode, out)
	}
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}
	return false
}

// dlOneShareID finds the live share of a document for one user.
func dlOneShareID(t *testing.T, w *docsWorld, docID, userID string) string {
	t.Helper()
	var id string
	if err := testPool.QueryRow(context.Background(), `SELECT id FROM document_shares WHERE document_id = $1 AND principal_id = $2 AND revoked_at IS NULL`, docID, userID).Scan(&id); err != nil {
		t.Fatalf("share lookup: %v", err)
	}
	return id
}

// dlShare inserts one live share row with a chosen granter and time.
func dlShare(t *testing.T, w *docsWorld, docID, principalType, principalID, grantedBy, grantedKind string, at time.Time) string {
	t.Helper()
	id := newTestID()
	dlExec(t, `INSERT INTO document_shares (id, organization_id, workspace_id, document_id, principal_type, principal_id, level, granted_by, granted_by_kind, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, 'view', $7, $8, $9)`, id, w.orgID, w.wsID, docID, principalType, principalID, grantedBy, grantedKind, at)
	return id
}

func dlName(t *testing.T, userID, name string) {
	t.Helper()
	dlExec(t, `UPDATE users SET display_name = $1 WHERE id = $2`, name, userID)
}

// SV-3: every shared-with-me row says who shared it and when, from the share
// that grants the caller; the name is shown only for a person of the caller's
// organization; sort=shared orders by the share time.
func TestDoclistSharedWithMeSharedBy(t *testing.T) {
	w := newDocsWorld(t)
	memberTok, memberID := docsJoinWorkspace(t, w, "dl-shared-member@example.com")
	_, peerID := docsJoinWorkspace(t, w, "dl-shared-peer@example.com")
	_, strangerID := filesRegister(t, w.srv, "dl-shared-stranger@example.com")
	dlName(t, w.userID, "Chủ Sở Hữu")
	dlName(t, peerID, "Bạn Đồng Nghiệp")
	dlName(t, strangerID, "Người Lạ")
	base := dlBase(w) + "/shared-with-me"
	t0 := time.Now().UTC().Add(-20 * time.Hour).Truncate(time.Second)
	mk := func(title string) string {
		_, id := docsCreatePageBody(t, w, w.token, map[string]any{"title": title, "visibility": "restricted"})
		return id
	}
	byOwner, byStranger, byAgent, newest := mk("by-owner"), mk("by-stranger"), mk("by-agent"), mk("two-shares")
	dlShare(t, w, byOwner, "user", memberID, w.userID, "human", t0)
	dlShare(t, w, byStranger, "user", memberID, strangerID, "human", t0.Add(time.Hour))
	dlShare(t, w, byAgent, "user", memberID, "agent-"+w.orgID, "agent", t0.Add(2*time.Hour))
	// two live shares reach the caller: the list uses the newest, and so does shared{}.
	dlShare(t, w, newest, "user", memberID, w.userID, "human", t0.Add(3*time.Hour))
	dlShare(t, w, newest, "organization", w.orgID, peerID, "human", t0.Add(4*time.Hour))

	res, out := dlGet(t, w, memberTok, base)
	if res.StatusCode != 200 {
		t.Fatalf("shared-with-me: %d %v", res.StatusCode, out)
	}
	type shared struct {
		by, kind, name, at string
		nameNull           bool
	}
	got := map[string]shared{}
	for _, item := range out["documents"].([]any) {
		m := item.(map[string]any)
		sh, ok := m["shared"].(map[string]any)
		if !ok {
			t.Fatalf("row %v has no shared{}", m["title"])
		}
		entry := shared{by: sh["by"].(string), kind: sh["by_kind"].(string), at: sh["at"].(string)}
		if n, ok := sh["by_name"].(string); ok {
			entry.name = n
		} else if v, present := sh["by_name"]; present && v == nil {
			entry.nameNull = true
		} else {
			t.Errorf("row %v: by_name missing (want a name or an explicit null): %v", m["title"], sh)
		}
		got[m["title"].(string)] = entry
	}
	want := map[string]shared{
		"by-owner":    {by: w.userID, kind: "human", name: "Chủ Sở Hữu", at: t0.Format(time.RFC3339)},
		"by-stranger": {by: strangerID, kind: "human", nameNull: true, at: t0.Add(time.Hour).Format(time.RFC3339)},
		"by-agent":    {by: "agent-" + w.orgID, kind: "agent", nameNull: true, at: t0.Add(2 * time.Hour).Format(time.RFC3339)},
		"two-shares":  {by: peerID, kind: "human", name: "Bạn Đồng Nghiệp", at: t0.Add(4 * time.Hour).Format(time.RFC3339)},
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("shared{} = %+v\nwant     %+v", got, want)
	}
}

// Three pages with shared share times, both directions; the key is the share
// time and ids break ties in the same direction.
func TestDoclistSharedWithMeSortByShareTime(t *testing.T) {
	w := newDocsWorld(t)
	memberTok, memberID := docsJoinWorkspace(t, w, "dl-shared-pages@example.com")
	base := dlBase(w) + "/shared-with-me"
	t0 := time.Now().UTC().Add(-30 * time.Hour).Truncate(time.Second)
	key := map[string]time.Time{}
	for i := 0; i < 7; i++ {
		_, id := docsCreatePageBody(t, w, w.token, map[string]any{"title": fmt.Sprintf("s%d", i), "visibility": "restricted"})
		key[id] = t0.Add(time.Duration(i/3) * time.Hour) // 3 + 3 + 1 share a time
		dlShare(t, w, id, "user", memberID, w.userID, "human", key[id])
	}
	for _, order := range []string{"asc", "desc", ""} {
		q := "?sort=shared"
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
	for _, q := range []string{"?sort=starred", "?sort=activity", "?sort=deleted", "?sort=shelved"} {
		res, out := dlGet(t, w, memberTok, base+q)
		wantErr(t, res, out, 400, "invalid_request", "")
	}
	res, out := dlGet(t, w, memberTok, base+"?sort=shared&limit=1")
	cursor, _ := out["next_cursor"].(string)
	if res.StatusCode != 200 || cursor == "" {
		t.Fatalf("first page: %d %v", res.StatusCode, out)
	}
	for _, q := range []string{"", "&sort=updated", "&sort=shared&order=asc"} {
		res, out := dlGet(t, w, memberTok, base+"?cursor="+cursor+q)
		wantErr(t, res, out, 400, "invalid_request", "")
	}
	// an unsorted list is still the share-time order of today.
	if got := dlFlatten(dlWalk(t, w, memberTok, base, 3)); len(got) != 7 {
		t.Errorf("unsorted shared-with-me = %v, want 7 rows", got)
	}
}
