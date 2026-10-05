package handler

import (
	"net/http"
	"net/url"
	"testing"
)

func TestMeetingChatHTTP(t *testing.T) {
	srv := newTestServer(t)
	res, out := doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": "chat@example.com", "password": "password123", "display_name": "Chat User"})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("register: %d %v", res.StatusCode, out)
	}
	token := out["access_token"].(string)
	verifyEmail(t, srv, token)

	res, out = doJSON(t, srv, "POST", "/api/v1/orgs", token, map[string]string{"name": "Org", "slug": "chat-org"})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create org: %d %v", res.StatusCode, out)
	}
	orgID := out["organization"].(map[string]any)["id"].(string)

	res, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+orgID+"/workspaces", token, map[string]string{"name": "WS", "slug": "chat-ws"})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create ws: %d %v", res.StatusCode, out)
	}
	wsID := out["workspace"].(map[string]any)["id"].(string)

	res, out = doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/meetings/instant", token, map[string]string{"title": "Now"})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("instant meeting: %d %v", res.StatusCode, out)
	}
	meetingID := out["meeting"].(map[string]any)["id"].(string)

	res, out = doJSON(t, srv, "POST", "/api/v1/meetings/"+meetingID+"/chat", token, map[string]string{"message": "Xin chào"})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("append chat: %d %v", res.StatusCode, out)
	}
	msg := out["message"].(map[string]any)
	if msg["message"] != "Xin chào" || msg["sender_name"] != "Chat User" {
		t.Fatalf("message dto: %v", msg)
	}

	res, out = doJSON(t, srv, "GET", "/api/v1/meetings/"+meetingID, token, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("get meeting: %d %v", res.StatusCode, out)
	}
	if out["meeting"].(map[string]any)["id"] != meetingID {
		t.Fatalf("get meeting dto: %v", out["meeting"])
	}

	res, out = doJSON(t, srv, "GET", "/api/v1/workspaces/"+wsID+"/meetings", token, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("list meetings: %d %v", res.StatusCode, out)
	}
	if len(out["meetings"].([]any)) != 1 {
		t.Fatalf("meetings len = %v", out["meetings"])
	}

	res, out = doJSON(t, srv, "POST", "/api/v1/meetings/"+meetingID+"/chat", token, map[string]string{"message": "Tin thứ hai"})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("append second chat: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "GET", "/api/v1/meetings/"+meetingID+"/chat", token, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("list chat: %d %v", res.StatusCode, out)
	}
	msgs := out["messages"].([]any)
	if len(msgs) != 2 {
		t.Fatalf("messages len = %d", len(msgs))
	}
	if out["after_cursor"] == nil || out["older_cursor"] != nil || out["has_more_after"] != false {
		t.Fatalf("newest page cursors: %v", out)
	}

	// G18: newest page first, then walk back with the cursor it handed out.
	res, out = doJSON(t, srv, "GET", "/api/v1/meetings/"+meetingID+"/chat?limit=1", token, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("list chat page: %d %v", res.StatusCode, out)
	}
	if msgs := out["messages"].([]any); len(msgs) != 1 || msgs[0].(map[string]any)["message"] != "Tin thứ hai" {
		t.Fatalf("newest page: %v", out)
	}
	older, _ := out["older_cursor"].(string)
	after, _ := out["after_cursor"].(string)
	res, out = doJSON(t, srv, "GET", "/api/v1/meetings/"+meetingID+"/chat?limit=1&before="+url.QueryEscape(older), token, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("older page: %d %v", res.StatusCode, out)
	}
	if msgs := out["messages"].([]any); len(msgs) != 1 || msgs[0].(map[string]any)["message"] != "Xin chào" || out["older_cursor"] != nil {
		t.Fatalf("older page: %v", out)
	}
	res, out = doJSON(t, srv, "GET", "/api/v1/meetings/"+meetingID+"/chat?after="+url.QueryEscape(after), token, nil)
	if res.StatusCode != http.StatusOK || out["after_cursor"] != after {
		t.Fatalf("delta: %d %v", res.StatusCode, out)
	}
	for _, q := range []string{"limit=abc", "limit=0", "before=bad", "after=1.x&before=1.x"} {
		for _, feed := range []string{"chat", "transcript"} {
			if res, out = doJSON(t, srv, "GET", "/api/v1/meetings/"+meetingID+"/"+feed+"?"+q, token, nil); res.StatusCode != http.StatusBadRequest {
				t.Fatalf("%s?%s: %d %v", feed, q, res.StatusCode, out)
			}
		}
	}
	res, out = doJSON(t, srv, "POST", "/api/v1/meetings/"+meetingID+"/transcript", token, map[string]string{"text": "Câu đầu"})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("append transcript: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "GET", "/api/v1/meetings/"+meetingID+"/transcript", token, nil)
	if res.StatusCode != http.StatusOK || len(out["segments"].([]any)) != 1 || out["after_cursor"] == nil {
		t.Fatalf("transcript page: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "POST", "/api/v1/meetings/"+meetingID+"/chat", token, map[string]string{"message": "   "})
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("empty chat: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": "outsider@example.com", "password": "password123", "display_name": "Outsider"})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("register outsider: %d %v", res.StatusCode, out)
	}
	outsiderToken := out["access_token"].(string)
	verifyEmail(t, srv, outsiderToken)

	res, out = doJSON(t, srv, "GET", "/api/v1/meetings/"+meetingID+"/chat", outsiderToken, nil)
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("outsider list chat: %d %v", res.StatusCode, out)
	}
}
