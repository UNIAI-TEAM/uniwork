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
// factor is not written at the first step (ADR 0047 §2): it rides in the
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

// pendingLinkBlob is what the pending link seals; v versions the shape.
type pendingLinkBlob struct {
	V        int              `json:"v"`
	Identity ProviderIdentity `json:"identity"`
}

const pendingLinkVersion = 1

func (s *AuthService) sealPendingLink(id ProviderIdentity) (string, error) {
	raw, err := json.Marshal(pendingLinkBlob{V: pendingLinkVersion, Identity: id})
	if err != nil {
		return "", err
	}
	return s.sealer.SealFor(auth.PurposeMFAPendingLink, string(raw))
}

func (s *AuthService) openPendingLink(sealed string) (ProviderIdentity, error) {
	raw, err := s.sealer.OpenFor(auth.PurposeMFAPendingLink, sealed)
	if err != nil {
		return ProviderIdentity{}, err
	}
	var b pendingLinkBlob
	if err := json.Unmarshal([]byte(raw), &b); err != nil {
		return ProviderIdentity{}, err
	}
	if b.V != pendingLinkVersion || b.Identity.Subject == "" {
		return ProviderIdentity{}, fmt.Errorf("pending link: unknown shape v%d", b.V)
	}
	return b.Identity, nil
}

// challengeWithPendingLink answers a provider sign-in that resolved to a
// link into u, whose second factor is on: the web challenge, carrying the
// identity to link once the factor passes.
func (s *AuthService) challengeWithPendingLink(ctx context.Context, u db.User, id ProviderIdentity) (Session, error) {
	blob, err := s.sealPendingLink(id)
	if err != nil {
		return Session{}, err
	}
	tok, err := s.minter.MintMFA(auth.MFAChallenge{UserID: u.ID, Channel: auth.MFAChannelWeb, PendingLink: blob})
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
// since the first step, so the identity is resolved again and linked only
// when it still resolves to a link into this very account; any other answer
// skips the link and the sign-in goes on. It runs in a savepoint: a link the
// database refuses (the subject taken meanwhile) must not abort the
// transaction the session is opened in.
func (s *AuthService) finishPendingLink(ctx context.Context, tx pgx.Tx, u db.User, sealed string) (pendingLinkOutcome, error) {
	out := pendingLinkOutcome{user: u}
	id, err := s.openPendingLink(sealed)
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
