package service

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/mail"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The commands of Settings › Sign-in methods (ADR 0047 §5-6, spec §3.7):
// set or change the password, link a provider through the browser that is
// signed in, unlink one. Each takes the owner's proof (a step-up token, or
// the current password to change it), refuses a browser token older than
// the account's last credential change, audits and mails in its own
// transaction; a change or an unlink signs every other session out.

// linkTokenTTL bounds a link from Settings: the provider round trip has to
// start within it.
const linkTokenTTL = 5 * time.Minute

// linkViaSettings: the owner linked or unlinked the identity from Settings,
// with a step-up.
const linkViaSettings = "settings"

// SignInMethodsService runs the sign-in method commands on AuthService's
// sessions, proofs and mail.
type SignInMethodsService struct {
	pool *pgxpool.Pool
	q    *db.Queries
	auth *AuthService
}

func NewSignInMethodsService(pool *pgxpool.Pool, q *db.Queries, a *AuthService) *SignInMethodsService {
	return &SignInMethodsService{pool: pool, q: q, auth: a}
}

var (
	// ErrSignInMethodLast: removing it would leave the account no way in.
	ErrSignInMethodLast = errors.New("sign_in_method_last")
	// ErrSignInMethodRelayEmail: the account's address is Apple's relay for
	// this app, which only Apple keeps reaching the person.
	ErrSignInMethodRelayEmail = errors.New("sign_in_method_relay_email")
	// ErrLinkSessionMismatch: the browser finishing a link from Settings is
	// not signed in to the session that started it.
	ErrLinkSessionMismatch = errors.New("session_mismatch")
	// ErrLinkTokenInvalid: the link token is missing, expired, or was not
	// sealed by this server for link_token.
	ErrLinkTokenInvalid = errors.New("link_token_invalid")
)

func errSignInMethodLast() error {
	return CodedError{Code: "sign_in_method_last", Status: http.StatusConflict, Msg: "this is the account's only way in; set a password or link another first", Err: ErrSignInMethodLast}
}

func errSignInMethodRelayEmail() error {
	return CodedError{Code: "sign_in_method_relay_email", Status: http.StatusConflict, Msg: "the account's email is Apple's private relay; keep Apple linked", Err: ErrSignInMethodRelayEmail}
}

func errLinkSessionMismatch() error {
	return CodedError{Code: "session_mismatch", Status: http.StatusForbidden, Msg: "this browser is not signed in to the session that started the link", Err: ErrLinkSessionMismatch}
}

// PasswordInput is PUT /me/password: the new password, and the proof —
// the current password when the account has one and no second factor, else
// a step-up token (which an account with a password may send instead).
type PasswordInput struct {
	New         string
	Current     string
	StepUpToken string
}

// SetPassword sets the account's first password or changes it. The proof is
// a step-up token, or, to change the password of an account without a second
// factor, the current one (with a factor on, only that factor proves the
// owner: ADR 0047 §5); the bearer's session must be live either way. A change
// always signs out every other session (browser, device, MCP grant: the
// server decides, no client flag) and refuses browser tokens issued before
// it on sensitive commands (MarkCredentialsRevoked); a first password takes
// nothing away. The proof is weighed (and the new password hashed) before
// the account's row lock; under it the bearer is judged again
// (requireBearerUnderLock), and a current password stands only while it is
// still the one stored and no second factor came on. Audited
// auth.password_set or auth.password_changed via settings, told to the owner.
func (s *SignInMethodsService) SetPassword(ctx context.Context, userID string, in PasswordInput) (SignInMethodsChange, error) {
	if err := validatePassword(in.New); err != nil {
		return SignInMethodsChange{}, err
	}
	if err := requireCurrentCredentials(ctx, s.q); err != nil {
		return SignInMethodsChange{}, err
	}
	u, err := s.auth.Me(ctx, userID)
	if err != nil {
		return SignInMethodsChange{}, err
	}
	byPassword := false
	switch {
	case in.StepUpToken != "":
		if err := s.auth.requireStepUp(ctx, s.q, userID, in.StepUpToken, mail.StepUpActionSetPassword, mail.StepUpActionChangePassword); err != nil {
			return SignInMethodsChange{}, err
		}
	case u.PasswordHash.Valid && in.Current != "" && !u.MfaEnabledAt.Valid:
		at, err := stepUpBearer(ctx, userID)
		if err != nil {
			return SignInMethodsChange{}, err
		}
		if _, err := liveBearerSession(ctx, s.q, at); err != nil {
			return SignInMethodsChange{}, err
		}
		if err := s.auth.legacyPassword(ctx, userID, in.Current); err != nil {
			return SignInMethodsChange{}, err
		}
		byPassword = true
	default:
		return SignInMethodsChange{}, errProofRequiredFor(s.auth.signInMethods(u, bearerChannel(ctx)))
	}
	hash, err := auth.HashPassword(in.New)
	if err != nil {
		return SignInMethodsChange{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return SignInMethodsChange{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.q.WithTx(tx)
	locked, err := lockLiveUser(ctx, q, userID)
	if err != nil {
		return SignInMethodsChange{}, err
	}
	if err := requireBearerUnderLock(ctx, q, locked); err != nil {
		return SignInMethodsChange{}, err
	}
	if byPassword {
		switch {
		case locked.MfaEnabledAt.Valid:
			return SignInMethodsChange{}, errProofRequiredFor(s.auth.signInMethods(locked, bearerChannel(ctx)))
		case locked.PasswordHash != u.PasswordHash:
			// Replaced while this request was on its way: the password it
			// proved is not the current one any more.
			return SignInMethodsChange{}, errPasswordIncorrect()
		}
	}
	updated, err := q.SetUserPassword(ctx, db.SetUserPasswordParams{ID: userID, PasswordHash: pgtype.Text{String: hash, Valid: true}})
	if err != nil {
		return SignInMethodsChange{}, err
	}
	change, leases := mail.SignInChangePasswordSet, 0
	if locked.PasswordHash.Valid {
		change = mail.SignInChangePasswordChanged
		if leases, err = signOthersOut(ctx, q, userID, "password_changed"); err != nil {
			return SignInMethodsChange{}, err
		}
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: audit.NoOrganization, Actor: audit.User(userID),
		Action: passwordAuditAction(locked), ResourceType: "user", ResourceID: userID,
		Metadata: map[string]any{"via": linkViaSettings},
	}); err != nil {
		return SignInMethodsChange{}, err
	}
	m := s.auth.signInMailer()
	queued, err := m.queue(ctx, q, updated, mail.SignInMethodChangedData{
		Change: change, Method: mail.SignInMethodPassword, Device: mail.SafeField(sessionMetaFrom(ctx).UserAgent),
	})
	if err != nil {
		return SignInMethodsChange{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return SignInMethodsChange{}, err
	}
	m.kick(queued)
	observeOfficeLeaseRevokes(OfficeLeaseRevokeSessionRevoked, leases)
	return s.changed(ctx, updated), nil
}

// lockLiveUser locks userID's row for a sign-in method command; a deleted
// account is not found.
func lockLiveUser(ctx context.Context, q *db.Queries, userID string) (db.User, error) {
	u, err := q.GetUserForUpdate(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && u.DeletedAt.Valid) {
		return db.User{}, ErrNotFound
	}
	return u, err
}

// signOthersOut is what a password change and an unlink do to everything
// but the bearer's own session (ADR 0047 §5): every other browser session
// and device family (revokeOtherUserSessions), every MCP grant, and browser
// tokens issued before now refused on sensitive commands; audited as
// auth.session_revoked {scope: others, reason}, which closes every socket
// (the caller's reconnects once it has refreshed). It answers the Office
// leases revoked, for the metric after commit.
func signOthersOut(ctx context.Context, q *db.Queries, userID, reason string) (int, error) {
	keep := ""
	if at, ok := auth.AccessTokenFrom(ctx); ok && at.UserID == userID {
		keep = at.SessionID
	}
	tokens, devices, leases, err := revokeOtherUserSessions(ctx, q, userID, keep)
	if err != nil {
		return 0, err
	}
	grants, err := revokeAllMcpGrantsForUser(ctx, q, userID)
	if err != nil {
		return 0, err
	}
	if err := q.MarkCredentialsRevoked(ctx, userID); err != nil {
		return 0, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: audit.NoOrganization, Actor: audit.User(userID),
		Action: audit.ActionAuthSessionRevoked, ResourceType: "user", ResourceID: userID,
		Metadata: map[string]any{
			"scope": "others", "reason": reason, "count": tokens, "device_sessions": devices, "mcp_grants_revoked": grants,
		},
	}, sessionRevoked(userID, "")); err != nil {
		return 0, err
	}
	return leases, nil
}

func (s *SignInMethodsService) changed(ctx context.Context, u db.User) SignInMethodsChange {
	return SignInMethodsChange{User: s.auth.decorateAvatar(ctx, u), Methods: s.auth.signInMethods(u, bearerChannel(ctx))}
}

// LinkIntent is a link from Settings on its way through the provider: whose
// account, from which browser session, which provider, and where the
// browser goes back to. ExpectUser is the account the link is for, which
// the page that started it compares with the one the browser shows (a
// desktop shell opening Settings in the system browser).
type LinkIntent struct {
	UserID     string `json:"uid"`
	SessionID  string `json:"sid"`
	Provider   string `json:"provider"`
	ReturnTo   string `json:"return_to"`
	ExpectUser string `json:"expect_user"`
	ExpiresAt  int64  `json:"exp"`
}

// StartLink is POST /me/sign-in-methods/{provider}/link: from a browser
// session, with a step-up token, it seals the link_token (five minutes)
// that the provider's start takes, bound to this account and this session.
// The account must have proved its address (403 email_unverified: nothing
// planted on it may outlive a reclaim) and not be linked to the provider
// already (409 sign_in_method_already_linked). returnTo is a same-origin
// path the caller has sanitized.
func (s *SignInMethodsService) StartLink(ctx context.Context, userID, provider, stepUpToken, returnTo string) (string, error) {
	if provider != ProviderGoogle && provider != ProviderApple {
		return "", Invalid("nhà cung cấp không hợp lệ")
	}
	at, ok := auth.AccessTokenFrom(ctx)
	if !ok || at.UserID != userID || !at.Web || at.SessionID == "" {
		// An app links with the provider's own sheet, a token it sends.
		return "", Invalid("liên kết từ trình duyệt đang đăng nhập; trên app dùng đăng nhập của nhà cung cấp")
	}
	u, err := s.auth.Me(ctx, userID)
	if err != nil {
		return "", err
	}
	if !u.EmailVerifiedAt.Valid {
		return "", ErrEmailUnverified
	}
	if linked, _ := linkedSubject(u, provider); linked.Valid {
		return "", errSignInMethodAlreadyLinked()
	}
	if err := s.auth.requireStepUp(ctx, s.q, userID, stepUpToken, linkAction(provider)); err != nil {
		return "", err
	}
	li := LinkIntent{
		UserID: userID, SessionID: at.SessionID, Provider: provider, ReturnTo: returnTo,
		ExpectUser: userID, ExpiresAt: s.auth.now().Add(linkTokenTTL).Unix(),
	}
	raw, err := json.Marshal(li)
	if err != nil {
		return "", err
	}
	return s.auth.sealer.SealFor(auth.PurposeLinkToken, string(raw))
}

// OpenLinkToken reads a link token StartLink sealed: ErrLinkTokenInvalid when
// it is not one, has expired, or names nobody.
func (s *SignInMethodsService) OpenLinkToken(sealed string) (LinkIntent, error) {
	raw, err := s.auth.sealer.OpenFor(auth.PurposeLinkToken, sealed)
	if err != nil {
		return LinkIntent{}, ErrLinkTokenInvalid
	}
	var li LinkIntent
	if err := json.Unmarshal([]byte(raw), &li); err != nil || li.UserID == "" || li.SessionID == "" || s.auth.now().Unix() >= li.ExpiresAt {
		return LinkIntent{}, ErrLinkTokenInvalid
	}
	return li, nil
}

// LiveWebSession is the account and browser session a uniwork_refresh
// cookie opens, when it is live: how a provider round trip started from
// Settings tells that the browser carrying it is still the session that
// asked (spec §3.4). The handler never reads the database itself.
func (s *AuthService) LiveWebSession(ctx context.Context, rawRefresh string) (userID, sessionID string, ok bool) {
	return liveWebSession(ctx, s.q, rawRefresh)
}

// liveWebSession is LiveWebSession read through q.
func liveWebSession(ctx context.Context, q *db.Queries, rawRefresh string) (userID, sessionID string, ok bool) {
	if rawRefresh == "" {
		return "", "", false
	}
	rt, err := q.GetRefreshTokenByHash(ctx, hashToken(rawRefresh))
	if err != nil {
		return "", "", false
	}
	return rt.UserID, rt.SessionID, true
}

// CheckLinkSession is the start of a browser link: the browser's refresh
// cookie must open the very session the link token names, else
// session_mismatch.
func (s *SignInMethodsService) CheckLinkSession(ctx context.Context, li LinkIntent, rawRefresh string) error {
	return checkLinkSession(ctx, s.q, li, rawRefresh)
}

// checkLinkSession is CheckLinkSession read through q.
func checkLinkSession(ctx context.Context, q *db.Queries, li LinkIntent, rawRefresh string) error {
	uid, sid, ok := liveWebSession(ctx, q, rawRefresh)
	if !ok || uid != li.UserID || sid != li.SessionID {
		return errLinkSessionMismatch()
	}
	return nil
}

// BrowserLink is how a link from Settings ended at the provider's callback.
// Ticket is set on sign_in_method_movable: the proved identity, as a web
// sign-in ticket, so Settings can confirm the move with a step-up
// (POST /auth/sign-in-ticket/link {move: true}) without another round trip.
type BrowserLink struct {
	Change SignInMethodsChange
	Ticket string
}

// LinkFromBrowser finishes a link from Settings once the provider proved
// id: the browser must still be signed in to the session that started it
// (CheckLinkSession again: the cookie may have changed hands during the
// round trip, and once more under the account's row lock), then
// attachIdentity links it into that account, audited via settings. A link_required, taken or already-linked answer is attach's own.
// An Apple consent the proof brought and nothing kept (a refusal other than
// movable, whose ticket carries it on) goes back to Apple unless the Apple ID
// opens an account.
func (s *SignInMethodsService) LinkFromBrowser(ctx context.Context, li LinkIntent, id ProviderIdentity, rawRefresh string) (out BrowserLink, err error) {
	defer func() {
		if err != nil && out.Ticket == "" {
			s.auth.apple.giveBack(ctx, id)
		}
	}()
	if err := s.CheckLinkSession(ctx, li, rawRefresh); err != nil {
		return BrowserLink{}, err
	}
	if id.Provider != li.Provider {
		return BrowserLink{}, ErrLinkTokenInvalid
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return BrowserLink{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.q.WithTx(tx)
	caller, err := lockLiveUser(ctx, q, li.UserID)
	if err != nil {
		return BrowserLink{}, err
	}
	// Again under the lock: a reclaim or a credential change that committed
	// meanwhile ended the session that asked.
	if err := checkLinkSession(ctx, q, li, rawRefresh); err != nil {
		return BrowserLink{}, err
	}
	a, err := s.auth.attachIdentity(ctx, q, caller, id, linkViaSettings, false)
	if errors.Is(err, ErrSignInMethodMovable) {
		ticket, terr := s.auth.issueSignInTicket(id, TicketKindLinkRequired, SignInIntentSignIn, WebTicket())
		if terr != nil {
			return BrowserLink{}, terr
		}
		return BrowserLink{Ticket: ticket}, err
	}
	if err != nil {
		return BrowserLink{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		if isUniqueViolation(err) {
			return BrowserLink{}, errSignInAccountConflict()
		}
		return BrowserLink{}, err
	}
	s.auth.afterAttach(ctx, a)
	return BrowserLink{Change: SignInMethodsChange{
		User: s.auth.decorateAvatar(ctx, a.user), Methods: s.auth.signInMethods(a.user, SignInChannelWeb),
	}}, nil
}

// AppLink is POST /me/sign-in-methods/{provider}/native: the provider token
// the app's own sheet just returned (Google's SDK, the iPhone's Apple
// sheet) with the raw nonce it handed the sheet, Apple's one-time code, the
// step-up token of the app's session, and Move, to move the identity out of
// the empty account holding it (after 409 sign_in_method_movable).
type AppLink struct {
	StepUpToken       string
	Token             string
	Nonce             string
	AuthorizationCode string
	Move              bool
}

// LinkFromApp links a provider from the app's Settings (ADR 0047 §6): the
// app proves the identity with the provider's own sheet, so no browser round
// trip is needed. Only the app's bearer takes this door (a browser links
// through LinkFromBrowser: 400 invalid_request). The account must have proved
// its address (403 email_unverified), then the step-up of the app's session
// (requireStepUp: a browser token older than a credential change and a dead
// session are 401, a missing token 403 proof_required); then the token,
// checked by the app's verifier of that provider (403 provider_token_invalid,
// never 401: the caller is signed in), and attachIdentity links it into the
// account under its row lock, where the bearer is judged again
// (requireBearerUnderLock), audited via settings — taken, movable and
// already-linked are attach's own answers. An Apple consent the proof brought and nothing kept
// goes back to Apple unless the Apple ID opens an account.
func (s *SignInMethodsService) LinkFromApp(ctx context.Context, userID, provider string, in AppLink) (out SignInMethodsChange, err error) {
	if provider != ProviderGoogle && provider != ProviderApple {
		return SignInMethodsChange{}, Invalid("nhà cung cấp không hợp lệ")
	}
	at, ok := auth.AccessTokenFrom(ctx)
	if !ok || at.UserID != userID || at.Web {
		// A browser links through the provider's own pages instead.
		return SignInMethodsChange{}, Invalid("liên kết trên app bằng đăng nhập của nhà cung cấp; trên web dùng trình duyệt đang đăng nhập")
	}
	u, err := s.auth.Me(ctx, userID)
	if err != nil {
		return SignInMethodsChange{}, err
	}
	if !u.EmailVerifiedAt.Valid {
		return SignInMethodsChange{}, ErrEmailUnverified
	}
	if err := s.auth.requireStepUp(ctx, s.q, userID, in.StepUpToken, linkAction(provider)); err != nil {
		return SignInMethodsChange{}, err
	}
	id, err := s.appIdentity(ctx, provider, in)
	if err != nil {
		return SignInMethodsChange{}, err
	}
	defer func() {
		if err != nil {
			s.auth.apple.giveBack(ctx, id)
		}
	}()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return SignInMethodsChange{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.q.WithTx(tx)
	caller, err := lockLiveUser(ctx, q, userID)
	if err != nil {
		return SignInMethodsChange{}, err
	}
	if err := requireBearerUnderLock(ctx, q, caller); err != nil {
		return SignInMethodsChange{}, err
	}
	a, err := s.auth.attachIdentity(ctx, q, caller, id, linkViaSettings, in.Move)
	if err != nil {
		return SignInMethodsChange{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		if isUniqueViolation(err) {
			return SignInMethodsChange{}, errSignInAccountConflict()
		}
		return SignInMethodsChange{}, err
	}
	s.auth.afterAttach(ctx, a)
	return SignInMethodsChange{
		User: s.auth.decorateAvatar(ctx, a.user), Methods: s.auth.signInMethods(a.user, SignInChannelNative),
	}, nil
}

// appIdentity is the identity the app's provider token proves, checked by
// that provider's app verifier; a token that does not verify, or a provider
// whose app door is closed, is 403 provider_token_invalid.
func (s *SignInMethodsService) appIdentity(ctx context.Context, provider string, in AppLink) (ProviderIdentity, error) {
	switch {
	case provider == ProviderGoogle && s.auth.GoogleNativeEnabled():
		c, err := s.auth.googleNative.Verify(ctx, in.Token, in.Nonce)
		if err == nil {
			return googleIdentity(c), nil
		}
		slog.Info("app google link refused", "reason", googleTokenReason(err))
	case provider == ProviderApple && s.auth.apple.NativeEnabled():
		id, err := s.auth.apple.nativeIdentity(ctx, in.Token, in.Nonce, in.AuthorizationCode, "", "")
		if err == nil {
			return id, nil
		}
		slog.Info("app apple link refused", "reason", appleTokenReason(err))
	}
	return ProviderIdentity{}, errProviderProofInvalid()
}

// Unlink is POST /me/sign-in-methods/{provider}/unlink, with a step-up
// token, judged under the row lock like the rest: the account's last way in stays (409
// sign_in_method_last), and so does Apple when the account's own address is
// Apple's relay (409 sign_in_method_relay_email). The subject is kept as
// *_unlinked_sub, so it is never linked back by address; every other session
// is signed out as for a password change; audited
// auth.sign_in_method_unlinked via settings and told to the owner. An Apple
// unlink gives the account's Apple consent back to Apple after commit. A
// provider not linked is answered as it is, with nothing written.
func (s *SignInMethodsService) Unlink(ctx context.Context, userID, provider, stepUpToken string) (SignInMethodsChange, error) {
	if provider != ProviderGoogle && provider != ProviderApple {
		return SignInMethodsChange{}, Invalid("nhà cung cấp không hợp lệ")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return SignInMethodsChange{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.q.WithTx(tx)
	locked, err := lockLiveUser(ctx, q, userID)
	if err != nil {
		return SignInMethodsChange{}, err
	}
	// The step-up's gates run under the lock, so a credential change that
	// committed while this waited is what they judge.
	if err := s.auth.requireStepUp(ctx, q, userID, stepUpToken, unlinkAction(provider)); err != nil {
		return SignInMethodsChange{}, err
	}
	if linked, _ := linkedSubject(locked, provider); !linked.Valid {
		return s.changed(ctx, locked), nil
	}
	if waysIn(locked) <= 1 {
		return SignInMethodsChange{}, errSignInMethodLast()
	}
	if provider == ProviderApple && isRelayAddress(locked.Email) {
		return SignInMethodsChange{}, errSignInMethodRelayEmail()
	}
	var updated db.User
	if provider == ProviderApple {
		updated, err = q.UnlinkAppleAccount(ctx, userID)
	} else {
		updated, err = q.UnlinkGoogleAccount(ctx, userID)
	}
	if err != nil {
		return SignInMethodsChange{}, err
	}
	leases, err := signOthersOut(ctx, q, userID, "sign_in_method_unlinked")
	if err != nil {
		return SignInMethodsChange{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: audit.NoOrganization, Actor: audit.User(userID),
		Action: audit.ActionAuthSignInMethodUnlinked, ResourceType: "user", ResourceID: userID,
		Metadata: map[string]any{"provider": provider, "via": linkViaSettings},
	}); err != nil {
		return SignInMethodsChange{}, err
	}
	m := s.auth.signInMailer()
	queued, err := m.queue(ctx, q, updated, mail.SignInMethodChangedData{
		Change: mail.SignInChangeUnlinked, Method: provider, Device: mail.SafeField(sessionMetaFrom(ctx).UserAgent),
	})
	if err != nil {
		return SignInMethodsChange{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return SignInMethodsChange{}, err
	}
	m.kick(queued)
	observeOfficeLeaseRevokes(OfficeLeaseRevokeSessionRevoked, leases)
	if provider == ProviderApple {
		s.auth.apple.revokeAfterCommit(ctx, userID, locked.AppleClientID.String, locked.AppleRefreshTokenEnc.String)
	}
	return s.changed(ctx, updated), nil
}

// waysIn counts how u signs in: its password and each linked provider.
func waysIn(u db.User) int {
	n := 0
	for _, in := range []bool{u.PasswordHash.Valid, u.GoogleID.Valid, u.AppleID.Valid} {
		if in {
			n++
		}
	}
	return n
}
