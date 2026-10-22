package handler

// UNI-2113 (contract A): the repeated ?type= query parameter of the document
// lists, over HTTP. Pages and txt/md uploads are enough to tell the legs apart;
// the per-format MIME matrix is held by the service tests.

import (
	"net/url"
	"reflect"
	"testing"
	"time"
)

func TestDocumentTypesFromQuery(t *testing.T) {
	for _, c := range []struct {
		query string
		want  []string
	}{
		{"", nil},
		{"type=docx", []string{"docx"}},
		{"type=docx&type=xlsx", []string{"docx", "xlsx"}},
		{"type=%20docx%20&type=docx&type=page&type=docx", []string{"docx", "page"}},
		// An empty value is kept so the service answers 400 invalid_type.
		{"type=", []string{""}},
		{"type=docx&type=%20", []string{"docx", ""}},
		{"type=docx&type=&type=", []string{"docx", ""}},
	} {
		q, err := url.ParseQuery(c.query)
		if err != nil {
			t.Fatal(err)
		}
		got := documentTypesFromQuery(q)
		if len(got) == 0 && len(c.want) == 0 {
			continue
		}
		if !reflect.DeepEqual(got, c.want) {
			t.Errorf("?%s -> %q, want %q", c.query, got, c.want)
		}
	}
}

func TestDoclistTypeParam(t *testing.T) {
	w := newDocsWorld(t)
	memberTok, memberID := docsJoinWorkspace(t, w, "dl-type-member@example.com")
	base := dlBase(w)
	now := time.Now().UTC().Add(-time.Hour)

	_, folder := docsCreatePageBody(t, w, w.token, map[string]any{"title": "F", "kind": "folder"})
	txt := dlCreateFile(t, w, "notes.txt", folder, []byte("plain notes\n"))
	md := dlCreateFile(t, w, "readme.md", folder, []byte("# readme\n"))
	_, pageID := docsCreatePageBody(t, w, w.token, map[string]any{"title": "a page", "parent_id": folder})
	// Restricted to the owner: the member never sees it, whatever the type.
	secret := dlCreateFile(t, w, "secret.txt", "", []byte("secret\n"))
	dlExec(t, `UPDATE documents SET visibility = 'restricted' WHERE id = $1`, secret)

	titles := func(rows map[string]map[string]any) map[string]bool {
		out := map[string]bool{}
		for title := range rows {
			out[title] = true
		}
		return out
	}
	// has asserts the named files/pages are present and the others absent; the
	// folder is not asserted (a file-format answer keeps folders by design).
	has := func(what, token, path string, present, absent []string) {
		t.Helper()
		rows := titles(dlRows(t, w, token, path))
		for _, title := range present {
			if !rows[title] {
				t.Errorf("%s: %q missing from %s (rows %v)", what, title, path, rows)
			}
		}
		for _, title := range absent {
			if rows[title] {
				t.Errorf("%s: %q must not be in %s (rows %v)", what, title, path, rows)
			}
		}
	}

	dlLog(t, w, txt, w.userID, "view", now)
	dlLog(t, w, md, w.userID, "view", now)
	dlLog(t, w, pageID, w.userID, "view", now)
	dlFavorite(t, w, w.token, txt)
	dlFavorite(t, w, w.token, md)
	dlFavorite(t, w, w.token, pageID)
	dlExec(t, `UPDATE documents SET visibility = 'restricted' WHERE id = ANY($1)`, []string{txt, md, pageID})
	dlShare(t, w, txt, "user", memberID, w.userID, "human", now)
	dlShare(t, w, md, "user", memberID, w.userID, "human", now)
	dlShare(t, w, pageID, "user", memberID, w.userID, "human", now)

	// single type, two formats (OR), page + format (OR), on every list route.
	for _, route := range []struct{ name, token, path string }{
		{"flat", w.token, base + "?parent_id=" + folder},
		{"recent", w.token, base + "/recent"},
		{"favorites", w.token, base + "/favorites"},
		{"shared-with-me", memberTok, base + "/shared-with-me"},
	} {
		sep := "?"
		if route.name == "flat" {
			sep = "&"
		}
		has(route.name+" type=txt", route.token, route.path+sep+"type=txt",
			[]string{"notes.txt"}, []string{"readme.md", "a page"})
		has(route.name+" type=txt&type=md", route.token, route.path+sep+"type=txt&type=md",
			[]string{"notes.txt", "readme.md"}, []string{"a page"})
		has(route.name+" type=page&type=md", route.token, route.path+sep+"type=page&type=md",
			[]string{"a page", "readme.md"}, []string{"notes.txt"})
		has(route.name+" type=page", route.token, route.path+sep+"type=page",
			[]string{"a page"}, []string{"notes.txt", "readme.md"})
		has(route.name+" no type", route.token, route.path,
			[]string{"notes.txt", "readme.md", "a page"}, nil)

		// unknown and empty values are 400 invalid_type (the repo's coded error).
		for _, bad := range []string{"type=bogus", "type=", "type=txt&type=DOCX", "type=txt&type=%20"} {
			res, out := dlGet(t, w, route.token, route.path+sep+bad)
			wantErr(t, res, out, 400, "invalid_type", "")
		}
	}

	// type next to format=/kind= narrows (AND): never widens them.
	has("flat type=txt&format=md", w.token, base+"?parent_id="+folder+"&type=txt&format=md", nil, []string{"notes.txt", "readme.md", "a page"})
	has("flat type=txt&type=md&format=md", w.token, base+"?parent_id="+folder+"&type=txt&type=md&format=md",
		[]string{"readme.md"}, []string{"notes.txt", "a page"})
	has("flat type=page&kind=file", w.token, base+"?parent_id="+folder+"&type=page&kind=file", nil, []string{"notes.txt", "readme.md", "a page"})
	has("flat type=page&type=txt&kind=page", w.token, base+"?parent_id="+folder+"&type=page&type=txt&kind=page",
		[]string{"a page"}, []string{"notes.txt", "readme.md"})
	// format=/kind= alone keep today's behaviour.
	has("flat format=txt", w.token, base+"?parent_id="+folder+"&format=txt", []string{"notes.txt"}, []string{"readme.md", "a page"})
	has("flat kind=page", w.token, base+"?parent_id="+folder+"&kind=page", []string{"a page"}, []string{"notes.txt", "readme.md"})

	// An item the caller cannot see never appears, whatever the type.
	for _, q := range []string{"?type=txt", "?type=txt&type=md&type=page"} {
		has("member flat"+q, memberTok, base+q, nil, []string{"secret.txt"})
	}
	// ...and the owner does see it, so the filter alone is not what hid it.
	has("owner flat type=txt", w.token, base+"?type=txt", []string{"secret.txt", "notes.txt"}, []string{"readme.md"})
}
