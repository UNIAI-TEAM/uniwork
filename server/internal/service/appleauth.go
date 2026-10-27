package service

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/mail"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// AppleTokenVerifier checks a native identity token; auth.AppleVerifier in
// production.
type AppleTokenVerifier interface {
	Verify(ctx context.Context, rawToken, rawNonce string) (auth.AppleClaims, error)
}

// AppleTokenClient redeems the authorization code and revokes the refresh
// token; auth.AppleClient in production, nil when no Sign in with Apple key
// is configured (then nothing is kept and nothing can be revoked).
type AppleTokenClient interface {
	RefreshTokenForCode(ctx context.Context, clientID, code string) (string, error)
	Revoke(ctx context.Context, clientID, refreshToken string) error
}

// appleCallTimeout bounds each call to Apple's token or revoke endpoint.
const appleCallTimeout = 10 * time.Second

var (
	// ErrAppleTokenInvalid: the identity token is not one Apple issued to
	// this app for this sign-in (signature, iss, aud, exp or nonce), or it
	// carries no address Apple vouches for and names no linked account.
	ErrAppleTokenInvalid = errors.New("apple_token_invalid")
	// ErrAppleAccountConflict: the address belongs to an account the Apple
	// identity may not join from this route (ADR 0041, 0047).
	ErrAppleAccountConflict = errors.New("apple_account_conflict")
	// ErrMFARequired: the account has a second factor, which only the
	// browser sign-in asks for.
	ErrMFARequired = errors.New("mfa_required")
)

func appleTokenInvalid() error {
	return CodedError{Code: "apple_token_invalid", Status: http.StatusUnauthorized, Msg: "Apple identity token is invalid", Err: ErrAppleTokenInvalid}
}

func appleAccountConflict() error {
	return CodedError{Code: "apple_account_conflict", Status: http.StatusConflict, Msg: "this email belongs to another sign-in method", Err: ErrAppleAccountConflict}
}

func appleMFARequired() error {
	return CodedError{Code: "mfa_required", Status: http.StatusForbidden, Msg: "this account signs in with a second factor in the browser", Err: ErrMFARequired}
}

// AppleAuthService turns a native Sign in with Apple into the same device
// session the PKCE code exchange issues (ADR 0041), resolving the account
// with the rules every provider shares (resolveIdentity, ADR 0047).
type AppleAuthService struct {
	pool     *pgxpool.Pool
	q        *db.Queries
	desktop  *DesktopAuthService
	verifier AppleTokenVerifier
	client   AppleTokenClient
	sealer   auth.SecretSealer
	log      *slog.Logger
	// render/out are nil-safe: without SetMail no alert goes out.
	render mail.Renderer
	out    mail.Enqueuer
}

// NewAppleAuthService seals the kept refresh token with the server's one
// sealer (main.go builds it from the JWT secret, as for MFA secrets); client
// may be nil.
func NewAppleAuthService(pool *pgxpool.Pool, q *db.Queries, desktop *DesktopAuthService, verifier AppleTokenVerifier, client AppleTokenClient, sealer auth.SecretSealer) *AppleAuthService {
	return &AppleAuthService{pool: pool, q: q, desktop: desktop, verifier: verifier, client: client, sealer: sealer, log: slog.Default()}
}

// SetMail wires the owner alerts: the sign-in method notice and the
// new-login mail.
func (s *AppleAuthService) SetMail(r mail.Renderer, out mail.Enqueuer) {
	s.render = r
	s.out = out
}

// AppleSignInInput is what the app sends after Apple's sheet: the identity
// token, the raw nonce whose SHA-256 the token must carry, the authorization
// code and, on the first sign-in only, the name; plus the device fields of a
// native session.
type AppleSignInInput struct {
	IdentityToken     string
	Nonce             string
	AuthorizationCode string
	GivenName         string
	FamilyName        string
	ClientID          string
	DeploymentID      string
	DeviceLabel       string
	Platform          string
	Build             string
	Locale            string
}

func (s *AppleAuthService) mailer() signInMailer {
	return signInMailer{render: s.render, out: s.out, now: s.desktop.now}
}

// SignIn is POST /auth/apple/native, the contract the shipped iPhone app
// speaks (ADR 0041): it resolves the account with resolveIdentity and keeps
// the answers that app knows (spec §3.6) —
//
//   - matched: the account linked to the subject;
//   - unmatched: a new password-less account with a verified address, as
//     before;
//   - reclaim: the account registered with the address before it was proved
//     is taken back without its second factor;
//   - link (verified on both sides, Apple owns the address): linked, the
//     owner told;
//   - a second factor on the account: 403 mfa_required, nothing linked;
//   - no address Apple vouches for: 401 apple_token_invalid;
//   - any other refusal, link_required included (this app has no choice
//     screen and the address is taken): 409 apple_account_conflict.
//
// It answers the native device session.
// ponytail: retire once every mobile build in use calls /auth/native/apple;
// reviewed by 2027-01-31 (spec §3.6).
func (s *AppleAuthService) SignIn(ctx context.Context, in AppleSignInInput) (DesktopSession, error) {
	if !s.desktop.clientAllowed(in.ClientID, in.DeploymentID) {
		return DesktopSession{}, Invalid("invalid native sign-in client")
	}
	claims, err := s.verifier.Verify(ctx, in.IdentityToken, in.Nonce)
	if err != nil {
		reason := "unknown"
		var te auth.AppleTokenError
		if errors.As(err, &te) {
			reason = te.Reason
		}
		s.log.Info("apple sign-in refused", "reason", reason)
		return DesktopSession{}, appleTokenInvalid()
	}
	if !appleIdentity(claims, "", "", "").emailUsable() {
		// Only an account already linked to the subject can do without the
		// address; checked before Apple's token endpoint is asked anything.
		if _, err := s.q.GetUserByAppleID(ctx, pgtype.Text{String: claims.Sub, Valid: true}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return DesktopSession{}, appleTokenInvalid()
			}
			return DesktopSession{}, err
		}
	}
	token, sealed := s.keepRefreshToken(ctx, claims, in.AuthorizationCode)
	committed := false
	defer func() {
		// A token Apple handed out for a sign-in that did not happen (a
		// conflict, a second factor) is given back rather than orphaned.
		if !committed && token != "" {
			s.revoke(ctx, "", claims.Audience, token)
		}
	}()
	id := appleIdentity(claims, in.GivenName, in.FamilyName, sealed)
	device := mail.SafeField(sanitizeDesktopLabel(in.DeviceLabel))
	if device == "" {
		device = mail.SafeField(sanitizeMetadata(in.Platform))
	}
	m := s.mailer()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return DesktopSession{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.q.WithTx(tx)
	acct, err := s.resolveLegacy(ctx, q, id, in.Locale, device)
	if err != nil {
		return DesktopSession{}, legacyAppleError(err)
	}
	u := acct.user
	// Read before this sign-in adds its own: an account with a session
	// somewhere is one whose owner must hear of a new one. A link or a
	// reclaim sends its own notice instead.
	hadSessions := false
	if acct.how == "subject" {
		n, err := q.CountRefreshTokensForUser(ctx, u.ID)
		if err != nil {
			return DesktopSession{}, err
		}
		hadSessions = n > 0
	}
	if sealed != "" {
		if err := q.SetAppleRefreshToken(ctx, db.SetAppleRefreshTokenParams{
			ID: u.ID, AppleClientID: pgtype.Text{String: claims.Audience, Valid: true},
			AppleRefreshTokenEnc: pgtype.Text{String: sealed, Valid: true},
		}); err != nil {
			return DesktopSession{}, err
		}
	}
	sess, err := s.desktop.issueDeviceSession(ctx, q, u.ID, nativeDevice{
		ClientID: in.ClientID, DeploymentID: in.DeploymentID, Label: sanitizeDesktopLabel(in.DeviceLabel),
		Platform: sanitizeMetadata(in.Platform), Build: sanitizeMetadata(in.Build),
	})
	if err != nil {
		return DesktopSession{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: audit.NoOrganization, Actor: audit.User(u.ID),
		Action: audit.ActionAuthLoginSucceeded, ResourceType: "user", ResourceID: u.ID,
		Metadata: map[string]any{"via": "apple", "account": acct.how},
	}); err != nil {
		return DesktopSession{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		if isUniqueViolation(err) {
			return DesktopSession{}, appleAccountConflict()
		}
		return DesktopSession{}, err
	}
	committed = true
	m.kick(acct.queued)
	if acct.how == "reclaim" {
		observeOfficeLeaseRevokes(OfficeLeaseRevokeSessionRevoked, acct.reclaim.leases)
		s.revokeAfterCommit(ctx, u.ID, acct.reclaim.appleClientID, acct.reclaim.appleToken)
	}
	if hadSessions {
		s.tellNewSession(ctx, u, device)
	}
	return sess, nil
}

// legacyAppleAccount is the account the legacy route signs into and how it
// was found: subject, created, reclaim or email.
type legacyAppleAccount struct {
	user    db.User
	how     string
	reclaim reclaimed
	queued  bool // a notice waits in the transaction for the Kick
}

// resolveLegacy acts on resolveIdentity's answer for the legacy route.
func (s *AppleAuthService) resolveLegacy(ctx context.Context, q *db.Queries, id ProviderIdentity, locale, device string) (legacyAppleAccount, error) {
	res, err := resolveIdentity(ctx, q, id)
	if err != nil {
		return legacyAppleAccount{}, err
	}
	switch res.kind {
	case identityMatched:
		if res.user.MfaEnabledAt.Valid {
			return legacyAppleAccount{}, appleMFARequired()
		}
		return legacyAppleAccount{user: res.user, how: "subject"}, nil
	case identityUnmatched:
		// Apple verified the address; the shipped app has no screen to prove
		// it again, so the account starts verified, as it always has.
		u, err := createProviderUser(ctx, q, id, locale, true)
		return legacyAppleAccount{user: u, how: "created"}, err
	case identityReclaim:
		r, err := reclaimAccount(ctx, q, res.user, id, s.mailer(), device)
		return legacyAppleAccount{user: r.user, how: "reclaim", reclaim: r, queued: r.queued}, err
	case identityLink:
		if res.user.MfaEnabledAt.Valid {
			return legacyAppleAccount{}, appleMFARequired()
		}
		u, queued, err := linkByEmail(ctx, q, res.user, id, s.mailer(), device)
		return legacyAppleAccount{user: u, how: "email", queued: queued}, err
	default: // identityLinkRequired: the address is an account's, and only its owner may add Apple
		return legacyAppleAccount{}, appleAccountConflict()
	}
}

// legacyAppleError maps the shared resolver's refusals onto the codes the
// shipped app reads: an address Apple does not vouch for is the token's
// fault, every other refusal is a conflict, as it was before ADR 0047.
func legacyAppleError(err error) error {
	switch {
	case errors.Is(err, ErrSignInEmailUnverified):
		return appleTokenInvalid()
	case errors.Is(err, ErrSignInAccountConflict), errors.Is(err, ErrSignInAccountUnverified):
		return appleAccountConflict()
	default:
		return err
	}
}

// tellNewSession sends, after commit and best effort, what a browser
// sign-in from a new device would have: the new-login alert, naming the
// device. A new account hears nothing; a link or a reclaim queued its own
// notice in the transaction.
func (s *AppleAuthService) tellNewSession(ctx context.Context, u db.User, device string) {
	if s.out == nil {
		return
	}
	msg, err := s.render.NewLogin(u.Email, u.Locale, u.ID, mail.NewLoginData{
		UserAgent: device, IP: mail.SafeField(sessionMetaFrom(ctx).IP), At: s.desktop.now(),
		SessionsURL: s.render.AppURL + "/settings?tab=security", App: true,
	})
	if err == nil {
		_, err = s.out.Enqueue(ctx, s.q, msg)
	}
	if err != nil {
		s.log.Warn("apple sign-in alert not queued", "user", u.ID, "kind", msg.Kind, "err", err)
		return
	}
	s.out.Kick()
}

// keepRefreshToken redeems the authorization code for the refresh token
// account deletion revokes, and seals it. Best effort: Apple being slow or the
// code spent does not stop the sign-in; the next sign-in sends a fresh code.
func (s *AppleAuthService) keepRefreshToken(ctx context.Context, c auth.AppleClaims, code string) (token, sealed string) {
	if s.client == nil || code == "" {
		return "", ""
	}
	callCtx, cancel := context.WithTimeout(ctx, appleCallTimeout)
	defer cancel()
	token, err := s.client.RefreshTokenForCode(callCtx, c.Audience, code)
	if err != nil {
		s.log.Warn("apple code exchange failed", "code", appleErrorCode(err))
		return "", ""
	}
	sealed, err = s.sealer.Seal(token)
	if err != nil {
		s.log.Warn("apple refresh token not sealed", "code", "seal")
		s.revoke(ctx, "", c.Audience, token)
		return "", ""
	}
	return token, sealed
}

// revokeAfterCommit tells Apple a consent the account no longer holds is gone:
// a deleted account's (Apple requires it of apps with Sign in with Apple), or
// the one whoever registered a reclaimed account left. The change already
// committed, so this never fails it: an error is logged by code, never with
// the token.
func (s *AppleAuthService) revokeAfterCommit(ctx context.Context, userID, clientID, sealed string) {
	if s == nil || s.client == nil || clientID == "" || sealed == "" {
		return
	}
	token, err := s.sealer.Open(sealed)
	if err != nil {
		s.log.Warn("apple revoke failed", "user", userID, "code", "unsealable")
		return
	}
	s.revoke(ctx, userID, clientID, token)
}

// revoke gives one refresh token back to Apple, logging failures by code.
func (s *AppleAuthService) revoke(ctx context.Context, userID, clientID, token string) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), appleCallTimeout)
	defer cancel()
	if err := s.client.Revoke(ctx, clientID, token); err != nil {
		s.log.Warn("apple revoke failed", "user", userID, "code", appleErrorCode(err))
	}
}

func appleErrorCode(err error) string {
	var ce auth.AppleClientError
	switch {
	case errors.As(err, &ce):
		if ce.Code != "" {
			return ce.Code
		}
		return "status"
	case errors.Is(err, context.DeadlineExceeded):
		return "timeout"
	default:
		return "unreachable"
	}
}
