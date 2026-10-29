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
	"github.com/unicomhub/uniwork/server/internal/files"
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
	// main.go injects the server's one sealer (SetSealer); the one derived
	// here from the minter's secret is the same key, for the tests.
	sealer auth.SecretSealer
	// render/out are nil-safe: without SetMail no new-login mail goes out.
	render mail.Renderer
	out    mail.Enqueuer
	now    func() time.Time
	// files selects the FileService path for avatars (UNI-744); nil keeps the
	// legacy storage path. Wired through SetFiles — never both at once.
	files files.Service
	// emailHub is optional: wired, DeleteAccount revokes the OAuth grants of
	// the mailboxes it disconnects (spec §5.5).
	emailHub *EmailHubService
	// apple is optional: wired, DeleteAccount revokes the Sign in with Apple
	// token the account kept (ADR 0041).
	apple *AppleAuthService
	// proofVerifiers check the provider tokens the app offers as a step-up
	// proof, by provider; one is offered only once its verifier is here.
	proofVerifiers map[string]ProviderProofVerifier
	// googleNative checks the app's Google ID tokens (SetGoogleNative); nil
	// keeps the app's Google door closed.
	googleNative GoogleTokenVerifier
	// drive is optional: wired, DeleteAccount revokes the Google Drive grants
	// of the connections it disconnects after commit (spec §5.3a).
	drive *DriveConnectionService
}

func NewAuthService(pool *pgxpool.Pool, q *db.Queries, minter auth.TokenMinter, refreshTTL time.Duration, verification *VerificationService) *AuthService {
	sealer, _ := auth.NewSecretSealer(minter.Secret) // empty secret: MFA setup answers an error, nothing else changes
	return &AuthService{pool: pool, q: q, minter: minter, refreshTTL: refreshTTL, verification: verification, sealer: sealer, now: time.Now}
}

// SetMail enables the new-device login alert (spec F-01 §2 I8) and the
// sign-in method notices the provider sign-ins built on this service queue.
func (s *AuthService) SetMail(r mail.Renderer, out mail.Enqueuer) {
	s.render, s.out = r, out
}

// SetSealer hands the service the server's one sealer, which main.go builds
// from the JWT secret and every service shares (ADR 0049).
func (s *AuthService) SetSealer(sealer auth.SecretSealer) { s.sealer = sealer }

// SetEmailHub lets DeleteAccount revoke the refresh tokens it removes; main
// wires it once EmailHubService exists.
func (s *AuthService) SetEmailHub(h *EmailHubService) { s.emailHub = h }

// SetApple lets DeleteAccount revoke the account's Sign in with Apple token,
// and a fresh identity token from the iPhone's Apple sheet prove an
// Apple-linked account in a step-up; main wires it when Sign in with Apple is
// configured.
func (s *AuthService) SetApple(a *AppleAuthService) {
	s.apple = a
	if a == nil || a.verifier == nil {
		s.setProofVerifier(ProviderApple, nil)
		return
	}
	s.setProofVerifier(ProviderApple, func(ctx context.Context, token, nonce string) (string, time.Time, error) {
		c, err := a.verifier.Verify(ctx, token, nonce)
		return c.Sub, c.IssuedAt, err
	})
}

// SetDrive lets DeleteAccount revoke the Google Drive grants it disconnects after commit.
func (s *AuthService) SetDrive(d *DriveConnectionService) { s.drive = d }

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
func (s *AuthService) recordAuth(ctx context.Context, action, userID string, meta map[string]any, emit ...audit.Event) {
	if err := auditRecorder.Record(ctx, s.q, audit.Entry{
		OrganizationID: audit.NoOrganization,
		Actor:          audit.User(userID),
		Action:         action,
		ResourceType:   "user", ResourceID: userID,
		Metadata: meta,
	}, emit...); err != nil {
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
	// LinkSkipped, after a second factor whose challenge carried a pending
	// provider link: why the identity was not linked (ADR 0049, spec §3.3).
	// The sign-in itself succeeded; the client offers Settings instead.
	LinkSkipped string
	// Reclaimed: this sign-in took the account back from whoever registered
	// the address before proving it (a reset link on an unverified account);
	// the client says so once.
	Reclaimed bool
}

// MFAPending reports whether the caller must still answer the TOTP challenge.
func (s Session) MFAPending() bool { return s.MFAToken != "" }

// NormalizeLocale maps any tag to a mail locale we have templates for.
// English is the default: only a tag that asks for Vietnamese gets it.
func NormalizeLocale(s string) string {
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(s)), "vi") {
		return "vi"
	}
	return "en"
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
	p, err := newPasswordAccount(email, password, displayName, locale)
	if err != nil {
		return Session{}, err
	}
	u, err := createPasswordAccount(ctx, s.q, p)
	if err != nil {
		return Session{}, err
	}
	s.sendVerificationAfterSignUp(ctx, u.ID)
	return s.mintSession(ctx, u, "", "")
}

// newPasswordAccount checks a sign-up by email (the web's and the app's) and
// hashes its password: the row createPasswordAccount inserts.
func newPasswordAccount(email, password, displayName, locale string) (db.CreateUserParams, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if !strings.Contains(email, "@") || len(email) < 5 {
		return db.CreateUserParams{}, Invalid("email không hợp lệ")
	}
	if err := validatePassword(password); err != nil {
		return db.CreateUserParams{}, err
	}
	if strings.TrimSpace(displayName) == "" {
		return db.CreateUserParams{}, Invalid("tên hiển thị không được để trống")
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		return db.CreateUserParams{}, err
	}
	return db.CreateUserParams{
		ID: util.NewID(), Email: email, PasswordHash: pgtype.Text{String: hash, Valid: true}, DisplayName: displayName,
		Locale: NormalizeLocale(locale),
	}, nil
}

// createPasswordAccount inserts a sign-up's account in q; an address another
// account holds is ErrConflict. The address starts unverified: the caller
// mails the code once its transaction committed.
func createPasswordAccount(ctx context.Context, q *db.Queries, p db.CreateUserParams) (db.User, error) {
	u, err := q.CreateUser(ctx, p)
	if isUniqueViolation(err) {
		return db.User{}, ErrConflict
	}
	return u, err
}

// sendVerificationAfterSignUp mails the code that proves a new account's
// address, best effort: the account exists either way and the person can ask
// for the code again.
func (s *AuthService) sendVerificationAfterSignUp(ctx context.Context, userID string) {
	if s.verification == nil {
		return
	}
	if err := s.verification.Send(ctx, userID); err != nil {
		slog.Warn("send verification code after sign-up", "user", userID, "err", err)
	}
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
		return s.challengeOn(ctx, u, auth.MFAChallenge{Channel: auth.MFAChannelWeb})
	}
	sess, err := s.mintSession(ctx, u, "", "")
	if err != nil {
		return Session{}, err
	}
	s.recordAuth(ctx, audit.ActionAuthLoginSucceeded, u.ID, meta)
	return sess, nil
}

// reclaimedSession opens the session of a reclaim (a provider that owns the
// address, a reset link) with its login audit row and no new-login alert:
// the reclaim already told the owner and ended every session before it, and
// the sessions it ended would make the owner's own browser read as new. The
// reclaim cleared the second factor, so no challenge is owed.
func (s *AuthService) reclaimedSession(ctx context.Context, u db.User, meta map[string]any) (Session, error) {
	sess, _, err := s.openSessionTx(ctx, u, "", "")
	if err != nil {
		return Session{}, err
	}
	s.recordAuth(ctx, audit.ActionAuthLoginSucceeded, u.ID, meta)
	return sess, nil
}

// challengeOn answers a first factor that passed on an account with a
// second factor: the challenge token for ch's channel (and native client),
// in place of a session.
func (s *AuthService) challengeOn(ctx context.Context, u db.User, ch auth.MFAChallenge) (Session, error) {
	ch.UserID = u.ID
	tok, err := s.minter.MintMFA(ch)
	if err != nil {
		return Session{}, err
	}
	return Session{User: s.decorateAvatar(ctx, u), MFAToken: tok}, nil
}

// Refresh rotates a browser session's refresh token. It runs in one
// transaction under the account's row held FOR SHARE, which every
// account-wide revocation (a reclaim, a password change or reset, an unlink)
// takes FOR UPDATE before it revokes: the token is read again once the row
// is held, so a revocation that committed meanwhile ended it, and one that
// comes after waits for the successor and ends it too. Two refreshes of the
// same token at once still both rotate, as before.
func (s *AuthService) Refresh(ctx context.Context, rawToken string) (Session, error) {
	hash := hashToken(rawToken)
	rt, err := s.q.GetRefreshTokenByHash(ctx, hash)
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrInvalidCredentials
	}
	if err != nil {
		return Session{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Session{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.q.WithTx(tx)
	u, err := q.GetUserForShare(ctx, rt.UserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrInvalidCredentials
	}
	if err != nil {
		return Session{}, err
	}
	if _, err := q.GetRefreshTokenByHash(ctx, hash); errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrInvalidCredentials
	} else if err != nil {
		return Session{}, err
	}
	if err := q.RevokeRefreshToken(ctx, hash); err != nil {
		return Session{}, err
	}
	// Rotation stays inside the session: same id, same browser string; the
	// address is whatever the client is on now. A rotation is never a new
	// device, so there is no alert to send.
	sess, _, err := s.openSession(ctx, q, u, rt.SessionID, rt.UserAgent)
	if err != nil {
		return Session{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Session{}, err
	}
	return sess, nil
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
		s.recordAuth(ctx, audit.ActionAuthSessionRevoked, rt.UserID, map[string]any{"scope": "one", "reason": "logout"},
			sessionRevoked(rt.UserID, rt.SessionID))
	}
	return nil
}

func (s *AuthService) Me(ctx context.Context, userID string) (db.User, error) {
	u, err := s.q.GetUserByID(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.User{}, ErrNotFound
	}
	if err != nil {
		return db.User{}, err
	}
	return s.decorateAvatar(ctx, u), nil
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
	return s.decorateAvatar(ctx, u), nil
}

// UpdateAvatar stores an externally-hosted avatar URL (the legacy upload and
// provider-photo path). The write clears avatar_file_id — under FileService a
// file-backed avatar being replaced by a URL is released in the same
// transaction, so the file is never left claimed-but-unreferenced.
func (s *AuthService) UpdateAvatar(ctx context.Context, userID, url string) (db.User, error) {
	if s.files == nil {
		u, err := s.q.UpdateUserAvatar(ctx, db.UpdateUserAvatarParams{
			ID:        userID,
			AvatarUrl: pgtype.Text{String: url, Valid: url != ""},
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return db.User{}, ErrNotFound
		}
		return u, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.User{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	// FS-C1 §5.4: the release locks the files row before this transaction
	// locks the user row, so avatar_file_id is read non-locking first and
	// re-read FOR UPDATE after the files call — a swap committed in between
	// surfaces as a conflict, not a release of the wrong file.
	prev, err := q.GetUserAvatarFileID(ctx, userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return db.User{}, ErrNotFound
		}
		return db.User{}, err
	}
	if prev.Valid && prev.String != "" {
		if err := releaseFilesInTx(ctx, s.files, q, []files.FileID{files.FileID(prev.String)}); err != nil {
			return db.User{}, err
		}
	}
	cur, err := q.GetUserAvatarFileIDForUpdate(ctx, userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return db.User{}, ErrNotFound
		}
		return db.User{}, err
	}
	if cur.String != prev.String || cur.Valid != prev.Valid {
		return db.User{}, ErrConflict
	}
	u, err := q.UpdateUserAvatar(ctx, db.UpdateUserAvatarParams{
		ID:        userID,
		AvatarUrl: pgtype.Text{String: url, Valid: url != ""},
	})
	if err != nil {
		return db.User{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return db.User{}, err
	}
	return u, nil
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
	sess, newDevice, err := s.openSessionTx(ctx, u, sessionID, inheritedUA)
	if err != nil {
		return Session{}, err
	}
	if newDevice {
		s.sendNewLoginMail(ctx, sess.User, sessionMetaFrom(ctx))
	}
	return sess, nil
}

// openSessionTx is openSession in a transaction of its own, for a first
// factor that wrote nothing else: the account's row is held until the
// session commits (holdAccountForSession).
func (s *AuthService) openSessionTx(ctx context.Context, u db.User, sessionID, inheritedUA string) (Session, bool, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Session{}, false, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	sess, newDevice, err := s.openSession(ctx, s.q.WithTx(tx), u, sessionID, inheritedUA)
	if err != nil {
		return Session{}, false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Session{}, false, err
	}
	return sess, newDevice, nil
}

// holdAccountForSession holds u's row FOR SHARE in q's transaction until it
// commits, so opening a session and an account-wide revocation (which takes
// the row FOR UPDATE before it revokes) never interleave: the revocation
// either ends this session too or commits first, and this then sees it. u
// is the row the session's first factor was judged against (a password, a
// provider, a reset link, a second step); when the account was erased since,
// or its credentials changed since (credentials_revoked_at moved: a reclaim,
// a password change or reset, an unlink), that judgement no longer stands
// and the answer is invalid_credentials.
func holdAccountForSession(ctx context.Context, q *db.Queries, u db.User) error {
	held, err := q.GetUserForShare(ctx, u.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrInvalidCredentials
	}
	if err != nil {
		return err
	}
	same := held.CredentialsRevokedAt.Valid == u.CredentialsRevokedAt.Valid &&
		(!held.CredentialsRevokedAt.Valid || held.CredentialsRevokedAt.Time.Equal(u.CredentialsRevokedAt.Time))
	if held.DeletedAt.Valid || !same {
		return ErrInvalidCredentials
	}
	return nil
}

// openSession is mintSession in the caller's transaction (q), for a
// command whose session commits together with what it wrote (the link a
// second factor finishes). It holds the account's row for the session
// (holdAccountForSession), so q must be a transaction's. It reports whether
// the browser is new to the account instead of mailing: the alert is
// best-effort, and a failed insert would abort the caller's transaction, so
// the caller mails after commit.
func (s *AuthService) openSession(ctx context.Context, q *db.Queries, u db.User, sessionID, inheritedUA string) (Session, bool, error) {
	if err := holdAccountForSession(ctx, q, u); err != nil {
		return Session{}, false, err
	}
	u = s.decorateAvatar(ctx, u)
	meta := sessionMetaFrom(ctx)
	if sessionID != "" {
		meta.UserAgent = inheritedUA
	}
	newDevice := false
	if sessionID == "" {
		sessionID = util.NewID()
		newDevice = s.isNewDevice(ctx, q, u.ID, meta.UserAgent)
	}
	access, err := s.minter.MintWebSession(u.ID, sessionID)
	if err != nil {
		return Session{}, false, err
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return Session{}, false, err
	}
	refresh := hex.EncodeToString(raw)
	exp := s.now().Add(s.refreshTTL)
	_, err = q.CreateRefreshToken(ctx, db.CreateRefreshTokenParams{
		ID: util.NewID(), UserID: u.ID, TokenHash: hashToken(refresh),
		ExpiresAt: pgtype.Timestamptz{Time: exp, Valid: true},
		SessionID: sessionID, UserAgent: meta.UserAgent, Ip: meta.IP,
	})
	if err != nil {
		return Session{}, false, err
	}
	return Session{User: u, AccessToken: access, RefreshToken: refresh, RefreshExpiresAt: exp, SessionID: sessionID}, newDevice, nil
}

// isNewDevice reads in q, the caller's transaction when there is one, so it
// sees what that transaction wrote and holds no second connection.
func (s *AuthService) isNewDevice(ctx context.Context, q *db.Queries, userID, ua string) bool {
	if s.out == nil {
		return false
	}
	total, err := q.CountRefreshTokensForUser(ctx, userID)
	if err != nil || total == 0 {
		return false
	}
	same, err := q.CountRefreshTokensForUserAgent(ctx, db.CountRefreshTokensForUserAgentParams{UserID: userID, UserAgent: ua})
	return err == nil && same == 0
}

// signInMailer is where this service's sign-in commands queue their
// sign_in_method_changed notices (nil-safe without SetMail).
func (s *AuthService) signInMailer() signInMailer {
	return signInMailer{render: s.render, out: s.out, now: s.now}
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
