package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// UNI-2039: the access report redesign on the wire - spec, query parsing,
// cursor guard, the revoke proof and tenant isolation of the new reads.

func TestAccessReportRedesignRoutesAndSDOOnTheSpec(t *testing.T) {
	h := New(Deps{Cfg: config.Config{FrontendOrigin: "http://localhost:3000", EnableSwagger: true}})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/swagger/doc.json", nil))
	var spec struct {
		Paths map[string]struct {
			Get *struct {
				Parameters []struct {
					Name string `json:"name"`
				} `json:"parameters"`
				Responses map[string]json.RawMessage `json:"responses"`
			} `json:"get"`
		} `json:"paths"`
		Components struct {
			Schemas map[string]struct {
				Properties map[string]json.RawMessage `json:"properties"`
			} `json:"schemas"`
		} `json:"components"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &spec); err != nil {
		t.Fatal(err)
	}
	const base = "/api/v1/workspaces/{workspaceID}/documents/access-report"
	s5 := []string{"q", "principal", "scope", "source", "flag", "non_default"}
	for path, params := range map[string][]string{
		base:                 append([]string{"sort", "order"}, s5...),
		base + "/export":     s5,
		base + "/summary":    append([]string{"folder_id", "person_id", "level", "visibility"}, s5...),
		base + "/principals": {"folder_id", "q", "kind", "level", "sort", "order"},
	} {
		item, ok := spec.Paths[path]
		if !ok || item.Get == nil {
			t.Errorf("GET %s is missing from the spec", path)
			continue
		}
		have := map[string]bool{}
		for _, p := range item.Get.Parameters {
			have[p.Name] = true
		}
		for _, p := range params {
			if !have[p] {
				t.Errorf("GET %s is missing the %s parameter", path, p)
			}
		}
		if _, ok := item.Get.Responses["200"]; !ok && path != base+"/export" {
			t.Errorf("GET %s is missing the 200 response", path)
		}
	}
	for schemaName, fields := range map[string][]string{
		"SdoDocumentAccessReportDocumentInfoDTO": {"general_scope", "flags", "access_changed_at", "my_level", "admin_scope"},
		"SdoDocumentAccessReportRowDTO":          {"revoke_target", "origin", "expires_at"},
		"SdoDocumentAccessReportGeneralScopeDTO": {"kind", "level"},
		"SdoDocumentAccessReportRevokeTargetDTO": {"kind", "id"},
		"SdoDocumentAccessReportFilterDTO":       {"sort", "order", "q", "principal", "scope", "source", "flag", "non_default"},
		"SdoDocumentAccessReportSummaryResultSDO": {
			"generated_at", "tiles", "matching_documents", "skipped", "truncated",
		},
		"SdoDocumentAccessReportTilesDTO": {
			"public_link", "outside_workspace", "direct_manage", "documents", "restricted", "workspace", "organization",
		},
		"SdoDocumentAccessReportPrincipalsSDO": {"generated_at", "principals", "truncated"},
		"SdoDocumentAccessReportPrincipalDTO": {
			"principal_type", "principal_id", "principal_name", "kind", "member_count", "document_count", "levels", "main_source",
		},
		"SdoDocumentAccessReportLevelSplitDTO": {"view", "comment", "edit", "manage"},
	} {
		schema, ok := spec.Components.Schemas[schemaName]
		if !ok {
			t.Errorf("schema %s is missing from the spec", schemaName)
			continue
		}
		for _, field := range fields {
			if _, ok := schema.Properties[field]; !ok {
				t.Errorf("%s is missing %s", schemaName, field)
			}
		}
	}
}

func TestAccessReportRedesignHandlerParamsAndCursor(t *testing.T) {
	w := newDocsWorld(t)
	for _, title := range []string{"Một", "Hai", "Ba"} {
		docsCreatePageBody(t, w, w.token, map[string]any{"title": title, "kind": "page"})
	}
	base := "/api/v1/workspaces/" + w.wsID + "/documents/access-report"

	// The new fields are on the wire for a plain document.
	res, out := doJSON(t, w.srv, "GET", base+"?sort=title&order=asc&limit=2", w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("page: %d %v", res.StatusCode, out)
	}
	titles := []string{}
	for _, d := range out["documents"].([]any) {
		doc := d.(map[string]any)["document"].(map[string]any)
		titles = append(titles, doc["title"].(string))
		if gs, _ := doc["general_scope"].(map[string]any); gs == nil || gs["kind"] == nil {
			t.Fatalf("general_scope = %v", doc["general_scope"])
		}
		if _, ok := doc["flags"].([]any); !ok {
			t.Fatalf("flags = %v", doc["flags"])
		}
		if doc["access_changed_at"] == "" || doc["my_level"] != "manage" || doc["admin_scope"] != false {
			t.Fatalf("document block = %v", doc)
		}
		for _, r := range d.(map[string]any)["rows"].([]any) {
			if row := r.(map[string]any); row["source"] == "acl_owner" && row["revoke_target"] != nil {
				t.Fatalf("the owner row has a revoke target: %v", row)
			}
		}
	}
	if strings.Join(titles, ",") != "Ba,Hai" {
		t.Fatalf("title asc page 1 = %v", titles)
	}
	if f := out["filter"].(map[string]any); f["sort"] != "title" || f["order"] != "asc" || f["non_default"] != false {
		t.Fatalf("filter echo = %v", f)
	}
	cursor, _ := out["next_cursor"].(string)
	if cursor == "" {
		t.Fatalf("a full page carries a cursor: %v", out)
	}
	res, out = doJSON(t, w.srv, "GET", base+"?sort=title&order=asc&limit=2&cursor="+cursor, w.token, nil)
	if res.StatusCode != 200 || len(accessReportDocIDs(t, out)) != 1 || out["next_cursor"] != nil {
		t.Fatalf("page 2: %d %v", res.StatusCode, out)
	}

	for name, query := range map[string]string{
		"cursor of another sort":      "?cursor=" + cursor,
		"cursor of another order":     "?sort=title&order=desc&cursor=" + cursor,
		"cursor of another filter":    "?sort=title&order=asc&q=Ba&cursor=" + cursor,
		"cursor of another scope":     "?sort=title&order=asc&scope=restricted&cursor=" + cursor,
		"cursor of another source":    "?sort=title&order=asc&source=direct&cursor=" + cursor,
		"cursor of another flag":      "?sort=title&order=asc&flag=public_link&cursor=" + cursor,
		"cursor of non_default":       "?sort=title&order=asc&non_default=1&cursor=" + cursor,
		"cursor of another principal": "?sort=title&order=asc&principal=link&cursor=" + cursor,
		"bad sort":                    "?sort=updated",
		"bad order":                   "?order=sideways",
		"bad scope":                   "?scope=public",
		"bad source":                  "?source=email",
		"bad flag":                    "?flag=shiny",
		"bad non_default":             "?non_default=maybe",
		"bad principal type":          "?principal=group:1",
		"principal without id":        "?principal=workspace",
		"principal user without id":   "?principal=user:",
		"principal vs person_id":      "?principal=user:a&person_id=b",
		"q over 100":                  "?q=" + strings.Repeat("a", 101),
	} {
		res, out := doJSON(t, w.srv, "GET", base+query, w.token, nil)
		code, _ := errCodeClass(out)
		if res.StatusCode != 400 || code != "invalid_request" {
			t.Errorf("%s: %d %v, want 400 invalid_request", name, res.StatusCode, out)
		}
		if strings.Contains(name, "cursor") {
			continue // summary has no cursor
		}
		res, out = doJSON(t, w.srv, "GET", base+"/summary"+query, w.token, nil)
		if res.StatusCode != 400 {
			t.Errorf("summary %s: %d %v, want 400", name, res.StatusCode, out)
		}
	}
	// principal=user:<id> and person_id name the same filter.
	res, out = doJSON(t, w.srv, "GET", base+"?principal=user:"+w.userID, w.token, nil)
	if res.StatusCode != 200 || out["filter"].(map[string]any)["person_id"] != w.userID || out["filter"].(map[string]any)["principal"] != "user:"+w.userID {
		t.Fatalf("principal=user: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "GET", base+"?person_id="+w.userID+"&principal=user:"+w.userID, w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("matching person_id and principal: %d %v", res.StatusCode, out)
	}

	// Summary and principals answer their shapes; their own 400s.
	res, out = doJSON(t, w.srv, "GET", base+"/summary", w.token, nil)
	tiles, _ := out["tiles"].(map[string]any)
	if res.StatusCode != 200 || tiles == nil || tiles["documents"] != float64(3) || out["matching_documents"] != float64(3) ||
		out["skipped"] != float64(0) || out["truncated"] != false || out["generated_at"] == "" {
		t.Fatalf("summary: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "GET", base+"/principals?kind=member", w.token, nil)
	ps, _ := out["principals"].([]any)
	if res.StatusCode != 200 || len(ps) != 1 || ps[0].(map[string]any)["document_count"] != float64(3) ||
		ps[0].(map[string]any)["main_source"] != "owner" || out["truncated"] != false {
		t.Fatalf("principals: %d %v", res.StatusCode, out)
	}
	for _, query := range []string{"?kind=bot", "?sort=updated", "?order=up", "?level=owner", "?q=" + strings.Repeat("a", 101)} {
		res, out = doJSON(t, w.srv, "GET", base+"/principals"+query, w.token, nil)
		if res.StatusCode != 400 {
			t.Errorf("principals %s: %d %v, want 400", query, res.StatusCode, out)
		}
	}
	for _, path := range []string{"/summary", "/principals"} {
		res, out = doJSON(t, w.srv, "GET", base+path, w.outsider, nil)
		if res.StatusCode != 403 && res.StatusCode != 404 {
			t.Errorf("outsider %s: %d %v", path, res.StatusCode, out)
		}
	}
}

// accessReportRows reads the report page and indexes the rows of one document
// by revoke_target kind (and the whole row list).
func accessReportRows(t *testing.T, w *docsWorld, token, docID string) []map[string]any {
	t.Helper()
	res, out := doJSON(t, w.srv, "GET", "/api/v1/workspaces/"+w.wsID+"/documents/access-report", token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("report: %d %v", res.StatusCode, out)
	}
	for _, d := range out["documents"].([]any) {
		item := d.(map[string]any)
		if item["document"].(map[string]any)["id"] == docID {
			var rows []map[string]any
			for _, r := range item["rows"].([]any) {
				rows = append(rows, r.(map[string]any))
			}
			return rows
		}
	}
	t.Fatalf("document %s is not in the report: %v", docID, out)
	return nil
}

func revokeTargetOf(rows []map[string]any, kind string) (id string, row map[string]any) {
	for _, r := range rows {
		if rt, _ := r["revoke_target"].(map[string]any); rt != nil && rt["kind"] == kind {
			return rt["id"].(string), r
		}
	}
	return "", nil
}

// The revoke proof: the report hands out the id of the existing DELETE route;
// calling it ends the row, and exactly one audit row says so. No new route,
// no new command.
func TestAccessReportRevokeTargetsDriveTheExistingRoutes(t *testing.T) {
	w := newDocsWorld(t)
	ctx := context.Background()
	q := db.New(testPool)
	memberToken, memberID := docsJoinWorkspace(t, w, "ar-revoke-member@example.com")
	_, docID := docsCreatePageBody(t, w, w.token, map[string]any{"title": "Thu hồi", "kind": "page"})

	shareID := util.NewID()
	if _, err := q.InsertDocumentShare(ctx, db.InsertDocumentShareParams{
		ID: shareID, OrganizationID: w.orgID, WorkspaceID: w.wsID, DocumentID: docID,
		PrincipalType: "user", PrincipalID: memberID, Level: "view", GrantedBy: w.userID, GrantedByKind: "human",
	}); err != nil {
		t.Fatal(err)
	}
	linkID := util.NewID()
	if _, err := q.InsertDocumentShareLink(ctx, db.InsertDocumentShareLinkParams{
		ID: linkID, OrganizationID: w.orgID, WorkspaceID: w.wsID, DocumentID: docID, TokenHash: util.NewID(),
		ExpiresAt: pgtype.Timestamptz{Time: time.Now().Add(24 * time.Hour), Valid: true}, CreatedBy: w.userID, CreatedByKind: "human",
	}); err != nil {
		t.Fatal(err)
	}
	grantID := util.NewID()
	if _, err := testPool.Exec(ctx, `INSERT INTO document_break_glass_grants
		(id, organization_id, workspace_id, document_id, actor_id, actor_kind, level, reason, expires_at)
		VALUES ($1, $2, $3, $4, $5, 'human', 'view', 'kiểm tra hợp đồng khẩn', now() + interval '1 hour')`,
		grantID, w.orgID, w.wsID, docID, memberID); err != nil {
		t.Fatal(err)
	}

	rows := accessReportRows(t, w, w.token, docID)
	for kind, want := range map[string]string{"share": shareID, "link": linkID, "break_glass": grantID} {
		if got, _ := revokeTargetOf(rows, kind); got != want {
			t.Fatalf("revoke_target %s = %q, want %q (rows %v)", kind, got, want, rows)
		}
	}
	// A viewer for whom nothing can be revoked is refused by the route itself.
	res, out := doJSON(t, w.srv, "DELETE", "/api/v1/documents/"+docID+"/shares/"+shareID, memberToken, nil)
	if res.StatusCode != 403 && res.StatusCode != 404 {
		t.Fatalf("a non-manager revoking: %d %v", res.StatusCode, out)
	}
	if id, _ := revokeTargetOf(accessReportRows(t, w, w.token, docID), "share"); id != shareID {
		t.Fatal("the refused revoke changed the share")
	}

	for _, c := range []struct{ kind, route, action, key string }{
		{"share", "shares", "document.share_revoked", "share_id"},
		{"link", "links", "document.link_revoked", "link_id"},
		{"break_glass", "break-glass", "document.break_glass_revoked", "grant_id"},
	} {
		id, _ := revokeTargetOf(accessReportRows(t, w, w.token, docID), c.kind)
		res, out := doJSON(t, w.srv, "DELETE", "/api/v1/documents/"+docID+"/"+c.route+"/"+id, w.token, nil)
		if res.StatusCode >= 300 {
			t.Fatalf("revoke %s: %d %v", c.kind, res.StatusCode, out)
		}
		if gone, _ := revokeTargetOf(accessReportRows(t, w, w.token, docID), c.kind); gone != "" {
			t.Errorf("the %s row is still on the report after the revoke", c.kind)
		}
		var n int
		if err := testPool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE action = $1 AND resource_id = $2 AND metadata::jsonb->>$3 = $4`,
			c.action, docID, c.key, id).Scan(&n); err != nil || n != 1 {
			t.Errorf("%s audit rows for %s = %d (%v), want exactly 1", c.action, id, n, err)
		}
	}
}

// Org B's owner asks about org A's person and A's member name through every
// read: nothing of A's comes back. The request's own echo (the filter block of
// the page) is B's input, not A's data, and is left out of the comparison.
func TestAccessReportRedesignIsolatesTheTenants(t *testing.T) {
	w := newDocsWorld(t)
	ctx := context.Background()
	_, memberID := docsJoinWorkspace(t, w, "ar-iso-member@example.com")
	const aName = "Nguyễn Văn Cách-Ly"
	if _, err := testPool.Exec(ctx, `UPDATE users SET display_name = $2 WHERE id = $1`, memberID, aName); err != nil {
		t.Fatal(err)
	}
	_, aDoc := docsCreatePageBody(t, w, w.token, map[string]any{"title": "Tài liệu của A", "kind": "page"})
	if _, err := db.New(testPool).InsertDocumentShare(ctx, db.InsertDocumentShareParams{
		ID: util.NewID(), OrganizationID: w.orgID, WorkspaceID: w.wsID, DocumentID: aDoc,
		PrincipalType: "user", PrincipalID: memberID, Level: "view", GrantedBy: w.userID, GrantedByKind: "human",
	}); err != nil {
		t.Fatal(err)
	}

	bToken, _ := filesRegister(t, w.srv, "ar-iso-b@example.com")
	res, out := doJSON(t, w.srv, "POST", "/api/v1/orgs", bToken, map[string]string{"name": "Org B", "slug": "iso-org-b"})
	if res.StatusCode != 201 {
		t.Fatalf("org B: %d %v", res.StatusCode, out)
	}
	bOrg := out["organization"].(map[string]any)["id"].(string)
	res, out = doJSON(t, w.srv, "POST", "/api/v1/orgs/"+bOrg+"/workspaces", bToken, map[string]string{"name": "WS B", "slug": "iso-ws-b"})
	if res.StatusCode != 201 {
		t.Fatalf("workspace B: %d %v", res.StatusCode, out)
	}
	bWS := out["workspace"].(map[string]any)["id"].(string)
	res, out = doJSON(t, w.srv, "POST", "/api/v1/workspaces/"+bWS+"/documents", bToken, map[string]any{"title": "Tài liệu của B", "kind": "page"})
	if res.StatusCode != 201 {
		t.Fatalf("B document: %d %v", res.StatusCode, out)
	}

	base := "/api/v1/workspaces/" + bWS + "/documents/access-report"
	for _, query := range []string{
		"?principal=" + url.QueryEscape("user:"+memberID),
		"?person_id=" + memberID,
		"?q=" + url.QueryEscape(aName),
		"?q=" + url.QueryEscape("cách-ly"),
		"?principal=" + url.QueryEscape("workspace:"+w.wsID),
	} {
		for _, path := range []string{"", "/summary", "/principals", "/export"} {
			q := query
			if path == "/export" {
				q += "&format=csv"
			}
			if path == "/principals" && (strings.HasPrefix(query, "?principal") || strings.HasPrefix(query, "?person")) {
				q = "" // principals has no principal filter; the plain read is the control
			}
			req, _ := http.NewRequest("GET", w.srv.URL+base+path+q, nil)
			req.Header.Set("Authorization", "Bearer "+bToken)
			resp, err := w.srv.Client().Do(req)
			if err != nil {
				t.Fatal(err)
			}
			body, _ := readAll(resp)
			text := string(body)
			if path == "" && resp.StatusCode == 200 {
				var page map[string]any
				if err := json.Unmarshal(body, &page); err != nil {
					t.Fatal(err)
				}
				delete(page, "filter") // B's own request, echoed
				clean, _ := json.Marshal(page)
				text = string(clean)
				if docs, _ := page["documents"].([]any); len(docs) != 0 {
					t.Errorf("%s: B's report lists %d documents for A's person or name", query, len(docs))
				}
			}
			if resp.StatusCode >= 500 {
				t.Errorf("%s%s: %d", path, q, resp.StatusCode)
			}
			for _, secret := range []string{memberID, aName, "Tài liệu của A", aDoc, w.wsID, w.orgID} {
				if strings.Contains(text, secret) {
					t.Errorf("%s%s leaks %q: %s", path, q, secret, text)
				}
			}
		}
	}
}

// Amendment 1 (lead): lists are `[]`, never null; revoke_target is null (not
// a zero struct) when a row cannot be revoked; person_id and principal=user:
// are one filter, down to the cursor.
func TestAccessReportAmendment1WireShapes(t *testing.T) {
	w := newDocsWorld(t)
	base := "/api/v1/workspaces/" + w.wsID + "/documents/access-report"

	// An empty workspace: every list is an empty array.
	for _, path := range []string{"", "/principals"} {
		res, out := doJSON(t, w.srv, "GET", base+path, w.token, nil)
		if res.StatusCode != 200 {
			t.Fatalf("empty %q: %d %v", path, res.StatusCode, out)
		}
		key := "documents"
		if path != "" {
			key = "principals"
		}
		if list, ok := out[key].([]any); !ok || len(list) != 0 {
			t.Fatalf("empty workspace %s = %#v, want []", key, out[key])
		}
	}
	res, out := doJSON(t, w.srv, "GET", base, w.token, nil)
	if f := out["filter"].(map[string]any); res.StatusCode != 200 {
		t.Fatal(out)
	} else if _, ok := f["level"].([]any); !ok {
		t.Fatalf("filter.level = %#v, want []", f["level"])
	} else if _, ok := f["source"].([]any); !ok {
		t.Fatalf("filter.source = %#v, want []", f["source"])
	}

	for _, title := range []string{"Một", "Hai", "Ba"} {
		docsCreatePageBody(t, w, w.token, map[string]any{"title": title, "kind": "page"})
	}
	res, out = doJSON(t, w.srv, "GET", base+"?limit=2&person_id="+w.userID, w.token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("page: %d %v", res.StatusCode, out)
	}
	for _, d := range out["documents"].([]any) {
		item := d.(map[string]any)
		doc := item["document"].(map[string]any)
		for _, key := range []string{"path", "flags"} {
			if list, ok := doc[key].([]any); !ok || (key == "flags" && len(list) != 0) {
				t.Fatalf("document.%s = %#v, want []", key, doc[key])
			}
		}
		rows, ok := item["rows"].([]any)
		if !ok || len(rows) == 0 {
			t.Fatalf("rows = %#v", item["rows"])
		}
		for _, r := range rows {
			row := r.(map[string]any)
			rt, present := row["revoke_target"]
			if !present || rt != nil {
				t.Fatalf("row %v: revoke_target = %#v, want a present JSON null", row["source"], rt)
			}
		}
	}

	// person_id and principal=user:<id> are one filter: the cursor of one
	// continues with the other.
	cursor, _ := out["next_cursor"].(string)
	if cursor == "" {
		t.Fatalf("no cursor: %v", out)
	}
	res, out = doJSON(t, w.srv, "GET", base+"?limit=2&principal=user:"+w.userID+"&cursor="+cursor, w.token, nil)
	if res.StatusCode != 200 || len(accessReportDocIDs(t, out)) != 1 {
		t.Fatalf("cursor across the alias: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, w.srv, "GET", base+"?principal=user:"+w.userID+"&person_id=someone-else", w.token, nil)
	if code, _ := errCodeClass(out); res.StatusCode != 400 || code != "invalid_request" {
		t.Fatalf("disagreeing alias: %d %v", res.StatusCode, out)
	}
}
