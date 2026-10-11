package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/emailhub"
	"github.com/unicomhub/uniwork/server/internal/emailhub/imapclient"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// seedCustomServerEmailHubAccount stores me@example.com on its own server
// (mail.example.com, IMAP 993 tls, SMTP 587 starttls) with an INBOX cursor,
// then puts it in needs_reconnect so Connect may move or refresh it.
func seedCustomServerEmailHubAccount(t *testing.T, svc *EmailHubService, q *db.Queries, userID, orgID string) db.EmailHubAccount {
	t.Helper()
	ctx := context.Background()
	sealed, err := svc.box.Seal([]byte("old-password"))
	if err != nil {
		t.Fatal(err)
	}
	acc, err := q.CreateEmailHubAccount(ctx, db.CreateEmailHubAccountParams{
		ID: util.NewID(), UserID: userID, OrganizationID: orgID,
		EmailAddress: "me@example.com", Provider: "custom",
		ImapHost: "mail.example.com", ImapPort: 993, ImapSecurity: "tls",
		SmtpHost: "mail.example.com", SmtpPort: 587, SmtpSecurity: "starttls",
		AuthKind: "password", PasswordEnc: base64.StdEncoding.EncodeToString(sealed),
	})
	if err != nil {
		t.Fatal(err)
	}
	state, err := json.Marshal(emailHubSyncState{emailHubFolderInbox: {UIDValidity: 7, LastUID: 42}})
	if err != nil {
		t.Fatal(err)
	}
	if err := q.UpdateEmailHubAccountSyncState(ctx, db.UpdateEmailHubAccountSyncStateParams{
		ID: acc.ID, SyncState: state, OrganizationID: orgID, CredentialVersion: acc.CredentialVersion,
	}); err != nil {
		t.Fatal(err)
	}
	return markSeedAccountAuthFailed(t, q, acc)
}

func emailHubCacheCounts(t *testing.T, pool *pgxpool.Pool, accountID string) (threads, attachments, summaries int) {
	t.Helper()
	if err := pool.QueryRow(context.Background(), `SELECT
		(SELECT count(*) FROM email_hub_threads WHERE account_id = $1),
		(SELECT count(*) FROM email_hub_attachments WHERE account_id = $1),
		(SELECT count(*) FROM email_hub_thread_ai_summaries WHERE account_id = $1)`, accountID,
	).Scan(&threads, &attachments, &summaries); err != nil {
		t.Fatal(err)
	}
	return threads, attachments, summaries
}

// A reconnect onto another IMAP server keeps the id but drops everything
// cached from the old one before the first sync (spec §3): UIDs and
// UIDVALIDITY mean nothing on the new server.
func TestEmailHubReconnectToAnotherServerDropsTheCache(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	acc := seedCustomServerEmailHubAccount(t, svc, q, user.ID, ws.OrganizationID)
	thread := seedEmailHubThread(t, q, acc.ID, ws.OrganizationID)
	if _, err := q.CreateEmailHubAttachment(ctx, db.CreateEmailHubAttachmentParams{
		ID: util.NewID(), ThreadID: thread.ID, AccountID: acc.ID, OrganizationID: ws.OrganizationID,
		Filename: "a.pdf", MimeType: "application/pdf", SizeBytes: 10, PartID: "2",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := q.UpsertEmailHubThreadAiSummary(ctx, db.UpsertEmailHubThreadAiSummaryParams{
		ID: util.NewID(), OrganizationID: ws.OrganizationID, ThreadID: thread.ID, AccountID: acc.ID,
		Locale: "vi", SourceFingerprint: "fp", Summary: "old", KeyPoints: []byte("[]"), ActionItems: []byte("[]"),
		Model: "test", CreatedBy: user.ID, CreatedByKind: "human",
	}); err != nil {
		t.Fatal(err)
	}
	sendID := seedDueEmailHubScheduledSend(t, q, ws, user.ID, acc.ID)
	svc.gov.setMailboxes(acc.ID, imapclient.MailboxMap{emailhub.FolderSent: "INBOX.Sent"})
	watchCtx, stopWatch := context.WithCancel(ctx)
	defer stopWatch()
	svc.hubWatch.mu.Lock()
	svc.hubWatch.stop[acc.ID] = stopWatch // an IDLE loop on the old server
	svc.hubWatch.mu.Unlock()

	stubEmailHubDial(svc, nil)
	threadsAtSync, mailboxesAtSync := -1, true
	svc.testHookInitialSync = func(_ context.Context, row db.EmailHubAccount) {
		threadsAtSync, _, _ = emailHubCacheCounts(t, pool, row.ID)
		_, mailboxesAtSync = svc.gov.mailboxes(row.ID)
	}

	view, err := svc.Connect(ctx, Human(user.ID), ws.ID, ConnectEmailHubInput{
		EmailAddress: "me@example.com", AppPassword: "new-password",
		IMAPHost: "mail.newhost.example.net", IMAPPort: 993, IMAPSecurity: "tls",
		SMTPHost: "mail.newhost.example.net", SMTPPort: 587, SMTPSecurity: "starttls",
	})
	if err != nil {
		t.Fatal(err)
	}
	if view.ID != acc.ID {
		t.Fatalf("a server change must keep id %s, got %s", acc.ID, view.ID)
	}
	if threadsAtSync != 0 || mailboxesAtSync {
		t.Fatalf("the initial sync must start on an empty cache: threads=%d cached mailbox map=%v", threadsAtSync, mailboxesAtSync)
	}
	if threads, atts, sums := emailHubCacheCounts(t, pool, acc.ID); threads+atts+sums != 0 {
		t.Fatalf("old-server cache survived: threads=%d attachments=%d summaries=%d", threads, atts, sums)
	}
	if status, _ := scheduledSendOutcome(t, pool, sendID); status != "cancelled" {
		t.Fatalf("a pending scheduled send must be cancelled, got %q", status)
	}
	row, err := q.GetEmailHubAccountByID(ctx, acc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if string(row.SyncState) != "{}" || row.CredentialVersion != acc.CredentialVersion+1 || row.ImapHost != "mail.newhost.example.net" {
		t.Fatalf("row: sync_state=%s version=%d imap_host=%q", row.SyncState, row.CredentialVersion, row.ImapHost)
	}
	if watchCtx.Err() == nil {
		t.Fatal("a server change must stop the IDLE watcher of the old server")
	}
	if got := connectedServerChanged(t, pool, acc.ID); got != "true" {
		t.Fatalf("audit server_changed=%q, want true", got)
	}

	// Work that began against the old server (an IDLE round, a queued worker
	// sync) still holds the old snapshot: neither its threads nor its cursor land.
	ids, err := svc.upsertThreadItems(ctx, acc, emailhub.FolderInbox, []imapclient.ThreadMeta{
		{UID: 7, Subject: "from the old server", SentAt: time.Now().UTC()},
	})
	if err != nil || len(ids) != 0 {
		t.Fatalf("a stale snapshot wrote threads: ids=%v err=%v", ids, err)
	}
	if err := q.UpdateEmailHubAccountSyncState(ctx, db.UpdateEmailHubAccountSyncStateParams{
		ID: acc.ID, SyncState: acc.SyncState, OrganizationID: acc.OrganizationID, CredentialVersion: acc.CredentialVersion,
	}); err != nil {
		t.Fatal(err)
	}
	after, err := q.GetEmailHubAccountByID(ctx, acc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if threads, _, _ := emailHubCacheCounts(t, pool, acc.ID); threads != 0 || string(after.SyncState) != "{}" {
		t.Fatalf("stale writes landed: threads=%d sync_state=%s", threads, after.SyncState)
	}

	// A stale reconcile must not prune the new server's rows (UID 42 is absent
	// from the old server's list and above its minimum UID).
	seedEmailHubThread(t, q, acc.ID, ws.OrganizationID)
	if err := svc.cacheFolderItems(ctx, acc, emailhub.FolderInbox, []imapclient.ThreadMeta{
		{UID: 7, Subject: "old", SentAt: time.Now().UTC()},
	}, true); err != nil {
		t.Fatal(err)
	}
	if threads, _, _ := emailHubCacheCounts(t, pool, acc.ID); threads != 1 {
		t.Fatalf("a stale reconcile touched the new server's cache, threads=%d", threads)
	}

	// Body prefetch on the old snapshot would dial the old host and write the
	// old server's bodies onto the new rows: it must not even start.
	if n := svc.prefetchUncachedBodies(ctx, acc, emailhub.FolderInbox, 10); n != 0 {
		t.Fatalf("a stale prefetch cached %d bodies", n)
	}
	svc.scheduleBodyPrefetch(acc, emailhub.FolderInbox)
	if !svc.gov.tryBeginBodyPrefetch(acc.ID, emailhub.FolderInbox) {
		t.Fatal("a stale snapshot started a body prefetch goroutine")
	}
	svc.gov.endBodyPrefetch(acc.ID, emailhub.FolderInbox)
}

// assertEmailHubCacheKept checks a same-server reconnect: mail, cursor and
// mailbox map stay, only the credential moved on.
func assertEmailHubCacheKept(t *testing.T, svc *EmailHubService, q *db.Queries, pool *pgxpool.Pool, acc db.EmailHubAccount) {
	t.Helper()
	if threads, _, _ := emailHubCacheCounts(t, pool, acc.ID); threads != 1 {
		t.Fatalf("a same-server reconnect must keep the cache, threads=%d", threads)
	}
	row, err := q.GetEmailHubAccountByID(context.Background(), acc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got := parseEmailHubSyncState(row.SyncState).folder(emailHubFolderInbox); got.UIDValidity != 7 || got.LastUID != 42 {
		t.Fatalf("a same-server reconnect must keep sync_state, got %+v", got)
	}
	if row.CredentialVersion != acc.CredentialVersion+1 {
		t.Fatalf("credential_version=%d, want %d", row.CredentialVersion, acc.CredentialVersion+1)
	}
	if _, ok := svc.gov.mailboxes(acc.ID); !ok {
		t.Fatal("a same-server reconnect must keep the cached mailbox map")
	}
	if got := connectedServerChanged(t, pool, acc.ID); got != "false" {
		t.Fatalf("audit server_changed=%q, want false", got)
	}
}

// Only the IMAP server decides what the cache means: a new SMTP server, port
// or login name on the same IMAP server keeps every cached row (spec §3).
func TestEmailHubReconnectSameServerKeepsTheCache(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	acc := seedCustomServerEmailHubAccount(t, svc, q, user.ID, ws.OrganizationID)
	seedEmailHubThread(t, q, acc.ID, ws.OrganizationID)
	svc.gov.setMailboxes(acc.ID, imapclient.MailboxMap{emailhub.FolderSent: "INBOX.Sent"})
	stubEmailHubDial(svc, nil)

	if _, err := svc.Connect(context.Background(), Human(user.ID), ws.ID, ConnectEmailHubInput{
		EmailAddress: "me@example.com", AppPassword: "new-password",
		IMAPHost: "mail.example.com", IMAPPort: 993, IMAPSecurity: "tls",
		SMTPHost: "smtp.example.com", SMTPPort: 465, SMTPSecurity: "tls", Username: "me",
	}); err != nil {
		t.Fatal(err)
	}
	assertEmailHubCacheKept(t, svc, q, pool, acc)
}

// Hosts compare after normalization: a case or trailing-dot difference is the
// same server and must not wipe the cache.
func TestEmailHubReconnectHostCaseChangeIsNotAServerChange(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	acc := seedCustomServerEmailHubAccount(t, svc, q, user.ID, ws.OrganizationID)
	seedEmailHubThread(t, q, acc.ID, ws.OrganizationID)
	svc.gov.setMailboxes(acc.ID, imapclient.MailboxMap{emailhub.FolderSent: "INBOX.Sent"})
	stubEmailHubDial(svc, nil)

	if _, err := svc.Connect(context.Background(), Human(user.ID), ws.ID, ConnectEmailHubInput{
		EmailAddress: "me@example.com", AppPassword: "new-password",
		IMAPHost: "MAIL.Example.com.", IMAPPort: 993, IMAPSecurity: "tls",
		SMTPHost: "mail.example.com", SMTPPort: 587, SMTPSecurity: "starttls",
	}); err != nil {
		t.Fatal(err)
	}
	assertEmailHubCacheKept(t, svc, q, pool, acc)
}
