package service

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/auth"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// totpIssuer is the name the authenticator app shows beside the account.
const totpIssuer = "UniWork"

// MFASetup is what the user scans: the raw secret for manual entry and the
// otpauth URI for the QR code. Nothing is enabled until ConfirmTOTP.
type MFASetup struct {
	Secret     string
	OTPAuthURL string
}

// SetupTOTP starts (or restarts) enrolment. ErrConflict while MFA is on:
// disable first, so a stolen session cannot silently swap the secret.
func (s *AuthService) SetupTOTP(ctx context.Context, userID string) (MFASetup, error) {
	u, err := s.Me(ctx, userID)
	if err != nil {
		return MFASetup{}, err
	}
	if u.MfaEnabledAt.Valid {
		return MFASetup{}, ErrConflict
	}
	secret, err := auth.NewTOTPSecret()
	if err != nil {
		return MFASetup{}, err
	}
	sealed, err := s.sealer.Seal(secret)
	if err != nil {
		return MFASetup{}, err
	}
	if err := s.q.SetUserTOTPSecret(ctx, db.SetUserTOTPSecretParams{ID: userID, TotpSecret: pgtype.Text{String: sealed, Valid: true}}); err != nil {
		return MFASetup{}, err
	}
	return MFASetup{Secret: secret, OTPAuthURL: auth.OTPAuthURL(totpIssuer, u.Email, secret)}, nil
}

// ConfirmTOTP proves the app was enrolled and turns MFA on. The recovery
// codes are returned exactly once; only their hashes are kept.
func (s *AuthService) ConfirmTOTP(ctx context.Context, userID, code string) ([]string, error) {
	u, err := s.Me(ctx, userID)
	if err != nil {
		return nil, err
	}
	if u.MfaEnabledAt.Valid {
		return nil, ErrConflict
	}
	if !u.TotpSecret.Valid || !s.totpMatches(u, code) {
		return nil, ErrInvalidCode
	}
	codes, err := auth.NewRecoveryCodes()
	if err != nil {
		return nil, err
	}
	hashes := make([]string, len(codes))
	for i, c := range codes {
		hashes[i] = auth.HashRecoveryCode(c)
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.q.WithTx(tx)
	if _, err := qtx.EnableUserMFA(ctx, db.EnableUserMFAParams{ID: userID, MfaRecoveryCodes: hashes}); err != nil {
		return nil, err
	}
	if err := auditRecorder.Record(ctx, qtx, audit.Entry{
		OrganizationID: audit.NoOrganization, Actor: audit.User(userID),
		Action: audit.ActionAuthMFAEnabled, ResourceType: "user", ResourceID: userID,
	}); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return codes, nil
}

// DisableTOTP turns MFA off after a valid TOTP or recovery code.
func (s *AuthService) DisableTOTP(ctx context.Context, userID, code string) (db.User, error) {
	u, err := s.Me(ctx, userID)
	if err != nil {
		return db.User{}, err
	}
	if !u.MfaEnabledAt.Valid {
		return db.User{}, ErrConflict
	}
	if !s.secondFactorMatches(ctx, u, code) {
		return db.User{}, ErrInvalidCode
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.User{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.q.WithTx(tx)
	u, err = qtx.DisableUserMFA(ctx, userID)
	if err != nil {
		return db.User{}, err
	}
	if err := auditRecorder.Record(ctx, qtx, audit.Entry{
		OrganizationID: audit.NoOrganization, Actor: audit.User(userID),
		Action: audit.ActionAuthMFADisabled, ResourceType: "user", ResourceID: userID,
	}); err != nil {
		return db.User{}, err
	}
	return u, tx.Commit(ctx)
}

// VerifyMFA is the second step of login: the challenge token from the first
// factor plus a TOTP or recovery code buys the session.
func (s *AuthService) VerifyMFA(ctx context.Context, mfaToken, code string) (Session, error) {
	userID, err := s.minter.ParseMFA(mfaToken)
	if err != nil {
		return Session{}, ErrInvalidCredentials
	}
	u, err := s.q.GetUserByID(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrInvalidCredentials
	}
	if err != nil {
		return Session{}, err
	}
	if !u.MfaEnabledAt.Valid {
		// MFA was switched off between the two steps; the first factor alone
		// is what the account now requires.
		return s.mintAudited(ctx, u, map[string]any{"mfa": false})
	}
	if !s.secondFactorMatches(ctx, u, code) {
		s.recordAuth(ctx, audit.ActionAuthLoginFailed, u.ID, map[string]any{"reason": "bad_mfa"})
		return Session{}, ErrInvalidCredentials
	}
	return s.mintAudited(ctx, u, map[string]any{"mfa": true})
}

func (s *AuthService) mintAudited(ctx context.Context, u db.User, meta map[string]any) (Session, error) {
	sess, err := s.mintSession(ctx, u, "", "")
	if err != nil {
		return Session{}, err
	}
	s.recordAuth(ctx, audit.ActionAuthLoginSucceeded, u.ID, meta)
	return sess, nil
}

func (s *AuthService) totpMatches(u db.User, code string) bool {
	secret, err := s.sealer.Open(u.TotpSecret.String)
	return err == nil && auth.ValidTOTP(secret, code, s.now())
}

// secondFactorMatches accepts a live TOTP code or burns one recovery code.
// Six digits can only be TOTP; anything else is tried as a recovery code.
func (s *AuthService) secondFactorMatches(ctx context.Context, u db.User, code string) bool {
	code = strings.TrimSpace(code)
	if len(code) == 6 && u.TotpSecret.Valid {
		return s.totpMatches(u, code)
	}
	n, err := s.q.ConsumeUserRecoveryCode(ctx, db.ConsumeUserRecoveryCodeParams{ID: u.ID, Column2: auth.HashRecoveryCode(code)})
	return err == nil && n == 1
}
