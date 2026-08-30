package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
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
	matrix       MatrixClient
	matrixBase   string
}

func NewAuthService(q *db.Queries, minter auth.TokenMinter, refreshTTL time.Duration, verification *VerificationService, matrix MatrixClient, matrixHomeserverURL string) *AuthService {
	return &AuthService{q: q, minter: minter, refreshTTL: refreshTTL, verification: verification, matrix: matrix, matrixBase: matrixHomeserverURL}
}

type Session struct {
	User             db.User
	AccessToken      string
	RefreshToken     string
	RefreshExpiresAt time.Time
	Matrix           *MatrixCredentials
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
	matrixUsername := strings.ToLower(userID)
	if s.matrix == nil {
		slog.Info("register: matrix skipped",
			"user", userID, "email", email, "reason", "MATRIX_HOMESERVER_URL unset")
	} else {
		// Matrix localpart: lowercase ULID matches UniWork user id and stays unique.
		slog.Info("register: provisioning matrix user",
			"user", userID, "email", email, "matrix_username", matrixUsername)
		reg, err := s.matrix.RegisterUser(ctx, matrixUsername, password)
		if err != nil {
			slog.Warn("register: matrix provisioning failed",
				"user", userID, "email", email, "matrix_username", matrixUsername, "err", err)
			return Session{}, fmt.Errorf("matrix registration: %w", err)
		}
		slog.Info("register: matrix provisioning ok",
			"user", userID, "email", email, "matrix_username", matrixUsername, "matrix_user_id", reg.UserID)
		u, err := s.q.CreateUser(ctx, db.CreateUserParams{
			ID: userID, Email: email, PasswordHash: pgtype.Text{String: hash, Valid: true}, DisplayName: displayName,
		})
		if isUniqueViolation(err) {
			return Session{}, ErrConflict
		}
		if err != nil {
			return Session{}, err
		}
		u, err = s.q.SetUserMatrixUserID(ctx, db.SetUserMatrixUserIDParams{
			ID: u.ID, MatrixUserID: pgtype.Text{String: reg.UserID, Valid: true},
		})
		if err != nil {
			return Session{}, err
		}
		if s.verification != nil {
			if err := s.verification.Send(ctx, u.ID); err != nil {
				slog.Warn("send verification code after register", "user", u.ID, "err", err)
			}
		}
		sess, err := s.mintSession(ctx, u)
		if err != nil {
			return Session{}, err
		}
		// Synapse returns credentials on register; a immediate login can race and fail.
		if reg.AccessToken != "" {
			sess.Matrix = &MatrixCredentials{
				UserID: reg.UserID, AccessToken: reg.AccessToken, DeviceID: reg.DeviceID,
				HomeServer: reg.HomeServer, BaseURL: s.matrixBase,
			}
		}
		return sess, nil
	}
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
	// A failed send must not undo the registration: the verify screen has a
	// resend button, and the session below is what lets the user reach it.
	if s.verification != nil {
		if err := s.verification.Send(ctx, u.ID); err != nil {
			slog.Warn("send verification code after register", "user", u.ID, "err", err)
		}
	}
	return s.newSessionWithPassword(ctx, u, password)
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
	if s.matrix != nil && (!u.MatrixUserId.Valid || u.MatrixUserId.String == "") {
		if updated, err := provisionMatrixUser(ctx, s.matrix, s.q, u, password); err != nil {
			slog.Warn("matrix lazy provision on login failed", "user", u.ID, "err", err)
		} else {
			u = updated
		}
	}
	return s.newSessionWithPassword(ctx, u, password)
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

// UpdateProfile changes display name and/or mail locale; nil leaves a field
// alone. Both inputs are validated before either write, so a bad locale
// never lets a display-name change slip through.
func (s *AuthService) UpdateProfile(ctx context.Context, userID string, displayName, locale *string) (db.User, error) {
	if displayName == nil && locale == nil {
		return db.User{}, Invalid("cần display_name hoặc locale")
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
	u, err := s.q.UpdateUserProfile(ctx, db.UpdateUserProfileParams{
		ID:          userID,
		DisplayName: pgtype.Text{String: name, Valid: displayName != nil},
		Locale:      pgtype.Text{String: ptrString(locale), Valid: locale != nil},
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.User{}, ErrNotFound
	}
	return u, err
}

func ptrString(p *string) string {
	if p == nil {
		return ""
	}
	return *p
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
	return s.newSessionWithPassword(ctx, u, "")
}

func (s *AuthService) newSessionWithPassword(ctx context.Context, u db.User, password string) (Session, error) {
	sess, err := s.mintSession(ctx, u)
	if err != nil {
		return Session{}, err
	}
	if s.matrix != nil && password != "" {
		if creds, err := matrixCredentialsForUser(ctx, s.matrix, s.matrixBase, u, password); err != nil {
			slog.Warn("matrix login after auth", "user", u.ID, "err", err)
		} else {
			sess.Matrix = &creds
		}
	}
	return sess, nil
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

func matrixCredentialsForUser(ctx context.Context, matrix MatrixClient, baseURL string, u db.User, password string) (MatrixCredentials, error) {
	if matrix == nil {
		return MatrixCredentials{}, ErrNotFound
	}
	username := matrixLocalpart(u)
	got, err := matrix.Login(ctx, username, password)
	if err != nil {
		return MatrixCredentials{}, err
	}
	return MatrixCredentials{
		UserID: got.UserID, AccessToken: got.AccessToken, DeviceID: got.DeviceID,
		HomeServer: got.HomeServer, BaseURL: baseURL,
	}, nil
}

func matrixLocalpart(u db.User) string {
	if u.MatrixUserId.Valid && u.MatrixUserId.String != "" {
		id := u.MatrixUserId.String
		if strings.HasPrefix(id, "@") {
			if i := strings.Index(id, ":"); i > 1 {
				return id[1:i]
			}
		}
		return id
	}
	return strings.ToLower(u.ID)
}

func provisionMatrixUser(ctx context.Context, matrix MatrixClient, q *db.Queries, u db.User, password string) (db.User, error) {
	username := strings.ToLower(u.ID)
	reg, err := matrix.RegisterUser(ctx, username, password)
	if err != nil {
		return db.User{}, err
	}
	return q.SetUserMatrixUserID(ctx, db.SetUserMatrixUserIDParams{
		ID: u.ID, MatrixUserID: pgtype.Text{String: reg.UserID, Valid: true},
	})
}
