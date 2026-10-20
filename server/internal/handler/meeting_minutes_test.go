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

	res, out = doJSON(t, srv, "POST", base+"/finalize", host, nil)
	minutes, _ = out["minutes"].(map[string]any)
	if res.StatusCode != http.StatusOK || minutes["finalized"] != true || minutes["finalized_version"] != float64(1) || minutes["finalized_version_id"] == nil {
		t.Fatalf("finalize: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "GET", base, member, nil)
	if minutes, _ = out["minutes"].(map[string]any); res.StatusCode != http.StatusOK || minutes["finalized"] != true || minutes["can_edit"] != false {
		t.Fatalf("member reads finalized minutes: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "POST", base+"/reopen", host, nil)
	if minutes, _ = out["minutes"].(map[string]any); res.StatusCode != http.StatusOK || minutes["finalized"] != false || minutes["finalized_at"] != nil {
		t.Fatalf("reopen: %d %v", res.StatusCode, out)
	}
}
