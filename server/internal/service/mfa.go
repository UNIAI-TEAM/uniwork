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

// SetupTOTP starts (or restarts) enrolment. ErrEmailUnverified until the
// account proved its address: a second factor set up by whoever registered
// someone else's address must not exist to survive the owner's reclaim (ADR
// 0047). ErrConflict while MFA is on: disable first, so a stolen session
// cannot silently swap the secret.
func (s *AuthService) SetupTOTP(ctx context.Context, userID string) (MFASetup, error) {
	u, err := s.Me(ctx, userID)
	if err != nil {
		return MFASetup{}, err
	}
	if !u.EmailVerifiedAt.Valid {
		return MFASetup{}, ErrEmailUnverified
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
// codes are returned exactly once; only their hashes are kept. The same
// verified-address gate as SetupTOTP: a secret planted before the gate
// existed is not turned on either.
func (s *AuthService) ConfirmTOTP(ctx context.Context, userID, code string) ([]string, error) {
	u, err := s.Me(ctx, userID)
	if err != nil {
		return nil, err
	}
	if !u.EmailVerifiedAt.Valid {
		return nil, ErrEmailUnverified
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

// VerifyMFA is the browser's second step of login: the challenge token
// from the first factor plus a TOTP or recovery code buys the session. Only
// a web challenge is taken; one minted for an app is refused like a wrong
// code (ADR 0047 §4). Under the account's row lock the attempt is weighed
// against the lockout (weighSecondFactor), and a provider identity the first
// step left waiting (the token's pending link) is linked in the transaction
// that opens the session, if it still resolves to this account; else the
// sign-in still succeeds and Session.LinkSkipped says why.
func (s *AuthService) VerifyMFA(ctx context.Context, mfaToken, code string) (Session, error) {
	ch, err := s.minter.ParseMFA(mfaToken)
	if err != nil || ch.Channel != auth.MFAChannelWeb {
		return Session{}, ErrInvalidCredentials
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Session{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.q.WithTx(tx)
	u, err := q.GetUserForUpdate(ctx, ch.UserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrInvalidCredentials
	}
	if err != nil {
		return Session{}, err
	}
	if u.DeletedAt.Valid {
		// Erased between the two steps: the challenge died with the account.
		return Session{}, ErrInvalidCredentials
	}
	// MFA switched off between the two steps: the first factor alone is what
	// the account now requires.
	mfa := u.MfaEnabledAt.Valid
	if mfa {
		v, err := s.weighSecondFactor(ctx, q, u, code)
		if err != nil {
			return Session{}, err
		}
		if !v.ok {
			// The failure is counted (and may have started the lockout), so it
			// commits; the refusal follows.
			if err := tx.Commit(ctx); err != nil {
				return Session{}, err
			}
			s.signInMailer().kick(v.queued)
			meta := map[string]any{"reason": "bad_mfa", "locked": v.started}
			if v.locked != nil && !v.started {
				meta = map[string]any{"reason": "second_factor_locked"}
			}
			s.recordAuth(ctx, audit.ActionAuthLoginFailed, u.ID, meta)
			if v.locked != nil {
				return Session{}, v.locked
			}
			return Session{}, ErrInvalidCredentials
		}
	}
	var link pendingLinkOutcome
	if ch.PendingLink != "" {
		if link, err = s.finishPendingLink(ctx, tx, u, ch.PendingLink); err != nil {
			return Session{}, err
		}
		u = link.user
	}
	sess, newDevice, err := s.openSession(ctx, q, u, "", "")
	if err != nil {
		return Session{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: audit.NoOrganization, Actor: audit.User(u.ID),
		Action: audit.ActionAuthLoginSucceeded, ResourceType: "user", ResourceID: u.ID,
		Metadata: map[string]any{"mfa": mfa},
	}); err != nil {
		return Session{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Session{}, err
	}
	s.signInMailer().kick(link.queued)
	if newDevice {
		s.sendNewLoginMail(ctx, sess.User, sessionMetaFrom(ctx))
	}
	sess.LinkSkipped = link.skipped
	return sess, nil
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
	ok, err := s.secondFactorMatchesQ(ctx, s.q, u, code)
	return err == nil && ok
}

// secondFactorMatchesQ is secondFactorMatches in the caller's transaction,
// with the failed statement told apart from a wrong code: inside a
// transaction a failed statement aborts it, so the caller must not commit.
func (s *AuthService) secondFactorMatchesQ(ctx context.Context, q *db.Queries, u db.User, code string) (bool, error) {
	code = strings.TrimSpace(code)
	if len(code) == 6 && u.TotpSecret.Valid {
		return s.totpMatches(u, code), nil
	}
	n, err := q.ConsumeUserRecoveryCode(ctx, db.ConsumeUserRecoveryCodeParams{ID: u.ID, Column2: auth.HashRecoveryCode(code)})
	if err != nil {
		return false, err
	}
	return n == 1, nil
}
