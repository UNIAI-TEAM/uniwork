package service

import (
	"context"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	netmail "net/mail"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/oauth2"

	"github.com/unicomhub/uniwork/server/internal/emailhub/imapclient"
	"github.com/unicomhub/uniwork/server/internal/emailhub/smtpclient"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Result codes of the OAuth callback (spec §5.4). The popup page posts one to
// the opener and the dialog maps it to copy; nothing else leaves the service.
const (
	EmailHubOAuthConnected        = "connected"
	EmailHubOAuthDenied           = "denied"
	EmailHubOAuthStateInvalid     = "state_invalid"
	EmailHubOAuthEmailUnavailable = "email_unavailable"
	EmailHubOAuthIMAPNotEnabled   = "imap_not_enabled"
	EmailHubOAuthSMTPDisabled     = "smtp_disabled"
	EmailHubOAuthAlreadyConnected = "already_connected"
	EmailHubOAuthConsentRequired  = "consent_required"
	EmailHubOAuthFailed           = "failed"
)

const emailHubOAuthExchangeTimeout = 10 * time.Second

// CompleteOAuth finishes a provider sign-in and connects the mailbox it
// proves, or reconnects the live row of that address on the same id (spec
// §3, §5.4). The state is the only source of user, workspace and PKCE
// verifier; the cookie nonce binds it to the browser that started. The
// address is whatever the id_token and the XOAUTH2 login prove, which may not
// be the login_hint of a reconnect. Every refusal writes nothing and logs
// codes only.
func (s *EmailHubService) CompleteOAuth(ctx context.Context, provider, rawState, code, providerError, cookieNonce string) string {
	// The code is single-use: once spent, finish the connect even if the popup closes.
	ctx = context.WithoutCancel(ctx)
	userID := ""
	fail := func(result, reason string) string {
		s.log.Warn("email hub oauth callback failed",
			"code", result, "reason", reason, "provider", provider, "user_id", userID)
		return result
	}
	if !s.Enabled() {
		return fail(EmailHubOAuthFailed, "not_configured")
	}
	st, ok := s.openOAuthState(rawState)
	if !ok || st.Provider != provider { // openOAuthState already refuses an expired state
		return fail(EmailHubOAuthStateInvalid, "state")
	}
	// An empty cookie never matches, even a state sealed with an empty nonce.
	if cookieNonce == "" || subtle.ConstantTimeCompare([]byte(cookieNonce), []byte(st.Nonce)) != 1 {
		return fail(EmailHubOAuthStateInvalid, "nonce")
	}
	userID = st.UserID
	switch {
	case providerError == "access_denied":
		return fail(EmailHubOAuthDenied, "access_denied")
	case providerError != "":
		return fail(EmailHubOAuthFailed, "provider_error")
	}
	// Membership first: a member deactivated since the start never spends the code.
	actor := Human(st.UserID)
	ws, err := s.workspace(ctx, actor, st.WorkspaceID)
	if err != nil || ws.OrganizationID != st.OrganizationID {
		return fail(EmailHubOAuthFailed, "membership")
	}
	p, ok := s.oauthProvider(provider)
	if !ok {
		return fail(EmailHubOAuthFailed, "provider_disabled")
	}
	exchangeCtx, cancel := context.WithTimeout(ctx, emailHubOAuthExchangeTimeout)
	defer cancel()
	tok, err := p.config.Exchange(s.oauthCtx(exchangeCtx), code, oauth2.VerifierOption(st.Verifier))
	if err != nil {
		reason := "exchange"
		var re *oauth2.RetrieveError
		if errors.As(err, &re) {
			// Only RFC 6749 codes reach the log; the provider controls this field.
			switch re.ErrorCode {
			case "invalid_grant", "invalid_client", "invalid_request", "unauthorized_client", "unsupported_grant_type":
				reason = "exchange_" + re.ErrorCode
			}
		}
		return fail(EmailHubOAuthFailed, reason)
	}
	// Without a refresh token the grant dies within the hour; an old one is
	// never reused (spec §5.4 step 8).
	if tok.RefreshToken == "" {
		return fail(EmailHubOAuthConsentRequired, "no_refresh_token")
	}
	idToken, _ := tok.Extra("id_token").(string)
	email, ok := emailHubIDTokenEmail(provider, idToken)
	if !ok {
		return fail(EmailHubOAuthEmailUnavailable, "id_token")
	}
	srv := presetEmailHubServer(p.preset)
	byAddress := db.GetActiveEmailHubAccountByAddressParams{
		OrganizationID: ws.OrganizationID, UserID: st.UserID, Email: email,
	}
	existing, err := s.q.GetActiveEmailHubAccountByAddress(ctx, byAddress)
	switch {
	case err == nil && sameEmailHubConnection(existing, p.authKind, srv.IMAPHost, srv.IMAPPort):
		return fail(EmailHubOAuthAlreadyConnected, "duplicate")
	case err != nil && !errors.Is(err, pgx.ErrNoRows):
		return fail(EmailHubOAuthFailed, emailHubErrCode(err))
	}
	imapCreds := imapclient.Credentials{
		Host: srv.IMAPHost, Port: srv.IMAPPort, Email: email, Security: srv.IMAPSecurity, AccessToken: tok.AccessToken,
	}
	smtpCreds := smtpclient.Credentials{
		Host: srv.SMTPHost, Port: srv.SMTPPort, Email: email, Security: srv.SMTPSecurity, AccessToken: tok.AccessToken,
	}
	// Never skippable: the XOAUTH2 login is the only proof the address is the
	// user's (Microsoft's email claim is admin-editable).
	if err := s.verifyEmailHubLogin(ctx, imapCreds, smtpCreds); err != nil {
		result := EmailHubOAuthFailed
		switch {
		// A brand-new token refused at AUTHENTICATE means IMAP is off for the
		// mailbox (M365 answers a bare NO), not a wrong credential.
		case errors.Is(err, imapclient.ErrAuthFailed), errors.Is(err, imapclient.ErrLoginRefused):
			result = EmailHubOAuthIMAPNotEnabled
		case errors.Is(err, smtpclient.ErrSMTPAuthDisabled):
			result = EmailHubOAuthSMTPDisabled
		}
		return fail(result, emailHubErrCode(err))
	}
	cred := emailHubSealedCredential{
		AuthKind:        p.authKind,
		AccessExpiresAt: pgtype.Timestamptz{Time: tok.Expiry, Valid: !tok.Expiry.IsZero()},
	}
	if cred.RefreshEnc, err = s.sealSecret(tok.RefreshToken); err != nil {
		return fail(EmailHubOAuthFailed, "seal")
	}
	if cred.AccessEnc, err = s.sealSecret(tok.AccessToken); err != nil {
		return fail(EmailHubOAuthFailed, "seal")
	}
	row, prev, serverChanged, err := s.saveEmailHubConnection(ctx, actor, byAddress, srv, cred)
	switch {
	case errors.Is(err, ErrEmailHubAlreadyConnected):
		return fail(EmailHubOAuthAlreadyConnected, "duplicate") // a concurrent connect won
	case err != nil:
		return fail(EmailHubOAuthFailed, emailHubErrCode(err))
	}
	s.revokeReplacedEmailHubToken(ctx, prev, row)
	s.afterEmailHubConnect(ctx, row, serverChanged)
	return EmailHubOAuthConnected
}

// emailHubIDTokenEmail reads the mailbox address from an id_token that came
// straight from the provider's token endpoint over TLS, so its signature is
// not checked again (OIDC Core §3.1.3.7). Google: email, only when
// email_verified is true. Microsoft: email, else preferred_username (the UPN,
// which may not be the primary SMTP address; the XOAUTH2 login decides). The
// result is lowercased and must be a bare address.
func emailHubIDTokenEmail(provider, idToken string) (string, bool) {
	parts := strings.Split(idToken, ".")
	if len(parts) != 3 {
		return "", false
	}
	payload, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", false
	}
	var claims struct {
		Email             string `json:"email"`
		EmailVerified     bool   `json:"email_verified"`
		PreferredUsername string `json:"preferred_username"`
	}
	if json.Unmarshal(payload, &claims) != nil {
		return "", false
	}
	var email string
	switch provider {
	case "google":
		if claims.EmailVerified {
			email = claims.Email
		}
	case "microsoft":
		email = claims.Email
		if strings.TrimSpace(email) == "" {
			email = claims.PreferredUsername
		}
	default:
		return "", false
	}
	email = strings.ToLower(strings.TrimSpace(email))
	if a, err := netmail.ParseAddress(email); err != nil || a.Address != email || strings.ContainsAny(email, "\r\n") {
		return "", false
	}
	return email, true
}
