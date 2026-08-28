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

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	passwordResetTTL    = time.Hour
	passwordResetResend = 60 * time.Second
)

// PasswordResetService issues one-time reset links and applies them. Request
// never reveals whether an address exists: unknown, Google-only and
// rate-limited requests all return nil without mail.
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

func (s *PasswordResetService) Request(ctx context.Context, email string) error {
	email = strings.ToLower(strings.TrimSpace(email))
	u, err := s.q.GetUserByEmail(ctx, email)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !u.PasswordHash.Valid) {
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
	// Only the newest token is valid.
	if err := s.q.DeletePasswordResetTokensForUser(ctx, u.ID); err != nil {
		return err
	}
	token := util.NewID() + util.NewID()
	if _, err := s.q.CreatePasswordResetToken(ctx, db.CreatePasswordResetTokenParams{
		ID: util.NewID(), UserID: u.ID, TokenHash: hashToken(token),
		ExpiresAt: pgtype.Timestamptz{Time: s.now().Add(passwordResetTTL), Valid: true},
	}); err != nil {
		return err
	}
	msg, err := s.render.PasswordReset(u.Email, u.Locale, u.ID, mail.PasswordResetData{
		ResetURL: s.render.AppURL + "/reset-password?token=" + token, ExpiresInMinutes: int(passwordResetTTL / time.Minute),
	})
	if err != nil {
		return err
	}
	if _, err := s.out.Enqueue(ctx, s.q, msg); err != nil {
		return err
	}
	s.out.Kick()
	return nil
}

// Reset sets the password, burns the token, revokes every refresh token and
// returns a fresh session so the user lands in the app.
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
	u, err := qtx.UpdateUserPassword(ctx, db.UpdateUserPasswordParams{ID: t.UserID, PasswordHash: pgtype.Text{String: hash, Valid: true}})
	if err != nil {
		return Session{}, err
	}
	if err := qtx.MarkPasswordResetTokenUsed(ctx, t.ID); err != nil {
		return Session{}, err
	}
	if err := qtx.RevokeAllRefreshTokensForUser(ctx, t.UserID); err != nil {
		return Session{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Session{}, err
	}
	return s.auth.SessionFor(ctx, u)
}
