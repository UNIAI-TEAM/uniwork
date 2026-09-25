package handler

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/emailhub"
	"github.com/unicomhub/uniwork/server/internal/service"
	"github.com/unicomhub/uniwork/server/internal/util"
	"github.com/unicomhub/uniwork/server/internal/util/secretbox"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

func testEmailHubSecretBox(t *testing.T) *secretbox.Box {
	t.Helper()
	key := make([]byte, secretbox.KeySize)
	if _, err := rand.Read(key); err != nil {
		t.Fatal(err)
	}
	box, err := secretbox.New(key)
	if err != nil {
		t.Fatal(err)
	}
	return box
}

func jsonArrayAt(t *testing.T, out map[string]any, key string) []any {
	t.Helper()
	raw, ok := out[key]
	if !ok || raw == nil {
		t.Fatalf("response missing %q: %v", key, out)
	}
	arr, ok := raw.([]any)
	if !ok {
		t.Fatalf("response[%q] type = %T, want []any", key, raw)
	}
	return arr
}

func setupEmailHubHTTP(t *testing.T) (*httptest.Server, string, string, string, *secretbox.Box) {
	t.Helper()
	d, pool := newTestDeps(t, nil, discardOutbox{})
	box := testEmailHubSecretBox(t)
	q := db.New(pool)
	d.EmailHub = service.NewEmailHubService(q, d.Workspaces, box)
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)

	res, out := doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": "eh-http@example.com", "password": "password123", "display_name": "EH HTTP",
	})
	if res.StatusCode != 200 {
		t.Fatalf("register: %d %v", res.StatusCode, out)
	}
	token := out["access_token"].(string)
	userID := out["user"].(map[string]any)["id"].(string)
	verifyEmail(t, srv, token)

	tag := strings.ToLower(util.NewID()[:8])
	res, out = doJSON(t, srv, "POST", "/api/v1/orgs", token, map[string]string{
		"name": "EH Org", "slug": "eh-http-org-" + tag,
	})
	if res.StatusCode != 201 {
		t.Fatalf("create org: %d %v", res.StatusCode, out)
	}
	orgID := out["organization"].(map[string]any)["id"].(string)
	res, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+orgID+"/workspaces", token, map[string]string{
		"name": "EH Team", "slug": "eh-http-team-" + tag,
	})
	if res.StatusCode != 201 {
		t.Fatalf("create ws: %d %v", res.StatusCode, out)
	}
	wsID := out["workspace"].(map[string]any)["id"].(string)
	return srv, token, wsID, userID, box
}

func TestEmailHubEndpointsWhenNotConfigured(t *testing.T) {
	d, _ := newTestDeps(t, nil, discardOutbox{})
	srv := httptest.NewServer(New(d))
	t.Cleanup(srv.Close)

	res, out := doJSON(t, srv, "POST", "/api/v1/auth/register", "", map[string]string{
		"email": "owner@example.com", "password": "password123", "display_name": "Owner",
	})
	if res.StatusCode != 200 {
		t.Fatalf("register: %d %v", res.StatusCode, out)
	}
	token := out["access_token"].(string)
	verifyEmail(t, srv, token)

	res, out = doJSON(t, srv, "POST", "/api/v1/orgs", token, map[string]string{"name": "Unicom", "slug": "unicom"})
	if res.StatusCode != 201 {
		t.Fatalf("create org: %d %v", res.StatusCode, out)
	}
	orgID := out["organization"].(map[string]any)["id"].(string)
	res, out = doJSON(t, srv, "POST", "/api/v1/orgs/"+orgID+"/workspaces", token, map[string]string{"name": "Team", "slug": "team"})
	if res.StatusCode != 201 {
		t.Fatalf("create ws: %d %v", res.StatusCode, out)
	}
	wsID := out["workspace"].(map[string]any)["id"].(string)
	base := "/api/v1/workspaces/" + wsID + "/email-hub"

	res, out = doJSON(t, srv, "GET", base+"/accounts", token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("list accounts: %d %v", res.StatusCode, out)
	}
	if len(jsonArrayAt(t, out, "accounts")) != 0 {
		t.Fatalf("expected empty accounts, got %v", out["accounts"])
	}

	res, out = doJSON(t, srv, "POST", base+"/accounts", token, map[string]string{
		"email_address": "user@gmail.com", "app_password": "secret",
	})
	if res.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("connect status: %d %v", res.StatusCode, out)
	}
	if errorCode(out) != "email_hub_not_configured" {
		t.Fatalf("connect code: %v", out["error"])
	}

	res, out = doJSON(t, srv, "POST", base+"/send", token, map[string]any{
		"account_id": "acc-1", "to": []string{"a@b.co"}, "subject": "Hi", "body_text": "Hello",
	})
	if res.StatusCode != http.StatusServiceUnavailable || errorCode(out) != "email_hub_not_configured" {
		t.Fatalf("send: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "POST", base+"/watch", token, nil)
	if res.StatusCode != 400 {
		t.Fatalf("watch missing account_id: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "POST", base+"/watch?account_id=missing", token, nil)
	if res.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("watch not configured: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "POST", base+"/inbox-watch?account_id=missing", token, nil)
	if res.StatusCode != http.StatusServiceUnavailable || errorCode(out) != "email_hub_not_configured" {
		t.Fatalf("inbox-watch subscribe not configured: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "DELETE", base+"/inbox-watch?account_id=missing", token, nil)
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("inbox-watch unsubscribe missing account: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "PATCH", base+"/threads/thread-1", token, map[string]any{
		"account_id": "acc-1",
	})
	if res.StatusCode != 400 {
		t.Fatalf("patch missing fields: %d %v", res.StatusCode, out)
	}

	res, _ = doJSON(t, srv, "GET", base+"/threads/thread-1/attachments/att-1", token, nil)
	if res.StatusCode != 400 {
		t.Fatalf("download missing account_id: %d", res.StatusCode)
	}

	res, out = doJSON(t, srv, "GET", base+"/scheduled-sends?account_id=acc-1", token, nil)
	if res.StatusCode != http.StatusServiceUnavailable || errorCode(out) != "email_hub_not_configured" {
		t.Fatalf("list scheduled not configured: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "DELETE", base+"/scheduled-sends/01SCHD00000000000000000001?account_id=acc-1", token, nil)
	if res.StatusCode != http.StatusServiceUnavailable || errorCode(out) != "email_hub_not_configured" {
		t.Fatalf("cancel scheduled not configured: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "POST", base+"/scheduled-sends/01SCHD00000000000000000001/retry?account_id=acc-1", token, nil)
	if res.StatusCode != http.StatusServiceUnavailable || errorCode(out) != "email_hub_not_configured" {
		t.Fatalf("retry scheduled not configured: %d %v", res.StatusCode, out)
	}
}

func TestEmailHubConfiguredHTTP(t *testing.T) {
	srv, token, wsID, userID, box := setupEmailHubHTTP(t)
	base := "/api/v1/workspaces/" + wsID + "/email-hub"
	ctx := context.Background()
	q := db.New(testPool)
	orgID := orgIDFromWorkspace(t, q, wsID)

	res, out := doJSON(t, srv, "POST", base+"/accounts", token, map[string]string{
		"email_address": "user@unknown.example", "app_password": "secret",
	})
	if res.StatusCode != http.StatusBadRequest || errorCode(out) != "email_hub_unsupported" {
		t.Fatalf("unsupported provider: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "POST", base+"/accounts", token, map[string]string{
		"email_address": "user@gmail.com",
	})
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("connect missing password: %d %v", res.StatusCode, out)
	}

	sealed, err := box.Seal([]byte("app-password"))
	if err != nil {
		t.Fatal(err)
	}
	accID := util.NewID()
	if _, err := q.CreateEmailHubAccount(ctx, db.CreateEmailHubAccountParams{
		ID: accID, UserID: userID, OrganizationID: orgID,
		EmailAddress: "seed@gmail.com", Provider: "gmail",
		ImapHost: "127.0.0.1", ImapPort: 1,
		SmtpHost: "127.0.0.1", SmtpPort: 1,
		PasswordEnc: base64.StdEncoding.EncodeToString(sealed),
	}); err != nil {
		t.Fatal(err)
	}
	seeded, err := q.ListEmailHubAccountsByUser(ctx, db.ListEmailHubAccountsByUserParams{
		UserID: userID, OrganizationID: orgID,
	})
	if err != nil || len(seeded) != 1 {
		t.Fatalf("seed account: err=%v len=%d", err, len(seeded))
	}

	res, out = doJSON(t, srv, "GET", base+"/accounts", token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("list accounts: %d %v", res.StatusCode, out)
	}
	if len(jsonArrayAt(t, out, "accounts")) != 1 {
		t.Fatalf("expected one account, got %v", out["accounts"])
	}

	threadID := util.NewID()
	if _, err := q.UpsertEmailHubThread(ctx, db.UpsertEmailHubThreadParams{
		ID: threadID, AccountID: accID, OrganizationID: orgID,
		Folder: emailhub.FolderInbox, ImapUid: 7, Subject: "Hi", Snippet: "hi",
		FromAddr: "a@b.co", ToAddrs: []string{"seed@gmail.com"},
		SentAt:     pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true},
		ImapLabels: []string{}, ConversationKey: "",
	}); err != nil {
		t.Fatal(err)
	}

	res, out = doJSON(t, srv, "GET", base+"/threads?account_id="+accID+"&folder=INBOX", token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("list threads: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "GET", base+"/threads?account_id="+accID+"&folder=INBOX&query=Hi", token, nil)
	if res.StatusCode != 200 || len(jsonArrayAt(t, out, "threads")) != 1 {
		t.Fatalf("list threads with query: %d %v", res.StatusCode, out)
	}
	if len(jsonArrayAt(t, out, "threads")) != 1 {
		t.Fatalf("expected one thread, got %v", out["threads"])
	}

	res, out = doJSON(t, srv, "GET", base+"/threads/"+threadID+"?account_id="+accID, token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("get thread: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "GET", base+"/threads/"+threadID+"?account_id="+accID+"&mark_read=1", token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("get thread mark_read: %d %v", res.StatusCode, out)
	}
	if out["is_read"] != true {
		t.Fatalf("expected thread marked read: %v", out["is_read"])
	}

	res, out = doJSON(t, srv, "PATCH", base+"/threads/"+threadID, token, map[string]any{
		"account_id": accID, "is_read": true,
	})
	if res.StatusCode != 200 {
		t.Fatalf("patch read: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "PATCH", base+"/threads/"+threadID, token, map[string]any{
		"account_id": accID, "is_starred": true,
	})
	if res.StatusCode != 200 {
		t.Fatalf("patch starred: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "GET", base+"/threads?account_id="+accID+"&folder=INBOX&limit=10&unread=1", token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("list unread: %d %v", res.StatusCode, out)
	}
	if len(jsonArrayAt(t, out, "threads")) != 0 {
		t.Fatalf("expected no unread threads after mark_read, got %v", out["threads"])
	}

	res, _ = doJSON(t, srv, "GET", base+"/threads/"+threadID+"/attachments/missing?account_id="+accID, token, nil)
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("download missing attachment: %d", res.StatusCode)
	}

	res, out = doJSON(t, srv, "POST", base+"/inbox-watch?account_id="+accID, token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("inbox-watch subscribe: %d %v", res.StatusCode, out)
	}
	res, out = doJSON(t, srv, "DELETE", base+"/inbox-watch?account_id="+accID, token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("inbox-watch unsubscribe: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "POST", base+"/sync?account_id="+accID+"&folder=INBOX&force=1", token, nil)
	if res.StatusCode < 400 {
		t.Fatalf("sync without IMAP should fail: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "POST", base+"/send", token, map[string]any{
		"account_id": accID, "to": []string{"dest@example.com"}, "subject": "Hi", "body_text": "Hello",
	})
	if res.StatusCode != http.StatusBadGateway || errorCode(out) != "email_hub_send_failed" {
		t.Fatalf("send without SMTP: %d %v", res.StatusCode, out)
	}

	sendAt := time.Now().UTC().Add(3 * time.Minute).Format(time.RFC3339)
	res, out = doJSON(t, srv, "POST", base+"/send", token, map[string]any{
		"account_id": accID, "to": []string{"later@example.com"}, "subject": "Later", "body_text": "Queued",
		"send_at": sendAt,
	})
	if res.StatusCode != http.StatusAccepted || out["scheduled"] != true {
		t.Fatalf("schedule send: %d %v", res.StatusCode, out)
	}
	scheduledID, _ := out["id"].(string)
	if scheduledID == "" {
		t.Fatalf("missing scheduled id: %v", out)
	}

	res, out = doJSON(t, srv, "GET", base+"/scheduled-sends?account_id="+accID, token, nil)
	if res.StatusCode != 200 || len(jsonArrayAt(t, out, "scheduled")) != 1 {
		t.Fatalf("list scheduled: %d %v", res.StatusCode, out)
	}

	res, _ = doJSON(t, srv, "GET", base+"/scheduled-sends?account_id="+util.NewID(), token, nil)
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("list scheduled unknown account: %d", res.StatusCode)
	}

	res, _ = doJSON(t, srv, "GET", base+"/scheduled-sends", token, nil)
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("list scheduled missing account_id: %d", res.StatusCode)
	}

	res, _ = doJSON(t, srv, "DELETE", base+"/scheduled-sends/"+scheduledID+"?account_id="+accID, token, nil)
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("cancel scheduled: %d", res.StatusCode)
	}

	res, _ = doJSON(t, srv, "DELETE", base+"/scheduled-sends/"+scheduledID+"?account_id="+accID, token, nil)
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("cancel scheduled twice: %d", res.StatusCode)
	}

	res, _ = doJSON(t, srv, "DELETE", base+"/scheduled-sends/"+util.NewID(), token, nil)
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("cancel scheduled missing account_id: %d", res.StatusCode)
	}

	// A send the worker gave up on stays listed (failed first) until retried
	// or dismissed; last_error is never exposed.
	failedID := util.NewID()
	if _, err := q.CreateEmailHubScheduledSend(ctx, db.CreateEmailHubScheduledSendParams{
		ID: failedID, WorkspaceID: wsID, AccountID: accID, OrganizationID: orgID, UserID: userID,
		Payload: []byte(`{"to":["x@example.com"],"subject":"Broke","body_text":"x"}`),
		SendAt:  pgtype.Timestamptz{Time: time.Now().UTC().Add(-time.Minute), Valid: true},
	}); err != nil {
		t.Fatal(err)
	}
	if err := q.MarkEmailHubScheduledSendFailed(ctx, db.MarkEmailHubScheduledSendFailedParams{
		ID: failedID, LastError: pgtype.Text{String: "smtp: boom", Valid: true},
	}); err != nil {
		t.Fatal(err)
	}
	res, out = doJSON(t, srv, "GET", base+"/scheduled-sends?account_id="+accID, token, nil)
	scheduled := jsonArrayAt(t, out, "scheduled")
	if res.StatusCode != 200 || len(scheduled) != 1 {
		t.Fatalf("list failed scheduled: %d %v", res.StatusCode, out)
	}
	item, _ := scheduled[0].(map[string]any)
	if item["id"] != failedID || item["status"] != "failed" {
		t.Fatalf("failed item: %v", item)
	}
	if _, leaked := item["last_error"]; leaked {
		t.Fatalf("last_error must not be exposed: %v", item)
	}
	res, _ = doJSON(t, srv, "POST", base+"/scheduled-sends/"+failedID+"/retry", token, nil)
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("retry missing account_id: %d", res.StatusCode)
	}
	res, _ = doJSON(t, srv, "POST", base+"/scheduled-sends/"+failedID+"/retry?account_id="+accID, token, nil)
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("retry failed scheduled: %d", res.StatusCode)
	}
	res, _ = doJSON(t, srv, "POST", base+"/scheduled-sends/"+failedID+"/retry?account_id="+accID, token, nil)
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("retry pending scheduled: %d", res.StatusCode)
	}
	res, _ = doJSON(t, srv, "POST", base+"/scheduled-sends/"+scheduledID+"/retry?account_id="+accID, token, nil)
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("retry cancelled scheduled: %d", res.StatusCode)
	}
	if err := q.MarkEmailHubScheduledSendFailed(ctx, db.MarkEmailHubScheduledSendFailedParams{
		ID: failedID, LastError: pgtype.Text{String: "smtp: boom", Valid: true},
	}); err != nil {
		t.Fatal(err)
	}
	res, _ = doJSON(t, srv, "DELETE", base+"/scheduled-sends/"+failedID+"?account_id="+accID, token, nil)
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("dismiss failed scheduled: %d", res.StatusCode)
	}

	res, out = doJSON(t, srv, "POST", base+"/send", token, map[string]any{
		"account_id": accID, "to": []string{"bad@example.com"}, "subject": "Bad attach", "body_text": "x",
		"attachments": []map[string]string{{"filename": "a.txt", "content_base64": "!!!"}},
	})
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("send bad attachment: %d %v", res.StatusCode, out)
	}

	res, out = doJSON(t, srv, "POST", base+"/send", token, map[string]any{
		"account_id": accID, "to": []string{"bad@example.com"}, "subject": "Bad time", "body_text": "x",
		"send_at": "not-rfc3339",
	})
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad send_at: %d %v", res.StatusCode, out)
	}

	res, _ = doJSON(t, srv, "PATCH", base+"/threads/"+threadID, token, map[string]any{
		"account_id": accID, "move_to": "ARCHIVE",
	})
	if res.StatusCode == http.StatusNoContent {
		t.Fatal("move should fail without reachable IMAP")
	}

	res, _ = doJSON(t, srv, "DELETE", base+"/accounts/"+accID, token, nil)
	if res.StatusCode != http.StatusNoContent {
		t.Fatalf("disconnect: %d", res.StatusCode)
	}
}

func orgIDFromWorkspace(t *testing.T, q *db.Queries, wsID string) string {
	t.Helper()
	ws, err := q.GetWorkspaceByID(context.Background(), wsID)
	if err != nil {
		t.Fatal(err)
	}
	return ws.OrganizationID
}
