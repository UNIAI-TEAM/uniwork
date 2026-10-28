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

// The publish route takes an optional source; anything but the two known ones
// is a 400 before any provider work, and the host's own share cannot be locked.
func TestSetParticipantPublishSource(t *testing.T) {
	f := setupChatFixture(t, "publishsrc")
	res, out := doJSON(t, f.srv, "POST", "/api/v1/workspaces/"+f.wsID+"/meetings/instant", f.tokens["a"], map[string]string{"title": "Share lock"})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("instant meeting: %d %v", res.StatusCode, out)
	}
	meetingID := out["meeting"].(map[string]any)["id"].(string)
	if res, out = doJSON(t, f.srv, "POST", "/api/v1/meetings/"+meetingID+"/join", f.tokens["a"], map[string]any{}); res.StatusCode != http.StatusOK {
		t.Fatalf("host join: %d %v", res.StatusCode, out)
	}
	_, out = doJSON(t, f.srv, "GET", "/api/v1/meetings/"+meetingID+"/attendance", f.tokens["a"], nil)
	hostPID := out["rows"].([]any)[0].(map[string]any)["participant_id"].(string)
	path := "/api/v1/meetings/" + meetingID + "/participants/" + hostPID + "/publish"

	res, out = doJSON(t, f.srv, "POST", path, f.tokens["a"], map[string]any{"enabled": false, "source": "camera"})
	if res.StatusCode != http.StatusBadRequest || out["error"].(map[string]any)["code"] != "invalid_request" {
		t.Fatalf("unknown source: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, f.srv, "POST", path, f.tokens["a"], map[string]any{"enabled": false, "source": "screen_share"})
	if res.StatusCode != http.StatusConflict || out["error"].(map[string]any)["code"] != "cannot_lock_host_share" {
		t.Fatalf("host share: %d %v", res.StatusCode, out)
	}
	// No source is the microphone, as before the field existed.
	res, out = doJSON(t, f.srv, "POST", path, f.tokens["a"], map[string]any{"enabled": false})
	if res.StatusCode != http.StatusConflict || out["error"].(map[string]any)["code"] != "cannot_mute_host" {
		t.Fatalf("host mic: %d %v", res.StatusCode, out)
	}
}

// The leave screens read presence and removal off the participant list: every
// row says whether it holds the room, and a removed row says who removed it
// and when, to members only.
func TestListParticipantsCarriesPresenceAndRemoval(t *testing.T) {
	f := setupChatFixture(t, "presence")
	res, out := doJSON(t, f.srv, "POST", "/api/v1/workspaces/"+f.wsID+"/meetings/instant", f.tokens["a"], map[string]string{"title": "Presence"})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("instant meeting: %d %v", res.StatusCode, out)
	}
	meetingID := out["meeting"].(map[string]any)["id"].(string)
	res, out = doJSON(t, f.srv, "POST", "/api/v1/meetings/"+meetingID+"/invitations", f.tokens["a"], map[string]any{"user_id": f.ids["b"]})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("invite b: %d %v", res.StatusCode, out)
	}
	bPID := out["participant"].(map[string]any)["id"].(string)
	if res, out = doJSON(t, f.srv, "DELETE", "/api/v1/meetings/"+meetingID+"/participants/"+bPID, f.tokens["a"], nil); res.StatusCode != http.StatusOK && res.StatusCode != http.StatusNoContent {
		t.Fatalf("remove b: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, f.srv, "GET", "/api/v1/meetings/"+meetingID+"/participants", f.tokens["a"], nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("list: %d %v", res.StatusCode, out)
	}
	var removed map[string]any
	hosts := 0
	for _, raw := range out["participants"].([]any) {
		row := raw.(map[string]any)
		if _, ok := row["in_room"]; !ok {
			t.Fatalf("row %v has no in_room", row["id"])
		}
		if row["id"] == bPID {
			removed = row
		}
		// A guest's client obeys mute requests only from the seat marked host (UNI-890).
		if row["is_host"] == true {
			hosts++
			if row["user_id"] != f.ids["a"] {
				t.Fatalf("is_host on %v, want only a's seat", row["user_id"])
			}
		}
	}
	if hosts != 1 {
		t.Fatalf("rows marked is_host = %d, want the host's one", hosts)
	}
	if removed == nil {
		t.Fatal("removed participant missing from the list")
	}
	if removed["removed_by"] != f.ids["a"] {
		t.Fatalf("removed_by = %v, want %s", removed["removed_by"], f.ids["a"])
	}
	if at, _ := removed["removed_at"].(string); at == "" {
		t.Fatal("removed_at missing")
	} else if _, err := time.Parse(time.RFC3339, at); err != nil {
		t.Fatalf("removed_at %q: %v", at, err)
	}
}

// A guest outside the room shows how long the meeting has run: resolve says
// when it actually started.
func TestResolveInviteLinkCarriesStartedAt(t *testing.T) {
	f := setupChatFixture(t, "resolvestart")
	res, out := doJSON(t, f.srv, "POST", "/api/v1/workspaces/"+f.wsID+"/meetings/instant", f.tokens["a"], map[string]string{"title": "Started"})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("instant meeting: %d %v", res.StatusCode, out)
	}
	meetingID := out["meeting"].(map[string]any)["id"].(string)
	expires := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
	res, out = doJSON(t, f.srv, "POST", "/api/v1/meetings/"+meetingID+"/invite-links", f.tokens["a"], map[string]any{
		"name": "guest", "access_mode": "AUTO_ADMIT", "expires_at": expires,
	})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("create invite link: %d %v", res.StatusCode, out)
	}
	link := out["invite_link"].(map[string]any)
	res, out = doJSON(t, f.srv, "POST", "/api/v1/public/meeting-invite-links/resolve", "", map[string]string{
		"link_id": link["id"].(string), "secret": link["secret"].(string),
	})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("resolve: %d %v", res.StatusCode, out)
	}
	at, _ := out["started_at"].(string)
	if _, err := time.Parse(time.RFC3339, at); err != nil {
		t.Fatalf("started_at %q: %v", at, err)
	}
}
