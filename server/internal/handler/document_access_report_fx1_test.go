package handler

import (
	"encoding/base64"
	"regexp"
	"strings"
	"testing"
)

var isoTime = regexp.MustCompile(`\d{4}-\d{2}-\d{2}T\d{2}:`)

// UNI-2039 fx1 F2: the cursor is ids and scope only. A page that scans
// candidates the caller cannot read ends on one of them; its title and change
// time must not travel in the cursor.
func TestAccessReportCursorLeaksNoTitleOrTime(t *testing.T) {
	w := newDocsWorld(t)
	memberToken, _ := docsJoinWorkspace(t, w, "ar-fx1-member@example.com")
	const secret = "Lương Q4 mật"
	for i := 0; i < 12; i++ {
		docsCreatePageBody(t, w, w.token, map[string]any{"title": secret + " " + string(rune('a'+i)), "kind": "page", "visibility": "restricted"})
	}
	base := "/api/v1/workspaces/" + w.wsID + "/documents/access-report"

	for _, sort := range []string{"title", "changed"} {
		cursors := 0
		url := base + "?sort=" + sort + "&limit=1"
		for page := 0; page < 20; page++ {
			res, out := doJSON(t, w.srv, "GET", url, memberToken, nil)
			if res.StatusCode != 200 {
				t.Fatalf("%s page %d: %d %v", sort, page, res.StatusCode, out)
			}
			if n := len(accessReportDocIDs(t, out)); n != 0 {
				t.Fatalf("%s: a member who manages nothing lists %d documents", sort, n)
			}
			cursor, _ := out["next_cursor"].(string)
			if cursor == "" {
				break
			}
			cursors++
			raw, err := base64.RawURLEncoding.DecodeString(cursor)
			if err != nil {
				t.Fatal(err)
			}
			for _, leak := range []string{"Lương", "mật", `"k"`} {
				if strings.Contains(string(raw), leak) {
					t.Fatalf("%s: cursor %s carries %q", sort, raw, leak)
				}
			}
			if isoTime.Match(raw) {
				t.Fatalf("%s: cursor %s carries a time", sort, raw)
			}
			url = base + "?sort=" + sort + "&limit=1&cursor=" + cursor
		}
		if cursors == 0 {
			t.Fatalf("%s: the scan bound never produced a cursor, the test proves nothing", sort)
		}
	}
}

// A cursor whose anchor document is gone answers 400, so the client restarts.
func TestAccessReportCursorOfAGoneAnchorIs400(t *testing.T) {
	w := newDocsWorld(t)
	docsCreatePageBody(t, w, w.token, map[string]any{"title": "Một", "kind": "page"})
	docsCreatePageBody(t, w, w.token, map[string]any{"title": "Hai", "kind": "page"})
	base := "/api/v1/workspaces/" + w.wsID + "/documents/access-report"
	for _, sort := range []string{"title", "changed"} {
		_, out := doJSON(t, w.srv, "GET", base+"?sort="+sort+"&limit=1", w.token, nil)
		cursor, _ := out["next_cursor"].(string)
		if cursor == "" {
			t.Fatalf("%s: no cursor: %v", sort, out)
		}
		raw, _ := base64.RawURLEncoding.DecodeString(cursor)
		gone := strings.Replace(string(raw), `"id":"`, `"id":"01GONE`, 1)
		forged := base64.RawURLEncoding.EncodeToString([]byte(gone))
		res, out := doJSON(t, w.srv, "GET", base+"?sort="+sort+"&limit=1&cursor="+forged, w.token, nil)
		code, _ := errCodeClass(out)
		if res.StatusCode != 400 || code != "invalid_request" {
			t.Errorf("%s: gone anchor: %d %v, want 400 invalid_request", sort, res.StatusCode, out)
		}
	}
}
