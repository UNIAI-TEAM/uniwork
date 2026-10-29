package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func setMeetingMinutesFlag(t *testing.T, scopeType, scopeID string, on bool) {
	t.Helper()
	if _, err := db.New(testPool).UpsertFlagOverride(context.Background(), db.UpsertFlagOverrideParams{
		ID: util.NewID(), FlagKey: "meeting_minutes", ScopeType: scopeType, ScopeID: scopeID,
		Enabled: on, Note: "meeting minutes test", CreatedBy: "test",
	}); err != nil {
		t.Fatal(err)
	}
	if testFlagOverrides != nil {
		testFlagOverrides.Invalidate()
	}
}

func TestMeetingMinutesHTTP(t *testing.T) {
	d, pool := newTestDeps(t, nil, discardOutbox{})
	d.Documents = service.NewDocumentService(pool, db.New(pool), d.Organizations, d.Workspaces)
	d.Meetings.Docs = d.Documents
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)

	host, _ := registerChatUser(t, srv, "min-host@example.com", "Host")
	_, out := doJSON(t, srv, "POST", "/api/v1/orgs", host, map[string]string{"name": "Org", "slug": "min-org"})
	orgID := out["organization"].(map[string]any)["id"].(string)
	_, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+orgID+"/workspaces", host, map[string]string{"name": "WS", "slug": "min-ws"})
	wsID := out["workspace"].(map[string]any)["id"].(string)
	member, _ := docsJoinWorkspace(t, &docsWorld{srv: srv, token: host, wsID: wsID}, "min-member@example.com")
	_, out = doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/meetings/instant", host, map[string]string{"title": "Giao ban"})
	meetingID := out["meeting"].(map[string]any)["id"].(string)
	base := "/api/v1/meetings/" + meetingID + "/minutes"

	// Another organization with a meeting of its own.
	other, _ := registerChatUser(t, srv, "min-other@example.com", "Other")
	_, out = doJSON(t, srv, "POST", "/api/v1/orgs", other, map[string]string{"name": "Other", "slug": "min-other"})
	otherOrg := out["organization"].(map[string]any)["id"].(string)
	_, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+otherOrg+"/workspaces", other, map[string]string{"name": "WS", "slug": "min-other-ws"})
	otherWS := out["workspace"].(map[string]any)["id"].(string)
	_, out = doJSON(t, srv, "POST", "/api/v1/workspaces/"+otherWS+"/meetings/instant", other, map[string]string{"title": "Khác"})
	otherBase := "/api/v1/meetings/" + out["meeting"].(map[string]any)["id"].(string) + "/minutes"

	setMeetingMinutesFlag(t, featureflags.ScopeGlobal, "", false)
	res, out := doJSON(t, srv, "GET", base, member, nil)
	if res.StatusCode != http.StatusNotFound || errorCode(out) != "feature_disabled" {
		t.Fatalf("flag off: %d %v", res.StatusCode, out)
	}
	// An organization override opens the routes for that organization only.
	setMeetingMinutesFlag(t, featureflags.ScopeOrganization, orgID, true)
	if res, out = doJSON(t, srv, "GET", otherBase, other, nil); res.StatusCode != http.StatusNotFound || errorCode(out) != "feature_disabled" {
		t.Fatalf("another organization with the override on elsewhere: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "GET", base, member, nil)
	if res.StatusCode != http.StatusOK || out["minutes"] != nil {
		t.Fatalf("no minutes yet: %d %v", res.StatusCode, out)
	}
	if res, out = doJSON(t, srv, "POST", base, host, nil); res.StatusCode != http.StatusConflict || errorCode(out) != "invalid_meeting_state" {
		t.Fatalf("minutes of a live meeting: %d %v", res.StatusCode, out)
	}
	if res, out = doJSON(t, srv, "POST", "/api/v1/meetings/"+meetingID+"/end", host, nil); res.StatusCode != http.StatusOK {
		t.Fatalf("end: %d %v", res.StatusCode, out)
	}
	if res, out = doJSON(t, srv, "POST", base, member, nil); res.StatusCode != http.StatusForbidden || errorCode(out) != "not_meeting_clerk" {
		t.Fatalf("member made minutes: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "POST", base, host, map[string]any{"locale": "en"})
	minutes, _ := out["minutes"].(map[string]any)
	if res.StatusCode != http.StatusOK || minutes["document_id"] == "" || minutes["finalized"] != false || minutes["can_edit"] != true {
		t.Fatalf("create: %d %v", res.StatusCode, out)
	}
	docID := minutes["document_id"].(string)
	_, out = doJSON(t, srv, "GET", "/api/v1/documents/"+docID, member, nil)
	if title, _ := out["document"].(map[string]any)["title"].(string); len(title) < 9 || title[:9] != "Minutes: " {
		t.Fatalf("member reads the page: %v", out)
	}

	// A draft takes a facts-only refresh, and says how many items are pending.
	res, out = doJSON(t, srv, "POST", base+"/refresh", host, nil)
	if minutes, _ = out["minutes"].(map[string]any); res.StatusCode != http.StatusOK || minutes["pending_items"] != float64(0) {
		t.Fatalf("refresh: %d %v", res.StatusCode, out)
	}
	if res, out = doJSON(t, srv, "POST", base+"/refresh", member, nil); res.StatusCode != http.StatusForbidden || errorCode(out) != "not_meeting_clerk" {
		t.Fatalf("member refreshed: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "POST", base+"/finalize", host, nil)
	minutes, _ = out["minutes"].(map[string]any)
	if res.StatusCode != http.StatusOK || minutes["finalized"] != true || minutes["finalized_version"] != float64(1) || minutes["finalized_version_id"] == nil {
		t.Fatalf("finalize: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "GET", base, member, nil)
	if minutes, _ = out["minutes"].(map[string]any); res.StatusCode != http.StatusOK || minutes["finalized"] != true || minutes["can_edit"] != false {
		t.Fatalf("member reads finalized minutes: %d %v", res.StatusCode, out)
	}
	if res, out = doJSON(t, srv, "POST", base+"/refresh", host, nil); res.StatusCode != http.StatusConflict || errorCode(out) != "minutes_finalized" {
		t.Fatalf("refresh of finalized minutes: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "POST", base+"/reopen", host, nil)
	if minutes, _ = out["minutes"].(map[string]any); res.StatusCode != http.StatusOK || minutes["finalized"] != false || minutes["finalized_at"] != nil {
		t.Fatalf("reopen: %d %v", res.StatusCode, out)
	}
}

// UNI-2288: meeting minutes appear in GET /workspaces/{wsID}/documents/sources
// (and ?source=meeting, ?type=page) with kind="page", document_id, and name =
// the meeting title; download, save and office/frame-token return 404 not_found
// on meeting:minutes:<id>; and GET/PATCH /documents/{id}, /documents/tree,
// /documents and /documents/shared-with-me carry minutes_meeting (with title
// omitted when the viewer is not a member of the meeting's workspace).
func TestMeetingMinutesDocumentSourceAndLabelHTTP(t *testing.T) {
	d, pool := newTestDeps(t, nil, discardOutbox{})
	q := db.New(pool)
	d.Documents = service.NewDocumentService(pool, q, d.Organizations, d.Workspaces)
	d.Meetings.Docs = d.Documents
	d.DocumentSources = service.NewDocumentSourceService(service.DocumentSourceDeps{
		Documents: d.Documents, Tasks: d.Tasks, Chat: d.Chat, Meetings: d.Meetings,
	})
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)

	host, _ := registerChatUser(t, srv, "min-src-host@example.com", "Host")
	_, out := doJSON(t, srv, "POST", "/api/v1/orgs", host, map[string]string{"name": "MinSrcOrg", "slug": "min-src-org"})
	orgID := out["organization"].(map[string]any)["id"].(string)
	_, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+orgID+"/workspaces", host, map[string]string{"name": "General", "slug": "general"})
	wsID := out["workspace"].(map[string]any)["id"].(string)
	member, _ := docsJoinWorkspace(t, &docsWorld{srv: srv, token: host, wsID: wsID}, "min-src-member@example.com")
	_, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+orgID+"/workspaces", host, map[string]string{"name": "Other", "slug": "other"})
	wsBID := out["workspace"].(map[string]any)["id"].(string)
	outsider, outsiderID := docsJoinWorkspace(t, &docsWorld{srv: srv, token: host, wsID: wsBID}, "min-src-out@example.com")

	setMeetingMinutesFlag(t, featureflags.ScopeOrganization, orgID, true)
	if _, err := pool.Exec(context.Background(), `INSERT INTO feature_flag_overrides
		(id, flag_key, scope_type, scope_id, enabled, note, created_by)
		VALUES ($1, 'documents', 'organization', $2, true, 'test', 'test')`, util.NewID(), orgID); err != nil {
		t.Fatal(err)
	}
	if testFlagOverrides != nil {
		testFlagOverrides.Invalidate()
	}
	var res *http.Response
	// Create & end meeting, then create minutes.
	res, out = doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/meetings/instant", host, map[string]any{
		"title": "Giao ban Q4",
	})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create meeting: %d %v", res.StatusCode, out)
	}
	meetingID := out["meeting"].(map[string]any)["id"].(string)
	if res, out = doJSON(t, srv, "POST", "/api/v1/meetings/"+meetingID+"/end", host, nil); res.StatusCode != http.StatusOK {
		t.Fatalf("end meeting: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "POST", "/api/v1/meetings/"+meetingID+"/minutes", host, map[string]any{"locale": "vi"})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("create minutes: %d %v", res.StatusCode, out)
	}
	docID := out["minutes"].(map[string]any)["document_id"].(string)
	wantSourceID := "meeting:minutes:" + meetingID

	// 1. Sources endpoint lists the minutes row on all, ?source=meeting, and ?type=page, and omits it on ?type=pdf.
	for _, qstr := range []string{"", "source=meeting", "type=page", "source=meeting&type=page"} {
		res, out = doJSON(t, srv, "GET", "/api/v1/workspaces/"+wsID+"/documents/sources?"+qstr, member, nil)
		if res.StatusCode != http.StatusOK {
			t.Fatalf("GET sources?%s: %d %v", qstr, res.StatusCode, out)
		}
		items, _ := out["items"].([]any)
		if len(items) != 1 {
			t.Fatalf("GET sources?%s items = %v, want 1", qstr, items)
		}
		it := items[0].(map[string]any)
		parent, _ := it["parent"].(map[string]any)
		if it["id"] != wantSourceID || it["source"] != "meeting" || it["kind"] != "page" ||
			it["document_id"] != docID || it["name"] != "Giao ban Q4" ||
			parent["kind"] != "meeting" || parent["id"] != meetingID || parent["title"] != "Giao ban Q4" ||
			it["mime_type"] != "" || it["extension"] != "" || it["size_bytes"] != float64(0) ||
			it["can_open_in_app"] != false || it["can_save"] != false {
			t.Fatalf("GET sources?%s item = %v", qstr, it)
		}
	}
	res, out = doJSON(t, srv, "GET", "/api/v1/workspaces/"+wsID+"/documents/sources?type=pdf", member, nil)
	if res.StatusCode != http.StatusOK || len(out["items"].([]any)) != 0 {
		t.Fatalf("GET sources?type=pdf = %d %v, want empty", res.StatusCode, out)
	}

	// 2. D4: download, save and office/frame-token refuse meeting:minutes:<id> with 404 not_found.
	escapedID := "meeting%3Aminutes%3A" + meetingID
	for _, call := range []struct {
		method string
		suffix string
	}{
		{"GET", "/download"},
		{"POST", "/save"},
		{"POST", "/office/frame-token"},
	} {
		res, out = doJSON(t, srv, call.method, "/api/v1/workspaces/"+wsID+"/documents/sources/"+escapedID+call.suffix, member, nil)
		if res.StatusCode != http.StatusNotFound || errorCode(out) != "not_found" {
			t.Fatalf("%s %s = %d %v, want 404 not_found", call.method, call.suffix, res.StatusCode, out)
		}
	}

	// 3. GET /documents/{id}, PATCH /documents/{id}, /documents/tree and /documents return minutes_meeting{id, title} for member.
	res, out = doJSON(t, srv, "GET", "/api/v1/documents/"+docID, member, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("GET document: %d %v", res.StatusCode, out)
	}
	mm, _ := out["document"].(map[string]any)["minutes_meeting"].(map[string]any)
	if mm["id"] != meetingID || mm["title"] != "Giao ban Q4" {
		t.Fatalf("GET document minutes_meeting = %v", mm)
	}
	res, out = doJSON(t, srv, "PATCH", "/api/v1/documents/"+docID, host, map[string]any{
		"revision": 1, "icon": "📋",
	})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("PATCH document: %d %v", res.StatusCode, out)
	}
	mm, _ = out["document"].(map[string]any)["minutes_meeting"].(map[string]any)
	if mm["id"] != meetingID || mm["title"] != "Giao ban Q4" {
		t.Fatalf("PATCH document minutes_meeting = %v", mm)
	}
	res, out = doJSON(t, srv, "GET", "/api/v1/workspaces/"+wsID+"/documents/tree", member, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("GET tree: %d %v", res.StatusCode, out)
	}
	treeDocs, _ := out["documents"].([]any)
	if len(treeDocs) != 1 {
		t.Fatalf("tree documents = %v, want 1", treeDocs)
	}
	mm, _ = treeDocs[0].(map[string]any)["minutes_meeting"].(map[string]any)
	if mm["id"] != meetingID || mm["title"] != "Giao ban Q4" {
		t.Fatalf("tree minutes_meeting = %v", mm)
	}
	res, out = doJSON(t, srv, "GET", "/api/v1/workspaces/"+wsID+"/documents", member, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("GET documents: %d %v", res.StatusCode, out)
	}
	listDocs, _ := out["documents"].([]any)
	if len(listDocs) != 1 {
		t.Fatalf("list documents = %v, want 1", listDocs)
	}
	mm, _ = listDocs[0].(map[string]any)["minutes_meeting"].(map[string]any)
	if mm["id"] != meetingID || mm["title"] != "Giao ban Q4" {
		t.Fatalf("list minutes_meeting = %v", mm)
	}

	// 4. Share the page with outsider (in wsB only): GET /documents/{id} and GET /workspaces/{wsB}/documents/shared-with-me
	// return minutes_meeting with id and NO title key.
	res, out = doJSON(t, srv, "POST", "/api/v1/documents/"+docID+"/shares", host, map[string]any{
		"principal_type": "user", "principal_id": outsiderID, "level": "view",
	})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("share document with outsider: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "GET", "/api/v1/documents/"+docID, outsider, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("outsider GET document: %d %v", res.StatusCode, out)
	}
	mm, _ = out["document"].(map[string]any)["minutes_meeting"].(map[string]any)
	if mm["id"] != meetingID {
		t.Fatalf("outsider GET document minutes_meeting = %v", mm)
	}
	if _, hasTitle := mm["title"]; hasTitle {
		t.Fatalf("outsider GET document leaked meeting title: %v", mm)
	}
	res, out = doJSON(t, srv, "GET", "/api/v1/workspaces/"+wsBID+"/documents/shared-with-me", outsider, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("outsider shared-with-me: %d %v", res.StatusCode, out)
	}
	sharedDocs, _ := out["documents"].([]any)
	if len(sharedDocs) != 1 {
		t.Fatalf("outsider shared-with-me = %v, want 1", sharedDocs)
	}
	mm, _ = sharedDocs[0].(map[string]any)["minutes_meeting"].(map[string]any)
	if mm["id"] != meetingID {
		t.Fatalf("outsider shared-with-me minutes_meeting = %v", mm)
	}
	if _, hasTitle := mm["title"]; hasTitle {
		t.Fatalf("outsider shared-with-me leaked meeting title: %v", mm)
	}
}
