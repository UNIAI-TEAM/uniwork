package service

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// GoogleClaims is what the handler extracts from a verified Google ID token.
type GoogleClaims = auth.GoogleClaims

// GoogleAuthService turns verified Google identities into sessions. The
// OAuth exchange and token verification happen in the handler layer; this
// service only decides which account the identity maps to.
type GoogleAuthService struct {
	q    *db.Queries
	auth *AuthService
}

func NewGoogleAuthService(q *db.Queries, auth *AuthService) *GoogleAuthService {
	return &GoogleAuthService{q: q, auth: auth}
}

// SignIn resolves the account in this order: an account already linked to
// the Google subject; an account with the same (verified) email, which gets
// linked; a new password-less account. A Google email that Google itself has
// not verified is refused — it is the only thing that makes email linking safe.
func (s *GoogleAuthService) SignIn(ctx context.Context, c GoogleClaims, locale string) (Session, error) {
	email := strings.ToLower(strings.TrimSpace(c.Email))
	if !c.EmailVerified || email == "" || c.Sub == "" {
		return Session{}, ErrEmailUnverified
	}
	if u, err := s.q.GetUserByGoogleID(ctx, pgtype.Text{String: c.Sub, Valid: true}); err == nil {
		return s.auth.SessionFor(ctx, u)
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return Session{}, err
	}
	avatar := pgtype.Text{String: c.Picture, Valid: c.Picture != ""}
	existing, err := s.q.GetUserByEmail(ctx, email)
	switch {
	case err == nil:
		if existing.GoogleID.Valid && existing.GoogleID.String != c.Sub {
			return Session{}, ErrConflict
		}
		u, err := s.q.LinkGoogleAccount(ctx, db.LinkGoogleAccountParams{
			ID: existing.ID, GoogleID: pgtype.Text{String: c.Sub, Valid: true}, AvatarUrl: avatar,
		})
		if err != nil {
			return Session{}, err
		}
		return s.auth.SessionFor(ctx, u)
	case errors.Is(err, pgx.ErrNoRows):
		name := strings.TrimSpace(c.Name)
		if name == "" {
			name = email[:strings.Index(email, "@")]
		}
		u, err := s.q.CreateGoogleUser(ctx, db.CreateGoogleUserParams{
			ID: util.NewID(), Email: email, DisplayName: name, AvatarUrl: avatar,
			GoogleID: pgtype.Text{String: c.Sub, Valid: true},
			Locale:   NormalizeLocale(locale),
		})
		if isUniqueViolation(err) {
			return Session{}, ErrConflict
		}
		if err != nil {
			return Session{}, err
		}
		return s.auth.SessionFor(ctx, u)
	default:
		return Session{}, err
	}
}
