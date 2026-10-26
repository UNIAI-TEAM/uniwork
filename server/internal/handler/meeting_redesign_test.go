package handler

import (
	"net/http"
	"testing"
	"time"
)

// UNI-2153: a follow-up created twice under one Idempotency-Key is one
// meeting, and the detail GET names the series neighbours on both sides.
func TestMeetingDetailNamesSeriesNeighboursAndCreateIsIdempotent(t *testing.T) {
	f := setupChatFixture(t, "series")
	base := time.Now().Add(24 * time.Hour).UTC()
	res, out := doJSON(t, f.srv, "POST", "/api/v1/workspaces/"+f.wsID+"/meetings", f.tokens["a"], map[string]any{
		"title": "Tuần 43", "starts_at": base.Format(time.RFC3339), "ends_at": base.Add(time.Hour).Format(time.RFC3339),
	})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("create root: %d %v", res.StatusCode, out)
	}
	rootID := out["meeting"].(map[string]any)["id"].(string)

	next := base.Add(7 * 24 * time.Hour)
	body := map[string]any{
		"title": "Tuần 44", "starts_at": next.Format(time.RFC3339), "ends_at": next.Add(time.Hour).Format(time.RFC3339),
		"previous_meeting_id": rootID,
	}
	key := map[string]string{"Idempotency-Key": "series-follow-up"}
	var followID string
	for i := 0; i < 2; i++ {
		res, out = doJSONHeaders(t, f.srv, "POST", "/api/v1/workspaces/"+f.wsID+"/meetings", f.tokens["a"], key, body)
		if res.StatusCode != http.StatusOK {
			t.Fatalf("create follow-up #%d: %d %v", i+1, res.StatusCode, out)
		}
		id := out["meeting"].(map[string]any)["id"].(string)
		if followID != "" && id != followID {
			t.Fatalf("retry with the same key made %s, want %s", id, followID)
		}
		followID = id
	}
	res, out = doJSONHeaders(t, f.srv, "POST", "/api/v1/workspaces/"+f.wsID+"/meetings", f.tokens["b"], key, body)
	if res.StatusCode != http.StatusConflict || out["error"].(map[string]any)["code"] != "idempotency_key_reuse" {
		t.Fatalf("another member with the same key: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, f.srv, "GET", "/api/v1/meetings/"+rootID, f.tokens["b"], nil)
	root := out["meeting"].(map[string]any)
	if res.StatusCode != http.StatusOK || root["next_meeting_id"] != followID || root["previous_meeting_id"] != nil || root["series_id"] != nil {
		t.Fatalf("root detail: %d %v", res.StatusCode, root)
	}
	res, out = doJSON(t, f.srv, "GET", "/api/v1/meetings/"+followID, f.tokens["a"], nil)
	follow := out["meeting"].(map[string]any)
	if res.StatusCode != http.StatusOK || follow["series_id"] != rootID || follow["previous_meeting_id"] != rootID || follow["next_meeting_id"] != nil {
		t.Fatalf("follow-up detail: %d %v", res.StatusCode, follow)
	}
}

// UNI-2153: the host lists a link with a secret that can be copied again; a
// member who does not host is refused the list, secrets and all.
func TestInviteLinkListCarriesTheSecretToTheHostOnly(t *testing.T) {
	f := setupChatFixture(t, "linkcopy")
	res, out := doJSON(t, f.srv, "POST", "/api/v1/workspaces/"+f.wsID+"/meetings/instant", f.tokens["a"], map[string]string{"title": "Link"})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("instant meeting: %d %v", res.StatusCode, out)
	}
	meetingID := out["meeting"].(map[string]any)["id"].(string)
	res, out = doJSON(t, f.srv, "POST", "/api/v1/meetings/"+meetingID+"/invite-links", f.tokens["a"], map[string]any{
		"name": "Agency", "access_mode": "REQUEST_APPROVAL", "expires_at": time.Now().Add(time.Hour).UTC().Format(time.RFC3339),
	})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("create link: %d %v", res.StatusCode, out)
	}
	secret := out["invite_link"].(map[string]any)["secret"].(string)

	res, out = doJSON(t, f.srv, "GET", "/api/v1/meetings/"+meetingID+"/invite-links", f.tokens["a"], nil)
	links, _ := out["invite_links"].([]any)
	if res.StatusCode != http.StatusOK || len(links) != 1 || links[0].(map[string]any)["secret"] != secret {
		t.Fatalf("host list: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, f.srv, "GET", "/api/v1/meetings/"+meetingID+"/invite-links", f.tokens["b"], nil)
	if res.StatusCode != http.StatusForbidden && res.StatusCode != http.StatusNotFound {
		t.Fatalf("member list: %d %v", res.StatusCode, out)
	}
}
