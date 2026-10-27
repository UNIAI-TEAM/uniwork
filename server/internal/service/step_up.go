package service

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Step-up (ADR 0047 §5, spec §3.7): before a command that changes how the
// account signs in or that cannot be undone alone — set or change the
// password, link or unlink a provider, turn the second factor on, delete
// the account, hand an organization over — the person signed in proves
// again that they are the account's owner. This file is the one place a
// signed-in person's proof is checked: POST /me/step-up turns a proof into a
// ten-minute token bound to the session that asked, the commands take the
// token (requireStepUp), and the few legacy proofs shipped apps still send
// are weighed here too, against the same lockout.

const (
	stepUpTokenTTL = 10 * time.Minute
	// A mailed step-up code: ten minutes, one a minute, five a day.
	stepUpCodeTTL      = 10 * time.Minute
	stepUpCodeResend   = 60 * time.Second
	stepUpCodeDailyCap = 5
	// providerProofMaxAge: a provider token proves the person only when the
	// app just got it from the provider's own sheet.
	providerProofMaxAge = 5 * time.Minute
)

// legacyProofReviewBy is when the proofs shipped apps send in place of a
// step-up token — POST /me/delete's password, code or typed address, and an
// owner's password on a hand-over — are reviewed for removal, with the
// legacy Apple route (ADR 0047 §8). TestLegacyProofDoorsAreReviewed fails
// once it passes.
const legacyProofReviewBy = "2027-01-31"

// StepUpProof is what POST /me/step-up carries: one proof, of a kind the
// account takes (signInMethodsOf: with a second factor on only Code as TOTP
// or a recovery code; otherwise the password, a mailed code with the Action
// it was asked for, or on the app a fresh provider token).
type StepUpProof struct {
	Password string
	Code     string
	Action   string
	Provider *ProviderProof
}

// ProviderProof is an identity token the app just got from Apple's or
// Google's sheet, with the raw nonce it handed the sheet.
type ProviderProof struct {
	Provider string
	Token    string
	Nonce    string
}

// StepUpGrant is the answer of a proof that passed.
type StepUpGrant struct {
	Token     string
	ExpiresAt time.Time
	// Method is the proof that bought it: totp, password, email_code, apple
	// or google.
	Method string
}

// stepUpClaims is the step_up blob (spec §3.7): whose, for which session
// (a browser session id, or a native device id), and until when. Action is
// the action a mailed code named, set only when the code bought the token:
// the mail told the owner the code allows that one thing, so the token
// serves only the commands of that action. A password, a second factor or a
// provider's token proves the owner for every command of the window.
type stepUpClaims struct {
	UserID    string `json:"uid"`
	SessionID string `json:"sid"`
	Web       bool   `json:"web,omitempty"`
	Method    string `json:"method"`
	Action    string `json:"action,omitempty"`
	IssuedAt  int64  `json:"iat"`
	ExpiresAt int64  `json:"exp"`
}

// ProviderProofVerifier checks a provider token offered as a step-up proof
// against the provider's keys, its audience and the nonce, and answers whose
// it is and when it was issued.
type ProviderProofVerifier func(ctx context.Context, token, nonce string) (subject string, issuedAt time.Time, err error)

var (
	// ErrStepUpCodeIncorrect: the mailed step-up code is wrong, expired,
	// spent, or was asked for another action.
	ErrStepUpCodeIncorrect = errors.New("step_up_code_incorrect")
	// ErrProviderProofInvalid: the provider token offered as a proof did not
	// verify, is not of the linked subject, or is not fresh.
	ErrProviderProofInvalid = errors.New("provider_token_invalid")
)

// The wrong-proof answers are 403, never 401: the caller is signed in, and
// a 401 makes the client refresh and send the proof again (see
// ErrPasswordIncorrect). Nor is a wrong code invalid_code, whose
// error_class sends the client into session recovery.
func errStepUpCodeIncorrect() error {
	return CodedError{Code: "step_up_code_incorrect", Status: http.StatusForbidden, Msg: "mã xác nhận không đúng hoặc đã hết hạn", Err: ErrStepUpCodeIncorrect}
}

func errProviderProofInvalid() error {
	return CodedError{Code: "provider_token_invalid", Status: http.StatusForbidden, Msg: "the provider sign-in did not prove this account; sign in with it again", Err: ErrProviderProofInvalid}
}

// errProofRequiredFor is proof_required naming the proofs the account
// takes, so the client asks for one of them.
func errProofRequiredFor(m SignInMethods) error {
	e := errProofRequired().(CodedError)
	proofs := m.Proofs
	if proofs == nil {
		proofs = []string{}
	}
	e.Fields = map[string]any{"proofs": proofs}
	return e
}

// errCodeDailyCap is 429 rate_limited once a day's codes are spent, with
// retry_after until the oldest of them leaves the window.
func errCodeDailyCap(wait time.Duration) error {
	retry := int(math.Ceil(wait.Seconds()))
	if retry < 1 {
		retry = 1
	}
	return CodedError{
		Code: "rate_limited", Status: http.StatusTooManyRequests,
		Msg: "too many codes today; try again later", Err: ErrRateLimited,
		Fields: map[string]any{"retry_after": retry},
	}
}

// GoogleTokenVerifier checks an ID token the app's Google SDK returned (ADR
// 0047 §8: an app client as azp, the hash of the app's nonce, a fresh iat);
// auth.GoogleNativeVerifier in production.
type GoogleTokenVerifier interface {
	Verify(ctx context.Context, rawToken, rawNonce string) (auth.GoogleClaims, error)
}

// SetGoogleNative opens the app's Google door (POST /auth/native/google, the
// app's Settings link) and lets a fresh Google ID token from the app's SDK
// prove a Google-linked account in a step-up. nil closes both: no account is
// then offered google as a proof.
func (s *AuthService) SetGoogleNative(v GoogleTokenVerifier) {
	s.googleNative = v
	if v == nil {
		s.setProofVerifier(ProviderGoogle, nil)
		return
	}
	s.setProofVerifier(ProviderGoogle, func(ctx context.Context, token, nonce string) (string, time.Time, error) {
		c, err := v.Verify(ctx, token, nonce)
		return c.Sub, c.IssuedAt, err
	})
}

// GoogleNativeEnabled: the app's Google ID tokens can be checked
// (GOOGLE_NATIVE_CLIENT_IDS), so the app's Google door is open.
func (s *AuthService) GoogleNativeEnabled() bool { return s != nil && s.googleNative != nil }

func (s *AuthService) setProofVerifier(provider string, v ProviderProofVerifier) {
	if s.proofVerifiers == nil {
		s.proofVerifiers = map[string]ProviderProofVerifier{}
	}
	if v == nil {
		delete(s.proofVerifiers, provider)
		return
	}
	s.proofVerifiers[provider] = v
}

// signInMethods is signInMethodsOf less the provider proofs this server
// cannot check: a proof is offered only when it can be taken.
func (s *AuthService) signInMethods(u db.User, channel string) SignInMethods {
	m := signInMethodsOf(u, channel)
	m.Proofs = slices.DeleteFunc(m.Proofs, func(p string) bool {
		return (p == ProofApple || p == ProofGoogle) && s.proofVerifiers[p] == nil
	})
	return m
}

// SignInMethods is GET /me/sign-in-methods: how the bearer's account signs
// in and the proofs it takes on the bearer's channel.
func (s *AuthService) SignInMethods(ctx context.Context, userID string) (SignInMethods, error) {
	u, err := s.Me(ctx, userID)
	if err != nil {
		return SignInMethods{}, err
	}
	return s.signInMethods(u, bearerChannel(ctx)), nil
}

// bearerChannel is the channel of the request's bearer: an app's device
// token is native, anything else (a browser, no bearer) web.
func bearerChannel(ctx context.Context) string {
	if at, ok := auth.AccessTokenFrom(ctx); ok && !at.Web {
		return SignInChannelNative
	}
	return SignInChannelWeb
}

// stepUpBearer is the request's bearer when it is userID's and names its
// session: a step-up is bound to that session, so a bearer without one (a
// direct service call, a token minted before sessions had ids) cannot ask.
func stepUpBearer(ctx context.Context, userID string) (auth.AccessToken, error) {
	at, ok := auth.AccessTokenFrom(ctx)
	if !ok || at.UserID != userID || at.SessionID == "" {
		return auth.AccessToken{}, errProofRequired()
	}
	return at, nil
}

// bearerSession is the bearer's session as the database has it now.
// signedInAt is when the person behind it last proved a credential: a
// browser session's start (its first refresh token, every one a sign-in
// writes), or a device session's signed_in_at — the app's own sign-in, or
// the start of the browser session whose consent issued it; zero when the
// row predates the column.
type bearerSession struct {
	signedInAt             time.Time
	clientID, deploymentID string
}

// liveBearerSession reads the bearer's session and refuses one that ended
// (signed out, revoked by another session's password change, a reclaim) with
// 401 invalid_token: the client refreshes, which fails, and signs in again.
// A browser session is its refresh tokens; an app's, its device row.
func liveBearerSession(ctx context.Context, q *db.Queries, at auth.AccessToken) (bearerSession, error) {
	if at.Web {
		row, err := q.GetWebSessionStart(ctx, db.GetWebSessionStartParams{UserID: at.UserID, SessionID: at.SessionID})
		if err != nil {
			return bearerSession{}, err
		}
		if !row.Live || !row.StartedAt.Valid {
			return bearerSession{}, errCredentialsRevoked()
		}
		return bearerSession{signedInAt: row.StartedAt.Time}, nil
	}
	d, err := q.GetDeviceSession(ctx, at.SessionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return bearerSession{}, errCredentialsRevoked()
	}
	if err != nil {
		return bearerSession{}, err
	}
	if d.UserID != at.UserID || d.RevokedAt.Valid {
		return bearerSession{}, errCredentialsRevoked()
	}
	out := bearerSession{clientID: d.ClientID, deploymentID: d.DeploymentID}
	if d.SignedInAt.Valid {
		out.signedInAt = d.SignedInAt.Time
	}
	return out, nil
}

// StepUp turns one proof into a step-up token for the bearer's session
// (POST /me/step-up). Under the account's row lock: a browser token older
// than the last credential change is refused (requireCurrentCredentials),
// the session must still be live, the proof must be one the account takes
// (else 403 proof_required naming them), and it is weighed against the
// second-factor lockout (weighProof): a wrong one is counted and committed,
// the tenth locks the account's proofs for fifteen minutes (429
// second_factor_locked), a right one starts the count over.
func (s *AuthService) StepUp(ctx context.Context, userID string, p StepUpProof) (StepUpGrant, error) {
	at, err := stepUpBearer(ctx, userID)
	if err != nil {
		return StepUpGrant{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return StepUpGrant{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.q.WithTx(tx)
	if err := requireCurrentCredentials(ctx, q); err != nil {
		return StepUpGrant{}, err
	}
	if _, err := liveBearerSession(ctx, q, at); err != nil {
		return StepUpGrant{}, err
	}
	u, err := q.GetUserForUpdate(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && u.DeletedAt.Valid) {
		return StepUpGrant{}, ErrNotFound
	}
	if err != nil {
		return StepUpGrant{}, err
	}
	method, check, err := s.proofCheck(ctx, q, u, at, p)
	if err != nil {
		return StepUpGrant{}, err
	}
	v, err := s.weighProof(ctx, q, u, check)
	if err != nil {
		return StepUpGrant{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return StepUpGrant{}, err
	}
	s.signInMailer().kick(v.queued)
	if v.locked != nil {
		return StepUpGrant{}, v.locked
	}
	if !v.ok {
		return StepUpGrant{}, wrongProof(method)
	}
	return s.mintStepUp(at, method, p.Action)
}

// proofCheck picks the proof p offers that u takes on the bearer's channel
// and answers its method and the check weighProof runs in q's transaction.
// An account with a second factor takes only that factor; one without takes
// its password, a code mailed to its address for the named action, or on
// the app a fresh token of a provider it is linked to.
func (s *AuthService) proofCheck(ctx context.Context, q *db.Queries, u db.User, at auth.AccessToken, p StepUpProof) (string, func() (bool, error), error) {
	channel := SignInChannelWeb
	if !at.Web {
		channel = SignInChannelNative
	}
	m := s.signInMethods(u, channel)
	takes := func(proof string) bool { return slices.Contains(m.Proofs, proof) }
	switch {
	case takes(ProofTOTP):
		if strings.TrimSpace(p.Code) == "" {
			return "", nil, errProofRequiredFor(m)
		}
		return ProofTOTP, func() (bool, error) { return s.secondFactorMatchesQ(ctx, q, u, p.Code) }, nil
	case p.Password != "" && takes(ProofPassword):
		return ProofPassword, func() (bool, error) {
			return u.PasswordHash.Valid && auth.CheckPassword(u.PasswordHash.String, p.Password), nil
		}, nil
	case strings.TrimSpace(p.Code) != "" && takes(ProofEmailCode):
		if !mail.IsStepUpAction(p.Action) {
			return "", nil, Invalid("action không hợp lệ")
		}
		return ProofEmailCode, func() (bool, error) { return matchStepUpCode(ctx, q, u.ID, p.Action, p.Code) }, nil
	case p.Provider != nil && takes(p.Provider.Provider):
		return p.Provider.Provider, func() (bool, error) { return s.matchProviderProof(ctx, u, *p.Provider), nil }, nil
	}
	return "", nil, errProofRequiredFor(m)
}

// wrongProof is the refusal of a proof of method that did not match.
func wrongProof(method string) error {
	switch method {
	case ProofPassword:
		return errPasswordIncorrect()
	case ProofTOTP:
		return errMfaCodeIncorrect()
	case ProofEmailCode:
		return errStepUpCodeIncorrect()
	default:
		return errProviderProofInvalid()
	}
}

// matchStepUpCode spends the user's live step-up code when code is it and
// it was asked for action; anything else costs the code one of its five
// attempts. The development code is never accepted: a step-up proves the
// owner, and nothing a deployment configures may stand in for that.
func matchStepUpCode(ctx context.Context, q *db.Queries, userID, action, code string) (bool, error) {
	active, err := q.GetActiveEmailVerificationCode(ctx, db.GetActiveEmailVerificationCodeParams{UserID: userID, Purpose: codePurposeStepUp})
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	sameCode := subtle.ConstantTimeCompare([]byte(hashToken(strings.TrimSpace(code))), []byte(active.CodeHash)) == 1
	if !sameCode || active.Action.String != action {
		return false, q.IncrementEmailVerificationCodeAttempts(ctx, active.ID)
	}
	return true, q.MarkEmailVerificationCodeUsed(ctx, active.ID)
}

// matchProviderProof: the token verifies (signature, audience, nonce), is of
// the subject u is linked to, and was issued within providerProofMaxAge.
func (s *AuthService) matchProviderProof(ctx context.Context, u db.User, p ProviderProof) bool {
	verify := s.proofVerifiers[p.Provider]
	linked, _ := linkedSubject(u, p.Provider)
	if verify == nil || !linked.Valid {
		return false
	}
	sub, iat, err := verify(ctx, p.Token, p.Nonce)
	if err != nil {
		return false
	}
	age := s.now().Sub(iat)
	return sub == linked.String && age < providerProofMaxAge && age > -time.Minute
}

// mintStepUp seals the token of a proof of method that passed; action is
// the one a mailed code named, and binds the token only when the code bought
// it.
func (s *AuthService) mintStepUp(at auth.AccessToken, method, action string) (StepUpGrant, error) {
	now := s.now()
	c := stepUpClaims{
		UserID: at.UserID, SessionID: at.SessionID, Web: at.Web, Method: method,
		IssuedAt: now.Unix(), ExpiresAt: now.Add(stepUpTokenTTL).Unix(),
	}
	if method == ProofEmailCode {
		c.Action = action
	}
	raw, err := json.Marshal(c)
	if err != nil {
		return StepUpGrant{}, err
	}
	sealed, err := s.sealer.SealFor(auth.PurposeStepUp, string(raw))
	if err != nil {
		return StepUpGrant{}, err
	}
	return StepUpGrant{Token: sealed, ExpiresAt: time.Unix(c.ExpiresAt, 0).UTC(), Method: method}, nil
}

// requireStepUp is the gate of every command that takes a step-up token: a
// browser token older than the account's last credential change is refused
// (401), the bearer's session must still be live (401: a session that was
// signed out or revoked takes its tokens with it), and the token must be one
// this server sealed for step_up, for this account and this very session,
// not expired, and — when a mailed code bought it — for one of actions, the
// step-up actions the command is (a code's mail names what it allows) — else
// 403 proof_required naming the proofs the account takes. A token is not
// spent by use: the same one serves its ten minutes.
func (s *AuthService) requireStepUp(ctx context.Context, q *db.Queries, userID, token string, actions ...string) error {
	at, err := stepUpBearer(ctx, userID)
	if err != nil {
		return err
	}
	if err := requireCurrentCredentials(ctx, q); err != nil {
		return err
	}
	if _, err := liveBearerSession(ctx, q, at); err != nil {
		return err
	}
	if s.stepUpTokenFor(at, token, actions) {
		return nil
	}
	return s.proofRequired(ctx, q, userID)
}

// linkAction and unlinkAction are the step-up actions of linking and
// unlinking provider.
func linkAction(provider string) string {
	if provider == ProviderApple {
		return mail.StepUpActionLinkApple
	}
	return mail.StepUpActionLinkGoogle
}

func unlinkAction(provider string) string {
	if provider == ProviderApple {
		return mail.StepUpActionUnlinkApple
	}
	return mail.StepUpActionUnlinkGoogle
}

// stepUpTokenFor opens token and holds it to at's account and session, and a
// token a mailed code bought to one of actions.
func (s *AuthService) stepUpTokenFor(at auth.AccessToken, token string, actions []string) bool {
	if token == "" {
		return false
	}
	raw, err := s.sealer.OpenFor(auth.PurposeStepUp, token)
	if err != nil {
		return false
	}
	var c stepUpClaims
	if err := json.Unmarshal([]byte(raw), &c); err != nil {
		return false
	}
	if c.Method == ProofEmailCode && !slices.Contains(actions, c.Action) {
		return false
	}
	return c.UserID == at.UserID && c.SessionID == at.SessionID && c.Web == at.Web && s.now().Unix() < c.ExpiresAt
}

// proofRequired is proof_required naming the proofs userID's account takes
// on the bearer's channel; a bare one when the account cannot be read.
func (s *AuthService) proofRequired(ctx context.Context, q *db.Queries, userID string) error {
	u, err := q.GetUserByID(ctx, userID)
	if err != nil {
		return errProofRequired()
	}
	return errProofRequiredFor(s.signInMethods(u, bearerChannel(ctx)))
}

// SendStepUpCode mails a six-digit step-up code naming action to the
// account's own address (POST /me/step-up/email-code), for an account whose
// proofs include email_code (one without a second factor). One a minute and
// five a day per account (429 rate_limited with retry_after), ten minutes
// each, five attempts; the mail names the action, the device and the
// address it was asked from, and warns not to share it. It is never the
// development code.
func (s *AuthService) SendStepUpCode(ctx context.Context, userID, action string) error {
	if !mail.IsStepUpAction(action) {
		return Invalid("action không hợp lệ")
	}
	at, err := stepUpBearer(ctx, userID)
	if err != nil {
		return err
	}
	if s.out == nil {
		return errors.New("step-up code: mail is not configured")
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.q.WithTx(tx)
	if err := requireCurrentCredentials(ctx, q); err != nil {
		return err
	}
	if _, err := liveBearerSession(ctx, q, at); err != nil {
		return err
	}
	// The row lock queues two sends of one account, so the gates below see
	// each other's codes.
	u, err := q.GetUserForUpdate(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && u.DeletedAt.Valid) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if m := s.signInMethods(u, bearerChannel(ctx)); !slices.Contains(m.Proofs, ProofEmailCode) {
		return errProofRequiredFor(m)
	}
	now := s.now()
	latest, err := q.GetLatestEmailVerificationCode(ctx, db.GetLatestEmailVerificationCodeParams{UserID: userID, Purpose: codePurposeStepUp})
	if err == nil && now.Sub(latest.CreatedAt.Time) < stepUpCodeResend {
		return errCodeTooSoon(stepUpCodeResend - now.Sub(latest.CreatedAt.Time))
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	day, err := q.CountEmailVerificationCodesSince(ctx, db.CountEmailVerificationCodesSinceParams{
		UserID: userID, Purpose: codePurposeStepUp, CreatedAt: pgtype.Timestamptz{Time: now.Add(-24 * time.Hour), Valid: true},
	})
	if err != nil {
		return err
	}
	if day.N >= stepUpCodeDailyCap {
		return errCodeDailyCap(day.Oldest.Time.Add(24 * time.Hour).Sub(now))
	}
	code, err := generateCode()
	if err != nil {
		return err
	}
	if _, err := q.CreateEmailVerificationCode(ctx, db.CreateEmailVerificationCodeParams{
		ID: util.NewID(), UserID: userID, CodeHash: hashToken(code),
		ExpiresAt: pgtype.Timestamptz{Time: now.Add(stepUpCodeTTL), Valid: true},
		CreatedAt: pgtype.Timestamptz{Time: now, Valid: true},
		Purpose:   codePurposeStepUp, Action: pgtype.Text{String: action, Valid: true},
	}); err != nil {
		return err
	}
	meta := sessionMetaFrom(ctx)
	msg, err := s.render.StepUpCode(u.Email, u.Locale, u.ID, mail.StepUpCodeData{
		Code: code, Expires: stepUpCodeTTL, Action: action,
		Device: mail.SafeField(meta.UserAgent), IP: mail.SafeField(meta.IP), At: now,
	})
	if err != nil {
		return err
	}
	if _, err := s.out.Enqueue(ctx, q, msg); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	s.out.Kick()
	return nil
}

// OwnerProof is how an owner proves it is them before handing an
// organization over (POST /orgs/{org}/transfer-ownership, the invitation
// switch): a step-up token, or the password shipped apps still send.
type OwnerProof struct {
	StepUpToken string
	// Password is the legacy proof, kept for shipped apps until
	// legacyProofReviewBy; it is weighed against the lockout like a step-up.
	Password string
}

// proveOwner checks an OwnerProof for userID. Without a proof the answer is
// proof_required naming what the account takes (it replaces the old
// password_required: an account without a password proves itself with a
// mailed code). A nil service (proofs not wired) takes nothing.
func (s *AuthService) proveOwner(ctx context.Context, userID string, p OwnerProof) error {
	if s == nil {
		return errProofRequired()
	}
	if p.StepUpToken != "" {
		return s.requireStepUp(ctx, s.q, userID, p.StepUpToken, mail.StepUpActionTransferOwnership)
	}
	u, err := s.q.GetUserByID(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if p.Password == "" || !u.PasswordHash.Valid {
		return errProofRequiredFor(s.signInMethods(u, bearerChannel(ctx)))
	}
	if err := requireCurrentCredentials(ctx, s.q); err != nil {
		return err
	}
	return s.legacyPassword(ctx, userID, p.Password)
}

// legacyPassword weighs a password a shipped app sends in place of a step-up
// token against the same lockout a step-up has; the caller has passed
// requireCurrentCredentials.
func (s *AuthService) legacyPassword(ctx context.Context, userID, password string) error {
	out, err := s.weighProofOnce(ctx, userID, func(_ *db.Queries, u db.User) (bool, error) {
		return u.PasswordHash.Valid && auth.CheckPassword(u.PasswordHash.String, password), nil
	})
	if err != nil {
		return err
	}
	if !out.ok {
		return errPasswordIncorrect()
	}
	return nil
}

// proveDeletion is POST /me/delete's proof: a step-up token, or the one
// proof shipped apps send (until legacyProofReviewBy) — the password when
// the account has one, else a second-factor code when it is on, else the
// account's address typed again. The password and the code are weighed
// against the lockout; a typed address is no secret and is not counted. A
// request that carries none is proof_required.
func (s *AuthService) proveDeletion(ctx context.Context, u db.User, in DeleteAccountInput) error {
	if in.StepUpToken != "" {
		return s.requireStepUp(ctx, s.q, u.ID, in.StepUpToken, mail.StepUpActionDeleteAccount)
	}
	if in.Password == "" && strings.TrimSpace(in.Code) == "" && strings.TrimSpace(in.EmailConfirmation) == "" {
		return errProofRequiredFor(s.signInMethods(u, bearerChannel(ctx)))
	}
	if err := requireCurrentCredentials(ctx, s.q); err != nil {
		return err
	}
	switch {
	case u.PasswordHash.Valid:
		return s.legacyPassword(ctx, u.ID, in.Password)
	case u.MfaEnabledAt.Valid:
		out, err := s.weighProofOnce(ctx, u.ID, func(q *db.Queries, locked db.User) (bool, error) {
			return s.secondFactorMatchesQ(ctx, q, locked, in.Code)
		})
		if err != nil {
			return err
		}
		if !out.ok {
			return errMfaCodeIncorrect()
		}
		return nil
	default:
		if !strings.EqualFold(strings.TrimSpace(in.EmailConfirmation), u.Email) {
			return errEmailConfirmationMismatch()
		}
		return nil
	}
}
