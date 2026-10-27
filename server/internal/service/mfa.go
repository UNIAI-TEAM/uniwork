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
// cannot silently swap the secret. Then a step-up token of the bearer's
// session (requireStepUp): a second factor locks the account to whoever
// holds it, so a stolen session alone must not be able to turn one on.
func (s *AuthService) SetupTOTP(ctx context.Context, userID, stepUpToken string) (MFASetup, error) {
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
	if err := s.requireStepUp(ctx, s.q, userID, stepUpToken); err != nil {
		return MFASetup{}, err
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
// verified-address gate and step-up as SetupTOTP: a secret planted before
// the gates existed is not turned on either.
func (s *AuthService) ConfirmTOTP(ctx context.Context, userID, code, stepUpToken string) ([]string, error) {
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
	if err := s.requireStepUp(ctx, s.q, userID, stepUpToken); err != nil {
		return nil, err
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
	// Under the row lock again: a credential change that committed while
	// this was on its way ended the session that asked, and the factor
	// turned on is the secret the code was checked against.
	locked, err := lockLiveUser(ctx, qtx, userID)
	if err != nil {
		return nil, err
	}
	if err := requireBearerUnderLock(ctx, qtx, locked); err != nil {
		return nil, err
	}
	switch {
	case !locked.EmailVerifiedAt.Valid:
		return nil, ErrEmailUnverified
	case locked.MfaEnabledAt.Valid:
		return nil, ErrConflict
	case locked.TotpSecret != u.TotpSecret:
		return nil, ErrInvalidCode
	}
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

// DisableTOTP turns MFA off after a valid TOTP or recovery code, weighed
// against the second-factor lockout like every other guess at it.
func (s *AuthService) DisableTOTP(ctx context.Context, userID, code string) (db.User, error) {
	u, err := s.Me(ctx, userID)
	if err != nil {
		return db.User{}, err
	}
	if !u.MfaEnabledAt.Valid {
		return db.User{}, ErrConflict
	}
	out, err := s.weighProofOnce(ctx, userID, func(q *db.Queries, locked db.User) (bool, error) {
		return s.secondFactorMatchesQ(ctx, q, locked, code)
	})
	if err != nil {
		return db.User{}, err
	}
	if !out.ok {
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
	step, err := s.secondStep(ctx, tx, q, ch, code)
	if err != nil {
		return Session{}, err
	}
	u := step.user
	sess, newDevice, err := s.openSession(ctx, q, u, "", "")
	if err != nil {
		return Session{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: audit.NoOrganization, Actor: audit.User(u.ID),
		Action: audit.ActionAuthLoginSucceeded, ResourceType: "user", ResourceID: u.ID,
		Metadata: map[string]any{"mfa": true},
	}); err != nil {
		return Session{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Session{}, err
	}
	s.signInMailer().kick(step.link.queued)
	if newDevice {
		s.sendNewLoginMail(ctx, sess.User, sessionMetaFrom(ctx))
	}
	sess.LinkSkipped = step.link.skipped
	return sess, nil
}

// passedSecondStep is what secondStep leaves the caller to open its session
// on: the account (as the pending link left it) and the link.
type passedSecondStep struct {
	user db.User
	link pendingLinkOutcome
}

// challengePredatesCredentials: ch was minted before u's credentials last
// changed. The mark and a token's iat are both whole seconds, and a reset
// link on an account with a second factor answers with a challenge minted in
// its own second, so a challenge of the mark's second passes: it still owes
// the factor, which a reclaim (the change that clears it) leaves nothing of.
func challengePredatesCredentials(ch auth.MFAChallenge, u db.User) bool {
	return u.CredentialsRevokedAt.Valid && ch.IssuedAt.Before(u.CredentialsRevokedAt.Time)
}

// secondStep is what the browser's and the app's second step share (ADR 0047
// §4, spec §3.3), for a challenge ch whose channel the caller has checked, in
// the caller's transaction tx (q): the account is read under its row lock
// (gone or erased: invalid_credentials), the code is weighed against the
// lockout (weighSecondFactor), and the provider identity the first step left
// waiting is linked if it still resolves to this account (finishPendingLink).
// A challenge is what its first factor bought, so it dies with what that
// factor was: one minted before the account's last credential change (a
// reclaim, a password change or reset, an unlink) is invalid_credentials,
// and so is one whose account no longer has a second factor to ask — a
// reclaim cleared it, or the owner turned it off — rather than a session for
// no code at all: the person signs in again with what the account takes
// now. A wrong code is counted, so secondStep commits tx
// itself, kicks the lockout notice, audits the failure and answers the
// refusal (invalid_credentials, or 429 second_factor_locked); on success the
// caller opens its session in tx, audits and commits.
func (s *AuthService) secondStep(ctx context.Context, tx pgx.Tx, q *db.Queries, ch auth.MFAChallenge, code string) (passedSecondStep, error) {
	u, err := q.GetUserForUpdate(ctx, ch.UserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return passedSecondStep{}, ErrInvalidCredentials
	}
	if err != nil {
		return passedSecondStep{}, err
	}
	if u.DeletedAt.Valid {
		// Erased between the two steps: the challenge died with the account.
		return passedSecondStep{}, ErrInvalidCredentials
	}
	if !u.MfaEnabledAt.Valid || challengePredatesCredentials(ch, u) {
		return passedSecondStep{}, ErrInvalidCredentials
	}
	v, err := s.weighSecondFactor(ctx, q, u, code)
	if err != nil {
		return passedSecondStep{}, err
	}
	if !v.ok {
		// The failure is counted (and may have started the lockout), so it
		// commits; the refusal follows.
		if err := tx.Commit(ctx); err != nil {
			return passedSecondStep{}, err
		}
		s.signInMailer().kick(v.queued)
		meta := map[string]any{"reason": "bad_mfa", "locked": v.started}
		if v.locked != nil && !v.started {
			meta = map[string]any{"reason": "second_factor_locked"}
		}
		if ch.Channel == auth.MFAChannelNative {
			meta["channel"] = auth.MFAChannelNative
		}
		s.recordAuth(ctx, audit.ActionAuthLoginFailed, u.ID, meta)
		if v.locked != nil {
			return passedSecondStep{}, v.locked
		}
		return passedSecondStep{}, ErrInvalidCredentials
	}
	out := passedSecondStep{user: u}
	if ch.PendingLink != "" {
		if out.link, err = s.finishPendingLink(ctx, tx, u, ch.PendingLink); err != nil {
			return passedSecondStep{}, err
		}
		out.user = out.link.user
	}
	return out, nil
}

func (s *AuthService) totpMatches(u db.User, code string) bool {
	secret, err := s.sealer.Open(u.TotpSecret.String)
	return err == nil && auth.ValidTOTP(secret, code, s.now())
}

// secondFactorMatchesQ accepts a live TOTP code or burns one recovery code,
// in the caller's transaction (weighSecondFactor, weighProofOnce). Six
// digits can only be TOTP; anything else is tried as a recovery code. A
// failed statement is told apart from a wrong code: inside a transaction it
// aborts it, so the caller must not commit.
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
