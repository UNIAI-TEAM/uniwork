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
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type AuthService struct {
	pool         *pgxpool.Pool
	q            *db.Queries
	minter       auth.TokenMinter
	refreshTTL   time.Duration
	verification *VerificationService
	// sealer keeps TOTP secrets unreadable at rest; keyed from the JWT
	// secret so no second secret has to be configured (spec F-01 §2 I2).
	sealer auth.SecretSealer
	// render/out are nil-safe: without SetMail no new-login mail goes out.
	render mail.Renderer
	out    mail.Enqueuer
	now    func() time.Time
}

func NewAuthService(pool *pgxpool.Pool, q *db.Queries, minter auth.TokenMinter, refreshTTL time.Duration, verification *VerificationService) *AuthService {
	sealer, _ := auth.NewSecretSealer(minter.Secret) // empty secret: MFA setup answers an error, nothing else changes
	return &AuthService{pool: pool, q: q, minter: minter, refreshTTL: refreshTTL, verification: verification, sealer: sealer, now: time.Now}
}

// SetMail enables the new-device login alert (spec F-01 §2 I8).
func (s *AuthService) SetMail(r mail.Renderer, out mail.Enqueuer) {
	s.render, s.out = r, out
}

// SessionMeta is what a session remembers about the client that opened it.
// The handler puts it on the context; every path that mints a session
// (password, Google, reset, MFA verify, refresh) reads it from there, so no
// service signature has to carry it.
type SessionMeta struct {
	UserAgent string
	IP        string
}

type sessionMetaKey struct{}

func WithSessionMeta(ctx context.Context, m SessionMeta) context.Context {
	return context.WithValue(ctx, sessionMetaKey{}, m)
}

func sessionMetaFrom(ctx context.Context) SessionMeta {
	m, _ := ctx.Value(sessionMetaKey{}).(SessionMeta)
	if len(m.UserAgent) > 512 {
		m.UserAgent = m.UserAgent[:512]
	}
	return m
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
	SessionID        string
	// MFAToken is set instead of the tokens above when the account has MFA
	// on: the first factor passed, the second is still owed (spec F-01 §2 I4).
	MFAToken string
}

// MFAPending reports whether the caller must still answer the TOTP challenge.
func (s Session) MFAPending() bool { return s.MFAToken != "" }

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
	return s.mintSession(ctx, u, "", "")
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
	return s.sessionOrChallenge(ctx, u, nil)
}

// sessionOrChallenge is the one door every first factor walks through: MFA
// on means a challenge token, otherwise a session plus the login audit row.
func (s *AuthService) sessionOrChallenge(ctx context.Context, u db.User, meta map[string]any) (Session, error) {
	if u.MfaEnabledAt.Valid {
		tok, err := s.minter.MintMFA(u.ID)
		if err != nil {
			return Session{}, err
		}
		return Session{User: u, MFAToken: tok}, nil
	}
	sess, err := s.mintSession(ctx, u, "", "")
	if err != nil {
		return Session{}, err
	}
	s.recordAuth(ctx, audit.ActionAuthLoginSucceeded, u.ID, meta)
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
	// Rotation stays inside the session: same id, same browser string; the
	// address is whatever the client is on now.
	return s.mintSession(ctx, u, rt.SessionID, rt.UserAgent)
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
		if _, err := s.q.RevokeSessionForUser(ctx, db.RevokeSessionForUserParams{UserID: rt.UserID, SessionID: rt.SessionID}); err != nil {
			return err
		}
		s.recordAuth(ctx, audit.ActionAuthSessionRevoked, rt.UserID, map[string]any{"scope": "one", "reason": "logout"})
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
	if err != nil {
		return db.User{}, err
	}
	// The directory searches over a folded copy of the display name, so a
	// rename has to reach every organization this person belongs to or they
	// stay findable only under the old name (F-03 §3.3).
	if displayName != nil {
		if err := refreshSearchText(ctx, s.q, RefreshSearchTextInput{UserID: userID}); err != nil {
			return db.User{}, err
		}
	}
	return u, nil
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

// SessionFor is the entry for the other first factors (Google, password
// reset): they carry their own audit row and get the same MFA gate.
func (s *AuthService) SessionFor(ctx context.Context, u db.User) (Session, error) {
	return s.sessionOrChallenge(ctx, u, map[string]any{"via": "provider"})
}

// mintSession opens a session (sessionID "") or rotates one. A new session
// from a browser string this account has never used gets the alert mail;
// the very first session of an account (registration) does not.
func (s *AuthService) mintSession(ctx context.Context, u db.User, sessionID, inheritedUA string) (Session, error) {
	meta := sessionMetaFrom(ctx)
	if sessionID != "" {
		meta.UserAgent = inheritedUA
	}
	newDevice := false
	if sessionID == "" {
		sessionID = util.NewID()
		newDevice = s.isNewDevice(ctx, u.ID, meta.UserAgent)
	}
	access, err := s.minter.MintSession(u.ID, sessionID)
	if err != nil {
		return Session{}, err
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return Session{}, err
	}
	refresh := hex.EncodeToString(raw)
	exp := s.now().Add(s.refreshTTL)
	_, err = s.q.CreateRefreshToken(ctx, db.CreateRefreshTokenParams{
		ID: util.NewID(), UserID: u.ID, TokenHash: hashToken(refresh),
		ExpiresAt: pgtype.Timestamptz{Time: exp, Valid: true},
		SessionID: sessionID, UserAgent: meta.UserAgent, Ip: meta.IP,
	})
	if err != nil {
		return Session{}, err
	}
	if newDevice {
		s.sendNewLoginMail(ctx, u, meta)
	}
	return Session{User: u, AccessToken: access, RefreshToken: refresh, RefreshExpiresAt: exp, SessionID: sessionID}, nil
}

func (s *AuthService) isNewDevice(ctx context.Context, userID, ua string) bool {
	if s.out == nil {
		return false
	}
	total, err := s.q.CountRefreshTokensForUser(ctx, userID)
	if err != nil || total == 0 {
		return false
	}
	same, err := s.q.CountRefreshTokensForUserAgent(ctx, db.CountRefreshTokensForUserAgentParams{UserID: userID, UserAgent: ua})
	return err == nil && same == 0
}

// sendNewLoginMail is best-effort: a login must not fail because the alert
// about it could not be queued.
func (s *AuthService) sendNewLoginMail(ctx context.Context, u db.User, meta SessionMeta) {
	msg, err := s.render.NewLogin(u.Email, u.Locale, u.ID, mail.NewLoginData{
		UserAgent: mail.SafeField(meta.UserAgent), IP: mail.SafeField(meta.IP), At: s.now(),
		SessionsURL: s.render.AppURL + "/settings?tab=security",
	})
	if err == nil {
		_, err = s.out.Enqueue(ctx, s.q, msg)
	}
	if err != nil {
		slog.Warn("new-login mail not queued", "user", u.ID, "err", err)
		return
	}
	s.out.Kick()
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
