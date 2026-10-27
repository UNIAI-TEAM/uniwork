package service

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/mail"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// A provider sign-in that matches no account, or whose address an account
// holds that the identity may not join by itself, creates nothing (ADR 0047
// §2c): it hands the client a sign-in ticket and the client shows the choice
// screen — "I already have an account", "I was invited with another
// address", "Create a new account" (spec §3.2). The ticket is the proven
// identity, sealed for sign_in_ticket and bound to the channel that asked
// for it; nothing is stored, so creating and linking are idempotent through
// the subject's unique index.

const (
	signInTicketTTL     = 15 * time.Minute
	signInTicketVersion = 1
)

// The two answers a ticket stands for.
const (
	// TicketKindUnmatched: no account has the identity or its address.
	TicketKindUnmatched = "unmatched"
	// TicketKindLinkRequired: an account holds the address, and only its
	// owner, signed in, may add the identity to it.
	TicketKindLinkRequired = "link_required"
)

// The channels a ticket is bound to, the same two a challenge token knows: a
// web ticket rides only in an HttpOnly cookie, a native one only in JSON and
// only with the nonce the app kept.
const (
	SignInChannelWeb    = auth.MFAChannelWeb
	SignInChannelNative = auth.MFAChannelNative
)

// The intents a provider sign-in starts with. sign_up (the register screen)
// creates an unmatched identity's account at once, without the choice.
const (
	SignInIntentSignIn = "sign_in"
	SignInIntentSignUp = "sign_up"
)

// TicketBinding is the channel a ticket is issued on or presented from. A
// native one names its client and deployment and carries the raw nonce the
// app used for the provider's sheet: the ticket keeps only its SHA-256
// (key_hash), so a ticket copied out of a log opens nothing without it.
type TicketBinding struct {
	Channel      string
	ClientID     string
	DeploymentID string
	Nonce        string
}

// WebTicket is the binding of every browser ticket route.
func WebTicket() TicketBinding { return TicketBinding{Channel: SignInChannelWeb} }

// signInTicket is the sealed payload (spec §3.2).
type signInTicket struct {
	V            int              `json:"v"`
	Identity     ProviderIdentity `json:"identity"`
	Kind         string           `json:"kind"`
	Channel      string           `json:"channel"`
	ClientID     string           `json:"client_id,omitempty"`
	DeploymentID string           `json:"deployment_id,omitempty"`
	KeyHash      string           `json:"key_hash,omitempty"`
	Intent       string           `json:"intent,omitempty"`
	IssuedAt     int64            `json:"iat"`
	ExpiresAt    int64            `json:"exp"`
}

// mfaBinding is the challenge a ticket command owes on the ticket's channel.
func (t signInTicket) mfaBinding() auth.MFAChallenge {
	return auth.MFAChallenge{Channel: t.Channel, ClientID: t.ClientID, DeploymentID: t.DeploymentID}
}

var (
	// ErrSignInTicketMissing: no ticket, or one that is expired, was not
	// sealed by this server for sign_in_ticket, or has an unknown shape.
	ErrSignInTicketMissing = errors.New("sign_in_ticket_missing")
	// ErrSignInTicketChannel: the ticket was issued on another channel, or
	// for another native client, or the nonce is not the one it was issued
	// with.
	ErrSignInTicketChannel = errors.New("sign_in_ticket_channel")
)

func errSignInTicketMissing() error {
	return CodedError{Code: "sign_in_ticket_missing", Status: http.StatusNotFound, Msg: "no pending sign-in; sign in with the provider again", Err: ErrSignInTicketMissing}
}

func errSignInTicketChannel() error {
	return CodedError{Code: "sign_in_ticket_channel", Status: http.StatusBadRequest, Msg: "this sign-in was started elsewhere", Err: ErrSignInTicketChannel}
}

func nonceKeyHash(nonce string) string {
	sum := sha256.Sum256([]byte(nonce))
	return hex.EncodeToString(sum[:])
}

// issueSignInTicket seals the ticket for an identity resolveIdentity
// answered with kind, on b's channel.
func (s *AuthService) issueSignInTicket(id ProviderIdentity, kind, intent string, b TicketBinding) (string, error) {
	now := s.now()
	t := signInTicket{
		V: signInTicketVersion, Identity: id, Kind: kind, Channel: b.Channel, Intent: intent,
		IssuedAt: now.Unix(), ExpiresAt: now.Add(signInTicketTTL).Unix(),
	}
	switch b.Channel {
	case SignInChannelWeb:
	case SignInChannelNative:
		if b.ClientID == "" || b.DeploymentID == "" || b.Nonce == "" {
			return "", errors.New("sign-in ticket: a native ticket needs its client, deployment and nonce")
		}
		t.ClientID, t.DeploymentID, t.KeyHash = b.ClientID, b.DeploymentID, nonceKeyHash(b.Nonce)
	default:
		return "", errors.New("sign-in ticket: unknown channel")
	}
	raw, err := json.Marshal(t)
	if err != nil {
		return "", err
	}
	return s.sealer.SealFor(auth.PurposeSignInTicket, string(raw))
}

// openSignInTicket opens a ticket presented on b's channel. Anything that is
// not a live ticket of this server is sign_in_ticket_missing; a live one
// presented on another channel, by another native client or without its
// nonce is sign_in_ticket_channel.
func (s *AuthService) openSignInTicket(sealed string, b TicketBinding) (signInTicket, error) {
	if sealed == "" {
		return signInTicket{}, errSignInTicketMissing()
	}
	raw, err := s.sealer.OpenFor(auth.PurposeSignInTicket, sealed)
	if err != nil {
		return signInTicket{}, errSignInTicketMissing()
	}
	var t signInTicket
	if err := json.Unmarshal([]byte(raw), &t); err != nil || t.V != signInTicketVersion || t.Identity.Subject == "" ||
		(t.Kind != TicketKindUnmatched && t.Kind != TicketKindLinkRequired) {
		return signInTicket{}, errSignInTicketMissing()
	}
	if s.now().Unix() >= t.ExpiresAt {
		return signInTicket{}, errSignInTicketMissing()
	}
	if t.Channel != b.Channel {
		return signInTicket{}, errSignInTicketChannel()
	}
	if t.Channel == SignInChannelNative {
		key := nonceKeyHash(b.Nonce)
		if b.Nonce == "" || t.ClientID != b.ClientID || t.DeploymentID != b.DeploymentID ||
			subtle.ConstantTimeCompare([]byte(key), []byte(t.KeyHash)) != 1 {
			return signInTicket{}, errSignInTicketChannel()
		}
	}
	return t, nil
}

// ticketHash keys what a ticket leaves in the database (its email claims):
// every ticket is sealed with a fresh nonce, so its hash names it alone.
func ticketHash(sealed string) string { return hashToken(sealed) }

// SignInTicket is what the choice screen shows of a pending sign-in.
type SignInTicket struct {
	Provider     string
	Kind         string
	Email        string
	Name         string
	PrivateRelay bool
}

// SignInTicketService runs the choice screen's commands (spec §3.2): read
// the ticket, create the account, claim another address, link into a
// signed-in account, cancel. The browser's routes come first; the native
// routes reuse the same cores (createQ, claimQ, attachIdentity) with a native
// binding and their own device session.
type SignInTicketService struct {
	pool *pgxpool.Pool
	q    *db.Queries
	auth *AuthService
	// render/out mail the "another address" code. The address may have no
	// account, so this is not the AuthService's per-user mail.
	render mail.Renderer
	out    mail.Enqueuer
}

func NewSignInTicketService(pool *pgxpool.Pool, q *db.Queries, auth *AuthService, render mail.Renderer, out mail.Enqueuer) *SignInTicketService {
	return &SignInTicketService{pool: pool, q: q, auth: auth, render: render, out: out}
}

// Describe is what the choice screen shows of the pending sign-in.
func (s *SignInTicketService) Describe(_ context.Context, sealed string, b TicketBinding) (SignInTicket, error) {
	t, err := s.auth.openSignInTicket(sealed, b)
	if err != nil {
		return SignInTicket{}, err
	}
	id := t.Identity
	return SignInTicket{Provider: id.Provider, Kind: t.Kind, Email: id.Email, Name: id.Name, PrivateRelay: id.PrivateRelay}, nil
}

// Discard is "Cancel" on the choice screen. The caller drops the ticket
// whatever this finds; an Apple consent the ticket carries opens no account,
// so it is given back to Apple rather than orphaned, as the legacy route does
// for a sign-in that did not happen — unless the Apple ID opens an account by
// now (the same ticket created one in another tab), which keeps that consent.
// Best effort.
func (s *SignInTicketService) Discard(ctx context.Context, sealed string, b TicketBinding) {
	t, err := s.auth.openSignInTicket(sealed, b)
	if err != nil || t.Identity.AppleRefresh == "" {
		return
	}
	if _, err := userBySubject(ctx, s.q, t.Identity); !errors.Is(err, pgx.ErrNoRows) {
		return
	}
	s.auth.apple.revokeAfterCommit(ctx, "", t.Identity.AppleClientID, t.Identity.AppleRefresh)
}

// ticketDisplayName is the name a new account from a ticket shows: the one
// typed, else the provider's. The choice screen asks for one when the
// provider shared none, so neither is invented here.
func ticketDisplayName(typed string, id ProviderIdentity) (string, error) {
	name := strings.Join(strings.Fields(typed), " ")
	if name == "" {
		name = strings.Join(strings.Fields(id.Name), " ")
	}
	if name == "" {
		return "", Invalid("tên hiển thị không được để trống")
	}
	if utf8.RuneCountInString(name) > maxDisplayNameRunes {
		return "", Invalid("tên hiển thị quá dài")
	}
	return name, nil
}

// Create is "Create a new account" (spec §3.2). Only an unmatched ticket
// creates: the account takes the identity's address — verified when the
// provider owns it, else mailed a code as a password sign-up is — and the
// identity is linked from the start. displayName is required when the
// provider shared no name. An address some account took since the ticket was
// issued is sign_in_account_conflict; an identity that opens an account by
// now (the same ticket created it in another tab) signs in to it, as signing
// in with the provider again would. The session is the browser's.
func (s *SignInTicketService) Create(ctx context.Context, sealed string, b TicketBinding, displayName, locale string) (Session, error) {
	t, err := s.auth.openSignInTicket(sealed, b)
	if err != nil {
		return Session{}, err
	}
	if t.Kind != TicketKindUnmatched {
		return Session{}, errSignInAccountConflict()
	}
	name, err := ticketDisplayName(displayName, t.Identity)
	if err != nil {
		return Session{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Session{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.q.WithTx(tx)
	u, created, err := s.createQ(ctx, q, t, name, locale)
	if err != nil {
		return Session{}, err
	}
	if !created && u.MfaEnabledAt.Valid {
		// Opened by now and guarded by a second factor: the challenge, as
		// a provider sign-in would answer. Nothing was written.
		return s.auth.challengeOn(ctx, u, t.mfaBinding())
	}
	how := "created"
	if !created {
		how = "subject"
	}
	sess, newDevice, err := s.auth.openSession(ctx, q, u, "", "")
	if err != nil {
		return Session{}, err
	}
	if err := recordTicketLogin(ctx, q, u.ID, linkViaTicket, t.Identity.Provider, how); err != nil {
		return Session{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		if isUniqueViolation(err) {
			return Session{}, errSignInAccountConflict()
		}
		return Session{}, err
	}
	if created && !u.EmailVerifiedAt.Valid && s.auth.verification != nil {
		if err := s.auth.verification.Send(ctx, u.ID); err != nil {
			slog.Warn("send verification code after ticket sign-up", "user", u.ID, "err", err)
		}
	}
	if newDevice {
		s.auth.sendNewLoginMail(ctx, sess.User, sessionMetaFrom(ctx))
	}
	return sess, nil
}

// createQ resolves the ticket's identity again in q's transaction and opens
// its account when it still matches nothing (created). An identity that
// opens an account by now answers that account; any other answer means the
// address became an account's since the ticket was issued.
func (s *SignInTicketService) createQ(ctx context.Context, q *db.Queries, t signInTicket, name, locale string) (db.User, bool, error) {
	id := t.Identity
	res, err := resolveIdentity(ctx, q, id)
	var refused CodedError
	if errors.As(err, &refused) {
		return db.User{}, false, errSignInAccountConflict()
	}
	if err != nil {
		return db.User{}, false, err
	}
	switch res.kind {
	case identityMatched:
		return res.user, false, nil
	case identityUnmatched:
	default:
		return db.User{}, false, errSignInAccountConflict()
	}
	u, err := createProviderAccount(ctx, q, id, newProviderAccount{email: id.Email, name: name, locale: locale, verified: id.EmailAuthoritative})
	if err != nil {
		return db.User{}, false, err
	}
	if err := keepAppleConsent(ctx, q, u.ID, id); err != nil {
		return db.User{}, false, err
	}
	return u, true, nil
}

// recordTicketLogin writes the auth.login_succeeded row of a sign-in a
// ticket command finished, in its transaction: via names the command
// (ticket, email_claim), account how it found the account.
func recordTicketLogin(ctx context.Context, q *db.Queries, userID, via, provider, how string) error {
	return auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: audit.NoOrganization, Actor: audit.User(userID),
		Action: audit.ActionAuthLoginSucceeded, ResourceType: "user", ResourceID: userID,
		Metadata: map[string]any{"via": via, "provider": provider, "account": how},
	})
}
