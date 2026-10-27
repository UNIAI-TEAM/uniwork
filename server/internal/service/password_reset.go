package service

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	passwordResetTTL      = time.Hour
	passwordResetResend   = 60 * time.Second
	passwordResetDailyCap = 5
)

// PasswordResetService issues one-time reset links and applies them. Request
// never reveals whether an address exists: unknown and rate-limited requests
// return nil without mail, like the ones that mail.
type PasswordResetService struct {
	pool   *pgxpool.Pool
	q      *db.Queries
	auth   *AuthService
	render mail.Renderer
	out    mail.Enqueuer
	now    func() time.Time
}

func NewPasswordResetService(pool *pgxpool.Pool, q *db.Queries, a *AuthService, r mail.Renderer, out mail.Enqueuer) *PasswordResetService {
	return &PasswordResetService{pool: pool, q: q, auth: a, render: r, out: out, now: time.Now}
}

// Request mails a one-time link to the account at email. An account without
// a password (it signs in with Google or Apple, ADR 0047 spec §3.7) gets the
// set-a-password variant: its provider sign-ins as buttons, and the same
// link to set a first password, which Reset audits as auth.password_set.
func (s *PasswordResetService) Request(ctx context.Context, email string) error {
	email = strings.ToLower(strings.TrimSpace(email))
	u, err := s.q.GetUserByEmail(ctx, email)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	latest, err := s.q.GetLatestPasswordResetTokenForUser(ctx, u.ID)
	if err == nil && s.now().Sub(latest.CreatedAt.Time) < passwordResetResend {
		slog.Info("password reset rate-limited", "user", u.ID)
		return nil
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	n, err := s.q.CountPasswordResetTokensForUserSince(ctx, db.CountPasswordResetTokensForUserSinceParams{
		UserID: u.ID, CreatedAt: pgtype.Timestamptz{Time: s.now().Add(-24 * time.Hour), Valid: true},
	})
	if err != nil {
		return err
	}
	if n >= passwordResetDailyCap {
		slog.Info("password reset daily cap", "user", u.ID)
		return nil
	}
	token := util.NewID() + util.NewID()
	data := mail.PasswordResetData{
		ResetURL: s.render.AppURL + "/reset-password?token=" + token, Expires: passwordResetTTL,
		SetPassword: !u.PasswordHash.Valid,
	}
	if data.SetPassword {
		if u.GoogleID.Valid {
			data.SignInWith = append(data.SignInWith, mail.SignInMethodGoogle)
		}
		if u.AppleID.Valid {
			data.SignInWith = append(data.SignInWith, mail.SignInMethodApple)
		}
	}
	msg, err := s.render.PasswordReset(u.Email, u.Locale, u.ID, data)
	if err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	qtx := s.q.WithTx(tx)
	// Only the newest unused token is valid; older ones are invalidated, not
	// deleted, so they still count toward the daily cap.
	if err := qtx.ExpirePasswordResetTokensForUser(ctx, u.ID); err != nil {
		return err
	}
	if _, err := qtx.CreatePasswordResetToken(ctx, db.CreatePasswordResetTokenParams{
		ID: util.NewID(), UserID: u.ID, TokenHash: hashToken(token),
		ExpiresAt: pgtype.Timestamptz{Time: s.now().Add(passwordResetTTL), Valid: true},
		CreatedAt: pgtype.Timestamptz{Time: s.now(), Valid: true},
	}); err != nil {
		return err
	}
	if _, err := s.out.Enqueue(ctx, qtx, msg); err != nil {
		return err
	}
	if err := auditRecorder.Record(ctx, qtx, audit.Entry{
		OrganizationID: audit.NoOrganization,
		Actor:          audit.User(u.ID),
		Action:         audit.ActionAuthPasswordResetRequested,
		ResourceType:   "user", ResourceID: u.ID,
	}); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	s.out.Kick()
	return nil
}

// Reset sets the password, burns the token, revokes every refresh token and
// every MCP grant (Ruling 49: an AI app connected by whoever held the old
// password must not outlive it) and returns a fresh session so the user lands
// in the app. On an account that had no password the link sets its first
// one: auth.password_set instead of auth.password_changed, both via
// reset_token.
//
// On an account that never proved its address the link is the first proof
// of the mailbox, so the reset takes the account back (ADR 0047 §2, spec
// §3.1): reclaimMailbox clears what whoever registered it left — their
// second factor and recovery codes, every provider link, every session —
// and verifies the address, the new password is set, the owner is mailed,
// and the session comes without a second factor (Session.Reclaimed).
func (s *PasswordResetService) Reset(ctx context.Context, token, password string) (Session, error) {
	if err := validatePassword(password); err != nil {
		return Session{}, err
	}
	t, err := s.q.GetActivePasswordResetTokenByHash(ctx, hashToken(strings.TrimSpace(token)))
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrInvalidToken
	}
	if err != nil {
		return Session{}, err
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		return Session{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Session{}, err
	}
	defer tx.Rollback(ctx)
	qtx := s.q.WithTx(tx)
	// The row lock settles verified or not for the whole command.
	locked, err := qtx.GetUserForUpdate(ctx, t.UserID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && locked.DeletedAt.Valid) {
		// The account was deleted after the link went out.
		return Session{}, ErrInvalidToken
	}
	if err != nil {
		return Session{}, err
	}
	rows, err := qtx.MarkPasswordResetTokenUsed(ctx, t.ID)
	if err != nil {
		return Session{}, err
	}
	if rows == 0 {
		return Session{}, ErrInvalidToken
	}
	action := passwordAuditAction(locked)
	if !locked.EmailVerifiedAt.Valid {
		return s.resetReclaim(ctx, tx, qtx, t.UserID, hash, action)
	}
	u, err := qtx.SetUserPassword(ctx, db.SetUserPasswordParams{ID: t.UserID, PasswordHash: pgtype.Text{String: hash, Valid: true}})
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrInvalidToken
	}
	if err != nil {
		return Session{}, err
	}
	leases, err := revokeAllUserSessions(ctx, qtx, t.UserID)
	if err != nil {
		return Session{}, err
	}
	mcpGrants, err := revokeAllMcpGrantsForUser(ctx, qtx, t.UserID)
	if err != nil {
		return Session{}, err
	}
	// One command, two audited facts: the password changed and every existing
	// session died with it, MCP grants included (counted on the revocation
	// row, not one mcp_grant.revoked row each). A reader of the log should not
	// have to know that the second follows from the first.
	if err := auditRecorder.Record(ctx, qtx, audit.Entry{
		OrganizationID: audit.NoOrganization,
		Actor:          audit.User(t.UserID),
		Action:         action,
		ResourceType:   "user", ResourceID: t.UserID,
		Metadata: map[string]any{"via": "reset_token"},
	}); err != nil {
		return Session{}, err
	}
	if err := auditRecorder.Record(ctx, qtx, audit.Entry{
		OrganizationID: audit.NoOrganization,
		Actor:          audit.User(t.UserID),
		Action:         audit.ActionAuthSessionRevoked,
		ResourceType:   "user", ResourceID: t.UserID,
		Metadata: map[string]any{"scope": "all", "reason": "password_reset", "mcp_grants_revoked": mcpGrants},
	}, sessionRevoked(t.UserID, "")); err != nil {
		return Session{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Session{}, err
	}
	observeOfficeLeaseRevokes(OfficeLeaseRevokeSessionRevoked, leases)
	return s.auth.SessionFor(ctx, u)
}

// resetReclaim is Reset on an account that never proved its address, in
// Reset's transaction with the token already burnt: reclaimMailbox (which
// also expires every other reset link), the new password, the audit row
// (action, via reset_token, reclaimed) and the owner's notice, then a
// session without a second factor: reclaimMailbox cleared the one whoever
// registered set up.
func (s *PasswordResetService) resetReclaim(ctx context.Context, tx pgx.Tx, qtx *db.Queries, userID, hash, action string) (Session, error) {
	back, err := reclaimMailbox(ctx, qtx, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrInvalidToken
	}
	if err != nil {
		return Session{}, err
	}
	u, err := qtx.SetUserPassword(ctx, db.SetUserPasswordParams{ID: userID, PasswordHash: pgtype.Text{String: hash, Valid: true}})
	if err != nil {
		return Session{}, err
	}
	if err := auditRecorder.Record(ctx, qtx, audit.Entry{
		OrganizationID: audit.NoOrganization,
		Actor:          audit.User(userID),
		Action:         action,
		ResourceType:   "user", ResourceID: userID,
		Metadata: map[string]any{"via": "reset_token", "reclaimed": true},
	}); err != nil {
		return Session{}, err
	}
	m := signInMailer{render: s.render, out: s.out, now: s.now}
	queued, err := m.queue(ctx, qtx, u, mail.SignInMethodChangedData{
		Change: mail.SignInChangeReclaimed, Method: mail.SignInMethodPassword,
		Device: mail.SafeField(sessionMetaFrom(ctx).UserAgent),
	})
	if err != nil {
		return Session{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Session{}, err
	}
	m.kick(queued)
	observeOfficeLeaseRevokes(OfficeLeaseRevokeSessionRevoked, back.leases)
	s.auth.apple.revokeAfterCommit(ctx, userID, back.appleClientID, back.appleToken)
	sess, err := s.auth.mintAudited(ctx, u, map[string]any{"via": "reset_token", "reclaimed": true})
	if err != nil {
		return Session{}, err
	}
	sess.Reclaimed = true
	return sess, nil
}

// passwordAuditAction is the audit action of a password write on u as it was
// before: its first password is set, any later one changed.
func passwordAuditAction(u db.User) string {
	if u.PasswordHash.Valid {
		return audit.ActionAuthPasswordChanged
	}
	return audit.ActionAuthPasswordSet
}
