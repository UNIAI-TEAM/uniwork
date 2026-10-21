package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/meetings"
	"github.com/unicomhub/uniwork/server/internal/util"
)

type agentMeetingFixture struct {
	sessionToken, orgID, wsID, meetingID, runID string
}

// agentMeeting registers an owner, an organization, a workspace and an
// instant meeting through the API, then opens a scribe run the way
// ensureScribe would (the agent API has no session caller to create one).
func agentMeeting(t *testing.T, srv *httptest.Server, email, slug string) agentMeetingFixture {
	t.Helper()
	res, out := doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": email, "password": "password123", "display_name": "Host " + slug,
	})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("register: %d %v", res.StatusCode, out)
	}
	f := agentMeetingFixture{sessionToken: out["access_token"].(string)}
	verifyEmail(t, srv, f.sessionToken)
	_, out = doJSON(t, srv, "POST", "/api/v1/orgs", f.sessionToken, map[string]string{"name": "Org " + slug, "slug": slug + "-org"})
	f.orgID = out["organization"].(map[string]any)["id"].(string)
	_, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+f.orgID+"/workspaces", f.sessionToken, map[string]string{"name": "WS " + slug, "slug": slug + "-ws"})
	f.wsID = out["workspace"].(map[string]any)["id"].(string)
	_, out = doJSON(t, srv, "POST", "/api/v1/workspaces/"+f.wsID+"/meetings/instant", f.sessionToken, map[string]string{"title": "Giao ban " + slug})
	f.meetingID = out["meeting"].(map[string]any)["id"].(string)
	f.runID = util.NewID()
	if _, err := testPool.Exec(context.Background(), `INSERT INTO meeting_scribe_runs
		(id, organization_id, workspace_id, meeting_id, created_by, created_by_kind)
		VALUES ($1, $2, $3, $4, 'meeting_scribe', 'system')`, f.runID, f.orgID, f.wsID, f.meetingID); err != nil {
		t.Fatal(err)
	}
	return f
}

func (f agentMeetingFixture) token(exp time.Time) string {
	return meetings.SignAgentToken([]byte("test"), meetings.AgentClaims{
		MeetingID: f.meetingID, OrganizationID: f.orgID, RunID: f.runID, ExpiresAt: exp,
	})
}

func TestMeetingAgentTokenGuardsTheRoutes(t *testing.T) {
	srv := newTestServer(t)
	a := agentMeeting(t, srv, "agent-a@example.com", "agenta")
	ok := a.token(time.Now().Add(time.Hour))
	ctxPath := "/api/v1/meetings/" + a.meetingID + "/agent/context"

	res, out := doJSON(t, srv, "GET", ctxPath, ok, nil)
	if res.StatusCode != http.StatusOK || out["meeting_title"] != "Giao ban agenta" || out["locale"] != "vi" {
		t.Fatalf("context: %d %v", res.StatusCode, out)
	}
	if res, out := doJSON(t, srv, "POST", "/api/v1/meetings/"+a.meetingID+"/agent/started", ok, map[string]any{}); res.StatusCode != http.StatusOK {
		t.Fatalf("started: %d %v", res.StatusCode, out)
	}
	now := time.Now()
	res, out = doJSON(t, srv, "POST", "/api/v1/meetings/"+a.meetingID+"/agent/segments", ok, map[string]any{
		"segments": []map[string]any{{
			"segment_id": "TR_1-1", "participant_identity": "uw_participant_x", "spoken_at": now.Format(time.RFC3339Nano),
			"ended_at": now.Add(2 * time.Second).Format(time.RFC3339Nano), "speech_ms": 1800, "text": "Chốt ship thứ Sáu", "language": "vi",
		}},
	})
	if res.StatusCode != http.StatusOK || out["accepted"] != float64(1) {
		t.Fatalf("segments: %d %v", res.StatusCode, out)
	}
	// The test server has no AI and no scribe flag: nothing to extract with.
	res, out = doJSON(t, srv, "POST", "/api/v1/meetings/"+a.meetingID+"/agent/extract", ok, nil)
	if res.StatusCode != http.StatusOK || out["created"] != float64(0) || out["skipped"] != "unavailable" {
		t.Fatalf("extract: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "POST", "/api/v1/meetings/"+a.meetingID+"/agent/translate", ok, map[string]any{
		"target": "en", "segments": []map[string]any{{"segment_id": "TR_1-1", "text": "Chốt ship thứ Sáu"}},
	})
	if tr, _ := out["translations"].([]any); res.StatusCode != http.StatusOK || out["skipped"] != "unavailable" || tr == nil || len(tr) != 0 {
		t.Fatalf("translate: %d %v", res.StatusCode, out)
	}
	if res, out := doJSON(t, srv, "POST", "/api/v1/meetings/"+a.meetingID+"/agent/translate", ok, map[string]any{
		"target": "fr", "segments": []map[string]any{{"segment_id": "TR_1-1", "text": "x"}},
	}); res.StatusCode != http.StatusBadRequest {
		t.Fatalf("translate to fr: %d %v", res.StatusCode, out)
	}

	forged := meetings.SignAgentToken([]byte("not the server key"), meetings.AgentClaims{
		MeetingID: a.meetingID, OrganizationID: a.orgID, RunID: a.runID, ExpiresAt: now.Add(time.Hour),
	})
	otherOrg := meetings.SignAgentToken([]byte("test"), meetings.AgentClaims{
		MeetingID: a.meetingID, OrganizationID: util.NewID(), RunID: a.runID, ExpiresAt: now.Add(time.Hour),
	})
	for name, c := range map[string]struct {
		token string
		want  int
	}{
		"no token":           {"", http.StatusUnauthorized},
		"session JWT":        {a.sessionToken, http.StatusUnauthorized},
		"bad signature":      {forged, http.StatusNotFound},
		"expired":            {a.token(now.Add(-time.Minute)), http.StatusNotFound},
		"other organization": {otherOrg, http.StatusNotFound},
	} {
		if res, out := doJSON(t, srv, "GET", ctxPath, c.token, nil); res.StatusCode != c.want {
			t.Errorf("%s: %d %v, want %d", name, res.StatusCode, out, c.want)
		}
	}
}

// A token of a meeting of organization A neither reads nor writes a meeting
// of organization B (ADR 0008): the token names one meeting only.
func TestMeetingAgentTokenStaysInItsMeeting(t *testing.T) {
	srv := newTestServer(t)
	a := agentMeeting(t, srv, "agent-iso-a@example.com", "agentisoa")
	b := agentMeeting(t, srv, "agent-iso-b@example.com", "agentisob")
	tokA := a.token(time.Now().Add(time.Hour))
	base := "/api/v1/meetings/" + b.meetingID + "/agent/"
	for _, c := range []struct {
		method, path string
		body         any
	}{
		{"GET", "context", nil},
		{"POST", "started", map[string]any{}},
		{"POST", "segments", map[string]any{"segments": []map[string]any{{
			"segment_id": "x", "text": "t", "spoken_at": time.Now().Format(time.RFC3339), "ended_at": time.Now().Format(time.RFC3339),
		}}}},
		{"POST", "extract", nil},
		{"POST", "finished", map[string]any{"stt_session_ms": 1}},
	} {
		if res, out := doJSON(t, srv, c.method, base+c.path, tokA, c.body); res.StatusCode != http.StatusNotFound {
			t.Errorf("%s %s with A's token: %d %v", c.method, c.path, res.StatusCode, out)
		}
	}
	var n int
	if err := testPool.QueryRow(context.Background(), `SELECT count(*) FROM meeting_transcript_segments WHERE meeting_id = $1`, b.meetingID).Scan(&n); err != nil || n != 0 {
		t.Fatalf("B's transcript has %d rows %v", n, err)
	}
	var status string
	if err := testPool.QueryRow(context.Background(), `SELECT status FROM meeting_scribe_runs WHERE id = $1`, b.runID).Scan(&status); err != nil || status != "DISPATCHED" {
		t.Fatalf("B's run is %q %v", status, err)
	}
}
