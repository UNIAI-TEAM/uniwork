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
	"github.com/unicomhub/uniwork/server/internal/emailhub"
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
// membership, fields, the duplicate check (before any dial), the login, then
// one transaction for the row and its audit. An address that needs a
// reconnect keeps its id and its cached mail.
func (s *EmailHubService) Connect(ctx context.Context, actor Actor, workspaceID string, in ConnectEmailHubInput) (EmailHubAccountView, error) {
	ws, err := s.workspace(ctx, actor, workspaceID)
	if err != nil {
		return EmailHubAccountView{}, err
	}
	if !s.Enabled() {
		return EmailHubAccountView{}, ErrEmailHubNotConfigured
	}
	email := strings.ToLower(strings.TrimSpace(in.EmailAddress))
	password := strings.TrimSpace(in.AppPassword)
	if email == "" || password == "" {
		return EmailHubAccountView{}, Invalid("email and app password required")
	}
	prov, ok := emailhub.ProviderForEmail(email)
	if !ok {
		return EmailHubAccountView{}, ErrEmailHubUnsupported
	}
	byAddress := db.GetActiveEmailHubAccountByAddressParams{
		OrganizationID: ws.OrganizationID, UserID: actor.ID, Email: email,
	}
	existing, err := s.q.GetActiveEmailHubAccountByAddress(ctx, byAddress)
	switch {
	case err == nil && sameEmailHubConnection(existing, "password", prov.IMAPHost, prov.IMAPPort):
		return EmailHubAccountView{}, ErrEmailHubAlreadyConnected
	case err != nil && !errors.Is(err, pgx.ErrNoRows):
		return EmailHubAccountView{}, err
	}
	imapCreds := imapclient.Credentials{
		Host: prov.IMAPHost, Port: prov.IMAPPort, Email: email, Password: password, Security: "tls",
	}
	smtpCreds := smtpclient.Credentials{
		Host: prov.SMTPHost, Port: prov.SMTPPort, Email: email, Password: password, Security: "starttls",
	}
	if err := s.verifyEmailHubLogin(ctx, imapCreds, smtpCreds); err != nil {
		code, mapped := classifyEmailHubConnectError(err)
		s.log.Warn("email hub connect verify failed", "code", code, "provider", prov.Name, "user_id", actor.ID)
		return EmailHubAccountView{}, mapped
	}
	sealed, err := s.box.Seal([]byte(password))
	if err != nil {
		return EmailHubAccountView{}, err
	}
	row, err := s.saveEmailHubConnection(ctx, actor, byAddress, prov, base64.StdEncoding.EncodeToString(sealed))
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
func (s *EmailHubService) saveEmailHubConnection(
	ctx context.Context, actor Actor, byAddress db.GetActiveEmailHubAccountByAddressParams,
	prov emailhub.Provider, passwordEnc string,
) (db.EmailHubAccount, error) {
	tx, err := s.ws.pool.Begin(ctx)
	if err != nil {
		return db.EmailHubAccount{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)
	existing, err := qtx.GetActiveEmailHubAccountByAddress(ctx, byAddress)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return db.EmailHubAccount{}, err
	}
	reconnected := err == nil
	var row db.EmailHubAccount
	switch {
	case reconnected && sameEmailHubConnection(existing, "password", prov.IMAPHost, prov.IMAPPort):
		return db.EmailHubAccount{}, ErrEmailHubAlreadyConnected
	case reconnected:
		row, err = qtx.UpdateEmailHubAccountCredentials(ctx, db.UpdateEmailHubAccountCredentialsParams{
			ID: existing.ID, OrganizationID: byAddress.OrganizationID, Provider: prov.Name,
			ImapHost: prov.IMAPHost, ImapPort: int32(prov.IMAPPort), ImapSecurity: "tls",
			SmtpHost: prov.SMTPHost, SmtpPort: int32(prov.SMTPPort), SmtpSecurity: "starttls",
			Username: "", AuthKind: "password", PasswordEnc: passwordEnc,
		})
	default:
		row, err = qtx.CreateEmailHubAccount(ctx, db.CreateEmailHubAccountParams{
			ID: util.NewID(), UserID: byAddress.UserID, OrganizationID: byAddress.OrganizationID,
			EmailAddress: byAddress.Email, Provider: prov.Name,
			ImapHost: prov.IMAPHost, ImapPort: int32(prov.IMAPPort), ImapSecurity: "tls",
			SmtpHost: prov.SMTPHost, SmtpPort: int32(prov.SMTPPort), SmtpSecurity: "starttls",
			Username: "", AuthKind: "password", PasswordEnc: passwordEnc,
		})
		if isUniqueViolation(err) {
			return db.EmailHubAccount{}, ErrEmailHubAlreadyConnected // a concurrent Connect inserted first
		}
	}
	if err != nil {
		return db.EmailHubAccount{}, err
	}
	if err := auditRecorder.Record(ctx, qtx, audit.Entry{
		OrganizationID: byAddress.OrganizationID,
		Actor:          actor,
		Action:         audit.ActionEmailHubAccountConnected,
		ResourceType:   "email_hub_account",
		ResourceID:     row.ID,
		Metadata:       map[string]any{"auth_kind": row.AuthKind, "provider": row.Provider, "reconnected": reconnected},
	}); err != nil {
		return db.EmailHubAccount{}, err
	}
	return row, tx.Commit(ctx)
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
	switch {
	case errors.Is(err, imapclient.ErrTLSRequired), errors.Is(err, smtpclient.ErrTLSRequired):
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
