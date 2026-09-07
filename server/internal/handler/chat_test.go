package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/mail"
	meetingspkg "github.com/unicomhub/uniwork/server/internal/meetings"
	"github.com/unicomhub/uniwork/server/internal/realtime"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/storage"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func newChatTestServer(t *testing.T) *httptest.Server {
	t.Helper()
	pool := testutil.DB(t)
	q := db.New(pool)
	minter := auth.TokenMinter{Secret: []byte("test"), TTL: time.Minute}
	orgs := service.NewOrganizationService(q)
	ws := service.NewWorkspaceService(pool, q, orgs, mail.Renderer{AppURL: "http://localhost:3000"}, discardOutbox{})
	verification := service.NewVerificationService(q, mail.Renderer{AppURL: "http://localhost:3000"}, discardOutbox{}, testDevCode)
	authSvc := service.NewAuthService(q, minter, time.Hour, verification)
	d := Deps{
		Cfg:           config.Config{FrontendOrigin: "http://localhost:3000", JWTSecret: "test"},
		Log:           slog.Default(),
		Minter:        minter,
		Auth:          authSvc,
		GoogleAuth:    service.NewGoogleAuthService(q, authSvc),
		Verification:  verification,
		PasswordReset: service.NewPasswordResetService(pool, q, authSvc, mail.Renderer{AppURL: "http://localhost:3000"}, discardOutbox{}),
		Organizations: orgs,
		Workspaces:    ws,
		Onboarding:    service.NewOnboardingService(q, ws, service.NopPublisher{}, mail.Renderer{AppURL: "http://localhost:3000"}, discardOutbox{}),
		Tasks:         service.NewTaskService(q, ws, service.NopPublisher{}),
		Meetings:      service.NewMeetingService(pool, q, ws, service.NopPublisher{}, &meetingspkg.FakeProvider{}, service.MeetingRuntime{HMACKey: []byte("test")}),
		Chat:          service.NewChatService(q, ws, service.NopPublisher{}),
		Hub:           realtime.NewHub(),
		Storage:       storage.NewLocalStorageFromEnv(),
	}
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)
	return srv
}

type chatFixture struct {
	srv             *httptest.Server
	tokens          map[string]string
	ids             map[string]string
	emails          map[string]string
	orgID           string
	wsID            string
	workspaceRoomID string
	dmRoomID        string
	groupRoomID     string
	firstMessageID  string
}

func registerChatUser(t *testing.T, srv *httptest.Server, email, name string) (string, string) {
	t.Helper()
	res, out := doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": email, "password": "password123", "display_name": name})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("register %s: %d %v", email, res.StatusCode, out)
	}
	token := out["access_token"].(string)
	verifyEmail(t, srv, token)
	id := out["user"].(map[string]any)["id"].(string)
	return token, id
}

func setupChatFixture(t *testing.T, tag string) *chatFixture {
	t.Helper()
	srv := newChatTestServer(t)
	f := &chatFixture{srv: srv, tokens: map[string]string{}, ids: map[string]string{}, emails: map[string]string{}}
	users := []struct{ key, email, name string }{
		{"a", "ca-" + tag + "@example.com", "Chat A"},
		{"b", "cb-" + tag + "@example.com", "Chat B"},
		{"c", "cc-" + tag + "@example.com", "Chat C"},
		{"d", "cd-" + tag + "@example.com", "Chat D"},
	}
	for _, u := range users {
		tok, id := registerChatUser(t, srv, u.email, u.name)
		f.tokens[u.key] = tok
		f.ids[u.key] = id
		f.emails[u.key] = u.email
	}
	res, out := doJSON(t, srv, "POST", "/api/v1/orgs", f.tokens["a"], map[string]string{"name": "Org " + tag, "slug": "org-" + tag})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create org: %d %v", res.StatusCode, out)
	}
	f.orgID = out["organization"].(map[string]any)["id"].(string)
	res, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+f.orgID+"/workspaces", f.tokens["a"], map[string]string{"name": "WS " + tag, "slug": "ws-" + tag})
	if res.StatusCode != http.StatusCreated {
		t.Fatalf("create ws: %d %v", res.StatusCode, out)
	}
	f.wsID = out["workspace"].(map[string]any)["id"].(string)
	res, out = doJSON(t, srv, "POST", "/api/v1/workspaces/"+f.wsID+"/invitations", f.tokens["a"], map[string]any{
		"emails": []string{f.emails["b"], f.emails["c"], f.emails["d"]}, "role": "member"})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("invite: %d %v", res.StatusCode, out)
	}
	for _, key := range []string{"b", "c", "d"} {
		res, out = doJSON(t, srv, "GET", "/api/v1/me/invitations", f.tokens[key], nil)
		if res.StatusCode != http.StatusOK {
			t.Fatalf("list invitations %s: %d %v", key, res.StatusCode, out)
		}
		var tok string
		for _, raw := range out["invitations"].([]any) {
			tok = raw.(map[string]any)["token"].(string)
		}
		res, out = doJSON(t, srv, "POST", "/api/v1/invitations/"+tok+"/accept", f.tokens[key], nil)
		if res.StatusCode != http.StatusOK {
			t.Fatalf("accept invitation %s: %d %v", key, res.StatusCode, out)
		}
	}
	res, out = doJSON(t, srv, "POST", "/api/v1/workspaces/"+f.wsID+"/chat/room", f.tokens["a"], map[string]string{})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("ensure workspace room: %d %v", res.StatusCode, out)
	}
	f.workspaceRoomID = out["room_id"].(string)
	res, out = doJSON(t, srv, "POST", "/api/v1/workspaces/"+f.wsID+"/chat/dm", f.tokens["a"], map[string]string{"user_id": f.ids["b"]})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("resolve dm: %d %v", res.StatusCode, out)
	}
	f.dmRoomID = out["room"].(map[string]any)["id"].(string)
	res, out = doJSON(t, srv, "POST", "/api/v1/workspaces/"+f.wsID+"/chat/groups", f.tokens["a"], map[string]any{
		"name": "Group " + tag, "member_user_ids": []string{f.ids["b"], f.ids["c"]}})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("create group: %d %v", res.StatusCode, out)
	}
	f.groupRoomID = out["room"].(map[string]any)["id"].(string)
	res, out = doJSON(t, srv, "POST", "/api/v1/workspaces/"+f.wsID+"/chat/rooms/"+f.groupRoomID+"/messages", f.tokens["a"], map[string]string{"body": "hello group"})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("seed group message: %d %v", res.StatusCode, out)
	}
	f.firstMessageID = out["message"].(map[string]any)["id"].(string)
	return f
}

func doRaw(t *testing.T, srv *httptest.Server, method, path, token, raw string) (*http.Response, map[string]any) {
	t.Helper()
	req, _ := http.NewRequest(method, srv.URL+path, strings.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var out map[string]any
	rawBody, _ := readAll(res)
	_ = json.Unmarshal(rawBody, &out)
	return res, out
}

func roomMessagesPath(f *chatFixture, roomID string) string {
	return "/api/v1/workspaces/" + f.wsID + "/chat/rooms/" + roomID + "/messages"
}

func TestChatWorkspaceRoom(t *testing.T) {
	f := setupChatFixture(t, "wsroom")
	srv, tok := f.srv, f.tokens["a"]

	res, out := doJSON(t, srv, "GET", "/api/v1/workspaces/"+f.wsID+"/chat/room", tok, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("get room: %d %v", res.StatusCode, out)
	}
	if out["room_id"] != f.workspaceRoomID {
		t.Fatalf("room id = %v want %v", out["room_id"], f.workspaceRoomID)
	}

	res, out = doJSON(t, srv, "POST", "/api/v1/workspaces/"+f.wsID+"/chat/room", tok, map[string]string{})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("ensure room: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "GET", "/api/v1/workspaces/"+f.wsID+"/chat/messages", tok, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("list ws messages: %d %v", res.StatusCode, out)
	}
	if _, ok := out["messages"]; !ok {
		t.Fatalf("missing messages: %v", out)
	}

	res, out = doJSON(t, srv, "GET", "/api/v1/workspaces/"+f.wsID+"/chat/messages?limit=10", tok, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("list ws messages limit: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "GET", "/api/v1/workspaces/"+f.wsID+"/chat/messages?before=not-a-time", tok, nil)
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad before: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "POST", "/api/v1/workspaces/"+f.wsID+"/chat/messages", tok, map[string]string{"body": "xin chao workspace"})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("send ws message: %d %v", res.StatusCode, out)
	}
	if out["message"].(map[string]any)["body"] != "xin chao workspace" {
		t.Fatalf("message body = %v", out["message"])
	}

	res, out = doJSON(t, srv, "POST", "/api/v1/workspaces/"+f.wsID+"/chat/messages", tok, map[string]string{"body": "   "})
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("empty ws message: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "GET", "/api/v1/workspaces/00000000000000000000000000/chat/room", tok, nil)
	if res.StatusCode != http.StatusNotFound && res.StatusCode != http.StatusForbidden {
		t.Fatalf("unknown ws room: %d %v", res.StatusCode, out)
	}
}

func TestChatRoomsListAndDM(t *testing.T) {
	f := setupChatFixture(t, "rooms")
	srv, tok := f.srv, f.tokens["a"]

	res, out := doJSON(t, srv, "GET", "/api/v1/workspaces/"+f.wsID+"/chat/rooms", tok, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("list rooms: %d %v", res.StatusCode, out)
	}
	rooms := out["rooms"].([]any)
	if len(rooms) < 2 {
		t.Fatalf("rooms len = %d", len(rooms))
	}

	res, out = doJSON(t, srv, "POST", "/api/v1/workspaces/"+f.wsID+"/chat/dm", tok, map[string]string{"user_id": f.ids["b"]})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("resolve dm again: %d %v", res.StatusCode, out)
	}
	if out["room"].(map[string]any)["id"] != f.dmRoomID {
		t.Fatalf("dm not idempotent: %v", out["room"])
	}

	res, out = doJSON(t, srv, "POST", "/api/v1/workspaces/"+f.wsID+"/chat/dm", tok, map[string]string{"user_id": ""})
	if res.StatusCode < 400 || res.StatusCode >= 500 {
		t.Fatalf("empty dm target: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "POST", "/api/v1/workspaces/"+f.wsID+"/chat/dm", tok, map[string]string{"user_id": f.ids["a"]})
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("self dm: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "POST", "/api/v1/workspaces/"+f.wsID+"/chat/groups", tok, map[string]any{
		"name": "Tiny", "member_user_ids": []string{f.ids["b"]}})
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("small group: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "GET", "/api/v1/workspaces/"+f.wsID+"/chat/rooms", "", nil)
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("no token rooms: %d %v", res.StatusCode, out)
	}
}

func TestChatRoomMessages(t *testing.T) {
	f := setupChatFixture(t, "msgs")
	srv := f.srv
	tokA, tokB := f.tokens["a"], f.tokens["b"]
	base := roomMessagesPath(f, f.groupRoomID)

	res, out := doJSON(t, srv, "POST", base, tokA, map[string]string{"body": "second message"})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("send: %d %v", res.StatusCode, out)
	}
	msgID := out["message"].(map[string]any)["id"].(string)

	res, out = doJSON(t, srv, "POST", base, tokA, map[string]string{"body": "   "})
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("empty body: %d %v", res.StatusCode, out)
	}

	res, out = doRaw(t, srv, "POST", base, tokA, "{bad json")
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("malformed json: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "GET", base, tokA, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("list: %d %v", res.StatusCode, out)
	}
	if len(out["messages"].([]any)) != 2 {
		t.Fatalf("messages len = %d", len(out["messages"].([]any)))
	}

	res, out = doJSON(t, srv, "GET", base+"?limit=1", tokA, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("list limit: %d %v", res.StatusCode, out)
	}
	if len(out["messages"].([]any)) != 1 {
		t.Fatalf("limit messages len = %d", len(out["messages"].([]any)))
	}

	res, out = doJSON(t, srv, "GET", base+"?before=not-a-time", tokA, nil)
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad before: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "GET", base+"/"+msgID, tokA, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("get message: %d %v", res.StatusCode, out)
	}
	if out["message"].(map[string]any)["id"] != msgID {
		t.Fatalf("message id = %v", out["message"])
	}

	res, out = doJSON(t, srv, "GET", base+"/01HZZZZZZZZZZZZZZZZZZZZZZZ", tokA, nil)
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("unknown message: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "GET", base+"/search?q=second", tokA, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("search: %d %v", res.StatusCode, out)
	}
	if len(out["messages"].([]any)) != 1 {
		t.Fatalf("search len = %d %v", len(out["messages"].([]any)), out)
	}

	res, out = doJSON(t, srv, "GET", base+"/search?before=bad-time", tokA, nil)
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("search bad before: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "GET", base+"/around/"+msgID+"?limit=10", tokA, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("around: %d %v", res.StatusCode, out)
	}
	if len(out["messages"].([]any)) != 2 {
		t.Fatalf("around len = %d", len(out["messages"].([]any)))
	}

	res, out = doJSON(t, srv, "POST", base, tokB, map[string]any{"body": "reply", "reply_to_message_id": msgID})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("reply: %d %v", res.StatusCode, out)
	}
	_ = tokB
}

func TestChatMessageActions(t *testing.T) {
	f := setupChatFixture(t, "actions")
	srv := f.srv
	tokA, tokB := f.tokens["a"], f.tokens["b"]
	base := roomMessagesPath(f, f.groupRoomID)
	msgID := f.firstMessageID

	res, out := doJSON(t, srv, "POST", base+"/"+msgID+"/reactions", tokB, map[string]string{"emoji": "like"})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("react: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "POST", base+"/"+msgID+"/reactions", tokB, map[string]string{"emoji": "like"})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unreact: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "PATCH", base+"/"+msgID, tokA, map[string]string{"body": "edited hello"})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("edit: %d %v", res.StatusCode, out)
	}
	if out["message"].(map[string]any)["body"] != "edited hello" {
		t.Fatalf("edited body = %v", out["message"])
	}

	res, out = doJSON(t, srv, "PATCH", base+"/"+msgID, tokB, map[string]string{"body": "hijack"})
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("edit other: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "POST", base+"/"+msgID+"/pin", tokA, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("pin: %d %v", res.StatusCode, out)
	}
	if out["message"].(map[string]any)["pinned"] != true {
		t.Fatalf("pinned = %v", out["message"])
	}
	res, out = doJSON(t, srv, "POST", base+"/"+msgID+"/pin", tokA, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unpin: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "DELETE", base+"/"+msgID, tokB, nil)
	if res.StatusCode != http.StatusForbidden {
		t.Fatalf("delete other: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "DELETE", base+"/"+msgID, tokA, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("delete: %d %v", res.StatusCode, out)
	}
	if out["status"] != "ok" {
		t.Fatalf("delete status = %v", out)
	}
}

func TestChatPollReminderNote(t *testing.T) {
	f := setupChatFixture(t, "kinds")
	srv, tok := f.srv, f.tokens["a"]
	base := roomMessagesPath(f, f.groupRoomID)

	res, out := doJSON(t, srv, "POST", base, tok, map[string]any{
		"poll": map[string]any{"question": "lunch?", "options": []string{"canteen", "outside"}}})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("send poll: %d %v", res.StatusCode, out)
	}
	pollMsg := out["message"].(map[string]any)
	optionID := pollMsg["poll"].(map[string]any)["options"].([]any)[0].(map[string]any)["id"].(string)
	pollID := pollMsg["id"].(string)

	res, out = doJSON(t, srv, "POST", base+"/"+pollID+"/poll/vote", f.tokens["b"], map[string]string{"option_id": optionID})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("vote poll: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "POST", base+"/"+pollID+"/poll/vote", f.tokens["b"], map[string]string{"option_id": "01HZZZZZZZZZZZZZZZZZZZZZZZ"})
	if res.StatusCode == http.StatusOK {
		t.Fatalf("bad vote unexpectedly ok: %v", out)
	}

	future := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
	res, out = doJSON(t, srv, "POST", base, tok, map[string]any{
		"reminder": map[string]any{"body": "standup", "remind_at": future}})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("send reminder: %d %v", res.StatusCode, out)
	}
	if out["message"].(map[string]any)["reminder"] == nil {
		t.Fatalf("missing reminder: %v", out["message"])
	}

	res, out = doJSON(t, srv, "POST", base, tok, map[string]any{
		"note": map[string]any{"body": "doc link", "pin_to_top": true}})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("send note: %d %v", res.StatusCode, out)
	}
	if out["message"].(map[string]any)["note"] == nil {
		t.Fatalf("missing note: %v", out["message"])
	}

	res, out = doJSON(t, srv, "GET", base+"/"+pollID, tok, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("get poll: %d %v", res.StatusCode, out)
	}
	if out["message"].(map[string]any)["poll"] == nil {
		t.Fatalf("missing poll: %v", out["message"])
	}
}

func TestChatModeration(t *testing.T) {
	f := setupChatFixture(t, "mod")
	srv := f.srv
	tokA := f.tokens["a"]
	membersBase := "/api/v1/workspaces/" + f.wsID + "/chat/rooms/" + f.groupRoomID + "/members"

	res, out := doJSON(t, srv, "GET", membersBase, tokA, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("list members: %d %v", res.StatusCode, out)
	}
	if len(out["members"].([]any)) != 3 {
		t.Fatalf("members len = %d", len(out["members"].([]any)))
	}

	res, out = doJSON(t, srv, "POST", membersBase, tokA, map[string]any{"member_user_ids": []string{f.ids["d"]}})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("invite: %d %v", res.StatusCode, out)
	}

	admin := "admin"
	res, out = doJSON(t, srv, "PATCH", membersBase+"/"+f.ids["b"], tokA, map[string]any{"role": &admin})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("promote: %d %v", res.StatusCode, out)
	}
	restricted := true
	res, out = doJSON(t, srv, "PATCH", membersBase+"/"+f.ids["c"], tokA, map[string]any{"send_restricted": &restricted})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("restrict: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "PATCH", "/api/v1/workspaces/"+f.wsID+"/chat/rooms/"+f.groupRoomID, tokA, map[string]any{"name": "Renamed"})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("rename: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "PATCH", "/api/v1/workspaces/"+f.wsID+"/chat/rooms/"+f.groupRoomID, tokA, map[string]any{
		"member_permissions": map[string]any{"allow_pin_content": false, "allow_create_polls": true}})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("patch perms: %d %v", res.StatusCode, out)
	}
	if out["allow_pin_content"] != false || out["allow_create_polls"] != true {
		t.Fatalf("perms = %v", out)
	}

	res, out = doJSON(t, srv, "DELETE", membersBase+"/"+f.ids["d"], tokA, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("remove member: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "POST", "/api/v1/workspaces/"+f.wsID+"/chat/rooms/"+f.groupRoomID+"/leave", f.tokens["c"], nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("leave: %d %v", res.StatusCode, out)
	}
}

func TestChatLookupBlockNickname(t *testing.T) {
	f := setupChatFixture(t, "social")
	srv := f.srv
	tokA := f.tokens["a"]
	lookup := "/api/v1/workspaces/" + f.wsID + "/chat/users/lookup"
	blockBase := "/api/v1/workspaces/" + f.wsID + "/chat/users/" + f.ids["b"] + "/block"
	nickBase := "/api/v1/workspaces/" + f.wsID + "/chat/users/" + f.ids["b"] + "/nickname"

	res, out := doJSON(t, srv, "GET", lookup+"?email="+f.emails["b"], tokA, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("lookup email: %d %v", res.StatusCode, out)
	}
	if out["user_id"] != f.ids["b"] {
		t.Fatalf("lookup user = %v", out)
	}

	res, out = doJSON(t, srv, "GET", lookup+"?user_id="+f.ids["c"], tokA, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("lookup id: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "GET", lookup, tokA, nil)
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("lookup empty: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "GET", lookup+"?email=nobody@example.com", tokA, nil)
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("lookup unknown: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "GET", blockBase, tokA, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("block status: %d %v", res.StatusCode, out)
	}
	if out["blocked_by_me"] != false {
		t.Fatalf("blocked_by_me = %v", out)
	}

	res, out = doJSON(t, srv, "POST", blockBase, tokA, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("block: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "GET", blockBase, tokA, nil)
	if res.StatusCode != http.StatusOK || out["blocked_by_me"] != true {
		t.Fatalf("blocked status: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "DELETE", blockBase, tokA, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("unblock: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "GET", "/api/v1/workspaces/"+f.wsID+"/chat/nicknames", tokA, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("list nicknames: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "PUT", nickBase, tokA, map[string]string{"nickname": "Bee"})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("set nickname: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "GET", "/api/v1/workspaces/"+f.wsID+"/chat/nicknames", tokA, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("list nicknames again: %d %v", res.StatusCode, out)
	}
	if out["nicknames"].(map[string]any)[f.ids["b"]] != "Bee" {
		t.Fatalf("nicknames = %v", out)
	}
	res, out = doJSON(t, srv, "PUT", nickBase, tokA, map[string]string{"nickname": ""})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("clear nickname: %d %v", res.StatusCode, out)
	}
}

func TestChatMedia(t *testing.T) {
	f := setupChatFixture(t, "media")
	srv, tok := f.srv, f.tokens["a"]
	wsBase := "/api/v1/workspaces/" + f.wsID + "/chat"

	for _, path := range []string{
		wsBase + "/gifs/search?q=hi",
		wsBase + "/gifs/trending",
		wsBase + "/stickers/search?q=hi",
		wsBase + "/stickers/trending",
		wsBase + "/media/status",
	} {
		res, out := doJSON(t, srv, "GET", path, tok, nil)
		if res.StatusCode != http.StatusOK {
			t.Fatalf("GET %s: %d %v", path, res.StatusCode, out)
		}
	}
}

func TestChatSignals(t *testing.T) {
	f := setupChatFixture(t, "signal")
	srv := f.srv
	tokA := f.tokens["a"]
	voiceBase := "/api/v1/workspaces/" + f.wsID + "/chat/rooms/" + f.groupRoomID + "/voice"
	callID := "550e8400-e29b-41d4-a716-446655440001"

	res, out := doJSON(t, srv, "POST", "/api/v1/workspaces/"+f.wsID+"/chat/rooms/"+f.groupRoomID+"/typing", tokA, nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("typing: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "POST", voiceBase+"/invite", tokA, map[string]string{"call_id": callID})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("voice invite: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "GET", "/api/v1/workspaces/"+f.wsID+"/chat/voice/pending", f.tokens["b"], nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("pending invites: %d %v", res.StatusCode, out)
	}
	if _, ok := out["invites"]; !ok {
		t.Fatalf("missing invites: %v", out)
	}

	res, out = doJSON(t, srv, "POST", voiceBase+"/accept", f.tokens["b"], map[string]string{"call_id": callID})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("voice accept: %d %v", res.StatusCode, out)
	}

	dur := 60
	res, out = doJSON(t, srv, "POST", voiceBase+"/hangup", tokA, map[string]any{"call_id": callID, "duration_seconds": &dur})
	if res.StatusCode != http.StatusOK {
		t.Fatalf("voice hangup: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "POST", "/api/v1/chat/voice/token", tokA, map[string]string{"room_id": f.groupRoomID, "call_id": callID})
	if res.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("voice token unconfigured: %d %v", res.StatusCode, out)
	}
}

func TestChatOutsiderForbidden(t *testing.T) {
	f := setupChatFixture(t, "outsider")
	srv := f.srv
	outTok, _ := registerChatUser(t, srv, "chat-outsider@example.com", "Outsider")

	res, out := doJSON(t, srv, "GET", "/api/v1/workspaces/"+f.wsID+"/chat/rooms", outTok, nil)
	if res.StatusCode != http.StatusForbidden && res.StatusCode != http.StatusNotFound {
		t.Fatalf("outsider rooms: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "GET", roomMessagesPath(f, f.groupRoomID), outTok, nil)
	if res.StatusCode != http.StatusForbidden && res.StatusCode != http.StatusNotFound {
		t.Fatalf("outsider messages: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "POST", roomMessagesPath(f, f.groupRoomID), outTok, map[string]string{"body": "hi"})
	if res.StatusCode != http.StatusForbidden && res.StatusCode != http.StatusNotFound {
		t.Fatalf("outsider send: %d %v", res.StatusCode, out)
	}
}
