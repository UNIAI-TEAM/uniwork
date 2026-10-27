package service

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/mail"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The app's own sign-in screen (ADR 0047 §1, §8; spec §3.6): email and
// password, the second factor, Google through its SDK, Apple through the
// iPhone's sheet, sign-up by email, and the choice screen of a provider
// sign-in that found no account — all inside the app, with the browser's
// PKCE sign-in kept as the way around. Every door is public, takes only the
// native sign-in clients (NATIVE_SIGN_IN_CLIENTS: the desktop apps and Office
// sign in through the web page) and answers one result, NativeSignInResult.
// A door that ends in a session issues the app's device session
// (issueDeviceSession) in the transaction that audits the sign-in
// (auth.login_succeeded, via the door), and tells the owner whenever the
// account had a session or a device before. Accounts are found with the rules
// every provider shares (resolveIdentity); what the browser's doors answer
// with a cookie, these answer in JSON, bound to the app (a native challenge,
// a native ticket).

// The statuses of a native sign-in.
const (
	NativeSignedIn          = "signed_in"
	NativeMFARequired       = "mfa_required"
	NativeIdentityUnmatched = "identity_unmatched"
	NativeLinkRequired      = "link_required"
)

// The ways into a native sign-in, as its audit row's via names them.
const (
	nativeViaPassword = "password"
	nativeViaMFA      = "mfa"
	nativeViaRegister = "register"
)

// NativeClient is what every native door is told about the app that asks:
// its public client id and deployment, which the door holds to the native
// allowlists, and the device's own description, which the device session
// and the owner's mails show.
type NativeClient struct {
	ClientID     string
	DeploymentID string
	DeviceLabel  string
	Platform     string
	Build        string
}

func (c NativeClient) device() nativeDevice {
	return nativeDevice{
		ClientID: c.ClientID, DeploymentID: c.DeploymentID, Label: sanitizeDesktopLabel(c.DeviceLabel),
		Platform: sanitizeMetadata(c.Platform), Build: sanitizeMetadata(c.Build),
	}
}

// challenge is the challenge a native first factor answers with: bound to
// this app's client and deployment, so only POST /auth/native/mfa from the
// same app takes it (spec §3.3).
func (c NativeClient) challenge() auth.MFAChallenge {
	return auth.MFAChallenge{Channel: auth.MFAChannelNative, ClientID: c.ClientID, DeploymentID: c.DeploymentID}
}

// ticket is the binding of this app's sign-in tickets: issued or presented
// with the raw nonce the app handed the provider's sheet.
func (c NativeClient) ticket(nonce string) TicketBinding {
	return TicketBinding{Channel: SignInChannelNative, ClientID: c.ClientID, DeploymentID: c.DeploymentID, Nonce: nonce}
}

// deviceName names the device in the owner's mails (spec §3.6): its label
// and its platform, and the deployment it signed in through when that is not
// the one most servers have — "iPhone của An (ios)", "android (beta)". The
// address is the request's, beside it in every mail.
func (c NativeClient) deviceName() string {
	d := c.device()
	name, extra := d.Label, []string{}
	switch {
	case name == "":
		name = d.Platform
	case d.Platform != "":
		extra = append(extra, d.Platform)
	}
	if d.DeploymentID != "" && d.DeploymentID != "default" {
		extra = append(extra, sanitizeMetadata(d.DeploymentID))
	}
	if len(extra) > 0 {
		name = strings.TrimSpace(name + " (" + strings.Join(extra, ", ") + ")")
	}
	return mail.SafeField(name)
}

// context puts the device's name where every notice a sign-in queues reads
// the device from (the link, reclaim and lockout mails), in place of the
// HTTP client's user agent; the address stays the request's.
func (c NativeClient) context(ctx context.Context) context.Context {
	meta := sessionMetaFrom(ctx)
	meta.UserAgent = c.deviceName()
	return WithSessionMeta(ctx, meta)
}

// NativeSignInResult is every native door's answer (spec §3.6): a device
// session (signed_in), the second factor still owed (mfa_required, with the
// app's challenge token), or a sign-in ticket for the app's choice screen
// (identity_unmatched, link_required), sealed and bound to the app's nonce,
// with what the screen shows of the identity.
type NativeSignInResult struct {
	Status  string
	Session DesktopSession
	// Reclaimed: the sign-in took the account back from whoever registered
	// the address before proving it; the app says so once.
	Reclaimed bool
	// LinkSkipped, after a second factor whose challenge carried a pending
	// provider link: why the identity was not linked (spec §3.3).
	LinkSkipped string
	MFAToken    string
	Ticket      string
	Identity    SignInTicket
}

// ErrNativeClient: the app is not one of the native sign-in clients, or its
// deployment is not configured.
var ErrNativeClient = errors.New("native sign-in client not allowed")

func errNativeClient() error {
	return CodedError{Code: "invalid_request", Status: http.StatusBadRequest, Msg: "invalid native sign-in client", Err: ErrNativeClient}
}

// ErrNativeProviderToken: the provider token the app sent did not verify
// (signature, audience, the app as authorized party, freshness, nonce).
var ErrNativeProviderToken = errors.New("provider_token_invalid")

// errNativeProviderToken is 401: nobody is signed in yet, and the token is
// the credential the door was offered.
func errNativeProviderToken() error {
	return CodedError{Code: "provider_token_invalid", Status: http.StatusUnauthorized, Msg: "the provider sign-in did not verify; sign in with it again", Err: ErrNativeProviderToken}
}

// NativeSignInService runs the app's own sign-in doors on AuthService's
// accounts, challenges, tickets and mail, and DesktopAuthService's device
// sessions.
type NativeSignInService struct {
	pool    *pgxpool.Pool
	q       *db.Queries
	auth    *AuthService
	desktop *DesktopAuthService
	tickets *SignInTicketService
	log     *slog.Logger
}

func NewNativeSignInService(pool *pgxpool.Pool, q *db.Queries, a *AuthService, desktop *DesktopAuthService, tickets *SignInTicketService) *NativeSignInService {
	return &NativeSignInService{pool: pool, q: q, auth: a, desktop: desktop, tickets: tickets, log: slog.Default()}
}

// GoogleEnabled: the app's Google ID tokens can be checked
// (GOOGLE_NATIVE_CLIENT_IDS).
func (s *NativeSignInService) GoogleEnabled() bool { return s != nil && s.auth.GoogleNativeEnabled() }

// AppleEnabled: the app's Apple identity tokens can be checked
// (APPLE_SIWA_AUDIENCES).
func (s *NativeSignInService) AppleEnabled() bool {
	return s != nil && s.auth != nil && s.auth.apple.NativeEnabled()
}

// door holds c to the native allowlists: a native sign-in client that is
// also a configured client, and a configured deployment.
func (s *NativeSignInService) door(c NativeClient) error {
	if !s.desktop.nativeClientAllowed(c.ClientID, c.DeploymentID) {
		return errNativeClient()
	}
	return nil
}

// Password is POST /auth/native/password: the account's address and
// password. A second factor on the account answers the app's challenge; a
// wrong address or password is 401 invalid_credentials, whichever it was.
func (s *NativeSignInService) Password(ctx context.Context, email, password string, c NativeClient) (NativeSignInResult, error) {
	if err := s.door(c); err != nil {
		return NativeSignInResult{}, err
	}
	ctx = c.context(ctx)
	u, err := s.q.GetUserByEmail(ctx, strings.ToLower(strings.TrimSpace(email)))
	if errors.Is(err, pgx.ErrNoRows) {
		return NativeSignInResult{}, ErrInvalidCredentials
	}
	if err != nil {
		return NativeSignInResult{}, err
	}
	if !u.PasswordHash.Valid || !auth.CheckPassword(u.PasswordHash.String, password) {
		s.auth.recordAuth(ctx, audit.ActionAuthLoginFailed, u.ID, map[string]any{"reason": "bad_password", "channel": SignInChannelNative})
		return NativeSignInResult{}, ErrInvalidCredentials
	}
	if u.MfaEnabledAt.Valid {
		return s.challenge(ctx, u, c)
	}
	return s.signInAs(ctx, u, c, map[string]any{"via": nativeViaPassword})
}

// Register is POST /auth/native/register: the web's sign-up by email (the
// same checks, 409 conflict on an address an account holds), ending in the
// app's device session on the new, unverified account; the code that
// proves the address is mailed once it committed.
func (s *NativeSignInService) Register(ctx context.Context, email, password, displayName, locale string, c NativeClient) (NativeSignInResult, error) {
	if err := s.door(c); err != nil {
		return NativeSignInResult{}, err
	}
	ctx = c.context(ctx)
	p, err := newPasswordAccount(email, password, displayName, locale)
	if err != nil {
		return NativeSignInResult{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return NativeSignInResult{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.q.WithTx(tx)
	u, err := createPasswordAccount(ctx, q, p)
	if err != nil {
		return NativeSignInResult{}, err
	}
	sess, _, err := s.open(ctx, q, u, c, map[string]any{"via": nativeViaRegister})
	if err != nil {
		return NativeSignInResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		if isUniqueViolation(err) {
			return NativeSignInResult{}, ErrConflict
		}
		return NativeSignInResult{}, err
	}
	s.auth.sendVerificationAfterSignUp(ctx, u.ID)
	return NativeSignInResult{Status: NativeSignedIn, Session: sess}, nil
}

// VerifyMFA is POST /auth/native/mfa: the app's second step. Only a native
// challenge minted for this very client and deployment is taken; any other
// (the browser's, another app's) is refused like a wrong code before the
// account is read, so it costs nothing from the lockout. Then the step the
// browser's shares (secondStep): the lockout (429 second_factor_locked), and
// the pending provider link written with the session, or skipped with
// LinkSkipped saying why.
func (s *NativeSignInService) VerifyMFA(ctx context.Context, mfaToken, code string, c NativeClient) (NativeSignInResult, error) {
	if err := s.door(c); err != nil {
		return NativeSignInResult{}, err
	}
	ctx = c.context(ctx)
	ch, err := s.auth.minter.ParseMFA(mfaToken)
	if err != nil || ch.Channel != auth.MFAChannelNative || ch.ClientID != c.ClientID || ch.DeploymentID != c.DeploymentID {
		return NativeSignInResult{}, ErrInvalidCredentials
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return NativeSignInResult{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.q.WithTx(tx)
	step, err := s.auth.secondStep(ctx, tx, q, ch, code)
	if err != nil {
		return NativeSignInResult{}, err
	}
	sess, had, err := s.open(ctx, q, step.user, c, map[string]any{"via": nativeViaMFA, "mfa": step.mfa})
	if err != nil {
		return NativeSignInResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return NativeSignInResult{}, err
	}
	s.auth.signInMailer().kick(step.link.queued)
	s.tell(ctx, step.user, c, had)
	return NativeSignInResult{Status: NativeSignedIn, Session: sess, LinkSkipped: step.link.skipped}, nil
}

// NativeProviderSignIn is what the app sends after a provider's own sheet
// (Google's SDK, Apple's sheet): the provider's token and the raw nonce whose
// SHA-256 it must carry, Apple's one-time code and, on the first sign-in
// only, the name Apple's sheet shared; and the intent of the screen it came
// from (sign_in, or sign_up from the app's register screen).
type NativeProviderSignIn struct {
	Token             string
	Nonce             string
	AuthorizationCode string
	GivenName         string
	FamilyName        string
	Intent            string
	Locale            string
	Client            NativeClient
}

// nativeIntent reads the intent a provider door was sent: sign_in when
// none.
func nativeIntent(raw string) (string, error) {
	switch raw {
	case "", SignInIntentSignIn:
		return SignInIntentSignIn, nil
	case SignInIntentSignUp:
		return SignInIntentSignUp, nil
	default:
		return "", Invalid("intent phải là sign_in hoặc sign_up")
	}
}

// Google is POST /auth/native/google: an ID token the app's Google SDK just
// returned, checked by the app's verifier (an app client as azp, the hash of
// the nonce, ten minutes at most; 401 provider_token_invalid otherwise), then
// the provider sign-in every native door shares (providerSignIn).
func (s *NativeSignInService) Google(ctx context.Context, in NativeProviderSignIn) (NativeSignInResult, error) {
	if err := s.door(in.Client); err != nil {
		return NativeSignInResult{}, err
	}
	intent, err := nativeIntent(in.Intent)
	if err != nil {
		return NativeSignInResult{}, err
	}
	if !s.GoogleEnabled() {
		// The handler answers 503 before this.
		return NativeSignInResult{}, errors.New("google native sign-in is not configured")
	}
	claims, err := s.auth.googleNative.Verify(ctx, in.Token, in.Nonce)
	if err != nil {
		s.log.Info("native google sign-in refused", "reason", googleTokenReason(err))
		return NativeSignInResult{}, errNativeProviderToken()
	}
	return s.providerSignIn(ctx, googleIdentity(claims), in, intent)
}

// Apple is POST /auth/native/apple: an identity token the iPhone's Apple
// sheet just returned, checked by the app's verifier (its bundle ids, the
// hash of the nonce; 401 provider_token_invalid otherwise), with the consent
// the one-time code redeems for, then the shared provider sign-in. Unlike
// the legacy route, an identity that matches no account answers a ticket for
// the choice screen. A refusal gives the consent back to Apple unless the
// Apple ID opens an account.
func (s *NativeSignInService) Apple(ctx context.Context, in NativeProviderSignIn) (NativeSignInResult, error) {
	if err := s.door(in.Client); err != nil {
		return NativeSignInResult{}, err
	}
	intent, err := nativeIntent(in.Intent)
	if err != nil {
		return NativeSignInResult{}, err
	}
	if !s.AppleEnabled() {
		return NativeSignInResult{}, errors.New("apple native sign-in is not configured")
	}
	id, err := s.auth.apple.nativeIdentity(ctx, in.Token, in.Nonce, in.AuthorizationCode, in.GivenName, in.FamilyName)
	if err != nil {
		s.log.Info("native apple sign-in refused", "reason", appleTokenReason(err))
		return NativeSignInResult{}, errNativeProviderToken()
	}
	res, err := s.providerSignIn(ctx, id, in, intent)
	if err != nil {
		s.auth.apple.giveBack(ctx, id)
	}
	return res, err
}

func googleTokenReason(err error) string {
	var te auth.GoogleTokenError
	if errors.As(err, &te) {
		return te.Reason
	}
	return "unknown"
}

func appleTokenReason(err error) string {
	var te auth.AppleTokenError
	if errors.As(err, &te) {
		return te.Reason
	}
	return "unknown"
}

// providerSignIn is the app's provider sign-in once the token passed (ADR
// 0047 §2), resolveIdentity's answer acted on in one transaction, as the
// browser's webProviderSignIn does:
//
//   - matched: the device session; with a second factor on the account, the
//     app's challenge instead, nothing written;
//   - unmatched: a native ticket for the choice screen (identity_unmatched);
//     from the register screen (intent sign_up) the account is created at
//     once, its address verified only when the provider owns it (else a code
//     is mailed);
//   - link_required: a native ticket too (link_required);
//   - reclaim: the account registered with the address before it was proved
//     is taken back, its second factor never asked, and signed in;
//   - link: the identity joins the verified account and it signs in; with a
//     second factor on, the challenge carries the identity and the link is
//     written once the factor passed (VerifyMFA).
//
// A refusal of the resolver is its own code (sign_in_email_unverified,
// sign_in_account_unverified, sign_in_account_conflict). An Apple identity's
// consent is kept by the account the sign-in opens, rides in the ticket or
// the pending link, and is not written while a second factor is owed.
func (s *NativeSignInService) providerSignIn(ctx context.Context, id ProviderIdentity, in NativeProviderSignIn, intent string) (NativeSignInResult, error) {
	c := in.Client
	ctx = c.context(ctx)
	m := s.auth.signInMailer()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return NativeSignInResult{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.q.WithTx(tx)
	res, err := resolveIdentity(ctx, q, id)
	if err != nil {
		return NativeSignInResult{}, err
	}
	var (
		u       db.User
		how     string
		queued  bool
		reclaim reclaimed
	)
	switch res.kind {
	case identityMatched:
		u, how = res.user, "subject"
		if u.MfaEnabledAt.Valid {
			return s.challenge(ctx, u, c)
		}
		if err := keepAppleConsent(ctx, q, u.ID, id); err != nil {
			return NativeSignInResult{}, err
		}
	case identityUnmatched:
		if intent != SignInIntentSignUp {
			return s.ticketAnswer(id, TicketKindUnmatched, intent, c, in.Nonce)
		}
		if u, err = createProviderUser(ctx, q, id, in.Locale, id.EmailAuthoritative); err != nil {
			return NativeSignInResult{}, err
		}
		if err := keepAppleConsent(ctx, q, u.ID, id); err != nil {
			return NativeSignInResult{}, err
		}
		how = "created"
	case identityReclaim:
		if reclaim, err = reclaimAccount(ctx, q, res.user, id, m, c.deviceName(), linkViaReclaim); err != nil {
			return NativeSignInResult{}, err
		}
		u, queued, how = reclaim.user, reclaim.queued, "reclaim"
	case identityLink:
		if res.user.MfaEnabledAt.Valid {
			sess, err := s.auth.challengeWithPendingLink(ctx, res.user, id, linkViaEmailMatch, c.challenge())
			if err != nil {
				return NativeSignInResult{}, err
			}
			return NativeSignInResult{Status: NativeMFARequired, MFAToken: sess.MFAToken}, nil
		}
		if u, queued, err = linkByEmail(ctx, q, res.user, id, m, c.deviceName()); err != nil {
			return NativeSignInResult{}, err
		}
		how = "email"
	default: // identityLinkRequired
		return s.ticketAnswer(id, TicketKindLinkRequired, intent, c, in.Nonce)
	}
	sess, had, err := s.open(ctx, q, u, c, map[string]any{"via": id.Provider, "account": how})
	if err != nil {
		return NativeSignInResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		if isUniqueViolation(err) {
			return NativeSignInResult{}, errSignInAccountConflict()
		}
		return NativeSignInResult{}, err
	}
	m.kick(queued)
	out := NativeSignInResult{Status: NativeSignedIn, Session: sess}
	switch how {
	case "reclaim":
		observeOfficeLeaseRevokes(OfficeLeaseRevokeSessionRevoked, reclaim.leases)
		s.auth.apple.revokeAfterCommit(ctx, u.ID, reclaim.appleClientID, reclaim.appleToken)
		out.Reclaimed = true
	case "created":
		if !u.EmailVerifiedAt.Valid {
			s.auth.sendVerificationAfterSignUp(ctx, u.ID)
		}
	default:
		s.tell(ctx, u, c, had)
	}
	return out, nil
}

// ticketAnswer answers a provider sign-in that found no account to sign in
// to with the app's ticket for the choice screen: bound to the app's client,
// deployment and nonce, and what the screen shows of the identity. Nothing
// was written.
func (s *NativeSignInService) ticketAnswer(id ProviderIdentity, kind, intent string, c NativeClient, nonce string) (NativeSignInResult, error) {
	sealed, err := s.auth.issueSignInTicket(id, kind, intent, c.ticket(nonce))
	if err != nil {
		return NativeSignInResult{}, err
	}
	status := NativeIdentityUnmatched
	if kind == TicketKindLinkRequired {
		status = NativeLinkRequired
	}
	return NativeSignInResult{
		Status: status, Ticket: sealed,
		Identity: SignInTicket{Provider: id.Provider, Kind: kind, Email: id.Email, Name: id.Name, PrivateRelay: id.PrivateRelay},
	}, nil
}

// challenge answers a first factor that passed on an account with a second
// factor: the app's challenge token, bound to this app.
func (s *NativeSignInService) challenge(ctx context.Context, u db.User, c NativeClient) (NativeSignInResult, error) {
	sess, err := s.auth.challengeOn(ctx, u, c.challenge())
	if err != nil {
		return NativeSignInResult{}, err
	}
	return NativeSignInResult{Status: NativeMFARequired, MFAToken: sess.MFAToken}, nil
}

// signInAs opens the app's device session on u in a transaction of its own
// (a door that writes nothing else), audited with meta, and tells the owner.
func (s *NativeSignInService) signInAs(ctx context.Context, u db.User, c NativeClient, meta map[string]any) (NativeSignInResult, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return NativeSignInResult{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.q.WithTx(tx)
	sess, had, err := s.open(ctx, q, u, c, meta)
	if err != nil {
		return NativeSignInResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return NativeSignInResult{}, err
	}
	s.tell(ctx, u, c, had)
	return NativeSignInResult{Status: NativeSignedIn, Session: sess}, nil
}

// open issues the app's device session on u in q's transaction and writes
// its auth.login_succeeded row (meta names the door: via, and what else it
// knows), with the channel. It reports whether the account had a session or
// a device before this one, read before this one is written: refresh tokens
// are never deleted, so any session the account ever had counts.
func (s *NativeSignInService) open(ctx context.Context, q *db.Queries, u db.User, c NativeClient, meta map[string]any) (DesktopSession, bool, error) {
	n, err := q.CountRefreshTokensForUser(ctx, u.ID)
	if err != nil {
		return DesktopSession{}, false, err
	}
	sess, err := s.desktop.issueDeviceSession(ctx, q, u.ID, c.device())
	if err != nil {
		return DesktopSession{}, false, err
	}
	m := map[string]any{"channel": SignInChannelNative}
	for k, v := range meta {
		m[k] = v
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: audit.NoOrganization, Actor: audit.User(u.ID),
		Action: audit.ActionAuthLoginSucceeded, ResourceType: "user", ResourceID: u.ID,
		Metadata: m,
	}); err != nil {
		return DesktopSession{}, false, err
	}
	return sess, n > 0, nil
}

// tell sends the owner the new-login alert of a session the app opened, when
// the account had one before (spec §3.6): an app's sign-in is news whatever
// device it says it is. A new account hears nothing; a reclaim ended every
// session before it and told the owner already.
func (s *NativeSignInService) tell(ctx context.Context, u db.User, c NativeClient, had bool) {
	if had {
		s.auth.signInMailer().tellAppSignIn(ctx, s.q, u, c.deviceName())
	}
}
