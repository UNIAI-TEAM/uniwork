package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"os"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// UNI-2038 S3: column sort of the documents library lists. Every list takes
// the same sort/order pair and must answer a total order (key, then id in the
// same direction) that pages without gaps or repeats when keys are shared.

func TestParseDocumentSort(t *testing.T) {
	cases := []struct {
		key, order string
		want       DocumentSort
		bad        bool
	}{
		{"", "", DocumentSort{}, false},
		{"updated", "", DocumentSort{Key: "updated", Desc: true}, false},
		{"size", "", DocumentSort{Key: "size", Desc: true}, false},
		{"name", "", DocumentSort{Key: "name"}, false},
		{"editor", "", DocumentSort{Key: "editor"}, false},
		{"name", "desc", DocumentSort{Key: "name", Desc: true}, false},
		{"updated", "asc", DocumentSort{Key: "updated"}, false},
		{"", "asc", DocumentSort{}, true},
		{"", "desc", DocumentSort{}, true},
		{"title", "", DocumentSort{}, true},
		{"Name", "", DocumentSort{}, true},
		{"name", "up", DocumentSort{}, true},
		{"name", "ASC", DocumentSort{}, true},
	}
	for _, c := range cases {
		got, err := ParseDocumentSort(c.key, c.order)
		if c.bad {
			var ve ValidationError
			if err == nil || !asValidation(err, &ve) {
				t.Errorf("ParseDocumentSort(%q,%q) = %+v, %v; want a validation error", c.key, c.order, got, err)
			}
			continue
		}
		if err != nil || got != c.want {
			t.Errorf("ParseDocumentSort(%q,%q) = %+v, %v; want %+v", c.key, c.order, got, err, c.want)
		}
	}
}

func asValidation(err error, ve *ValidationError) bool {
	v, ok := err.(ValidationError)
	if ok {
		*ve = v
	}
	return ok
}

// sortRow is one seeded document: the title, the current file's size (0 = no
// file), who last edited it and when.
type sortRow struct {
	title  string
	size   int64
	editor string // u1, u2, agent, deleted
	at     time.Time
	id     string
}

type sortScene struct {
	t      *testing.T
	f      *docPermFixture
	tn     docTenant
	u1, u2 db.User
	t0     time.Time
}

func newSortScene(t *testing.T) *sortScene {
	t.Helper()
	f := newDocPermFixture(t)
	s := &sortScene{t: t, f: f, tn: f.tenant(t, "srt"+strings.ToLower(util.NewID()[20:]))}
	s.u1 = f.user(t, "srt1"+strings.ToLower(util.NewID()[20:]), "u1")
	s.u2 = f.user(t, "srt2"+strings.ToLower(util.NewID()[20:]), "u2")
	// "Bình" sorts before "Cường" under the Vietnamese collation.
	f.exec(t, `UPDATE users SET display_name = 'Bình' WHERE id = $1`, s.u1.ID)
	f.exec(t, `UPDATE users SET display_name = 'Cường' WHERE id = $1`, s.u2.ID)
	s.t0 = time.Now().UTC().Add(-48 * time.Hour).Truncate(time.Second)
	return s
}

// exec runs seed SQL on the fixture's pool.
func (f *docPermFixture) exec(t *testing.T, sql string, args ...any) {
	t.Helper()
	if _, err := f.pool.Exec(f.ctx, sql, args...); err != nil {
		t.Fatalf("seed: %v\n%s", err, sql)
	}
}

// the nine rows share titles, sizes, editors and dates on purpose, so every
// key has ties the id has to break.
func (s *sortScene) rows() []sortRow {
	t0, t1, t2 := s.t0, s.t0.Add(time.Hour), s.t0.Add(2*time.Hour)
	return []sortRow{
		{title: "alpha", size: 0, editor: "u1", at: t0},
		{title: "alpha", size: 100, editor: "u1", at: t0},
		{title: "Beta", size: 100, editor: "u2", at: t1},
		{title: "Đào", size: 5000, editor: "u2", at: t1},
		{title: "Đào", size: 0, editor: "agent", at: t2},
		{title: "Zed", size: 5000, editor: "deleted", at: t2},
		{title: "ca", size: 0, editor: "u1", at: t0},
		{title: "Beta", size: 0, editor: "u2", at: t2},
		{title: "Zed", size: 100, editor: "agent", at: t1},
	}
}

// seed inserts the rows into ws under parent and returns them with their ids.
func (s *sortScene) seed(ws, parent string) []sortRow {
	s.t.Helper()
	rows := s.rows()
	for i := range rows {
		r := &rows[i]
		r.id = s.insertDoc(ws, parent, r.title, r.size, r.editor, r.at)
	}
	return rows
}

func (s *sortScene) editorID(editor string) (id, kind string) {
	switch editor {
	case "u1":
		return s.u1.ID, "human"
	case "u2":
		return s.u2.ID, "human"
	case "agent":
		return "agent-" + s.tn.orgID, "agent"
	default: // a removed account: the id names no user row
		return "01DELETEDUSER" + strings.ToUpper(s.tn.orgID[len(s.tn.orgID)-6:]), "human"
	}
}

func (s *sortScene) insertDoc(ws, parent, title string, size int64, editor string, at time.Time) string {
	s.t.Helper()
	id := util.NewID()
	by, kind := s.editorID(editor)
	kindName := "page"
	if size > 0 {
		kindName = "file"
	}
	row := baseDoc(map[string]any{
		"id": id, "organization_id": s.tn.orgID, "workspace_id": ws, "kind": kindName, "title": title,
		"created_by": s.tn.owner.ID, "updated_by": by, "updated_by_kind": kind,
		"created_at": at, "updated_at": at,
	})
	if parent != "" {
		row["parent_id"] = parent
	}
	insertRow(s.t, s.f.ctx, s.f.pool, "documents", row)
	if size > 0 {
		vid := util.NewID()
		insertRow(s.t, s.f.ctx, s.f.pool, "document_versions", map[string]any{
			"id": vid, "organization_id": s.tn.orgID, "workspace_id": ws, "document_id": id, "version": 1,
			"kind": "file", "reason": "upload", "file_id": "f-" + vid, "mime_type": "application/pdf", "size_bytes": size,
			"created_by": s.tn.owner.ID, "created_by_kind": "human",
		})
		s.f.exec(s.t, `UPDATE documents SET file_version_id = $1, current_version = 1 WHERE id = $2`, vid, id)
	}
	return id
}

// titleRank is the Vietnamese order of the seeded titles (a < b < c < đ < z),
// case aside.
var titleRank = map[string]int{"alpha": 1, "Beta": 2, "ca": 3, "Đào": 4, "Zed": 5}

var editorRank = map[string]int{"u1": 1, "u2": 2}

// expectedOrder is the order a list must answer: (key, id) in one direction,
// ids byte-wise, an editor with no human name last whichever the direction.
func expectedOrder(rows []sortRow, sortKey string, desc bool) []string {
	r := append([]sortRow(nil), rows...)
	sort.SliceStable(r, func(i, j int) bool {
		a, b := r[i], r[j]
		c := 0
		switch sortKey {
		case "updated":
			c = a.at.Compare(b.at)
		case "size":
			c = int(a.size - b.size)
		case "name":
			c = titleRank[a.title] - titleRank[b.title]
		case "editor":
			ra, oka := editorRank[a.editor]
			rb, okb := editorRank[b.editor]
			if oka != okb {
				return oka
			}
			c = ra - rb
		}
		if c == 0 {
			c = strings.Compare(a.id, b.id)
		}
		if desc {
			return c > 0
		}
		return c < 0
	})
	out := make([]string, len(r))
	for i := range r {
		out[i] = r[i].id
	}
	return out
}

type sortPager func(sort DocumentSort, cursor string) (ids []string, next string, err error)

// walkSorted pages with the pager's limit until the list ends, asserting no row repeats
// and the pages hold three rows each but the last. Rows outside want (a My
// Folder, a folder) are dropped from the order check.
func walkSorted(t *testing.T, name string, page sortPager, sortBy DocumentSort, want map[string]bool) []string {
	t.Helper()
	var got []string
	seen := map[string]bool{}
	cursor := ""
	pages := 0
	for range 30 {
		ids, next, err := page(sortBy, cursor)
		if err != nil {
			t.Fatalf("%s %+v: %v", name, sortBy, err)
		}
		pages++
		for _, id := range ids {
			if seen[id] {
				t.Fatalf("%s %+v: %s listed twice", name, sortBy, id)
			}
			seen[id] = true
			if want[id] {
				got = append(got, id)
			}
		}
		if next == "" {
			if pages < 3 {
				t.Fatalf("%s %+v: only %d pages for %d rows", name, sortBy, pages, len(want))
			}
			return got
		}
		cursor = next
	}
	t.Fatalf("%s %+v: no end after 30 pages", name, sortBy)
	return nil
}

func idSet(rows []sortRow) map[string]bool {
	out := map[string]bool{}
	for _, r := range rows {
		out[r.id] = true
	}
	return out
}

func TestDocumentListSortPagesEveryKeyBothWaysOnEveryRoute(t *testing.T) {
	s := newSortScene(t)
	f, tn := s.f, s.tn
	owner := Human(tn.owner.ID)
	flatRows := s.seed(tn.wsA, "")
	folder := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsB, visibility: "workspace", createdBy: tn.owner.ID, title: "Thư mục", kind: DocumentKindFolder})
	childRows := s.seed(tn.wsB, folder.ID)
	// recent: the owner opened every flat row.
	for _, r := range flatRows {
		insertRow(t, f.ctx, f.pool, "document_access_logs", map[string]any{
			"id": util.NewID(), "organization_id": tn.orgID, "workspace_id": tn.wsA,
			"document_id": r.id, "actor_id": tn.owner.ID, "actor_kind": "human",
			"action": "view", "via": "member", "correlation_id": "corr-" + util.NewID(),
		})
	}
	// shared with me: every flat row is shared with the organization member
	// who belongs to no workspace.
	for _, r := range flatRows {
		d, err := f.q.GetDocumentByID(f.ctx, r.id)
		if err != nil {
			t.Fatal(err)
		}
		f.share(t, d, DocumentPrincipalUser, tn.outsider.ID, DocumentLevelView, tn.owner.ID)
	}

	// limit 2 puts a cursor on an editor-less row (rows 7-9 under sort=editor),
	// limit 3 only right before them (UNI-2038 r1 F4).
	var limit int
	routes := []struct {
		name string
		rows []sortRow
		page sortPager
	}{
		{"flat", flatRows, func(so DocumentSort, c string) ([]string, string, error) {
			p, err := f.svc.ListDocuments(f.ctx, owner, tn.wsA, ListDocumentsInput{Sort: so, Cursor: c, Limit: limit})
			return listIDs(p), p.NextCursor, err
		}},
		{"parent", childRows, func(so DocumentSort, c string) ([]string, string, error) {
			parent := folder.ID
			p, err := f.svc.ListDocuments(f.ctx, owner, tn.wsB, ListDocumentsInput{ParentID: &parent, Sort: so, Cursor: c, Limit: limit})
			return listIDs(p), p.NextCursor, err
		}},
		{"recent", flatRows, func(so DocumentSort, c string) ([]string, string, error) {
			p, err := f.svc.ListRecentDocuments(f.ctx, owner, tn.wsA, ListDocumentsInput{Sort: so, Cursor: c, Limit: limit})
			return listIDs(p), p.NextCursor, err
		}},
		{"shared-with-me", flatRows, sharedWithMePager(t, f, tn, &limit)},
	}
	for _, limit = range []int{3, 2} {
		t.Run("limit="+strconv.Itoa(limit), func(t *testing.T) {
			for _, rt := range routes {
				for _, key := range []string{"updated", "name", "size", "editor"} {
					for _, desc := range []bool{false, true} {
						so := DocumentSort{Key: key, Desc: desc}
						got := walkSorted(t, rt.name, rt.page, so, idSet(rt.rows))
						want := expectedOrder(rt.rows, key, desc)
						if !reflect.DeepEqual(got, want) {
							t.Errorf("%s sort=%s desc=%v\n got  %v\n want %v\n rows %+v", rt.name, key, desc, got, want, rt.rows)
						}
					}
				}
			}
		})
	}
}

// sharedWithMePager adapts the shared-with-me keyset (share time, or the sort
// key of the last candidate) to the opaque-cursor shape the other lists use.
func sharedWithMePager(t *testing.T, f *docPermFixture, tn docTenant, limit *int) sortPager {
	type pos struct {
		at   time.Time
		id   string
		sort DocumentSortCursor
	}
	var cursors []pos
	return func(so DocumentSort, cursor string) ([]string, string, error) {
		q := SharedWithMeQuery{Limit: *limit, Sort: so}
		if cursor != "" {
			var i int
			for i = range cursors {
				if cursor == "c"+string(rune('a'+i)) {
					break
				}
			}
			p := cursors[i]
			q.AfterCreatedAt, q.AfterID, q.AfterSort = p.at, p.id, p.sort
		} else {
			cursors = nil
		}
		page, err := f.svc.ListSharedWithMe(f.ctx, tn.outsider.ID, tn.orgID, q)
		if err != nil {
			return nil, "", err
		}
		ids := make([]string, len(page.Items))
		for i, it := range page.Items {
			ids[i] = it.Document.ID
		}
		if page.NextID == "" {
			return ids, "", nil
		}
		cursors = append(cursors, pos{page.NextCreatedAt, page.NextID, page.NextSort})
		return ids, "c" + string(rune('a'+len(cursors)-1)), nil
	}
}

// Without sort every list keeps today's order and today's cursor: updated
// then id descending (flat, recent), position then id (a tree level).
func TestDocumentListWithoutSortKeepsTheOldOrder(t *testing.T) {
	s := newSortScene(t)
	f, tn := s.f, s.tn
	owner := Human(tn.owner.ID)
	flatRows := s.seed(tn.wsA, "")
	folder := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsB, visibility: "workspace", createdBy: tn.owner.ID, title: "Thư mục", kind: DocumentKindFolder})
	childRows := s.seed(tn.wsB, folder.ID)
	for _, r := range flatRows {
		insertRow(t, f.ctx, f.pool, "document_access_logs", map[string]any{
			"id": util.NewID(), "organization_id": tn.orgID, "workspace_id": tn.wsA,
			"document_id": r.id, "actor_id": tn.owner.ID, "actor_kind": "human",
			"action": "view", "via": "member", "correlation_id": "corr-" + util.NewID(),
		})
	}
	updatedDescIDDesc := func(rows []sortRow) []string {
		r := append([]sortRow(nil), rows...)
		sort.Slice(r, func(i, j int) bool {
			if !r[i].at.Equal(r[j].at) {
				return r[i].at.After(r[j].at)
			}
			return r[i].id > r[j].id
		})
		out := make([]string, len(r))
		for i := range r {
			out[i] = r[i].id
		}
		return out
	}
	byID := func(rows []sortRow) []string {
		out := make([]string, len(rows))
		for i, r := range rows {
			out[i] = r.id
		}
		sort.Strings(out)
		return out
	}
	none := DocumentSort{}
	flat := walkSorted(t, "flat", func(so DocumentSort, c string) ([]string, string, error) {
		p, err := f.svc.ListDocuments(f.ctx, owner, tn.wsA, ListDocumentsInput{Sort: so, Cursor: c, Limit: 3})
		return listIDs(p), p.NextCursor, err
	}, none, idSet(flatRows))
	if want := updatedDescIDDesc(flatRows); !reflect.DeepEqual(flat, want) {
		t.Errorf("flat without sort\n got  %v\n want %v", flat, want)
	}
	recent := walkSorted(t, "recent", func(so DocumentSort, c string) ([]string, string, error) {
		p, err := f.svc.ListRecentDocuments(f.ctx, owner, tn.wsA, ListDocumentsInput{Sort: so, Cursor: c, Limit: 3})
		return listIDs(p), p.NextCursor, err
	}, none, idSet(flatRows))
	if want := updatedDescIDDesc(flatRows); !reflect.DeepEqual(recent, want) {
		t.Errorf("recent without sort\n got  %v\n want %v", recent, want)
	}
	parent := walkSorted(t, "parent", func(so DocumentSort, c string) ([]string, string, error) {
		pid := folder.ID
		p, err := f.svc.ListDocuments(f.ctx, owner, tn.wsB, ListDocumentsInput{ParentID: &pid, Sort: so, Cursor: c, Limit: 3})
		return listIDs(p), p.NextCursor, err
	}, none, idSet(childRows))
	if want := byID(childRows); !reflect.DeepEqual(parent, want) { // equal positions: id ascending
		t.Errorf("tree level without sort\n got  %v\n want %v", parent, want)
	}
}

func TestDocumentListSortRefusals(t *testing.T) {
	s := newSortScene(t)
	f, tn := s.f, s.tn
	owner := Human(tn.owner.ID)
	s.seed(tn.wsA, "")
	invalid := func(what string, err error) {
		t.Helper()
		var ve ValidationError
		if err == nil || !asValidation(err, &ve) {
			t.Errorf("%s: err = %v, want a validation error (400 invalid_request)", what, err)
		}
	}
	// UNI-2045 SV-0: the trash and the shelf sort now, each by its own screen
	// key; a screen key on another list is refused.
	_, err := f.svc.ListDocuments(f.ctx, owner, tn.wsA, ListDocumentsInput{Sort: DocumentSort{Key: "name"}, Archived: true})
	if err != nil {
		t.Errorf("sort=name on the trash: %v", err)
	}
	_, err = f.svc.ListDocuments(f.ctx, owner, tn.wsA, ListDocumentsInput{Sort: DocumentSort{Key: DocumentSortDeleted}, Shelved: true})
	invalid("sort=deleted on the shelf", err)
	_, err = f.svc.ListDocuments(f.ctx, owner, tn.wsA, ListDocumentsInput{Sort: DocumentSort{Key: DocumentSortShelved}, Archived: true})
	invalid("sort=shelved on the trash", err)
	_, err = f.svc.ListDocuments(f.ctx, owner, tn.wsA, ListDocumentsInput{Sort: DocumentSort{Key: DocumentSortDeleted}})
	invalid("sort=deleted on the flat list", err)

	first := func(so DocumentSort) string {
		p, err := f.svc.ListDocuments(f.ctx, owner, tn.wsA, ListDocumentsInput{Sort: so, Limit: 2})
		if err != nil || p.NextCursor == "" {
			t.Fatalf("first page %+v: %v cursor=%q", so, err, p.NextCursor)
		}
		return p.NextCursor
	}
	nameAsc, unsorted := first(DocumentSort{Key: "name"}), first(DocumentSort{})
	for _, c := range []struct {
		what   string
		cursor string
		sort   DocumentSort
	}{
		{"name cursor under size", nameAsc, DocumentSort{Key: "size", Desc: true}},
		{"name asc cursor under name desc", nameAsc, DocumentSort{Key: "name", Desc: true}},
		{"name cursor under no sort", nameAsc, DocumentSort{}},
		{"unsorted cursor under a sort", unsorted, DocumentSort{Key: "name"}},
	} {
		_, err := f.svc.ListDocuments(f.ctx, owner, tn.wsA, ListDocumentsInput{Sort: c.sort, Cursor: c.cursor})
		invalid(c.what, err)
		_, err = f.svc.ListRecentDocuments(f.ctx, owner, tn.wsA, ListDocumentsInput{Sort: c.sort, Cursor: c.cursor})
		invalid("recent "+c.what, err)
	}
	// a NUL rune in a cursor id or sorted key text is no valid text for the
	// database: it must be a 400, never a driver error (UNI-2038 r1 F1).
	nul := "a\x00b"
	at := time.Now().UTC()
	for _, c := range []struct {
		what   string
		cursor documentCursor
		sort   DocumentSort
	}{
		{"NUL in the cursor id", documentCursor{At: &at, ID: nul}, DocumentSort{}},
		{"NUL in the cursor id under a sort", documentCursor{At: &at, ID: nul, DocumentSortCursor: DocumentSortCursor{Sort: "name", Order: "asc", Text: &nul}}, DocumentSort{Key: "name"}},
		{"NUL in a name key", documentCursor{At: &at, ID: "x", DocumentSortCursor: DocumentSortCursor{Sort: "name", Order: "asc", Text: &nul}}, DocumentSort{Key: "name"}},
		{"NUL in an editor key", documentCursor{At: &at, ID: "x", DocumentSortCursor: DocumentSortCursor{Sort: "editor", Order: "asc", Text: &nul}}, DocumentSort{Key: "editor"}},
	} {
		cursor := encodeDocumentCursor(c.cursor)
		_, err := f.svc.ListDocuments(f.ctx, owner, tn.wsA, ListDocumentsInput{Sort: c.sort, Cursor: cursor})
		invalid(c.what, err)
		_, err = f.svc.ListRecentDocuments(f.ctx, owner, tn.wsA, ListDocumentsInput{Sort: c.sort, Cursor: cursor})
		invalid("recent "+c.what, err)
	}
	// the same pair keeps working, and so does the old cursor without sort.
	if _, err := f.svc.ListDocuments(f.ctx, owner, tn.wsA, ListDocumentsInput{Sort: DocumentSort{Key: "name"}, Cursor: nameAsc}); err != nil {
		t.Errorf("same sort cursor: %v", err)
	}
	if _, err := f.svc.ListDocuments(f.ctx, owner, tn.wsA, ListDocumentsInput{Cursor: unsorted}); err != nil {
		t.Errorf("old cursor without sort: %v", err)
	}
}

type viFixture struct {
	Titles   []string `json:"titles"`
	Expected []string `json:"expected"`
}

// The fixture is shared with the web comparator test; its expected order is
// what PostgreSQL gives under vi-x-icu, and the list must give the same: Đ
// after D, tones and case variants together, digits and punctuation first.
func readViFixture(t *testing.T) viFixture {
	t.Helper()
	raw, err := os.ReadFile("../../../packages/core/documents/vi-sort-fixture.json")
	if err != nil {
		t.Fatalf("fixture: %v", err)
	}
	var fx viFixture
	if err := json.Unmarshal(raw, &fx); err != nil || len(fx.Titles) == 0 || len(fx.Titles) != len(fx.Expected) {
		t.Fatalf("fixture shape: %v (%d titles, %d expected)", err, len(fx.Titles), len(fx.Expected))
	}
	return fx
}

func TestDocumentSortNameAndEditorFollowTheVietnameseFixture(t *testing.T) {
	fx := readViFixture(t)
	f := newDocPermFixture(t)
	tn := f.tenant(t, "vi"+strings.ToLower(util.NewID()[20:]))
	owner := Human(tn.owner.ID)
	byID := map[string]string{} // document id -> title, editor id -> display name
	editorOf := map[string]string{}
	for i, title := range fx.Titles {
		uid := util.NewID()
		insertRow(t, f.ctx, f.pool, "users", map[string]any{
			"id": uid, "email": "vi" + uid + "@example.com", "display_name": title,
		})
		id := util.NewID()
		insertRow(t, f.ctx, f.pool, "documents", baseDoc(map[string]any{
			"id": id, "organization_id": tn.orgID, "workspace_id": tn.wsA, "title": title,
			"created_by": tn.owner.ID, "updated_by": uid, "position": float64(i),
		}))
		byID[id] = title
		editorOf[id] = title
	}
	for _, key := range []string{"name", "editor"} {
		var got []string
		cursor := ""
		for range 20 {
			p, err := f.svc.ListDocuments(f.ctx, owner, tn.wsA, ListDocumentsInput{Sort: DocumentSort{Key: key}, Cursor: cursor, Limit: 25})
			if err != nil {
				t.Fatal(err)
			}
			for _, it := range p.Items {
				if title, ok := byID[it.Document.ID]; ok {
					got = append(got, title)
				}
			}
			if p.NextCursor == "" {
				break
			}
			cursor = p.NextCursor
		}
		if !reflect.DeepEqual(got, fx.Expected) {
			t.Errorf("sort=%s order differs from the fixture:\n got  %q\n want %q", key, got, fx.Expected)
		}
	}
}

// Sources: the four domains' files merge under the same sort. The seeded
// rows share names, sizes and senders; chat and task rows interleave.
func TestDocumentSourceSortPagesEveryKeyBothWays(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	s := &sourceScene{t: t, ctx: context.Background(), f: env.f, tn: env.tn}
	svc, _ := sourceService(t, env)
	tn := env.tn
	f := env.f
	f.exec(t, `UPDATE users SET display_name = 'Bình' WHERE id = $1`, tn.owner.ID)
	f.exec(t, `UPDATE users SET display_name = 'Cường' WHERE id = $1`, tn.member.ID)
	taskA := s.task(tn, tn.wsA)
	public := s.room(tn.orgID, tn.wsA, "channel", "public", "", false)

	type srow struct {
		id     string
		name   string
		size   int64
		editor string
		at     time.Time
	}
	t0 := time.Now().UTC().Add(-48 * time.Hour).Truncate(time.Second)
	at := func(i int) time.Time { return t0.Add(time.Duration(i) * time.Hour) }
	var rows []srow
	chat := func(name string, size int64, editor string, i int) {
		sender, kind := tn.owner.ID, "human"
		switch editor {
		case "u2":
			sender = tn.member.ID
		case "agent":
			sender, kind = "agent-chat", "agent"
		}
		id := s.fileMessage(tn.orgID, tn.wsA, public, sender, name, false)
		f.exec(t, `UPDATE chat_messages SET sender_kind = $2, created_at = $3 WHERE id = $1`, id, kind, at(i))
		f.exec(t, `UPDATE files SET size_bytes = $2 WHERE id = (SELECT file_id FROM chat_messages WHERE id = $1)`, id, size)
		rows = append(rows, srow{"chat:" + id, name, size, editor, at(i)})
	}
	task := func(name string, size int64, editor string, i int) {
		uploader, typ := tn.owner.ID, "member"
		switch editor {
		case "u2":
			uploader = tn.member.ID
		case "agent":
			uploader, typ = "agent-task", "agent"
		}
		id := s.attachment(tn, tn.wsA, taskA, "", name)
		f.exec(t, `UPDATE attachments SET uploader_id = $2, uploader_type = $3, size_bytes = $4, created_at = $5 WHERE id = $1`, id, uploader, typ, size, at(i))
		rows = append(rows, srow{"task:" + id, name, size, editor, at(i)})
	}
	chat("alpha.pdf", 10, "u1", 0)
	chat("Beta.pdf", 20, "u2", 1)
	chat("Đào.pdf", 30, "agent", 2)
	chat("ca.pdf", 10, "u1", 0)
	chat("Zed.pdf", 20, "u2", 1)
	task("alpha.pdf", 30, "u1", 2)
	task("Beta.pdf", 10, "agent", 0)
	task("Đào.pdf", 20, "u2", 1)
	task("Zed.pdf", 30, "u1", 2)

	nameRank := map[string]int{"alpha.pdf": 1, "Beta.pdf": 2, "ca.pdf": 3, "Đào.pdf": 4, "Zed.pdf": 5}
	want := func(key string, desc bool) []string {
		r := append([]srow(nil), rows...)
		sort.SliceStable(r, func(i, j int) bool {
			a, b := r[i], r[j]
			c := 0
			switch key {
			case "updated":
				c = a.at.Compare(b.at)
			case "size":
				c = int(a.size - b.size)
			case "name":
				c = nameRank[a.name] - nameRank[b.name]
			case "editor":
				ra, oka := editorRank[a.editor]
				rb, okb := editorRank[b.editor]
				if oka != okb {
					return oka
				}
				c = ra - rb
			}
			if c == 0 {
				c = strings.Compare(a.id, b.id)
			}
			if desc {
				return c > 0
			}
			return c < 0
		})
		out := make([]string, len(r))
		for i := range r {
			out[i] = r[i].id
		}
		return out
	}
	// limit 2 puts a cursor on an editor-less row (the two agent files, last
	// under sort=editor); limit 4 does not (UNI-2038 r1 F4).
	for _, limit := range []int{4, 2} {
		for _, key := range []string{"updated", "name", "size", "editor"} {
			for _, desc := range []bool{false, true} {
				so := DocumentSort{Key: key, Desc: desc}
				var got []string
				cursor, pages := "", 0
				for range 10 {
					page, err := svc.List(s.ctx, human(tn.member), tn.wsA, DocumentSourceFilter{Sort: so, Cursor: cursor, Limit: limit})
					if err != nil {
						t.Fatalf("sources %+v: %v", so, err)
					}
					pages++
					for _, it := range page.Items {
						got = append(got, it.ID)
					}
					if page.NextCursor == "" {
						break
					}
					cursor = page.NextCursor
				}
				if pages != (len(rows)+limit-1)/limit {
					t.Errorf("sources %+v limit=%d: %d pages, want %d", so, limit, pages, (len(rows)+limit-1)/limit)
				}
				if w := want(key, desc); !reflect.DeepEqual(got, w) {
					t.Errorf("sources limit=%d sort=%s desc=%v\n got  %v\n want %v", limit, key, desc, got, w)
				}
			}
		}
	}

	// today's order without sort: newest first, source id descending.
	page, err := svc.List(s.ctx, human(tn.member), tn.wsA, DocumentSourceFilter{Limit: 100})
	if err != nil {
		t.Fatal(err)
	}
	for i := 1; i < len(page.Items); i++ {
		if !documentSourceBefore(page.Items[i-1], page.Items[i]) {
			t.Fatalf("unsorted sources out of order at %d: %s then %s", i, page.Items[i-1].ID, page.Items[i].ID)
		}
	}

	// cursor and parameter refusals.
	first, err := svc.List(s.ctx, human(tn.member), tn.wsA, DocumentSourceFilter{Sort: DocumentSort{Key: "name"}, Limit: 2})
	if err != nil || first.NextCursor == "" {
		t.Fatalf("first page: %v %q", err, first.NextCursor)
	}
	old, err := svc.List(s.ctx, human(tn.member), tn.wsA, DocumentSourceFilter{Limit: 2})
	if err != nil || old.NextCursor == "" {
		t.Fatalf("old first page: %v %q", err, old.NextCursor)
	}
	for _, c := range []struct {
		what   string
		cursor string
		sort   DocumentSort
	}{
		{"name cursor under size", first.NextCursor, DocumentSort{Key: "size", Desc: true}},
		{"name asc cursor under name desc", first.NextCursor, DocumentSort{Key: "name", Desc: true}},
		{"name cursor without sort", first.NextCursor, DocumentSort{}},
		{"old cursor under a sort", old.NextCursor, DocumentSort{Key: "name"}},
	} {
		var ve ValidationError
		_, err := svc.List(s.ctx, human(tn.member), tn.wsA, DocumentSourceFilter{Sort: c.sort, Cursor: c.cursor})
		if err == nil || !asValidation(err, &ve) {
			t.Errorf("%s: err = %v, want a validation error", c.what, err)
		}
	}
	// a NUL rune in the cursor id or the key text is a 400, not a driver error.
	nul := "a\x00b"
	for _, c := range []struct {
		what   string
		cursor documentSourceSortCursor
	}{
		{"NUL in the source id", documentSourceSortCursor{At: t0, ID: nul, DocumentSortCursor: DocumentSortCursor{Sort: "name", Order: "asc", Text: &nul}}},
		{"NUL in the name key", documentSourceSortCursor{At: t0, ID: "chat:x", DocumentSortCursor: DocumentSortCursor{Sort: "name", Order: "asc", Text: &nul}}},
		{"NUL in the editor key", documentSourceSortCursor{At: t0, ID: "chat:x", DocumentSortCursor: DocumentSortCursor{Sort: "editor", Order: "asc", Text: &nul}}},
	} {
		raw, _ := json.Marshal(c.cursor)
		so := DocumentSort{Key: c.cursor.Sort}
		var ve ValidationError
		_, err := svc.List(s.ctx, human(tn.member), tn.wsA, DocumentSourceFilter{Sort: so, Cursor: base64.RawURLEncoding.EncodeToString(raw)})
		if err == nil || !asValidation(err, &ve) {
			t.Errorf("%s: err = %v, want a validation error", c.what, err)
		}
	}
	// the unsorted "time|id" cursor has the same hole (UNI-2038 fx2).
	unsortedNUL := base64.RawURLEncoding.EncodeToString([]byte(t0.Format(time.RFC3339Nano) + "|" + nul))
	var ve ValidationError
	if _, err := svc.List(s.ctx, human(tn.member), tn.wsA, DocumentSourceFilter{Cursor: unsortedNUL}); err == nil || !asValidation(err, &ve) {
		t.Errorf("NUL in the unsorted source id: err = %v, want a validation error", err)
	}
	if _, err := svc.List(s.ctx, human(tn.member), tn.wsA, DocumentSourceFilter{Cursor: old.NextCursor}); err != nil {
		t.Errorf("old cursor without sort: %v", err)
	}
}

// An email attachment has no editor (editor_null for the whole stream): under
// sort=editor every email row, and an agent's chat file, sits after the
// human-edited rows whichever the direction, ordered by id among themselves,
// and a cursor minted on one of them pages on without a gap (UNI-2038 r1 F5).
func TestDocumentSourceSortEditorPutsEmailRowsLast(t *testing.T) {
	env := newFakeDocStorageEnv(t)
	s := &sourceScene{t: t, ctx: context.Background(), f: env.f, tn: env.tn}
	tn, f := env.tn, env.f
	svc := NewDocumentSourceService(DocumentSourceDeps{
		Documents: env.svc, Chat: func() *ChatService {
			chat := NewChatService(f.pool, f.q, env.svc.ws, NopPublisher{})
			chat.SetFiles(env.fs)
			return chat
		}(),
		EmailHub: NewEmailHubService(f.q, env.svc.ws, testEmailHubBox(t)),
	})
	f.exec(t, `UPDATE users SET display_name = 'Bình' WHERE id = $1`, tn.owner.ID)
	f.exec(t, `UPDATE users SET display_name = 'Cường' WHERE id = $1`, tn.member.ID)
	public := s.room(tn.orgID, tn.wsA, "channel", "public", "", false)

	type srow struct {
		id     string
		editor string // u1, u2, "" for an editor-less row
	}
	var rows []srow
	chat := func(sender, kind, editor string) {
		id := s.fileMessage(tn.orgID, tn.wsA, public, sender, "chat.pdf", false)
		f.exec(t, `UPDATE chat_messages SET sender_kind = $2 WHERE id = $1`, id, kind)
		rows = append(rows, srow{"chat:" + id, editor})
	}
	chat(tn.owner.ID, "human", "u1")
	chat(tn.member.ID, "human", "u2")
	chat(tn.owner.ID, "human", "u1")
	chat("agent-chat", "agent", "")

	acc, err := f.q.CreateEmailHubAccount(s.ctx, db.CreateEmailHubAccountParams{
		ID: util.NewID(), UserID: tn.member.ID, OrganizationID: tn.orgID, EmailAddress: strings.ToLower(util.NewID()) + "@example.com",
		Provider: "gmail", ImapHost: "imap.example.com", ImapPort: 993, ImapSecurity: "tls",
		SmtpHost: "smtp.example.com", SmtpPort: 465, SmtpSecurity: "starttls", AuthKind: "password", PasswordEnc: "x",
	})
	if err != nil {
		t.Fatal(err)
	}
	for i := int32(1); i <= 3; i++ {
		th, err := f.q.UpsertEmailHubThread(s.ctx, db.UpsertEmailHubThreadParams{
			ID: util.NewID(), AccountID: acc.ID, OrganizationID: tn.orgID, Folder: "INBOX", ImapUid: i,
			Subject: "Mail", FromAddr: "sender@example.com", ToAddrs: []string{acc.EmailAddress},
			SentAt: pgtype.Timestamptz{Time: time.Now().Add(-time.Duration(i) * time.Hour), Valid: true}, HasAttachments: true,
			ImapLabels: []string{}, ConversationKey: "conv-" + acc.ID + "-" + util.NewID(),
		})
		if err != nil {
			t.Fatal(err)
		}
		att, err := f.q.CreateEmailHubAttachment(s.ctx, db.CreateEmailHubAttachmentParams{
			ID: util.NewID(), ThreadID: th.ID, AccountID: acc.ID, OrganizationID: tn.orgID,
			Filename: "mail.pdf", MimeType: "application/pdf", SizeBytes: 4, PartID: "2",
		})
		if err != nil {
			t.Fatal(err)
		}
		rows = append(rows, srow{"email:" + att.ID, ""})
	}

	humanRank := map[string]int{"u1": 1, "u2": 2}
	for _, desc := range []bool{false, true} {
		r := append([]srow(nil), rows...)
		sort.SliceStable(r, func(i, j int) bool {
			a, b := r[i], r[j]
			ra, oka := humanRank[a.editor]
			rb, okb := humanRank[b.editor]
			if oka != okb {
				return oka
			}
			c := ra - rb
			if c == 0 {
				c = strings.Compare(a.id, b.id)
			}
			if desc {
				return c > 0
			}
			return c < 0
		})
		want := make([]string, len(r))
		for i := range r {
			want[i] = r[i].id
		}
		var got []string
		cursor, pages := "", 0
		for range 10 {
			page, err := svc.List(s.ctx, human(tn.member), tn.wsA, DocumentSourceFilter{Sort: DocumentSort{Key: "editor", Desc: desc}, Cursor: cursor, Limit: 2})
			if err != nil {
				t.Fatalf("sources editor desc=%v: %v", desc, err)
			}
			pages++
			for _, it := range page.Items {
				got = append(got, it.ID)
			}
			if page.NextCursor == "" {
				break
			}
			cursor = page.NextCursor
		}
		if pages != 4 {
			t.Errorf("sources editor desc=%v: %d pages, want 4", desc, pages)
		}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("sources editor desc=%v\n got  %v\n want %v", desc, got, want)
		}
	}
}

// The editor key is ordered by the Vietnamese collation on every route, not
// only the flat one the fixture test walks: with these names C order is
// Dũng, Zed, Đào, the Vietnamese one Dũng, Đào, Zed, so a keyset predicate
// on another collation skips or repeats rows (UNI-2038 r1 F5).
func TestDocumentSortEditorUsesTheVietnameseCollationOnEveryRoute(t *testing.T) {
	f := newDocPermFixture(t)
	tn := f.tenant(t, "edv"+strings.ToLower(util.NewID()[20:]))
	owner := Human(tn.owner.ID)
	editors := map[string]string{} // display name -> user id
	for _, name := range []string{"Đào", "Dũng", "Zed"} {
		uid := util.NewID()
		insertRow(t, f.ctx, f.pool, "users", map[string]any{"id": uid, "email": "ed" + uid + "@example.com", "display_name": name})
		editors[name] = uid
	}
	rank := map[string]int{"Dũng": 1, "Đào": 2, "Zed": 3}
	type edoc struct{ id, editor string }
	seed := func(ws, parent string) []edoc {
		var docs []edoc
		for i, name := range []string{"Zed", "Đào", "Dũng", "Đào", "Zed", "Dũng"} {
			id := util.NewID()
			row := baseDoc(map[string]any{
				"id": id, "organization_id": tn.orgID, "workspace_id": ws, "title": "doc " + string(rune('a'+i)),
				"created_by": tn.owner.ID, "updated_by": editors[name],
			})
			if parent != "" {
				row["parent_id"] = parent
			}
			insertRow(t, f.ctx, f.pool, "documents", row)
			docs = append(docs, edoc{id, name})
		}
		return docs
	}
	flat := seed(tn.wsA, "")
	folder := f.treeDoc(t, tn, treeDocSpec{ws: tn.wsB, visibility: "workspace", createdBy: tn.owner.ID, title: "Thư mục", kind: DocumentKindFolder})
	children := seed(tn.wsB, folder.ID)
	for _, d := range flat {
		insertRow(t, f.ctx, f.pool, "document_access_logs", map[string]any{
			"id": util.NewID(), "organization_id": tn.orgID, "workspace_id": tn.wsA,
			"document_id": d.id, "actor_id": tn.owner.ID, "actor_kind": "human",
			"action": "view", "via": "member", "correlation_id": "corr-" + util.NewID(),
		})
		doc, err := f.q.GetDocumentByID(f.ctx, d.id)
		if err != nil {
			t.Fatal(err)
		}
		f.share(t, doc, DocumentPrincipalUser, tn.outsider.ID, DocumentLevelView, tn.owner.ID)
	}
	limit := 2
	routes := []struct {
		name string
		docs []edoc
		page sortPager
	}{
		{"parent", children, func(so DocumentSort, c string) ([]string, string, error) {
			parent := folder.ID
			p, err := f.svc.ListDocuments(f.ctx, owner, tn.wsB, ListDocumentsInput{ParentID: &parent, Sort: so, Cursor: c, Limit: limit})
			return listIDs(p), p.NextCursor, err
		}},
		{"recent", flat, func(so DocumentSort, c string) ([]string, string, error) {
			p, err := f.svc.ListRecentDocuments(f.ctx, owner, tn.wsA, ListDocumentsInput{Sort: so, Cursor: c, Limit: limit})
			return listIDs(p), p.NextCursor, err
		}},
		{"shared-with-me", flat, sharedWithMePager(t, f, tn, &limit)},
	}
	for _, rt := range routes {
		want := map[string]bool{}
		for _, d := range rt.docs {
			want[d.id] = true
		}
		for _, desc := range []bool{false, true} {
			so := DocumentSort{Key: "editor", Desc: desc}
			got := walkSorted(t, rt.name, rt.page, so, want)
			docs := append([]edoc(nil), rt.docs...)
			sort.Slice(docs, func(i, j int) bool {
				c := rank[docs[i].editor] - rank[docs[j].editor]
				if c == 0 {
					c = strings.Compare(docs[i].id, docs[j].id)
				}
				if desc {
					return c > 0
				}
				return c < 0
			})
			wantIDs := make([]string, len(docs))
			for i, d := range docs {
				wantIDs[i] = d.id
			}
			if !reflect.DeepEqual(got, wantIDs) {
				t.Errorf("%s editor desc=%v\n got  %v\n want %v", rt.name, desc, got, wantIDs)
			}
		}
	}
}
