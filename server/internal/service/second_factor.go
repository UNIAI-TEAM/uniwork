package service

import (
	"context"
	"errors"
	"math"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/mail"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The second-factor lockout (ADR 0047 §4, spec §3.3): the tenth wrong code
// in a row locks the second factor for fifteen minutes and tells the owner.
// The counter is per account, so no number of addresses or tokens buys more
// guesses; a right code starts it over.
const (
	secondFactorMaxFailures = 10
	secondFactorLockout     = 15 * time.Minute
)

// ErrSecondFactorLocked: too many wrong second factors in a row; the account
// takes none until the lockout ends.
var ErrSecondFactorLocked = errors.New("second_factor_locked")

// errSecondFactorLocked is 429 second_factor_locked with retry_after, the
// whole seconds left (the handler copies it into Retry-After).
func errSecondFactorLocked(until, now time.Time) error {
	retry := int(math.Ceil(until.Sub(now).Seconds()))
	if retry < 1 {
		retry = 1
	}
	return CodedError{
		Code: "second_factor_locked", Status: http.StatusTooManyRequests,
		Msg: "too many wrong codes; try again later", Err: ErrSecondFactorLocked,
		Fields: map[string]any{"retry_after": retry},
	}
}

// secondFactorVerdict is how one attempt at the second factor ended.
type secondFactorVerdict struct {
	// ok: the code matched (a recovery code is spent) and the count is back
	// to zero.
	ok bool
	// locked is the refusal to answer while the factor is locked, including
	// by this very attempt; nil otherwise.
	locked error
	// started: this wrong code was the one that started the lockout (the
	// code was checked); a refusal while already locked checks nothing.
	started bool
	// queued: the lockout this attempt started queued the owner's notice in
	// the caller's transaction; kick the mailer after commit.
	queued bool
}

// weighSecondFactor is the one place a second-factor code is checked
// against the lockout: the web MFA step, a TOTP step-up, and the native MFA
// route later. u must be the row the caller locked in q's transaction
// (GetUserForUpdate), so concurrent guesses queue behind each other instead
// of all reading an open lock. A wrong code is counted, so the caller commits
// whenever it gets no error, refusal or not; an error is a failed statement
// and the transaction is to be rolled back.
func (s *AuthService) weighSecondFactor(ctx context.Context, q *db.Queries, u db.User, code string) (secondFactorVerdict, error) {
	return s.weighProof(ctx, q, u, func() (bool, error) { return s.secondFactorMatchesQ(ctx, q, u, code) })
}

// weighProof is weighSecondFactor for any proof a signed-in person or a
// second step offers (ADR 0047 §4, spec §3.3): a second-factor code, a
// password or a mailed code re-entered for a step-up. One counter per
// account, so no mix of proofs buys more than ten guesses; while it is
// locked nothing is checked (check is not called, a recovery code is not
// spent), and a match starts the count over.
func (s *AuthService) weighProof(ctx context.Context, q *db.Queries, u db.User, check func() (bool, error)) (secondFactorVerdict, error) {
	now := s.now()
	if u.SecondFactorLockedUntil.Valid && u.SecondFactorLockedUntil.Time.After(now) {
		return secondFactorVerdict{locked: errSecondFactorLocked(u.SecondFactorLockedUntil.Time, now)}, nil
	}
	matched, err := check()
	if err != nil {
		return secondFactorVerdict{}, err
	}
	if matched {
		return secondFactorVerdict{ok: true}, q.ResetSecondFactorFailures(ctx, u.ID)
	}
	// The database keeps microseconds: the lockout read back equals the one
	// passed only once both are at that precision.
	until := now.Add(secondFactorLockout).Truncate(time.Microsecond)
	row, err := q.RecordSecondFactorFailure(ctx, db.RecordSecondFactorFailureParams{
		ID: u.ID, MaxFailures: secondFactorMaxFailures, LockedUntil: pgtype.Timestamptz{Time: until, Valid: true},
	})
	if err != nil {
		return secondFactorVerdict{}, err
	}
	if !row.SecondFactorLockedUntil.Valid || !row.SecondFactorLockedUntil.Time.Equal(until) {
		return secondFactorVerdict{}, nil
	}
	queued, err := s.signInMailer().queue(ctx, q, u, mail.SignInMethodChangedData{
		Change: mail.SignInChangeSecondFactorLocked, LockedFor: secondFactorLockout,
		Device: mail.SafeField(sessionMetaFrom(ctx).UserAgent),
	})
	if err != nil {
		return secondFactorVerdict{}, err
	}
	return secondFactorVerdict{locked: errSecondFactorLocked(until, now), started: true, queued: queued}, nil
}

// proofOutcome is how weighProofOnce ended for a caller that keeps no
// transaction open around the proof.
type proofOutcome struct {
	// user is the account as it was locked for the proof.
	user db.User
	ok   bool
}

// weighProofOnce runs one proof against the lockout in a transaction of its
// own, for a command that checks the proof before its own transaction (no
// row lock held across bcrypt or the command's work): it locks userID's row,
// lets check (in that transaction) decide, and commits what weighProof
// counted either way, then kicks the lockout notice. A deleted account is
// ErrNotFound; a locked factor is its 429, returned as the error.
func (s *AuthService) weighProofOnce(ctx context.Context, userID string, check func(q *db.Queries, u db.User) (bool, error)) (proofOutcome, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return proofOutcome{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.q.WithTx(tx)
	u, err := q.GetUserForUpdate(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && u.DeletedAt.Valid) {
		return proofOutcome{}, ErrNotFound
	}
	if err != nil {
		return proofOutcome{}, err
	}
	v, err := s.weighProof(ctx, q, u, func() (bool, error) { return check(q, u) })
	if err != nil {
		return proofOutcome{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return proofOutcome{}, err
	}
	s.signInMailer().kick(v.queued)
	if v.locked != nil {
		return proofOutcome{}, v.locked
	}
	return proofOutcome{user: u, ok: v.ok}, nil
}
