package service

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"math"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/emailhub"
	"github.com/unicomhub/uniwork/server/internal/emailhub/imapclient"
	"github.com/unicomhub/uniwork/server/internal/emailhub/smtpclient"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const sentCopyMsgID = "<sent-copy@acme.example>"

var sentCopyRaw = []byte("From: me@acme.example\r\nTo: dest@example.com\r\nSubject: Hi\r\n" +
	"Message-ID: " + sentCopyMsgID + "\r\n\r\nBody\r\n")

// seedSentAppendAccount seeds a live custom-server mailbox on imapHost under a
// fresh address, so each send gets its own placeholder UID space.
func seedSentAppendAccount(t *testing.T, svc *EmailHubService, q *db.Queries, userID, orgID, imapHost string) db.EmailHubAccount {
	t.Helper()
	return seedCustomEmailHubAccount(t, q, svc.box, userID, orgID, strings.ToLower(util.NewID())+"@acme.example", imapHost)
}

// stubSentAppend makes SMTP succeed with sentCopyRaw and records every raw
// message APPEND receives; APPEND answers uid and appendErr.
func stubSentAppend(svc *EmailHubService, uid uint32, appendErr error) *[][]byte {
	svc.testHookSMTPSend = func(context.Context, smtpclient.Credentials, smtpclient.Message) (string, []byte, error) {
		return sentCopyMsgID, sentCopyRaw, nil
	}
	var got [][]byte
	svc.testHookAppendSent = func(_ context.Context, _ db.EmailHubAccount, raw []byte) (uint32, error) {
		got = append(got, raw)
		return uid, appendErr
	}
	return &got
}

func sentCopyMail(accountID string) SendEmailHubInput {
	return SendEmailHubInput{AccountID: accountID, To: []string{"dest@example.com"}, Subject: "Hi", BodyText: "Body"}
}

func sentThreadRow(t *testing.T, q *db.Queries, acc db.EmailHubAccount, id string) db.EmailHubThread {
	t.Helper()
	row, err := q.GetEmailHubThread(context.Background(), db.GetEmailHubThreadParams{
		ID: id, AccountID: acc.ID, OrganizationID: acc.OrganizationID,
	})
	if err != nil {
		t.Fatal(err)
	}
	if row.Folder != emailhub.FolderSent {
		t.Fatalf("sent row folder = %q", row.Folder)
	}
	return row
}

func sentRowCount(t *testing.T, pool *pgxpool.Pool, accountID string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM email_hub_threads WHERE account_id = $1 AND folder = $2`,
		accountID, emailhub.FolderSent).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func isPlaceholderUID(uid int32) bool {
	now := int32(time.Now().Unix() & 0x7fffffff)
	return uid > now-60 && uid <= now
}

func TestEmailHubSendAppendsCustomSentCopy(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()

	t.Run("APPENDUID becomes the local UID", func(t *testing.T) {
		acc := seedSentAppendAccount(t, svc, q, user.ID, ws.OrganizationID, "mail.acme.example")
		appended := stubSentAppend(svc, 4242, nil)
		view, err := svc.Send(ctx, Human(user.ID), ws.ID, sentCopyMail(acc.ID))
		if err != nil {
			t.Fatal(err)
		}
		if len(*appended) != 1 || !bytes.Equal((*appended)[0], sentCopyRaw) {
			t.Fatalf("APPEND got %q, want exactly the MIME SMTP sent", *appended)
		}
		if row := sentThreadRow(t, q, acc, view.ID); row.ImapUid != 4242 {
			t.Fatalf("imap_uid = %d, want the APPENDUID 4242", row.ImapUid)
		}
	})

	t.Run("APPENDUID above int32 keeps the placeholder", func(t *testing.T) {
		acc := seedSentAppendAccount(t, svc, q, user.ID, ws.OrganizationID, "mail.acme.example")
		stubSentAppend(svc, uint32(math.MaxInt32)+1, nil)
		view, err := svc.Send(ctx, Human(user.ID), ws.ID, sentCopyMail(acc.ID))
		if err != nil {
			t.Fatal(err)
		}
		if row := sentThreadRow(t, q, acc, view.ID); !isPlaceholderUID(row.ImapUid) {
			t.Fatalf("imap_uid = %d, want the placeholder (imap_uid is INTEGER)", row.ImapUid)
		}
	})
}

// A server without UIDPLUS: the local row keeps the placeholder, and the next
// Sent reconcile adopts it by Message-ID, so the message shows exactly once.
func TestEmailHubSendWithoutAppendUIDShowsOnceAfterSync(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	acc := seedSentAppendAccount(t, svc, q, user.ID, ws.OrganizationID, "mail.acme.example")
	appended := stubSentAppend(svc, 0, nil)
	view, err := svc.Send(ctx, Human(user.ID), ws.ID, sentCopyMail(acc.ID))
	if err != nil {
		t.Fatal(err)
	}
	if len(*appended) != 1 {
		t.Fatalf("APPEND calls = %d, want 1", len(*appended))
	}
	if row := sentThreadRow(t, q, acc, view.ID); !isPlaceholderUID(row.ImapUid) {
		t.Fatalf("imap_uid = %d before sync, want the placeholder", row.ImapUid)
	}

	server := []imapclient.ThreadMeta{{
		UID: 77, MessageID: sentCopyMsgID, Subject: "Hi", FromAddr: acc.EmailAddress,
		ToAddrs: []string{"dest@example.com"}, SentAt: time.Now().UTC(), IsRead: true,
	}}
	if err := svc.cacheFolderItems(ctx, acc, emailhub.FolderSent, server, true); err != nil {
		t.Fatal(err)
	}
	if n := sentRowCount(t, pool, acc.ID); n != 1 {
		t.Fatalf("Sent rows = %d after sync, want exactly 1", n)
	}
	if row := sentThreadRow(t, q, acc, view.ID); row.ImapUid != 77 {
		t.Fatalf("local row imap_uid = %d, want the server UID 77 on the same id", row.ImapUid)
	}
}

// Gmail and Microsoft 365 file Sent themselves, also for a custom domain hosted there.
func TestEmailHubSendSkipsAppend(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	accounts := []db.EmailHubAccount{
		seedEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID), // preset gmail
		seedSentAppendAccount(t, svc, q, user.ID, ws.OrganizationID, "imap.gmail.com"),
		seedSentAppendAccount(t, svc, q, user.ID, ws.OrganizationID, "outlook.office365.com"),
	}
	appended := stubSentAppend(svc, 4242, nil)
	for _, acc := range accounts {
		view, err := svc.Send(ctx, Human(user.ID), ws.ID, sentCopyMail(acc.ID))
		if err != nil {
			t.Fatalf("%s on %s: %v", acc.Provider, acc.ImapHost, err)
		}
		if row := sentThreadRow(t, q, acc, view.ID); !isPlaceholderUID(row.ImapUid) {
			t.Fatalf("%s on %s: imap_uid = %d, want the placeholder", acc.Provider, acc.ImapHost, row.ImapUid)
		}
	}
	if len(*appended) != 0 {
		t.Fatalf("APPEND ran %d times for hosts that file Sent themselves", len(*appended))
	}
}

// The recipient already has the mail: a failed APPEND is logged by code and
// the send still succeeds with its local Sent row.
func TestEmailHubAppendFailureKeepsTheSend(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	var logs bytes.Buffer
	svc.log = slog.New(slog.NewTextHandler(&logs, nil))
	acc := seedSentAppendAccount(t, svc, q, user.ID, ws.OrganizationID, "mail.secret.example")
	stubSentAppend(svc, 0, errors.New("imap append to mail.secret.example:993: NO [TRYCREATE] no mailbox"))
	view, err := svc.Send(context.Background(), Human(user.ID), ws.ID, sentCopyMail(acc.ID))
	if err != nil {
		t.Fatalf("a failed APPEND must not fail the send: %v", err)
	}
	if row := sentThreadRow(t, q, acc, view.ID); !isPlaceholderUID(row.ImapUid) {
		t.Fatalf("imap_uid = %d, want the placeholder", row.ImapUid)
	}
	out := logs.String()
	if !strings.Contains(out, `msg="email hub sent copy append failed"`) || !strings.Contains(out, "code=") {
		t.Fatalf("want the append failure logged with a code:\n%s", out)
	}
	if strings.Contains(out, "mail.secret.example") || strings.Contains(out, acc.EmailAddress) {
		t.Fatalf("the log carries the host or the address:\n%s", out)
	}
}

func TestEmailHubScheduledSendAppendsCustomSentCopy(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	acc := seedSentAppendAccount(t, svc, q, user.ID, ws.OrganizationID, "mail.acme.example")
	id := seedDueEmailHubScheduledSend(t, q, ws, user.ID, acc.ID)
	appended := stubSentAppend(svc, 4243, nil)

	svc.runScheduledSendOnce(context.Background())

	if status, lastErr := scheduledSendOutcome(t, pool, id); status != "sent" {
		t.Fatalf("scheduled send status = %q (%q), want sent", status, lastErr)
	}
	if len(*appended) != 1 {
		t.Fatalf("APPEND calls = %d, want 1 for a scheduled send", len(*appended))
	}
}
