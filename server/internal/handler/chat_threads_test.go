package handler

import (
	"context"
	"net/http"
	"testing"

	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func enableChatWorkHubFlag(t *testing.T) {
	t.Helper()
	pool := testutil.DB(t)
	q := db.New(pool)
	if _, err := q.UpsertFlagOverride(context.Background(), db.UpsertFlagOverrideParams{
		ID:        util.NewID(),
		FlagKey:   "chat_work_hub",
		ScopeType: featureflags.ScopeGlobal,
		ScopeID:   "",
		Enabled:   true,
		Note:      "handler thread tests",
		CreatedBy: "test",
	}); err != nil {
		t.Fatalf("enable chat_work_hub: %v", err)
	}
	if testFlagOverrides != nil {
		testFlagOverrides.Invalidate()
	}
}

func TestChatThreadHTTP(t *testing.T) {
	f := setupChatFixture(t, "thread-http")
	enableChatWorkHubFlag(t)
	srv, tokA, tokB := f.srv, f.tokens["a"], f.tokens["b"]
	roomID := f.groupRoomID
	rootID := f.firstMessageID

	base := "/api/v1/workspaces/" + f.wsID + "/chat/rooms/" + roomID + "/threads/" + rootID + "/messages"
	res, out := doJSON(t, srv, "POST", base, tokB, map[string]string{
		"body": "thread reply from b", "client_msg_id": "cmid-http-thread-1",
	})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("send thread: %d %v", res.StatusCode, out)
	}
	msg := out["message"].(map[string]any)
	if msg["thread_root_id"] != rootID {
		t.Fatalf("thread_root_id=%v", msg["thread_root_id"])
	}

	res, out = doJSON(t, srv, "GET", base+"?limit=20", tokA, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("list thread: %d %v", res.StatusCode, out)
	}
	msgs, _ := out["messages"].([]any)
	if len(msgs) < 2 {
		t.Fatalf("thread messages=%d want >=2", len(msgs))
	}

	threadBase := "/api/v1/workspaces/" + f.wsID + "/chat/threads/" + rootID
	res, out = doJSON(t, srv, "POST", threadBase+"/follow", tokA, map[string]any{})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("follow: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "POST", threadBase+"/read", tokA, map[string]any{})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("mark read: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "GET", "/api/v1/workspaces/"+f.wsID+"/chat/threads?limit=10", tokA, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("list followed: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "GET", "/api/v1/workspaces/"+f.wsID+"/chat/threads?unread=1&limit=5", tokA, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("list unread: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "DELETE", threadBase+"/follow", tokA, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unfollow: %d %v", res.StatusCode, out)
	}

	// Main timeline must not include the thread reply.
	res, out = doJSON(t, srv, "GET", roomMessagesPath(f, roomID), tokA, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("list room: %d %v", res.StatusCode, out)
	}
	for _, raw := range out["messages"].([]any) {
		row := raw.(map[string]any)
		if row["id"] == msg["id"] {
			t.Fatal("thread reply leaked onto main timeline via HTTP list")
		}
	}
}
