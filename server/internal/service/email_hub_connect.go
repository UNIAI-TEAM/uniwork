package service

import (
	"context"
	"crypto/tls"
	"encoding/base64"
	"errors"
	"net"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/emailhub/imapclient"
	"github.com/unicomhub/uniwork/server/internal/emailhub/netguard"
	"github.com/unicomhub/uniwork/server/internal/emailhub/smtpclient"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

var (
	ErrEmailHubAlreadyConnected = errors.New("email already connected")
	ErrEmailHubTLSRequired      = errors.New("mail server does not offer the required tls mode")
	ErrEmailHubUnreachable      = errors.New("mail server unreachable")
)

type ConnectEmailHubInput struct {
	EmailAddress string
	AppPassword  string
	// Server fields name a custom IMAP/SMTP server (spec §5.2); all zero
	// means the preset for the address domain.
	IMAPHost     string
	IMAPPort     int
	IMAPSecurity string
	SMTPHost     string
	SMTPPort     int
	SMTPSecurity string
	Username     string
}

// Connect verifies a mailbox and stores it in the order spec §5.2 fixes:
// membership, the feature switch, the fields and the server they name (no
// dial), the duplicate check, the login, then one transaction for the row and
// its audit. An address that needs a reconnect keeps its id.
func (s *EmailHubService) Connect(ctx context.Context, actor Actor, workspaceID string, in ConnectEmailHubInput) (EmailHubAccountView, error) {
	ws, err := s.workspace(ctx, actor, workspaceID)
	if err != nil {
		return EmailHubAccountView{}, err
	}
	if !s.Enabled() {
		return EmailHubAccountView{}, ErrEmailHubNotConfigured
	}
	email := strings.ToLower(strings.TrimSpace(in.EmailAddress))
	if email == "" || strings.TrimSpace(in.AppPassword) == "" {
		return EmailHubAccountView{}, Invalid("email and app password required")
	}
	srv, err := resolveEmailHubServer(email, in)
	if err != nil {
		return EmailHubAccountView{}, err
	}
	// An app password's edges are copy-paste noise; a server password is used as typed.
	password := in.AppPassword
	if srv.Provider != "custom" {
		password = strings.TrimSpace(password)
	}
	byAddress := db.GetActiveEmailHubAccountByAddressParams{
		OrganizationID: ws.OrganizationID, UserID: actor.ID, Email: email,
	}
	existing, err := s.q.GetActiveEmailHubAccountByAddress(ctx, byAddress)
	switch {
	case err == nil && sameEmailHubConnection(existing, "password", srv.IMAPHost, srv.IMAPPort):
		return EmailHubAccountView{}, ErrEmailHubAlreadyConnected
	case err != nil && !errors.Is(err, pgx.ErrNoRows):
		return EmailHubAccountView{}, err
	}
	imapCreds := imapclient.Credentials{
		Host: srv.IMAPHost, Port: srv.IMAPPort, Email: email, Username: srv.Username,
		Password: password, Security: srv.IMAPSecurity,
	}
	smtpCreds := smtpclient.Credentials{
		Host: srv.SMTPHost, Port: srv.SMTPPort, Email: email, Username: srv.Username,
		Password: password, Security: srv.SMTPSecurity,
	}
	if err := s.verifyEmailHubLogin(ctx, imapCreds, smtpCreds); err != nil {
		code, mapped := classifyEmailHubConnectError(err)
		// account_id is empty on a first connect.
		s.log.Warn("email hub connect verify failed", "code", code, "provider", srv.Provider,
			"user_id", actor.ID, "account_id", existing.ID)
		return EmailHubAccountView{}, mapped
	}
	sealed, err := s.box.Seal([]byte(password))
	if err != nil {
		return EmailHubAccountView{}, err
	}
	row, _, err := s.saveEmailHubConnection(ctx, actor, byAddress, srv, base64.StdEncoding.EncodeToString(sealed))
	if err != nil {
		return EmailHubAccountView{}, err
	}
	s.gov.loginSucceeded(row.ID) // a reconnect starts a fresh run of refused LOGINs
	if s.testHookInitialSync != nil {
		s.testHookInitialSync(ctx, row)
	} else if _, _, syncErr := s.syncAccount(ctx, row, false, true); syncErr != nil {
		s.log.Warn("email hub initial sync failed", "account_id", row.ID, "err", syncErr)
	}
	updated, err := s.q.GetEmailHubAccount(ctx, db.GetEmailHubAccountParams{
		ID: row.ID, UserID: actor.ID, OrganizationID: ws.OrganizationID,
	})
	if err != nil {
		return accountView(row), nil
	}
	return accountView(updated), nil
}

func (s *EmailHubService) verifyEmailHubLogin(ctx context.Context, imap imapclient.Credentials, smtp smtpclient.Credentials) error {
	if s.testHookVerify != nil {
		return s.testHookVerify(ctx, imap, smtp)
	}
	if err := imapclient.VerifyLogin(imap); err != nil {
		return err
	}
	return smtpclient.VerifyLogin(smtp)
}

// saveEmailHubConnection writes verified credentials and the connected audit
// row in one transaction. It re-reads the address FOR UPDATE, because a racing
// request may have connected or disconnected the mailbox since the pre-dial
// check: a live row found there stays locked until commit, so it is updated in
// place (keeping its id; the credential_version bump makes a markAuthFailed
// with the old version match nothing); no live row means a fresh insert, and a
// concurrent insert of the same address loses on the unique index.
// serverChanged reports that the kept row moved to another IMAP server, whose
// UIDs make the cached mail meaningless (spec §3).
func (s *EmailHubService) saveEmailHubConnection(
	ctx context.Context, actor Actor, byAddress db.GetActiveEmailHubAccountByAddressParams,
	srv emailHubServer, passwordEnc string,
) (db.EmailHubAccount, bool, error) {
	tx, err := s.ws.pool.Begin(ctx)
	if err != nil {
		return db.EmailHubAccount{}, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)
	existing, err := qtx.GetActiveEmailHubAccountByAddress(ctx, byAddress)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return db.EmailHubAccount{}, false, err
	}
	reconnected := err == nil
	serverChanged := reconnected &&
		(!strings.EqualFold(existing.ImapHost, srv.IMAPHost) || int(existing.ImapPort) != srv.IMAPPort)
	var row db.EmailHubAccount
	switch {
	case reconnected && sameEmailHubConnection(existing, "password", srv.IMAPHost, srv.IMAPPort):
		return db.EmailHubAccount{}, false, ErrEmailHubAlreadyConnected
	case reconnected:
		row, err = qtx.UpdateEmailHubAccountCredentials(ctx, db.UpdateEmailHubAccountCredentialsParams{
			ID: existing.ID, OrganizationID: byAddress.OrganizationID, Provider: srv.Provider,
			ImapHost: srv.IMAPHost, ImapPort: int32(srv.IMAPPort), ImapSecurity: srv.IMAPSecurity,
			SmtpHost: srv.SMTPHost, SmtpPort: int32(srv.SMTPPort), SmtpSecurity: srv.SMTPSecurity,
			Username: srv.Username, AuthKind: "password", PasswordEnc: passwordEnc,
		})
	default:
		row, err = qtx.CreateEmailHubAccount(ctx, db.CreateEmailHubAccountParams{
			ID: util.NewID(), UserID: byAddress.UserID, OrganizationID: byAddress.OrganizationID,
			EmailAddress: byAddress.Email, Provider: srv.Provider,
			ImapHost: srv.IMAPHost, ImapPort: int32(srv.IMAPPort), ImapSecurity: srv.IMAPSecurity,
			SmtpHost: srv.SMTPHost, SmtpPort: int32(srv.SMTPPort), SmtpSecurity: srv.SMTPSecurity,
			Username: srv.Username, AuthKind: "password", PasswordEnc: passwordEnc,
		})
		if isUniqueViolation(err) {
			return db.EmailHubAccount{}, false, ErrEmailHubAlreadyConnected // a concurrent Connect inserted first
		}
	}
	if err != nil {
		return db.EmailHubAccount{}, false, err
	}
	if err := auditRecorder.Record(ctx, qtx, audit.Entry{
		OrganizationID: byAddress.OrganizationID,
		Actor:          actor,
		Action:         audit.ActionEmailHubAccountConnected,
		ResourceType:   "email_hub_account",
		ResourceID:     row.ID,
		Metadata: map[string]any{
			"auth_kind": row.AuthKind, "provider": row.Provider,
			"reconnected": reconnected, "server_changed": serverChanged,
		},
	}); err != nil {
		return db.EmailHubAccount{}, false, err
	}
	return row, serverChanged, tx.Commit(ctx)
}

// sameEmailHubConnection reports whether acc is a live connection Connect
// would only duplicate: same auth kind and IMAP server, not awaiting a
// reconnect (spec §3).
func sameEmailHubConnection(acc db.EmailHubAccount, authKind, imapHost string, imapPort int) bool {
	return !acc.AuthFailedAt.Valid && acc.AuthKind == authKind &&
		strings.EqualFold(acc.ImapHost, imapHost) && int(acc.ImapPort) == imapPort
}

// classifyEmailHubConnectError maps a login-check failure to the code the log
// carries and the stable error the client sees. The raw error goes to neither:
// it holds the host and the server's replies (spec §7).
func classifyEmailHubConnectError(err error) (string, error) {
	var netErr net.Error
	var certErr *tls.CertificateVerificationError
	var recordErr tls.RecordHeaderError
	switch {
	case errors.Is(err, imapclient.ErrTLSRequired), errors.Is(err, smtpclient.ErrTLSRequired),
		errors.As(err, &recordErr): // TLS spoken to a plaintext greeter, e.g. security tls on port 143/587
		return "tls_required", ErrEmailHubTLSRequired
	case errors.Is(err, smtpclient.ErrSMTPAuthDisabled):
		return "smtp_disabled", ErrEmailHubSMTPDisabled
	case errors.Is(err, imapclient.ErrAuthFailed), errors.Is(err, imapclient.ErrLoginRefused),
		errors.Is(err, smtpclient.ErrAuthFailed):
		return "auth_failed", ErrEmailHubConnectFailed
	case errors.Is(err, netguard.ErrHostNotAllowed):
		// A blocked host answers like an unknown one, so Connect is no DNS oracle; only the log tells them apart.
		return "host_not_allowed", ErrEmailHubUnreachable
	case errors.As(err, &netErr), errors.As(err, &certErr):
		return "unreachable", ErrEmailHubUnreachable
	default:
		return "connect_failed", ErrEmailHubConnectFailed
	}
}
