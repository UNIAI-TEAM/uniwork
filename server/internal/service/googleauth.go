package service

import (
	"context"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/mail"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// GoogleClaims is what the handler extracts from a verified Google ID token.
type GoogleClaims = auth.GoogleClaims

// GoogleAuthService turns verified Google identities into sessions. The
// OAuth exchange and token verification (PKCE, nonce) happen in the handler
// layer; this service only decides, through resolveIdentity, which account
// the identity maps to. The owner alerts go through the AuthService's mail.
type GoogleAuthService struct {
	pool *pgxpool.Pool
	q    *db.Queries
	auth *AuthService
}

func NewGoogleAuthService(pool *pgxpool.Pool, q *db.Queries, auth *AuthService) *GoogleAuthService {
	return &GoogleAuthService{pool: pool, q: q, auth: auth}
}

// ProviderSignInResult is how a browser provider sign-in ended: a session,
// or the MFA challenge in its place (Session.MFAPending), and whether it took
// the account back from someone who registered the address before proving it
// (the client says so once).
type ProviderSignInResult struct {
	Session   Session
	Reclaimed bool
}

func (s *GoogleAuthService) mailer() signInMailer {
	return signInMailer{render: s.auth.render, out: s.auth.out, now: s.auth.now}
}

// SignIn resolves the account with resolveIdentity, inside one transaction
// with whatever the answer writes:
//
//   - matched: the account linked to the subject;
//   - unmatched: a new password-less account, its address verified only when
//     Google owns it (else a verification code is mailed, as for a password
//     sign-up);
//   - reclaim: the account registered with the address before it was proved
//     is taken back, its second factor never asked;
//   - link: a verified account with the address Google owns gets the link,
//     audited and told to its owner. An account with a second factor is not
//     linked: it gets its challenge and stays as it was.
//
// link_required refuses (sign_in_account_conflict): the account is someone's
// and only its owner, signed in, may add Google to it.
// ponytail: unmatched and link_required become a sign-in ticket and the
// choice screen (spec §3.2), and the MFA account's link waits for the second
// factor (spec §3.3); until then this creates and refuses as above.
func (s *GoogleAuthService) SignIn(ctx context.Context, c GoogleClaims, locale string) (ProviderSignInResult, error) {
	id := googleIdentity(c)
	m := s.mailer()
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
	)
	switch res.kind {
	case identityMatched:
		u = res.user
	case identityUnmatched:
		if u, err = createProviderUser(ctx, q, id, locale, id.EmailAuthoritative); err != nil {
			return ProviderSignInResult{}, err
		}
	case identityReclaim:
		if reclaim, err = reclaimAccount(ctx, q, res.user, id, m, device); err != nil {
			return ProviderSignInResult{}, err
		}
		u, queued = reclaim.user, reclaim.queued
	case identityLink:
		if res.user.MfaEnabledAt.Valid {
			u = res.user
			break
		}
		if u, queued, err = linkByEmail(ctx, q, res.user, id, m, device); err != nil {
			return ProviderSignInResult{}, err
		}
	default: // identityLinkRequired
		return ProviderSignInResult{}, errSignInAccountConflict()
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
		s.auth.apple.revokeAfterCommit(ctx, u.ID, reclaim.appleClientID, reclaim.appleToken)
	}
	if !u.EmailVerifiedAt.Valid && res.kind == identityUnmatched && s.auth.verification != nil {
		if err := s.auth.verification.Send(ctx, u.ID); err != nil {
			slog.Warn("send verification code after google sign-up", "user", u.ID, "err", err)
		}
	}
	// A reclaim cleared the second factor in the transaction above, so the
	// session comes without a challenge: whoever registered set it up.
	sess, err := s.auth.SessionFor(ctx, u)
	if err != nil {
		return ProviderSignInResult{}, err
	}
	return ProviderSignInResult{Session: sess, Reclaimed: reclaimedIt}, nil
}
