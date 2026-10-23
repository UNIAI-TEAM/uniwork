package service

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/util"
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
	// this app for this sign-in (signature, iss, aud, exp or nonce).
	ErrAppleTokenInvalid = errors.New("apple_token_invalid")
	// ErrAppleAccountConflict: the address belongs to an account the Apple
	// identity may not take over (ADR 0041).
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
// session the PKCE code exchange issues (ADR 0041).
type AppleAuthService struct {
	pool     *pgxpool.Pool
	q        *db.Queries
	desktop  *DesktopAuthService
	verifier AppleTokenVerifier
	client   AppleTokenClient
	sealer   auth.SecretSealer
	log      *slog.Logger
}

// NewAppleAuthService seals the kept refresh token with a key derived from the
// JWT secret, as MFA secrets are; client may be nil.
func NewAppleAuthService(pool *pgxpool.Pool, q *db.Queries, desktop *DesktopAuthService, verifier AppleTokenVerifier, client AppleTokenClient) *AppleAuthService {
	sealer, _ := auth.NewSecretSealer([]byte(desktop.cfg.JWTSecret))
	return &AppleAuthService{pool: pool, q: q, desktop: desktop, verifier: verifier, client: client, sealer: sealer, log: slog.Default()}
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

// SignIn resolves the account in this order: the one linked to the Apple
// subject; else one with the same address, linked, only when Apple's address
// is not a private relay and the account's address is verified; else a new
// password-less account, through the same provider path Google sign-up uses
// (onboarding still ahead). It answers the native device session.
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
	if !appleEmailUsable(claims) {
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
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return DesktopSession{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.q.WithTx(tx)
	u, how, err := s.resolveUser(ctx, q, claims, in)
	if err != nil {
		return DesktopSession{}, err
	}
	if u.MfaEnabledAt.Valid {
		return DesktopSession{}, appleMFARequired()
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
		Metadata: map[string]any{"via": "apple", "account": how},
	}); err != nil {
		return DesktopSession{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		if isUniqueViolation(err) {
			return DesktopSession{}, ErrConflict
		}
		return DesktopSession{}, err
	}
	committed = true
	return sess, nil
}

// appleEmailUsable: the token carries an address Apple verified.
func appleEmailUsable(c auth.AppleClaims) bool {
	email := strings.TrimSpace(c.Email)
	return c.EmailVerified && strings.Contains(email, "@") && !strings.HasPrefix(email, "@")
}

// resolveUser answers the account and how it was found: subject, email or
// created.
func (s *AppleAuthService) resolveUser(ctx context.Context, q *db.Queries, c auth.AppleClaims, in AppleSignInInput) (db.User, string, error) {
	sub := pgtype.Text{String: c.Sub, Valid: true}
	if u, err := q.GetUserByAppleID(ctx, sub); err == nil {
		return u, "subject", nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return db.User{}, "", err
	}
	if !appleEmailUsable(c) {
		return db.User{}, "", appleTokenInvalid()
	}
	email := strings.ToLower(strings.TrimSpace(c.Email))
	existing, err := q.GetUserByEmail(ctx, email)
	switch {
	case err == nil:
		// A relay address is Apple's alias for this one app: it never names
		// an account someone made another way. An unverified address could
		// be one someone typed before its owner arrived.
		if c.PrivateEmail || !existing.EmailVerifiedAt.Valid || existing.AppleID.Valid {
			return db.User{}, "", appleAccountConflict()
		}
		u, err := q.LinkAppleAccount(ctx, db.LinkAppleAccountParams{ID: existing.ID, AppleID: sub})
		if errors.Is(err, pgx.ErrNoRows) {
			return db.User{}, "", appleAccountConflict()
		}
		return u, "email", err
	case errors.Is(err, pgx.ErrNoRows):
		u, err := q.CreateAppleUser(ctx, db.CreateAppleUserParams{
			ID: util.NewID(), Email: email, DisplayName: appleDisplayName(in.GivenName, in.FamilyName, email),
			AppleID: sub, Locale: NormalizeLocale(in.Locale),
		})
		if isUniqueViolation(err) {
			return db.User{}, "", ErrConflict
		}
		return u, "created", err
	default:
		return db.User{}, "", err
	}
}

// appleDisplayName is the name Apple shared on the first sign-in, else the
// address's local part (a relay address gives its alias; the person renames
// themselves in Settings).
func appleDisplayName(given, family, email string) string {
	name := strings.Join(strings.Fields(strings.TrimSpace(given+" "+family)), " ")
	if name == "" {
		name = email[:strings.Index(email, "@")]
	}
	if utf8.RuneCountInString(name) > maxDisplayNameRunes {
		name = string([]rune(name)[:maxDisplayNameRunes])
	}
	return name
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

// revokeAfterCommit tells Apple the deleted account's consent is gone (Apple
// requires it of apps with Sign in with Apple). The deletion already
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
