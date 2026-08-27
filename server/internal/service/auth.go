package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"log/slog"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type AuthService struct {
	q            *db.Queries
	minter       auth.TokenMinter
	refreshTTL   time.Duration
	verification *VerificationService
}

func NewAuthService(q *db.Queries, minter auth.TokenMinter, refreshTTL time.Duration, verification *VerificationService) *AuthService {
	return &AuthService{q: q, minter: minter, refreshTTL: refreshTTL, verification: verification}
}

type Session struct {
	User             db.User
	AccessToken      string
	RefreshToken     string
	RefreshExpiresAt time.Time
}

func (s *AuthService) Register(ctx context.Context, email, password, displayName string) (Session, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if !strings.Contains(email, "@") || len(email) < 5 {
		return Session{}, Invalid("email không hợp lệ")
	}
	if len(password) < 8 {
		return Session{}, Invalid("mật khẩu tối thiểu 8 ký tự")
	}
	if strings.TrimSpace(displayName) == "" {
		return Session{}, Invalid("tên hiển thị không được để trống")
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		return Session{}, err
	}
	u, err := s.q.CreateUser(ctx, db.CreateUserParams{
		ID: util.NewID(), Email: email, PasswordHash: pgtype.Text{String: hash, Valid: true}, DisplayName: displayName,
	})
	if isUniqueViolation(err) {
		return Session{}, ErrConflict
	}
	if err != nil {
		return Session{}, err
	}
	// A failed send must not undo the registration: the verify screen has a
	// resend button, and the session below is what lets the user reach it.
	if s.verification != nil {
		if err := s.verification.Send(ctx, u.ID); err != nil {
			slog.Warn("send verification code after register", "user", u.ID, "err", err)
		}
	}
	return s.newSession(ctx, u)
}

func (s *AuthService) Login(ctx context.Context, email, password string) (Session, error) {
	u, err := s.q.GetUserByEmail(ctx, strings.ToLower(strings.TrimSpace(email)))
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrInvalidCredentials
	}
	if err != nil {
		return Session{}, err
	}
	// A Google-only account has no hash; it fails like a wrong password so the
	// response does not reveal how the account was created.
	if !u.PasswordHash.Valid || !auth.CheckPassword(u.PasswordHash.String, password) {
		return Session{}, ErrInvalidCredentials
	}
	return s.newSession(ctx, u)
}

func (s *AuthService) Refresh(ctx context.Context, rawToken string) (Session, error) {
	rt, err := s.q.GetRefreshTokenByHash(ctx, hashToken(rawToken))
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrInvalidCredentials
	}
	if err != nil {
		return Session{}, err
	}
	if err := s.q.RevokeRefreshToken(ctx, rt.TokenHash); err != nil {
		return Session{}, err
	}
	u, err := s.q.GetUserByID(ctx, rt.UserID)
	if err != nil {
		return Session{}, err
	}
	return s.newSession(ctx, u)
}

func (s *AuthService) Logout(ctx context.Context, rawToken string) error {
	return s.q.RevokeRefreshToken(ctx, hashToken(rawToken))
}

func (s *AuthService) Me(ctx context.Context, userID string) (db.User, error) {
	u, err := s.q.GetUserByID(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.User{}, ErrNotFound
	}
	return u, err
}

const maxDisplayNameRunes = 100

// UpdateProfile changes the caller's display name.
func (s *AuthService) UpdateProfile(ctx context.Context, userID, displayName string) (db.User, error) {
	name := strings.TrimSpace(displayName)
	if name == "" {
		return db.User{}, Invalid("tên hiển thị không được để trống")
	}
	if utf8.RuneCountInString(name) > maxDisplayNameRunes {
		return db.User{}, Invalid("tên hiển thị quá dài")
	}
	u, err := s.q.UpdateUserDisplayName(ctx, db.UpdateUserDisplayNameParams{ID: userID, DisplayName: name})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.User{}, ErrNotFound
	}
	return u, err
}

// UpdateAvatar persists the URL storage returned for the user's new avatar.
func (s *AuthService) UpdateAvatar(ctx context.Context, userID, url string) (db.User, error) {
	u, err := s.q.UpdateUserAvatar(ctx, db.UpdateUserAvatarParams{
		ID:        userID,
		AvatarUrl: pgtype.Text{String: url, Valid: url != ""},
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.User{}, ErrNotFound
	}
	return u, err
}

// SessionFor mints a session for an already-authenticated user; the Google
// sign-in uses it after it has resolved the account.
func (s *AuthService) SessionFor(ctx context.Context, u db.User) (Session, error) {
	return s.newSession(ctx, u)
}

func (s *AuthService) newSession(ctx context.Context, u db.User) (Session, error) {
	access, err := s.minter.Mint(u.ID)
	if err != nil {
		return Session{}, err
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return Session{}, err
	}
	refresh := hex.EncodeToString(raw)
	exp := time.Now().Add(s.refreshTTL)
	_, err = s.q.CreateRefreshToken(ctx, db.CreateRefreshTokenParams{
		ID: util.NewID(), UserID: u.ID, TokenHash: hashToken(refresh),
		ExpiresAt: pgtype.Timestamptz{Time: exp, Valid: true},
	})
	if err != nil {
		return Session{}, err
	}
	return Session{User: u, AccessToken: access, RefreshToken: refresh, RefreshExpiresAt: exp}, nil
}

func hashToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
