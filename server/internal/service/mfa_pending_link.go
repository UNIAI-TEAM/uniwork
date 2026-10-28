package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/mail"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// A provider identity that resolves to a link into an account with a second
// factor is not written at the first step (ADR 0049 §2): it rides in the
// challenge token as the pending link (claim pl, sealed for
// mfa_pending_link) and is linked only in the transaction that opens the
// session once the second factor passed (spec §3.3).

// The codes Session.LinkSkipped carries besides the resolver's own refusals
// (sign_in_email_unverified, sign_in_account_unverified,
// sign_in_account_conflict): the sign-in went through, the identity was not
// linked, and the client says so ("try again in Settings").
const (
	// linkSkippedTaken: the identity opens another account now.
	linkSkippedTaken = "sign_in_method_taken"
	// linkSkippedLinkRequired: the identity may join this account only from
	// its Settings now (its owner unlinked this very subject meanwhile).
	linkSkippedLinkRequired = "link_required"
	// linkSkippedFailed: the pending link could not be read (the server's
	// secret changed while the challenge was out).
	linkSkippedFailed = "sign_in_failed"
)

// pendingLinkBlob is what the pending link seals; v versions the shape. Via
// is how the first step tied the identity to the account: email_match (the
// provider owns the address the account holds; empty in a challenge minted
// before via existed) or email_claim (a code mailed to the account's address
// proved it, "I was invited with another address").
type pendingLinkBlob struct {
	V        int              `json:"v"`
	Identity ProviderIdentity `json:"identity"`
	Via      string           `json:"via,omitempty"`
}

const pendingLinkVersion = 1

// pendingLink is an opened pending link.
type pendingLink struct {
	identity ProviderIdentity
	via      string
}

func (s *AuthService) sealPendingLink(id ProviderIdentity, via string) (string, error) {
	raw, err := json.Marshal(pendingLinkBlob{V: pendingLinkVersion, Identity: id, Via: via})
	if err != nil {
		return "", err
	}
	return s.sealer.SealFor(auth.PurposeMFAPendingLink, string(raw))
}

func (s *AuthService) openPendingLink(sealed string) (pendingLink, error) {
	raw, err := s.sealer.OpenFor(auth.PurposeMFAPendingLink, sealed)
	if err != nil {
		return pendingLink{}, err
	}
	var b pendingLinkBlob
	if err := json.Unmarshal([]byte(raw), &b); err != nil {
		return pendingLink{}, err
	}
	if b.V != pendingLinkVersion || b.Identity.Subject == "" {
		return pendingLink{}, fmt.Errorf("pending link: unknown shape v%d", b.V)
	}
	switch b.Via {
	case "", linkViaEmailMatch:
		return pendingLink{identity: b.Identity, via: linkViaEmailMatch}, nil
	case linkViaEmailClaim:
		return pendingLink{identity: b.Identity, via: linkViaEmailClaim}, nil
	default:
		return pendingLink{}, fmt.Errorf("pending link: unknown via %q", b.Via)
	}
}

// challengeWithPendingLink answers a sign-in that resolved to a link into
// u, whose second factor is on: the challenge for ch's channel, carrying the
// identity to link once the factor passes and how the first step tied it to
// u (via).
func (s *AuthService) challengeWithPendingLink(ctx context.Context, u db.User, id ProviderIdentity, via string, ch auth.MFAChallenge) (Session, error) {
	blob, err := s.sealPendingLink(id, via)
	if err != nil {
		return Session{}, err
	}
	ch.UserID, ch.PendingLink = u.ID, blob
	tok, err := s.minter.MintMFA(ch)
	if err != nil {
		return Session{}, err
	}
	return Session{User: s.decorateAvatar(ctx, u), MFAToken: tok}, nil
}

// pendingLinkOutcome is what finishPendingLink did.
type pendingLinkOutcome struct {
	// user is the account as the link left it.
	user db.User
	// skipped is why the identity was not linked; "" when it was, or already
	// is.
	skipped string
	// queued: the owner's link notice was queued; kick after commit.
	queued bool
}

// finishPendingLink links the identity a challenge carried into u (locked by
// the caller in tx) after its second factor passed. Five minutes went by
// since the first step, so the link is decided again and written only when
// it still holds for this very account; any other answer skips the link and
// the sign-in goes on. It runs in a savepoint: a link the database refuses
// (the subject taken meanwhile) must not abort the transaction the session is
// opened in.
func (s *AuthService) finishPendingLink(ctx context.Context, tx pgx.Tx, u db.User, sealed string) (pendingLinkOutcome, error) {
	out := pendingLinkOutcome{user: u}
	pl, err := s.openPendingLink(sealed)
	if err != nil {
		out.skipped = linkSkippedFailed
		return out, nil
	}
	sp, err := tx.Begin(ctx)
	if err != nil {
		return out, err
	}
	defer sp.Rollback(ctx) //nolint:errcheck
	q := s.q.WithTx(sp)
	if pl.via == linkViaEmailClaim {
		return s.finishClaimedLink(ctx, sp, q, u, pl.identity)
	}
	id := pl.identity
	var refused CodedError
	res, err := resolveIdentity(ctx, q, id)
	if errors.As(err, &refused) {
		out.skipped = refused.Code
		return out, nil
	}
	if err != nil {
		return out, err
	}
	switch {
	case res.kind == identityMatched && res.user.ID == u.ID:
		// Linked meanwhile (the same sign-in finished twice): nothing to do.
		return out, nil
	case res.kind == identityMatched:
		out.skipped = linkSkippedTaken
		return out, nil
	case res.kind == identityLinkRequired && res.user.ID == u.ID:
		out.skipped = linkSkippedLinkRequired
		return out, nil
	case res.kind != identityLink || res.user.ID != u.ID:
		// The address moved to another account, or the account no longer
		// holds it.
		out.skipped = ErrSignInAccountConflict.Error()
		return out, nil
	}
	linked, queued, err := linkByEmail(ctx, q, u, id, s.signInMailer(), mail.SafeField(sessionMetaFrom(ctx).UserAgent))
	if errors.As(err, &refused) {
		out.skipped = refused.Code
		return out, nil
	}
	if err != nil {
		return out, err
	}
	if err := sp.Commit(ctx); err != nil {
		return out, err
	}
	out.user, out.queued = linked, queued
	return out, nil
}

// finishClaimedLink is finishPendingLink for an identity a mailed code tied
// to u ("I was invited with another address"): the provider's address is not
// u's, so resolving it again proves nothing; the code proved u's mailbox, and
// what is left to check is that the identity still opens no account and u
// holds no other subject of the provider. sp is the savepoint q runs in.
func (s *AuthService) finishClaimedLink(ctx context.Context, sp pgx.Tx, q *db.Queries, u db.User, id ProviderIdentity) (pendingLinkOutcome, error) {
	out := pendingLinkOutcome{user: u}
	holder, err := userBySubject(ctx, q, id)
	switch {
	case err == nil && holder.ID == u.ID:
		return out, nil
	case err == nil:
		out.skipped = linkSkippedTaken
		return out, nil
	case !errors.Is(err, pgx.ErrNoRows):
		return out, err
	}
	linked, err := linkIdentity(ctx, q, u.ID, id)
	var refused CodedError
	if errors.As(err, &refused) {
		out.skipped = refused.Code
		return out, nil
	}
	if err != nil {
		return out, err
	}
	if err := keepAppleConsent(ctx, q, u.ID, id); err != nil {
		return out, err
	}
	if err := recordLinked(ctx, q, u.ID, id.Provider, linkViaEmailClaim, nil); err != nil {
		return out, err
	}
	queued, err := queueLinkedNotices(ctx, q, s.signInMailer(), linked, id, mail.SignInChangeLinked, mail.SafeField(sessionMetaFrom(ctx).UserAgent))
	if err != nil {
		return out, err
	}
	if err := sp.Commit(ctx); err != nil {
		return out, err
	}
	out.user, out.queued = linked, queued
	return out, nil
}
