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
	"sync"
	"sync/atomic"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/emailhub"
	"github.com/unicomhub/uniwork/server/internal/emailhub/imapclient"
	"github.com/unicomhub/uniwork/server/internal/emailhub/netguard"
	"github.com/unicomhub/uniwork/server/internal/emailhub/smtpclient"
	"github.com/unicomhub/uniwork/server/internal/util"
	"github.com/unicomhub/uniwork/server/internal/util/secretbox"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// stubEmailHubDial keeps Connect off the network: the login check answers err
// and the initial sync is skipped. It returns how many logins Connect tried.
func stubEmailHubDial(svc *EmailHubService, err error) *atomic.Int32 {
	var calls atomic.Int32
	svc.testHookVerify = func(context.Context, imapclient.Credentials, smtpclient.Credentials) error {
		calls.Add(1)
		return err
	}
	svc.testHookInitialSync = func(context.Context, db.EmailHubAccount) {}
	return &calls
}

// seedPresetEmailHubAccount stores a password mailbox on its provider's
// preset server, the row a Connect for the same address would produce.
func seedPresetEmailHubAccount(t *testing.T, q *db.Queries, box *secretbox.Box, userID, orgID, email string) db.EmailHubAccount {
	t.Helper()
	prov, ok := emailhub.ProviderForEmail(email)
	if !ok {
		t.Fatalf("no preset for %s", email)
	}
	sealed, err := box.Seal([]byte("old-app-password"))
	if err != nil {
		t.Fatal(err)
	}
	row, err := q.CreateEmailHubAccount(context.Background(), db.CreateEmailHubAccountParams{
		ID: util.NewID(), UserID: userID, OrganizationID: orgID,
		EmailAddress: email, Provider: prov.Name,
		ImapHost: prov.IMAPHost, ImapPort: int32(prov.IMAPPort), ImapSecurity: "tls",
		SmtpHost: prov.SMTPHost, SmtpPort: int32(prov.SMTPPort), SmtpSecurity: "starttls",
		AuthKind: "password", PasswordEnc: base64.StdEncoding.EncodeToString(sealed),
	})
	if err != nil {
		t.Fatal(err)
	}
	return row
}

// connectedAudit reads the connected rows of one account: how many, the
// actor kind, and the reconnected flag.
func connectedAudit(t *testing.T, pool *pgxpool.Pool, accountID string) (int, string, string) {
	t.Helper()
	var n int
	var kind, reconnected string
	if err := pool.QueryRow(context.Background(), `SELECT count(*), coalesce(max(actor_kind), ''),
		coalesce(max(metadata::jsonb->>'reconnected'), '')
		FROM audit_events WHERE action = $1 AND resource_id = $2`,
		audit.ActionEmailHubAccountConnected, accountID).Scan(&n, &kind, &reconnected); err != nil {
		t.Fatal(err)
	}
	return n, kind, reconnected
}

func TestEmailHubConnectCreatesThePasswordAccount(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	var gotIMAP imapclient.Credentials
	var gotSMTP smtpclient.Credentials
	stubEmailHubDial(svc, nil)
	svc.testHookVerify = func(_ context.Context, imap imapclient.Credentials, smtp smtpclient.Credentials) error {
		gotIMAP, gotSMTP = imap, smtp
		return nil
	}

	view, err := svc.Connect(ctx, Human(user.ID), ws.ID, ConnectEmailHubInput{
		EmailAddress: " New@Gmail.com ", AppPassword: "app-password-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	wantIMAP := imapclient.Credentials{Host: "imap.gmail.com", Port: 993, Email: "new@gmail.com", Password: "app-password-1", Security: "tls"}
	wantSMTP := smtpclient.Credentials{Host: "smtp.gmail.com", Port: 587, Email: "new@gmail.com", Password: "app-password-1", Security: "starttls"}
	if gotIMAP != wantIMAP || gotSMTP != wantSMTP {
		t.Fatalf("verify got imap=%+v smtp=%+v", gotIMAP, gotSMTP)
	}
	row, err := q.GetEmailHubAccountByID(ctx, view.ID)
	if err != nil {
		t.Fatal(err)
	}
	if row.AuthKind != "password" || view.AuthKind != "password" || view.NeedsReconnect {
		t.Fatalf("row auth_kind=%q view=%+v", row.AuthKind, view)
	}
	if n, kind, reconnected := connectedAudit(t, pool, view.ID); n != 1 || kind != "human" || reconnected != "false" {
		t.Fatalf("connected audit: n=%d kind=%q reconnected=%q", n, kind, reconnected)
	}
}

// The duplicate check runs before any dial (spec §5.2 step 3): a second
// Connect of a live mailbox never spends a LOGIN at the provider.
func TestEmailHubConnectRefusesADuplicateBeforeDialing(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	seedPresetEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID, "dup@gmail.com")
	calls := stubEmailHubDial(svc, nil)

	_, err := svc.Connect(context.Background(), Human(user.ID), ws.ID, ConnectEmailHubInput{
		EmailAddress: "DUP@gmail.com", AppPassword: "app-password-1",
	})
	if !errors.Is(err, ErrEmailHubAlreadyConnected) {
		t.Fatalf("expected already connected, got %v", err)
	}
	if n := calls.Load(); n != 0 {
		t.Fatalf("a duplicate must be refused before the login check, verify ran %d times", n)
	}
}

func TestEmailHubReconnectKeepsTheAccountAndItsMail(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	acc := seedPresetEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID, "back@gmail.com")
	seedEmailHubThread(t, q, acc.ID, ws.OrganizationID)
	if _, err := q.MarkEmailHubAccountAuthFailed(ctx, db.MarkEmailHubAccountAuthFailedParams{
		ID: acc.ID, OrganizationID: ws.OrganizationID, CredentialVersion: acc.CredentialVersion, Reason: "imap_auth_failed",
	}); err != nil {
		t.Fatalf("mark auth failed: %v", err)
	}
	for range emailHubRefusedLoginsBeforeDisconnect - 1 {
		svc.gov.loginRefused(acc.ID)
	}
	calls := stubEmailHubDial(svc, nil)

	view, err := svc.Connect(ctx, Human(user.ID), ws.ID, ConnectEmailHubInput{
		EmailAddress: "Back@Gmail.com", AppPassword: "new-app-password",
	})
	if err != nil {
		t.Fatal(err)
	}
	if view.ID != acc.ID || view.NeedsReconnect {
		t.Fatalf("reconnect must keep id %s and clear needs_reconnect, got %+v", acc.ID, view)
	}
	if calls.Load() != 1 {
		t.Fatalf("a reconnect verifies the new password once, got %d", calls.Load())
	}
	row, err := q.GetEmailHubAccountByID(ctx, acc.ID)
	if err != nil {
		t.Fatal(err)
	}
	if row.AuthFailedAt.Valid || row.AuthFailedReason != "" || row.DisconnectedAt.Valid {
		t.Fatalf("reconnect must clear the failure: %+v", row)
	}
	if row.CredentialVersion <= acc.CredentialVersion {
		t.Fatalf("credential_version must move past %d, got %d", acc.CredentialVersion, row.CredentialVersion)
	}
	if pw, err := svc.openPassword(row.PasswordEnc); err != nil || pw != "new-app-password" {
		t.Fatalf("stored password=%q err=%v", pw, err)
	}
	var threads int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM email_hub_threads WHERE account_id = $1`, acc.ID).Scan(&threads); err != nil || threads != 1 {
		t.Fatalf("cached mail must survive a reconnect, threads=%d err=%v", threads, err)
	}
	if n := svc.gov.loginRefused(acc.ID); n != 1 {
		t.Fatalf("a reconnect must restart the refused-LOGIN run, count=%d", n)
	}
	if n, kind, reconnected := connectedAudit(t, pool, acc.ID); n != 1 || kind != "human" || reconnected != "true" {
		t.Fatalf("connected audit: n=%d kind=%q reconnected=%q", n, kind, reconnected)
	}
}

// Both requests pass the pre-dial check; the unique index settles it.
func TestEmailHubConcurrentConnectsLeaveOneAccount(t *testing.T) {
	svc, _, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	stubEmailHubDial(svc, nil)
	var ready sync.WaitGroup
	ready.Add(2)
	svc.testHookVerify = func(context.Context, imapclient.Credentials, smtpclient.Credentials) error {
		ready.Done()
		ready.Wait() // both requests are past the duplicate check before either writes
		return nil
	}
	in := ConnectEmailHubInput{EmailAddress: "race@gmail.com", AppPassword: "app-password-1"}
	errs := make(chan error, 2)
	for range 2 {
		go func() {
			_, err := svc.Connect(ctx, Human(user.ID), ws.ID, in)
			errs <- err
		}()
	}
	var ok, conflict int
	for range 2 {
		switch err := <-errs; {
		case err == nil:
			ok++
		case errors.Is(err, ErrEmailHubAlreadyConnected):
			conflict++
		default:
			t.Fatalf("unexpected connect error: %v", err)
		}
	}
	if ok != 1 || conflict != 1 {
		t.Fatalf("want one success and one conflict, got ok=%d conflict=%d", ok, conflict)
	}
	var active int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM email_hub_accounts
		WHERE user_id = $1 AND lower(email_address) = 'race@gmail.com' AND disconnected_at IS NULL`, user.ID).Scan(&active); err != nil || active != 1 {
		t.Fatalf("want one active row, got %d err=%v", active, err)
	}
}

func TestEmailHubConnectClassifiesVerifyErrorsWithoutLeakingTheHost(t *testing.T) {
	svc, _, user, ws, _ := emailHubFixture(t)
	var logs bytes.Buffer
	svc.log = slog.New(slog.NewTextHandler(&logs, nil))
	const host = "mail.secret-intranet.example"
	cases := []struct {
		name string
		err  error
		want error
	}{
		{"imap auth", fmt.Errorf("imap login %s: %w", host, imapclient.ErrAuthFailed), ErrEmailHubConnectFailed},
		{"imap refused", fmt.Errorf("imap login %s: %w", host, imapclient.ErrLoginRefused), ErrEmailHubConnectFailed},
		{"smtp auth", fmt.Errorf("smtp auth %s: %w", host, smtpclient.ErrAuthFailed), ErrEmailHubConnectFailed},
		{"smtp disabled", fmt.Errorf("smtp auth %s: %w", host, smtpclient.ErrSMTPAuthDisabled), ErrEmailHubSMTPDisabled},
		{"imap tls", fmt.Errorf("imap %s: %w", host, imapclient.ErrTLSRequired), ErrEmailHubTLSRequired},
		{"smtp tls", fmt.Errorf("smtp %s: %w", host, smtpclient.ErrTLSRequired), ErrEmailHubTLSRequired},
		{"tls to a plaintext greeter", fmt.Errorf("imap greeting %s: %w", host, tls.RecordHeaderError{Msg: "first record does not look like a TLS handshake"}), ErrEmailHubTLSRequired},
		{"blocked host", fmt.Errorf("dial %s:993: %w", host, netguard.ErrHostNotAllowed), ErrEmailHubUnreachable},
		{"imap timeout", fmt.Errorf("imap login %s: %w", host, context.DeadlineExceeded), ErrEmailHubUnreachable},
		{"dns", fmt.Errorf("dial: %w", &net.DNSError{Err: "no such host", Name: host, IsNotFound: true}), ErrEmailHubUnreachable},
		{"certificate", fmt.Errorf("tls: %w", &tls.CertificateVerificationError{Err: errors.New("x509: unknown authority for " + host)}), ErrEmailHubUnreachable},
		{"protocol", errors.New("imap: unexpected BYE from " + host), ErrEmailHubConnectFailed},
	}
	for _, tc := range cases {
		stubEmailHubDial(svc, tc.err)
		_, err := svc.Connect(context.Background(), Human(user.ID), ws.ID, ConnectEmailHubInput{
			EmailAddress: "probe@gmail.com", AppPassword: "app-password-1",
		})
		if !errors.Is(err, tc.want) {
			t.Errorf("%s: got %v, want %v", tc.name, err, tc.want)
			continue
		}
		if strings.Contains(err.Error(), host) {
			t.Errorf("%s: the returned error carries the host: %v", tc.name, err)
		}
	}
	if strings.Contains(logs.String(), host) {
		t.Fatalf("the log carries the host:\n%s", logs.String())
	}
	if !strings.Contains(logs.String(), "code=unreachable") || !strings.Contains(logs.String(), "code=auth_failed") {
		t.Fatalf("the log must carry the classified codes:\n%s", logs.String())
	}
}

// Membership answers first (spec §5.2): a non-member never learns whether
// the feature is configured.
func TestEmailHubConnectChecksMembershipBeforeConfiguration(t *testing.T) {
	svc, _, user, ws, _ := emailHubFixture(t)
	svc.box = nil
	in := ConnectEmailHubInput{EmailAddress: "probe@gmail.com", AppPassword: "app-password-1"}

	_, err := svc.Connect(context.Background(), Human(util.NewID()), ws.ID, in)
	if !errors.Is(err, ErrForbidden) && !errors.Is(err, ErrNotFound) {
		t.Fatalf("non-member: err = %v, want the membership answer", err)
	}
	if _, err := svc.Connect(context.Background(), Human(user.ID), ws.ID, in); !errors.Is(err, ErrEmailHubNotConfigured) {
		t.Fatalf("member: err = %v, want ErrEmailHubNotConfigured", err)
	}
}

// customConnectInput is a complete custom-server connect on mail.example.com;
// tests change one field at a time.
func customConnectInput(email string) ConnectEmailHubInput {
	return ConnectEmailHubInput{
		EmailAddress: email, AppPassword: "server-password-1",
		IMAPHost: "mail.example.com", IMAPPort: 993, IMAPSecurity: "tls",
		SMTPHost: "mail.example.com", SMTPPort: 587, SMTPSecurity: "starttls",
	}
}

// seedCustomEmailHubAccount stores a live password mailbox on imapHost:993,
// the row a custom Connect would produce.
func seedCustomEmailHubAccount(t *testing.T, q *db.Queries, box *secretbox.Box, userID, orgID, email, imapHost string) db.EmailHubAccount {
	t.Helper()
	sealed, err := box.Seal([]byte("old-server-password"))
	if err != nil {
		t.Fatal(err)
	}
	row, err := q.CreateEmailHubAccount(context.Background(), db.CreateEmailHubAccountParams{
		ID: util.NewID(), UserID: userID, OrganizationID: orgID,
		EmailAddress: email, Provider: "custom",
		ImapHost: imapHost, ImapPort: 993, ImapSecurity: "tls",
		SmtpHost: imapHost, SmtpPort: 587, SmtpSecurity: "starttls",
		AuthKind: "password", PasswordEnc: base64.StdEncoding.EncodeToString(sealed),
	})
	if err != nil {
		t.Fatal(err)
	}
	return row
}

// connectedServerChanged reads the server_changed flag of an account's
// connected audit row.
func connectedServerChanged(t *testing.T, pool *pgxpool.Pool, accountID string) string {
	t.Helper()
	var changed string
	if err := pool.QueryRow(context.Background(), `SELECT coalesce(max(metadata::jsonb->>'server_changed'), '')
		FROM audit_events WHERE action = $1 AND resource_id = $2`,
		audit.ActionEmailHubAccountConnected, accountID).Scan(&changed); err != nil {
		t.Fatal(err)
	}
	return changed
}

// The login check, the row and the view all carry the normalized server; the
// password of a custom server is used as typed (spec §5.2).
func TestEmailHubConnectCustomServerStoresItsSettings(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	var gotIMAP imapclient.Credentials
	var gotSMTP smtpclient.Credentials
	stubEmailHubDial(svc, nil)
	svc.testHookVerify = func(_ context.Context, imap imapclient.Credentials, smtp smtpclient.Credentials) error {
		gotIMAP, gotSMTP = imap, smtp
		return nil
	}

	view, err := svc.Connect(ctx, Human(user.ID), ws.ID, ConnectEmailHubInput{
		EmailAddress: "Me@Acme.Example", AppPassword: " pass word ",
		IMAPHost: " Mail.Acme.EXAMPLE. ", IMAPPort: 143, IMAPSecurity: "starttls",
		SMTPHost: "SMTP.acme.example", SMTPPort: 465, SMTPSecurity: "tls",
		Username: "mailuser",
	})
	if err != nil {
		t.Fatal(err)
	}
	wantIMAP := imapclient.Credentials{Host: "mail.acme.example", Port: 143, Email: "me@acme.example", Username: "mailuser", Password: " pass word ", Security: "starttls"}
	wantSMTP := smtpclient.Credentials{Host: "smtp.acme.example", Port: 465, Email: "me@acme.example", Username: "mailuser", Password: " pass word ", Security: "tls"}
	if gotIMAP != wantIMAP || gotSMTP != wantSMTP {
		t.Fatalf("verify got imap=%+v smtp=%+v", gotIMAP, gotSMTP)
	}
	row, err := q.GetEmailHubAccountByID(ctx, view.ID)
	if err != nil {
		t.Fatal(err)
	}
	if row.Provider != "custom" || row.AuthKind != "password" ||
		row.ImapHost != "mail.acme.example" || row.ImapPort != 143 || row.ImapSecurity != "starttls" ||
		row.SmtpHost != "smtp.acme.example" || row.SmtpPort != 465 || row.SmtpSecurity != "tls" ||
		row.Username != "mailuser" {
		t.Fatalf("stored row: %+v", row)
	}
	if pw, err := svc.openPassword(row.PasswordEnc); err != nil || pw != " pass word " {
		t.Fatalf("stored password=%q err=%v", pw, err)
	}
	if view.Provider != "custom" || view.ImapHost != "mail.acme.example" || view.ImapPort != 143 ||
		view.ImapSecurity != "starttls" || view.SmtpHost != "smtp.acme.example" || view.SmtpPort != 465 ||
		view.SmtpSecurity != "tls" || view.Username != "mailuser" {
		t.Fatalf("view: %+v", view)
	}
	if n, _, reconnected := connectedAudit(t, pool, view.ID); n != 1 || reconnected != "false" {
		t.Fatalf("connected audit: n=%d reconnected=%q", n, reconnected)
	}
	if changed := connectedServerChanged(t, pool, view.ID); changed != "false" {
		t.Fatalf("a first connect changes no server, server_changed=%q", changed)
	}
}

// Membership answers first; a bad server field is refused with the field the
// client marks, before any login and without writing a row (spec §5.2 steps 1-2).
func TestEmailHubConnectRefusesBadServerBeforeDialing(t *testing.T) {
	svc, _, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	calls := stubEmailHubDial(svc, nil)
	badPort := customConnectInput("bad@acme.example")
	badPort.IMAPPort = 8080
	blocked := customConnectInput("bad@acme.example")
	blocked.IMAPHost = "169.254.169.254"

	if _, err := svc.Connect(ctx, Human(util.NewID()), ws.ID, badPort); !errors.Is(err, ErrForbidden) && !errors.Is(err, ErrNotFound) {
		t.Fatalf("non-member must get the membership answer before validation, got %v", err)
	}
	cases := []struct {
		name     string
		in       ConnectEmailHubInput
		sentinel error
		code     string
		field    string
	}{
		{"port outside the allowed set", badPort, ErrEmailHubInvalidServer, "email_hub_invalid_server", "imap_port"},
		{"blocked ip literal", blocked, ErrEmailHubHostNotAllowed, "email_hub_host_not_allowed", "imap_host"},
	}
	for _, tc := range cases {
		_, err := svc.Connect(ctx, Human(user.ID), ws.ID, tc.in)
		var ce CodedError
		if !errors.As(err, &ce) || !errors.Is(err, tc.sentinel) || ce.Code != tc.code || ce.Status != 400 || ce.Fields["field"] != tc.field {
			t.Errorf("%s: got %#v", tc.name, err)
		}
	}
	if n := calls.Load(); n != 0 {
		t.Fatalf("a refused server must never reach the login check, verify ran %d times", n)
	}
	var rows int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM email_hub_accounts WHERE user_id = $1`, user.ID).Scan(&rows); err != nil || rows != 0 {
		t.Fatalf("a refused connect writes no row, rows=%d err=%v", rows, err)
	}
}

// A live custom mailbox on the same IMAP server is a duplicate whatever the
// host's case, a trailing dot or the SMTP side say (spec §3).
func TestEmailHubConnectCustomDuplicateIs409(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	seedCustomEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID, "dup@acme.example", "mail.example.com")
	calls := stubEmailHubDial(svc, nil)
	sameHost := customConnectInput("DUP@acme.example")
	sameHost.IMAPHost = "MAIL.Example.com."
	otherSMTP := customConnectInput("dup@acme.example")
	otherSMTP.SMTPHost, otherSMTP.SMTPPort, otherSMTP.SMTPSecurity = "smtp.other.example", 465, "tls"

	for name, in := range map[string]ConnectEmailHubInput{"case and trailing dot": sameHost, "smtp only": otherSMTP} {
		if _, err := svc.Connect(context.Background(), Human(user.ID), ws.ID, in); !errors.Is(err, ErrEmailHubAlreadyConnected) {
			t.Errorf("%s: expected already connected, got %v", name, err)
		}
	}
	if n := calls.Load(); n != 0 {
		t.Fatalf("a duplicate must be refused before the login check, verify ran %d times", n)
	}
}

// Reconnecting onto another IMAP server keeps the id and says so in the audit;
// the same server spelled differently is not a change (it would wipe the cache).
func TestEmailHubReconnectChangedServerFlagsIt(t *testing.T) {
	svc, q, user, ws, pool := emailHubFixture(t)
	ctx := context.Background()
	moved := seedCustomEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID, "moved@acme.example", "mail.example.com")
	same := seedCustomEmailHubAccount(t, q, svc.box, user.ID, ws.OrganizationID, "same@acme.example", "mail.example.com")
	for _, acc := range []db.EmailHubAccount{moved, same} {
		if _, err := q.MarkEmailHubAccountAuthFailed(ctx, db.MarkEmailHubAccountAuthFailedParams{
			ID: acc.ID, OrganizationID: ws.OrganizationID, CredentialVersion: acc.CredentialVersion, Reason: "imap_auth_failed",
		}); err != nil {
			t.Fatalf("mark auth failed: %v", err)
		}
	}
	stubEmailHubDial(svc, nil)
	toNewHost := customConnectInput("moved@acme.example")
	toNewHost.IMAPHost = "imap.newhost.example"
	toNewHost.Username = "ops"
	sameHost := customConnectInput("same@acme.example")
	sameHost.IMAPHost = "Mail.Example.COM."

	cases := []struct {
		acc      db.EmailHubAccount
		in       ConnectEmailHubInput
		wantHost string
		changed  string
	}{
		{moved, toNewHost, "imap.newhost.example", "true"},
		{same, sameHost, "mail.example.com", "false"},
	}
	for _, tc := range cases {
		view, err := svc.Connect(ctx, Human(user.ID), ws.ID, tc.in)
		if err != nil {
			t.Fatal(err)
		}
		if view.ID != tc.acc.ID || view.ImapHost != tc.wantHost || view.NeedsReconnect {
			t.Errorf("%s: reconnect must keep id %s on %s, got %+v", tc.acc.EmailAddress, tc.acc.ID, tc.wantHost, view)
		}
		if n, _, reconnected := connectedAudit(t, pool, tc.acc.ID); n != 1 || reconnected != "true" {
			t.Errorf("%s: connected audit n=%d reconnected=%q", tc.acc.EmailAddress, n, reconnected)
		}
		if got := connectedServerChanged(t, pool, tc.acc.ID); got != tc.changed {
			t.Errorf("%s: server_changed=%q, want %q", tc.acc.EmailAddress, got, tc.changed)
		}
	}
	// UpdateEmailHubAccountCredentials persists the login name and auth kind (GĐ1 deferred minor).
	row, err := q.GetEmailHubAccountByID(ctx, moved.ID)
	if err != nil {
		t.Fatal(err)
	}
	if row.Username != "ops" || row.AuthKind != "password" || row.Provider != "custom" {
		t.Fatalf("reconnect row: username=%q auth_kind=%q provider=%q", row.Username, row.AuthKind, row.Provider)
	}
}
