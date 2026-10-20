package handler

// UNI-2038 S3: the optional sort/order query of the documents library lists,
// over the real router. The ordering itself is held in the service tests; this
// file holds the wire contract: what is 400, what the cursor refuses, and that
// the four operations publish both parameters.

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func docTitles(t *testing.T, out map[string]any) []string {
	t.Helper()
	raw, _ := out["documents"].([]any)
	titles := make([]string, 0, len(raw))
	for _, item := range raw {
		titles = append(titles, item.(map[string]any)["title"].(string))
	}
	return titles
}

func TestDocumentListSortOverHTTP(t *testing.T) {
	w := newDocsWorld(t)
	for _, title := range []string{"Zed", "Đào", "alpha", "Beta"} {
		docsCreatePageBody(t, w, w.token, map[string]any{"title": title, "visibility": "workspace"})
	}
	base := "/api/v1/workspaces/" + w.wsID + "/documents"
	get := func(path string) (*http.Response, map[string]any) {
		return doJSON(t, w.srv, "GET", path, w.token, nil)
	}

	// name runs A to Z with Đ after D (and z last), the other way for desc.
	res, out := get(base + "?sort=name")
	if res.StatusCode != 200 {
		t.Fatalf("sort=name: %d %v", res.StatusCode, out)
	}
	want := []string{"alpha", "Beta", "Đào", "Zed"}
	if got := docTitles(t, out); !reflect.DeepEqual(onlyTitles(got, want), want) {
		t.Errorf("sort=name titles = %v, want %v", got, want)
	}
	res, out = get(base + "?sort=name&order=desc")
	if res.StatusCode != 200 {
		t.Fatalf("sort=name&order=desc: %d %v", res.StatusCode, out)
	}
	rev := []string{"Zed", "Đào", "Beta", "alpha"}
	if got := docTitles(t, out); !reflect.DeepEqual(onlyTitles(got, rev), rev) {
		t.Errorf("sort=name&order=desc titles = %v, want %v", got, rev)
	}

	// without sort the response is today's: newest first, no sort in sight.
	res, out = get(base)
	if res.StatusCode != 200 {
		t.Fatalf("no sort: %d %v", res.StatusCode, out)
	}
	if got := docTitles(t, out); !reflect.DeepEqual(onlyTitles(got, []string{"Beta", "alpha", "Đào", "Zed"}), []string{"Beta", "alpha", "Đào", "Zed"}) {
		t.Errorf("no sort titles = %v, want newest first", got)
	}

	// every refusal is 400 invalid_request, on every list that takes sort.
	for _, root := range []string{base, base + "/recent", base + "/shared-with-me"} {
		for _, q := range []string{
			"?sort=title", "?sort=NAME", "?order=asc", "?order=desc", "?sort=name&order=up", "?sort=name&order=ASC", "?sort=",
		} {
			if q == "?sort=" { // an empty value is "absent"
				res, out := get(root + q)
				if res.StatusCode != 200 {
					t.Errorf("GET %s%s = %d %v, want 200 (empty sort is no sort)", root, q, res.StatusCode, out)
				}
				continue
			}
			res, out := get(root + q)
			wantErr(t, res, out, 400, "invalid_request", "")
		}
	}
	// UNI-2045 SV-0: the trash and the shelf take the sort now; recent is no
	// such view, so a sort next to archived/shelved stays 400 there.
	for _, q := range []string{"?sort=name&archived=1", "?sort=name&archived=true", "?sort=updated&shelved=1"} {
		res, out := get(base + "/recent" + q)
		wantErr(t, res, out, 400, "invalid_request", "")
		if res, out := get(base + q); res.StatusCode != 200 {
			t.Errorf("GET %s%s = %d %v, want 200", base, q, res.StatusCode, out)
		}
	}

	// a cursor belongs to the sort it was minted for.
	res, out = get(base + "?sort=name&limit=1")
	cursor, _ := out["next_cursor"].(string)
	if res.StatusCode != 200 || cursor == "" {
		t.Fatalf("first sorted page: %d %v", res.StatusCode, out)
	}
	for _, q := range []string{"&sort=size", "&sort=name&order=desc", ""} {
		res, out := get(base + "?cursor=" + cursor + q)
		wantErr(t, res, out, 400, "invalid_request", "")
	}
	res, out = get(base + "?cursor=" + cursor + "&sort=name")
	if res.StatusCode != 200 {
		t.Errorf("same sort cursor: %d %v", res.StatusCode, out)
	}
	res, out = get(base + "?limit=1")
	oldCursor, _ := out["next_cursor"].(string)
	if res.StatusCode != 200 || oldCursor == "" {
		t.Fatalf("first unsorted page: %d %v", res.StatusCode, out)
	}
	res, out = get(base + "?cursor=" + oldCursor + "&sort=name")
	wantErr(t, res, out, 400, "invalid_request", "")
	res, out = get(base + "?cursor=" + oldCursor + "&limit=1")
	if res.StatusCode != 200 {
		t.Errorf("old cursor without sort: %d %v", res.StatusCode, out)
	}
}

// onlyTitles keeps the titles of want, in order: the workspace may hold
// other rows (a My Folder) that the check does not care about.
func onlyTitles(got, want []string) []string {
	keep := map[string]bool{}
	for _, w := range want {
		keep[w] = true
	}
	var out []string
	for _, g := range got {
		if keep[g] {
			out = append(out, g)
		}
	}
	return out
}

// The shared-with-me cursor carries the sort too; the check runs before any
// read, so crafted cursors prove it.
func TestSharedWithMeCursorRefusesAnotherSort(t *testing.T) {
	w := newDocsWorld(t)
	path := "/api/v1/workspaces/" + w.wsID + "/documents/shared-with-me"
	enc := func(c map[string]any) string {
		raw, _ := json.Marshal(c)
		return base64.RawURLEncoding.EncodeToString(raw)
	}
	nameCursor := enc(map[string]any{"t": "2026-10-01T00:00:00Z", "id": "01J8X4DOC0N1P2Q3R4S5T6U7", "s": "name", "o": "asc", "x": "alpha"})
	oldCursor := enc(map[string]any{"t": "2026-10-01T00:00:00Z", "id": "01J8X4DOC0N1P2Q3R4S5T6U7"})
	brokenCursor := enc(map[string]any{"t": "2026-10-01T00:00:00Z", "id": "01J8X4DOC0N1P2Q3R4S5T6U7", "s": "size", "o": "asc"}) // no key
	for _, c := range []struct {
		what, query string
		status      int
	}{
		{"name cursor under size", "?sort=size&cursor=" + nameCursor, 400},
		{"name asc cursor under name desc", "?sort=name&order=desc&cursor=" + nameCursor, 400},
		{"name cursor without sort", "?cursor=" + nameCursor, 400},
		{"unsorted cursor under a sort", "?sort=name&cursor=" + oldCursor, 400},
		{"sorted cursor missing its key", "?sort=size&order=asc&cursor=" + brokenCursor, 400},
		{"same sort", "?sort=name&cursor=" + nameCursor, 200},
		{"old cursor without sort", "?cursor=" + oldCursor, 200},
	} {
		res, out := doJSON(t, w.srv, "GET", path+c.query, w.token, nil)
		if c.status == 400 {
			wantErr(t, res, out, 400, "invalid_request", "")
		} else if res.StatusCode != c.status {
			t.Errorf("%s: %d %v, want %d", c.what, res.StatusCode, out, c.status)
		}
	}
}

// All four operations publish sort and order with their enum.
func TestDocumentSortParamsInOpenAPI(t *testing.T) {
	d, pool := newTestDeps(t, nil, discardOutbox{})
	d.Cfg.EnableSwagger = true
	q := db.New(pool)
	docs := service.NewDocumentService(pool, q, d.Organizations, d.Workspaces)
	docs.SetEntitlements(service.NewEntitlementService(pool, q))
	docs.SetFiles(filesfake.New(filesfake.Options{}))
	d.Documents = docs
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)
	res, err := srv.Client().Get(srv.URL + "/swagger/doc.json")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var spec struct {
		Paths map[string]map[string]struct {
			Parameters []struct {
				Name        string `json:"name"`
				In          string `json:"in"`
				Description string `json:"description"`
				Schema      struct {
					Enum    []string `json:"enum"`
					Example any      `json:"example"`
				} `json:"schema"`
			} `json:"parameters"`
		} `json:"paths"`
	}
	if err := json.NewDecoder(res.Body).Decode(&spec); err != nil {
		t.Fatal(err)
	}
	// UNI-2045: the screen keys ride after the four column keys.
	for p, sortEnum := range map[string][]string{
		"/api/v1/workspaces/{workspaceID}/documents":                {"updated", "name", "size", "editor", "deleted", "shelved", "shared"},
		"/api/v1/workspaces/{workspaceID}/documents/favorites":      {"updated", "name", "size", "editor", "starred"},
		"/api/v1/workspaces/{workspaceID}/documents/recent":         {"updated", "name", "size", "editor", "activity"},
		"/api/v1/workspaces/{workspaceID}/documents/shared-with-me": {"updated", "name", "size", "editor", "shared"},
		"/api/v1/workspaces/{workspaceID}/documents/sources":        {"updated", "name", "size", "editor"},
	} {
		wantEnum := map[string][]string{"sort": sortEnum, "order": {"asc", "desc"}}
		found := map[string]bool{}
		for _, param := range spec.Paths[p]["get"].Parameters {
			enum, ok := wantEnum[param.Name]
			if !ok || param.In != "query" {
				continue
			}
			found[param.Name] = true
			if !reflect.DeepEqual(param.Schema.Enum, enum) {
				t.Errorf("%s %s enum = %v, want %v", p, param.Name, param.Schema.Enum, enum)
			}
			if param.Description == "" || param.Schema.Example == nil {
				t.Errorf("%s %s lacks a description or an example", p, param.Name)
			}
		}
		if len(found) != 2 {
			t.Errorf("%s publishes %v, want sort and order", p, found)
		}
	}
}
