package handler

// UNI-2056 slice B: the read side of document_changed notifications. The
// consumer writes the rows (slice A); these tests seed them the way it does
// and hold what the reader sees through HTTP: only the documents readable
// now, a purged document as deleted (named only by the snapshot a deleted
// verb stored), a sealed cursor, and a foreign notification as 404.

import (
	"context"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// notifyDocsFixture is one world with the documents every case reads:
// readable (workspace-visible), secret (restricted, member has no share),
// trashed (the member owns it and it sits in the trash) and two purged ids.
type notifyDocsFixture struct {
	*documentCollabWorld
	readable, secret, trashed string
	purgedBare, purgedNamed   string
}

func newNotifyDocsFixture(t *testing.T) *notifyDocsFixture {
	t.Helper()
	w := newDocumentCollabWorld(t)
	f := &notifyDocsFixture{documentCollabWorld: w}
	f.readable = w.createDoc(t, w.token, "Kế hoạch Q4", "workspace")
	f.secret = w.createDoc(t, w.token, "Bí mật lương", "restricted")
	f.trashed = w.createDoc(t, w.member, "Bản nháp của member", "workspace")
	if _, err := w.pool.Exec(context.Background(),
		`UPDATE documents SET archived_at = now(), archived_by = $2 WHERE id = $1`, f.trashed, w.memberID); err != nil {
		t.Fatalf("trash document: %v", err)
	}
	f.purgedBare, f.purgedNamed = util.NewID(), util.NewID()
	return f
}

// notify seeds one document_changed row for the member with its document
// rows. A title in docs is stored as that document's snapshot.
func (f *notifyDocsFixture) notify(t *testing.T, verb string, sample []string, docs ...[2]string) string {
	t.Helper()
	ctx := context.Background()
	quoted := make([]string, 0, len(sample))
	for _, id := range sample {
		quoted = append(quoted, `"`+id+`"`)
	}
	n, err := f.q.UpsertNotification(ctx, db.UpsertNotificationParams{
		ID: util.NewID(), UserID: f.memberID, OrganizationID: f.orgID, WorkspaceID: pgtype.Text{String: f.wsID, Valid: true},
		Kind: "document_changed", GroupKey: "doc_change:" + f.userID + ":" + verb + ":" + util.NewID(),
		ResourceType: "workspace", ResourceID: f.wsID, ActorKind: "human", ActorID: f.userID,
		TitleKey: "notifications.kind.document_changed",
		Params:   fmt.Sprintf(`{"verb":%q,"document_count":%d,"sample_document_ids":[%s]}`, verb, len(docs), strings.Join(quoted, ",")),
	})
	if err != nil {
		t.Fatalf("notification: %v", err)
	}
	for _, d := range docs {
		in := db.InsertNotificationDocumentParams{OrganizationID: f.orgID, NotificationID: n.ID, DocumentID: d[0]}
		if d[1] != "" {
			in.TitleSnapshot = pgtype.Text{String: d[1], Valid: true}
		}
		if _, err := f.q.InsertNotificationDocument(ctx, in); err != nil {
			t.Fatalf("notification document: %v", err)
		}
	}
	return n.ID
}

func notifyDocsPath(notificationID string, query string) string {
	p := "/api/v1/me/notifications/" + notificationID + "/documents"
	if query != "" {
		p += "?" + query
	}
	return p
}

// docsByID indexes the documents array of an answer by id.
func docsByID(t *testing.T, out map[string]any) map[string]map[string]any {
	t.Helper()
	list, ok := out["documents"].([]any)
	if !ok {
		t.Fatalf("documents missing: %v", out)
	}
	byID := make(map[string]map[string]any, len(list))
	for _, raw := range list {
		d := raw.(map[string]any)
		byID[d["id"].(string)] = d
	}
	return byID
}

func TestNotificationDocumentsListsWhatTheReaderCanReadNow(t *testing.T) {
	f := newNotifyDocsFixture(t)
	nid := f.notify(t, "trashed", nil,
		[2]string{f.readable}, [2]string{f.secret}, [2]string{f.trashed}, [2]string{f.purgedBare},
		// A snapshot on a verb other than deleted is never shown.
		[2]string{f.purgedNamed, "Tiêu đề không được lộ"})

	res, out := doJSON(t, f.srv, "GET", notifyDocsPath(nid, ""), f.member, nil)
	if res.StatusCode != 200 {
		t.Fatalf("list: %d %v", res.StatusCode, out)
	}
	byID := docsByID(t, out)
	if len(byID) != 4 {
		t.Fatalf("want readable, trashed and two purged (secret dropped), got %v", out)
	}
	if d := byID[f.readable]; d["title"] != "Kế hoạch Q4" || d["kind"] != "page" || d["trashed"] != false || d["deleted"] != false {
		t.Fatalf("readable row = %v", d)
	}
	if d := byID[f.trashed]; d["title"] != "Bản nháp của member" || d["trashed"] != true || d["deleted"] != false {
		t.Fatalf("trashed row (member administers it) = %v", d)
	}
	for _, id := range []string{f.purgedBare, f.purgedNamed} {
		d := byID[id]
		if d["deleted"] != true {
			t.Fatalf("purged row %s = %v", id, d)
		}
		if _, has := d["title"]; has {
			t.Fatalf("purged row of a verb other than deleted names a title: %v", d)
		}
	}
	if raw := fmt.Sprint(out); strings.Contains(raw, f.secret) || strings.Contains(raw, "Bí mật lương") || strings.Contains(raw, "Tiêu đề không được lộ") {
		t.Fatalf("answer leaks a document the reader cannot read: %s", raw)
	}
	if out["next_cursor"] != nil {
		t.Fatalf("one short page has no next cursor: %v", out["next_cursor"])
	}

	// verb deleted: the snapshot taken at the purge is the only name left.
	del := f.notify(t, "deleted", nil, [2]string{f.purgedNamed, "Báo cáo đã xoá"}, [2]string{f.purgedBare})
	res, out = doJSON(t, f.srv, "GET", notifyDocsPath(del, ""), f.member, nil)
	if res.StatusCode != 200 {
		t.Fatalf("list deleted: %d %v", res.StatusCode, out)
	}
	byID = docsByID(t, out)
	if d := byID[f.purgedNamed]; d["deleted"] != true || d["title"] != "Báo cáo đã xoá" {
		t.Fatalf("snapshot row = %v", d)
	}
	if d := byID[f.purgedBare]; d["deleted"] != true || d["title"] != nil {
		t.Fatalf("bare purged row = %v", d)
	}

	// Another person's notification, a stranger's and an unknown id are all
	// the same 404: nothing says the row exists.
	for name, token := range map[string]string{"owner": f.token, "outsider": f.outsider} {
		res, out = doJSON(t, f.srv, "GET", notifyDocsPath(nid, ""), token, nil)
		if res.StatusCode != 404 {
			t.Fatalf("%s reading the member's notification: %d %v", name, res.StatusCode, out)
		}
	}
	if res, out = doJSON(t, f.srv, "GET", notifyDocsPath(util.NewID(), ""), f.member, nil); res.StatusCode != 404 {
		t.Fatalf("unknown notification: %d %v", res.StatusCode, out)
	}
	if res, _ = doJSON(t, f.srv, "GET", notifyDocsPath(nid, ""), "", nil); res.StatusCode != 401 {
		t.Fatalf("no session: %d", res.StatusCode)
	}
}

func TestNotificationDocumentsSealedCursorPages(t *testing.T) {
	f := newNotifyDocsFixture(t)
	var rows [][2]string
	var want []string
	for i := 0; i < 5; i++ {
		id := f.createDoc(t, f.token, fmt.Sprintf("Tài liệu %d", i), "workspace")
		rows = append(rows, [2]string{id})
		want = append(want, id)
		if i == 1 {
			// A document the reader cannot read sits inside the walk.
			rows = append(rows, [2]string{f.secret})
		}
	}
	sort.Strings(want) // the keyset walks document ids in order
	nid := f.notify(t, "renamed", nil, rows...)

	var got []string
	cursor := ""
	for page := 0; page < 10; page++ {
		q := "limit=2"
		if cursor != "" {
			q += "&cursor=" + url.QueryEscape(cursor)
		}
		res, out := doJSON(t, f.srv, "GET", notifyDocsPath(nid, q), f.member, nil)
		if res.StatusCode != 200 {
			t.Fatalf("page %d: %d %v", page, res.StatusCode, out)
		}
		list := out["documents"].([]any)
		if len(list) > 2 {
			t.Fatalf("page %d holds %d documents past limit=2", page, len(list))
		}
		for _, raw := range list {
			got = append(got, raw.(map[string]any)["id"].(string))
		}
		next, _ := out["next_cursor"].(string)
		if next == "" {
			cursor = ""
			break
		}
		cursor = next
	}
	if cursor != "" {
		t.Fatal("the walk never ended")
	}
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Fatalf("walk = %v, want %v (no repeat, no skip, secret dropped)", got, want)
	}

	// The cursor is sealed: forged, truncated, or replayed on another
	// notification it is a 400, never a position.
	res, out := doJSON(t, f.srv, "GET", notifyDocsPath(nid, "limit=2"), f.member, nil)
	if res.StatusCode != 200 || out["next_cursor"] == nil {
		t.Fatalf("first page: %d %v", res.StatusCode, out)
	}
	sealed := out["next_cursor"].(string)
	other := f.notify(t, "renamed", nil, [2]string{want[0]})
	for name, c := range map[string]struct{ nid, cursor string }{
		"forged":    {nid, "ndc1." + sealed},
		"truncated": {nid, sealed[:len(sealed)-3]},
		"replayed":  {other, sealed},
		"raw id":    {nid, want[1]},
	} {
		res, out := doJSON(t, f.srv, "GET", notifyDocsPath(c.nid, "limit=2&cursor="+url.QueryEscape(c.cursor)), f.member, nil)
		if res.StatusCode != 400 {
			t.Fatalf("%s cursor: %d %v", name, res.StatusCode, out)
		}
	}
}

func TestNotificationListResolvesSampleDocumentsAtReadTime(t *testing.T) {
	f := newNotifyDocsFixture(t)
	trashedN := f.notify(t, "trashed", []string{f.readable, f.secret, f.trashed},
		[2]string{f.readable}, [2]string{f.secret}, [2]string{f.trashed})
	deletedN := f.notify(t, "deleted", []string{f.purgedNamed, f.purgedBare},
		[2]string{f.purgedNamed, "Báo cáo đã xoá"}, [2]string{f.purgedBare})

	res, out := doJSON(t, f.srv, "GET", "/api/v1/me/notifications", f.member, nil)
	if res.StatusCode != 200 {
		t.Fatalf("list: %d %v", res.StatusCode, out)
	}
	byNotification := map[string]map[string]any{}
	for _, raw := range out["notifications"].([]any) {
		n := raw.(map[string]any)
		byNotification[n["id"].(string)] = n
	}
	titles := func(n map[string]any) map[string]string {
		got := map[string]string{}
		list, _ := n["sample_documents"].([]any)
		for _, raw := range list {
			d := raw.(map[string]any)
			got[d["id"].(string)], _ = d["title"].(string)
		}
		return got
	}
	got := titles(byNotification[trashedN])
	if len(got) != 2 || got[f.readable] != "Kế hoạch Q4" || got[f.trashed] != "Bản nháp của member" {
		t.Fatalf("trashed samples = %v (secret must be dropped)", got)
	}
	got = titles(byNotification[deletedN])
	if len(got) != 1 || got[f.purgedNamed] != "Báo cáo đã xoá" {
		t.Fatalf("deleted samples = %v (snapshot kept, missing dropped)", got)
	}
	if raw := fmt.Sprint(out); strings.Contains(raw, "Bí mật lương") || strings.Contains(raw, f.secret) {
		t.Fatalf("list leaks a document the reader cannot read: %s", raw)
	}

	// A row of another kind carries no sample_documents at all.
	if _, err := f.q.UpsertNotification(context.Background(), db.UpsertNotificationParams{
		ID: util.NewID(), UserID: f.memberID, OrganizationID: f.orgID, WorkspaceID: pgtype.Text{String: f.wsID, Valid: true},
		Kind: "member_added", GroupKey: "member_added:" + util.NewID(), ResourceType: "workspace", ResourceID: f.wsID,
		ActorKind: "human", ActorID: f.userID, TitleKey: "notifications.kind.member_added", Params: `{}`,
	}); err != nil {
		t.Fatal(err)
	}
	_, out = doJSON(t, f.srv, "GET", "/api/v1/me/notifications", f.member, nil)
	for _, raw := range out["notifications"].([]any) {
		n := raw.(map[string]any)
		if n["kind"] == "member_added" {
			if _, has := n["sample_documents"]; has {
				t.Fatalf("a row of another kind names sample documents: %v", n)
			}
		}
	}
}
