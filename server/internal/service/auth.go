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
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type AuthService struct {
	pool         *pgxpool.Pool
	q            *db.Queries
	minter       auth.TokenMinter
	refreshTTL   time.Duration
	verification *VerificationService
}

func NewAuthService(pool *pgxpool.Pool, q *db.Queries, minter auth.TokenMinter, refreshTTL time.Duration, verification *VerificationService) *AuthService {
	return &AuthService{pool: pool, q: q, minter: minter, refreshTTL: refreshTTL, verification: verification}
}

// recordAuth writes a credential event. These rows carry audit.NoOrganization:
// signing in happens before any organization context exists, and a user may
// belong to none or several (OPEN_QUESTIONS A1). They emit no outbox event —
// nothing in the product reacts to a login, and a topic with no consumer is
// noise on a shared queue.
//
// A failure to write the audit row must not fail the request it describes: the
// person still logged in, and a log that can refuse a login is a worse
// availability risk than a gap in the log. It is logged instead.
func (s *AuthService) recordAuth(ctx context.Context, action, userID string, meta map[string]any) {
	if err := auditRecorder.Record(ctx, s.q, audit.Entry{
		OrganizationID: audit.NoOrganization,
		Actor:          audit.User(userID),
		Action:         action,
		ResourceType:   "user", ResourceID: userID,
		Metadata: meta,
	}); err != nil {
		slog.Warn("audit: credential event not recorded", "action", action, "err", err)
	}
}

type Session struct {
	User             db.User
	AccessToken      string
	RefreshToken     string
	RefreshExpiresAt time.Time
}

// NormalizeLocale maps any tag to a mail locale we have templates for.
func NormalizeLocale(s string) string {
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(s)), "en") {
		return "en"
	}
	return "vi"
}

// validatePassword is the one password-strength rule, shared by
// registration and password reset.
func validatePassword(p string) error {
	if len(p) < 8 {
		return Invalid("mật khẩu tối thiểu 8 ký tự")
	}
	return nil
}

func (s *AuthService) Register(ctx context.Context, email, password, displayName, locale string) (Session, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if !strings.Contains(email, "@") || len(email) < 5 {
		return Session{}, Invalid("email không hợp lệ")
	}
	if err := validatePassword(password); err != nil {
		return Session{}, err
	}
	if strings.TrimSpace(displayName) == "" {
		return Session{}, Invalid("tên hiển thị không được để trống")
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		return Session{}, err
	}
	userID := util.NewID()
	u, err := s.q.CreateUser(ctx, db.CreateUserParams{
		ID: userID, Email: email, PasswordHash: pgtype.Text{String: hash, Valid: true}, DisplayName: displayName,
		Locale: NormalizeLocale(locale),
	})
	if isUniqueViolation(err) {
		return Session{}, ErrConflict
	}
	if err != nil {
		return Session{}, err
	}
	if s.verification != nil {
		if err := s.verification.Send(ctx, u.ID); err != nil {
			slog.Warn("send verification code after register", "user", u.ID, "err", err)
		}
	}
	return s.mintSession(ctx, u)
}

func (s *AuthService) Login(ctx context.Context, email, password string) (Session, error) {
	u, err := s.q.GetUserByEmail(ctx, strings.ToLower(strings.TrimSpace(email)))
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrInvalidCredentials
	}
	if err != nil {
		return Session{}, err
	}
	if !u.PasswordHash.Valid || !auth.CheckPassword(u.PasswordHash.String, password) {
		s.recordAuth(ctx, audit.ActionAuthLoginFailed, u.ID, map[string]any{"reason": "bad_password"})
		return Session{}, ErrInvalidCredentials
	}
	sess, err := s.mintSession(ctx, u)
	if err != nil {
		return Session{}, err
	}
	s.recordAuth(ctx, audit.ActionAuthLoginSucceeded, u.ID, nil)
	return sess, nil
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
	return s.mintSession(ctx, u)
}

func (s *AuthService) Logout(ctx context.Context, rawToken string) error {
	hash := hashToken(rawToken)
	// Read the owner before revoking so the audit row names a user rather than
	// a token hash nobody can resolve afterwards.
	rt, err := s.q.GetRefreshTokenByHash(ctx, hash)
	if err := s.q.RevokeRefreshToken(ctx, hash); err != nil {
		return err
	}
	if err == nil {
		s.recordAuth(ctx, audit.ActionAuthSessionRevoked, rt.UserID, nil)
	}
	return nil
}

func (s *AuthService) Me(ctx context.Context, userID string) (db.User, error) {
	u, err := s.q.GetUserByID(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.User{}, ErrNotFound
	}
	return u, err
}

const maxDisplayNameRunes = 100

func (s *AuthService) UpdateProfile(ctx context.Context, userID string, displayName, locale, timezone *string) (db.User, error) {
	if displayName == nil && locale == nil && timezone == nil {
		return db.User{}, Invalid("cần display_name, locale hoặc timezone")
	}
	var name string
	if displayName != nil {
		name = strings.TrimSpace(*displayName)
		if name == "" {
			return db.User{}, Invalid("tên hiển thị không được để trống")
		}
		if utf8.RuneCountInString(name) > maxDisplayNameRunes {
			return db.User{}, Invalid("tên hiển thị quá dài")
		}
	}
	if locale != nil && *locale != "vi" && *locale != "en" {
		return db.User{}, Invalid("locale phải là vi hoặc en")
	}
	if timezone != nil {
		if _, err := time.LoadLocation(*timezone); err != nil || *timezone == "" || *timezone == "Local" {
			return db.User{}, Invalid("timezone phải là tên IANA, ví dụ Asia/Ho_Chi_Minh")
		}
	}
	u, err := s.q.UpdateUserProfile(ctx, db.UpdateUserProfileParams{
		ID:          userID,
		DisplayName: pgtype.Text{String: name, Valid: displayName != nil},
		Locale:      pgtype.Text{String: ptrString(locale), Valid: locale != nil},
		Timezone:    pgtype.Text{String: ptrString(timezone), Valid: timezone != nil},
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.User{}, ErrNotFound
	}
	return u, err
}

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

func (s *AuthService) SessionFor(ctx context.Context, u db.User) (Session, error) {
	return s.mintSession(ctx, u)
}

func (s *AuthService) mintSession(ctx context.Context, u db.User) (Session, error) {
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

func ptrString(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
