package service

import (
	"context"
	"strings"
)

// The app's choice screen (spec §3.2): the commands the browser's ticket
// routes run, on a native ticket — one that rides only in JSON and opens
// only with the nonce the app handed the provider's sheet (its SHA-256 is the
// ticket's key_hash), from the client and deployment it was issued to. They
// reuse the browser's cores (createQ, claimQ, the ticket link) and end in the
// app's device session instead of a cookie.

// CreateFromTicket is "Create a new account" in the app: Create's rules (an
// unmatched ticket only, 409 sign_in_account_conflict otherwise or when the
// address became an account's; display_name required when the provider
// shared no name; an identity that opens an account by now signs in to it)
// on the app's ticket, audited via ticket in the transaction that issues the
// device session.
func (s *NativeSignInService) CreateFromTicket(ctx context.Context, ticket, nonce, displayName, locale string, c NativeClient) (NativeSignInResult, error) {
	if err := s.door(c); err != nil {
		return NativeSignInResult{}, err
	}
	ctx = c.context(ctx)
	t, err := s.auth.openSignInTicket(ticket, c.ticket(nonce))
	if err != nil {
		return NativeSignInResult{}, err
	}
	if t.Kind != TicketKindUnmatched {
		return NativeSignInResult{}, errSignInAccountConflict()
	}
	name, err := ticketDisplayName(displayName, t.Identity)
	if err != nil {
		return NativeSignInResult{}, err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return NativeSignInResult{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.q.WithTx(tx)
	u, created, err := s.tickets.createQ(ctx, q, t, name, locale)
	if err != nil {
		return NativeSignInResult{}, err
	}
	if !created && u.MfaEnabledAt.Valid {
		// Opened by now and guarded by a second factor: the app's challenge,
		// as its provider sign-in would answer. Nothing was written.
		return s.challenge(ctx, u, c)
	}
	how := claimCreated
	if !created {
		how = claimSubject
	}
	sess, had, err := s.open(ctx, q, u, c, map[string]any{"via": linkViaTicket, "provider": t.Identity.Provider, "account": how})
	if err != nil {
		return NativeSignInResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		if isUniqueViolation(err) {
			return NativeSignInResult{}, errSignInAccountConflict()
		}
		return NativeSignInResult{}, err
	}
	if created && !u.EmailVerifiedAt.Valid {
		s.auth.sendVerificationAfterSignUp(ctx, u.ID)
	}
	if !created {
		s.tell(ctx, u, c, had)
	}
	return NativeSignInResult{Status: NativeSignedIn, Session: sess}, nil
}

// SendEmailClaim is "I was invited with another address" in the app: the
// browser's command (the same answer whether the address has an account or
// not, one code a minute per ticket) on the app's ticket.
func (s *NativeSignInService) SendEmailClaim(ctx context.Context, ticket, nonce, email, locale string, c NativeClient) error {
	if err := s.door(c); err != nil {
		return err
	}
	return s.tickets.SendEmailClaim(ctx, ticket, c.ticket(nonce), email, locale)
}

// DiscardTicket is the app dropping a ticket it will not spend: "Hủy" on the
// choice screen, "Không liên kết" on the link step, the second provider's
// ticket in link mode (spec §3.2). As the browser's DELETE
// /auth/sign-in-ticket, the Apple consent the ticket carries goes back to
// Apple, so an Apple ID that opened no account keeps no authorization for
// the app. The ticket opens only with its own nonce, client and deployment;
// one that does not open (gone, expired, another binding) is answered the
// same, saying nothing about it.
func (s *NativeSignInService) DiscardTicket(ctx context.Context, ticket, nonce string, c NativeClient) error {
	if err := s.door(c); err != nil {
		return err
	}
	s.tickets.Discard(ctx, ticket, c.ticket(nonce))
	return nil
}

// VerifyEmailClaim checks the code mailed to the other address and acts on
// it as the browser's does (claimQ: link into the verified account the
// address holds, after its second factor when it has one; take back an
// unverified one; else open a new account with the address verified), on
// the app's ticket, audited via email_claim, ending in the app's device
// session or challenge. A wrong code is 400 invalid_code, and five of them
// spend it.
func (s *NativeSignInService) VerifyEmailClaim(ctx context.Context, ticket, nonce, email, code, displayName, locale string, c NativeClient) (NativeSignInResult, error) {
	if err := s.door(c); err != nil {
		return NativeSignInResult{}, err
	}
	ctx = c.context(ctx)
	t, err := s.auth.openSignInTicket(ticket, c.ticket(nonce))
	if err != nil {
		return NativeSignInResult{}, err
	}
	if email, err = claimedAddress(email); err != nil {
		return NativeSignInResult{}, err
	}
	if strings.TrimSpace(displayName) != "" {
		if _, err := ticketDisplayName(displayName, t.Identity); err != nil {
			return NativeSignInResult{}, err
		}
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return NativeSignInResult{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	q := s.q.WithTx(tx)
	claim, err := s.tickets.claimQ(ctx, q, t, ticketHash(ticket), email, code, displayName, locale)
	if err != nil {
		return NativeSignInResult{}, err
	}
	if claim.wrong {
		if err := tx.Commit(ctx); err != nil {
			return NativeSignInResult{}, err
		}
		return NativeSignInResult{}, ErrInvalidCode
	}
	if claim.user.MfaEnabledAt.Valid {
		// The code is spent with this commit; the identity rides in the
		// app's challenge and is linked once the second factor passes.
		if err := tx.Commit(ctx); err != nil {
			return NativeSignInResult{}, err
		}
		if !claim.pending {
			return s.challenge(ctx, claim.user, c)
		}
		sess, err := s.auth.challengeWithPendingLink(ctx, claim.user, t.Identity, linkViaEmailClaim, c.challenge())
		if err != nil {
			return NativeSignInResult{}, err
		}
		return NativeSignInResult{Status: NativeMFARequired, MFAToken: sess.MFAToken}, nil
	}
	sess, had, err := s.open(ctx, q, claim.user, c, map[string]any{"via": linkViaEmailClaim, "provider": t.Identity.Provider, "account": claim.how})
	if err != nil {
		return NativeSignInResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		if isUniqueViolation(err) {
			return NativeSignInResult{}, errSignInAccountConflict()
		}
		return NativeSignInResult{}, err
	}
	s.auth.signInMailer().kick(claim.queued)
	out := NativeSignInResult{Status: NativeSignedIn, Session: sess}
	switch claim.how {
	case claimReclaim:
		observeOfficeLeaseRevokes(OfficeLeaseRevokeSessionRevoked, claim.reclaim.leases)
		s.auth.apple.revokeAfterCommit(ctx, claim.user.ID, claim.reclaim.appleClientID, claim.reclaim.appleToken)
		out.Reclaimed = true
	case claimLinked, claimSubject:
		s.tell(ctx, claim.user, c, had)
	}
	return out, nil
}

// LinkTicket is "I already have an account" in the app once the person
// signed in there: the browser's ticket link (SignInTicketService.Link) with
// the app's ticket and the app's bearer — a device session that started
// after the ticket was issued, from the ticket's own client and deployment,
// or a step-up token of that device session; 403 proof_required otherwise.
func (s *NativeSignInService) LinkTicket(ctx context.Context, ticket, nonce string, in TicketLink, c NativeClient) (SignInMethodsChange, error) {
	if err := s.door(c); err != nil {
		return SignInMethodsChange{}, err
	}
	return s.tickets.Link(c.context(ctx), ticket, c.ticket(nonce), in)
}
