package service

import (
	"context"
	"log/slog"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/mail"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// ProviderSignInResult is how a browser provider sign-in ended: a session,
// or the MFA challenge in its place (Session.MFAPending), and whether it took
// the account back from someone who registered the address before proving it
// (the client says so once); or, when no account was found to sign in to, a
// sign-in ticket for the choice screen in place of either (spec §3.2).
type ProviderSignInResult struct {
	Session   Session
	Reclaimed bool
	// Ticket is the sealed sign-in ticket (TicketKind unmatched or
	// link_required); Session is empty when it is set.
	Ticket     string
	TicketKind string
}

// webProviderSignIn is a browser sign-in with a provider whose token passed
// its checks (Google, Apple on the web; ADR 0049). It resolves the account
// with resolveIdentity, inside one transaction with whatever the answer
// writes:
//
//   - matched: the account linked to the subject;
//   - unmatched: no account is created (ADR 0049 §2c) but a sign-in ticket
//     for the choice screen; from the register screen (intent sign_up) the
//     account is created at once, its address verified only when the
//     provider owns it (else a verification code is mailed, as for a
//     password sign-up);
//   - link_required: a ticket too, the choice screen saying the address has
//     an account to sign in to and link from;
//   - reclaim: the account registered with the address before it was proved
//     is taken back, its second factor never asked;
//   - link: a verified account with an address the provider owns gets the
//     link, audited and told to its owner. An account with a second factor
//     is not linked yet: it gets its challenge, which carries the identity,
//     and the link is written once the second factor passes (VerifyMFA,
//     spec §3.3).
//
// An Apple identity arrives with the consent Apple handed this sign-in (its
// sealed refresh token, and the client it was issued to): the account the
// sign-in opens keeps it, so account deletion revokes it for the right
// client; a ticket or a pending link carries it on. Nothing is written
// before a second factor passed, so an account that owes one keeps the
// consent it had.
func (s *AuthService) webProviderSignIn(ctx context.Context, id ProviderIdentity, locale, intent string) (ProviderSignInResult, error) {
	m := s.signInMailer()
	device := mail.SafeField(sessionMetaFrom(ctx).UserAgent)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return ProviderSignInResult{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.q.WithTx(tx)
	res, err := resolveIdentity(ctx, q, id)
	if err != nil {
		return ProviderSignInResult{}, err
	}
	var (
		u       db.User
		queued  bool
		reclaim reclaimed
		// pending: the link waits for the account's second factor.
		pending bool
	)
	switch res.kind {
	case identityMatched:
		u = res.user
		if !u.MfaEnabledAt.Valid {
			if err := keepAppleConsent(ctx, q, u.ID, id); err != nil {
				return ProviderSignInResult{}, err
			}
		}
	case identityUnmatched:
		if intent != SignInIntentSignUp {
			return s.webSignInTicket(id, TicketKindUnmatched, intent)
		}
		if u, err = createProviderUser(ctx, q, id, locale, id.EmailAuthoritative); err != nil {
			return ProviderSignInResult{}, err
		}
		if err := keepAppleConsent(ctx, q, u.ID, id); err != nil {
			return ProviderSignInResult{}, err
		}
	case identityReclaim:
		if reclaim, err = reclaimAccount(ctx, q, res.user, id, m, device, linkViaReclaim); err != nil {
			return ProviderSignInResult{}, err
		}
		u, queued = reclaim.user, reclaim.queued
	case identityLink:
		if res.user.MfaEnabledAt.Valid {
			u, pending = res.user, true
			break
		}
		if u, queued, err = linkByEmail(ctx, q, res.user, id, m, device); err != nil {
			return ProviderSignInResult{}, err
		}
	default: // identityLinkRequired
		return s.webSignInTicket(id, TicketKindLinkRequired, intent)
	}
	if err := tx.Commit(ctx); err != nil {
		if isUniqueViolation(err) {
			return ProviderSignInResult{}, errSignInAccountConflict()
		}
		return ProviderSignInResult{}, err
	}
	m.kick(queued)
	reclaimedIt := res.kind == identityReclaim
	if reclaimedIt {
		observeOfficeLeaseRevokes(OfficeLeaseRevokeSessionRevoked, reclaim.leases)
		s.apple.revokeAfterCommit(ctx, u.ID, reclaim.appleClientID, reclaim.appleToken)
	}
	if !u.EmailVerifiedAt.Valid && res.kind == identityUnmatched && s.verification != nil {
		if err := s.verification.Send(ctx, u.ID); err != nil {
			slog.Warn("send verification code after provider sign-up", "user", u.ID, "provider", id.Provider, "err", err)
		}
	}
	if pending {
		sess, err := s.challengeWithPendingLink(ctx, u, id, linkViaEmailMatch, auth.MFAChallenge{Channel: auth.MFAChannelWeb})
		if err != nil {
			return ProviderSignInResult{}, err
		}
		return ProviderSignInResult{Session: sess}, nil
	}
	meta := map[string]any{"via": "provider", "provider": id.Provider}
	if reclaimedIt {
		// A reclaim cleared the second factor in the transaction above, so
		// the session comes without a challenge: whoever registered set it
		// up. Its notice is the owner's news, not a new-login alert.
		sess, err := s.reclaimedSession(ctx, u, meta)
		if err != nil {
			return ProviderSignInResult{}, err
		}
		return ProviderSignInResult{Session: sess, Reclaimed: true}, nil
	}
	sess, err := s.sessionOrChallenge(ctx, u, meta)
	if err != nil {
		return ProviderSignInResult{}, err
	}
	return ProviderSignInResult{Session: sess}, nil
}

// webSignInTicket answers a browser sign-in that found no account to sign in
// to with the web ticket for the choice screen. Nothing was written.
func (s *AuthService) webSignInTicket(id ProviderIdentity, kind, intent string) (ProviderSignInResult, error) {
	sealed, err := s.issueSignInTicket(id, kind, intent, WebTicket())
	if err != nil {
		return ProviderSignInResult{}, err
	}
	return ProviderSignInResult{Ticket: sealed, TicketKind: kind}, nil
}
