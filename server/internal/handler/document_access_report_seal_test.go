package handler

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/service"
)

// UNI-2039 L1: the access-report cursor is sealed with the server secret, so a
// caller cannot re-aim an anchor id (one a scan-bound cursor handed out, or a
// guessed one) at another sort, another scope or another account.

// accessReportFirstCursor reads the first page of the report and returns the
// cursor it hands out.
func accessReportFirstCursor(t *testing.T, w *docsWorld, token, query string) string {
	t.Helper()
	base := "/api/v1/workspaces/" + w.wsID + "/documents/access-report"
	res, out := doJSON(t, w.srv, "GET", base+"?"+query, token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("first page %q: %d %v", query, res.StatusCode, out)
	}
	cursor, _ := out["next_cursor"].(string)
	if cursor == "" {
		t.Fatalf("first page %q: no next_cursor: %v", query, out)
	}
	return cursor
}

func accessReportCursorStatus(t *testing.T, w *docsWorld, token, query, cursor string) int {
	t.Helper()
	base := "/api/v1/workspaces/" + w.wsID + "/documents/access-report"
	res, out := doJSON(t, w.srv, "GET", base+"?"+query+"&cursor="+cursor, token, nil)
	if res.StatusCode == 400 {
		if code, _ := errCodeClass(out); code != "invalid_request" {
			t.Fatalf("cursor refusal is %v, want the same invalid_request as before", out)
		}
	}
	return res.StatusCode
}

// accessReportPayload opens the JSON part of a sealed cursor (prefix.payload.signature);
// for a plain old-style cursor it is the whole token.
func accessReportPayload(t *testing.T, cursor string) map[string]any {
	t.Helper()
	body := cursor
	if rest, ok := strings.CutPrefix(cursor, "acr1."); ok {
		body, _, _ = strings.Cut(rest, ".")
	}
	raw, err := base64.RawURLEncoding.DecodeString(body)
	if err != nil {
		t.Fatalf("cursor payload is not base64: %v", err)
	}
	var claims map[string]any
	if err := json.Unmarshal(raw, &claims); err != nil {
		t.Fatalf("cursor payload is not JSON: %v", err)
	}
	return claims
}

func TestAccessReportCursorIsSealed(t *testing.T) {
	w := newDocsWorld(t)
	for _, title := range []string{"Một", "Hai", "Ba", "Bốn"} {
		docsCreatePageBody(t, w, w.token, map[string]any{"title": title, "kind": "page"})
	}
	const query = "sort=title&limit=1"
	cursor := accessReportFirstCursor(t, w, w.token, query)

	if got := accessReportCursorStatus(t, w, w.token, query, cursor); got != 200 {
		t.Fatalf("the cursor the server just minted answers %d, want 200", got)
	}

	// A token an attacker re-encodes by hand, with a real anchor id and the
	// right scope fields, is the pre-seal format: refused.
	claims := accessReportPayload(t, cursor)
	rawID, _ := claims["id"].(string)
	if rawID == "" {
		t.Fatalf("payload has no id: %v", claims)
	}
	forged, _ := json.Marshal(claims)
	if got := accessReportCursorStatus(t, w, w.token, query, base64.RawURLEncoding.EncodeToString(forged)); got != 400 {
		t.Errorf("re-encoded old-style token with a real anchor id: %d, want 400", got)
	}

	// Another anchor id inside an otherwise valid token: the signature no
	// longer matches.
	claims["id"] = "01FORGEDANCHOR000000000000"
	if body, ok := strings.CutPrefix(cursor, "acr1."); ok {
		_, sig, _ := strings.Cut(body, ".")
		swapped, _ := json.Marshal(claims)
		reforged := "acr1." + base64.RawURLEncoding.EncodeToString(swapped) + "." + sig
		if got := accessReportCursorStatus(t, w, w.token, query, reforged); got != 400 {
			t.Errorf("valid signature over another payload: %d, want 400", got)
		}
	}

	// One byte flipped anywhere in a valid cursor.
	for i := 0; i < len(cursor); i += 7 {
		flipped := []byte(cursor)
		if flipped[i] == 'A' {
			flipped[i] = 'B'
		} else {
			flipped[i] = 'A'
		}
		if got := accessReportCursorStatus(t, w, w.token, query, string(flipped)); got != 400 {
			t.Fatalf("cursor with byte %d flipped: %d, want 400", i, got)
		}
	}

	// Truncated and unsigned.
	for _, bad := range []string{cursor[:len(cursor)-4], cursor[:len(cursor)/2], "acr1.", "acr1..", "acr1.e30."} {
		if got := accessReportCursorStatus(t, w, w.token, query, bad); got != 400 {
			t.Errorf("truncated or unsigned %q: %d, want 400", bad, got)
		}
	}
}

// A cursor minted for one account is refused for another, even when both
// manage the same scope.
func TestAccessReportCursorIsBoundToTheCaller(t *testing.T) {
	w := newDocsWorld(t)
	adminToken, _ := docsJoinWorkspaceAs(t, w, "ar-seal-admin@example.com", "admin")
	for _, title := range []string{"Một", "Hai", "Ba"} {
		docsCreatePageBody(t, w, w.token, map[string]any{"title": title, "kind": "page"})
	}
	const query = "sort=title&limit=1"
	cursor := accessReportFirstCursor(t, w, w.token, query)

	if got := accessReportCursorStatus(t, w, w.token, query, cursor); got != 200 {
		t.Fatalf("minter replays its own cursor: %d, want 200", got)
	}
	if got := accessReportCursorStatus(t, w, adminToken, query, cursor); got != 400 {
		t.Errorf("cursor of user A replayed by user B: %d, want 400", got)
	}
}

// A cursor from one scope or sort never continues another report.
func TestAccessReportCursorIsBoundToTheScope(t *testing.T) {
	w := newDocsWorld(t)
	_, folderID := docsCreatePageBody(t, w, w.token, map[string]any{"title": "Thư mục", "kind": "folder"})
	for _, title := range []string{"Một", "Hai", "Ba"} {
		docsCreatePageBody(t, w, w.token, map[string]any{"title": title, "kind": "page", "parent_id": folderID})
	}
	cursor := accessReportFirstCursor(t, w, w.token, "sort=title&limit=1&folder_id="+folderID)

	if got := accessReportCursorStatus(t, w, w.token, "sort=title&limit=1&folder_id="+folderID, cursor); got != 200 {
		t.Fatalf("the cursor under its own scope: %d, want 200", got)
	}
	for what, query := range map[string]string{
		"workspace scope instead of the folder": "sort=title&limit=1",
		"another sort":                          "sort=changed&limit=1&folder_id=" + folderID,
		"another order":                         "sort=title&order=desc&limit=1&folder_id=" + folderID,
		"another filter":                        "sort=title&limit=1&level=manage&folder_id=" + folderID,
	} {
		if got := accessReportCursorStatus(t, w, w.token, query, cursor); got != 400 {
			t.Errorf("%s: %d, want 400", what, got)
		}
	}
}

// Normal paging over three pages still walks every document once.
func TestAccessReportSealedCursorPagesThrough(t *testing.T) {
	w := newDocsWorld(t)
	for _, title := range []string{"Một", "Hai", "Ba"} {
		docsCreatePageBody(t, w, w.token, map[string]any{"title": title, "kind": "page"})
	}
	base := "/api/v1/workspaces/" + w.wsID + "/documents/access-report?sort=title&limit=1"
	url := base
	seen := map[string]bool{}
	pages := 0
	for ; pages < 10; pages++ {
		res, out := doJSON(t, w.srv, "GET", url, w.token, nil)
		if res.StatusCode != 200 {
			t.Fatalf("page %d: %d %v", pages, res.StatusCode, out)
		}
		for _, id := range accessReportDocIDs(t, out) {
			seen[id] = true
		}
		cursor, _ := out["next_cursor"].(string)
		if cursor == "" {
			pages++
			break
		}
		url = base + "&cursor=" + cursor
	}
	if len(seen) != 3 || pages < 3 {
		t.Fatalf("walked %d pages and saw %d documents, want 3 pages and 3 documents", pages, len(seen))
	}
}

// The cursor carries the workspace and the caller it was minted for; a token
// replayed under another workspace, another account or another secret is
// refused, and the matching triple is accepted (the control).
func TestAccessReportCursorIsBoundToTheWorkspaceClaim(t *testing.T) {
	in := service.DocumentAccessReportQuery{Sort: "title"}
	own := accessReportCursor{Workspace: "W1", User: "U1"}
	mint := encodeAccessReportCursor("s", newAccessReportCursor(own, in, service.AccessReportKey{ID: "A1"}))
	if key, ok := decodeAccessReportCursor("s", mint, newAccessReportCursor(own, in, service.AccessReportKey{})); !ok || key == nil || key.ID != "A1" {
		t.Fatalf("matching workspace, user and secret refused: %v %v", key, ok)
	}
	for name, want := range map[string]accessReportCursor{
		"other workspace": {Workspace: "W2", User: "U1"},
		"other user":      {Workspace: "W1", User: "U2"},
	} {
		if _, ok := decodeAccessReportCursor("s", mint, newAccessReportCursor(want, in, service.AccessReportKey{})); ok {
			t.Errorf("%s accepted", name)
		}
	}
	if _, ok := decodeAccessReportCursor("s2", mint, newAccessReportCursor(own, in, service.AccessReportKey{})); ok {
		t.Error("another secret accepted")
	}
}
