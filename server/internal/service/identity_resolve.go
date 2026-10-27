package service

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The sign-in providers an identity can come from.
const (
	ProviderGoogle = "google"
	ProviderApple  = "apple"
)

// Caps on what a provider says about the person, as the profile stores it.
const (
	maxProviderNameRunes  = maxDisplayNameRunes
	maxProviderPictureLen = 512
)

// ProviderIdentity is a person as a sign-in provider vouches for them, after
// the provider's token passed its checks (ADR 0047). Every provider reaches
// accounts through resolveIdentity with one of these, so the matching rules
// live in one place.
//
// The JSON names are what a sealed blob carries it under (the pending link
// of a challenge token, spec §3.3; the sign-in ticket, spec §3.2).
type ProviderIdentity struct {
	Provider      string `json:"provider"` // ProviderGoogle | ProviderApple
	Subject       string `json:"subject"`
	Email         string `json:"email"` // lower + trim
	EmailVerified bool   `json:"email_verified"`
	// EmailAuthoritative: the provider owns the address's domain (Gmail or
	// the Workspace hd; iCloud or Apple's relay), so its word on the address
	// is the mailbox's. Only such an address links or reclaims by itself.
	EmailAuthoritative bool   `json:"email_authoritative,omitempty"`
	PrivateRelay       bool   `json:"private_relay,omitempty"`   // Apple Hide My Email
	Name               string `json:"name,omitempty"`            // at most maxProviderNameRunes
	Picture            string `json:"picture,omitempty"`         // Google, at most maxProviderPictureLen bytes
	AppleClientID      string `json:"apple_client_id,omitempty"` // the audience of an Apple token (bundle id or Services ID)
	AppleRefresh       string `json:"apple_refresh,omitempty"`   // the sealed Apple refresh token, may be empty
}

// emailUsable: the provider vouches for an address that has a mailbox part.
func (id ProviderIdentity) emailUsable() bool {
	at := strings.Index(id.Email, "@")
	return id.EmailVerified && at > 0 && at < len(id.Email)-1
}

const applePrivateRelayDomain = "privaterelay.appleid.com"

// googleAuthoritativeDomains are the consumer domains Google itself owns.
var googleAuthoritativeDomains = map[string]bool{"gmail.com": true, "googlemail.com": true}

// appleAuthoritativeDomains are Apple's own mail domains; relay addresses
// are Apple's too.
var appleAuthoritativeDomains = map[string]bool{"icloud.com": true, "me.com": true, "mac.com": true, applePrivateRelayDomain: true}

func emailDomain(email string) string {
	_, domain, _ := strings.Cut(email, "@")
	return domain
}

func normalizeProviderEmail(email string) string {
	return strings.ToLower(strings.TrimSpace(email))
}

// googleIdentity is a verified Google ID token's person. A Workspace account
// carries hd, its domain: an address in that domain is Google's to vouch for.
func googleIdentity(c auth.GoogleClaims) ProviderIdentity {
	email := normalizeProviderEmail(c.Email)
	domain := emailDomain(email)
	hd := strings.ToLower(strings.TrimSpace(c.HD))
	picture := strings.TrimSpace(c.Picture)
	if len(picture) > maxProviderPictureLen {
		picture = ""
	}
	return ProviderIdentity{
		Provider: ProviderGoogle, Subject: c.Sub, Email: email, EmailVerified: c.EmailVerified,
		EmailAuthoritative: googleAuthoritativeDomains[domain] || (hd != "" && hd == domain),
		Name:               capRunes(strings.Join(strings.Fields(c.Name), " "), maxProviderNameRunes, ""),
		Picture:            picture,
	}
}

// appleIdentity is a verified Apple identity token's person. The name is not
// in the token: the app passes the one Apple's sheet returned on the first
// sign-in, which nothing signs, so it is only a suggestion for a new profile.
func appleIdentity(c auth.AppleClaims, givenName, familyName, sealedRefresh string) ProviderIdentity {
	email := normalizeProviderEmail(c.Email)
	domain := emailDomain(email)
	return ProviderIdentity{
		Provider: ProviderApple, Subject: c.Sub, Email: email, EmailVerified: c.EmailVerified,
		EmailAuthoritative: appleAuthoritativeDomains[domain],
		PrivateRelay:       c.PrivateEmail || domain == applePrivateRelayDomain,
		Name:               capRunes(strings.Join(strings.Fields(givenName+" "+familyName), " "), maxProviderNameRunes, ""),
		AppleClientID:      c.Audience, AppleRefresh: sealedRefresh,
	}
}

// providerDisplayName is the name the provider shared, else the address's
// local part (a relay address gives its alias; the person renames themselves
// in Settings).
func providerDisplayName(name, email string) string {
	name = strings.Join(strings.Fields(name), " ")
	if name == "" {
		name, _, _ = strings.Cut(email, "@")
	}
	return capRunes(name, maxDisplayNameRunes, "")
}

// identityResolution is what resolveIdentity decided for one identity.
type identityResolution int

const (
	// identityMatched: an account is linked to the subject.
	identityMatched identityResolution = iota + 1
	// identityUnmatched: no account has the address.
	identityUnmatched
	// identityReclaim: an account registered the address without proving it,
	// and the provider owns the address: the mailbox's owner takes it back.
	identityReclaim
	// identityLinkRequired: an account has the address, but the identity may
	// join it only once its owner signs in to it (an address the provider
	// does not own, or a subject the owner unlinked).
	identityLinkRequired
	// identityLink: a verified account has the address the provider owns.
	identityLink
)

type resolution struct {
	kind identityResolution
	// user is the account matched, to reclaim, to link or that requires the
	// link; zero when unmatched.
	user db.User
}

var (
	// ErrSignInEmailUnverified: the provider does not vouch for an address.
	ErrSignInEmailUnverified = errors.New("sign_in_email_unverified")
	// ErrSignInAccountUnverified: an account registered the address without
	// proving it, and the provider does not own the address.
	ErrSignInAccountUnverified = errors.New("sign_in_account_unverified")
	// ErrSignInAccountConflict: the address belongs to an account the
	// identity may not join.
	ErrSignInAccountConflict = errors.New("sign_in_account_conflict")
)

func errSignInEmailUnverified() error {
	return CodedError{Code: "sign_in_email_unverified", Status: http.StatusForbidden, Msg: "the provider did not verify an email address", Err: ErrSignInEmailUnverified}
}

// errSignInAccountUnverified points the client at the way to prove the
// mailbox: forgot password takes the account back by its address.
func errSignInAccountUnverified() error {
	return CodedError{Code: "sign_in_account_unverified", Status: http.StatusForbidden, Msg: "an account with this email has not verified it; reset its password to prove the mailbox", Err: ErrSignInAccountUnverified}
}

func errSignInAccountConflict() error {
	return CodedError{Code: "sign_in_account_conflict", Status: http.StatusConflict, Msg: "this email belongs to an account this sign-in cannot join", Err: ErrSignInAccountConflict}
}

func (id ProviderIdentity) subject() pgtype.Text {
	return pgtype.Text{String: id.Subject, Valid: true}
}

// resolveIdentity is the one set of matching rules every provider sign-in
// goes through (ADR 0047 §2, spec §3.1), evaluated in this fixed order:
//
//  1. an account linked to the subject: matched;
//  2. an address the provider does not vouch for: sign_in_email_unverified;
//  3. no account has the address: unmatched;
//  4. the account never proved the address and the provider owns it:
//     reclaim, whatever the account has set up;
//  5. the account never proved it and the provider does not own it:
//     sign_in_account_unverified;
//  6. the account is linked to another subject of this provider:
//     sign_in_account_conflict;
//  7. a private relay address someone holds as an account: conflict;
//  8. the owner unlinked this very subject, or the provider does not own the
//     address: link_required;
//  9. otherwise (verified on both sides, the provider owns it): link.
//
// It only reads; the caller acts on the answer in its transaction.
func resolveIdentity(ctx context.Context, q *db.Queries, id ProviderIdentity) (resolution, error) {
	if id.Subject == "" || (id.Provider != ProviderGoogle && id.Provider != ProviderApple) {
		return resolution{}, errors.New("provider identity without a provider or subject")
	}
	var (
		u   db.User
		err error
	)
	if id.Provider == ProviderGoogle {
		u, err = q.GetUserByGoogleID(ctx, id.subject())
	} else {
		u, err = q.GetUserByAppleID(ctx, id.subject())
	}
	if err == nil {
		return resolution{kind: identityMatched, user: u}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return resolution{}, err
	}
	if !id.emailUsable() {
		return resolution{}, errSignInEmailUnverified()
	}
	u, err = q.GetUserByEmail(ctx, id.Email)
	if errors.Is(err, pgx.ErrNoRows) {
		return resolution{kind: identityUnmatched}, nil
	}
	if err != nil {
		return resolution{}, err
	}
	if !u.EmailVerifiedAt.Valid {
		if id.EmailAuthoritative {
			return resolution{kind: identityReclaim, user: u}, nil
		}
		return resolution{}, errSignInAccountUnverified()
	}
	linked, unlinked := u.GoogleID, u.GoogleUnlinkedSub
	if id.Provider == ProviderApple {
		linked, unlinked = u.AppleID, u.AppleUnlinkedSub
	}
	if linked.Valid {
		return resolution{}, errSignInAccountConflict()
	}
	// A relay address is Apple's alias for this one app: it never names an
	// account someone made another way.
	if id.PrivateRelay {
		return resolution{}, errSignInAccountConflict()
	}
	if (unlinked.Valid && unlinked.String == id.Subject) || !id.EmailAuthoritative {
		return resolution{kind: identityLinkRequired, user: u}, nil
	}
	return resolution{kind: identityLink, user: u}, nil
}

// signInMailer is where a sign-in command queues its sign_in_method_changed
// mail: in the command's transaction, kicked after commit. A zero mailer
// (mail not wired) queues nothing.
type signInMailer struct {
	render mail.Renderer
	out    mail.Enqueuer
	now    func() time.Time
}

// queue renders and enqueues the notice for u in q; the IP is the caller's,
// read from the context. It answers whether a mail was queued, for the Kick.
func (m signInMailer) queue(ctx context.Context, q *db.Queries, u db.User, d mail.SignInMethodChangedData) (bool, error) {
	if m.out == nil {
		return false, nil
	}
	if d.IP == "" {
		d.IP = mail.SafeField(sessionMetaFrom(ctx).IP)
	}
	if d.At.IsZero() {
		d.At = time.Now()
		if m.now != nil {
			d.At = m.now()
		}
	}
	msg, err := m.render.SignInMethodChanged(u.Email, u.Locale, u.ID, d)
	if err != nil {
		return false, err
	}
	if _, err := m.out.Enqueue(ctx, q, msg); err != nil {
		return false, err
	}
	return true, nil
}

func (m signInMailer) kick(queued bool) {
	if queued && m.out != nil {
		m.out.Kick()
	}
}

// linkIdentity writes the provider link on a verified account. A row the
// guarded update does not take (linked to another subject meanwhile, or no
// longer verified) is a conflict.
func linkIdentity(ctx context.Context, q *db.Queries, userID string, id ProviderIdentity) (db.User, error) {
	var (
		u   db.User
		err error
	)
	email := pgtype.Text{String: id.Email, Valid: id.Email != ""}
	switch id.Provider {
	case ProviderGoogle:
		u, err = q.LinkGoogleAccount(ctx, db.LinkGoogleAccountParams{
			ID: userID, GoogleID: id.subject(), GoogleEmail: email,
			AvatarUrl: pgtype.Text{String: id.Picture, Valid: id.Picture != ""},
		})
	case ProviderApple:
		u, err = q.LinkAppleAccount(ctx, db.LinkAppleAccountParams{ID: userID, AppleID: id.subject(), AppleEmail: email})
	default:
		return db.User{}, errors.New("link: unknown provider")
	}
	if errors.Is(err, pgx.ErrNoRows) || isUniqueViolation(err) {
		return db.User{}, errSignInAccountConflict()
	}
	return u, err
}

// linkByEmail is resolution 9: the provider owns the address a verified
// account holds, so the identity joins it, audited, and the owner hears of
// the new way in. The caller has already decided the account's second
// factor does not stand in the way.
func linkByEmail(ctx context.Context, q *db.Queries, u db.User, id ProviderIdentity, m signInMailer, device string) (db.User, bool, error) {
	linked, err := linkIdentity(ctx, q, u.ID, id)
	if err != nil {
		return db.User{}, false, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: audit.NoOrganization, Actor: audit.User(u.ID),
		Action: audit.ActionAuthSignInMethodLinked, ResourceType: "user", ResourceID: u.ID,
		Metadata: map[string]any{"provider": id.Provider, "via": "email_match"},
	}); err != nil {
		return db.User{}, false, err
	}
	queued, err := m.queue(ctx, q, linked, mail.SignInMethodChangedData{
		Change: mail.SignInChangeLinked, Method: id.Provider, Device: device,
	})
	return linked, queued, err
}

// createProviderUser opens a password-less account for an identity no
// account matched; verified says whether its address starts verified.
func createProviderUser(ctx context.Context, q *db.Queries, id ProviderIdentity, locale string, verified bool) (db.User, error) {
	var (
		u   db.User
		err error
	)
	name := providerDisplayName(id.Name, id.Email)
	switch id.Provider {
	case ProviderGoogle:
		u, err = q.CreateGoogleUser(ctx, db.CreateGoogleUserParams{
			ID: util.NewID(), Email: id.Email, DisplayName: name, GoogleID: id.subject(),
			AvatarUrl:     pgtype.Text{String: id.Picture, Valid: id.Picture != ""},
			EmailVerified: verified, Locale: NormalizeLocale(locale),
		})
	case ProviderApple:
		u, err = q.CreateAppleUser(ctx, db.CreateAppleUserParams{
			ID: util.NewID(), Email: id.Email, DisplayName: name, AppleID: id.subject(),
			EmailVerified: verified, Locale: NormalizeLocale(locale),
		})
	default:
		return db.User{}, errors.New("create: unknown provider")
	}
	if isUniqueViolation(err) {
		// Someone took the address or the subject since it was resolved.
		return db.User{}, errSignInAccountConflict()
	}
	return u, err
}

// reclaimed is what reclaimAccount leaves for after the commit.
type reclaimed struct {
	user db.User
	// leases is the count of Office leases revoked, for the metric.
	leases int
	// appleClientID and appleToken are the Apple consent the previous holder
	// left (sealed), for the caller to revoke once the reclaim committed.
	appleClientID, appleToken string
	queued                    bool
}

// reclaimAccount is resolution 4 (spec §3.1): the owner of the mailbox takes
// back an account someone registered with the address before proving it.
// The second factor is never asked: whoever registered set it up. In the
// caller's transaction everything that person could have left goes —
// password, TOTP, recovery codes, every provider link, the AI consent
// answer, every session and device session, MCP grant, push subscription
// (browsers included), open desktop and MCP consent, reset link and mailed
// code — older access tokens are refused from now on, and the address is
// verified. Then the identity is linked. The caller issues a session without
// a second factor and, after commit, revokes the Apple token it is handed.
func reclaimAccount(ctx context.Context, q *db.Queries, u db.User, id ProviderIdentity, m signInMailer, device string) (reclaimed, error) {
	// Read under the row lock: the Apple token revoked after commit is the
	// one the reclaim clears.
	locked, err := q.GetUserForUpdate(ctx, u.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return reclaimed{}, errSignInAccountConflict()
	}
	if err != nil {
		return reclaimed{}, err
	}
	out := reclaimed{appleClientID: locked.AppleClientID.String, appleToken: locked.AppleRefreshTokenEnc.String}
	if _, err := q.ReclaimUnverifiedUser(ctx, u.ID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Verified (or deleted) since it was resolved: not a reclaim now.
			return reclaimed{}, errSignInAccountConflict()
		}
		return reclaimed{}, err
	}
	if out.leases, err = revokeAllUserSessions(ctx, q, u.ID); err != nil {
		return reclaimed{}, err
	}
	if err := q.RevokeAllPushSubscriptionsForUser(ctx, u.ID); err != nil {
		return reclaimed{}, err
	}
	grants, err := revokeAllMcpGrantsForUser(ctx, q, u.ID)
	if err != nil {
		return reclaimed{}, err
	}
	desktopAttempts, err := q.CancelOpenDesktopAuthAttemptsForUser(ctx, pgtype.Text{String: u.ID, Valid: true})
	if err != nil {
		return reclaimed{}, err
	}
	mcpAttempts, err := q.CancelOpenMcpAuthAttemptsForUser(ctx, pgtype.Text{String: u.ID, Valid: true})
	if err != nil {
		return reclaimed{}, err
	}
	if err := q.ExpirePasswordResetTokensForUser(ctx, u.ID); err != nil {
		return reclaimed{}, err
	}
	for _, purpose := range []string{codePurposeVerifyEmail, codePurposeStepUp} {
		if err := q.DeleteEmailVerificationCodesForUser(ctx, db.DeleteEmailVerificationCodesForUserParams{UserID: u.ID, Purpose: purpose}); err != nil {
			return reclaimed{}, err
		}
	}
	if err := q.MarkCredentialsRevoked(ctx, u.ID); err != nil {
		return reclaimed{}, err
	}
	if out.user, err = linkIdentity(ctx, q, u.ID, id); err != nil {
		return reclaimed{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: audit.NoOrganization, Actor: audit.User(u.ID),
		Action: audit.ActionAuthSignInMethodLinked, ResourceType: "user", ResourceID: u.ID,
		Metadata: map[string]any{"provider": id.Provider, "via": "reclaim"},
	}); err != nil {
		return reclaimed{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: audit.NoOrganization, Actor: audit.User(u.ID),
		Action: audit.ActionAuthSessionRevoked, ResourceType: "user", ResourceID: u.ID,
		Metadata: map[string]any{
			"scope": "all", "reason": "reclaimed", "mcp_grants_revoked": grants,
			"desktop_attempts_cancelled": desktopAttempts, "mcp_attempts_cancelled": mcpAttempts,
		},
	}, sessionRevoked(u.ID, "")); err != nil {
		return reclaimed{}, err
	}
	out.queued, err = m.queue(ctx, q, out.user, mail.SignInMethodChangedData{
		Change: mail.SignInChangeReclaimed, Method: id.Provider, Device: device,
	})
	if err != nil {
		return reclaimed{}, err
	}
	return out, nil
}
