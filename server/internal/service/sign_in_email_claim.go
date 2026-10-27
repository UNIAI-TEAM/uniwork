package service

import (
	"context"
	"crypto/subtle"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// "I was invited with another address" (ADR 0047 §2c, spec §3.2): a person
// whose Apple ID or Google account carries a personal address was invited at
// their work address. A six-digit code mailed to the address they type
// proves that mailbox; the identity then joins the account the address
// holds, takes it back when it was never verified, or opens a new account
// with it. The code never takes DEV_VERIFICATION_CODE: it proves someone
// else's mailbox, and what it opens is an account.

const (
	emailClaimTTL    = 15 * time.Minute
	emailClaimResend = 60 * time.Second
	// An address's budget over a day, whichever tickets ask: tickets cost
	// nothing to make (every provider round trip mints one), so a code that
	// opens an account is capped by the address it proves — five codes, and
	// ten wrong guesses across them, as a step-up's five codes a day are.
	emailClaimWindow        = 24 * time.Hour
	emailClaimDailyCap      = 5
	emailClaimWrongGuessCap = 10
	// maxEmailLength is RFC 5321's limit on a forward path.
	maxEmailLength = 254
)

// errCodeTooSoon is 429 rate_limited with retry_after, the whole seconds
// until another code may be mailed (a ticket's email claim, a step-up).
func errCodeTooSoon(wait time.Duration) error {
	retry := int(math.Ceil(wait.Seconds()))
	if retry < 1 {
		retry = 1
	}
	return CodedError{
		Code: "rate_limited", Status: http.StatusTooManyRequests,
		Msg: "a code was sent a moment ago; wait before asking for another", Err: ErrRateLimited,
		Fields: map[string]any{"retry_after": retry},
	}
}

// claimedAddress is the typed address, lower-cased and trimmed, or
// invalid_request when it cannot be one.
func claimedAddress(raw string) (string, error) {
	email := normalizeProviderEmail(raw)
	at := strings.Index(email, "@")
	if at <= 0 || at != strings.LastIndex(email, "@") || at == len(email)-1 || len(email) > maxEmailLength || strings.ContainsAny(email, " \t\r\n") {
		return "", Invalid("email không hợp lệ")
	}
	return email, nil
}

// SendEmailClaim mails a code to the address typed on the choice screen. It
// answers the same whether or not the address has an account: the code goes
// to the address either way. One ticket mails at most one code a minute,
// whatever the address, so a ticket cannot spray codes; and one address gets
// at most five a day, whichever tickets ask, none once ten wrong guesses
// were spent on it (emailClaimBudget), so fresh tickets cannot brute-force
// the code of an address or flood its mailbox.
func (s *SignInTicketService) SendEmailClaim(ctx context.Context, sealed string, b TicketBinding, email, locale string) error {
	t, err := s.auth.openSignInTicket(sealed, b)
	if err != nil {
		return err
	}
	if email, err = claimedAddress(email); err != nil {
		return err
	}
	if s.out == nil {
		return errors.New("email claim: mail is not wired")
	}
	hash := ticketHash(sealed)
	now := s.auth.now()
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.q.WithTx(tx)
	if err := q.LockSignInEmailClaims(ctx, hash); err != nil {
		return err
	}
	latest, err := q.GetLatestSignInEmailClaim(ctx, hash)
	if err == nil {
		if since := now.Sub(latest.CreatedAt.Time); since < emailClaimResend {
			return errCodeTooSoon(emailClaimResend - since)
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if err := emailClaimBudget(ctx, q, email, now, true); err != nil {
		return err
	}
	code, err := generateCode()
	if err != nil {
		return err
	}
	if _, err := q.CreateSignInEmailClaim(ctx, db.CreateSignInEmailClaimParams{
		ID: util.NewID(), TicketHash: hash, Email: email, CodeHash: hashToken(code),
		ExpiresAt: pgtype.Timestamptz{Time: now.Add(emailClaimTTL), Valid: true},
		CreatedAt: pgtype.Timestamptz{Time: now, Valid: true},
	}); err != nil {
		return err
	}
	msg, err := s.render.SignInEmailClaim(email, locale, mail.SignInEmailClaimData{Code: code, Expires: emailClaimTTL, Method: t.Identity.Provider})
	if err != nil {
		return err
	}
	if _, err := s.out.Enqueue(ctx, q, msg); err != nil {
		return fmt.Errorf("queue email claim mail: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	s.out.Kick()
	if err := s.q.DeleteExpiredSignInEmailClaims(ctx); err != nil {
		slog.Warn("delete expired sign-in email claims", "err", err)
	}
	return nil
}

// How a verified claim found the account it signs in to.
const (
	claimCreated = "created" // no account had the address: a new one
	claimReclaim = "reclaim" // an unverified account had it: taken back
	claimLinked  = "linked"  // a verified account had it: the identity joins
	claimSubject = "subject" // the identity opens that very account already
)

// emailClaimOutcome is what claimQ decided.
type emailClaimOutcome struct {
	// wrong: the code did not match; the attempt is counted, so the caller
	// commits and answers invalid_code.
	wrong bool
	user  db.User
	how   string
	// pending: the account has a second factor, so the link waits in the
	// challenge (via email_claim) instead of being written now.
	pending bool
	reclaim reclaimed
	queued  bool
}

// VerifyEmailClaim checks the code mailed to email for this ticket and acts
// on the address (spec §3.2): a verified account takes the identity (after
// its second factor, when it has one: the challenge carries the link), an
// unverified one is taken back by the mailbox's owner without its second
// factor, and no account means a new one with the address verified. Every
// way is audited via email_claim. The answer is the browser's session or
// challenge; a wrong code is invalid_code, and five of them spend the code.
func (s *SignInTicketService) VerifyEmailClaim(ctx context.Context, sealed string, b TicketBinding, email, code, displayName, locale string) (Session, error) {
	t, err := s.auth.openSignInTicket(sealed, b)
	if err != nil {
		return Session{}, err
	}
	if email, err = claimedAddress(email); err != nil {
		return Session{}, err
	}
	if strings.TrimSpace(displayName) != "" {
		if _, err := ticketDisplayName(displayName, t.Identity); err != nil {
			return Session{}, err
		}
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return Session{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.q.WithTx(tx)
	c, err := s.claimQ(ctx, q, t, ticketHash(sealed), email, code, displayName, locale)
	if err != nil {
		return Session{}, err
	}
	if c.wrong {
		if err := tx.Commit(ctx); err != nil {
			return Session{}, err
		}
		return Session{}, ErrInvalidCode
	}
	if c.user.MfaEnabledAt.Valid {
		// The code is spent with this commit; the identity rides in the
		// challenge and is linked once the second factor passes.
		if err := tx.Commit(ctx); err != nil {
			return Session{}, err
		}
		if c.pending {
			return s.auth.challengeWithPendingLink(ctx, c.user, t.Identity, linkViaEmailClaim, t.mfaBinding())
		}
		return s.auth.challengeOn(ctx, c.user, t.mfaBinding())
	}
	sess, newDevice, err := s.auth.openSession(ctx, q, c.user, "", "")
	if err != nil {
		return Session{}, err
	}
	if err := recordTicketLogin(ctx, q, c.user.ID, linkViaEmailClaim, t.Identity.Provider, c.how); err != nil {
		return Session{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		if isUniqueViolation(err) {
			return Session{}, errSignInAccountConflict()
		}
		return Session{}, err
	}
	s.auth.signInMailer().kick(c.queued)
	if c.how == claimReclaim {
		observeOfficeLeaseRevokes(OfficeLeaseRevokeSessionRevoked, c.reclaim.leases)
		s.auth.apple.revokeAfterCommit(ctx, c.user.ID, c.reclaim.appleClientID, c.reclaim.appleToken)
		sess.Reclaimed = true
	}
	// A new account's first session and a reclaim's (which ended every
	// session before it and told the owner) are no news; another device on
	// an account the person already used is.
	if newDevice && (c.how == claimLinked || c.how == claimSubject) {
		s.auth.sendNewLoginMail(ctx, sess.User, sessionMetaFrom(ctx))
	}
	return sess, nil
}

// emailClaimBudget is the address's half of the email claim's limits, under
// the address's lock (taken here, in q's transaction, until it commits): over
// the last day the address took at most emailClaimWrongGuessCap wrong
// guesses, and, for a send, got fewer than emailClaimDailyCap codes —
// whichever tickets asked. Spent, it is 429 rate_limited with retry_after
// until the oldest of the day's claims leaves the window.
func emailClaimBudget(ctx context.Context, q *db.Queries, email string, now time.Time, send bool) error {
	if err := q.LockSignInEmailClaimAddress(ctx, email); err != nil {
		return err
	}
	b, err := q.GetSignInEmailClaimBudget(ctx, db.GetSignInEmailClaimBudgetParams{
		Email: email, CreatedAt: pgtype.Timestamptz{Time: now.Add(-emailClaimWindow), Valid: true},
	})
	if err != nil {
		return err
	}
	if b.WrongGuesses >= emailClaimWrongGuessCap || (send && b.Codes >= emailClaimDailyCap) {
		return errCodeDailyCap(b.Oldest.Time.Add(emailClaimWindow).Sub(now))
	}
	return nil
}

// claimQ checks the code and acts on the address in q's transaction. The
// address's lock queues the guesses at it, whichever ticket makes them, and
// once its day's wrong guesses are spent no code is checked
// (emailClaimBudget); the claim's row lock queues parallel guesses at one
// code.
func (s *SignInTicketService) claimQ(ctx context.Context, q *db.Queries, t signInTicket, hash, email, code, displayName, locale string) (emailClaimOutcome, error) {
	if err := emailClaimBudget(ctx, q, email, s.auth.now(), false); err != nil {
		return emailClaimOutcome{}, err
	}
	claim, err := q.GetActiveSignInEmailClaim(ctx, db.GetActiveSignInEmailClaimParams{TicketHash: hash, Email: email})
	if errors.Is(err, pgx.ErrNoRows) {
		return emailClaimOutcome{}, ErrInvalidCode
	}
	if err != nil {
		return emailClaimOutcome{}, err
	}
	if subtle.ConstantTimeCompare([]byte(hashToken(strings.TrimSpace(code))), []byte(claim.CodeHash)) != 1 {
		if err := q.IncrementSignInEmailClaimAttempts(ctx, claim.ID); err != nil {
			return emailClaimOutcome{}, err
		}
		return emailClaimOutcome{wrong: true}, nil
	}
	if n, err := q.MarkSignInEmailClaimUsed(ctx, claim.ID); err != nil {
		return emailClaimOutcome{}, err
	} else if n != 1 {
		return emailClaimOutcome{}, ErrInvalidCode
	}
	id := t.Identity
	m := s.auth.signInMailer()
	device := mail.SafeField(sessionMetaFrom(ctx).UserAgent)

	// The identity may open an account by now (created in another tab):
	// that account is the answer when it is the claimed address's, and
	// nothing else can take the identity.
	holder, err := userBySubject(ctx, q, id)
	switch {
	case err == nil && strings.EqualFold(holder.Email, email):
		return emailClaimOutcome{user: holder, how: claimSubject}, nil
	case err == nil:
		return emailClaimOutcome{}, errSignInMethodTaken(holder.Email)
	case !errors.Is(err, pgx.ErrNoRows):
		return emailClaimOutcome{}, err
	}

	target, err := q.GetUserByEmail(ctx, email)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		name := strings.Join(strings.Fields(displayName), " ")
		if name == "" {
			name = providerDisplayName(id.Name, email)
		}
		if name, err = ticketDisplayName(name, id); err != nil {
			return emailClaimOutcome{}, err
		}
		u, err := createProviderAccount(ctx, q, id, newProviderAccount{email: email, name: name, locale: locale, verified: true})
		if err != nil {
			return emailClaimOutcome{}, err
		}
		if err := keepAppleConsent(ctx, q, u.ID, id); err != nil {
			return emailClaimOutcome{}, err
		}
		if err := recordLinked(ctx, q, u.ID, id.Provider, linkViaEmailClaim, map[string]any{"account": claimCreated}); err != nil {
			return emailClaimOutcome{}, err
		}
		return emailClaimOutcome{user: u, how: claimCreated}, nil
	case err != nil:
		return emailClaimOutcome{}, err
	case !target.EmailVerifiedAt.Valid:
		// The code proved the mailbox, which is what a reclaim takes.
		r, err := reclaimAccount(ctx, q, target, id, m, device, linkViaEmailClaim)
		if err != nil {
			return emailClaimOutcome{}, err
		}
		return emailClaimOutcome{user: r.user, how: claimReclaim, reclaim: r, queued: r.queued}, nil
	}
	if linked, _ := linkedSubject(target, id.Provider); linked.Valid {
		return emailClaimOutcome{}, errSignInMethodAlreadyLinked()
	}
	if target.MfaEnabledAt.Valid {
		return emailClaimOutcome{user: target, how: claimLinked, pending: true}, nil
	}
	u, err := linkIdentity(ctx, q, target.ID, id)
	if err != nil {
		return emailClaimOutcome{}, err
	}
	if err := keepAppleConsent(ctx, q, u.ID, id); err != nil {
		return emailClaimOutcome{}, err
	}
	if err := recordLinked(ctx, q, u.ID, id.Provider, linkViaEmailClaim, nil); err != nil {
		return emailClaimOutcome{}, err
	}
	queued, err := queueLinkedNotices(ctx, q, m, u, id, mail.SignInChangeLinked, device)
	if err != nil {
		return emailClaimOutcome{}, err
	}
	return emailClaimOutcome{user: u, how: claimLinked, queued: queued}, nil
}
