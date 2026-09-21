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

	res, out = doJSON(t, srv, "POST", base+"/send", token, map[string]string{
		"account_id": "acc-1", "to": "a@b.co", "subject": "Hi", "body_text": "Hello",
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
		SentAt: pgtype.Timestamptz{Time: time.Now().UTC(), Valid: true},
	}); err != nil {
		t.Fatal(err)
	}

	res, out = doJSON(t, srv, "GET", base+"/threads?account_id="+accID+"&folder=INBOX", token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("list threads: %d %v", res.StatusCode, out)
	}
	if len(jsonArrayAt(t, out, "threads")) != 1 {
		t.Fatalf("expected one thread, got %v", out["threads"])
	}

	res, out = doJSON(t, srv, "GET", base+"/threads/"+threadID+"?account_id="+accID, token, nil)
	if res.StatusCode != 200 {
		t.Fatalf("get thread: %d %v", res.StatusCode, out)
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
