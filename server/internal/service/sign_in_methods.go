package service

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/files"
	"github.com/unicomhub/uniwork/server/internal/mail"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// The ways into an account and the commands that change them (ADR 0047,
// spec §3.7). Linking an identity the person just proved into the account
// they are signed in to — from a sign-in ticket today, from Settings and the
// app's sheets with the sign-in methods slice — goes through attachIdentity.

// LinkedProvider is one provider's row of SignInMethods.
type LinkedProvider struct {
	Linked bool
	// Email is the address the provider gave when it was linked.
	Email string
	// LinkedAt is nil for links made before it was recorded.
	LinkedAt *time.Time
	// PrivateRelay: the address is Apple's Hide My Email relay.
	PrivateRelay bool
}

// The proofs a sensitive command can take (spec §3.7): with a second factor
// on, only the factor; otherwise the password when there is one, a code
// mailed to the account's address, and on the app a fresh token of a linked
// provider.
const (
	ProofTOTP      = "totp"
	ProofPassword  = "password"
	ProofEmailCode = "email_code"
	ProofApple     = "apple"
	ProofGoogle    = "google"
)

// SignInMethods is how an account signs in, as Settings lists it.
type SignInMethods struct {
	PasswordSet         bool
	PasswordChangedAt   *time.Time
	Google              LinkedProvider
	Apple               LinkedProvider
	AccountEmailIsRelay bool
	Proofs              []string
}

// SignInMethodsChange is the answer of a command that changed how an
// account signs in: the account as it is now, and its methods.
type SignInMethodsChange struct {
	User    db.User
	Methods SignInMethods
}

func isRelayAddress(email string) bool {
	return strings.EqualFold(emailDomain(email), applePrivateRelayDomain)
}

// signInMethodsOf reads u's ways in; channel decides whether the app-only
// proofs (a fresh provider token) are offered.
func signInMethodsOf(u db.User, channel string) SignInMethods {
	m := SignInMethods{
		PasswordSet: u.PasswordHash.Valid, PasswordChangedAt: timePtr(u.PasswordChangedAt),
		Google: LinkedProvider{
			Linked: u.GoogleID.Valid, Email: u.GoogleEmail.String, LinkedAt: timePtr(u.GoogleLinkedAt),
		},
		Apple: LinkedProvider{
			Linked: u.AppleID.Valid, Email: u.AppleEmail.String, LinkedAt: timePtr(u.AppleLinkedAt),
			PrivateRelay: u.AppleID.Valid && isRelayAddress(u.AppleEmail.String),
		},
		AccountEmailIsRelay: isRelayAddress(u.Email),
	}
	if u.MfaEnabledAt.Valid {
		m.Proofs = []string{ProofTOTP}
		return m
	}
	if m.PasswordSet {
		m.Proofs = append(m.Proofs, ProofPassword)
	}
	m.Proofs = append(m.Proofs, ProofEmailCode)
	if channel == SignInChannelNative {
		if m.Apple.Linked {
			m.Proofs = append(m.Proofs, ProofApple)
		}
		if m.Google.Linked {
			m.Proofs = append(m.Proofs, ProofGoogle)
		}
	}
	return m
}

var (
	// ErrSignInMethodTaken: the identity opens another account, one with a
	// history in an organization, which only its owner can unlink.
	ErrSignInMethodTaken = errors.New("sign_in_method_taken")
	// ErrSignInMethodMovable: the identity opens an account that never
	// belonged to an organization; it moves here if the caller asks (move).
	ErrSignInMethodMovable = errors.New("sign_in_method_movable")
	// ErrSignInMethodAlreadyLinked: the account holds another subject of the
	// same provider.
	ErrSignInMethodAlreadyLinked = errors.New("sign_in_method_already_linked")
	// ErrProofRequired: the command needs a proof that the person at the
	// keyboard is the account's owner now (a session that started after the
	// identity was proved, or a step-up token).
	ErrProofRequired = errors.New("proof_required")
)

// maskEmail shows enough of an address for its owner to recognise it and no
// more: the first character of the mailbox, then the domain (a•••@icloud.com).
func maskEmail(email string) string {
	local, domain, ok := strings.Cut(email, "@")
	if !ok || local == "" || domain == "" {
		return "•••"
	}
	first, _ := utf8.DecodeRuneInString(local)
	return string(first) + "•••@" + domain
}

// errSignInMethodTaken names the account the identity opens, masked, so the
// person knows where to sign in to unlink it.
func errSignInMethodTaken(holderEmail string) error {
	return CodedError{
		Code: "sign_in_method_taken", Status: http.StatusConflict,
		Msg: "this sign-in already opens another account", Err: ErrSignInMethodTaken,
		Fields: map[string]any{"masked_email": maskEmail(holderEmail)},
	}
}

func errSignInMethodMovable(holderEmail string) error {
	return CodedError{
		Code: "sign_in_method_movable", Status: http.StatusConflict,
		Msg: "this sign-in opens an empty account; send move: true to move it here", Err: ErrSignInMethodMovable,
		Fields: map[string]any{"masked_email": maskEmail(holderEmail)},
	}
}

func errSignInMethodAlreadyLinked() error {
	return CodedError{
		Code: "sign_in_method_already_linked", Status: http.StatusConflict,
		Msg: "the account is linked to another account of this provider; unlink it first", Err: ErrSignInMethodAlreadyLinked,
	}
}

// errProofRequired is 403, never 401: the caller is signed in; the command
// wants more than the session it has.
func errProofRequired() error {
	return CodedError{
		Code: "proof_required", Status: http.StatusForbidden,
		Msg: "confirm it is you first", Err: ErrProofRequired,
	}
}

// attached is what attachIdentity did.
type attached struct {
	user db.User
	// already: the identity opened this very account before; nothing was
	// written.
	already bool
	// moved is set when the identity left an empty account for this one.
	moved *vacated
	// queued: notices wait in the transaction for the Kick.
	queued bool
}

// attachIdentity links id, which the person just proved (a sign-in ticket,
// a link callback, a native provider token), into caller, the account they
// are signed in to, locked by the caller in q's transaction (spec §3.2,
// §3.7). In order:
//
//   - an account that never proved its address takes no link (403
//     email_unverified): nothing planted on it could outlive the reclaim;
//   - the identity opens caller already: nothing to do;
//   - caller holds another subject of the provider:
//     sign_in_method_already_linked;
//   - the identity opens another account: sign_in_method_taken when that
//     account ever belonged to an organization, else sign_in_method_movable
//     unless move asks for it to be moved out (vacateEmptyAccount);
//   - otherwise it is linked, audited with via (move when it moved) and told
//     to the owner, and to the provider's address when that is another
//     mailbox.
func (s *AuthService) attachIdentity(ctx context.Context, q *db.Queries, caller db.User, id ProviderIdentity, via string, move bool) (attached, error) {
	if caller.DeletedAt.Valid {
		return attached{}, ErrNotFound
	}
	if !caller.EmailVerifiedAt.Valid {
		return attached{}, ErrEmailUnverified
	}
	linked, _ := linkedSubject(caller, id.Provider)
	if linked.Valid && linked.String == id.Subject {
		return attached{user: caller, already: true}, nil
	}
	if linked.Valid {
		return attached{}, errSignInMethodAlreadyLinked()
	}
	m := s.signInMailer()
	device := mail.SafeField(sessionMetaFrom(ctx).UserAgent)
	out := attached{}
	holder, err := userBySubject(ctx, q, id)
	switch {
	case err == nil:
		// holder is not caller: caller holds no subject of this provider.
		v, err := s.vacateEmptyAccount(ctx, q, holder, id, caller.ID, move, m, device)
		if err != nil {
			return attached{}, err
		}
		out.moved, out.queued = &v, v.queued
		via = linkViaMove
	case !errors.Is(err, pgx.ErrNoRows):
		return attached{}, err
	}
	u, err := linkIdentity(ctx, q, caller.ID, id)
	if err != nil {
		return attached{}, err
	}
	if out.moved != nil && id.Provider == ProviderApple {
		// The Apple consent belongs to the Apple ID, which moved: it goes
		// with it rather than back to Apple, unless the proof brought a
		// fresher one.
		if id.AppleRefresh == "" && out.moved.appleToken != "" {
			if err := q.SetAppleRefreshToken(ctx, db.SetAppleRefreshTokenParams{
				ID: u.ID, AppleClientID: pgtype.Text{String: out.moved.appleClientID, Valid: true},
				AppleRefreshTokenEnc: pgtype.Text{String: out.moved.appleToken, Valid: true},
			}); err != nil {
				return attached{}, err
			}
		}
		out.moved.appleClientID, out.moved.appleToken = "", ""
	}
	if err := keepAppleConsent(ctx, q, u.ID, id); err != nil {
		return attached{}, err
	}
	var extra map[string]any
	change, told := mail.SignInChangeLinked, []string(nil)
	if out.moved != nil {
		extra = map[string]any{"moved_from": out.moved.holderID}
		change, told = mail.SignInChangeMoved, []string{out.moved.holderEmail}
	}
	if err := recordLinked(ctx, q, u.ID, id.Provider, via, extra); err != nil {
		return attached{}, err
	}
	queued, err := queueLinkedNotices(ctx, q, m, u, id, change, device, told...)
	if err != nil {
		return attached{}, err
	}
	out.user, out.queued = u, out.queued || queued
	return out, nil
}

// vacated is what moving an identity out of an empty account leaves for
// after the commit.
type vacated struct {
	holderID, holderEmail string
	// leases is the count of Office leases its sessions held, for the metric.
	leases int
	// appleClientID and appleToken are the erased account's Apple consent,
	// to give back to Apple after commit unless it moved with the identity.
	appleClientID, appleToken string
	queued                    bool
}

// vacateEmptyAccount moves id out of holder, the account it opens, when the
// person who just proved it asks (move) and holder never belonged to an
// organization (ADR 0047 §2c): such an account is what a provider sign-in
// used to create without asking, and holds nothing anyone shares. holder is
// erased like a deleted account (anonymised, every session, device, push,
// MCP grant, consent attempt, reset link and code ended, its avatar file
// released), audited (the unlink via move, the session revoke, user.deleted)
// and told, at the address it had, where the identity went. An account with
// a history in an organization is never touched: sign_in_method_taken, with
// its address masked so the person knows where to sign in to unlink it.
func (s *AuthService) vacateEmptyAccount(ctx context.Context, q *db.Queries, holder db.User, id ProviderIdentity, toUserID string, move bool, m signInMailer, device string) (vacated, error) {
	// Serializes against holder joining an organization meanwhile.
	if err := lockMembership(ctx, q, holder.ID); err != nil {
		return vacated{}, err
	}
	joined, err := q.UserEverJoinedAnOrganization(ctx, holder.ID)
	if err != nil {
		return vacated{}, err
	}
	if joined {
		return vacated{}, errSignInMethodTaken(holder.Email)
	}
	if !move {
		return vacated{}, errSignInMethodMovable(holder.Email)
	}
	// FS-C1 §5.4, as account deletion: a files release locks the files row
	// before the user row, so the avatar is released from the plain read and
	// the row lock that follows refuses an avatar swapped in between.
	if s.files != nil && holder.AvatarFileID.Valid && holder.AvatarFileID.String != "" {
		if err := releaseFilesInTx(ctx, s.files, q, []files.FileID{files.FileID(holder.AvatarFileID.String)}); err != nil {
			return vacated{}, err
		}
	}
	locked, err := q.GetUserForUpdate(ctx, holder.ID)
	if err != nil {
		return vacated{}, err
	}
	if lockedSub, _ := linkedSubject(locked, id.Provider); lockedSub.String != id.Subject || locked.AvatarFileID != holder.AvatarFileID {
		// Unlinked or changed between the read and the lock.
		return vacated{}, ErrConflict
	}
	out := vacated{
		holderID: locked.ID, holderEmail: locked.Email,
		appleClientID: locked.AppleClientID.String, appleToken: locked.AppleRefreshTokenEnc.String,
	}
	// Told before the row loses the address it is told at.
	if out.queued, err = m.queue(ctx, q, locked, mail.SignInMethodChangedData{
		Change: mail.SignInChangeMoved, Method: id.Provider, MovedAway: true, Device: device,
	}); err != nil {
		return vacated{}, err
	}
	if _, err := q.AnonymizeUser(ctx, db.AnonymizeUserParams{
		ID: locked.ID, Email: deletedEmail(locked.ID), DisplayName: deletedDisplayName,
	}); err != nil {
		return vacated{}, err
	}
	if out.leases, err = revokeAllUserSessions(ctx, q, locked.ID); err != nil {
		return vacated{}, err
	}
	if err := q.RevokeAllPushSubscriptionsForUser(ctx, locked.ID); err != nil {
		return vacated{}, err
	}
	grants, err := revokeAllMcpGrantsForUser(ctx, q, locked.ID)
	if err != nil {
		return vacated{}, err
	}
	owner := pgtype.Text{String: locked.ID, Valid: true}
	if _, err := q.CancelOpenDesktopAuthAttemptsForUser(ctx, owner); err != nil {
		return vacated{}, err
	}
	if _, err := q.CancelOpenMcpAuthAttemptsForUser(ctx, owner); err != nil {
		return vacated{}, err
	}
	if err := q.ExpirePasswordResetTokensForUser(ctx, locked.ID); err != nil {
		return vacated{}, err
	}
	for _, purpose := range []string{codePurposeVerifyEmail, codePurposeStepUp} {
		if err := q.DeleteEmailVerificationCodesForUser(ctx, db.DeleteEmailVerificationCodesForUserParams{UserID: locked.ID, Purpose: purpose}); err != nil {
			return vacated{}, err
		}
	}
	for _, e := range []struct {
		entry audit.Entry
		emit  []audit.Event
	}{
		{entry: audit.Entry{
			Action:   audit.ActionAuthSignInMethodUnlinked,
			Metadata: map[string]any{"provider": id.Provider, "via": linkViaMove, "moved_to": toUserID},
		}},
		{entry: audit.Entry{
			Action:   audit.ActionAuthSessionRevoked,
			Metadata: map[string]any{"scope": "all", "reason": "moved", "mcp_grants_revoked": grants},
		}, emit: []audit.Event{sessionRevoked(locked.ID, "")}},
		{entry: audit.Entry{Action: audit.ActionUserDeleted, Metadata: map[string]any{"reason": "moved"}}},
	} {
		e.entry.OrganizationID, e.entry.Actor = audit.NoOrganization, audit.User(locked.ID)
		e.entry.ResourceType, e.entry.ResourceID = "user", locked.ID
		if err := auditRecorder.Record(ctx, q, e.entry, e.emit...); err != nil {
			return vacated{}, err
		}
	}
	return out, nil
}

// afterAttach is what an attach leaves for after its commit: the notices,
// and an erased account's Office lease metric and Apple consent.
func (s *AuthService) afterAttach(ctx context.Context, a attached) {
	s.signInMailer().kick(a.queued)
	if a.moved == nil {
		return
	}
	observeOfficeLeaseRevokes(OfficeLeaseRevokeSessionRevoked, a.moved.leases)
	s.apple.revokeAfterCommit(ctx, a.moved.holderID, a.moved.appleClientID, a.moved.appleToken)
}

// Link is "I already have an account" once the person signed in (spec
// §3.2): the ticket's identity joins the bearer's account through
// attachIdentity, audited via ticket (move when it moved out of an empty
// account). The bearer must be of the ticket's channel. Its session must have
// started after the ticket was issued — a browser session's first refresh
// token, a device session's creation (same client and deployment) — which is
// what proves that whoever proved the identity also just proved the account;
// an older session is 403 proof_required. The command is sensitive, so a
// browser token older than the account's last credential change is refused
// first.
func (s *SignInTicketService) Link(ctx context.Context, sealed string, b TicketBinding, move bool) (SignInMethodsChange, error) {
	t, err := s.auth.openSignInTicket(sealed, b)
	if err != nil {
		return SignInMethodsChange{}, err
	}
	at, ok := auth.AccessTokenFrom(ctx)
	if !ok {
		return SignInMethodsChange{}, errProofRequired()
	}
	if at.Web != (t.Channel == SignInChannelWeb) {
		return SignInMethodsChange{}, errSignInTicketChannel()
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return SignInMethodsChange{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.q.WithTx(tx)
	if err := requireCurrentCredentials(ctx, q); err != nil {
		return SignInMethodsChange{}, err
	}
	if err := s.sessionStartedAfter(ctx, q, at, t); err != nil {
		return SignInMethodsChange{}, err
	}
	caller, err := q.GetUserForUpdate(ctx, at.UserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return SignInMethodsChange{}, ErrNotFound
	}
	if err != nil {
		return SignInMethodsChange{}, err
	}
	a, err := s.auth.attachIdentity(ctx, q, caller, t.Identity, linkViaTicket, move)
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
	return SignInMethodsChange{User: s.auth.decorateAvatar(ctx, a.user), Methods: signInMethodsOf(a.user, t.Channel)}, nil
}

// sessionStartedAfter holds a ticket link to a session younger than the
// ticket. A session that is no longer live is the bearer's own problem (401
// invalid_token: the client refreshes, which fails, and signs in again).
// ponytail: a step-up token minted for this session is the other proof the
// spec allows (§3.7); the sign-in methods slice accepts it here.
func (s *SignInTicketService) sessionStartedAfter(ctx context.Context, q *db.Queries, at auth.AccessToken, t signInTicket) error {
	var started time.Time
	if at.Web {
		row, err := q.GetWebSessionStart(ctx, db.GetWebSessionStartParams{UserID: at.UserID, SessionID: at.SessionID})
		if err != nil {
			return err
		}
		if !row.Live || !row.StartedAt.Valid {
			return errCredentialsRevoked()
		}
		started = row.StartedAt.Time
	} else {
		d, err := q.GetDeviceSession(ctx, at.SessionID)
		if errors.Is(err, pgx.ErrNoRows) {
			return errCredentialsRevoked()
		}
		if err != nil {
			return err
		}
		if d.UserID != at.UserID || d.RevokedAt.Valid {
			return errCredentialsRevoked()
		}
		if d.ClientID != t.ClientID || d.DeploymentID != t.DeploymentID {
			return errSignInTicketChannel()
		}
		started = d.CreatedAt.Time
	}
	// The ticket's iat has one-second precision: a session that started in
	// the second the ticket was issued counts as after it.
	if started.Unix() < t.IssuedAt {
		return errProofRequired()
	}
	return nil
}
