package handler

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/files/filesfake"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func TestCollaborationHTTPRoundTrip(t *testing.T) {
	srv, token, wsID, _ := suiteMutationWorld(t)

	res, body := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/tasks", token, map[string]any{
		"title": "Collab HTTP",
	})
	if res.StatusCode != 200 && res.StatusCode != 201 {
		t.Fatalf("create task: %d %v", res.StatusCode, body)
	}
	taskID, _ := body["task"].(map[string]any)["id"].(string)
	if taskID == "" {
		t.Fatalf("task = %v", body)
	}

	res, body = doJSON(t, srv, "POST", "/api/v1/tasks/"+taskID+"/comments", token, map[string]any{
		"body": "parent",
	})
	if res.StatusCode != 200 {
		t.Fatalf("create comment: %d %v", res.StatusCode, body)
	}
	parentID, _ := body["comment"].(map[string]any)["id"].(string)

	res, body = doJSON(t, srv, "POST", "/api/v1/tasks/"+taskID+"/comments", token, map[string]any{
		"body": "reply", "parent_id": parentID,
	})
	if res.StatusCode != 200 {
		t.Fatalf("reply: %d %v", res.StatusCode, body)
	}
	if body["comment"].(map[string]any)["parent_id"] != parentID {
		t.Fatalf("reply parent = %v", body)
	}
	replyID, _ := body["comment"].(map[string]any)["id"].(string)

	res, body = doJSON(t, srv, "GET", "/api/v1/tasks/"+taskID+"/comments", token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("list comments: %d %v", res.StatusCode, body)
	}
	comments, _ := body["comments"].([]any)
	found := false
	for _, raw := range comments {
		c, _ := raw.(map[string]any)
		if c["id"] != replyID {
			continue
		}
		found = true
		if c["parent_id"] != parentID {
			t.Fatalf("list reply parent_id = %v", c)
		}
		if c["type"] == nil || c["type"] == "" {
			t.Fatalf("list reply missing type: %v", c)
		}
		if c["display_name"] == nil || c["display_name"] == "" {
			t.Fatalf("list reply missing display_name: %v", c)
		}
		author, _ := c["author"].(map[string]any)
		if author["display_name"] == nil || author["display_name"] == "" {
			t.Fatalf("list reply author = %v", author)
		}
	}
	if !found {
		t.Fatalf("list missing reply: %v", body)
	}

	res, body = doJSON(t, srv, "POST", "/api/v1/comments/"+parentID+"/resolve", token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("resolve: %d %v", res.StatusCode, body)
	}
	if body["comment"].(map[string]any)["resolved_at"] == nil {
		t.Fatalf("resolved = %v", body)
	}

	res, body = doJSON(t, srv, "POST", "/api/v1/comments/"+parentID+"/reactions", token, map[string]any{
		"emoji": "👍",
	})
	if res.StatusCode != 200 {
		t.Fatalf("reaction: %d %v", res.StatusCode, body)
	}

	res, body = doJSON(t, srv, "POST", "/api/v1/tasks/"+taskID+"/reactions", token, map[string]any{
		"emoji": "❤️",
	})
	if res.StatusCode != 200 {
		t.Fatalf("task reaction: %d %v", res.StatusCode, body)
	}
	res, body = doJSON(t, srv, "GET", "/api/v1/tasks/"+taskID, token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("get task with reactions: %d %v", res.StatusCode, body)
	}
	task, _ := body["task"].(map[string]any)
	reactions, _ := task["reactions"].([]any)
	if len(reactions) != 1 {
		t.Fatalf("task reactions = %v", task["reactions"])
	}

	res, body = doJSON(t, srv, "POST", "/api/v1/tasks/"+taskID+"/subscribe", token, map[string]any{})
	if res.StatusCode != 200 {
		t.Fatalf("subscribe: %d %v", res.StatusCode, body)
	}
	res, body = doJSON(t, srv, "GET", "/api/v1/tasks/"+taskID+"/subscribers", token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("list subscribers: %d %v", res.StatusCode, body)
	}
	subs, _ := body["subscribers"].([]any)
	if len(subs) < 1 {
		t.Fatalf("subscribers = %v", body)
	}

	res, body = doJSON(t, srv, "GET", "/api/v1/tasks/"+taskID+"/attachments", token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("attachments list status = %d %v", res.StatusCode, body)
	}
	atts, _ := body["attachments"].([]any)
	if len(atts) != 0 {
		t.Fatalf("attachments list = %v", body)
	}

	const fakeAttachment = "01J8X4ATTN1P2Q3R4S5T6U7V8"
	res, body = doJSON(t, srv, http.MethodGet, "/api/v1/attachments/"+fakeAttachment, token, nil)
	if res.StatusCode != 404 {
		t.Fatalf("get missing attachment status = %d %v", res.StatusCode, body)
	}
	res, body = doJSON(t, srv, http.MethodDelete, "/api/v1/attachments/"+fakeAttachment, token, nil)
	if res.StatusCode != 404 {
		t.Fatalf("delete missing attachment status = %d %v", res.StatusCode, body)
	}
	for _, p := range []struct {
		method, path string
	}{
		{http.MethodGet, "/api/v1/comments/" + parentID + "/sub-task-preview"},
		{http.MethodPost, "/api/v1/comments/" + parentID + "/sub-tasks"},
		{http.MethodPost, "/api/v1/tasks/" + taskID + "/comments/trigger-preview"},
	} {
		res, body = doJSON(t, srv, p.method, p.path, token, nil)
		if res.StatusCode != 422 {
			t.Fatalf("%s %s status = %d %v", p.method, p.path, res.StatusCode, body)
		}
		errObj, _ := body["error"].(map[string]any)
		if errObj["code"] != "capability_unavailable" {
			t.Fatalf("%s %s code = %v", p.method, p.path, body)
		}
	}
}

func TestListCommentsEmbedsReactions(t *testing.T) {
	srv, token, wsID, _ := suiteMutationWorld(t)

	res, body := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/tasks", token, map[string]any{
		"title": "Reaction HTTP",
	})
	if res.StatusCode != 200 && res.StatusCode != 201 {
		t.Fatalf("create task: %d %v", res.StatusCode, body)
	}
	taskID, _ := body["task"].(map[string]any)["id"].(string)

	res, body = doJSON(t, srv, "POST", "/api/v1/tasks/"+taskID+"/comments", token, map[string]any{
		"body": "một",
	})
	if res.StatusCode != 200 {
		t.Fatalf("create comment: %d %v", res.StatusCode, body)
	}
	commentID, _ := body["comment"].(map[string]any)["id"].(string)

	res, body = doJSON(t, srv, "POST", "/api/v1/comments/"+commentID+"/reactions", token, map[string]any{
		"emoji": "👍",
	})
	if res.StatusCode != 200 {
		t.Fatalf("add reaction: %d %v", res.StatusCode, body)
	}

	res, body = doJSON(t, srv, "GET", "/api/v1/tasks/"+taskID+"/comments", token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("list comments: %d %v", res.StatusCode, body)
	}
	comments, _ := body["comments"].([]any)
	if len(comments) != 1 {
		t.Fatalf("comments = %v", body)
	}
	first, _ := comments[0].(map[string]any)
	reactions, ok := first["reactions"].([]any)
	if !ok {
		t.Fatalf("reactions thiếu hoặc null: %v", first)
	}
	if len(reactions) != 1 {
		t.Fatalf("reactions = %v, want 1", reactions)
	}
	if reactions[0].(map[string]any)["emoji"] != "👍" {
		t.Fatalf("emoji = %v", reactions[0])
	}
}

func TestListCommentsWithoutReactionsReturnsEmptyArrayNotNull(t *testing.T) {
	srv, token, wsID, _ := suiteMutationWorld(t)

	_, body := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/tasks", token, map[string]any{
		"title": "No reaction",
	})
	taskID, _ := body["task"].(map[string]any)["id"].(string)
	doJSON(t, srv, "POST", "/api/v1/tasks/"+taskID+"/comments", token, map[string]any{"body": "một"})

	_, body = doJSON(t, srv, "GET", "/api/v1/tasks/"+taskID+"/comments", token, nil)
	comments, _ := body["comments"].([]any)
	first, _ := comments[0].(map[string]any)
	reactions, ok := first["reactions"].([]any)
	if !ok {
		t.Fatalf("reactions phải là mảng rỗng, không phải null: %v", first)
	}
	if len(reactions) != 0 {
		t.Fatalf("reactions = %v, want rỗng", reactions)
	}
}

func TestCreateCommentReactionsIsEmptyArrayNotNull(t *testing.T) {
	srv, token, wsID, _ := suiteMutationWorld(t)

	_, body := doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/tasks", token, map[string]any{
		"title": "Create path reactions",
	})
	taskID, _ := body["task"].(map[string]any)["id"].(string)

	res, body := doJSON(t, srv, "POST", "/api/v1/tasks/"+taskID+"/comments", token, map[string]any{
		"body": "một",
	})
	if res.StatusCode != 200 {
		t.Fatalf("create comment: %d %v", res.StatusCode, body)
	}
	comment, _ := body["comment"].(map[string]any)
	reactions, ok := comment["reactions"].([]any)
	if !ok {
		t.Fatalf("reactions phải là mảng rỗng, không phải null: %v", comment)
	}
	if len(reactions) != 0 {
		t.Fatalf("reactions = %v, want rỗng", reactions)
	}
}

// A task comment author whose photo lives in FileService carries the resolved
// avatar_url in the list answer, like the single-comment answer.
func TestTaskCommentListResolvesFileBackedAvatar(t *testing.T) {
	d, pool := newTestDeps(t, nil, discardOutbox{})
	fake := filesfake.New(filesfake.Options{})
	d.Actors.SetFiles(fake)
	q := db.New(pool)
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)

	res, out := doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": "task-avatar@example.com", "password": "password123", "display_name": "Task Avatar",
	})
	if res.StatusCode != 200 {
		t.Fatalf("register: %d %v", res.StatusCode, out)
	}
	token := out["access_token"].(string)
	userID := out["user"].(map[string]any)["id"].(string)
	verifyEmail(t, srv, token)
	res, out = doJSON(t, srv, "POST", "/api/v1/orgs", token, map[string]string{"name": "Avatar Org", "slug": "avatar-org"})
	if res.StatusCode != 201 {
		t.Fatalf("create org: %d %v", res.StatusCode, out)
	}
	orgID := out["organization"].(map[string]any)["id"].(string)
	res, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+orgID+"/workspaces", token, map[string]string{"name": "Avatar WS", "slug": "avatar-ws"})
	if res.StatusCode != 201 {
		t.Fatalf("create ws: %d %v", res.StatusCode, out)
	}
	wsID := out["workspace"].(map[string]any)["id"].(string)
	res, out = doJSON(t, srv, "POST", "/api/v1/workspaces/"+wsID+"/tasks", token, map[string]any{"title": "Avatars"})
	if res.StatusCode != 200 && res.StatusCode != 201 {
		t.Fatalf("create task: %d %v", res.StatusCode, out)
	}
	taskID := out["task"].(map[string]any)["id"].(string)
	res, out = doJSON(t, srv, "POST", "/api/v1/tasks/"+taskID+"/comments", token, map[string]any{"body": "hello"})
	if res.StatusCode != 200 {
		t.Fatalf("create comment: %d %v", res.StatusCode, out)
	}

	up, err := fake.Upload(context.Background(), files.UploadInput{
		Actor: service.Human(userID), Purpose: files.UserAvatar,
		Scope:          files.Scope{UserID: userID},
		IdempotencyKey: "task-comment-avatar", Filename: "me.png", Body: bytes.NewReader(tinyPNG),
	})
	if err != nil {
		t.Fatalf("upload avatar: %v", err)
	}
	if _, err := q.UpdateUserAvatarFile(context.Background(), db.UpdateUserAvatarFileParams{
		ID: userID, AvatarFileID: pgtype.Text{String: string(up.File.ID), Valid: true},
	}); err != nil {
		t.Fatalf("attach avatar: %v", err)
	}

	res, out = doJSON(t, srv, "GET", "/api/v1/tasks/"+taskID+"/comments", token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("list comments: %d %v", res.StatusCode, out)
	}
	comments, _ := out["comments"].([]any)
	if len(comments) != 1 {
		t.Fatalf("comments = %v", comments)
	}
	got, _ := comments[0].(map[string]any)["avatar_url"].(string)
	if want := "fake://presign/" + string(up.File.ID); got != want {
		t.Errorf("avatar_url = %q, want the resolved file URL %q", got, want)
	}
}
