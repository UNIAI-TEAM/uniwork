package service

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/unicomhub/uniwork/server/internal/emailhub"
	"github.com/unicomhub/uniwork/server/internal/emailhub/imapclient"
	"github.com/unicomhub/uniwork/server/internal/emailhub/netguard"
	"github.com/unicomhub/uniwork/server/internal/emailhub/smtpclient"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// A custom IMAP host is the user's private infrastructure; .invalid never resolves.
const emailHubSecretHost = "nohost.secret-intranet.invalid"

func TestEmailHubErrCode(t *testing.T) {
	h := emailHubSecretHost
	cases := []struct {
		name string
		err  error
		want string
	}{
		{"dns", fmt.Errorf("imap dial: %w", &net.DNSError{Err: "no such host", Name: h, IsNotFound: true}), "unreachable"},
		{"net timeout", fmt.Errorf("imap dial: %w", &net.DNSError{Err: "i/o timeout", Name: h, IsTimeout: true}), "unreachable"},
		{"certificate", fmt.Errorf("imap dial: %w", &tls.CertificateVerificationError{
			Err: errors.New("x509: certificate is valid for shared.host.example, not " + h),
		}), "unreachable"},
		{"tls against plaintext", fmt.Errorf("imap greeting %s: %w", h,
			tls.RecordHeaderError{Msg: "first record does not look like a TLS handshake"}), "tls_required"},
		{"imap tls required", fmt.Errorf("imap %s: %w", h, imapclient.ErrTLSRequired), "tls_required"},
		{"imap auth", fmt.Errorf("imap login %s: %w", h, imapclient.ErrAuthFailed), "auth_failed"},
		{"smtp auth disabled", fmt.Errorf("smtp auth %s: %w", h, smtpclient.ErrSMTPAuthDisabled), "smtp_disabled"},
		{"blocked host", fmt.Errorf("dial %s:993: %w", h, netguard.ErrHostNotAllowed), "host_not_allowed"},
		{"deadline", fmt.Errorf("imap fetch %s: %w", h, context.DeadlineExceeded), "timeout"},
		{"canceled", fmt.Errorf("imap fetch %s: %w", h, context.Canceled), "timeout"},
		{"needs reconnect", ErrEmailHubReauthRequired, "auth_failed"},
		{"database", fmt.Errorf("sync state: %w", &pgconn.PgError{Code: "40001", Message: "serialization failure"}), "db"},
		{"protocol", errors.New("imap: unexpected BYE from " + h), "connect_failed"},
	}
	for _, tc := range cases {
		got := emailHubErrCode(tc.err)
		if got != tc.want {
			t.Errorf("%s: code %q, want %q", tc.name, got, tc.want)
		}
		if strings.Contains(got, "secret-intranet") {
			t.Errorf("%s: the code carries the host: %q", tc.name, got)
		}
	}
}

func TestRedactEmailHubMailErrKeepsSentinels(t *testing.T) {
	if redactEmailHubMailErr(nil) != nil {
		t.Fatal("nil must stay nil")
	}
	for _, sentinel := range []error{
		ErrEmailHubReauthRequired, ErrNotFound, ErrEmailHubNotConfigured, ErrEmailHubSMTPDisabled, context.DeadlineExceeded,
	} {
		err := redactEmailHubMailErr(fmt.Errorf("imap %s: %w", emailHubSecretHost, sentinel))
		if !errors.Is(err, sentinel) {
			t.Errorf("%v: lost its sentinel: %v", sentinel, err)
		}
		if strings.Contains(err.Error(), "secret-intranet") {
			t.Errorf("%v: still carries the host: %v", sentinel, err)
		}
	}
	var ve ValidationError
	if err := redactEmailHubMailErr(Invalid("attachment too large")); !errors.As(err, &ve) {
		t.Errorf("a validation error must stay a 400, got %v", err)
	}
	dns := fmt.Errorf("imap dial: %w", &net.DNSError{Err: "no such host", Name: emailHubSecretHost, IsNotFound: true})
	if got := redactEmailHubMailErr(dns); got.Error() != "email hub mail server: unreachable" {
		t.Errorf("DNS failure redacted to %q", got)
	}
}

// Every user-facing mail path against a host that does not resolve: what the
// handler receives and what the service logs carry a code, never the host.
func TestEmailHubSyncLogsCodeNotHost(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	var logs bytes.Buffer
	svc.log = slog.New(slog.NewTextHandler(&logs, nil))
	ctx := context.Background()
	actor := Human(user.ID)
	sealed, err := svc.box.Seal([]byte("app-password"))
	if err != nil {
		t.Fatal(err)
	}
	acc, err := q.CreateEmailHubAccount(ctx, db.CreateEmailHubAccountParams{
		ID: util.NewID(), UserID: user.ID, OrganizationID: ws.OrganizationID,
		EmailAddress: "me@corp.example", Provider: "custom",
		ImapHost: emailHubSecretHost, ImapPort: 993, ImapSecurity: "tls",
		SmtpHost: emailHubSecretHost, SmtpPort: 587, SmtpSecurity: "starttls",
		AuthKind: "password", PasswordEnc: base64.StdEncoding.EncodeToString(sealed),
	})
	if err != nil {
		t.Fatal(err)
	}
	thread := seedEmailHubThread(t, q, acc.ID, ws.OrganizationID)

	_, syncErr := svc.Sync(ctx, actor, ws.ID, acc.ID, "", true, false, false)
	moveErr := svc.MoveThread(ctx, actor, ws.ID, acc.ID, thread.ID, emailhub.FolderArchive)
	if _, err := svc.GetThread(ctx, actor, ws.ID, acc.ID, thread.ID, true, false); err != nil {
		t.Fatalf("a failed body fetch still serves the cached thread: %v", err)
	}
	for name, err := range map[string]error{"sync": syncErr, "move": moveErr} {
		if err == nil {
			t.Fatalf("%s: want an error from a host that does not resolve", name)
		}
		if strings.Contains(err.Error(), "secret-intranet") {
			t.Errorf("%s: the returned error carries the host: %v", name, err)
		}
		if err.Error() != "email hub mail server: unreachable" {
			t.Errorf("%s: returned %q, want the redacted unreachable code", name, err)
		}
	}
	out := logs.String()
	if strings.Contains(out, "secret-intranet") {
		t.Fatalf("the log carries the host:\n%s", out)
	}
	if !strings.Contains(out, "code=unreachable") {
		t.Fatalf("the log must carry code=unreachable:\n%s", out)
	}
}
