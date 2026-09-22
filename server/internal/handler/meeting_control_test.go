package handler

import (
	"net/http"
	"testing"
	"time"
)

func TestGuestJoinViaInviteLinkRequiresDisplayName(t *testing.T) {
	srv := newTestServer(t)
	res, out := doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": "host@example.com", "password": "password123", "display_name": "Host",
	})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("register: %d %v", res.StatusCode, out)
	}
	token := out["access_token"].(string)
	verifyEmail(t, srv, token)

	res, out = doJSON(t, srv, "POST", "/api/v1/orgs", token, map[string]string{"name": "Org", "slug": "guest-org"})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create org: %d %v", res.StatusCode, out)
	}
	orgID := out["organization"].(map[string]any)["id"].(string)

	res, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+orgID+"/workspaces", token, map[string]string{"name": "WS", "slug": "guest-ws"})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create ws: %d %v", res.StatusCode, out)
	}
	wsID := out["workspace"].(map[string]any)["id"].(string)

	res, out = doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/meetings/instant", token, map[string]string{"title": "Guest test"})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("instant meeting: %d %v", res.StatusCode, out)
	}
	meetingID := out["meeting"].(map[string]any)["id"].(string)

	expires := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
	res, out = doJSON(t, srv, "POST", "/api/v1/meetings/"+meetingID+"/invite-links", token, map[string]any{
		"name": "guest", "access_mode": "AUTO_ADMIT", "expires_at": expires,
	})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("create invite link: %d %v", res.StatusCode, out)
	}
	link := out["invite_link"].(map[string]any)
	linkID := link["id"].(string)
	secret := link["secret"].(string)

	res, out = doJSON(t, srv, "POST", "/api/v1/meetings/"+meetingID+"/join", "", map[string]string{
		"invite_link_id": linkID,
		"secret":         secret,
	})
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("guest join without display_name: %d %v", res.StatusCode, out)
	}
	if out["error"].(map[string]any)["code"] != "invalid_request" {
		t.Fatalf("error code = %v", out["error"])
	}
}

// A lobby retry after the host said no gets the rejection back instead of a
// fresh request; "request_again" is the explicit way back into the queue.
func TestJoinAfterRejectionNeedsRequestAgain(t *testing.T) {
	f := setupChatFixture(t, "joinreject")
	start := time.Now().Add(-time.Minute).UTC().Format(time.RFC3339)
	end := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
	res, out := doJSON(t, f.srv, "POST", "/api/v1/workspaces/"+f.wsID+"/meetings", f.tokens["a"], map[string]any{
		"title": "Reject", "starts_at": start, "ends_at": end, "allow_join_request": true,
	})
	if res.StatusCode != http.StatusOK && res.StatusCode != http.StatusCreated {
		t.Fatalf("create meeting: %d %v", res.StatusCode, out)
	}
	meetingID := out["meeting"].(map[string]any)["id"].(string)
	joinPath := "/api/v1/meetings/" + meetingID + "/join"

	res, out = doJSON(t, f.srv, "POST", joinPath, f.tokens["b"], map[string]any{})
	if res.StatusCode != http.StatusOK || out["decision"] != "WAITING_APPROVAL" {
		t.Fatalf("first join: %d %v", res.StatusCode, out)
	}
	requestID := out["join_request_id"].(string)
	res, out = doJSON(t, f.srv, "POST", "/api/v1/meeting-join-requests/"+requestID+"/reject", f.tokens["a"], map[string]any{})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("reject: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, f.srv, "POST", joinPath, f.tokens["b"], map[string]any{})
	if res.StatusCode != http.StatusForbidden || out["error"].(map[string]any)["code"] != "join_request_rejected" {
		t.Fatalf("retry after reject: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, f.srv, "POST", joinPath, f.tokens["b"], map[string]any{"request_again": true})
	if res.StatusCode != http.StatusOK || out["decision"] != "WAITING_APPROVAL" || out["join_request_id"] == requestID {
		t.Fatalf("request again: %d %v", res.StatusCode, out)
	}
}
