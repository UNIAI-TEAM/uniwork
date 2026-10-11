package service

import (
	"context"
	"encoding/base64"
	"errors"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/oauth2"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// emailHubAccessTokenSkew: an access token closer than this to its expiry is
// refreshed first, so no IMAP or SMTP session starts on one about to lapse.
const emailHubAccessTokenSkew = 2 * time.Minute

var (
	// errEmailHubOAuthNotConfigured: the account signs in with a provider whose
	// EMAIL_HUB_* client is no longer set. Transient: restoring the env brings
	// the account back without a reconnect.
	errEmailHubOAuthNotConfigured = errors.New("email hub oauth provider not configured")
	// errEmailHubOAuthRefreshFailed stands for every refresh failure but a
	// refused grant. oauth2 folds the provider's reply into its error text, so
	// that text never leaves this file.
	errEmailHubOAuthRefreshFailed = errors.New("email hub oauth refresh failed")
)

// refreshLock keeps one process from refreshing the same grant twice; two
// pods are fenced by the conditional write instead.
func (s *EmailHubService) refreshLock(accountID string) *sync.Mutex {
	// shortcut: one mutex per account ever refreshed here, never freed; bounded by the account count, prune if that grows large.
	m, _ := s.refreshLocks.LoadOrStore(accountID, &sync.Mutex{})
	return m.(*sync.Mutex)
}

// sealSecret seals v the way password_enc and the oauth_* columns hold it.
func (s *EmailHubService) sealSecret(v string) (string, error) {
	sealed, err := s.box.Seal([]byte(v))
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(sealed), nil
}

// oauthAccessToken returns a usable access token for an oauth_* account. It
// refreshes the token when it is within the skew of expiry (spec §4.4).
func (s *EmailHubService) oauthAccessToken(ctx context.Context, acc db.EmailHubAccount) (string, error) {
	if token, ok, err := s.freshAccessToken(acc); ok || err != nil {
		return token, err
	}
	p, ok := s.oauthByKind(acc.AuthKind)
	if !ok {
		return "", errEmailHubOAuthNotConfigured
	}
	mu := s.refreshLock(acc.ID)
	mu.Lock()
	defer mu.Unlock()
	// The caller's snapshot may be old (the watcher keeps one); the row decides.
	read, err := s.rereadEmailHubAccount(ctx, acc)
	if err != nil {
		return "", err
	}
	if token, ok, err := s.freshAccessToken(read); ok || err != nil {
		return token, err // another caller on this process refreshed while this one waited
	}
	refresh, err := s.openPassword(read.OauthRefreshTokenEnc)
	if err != nil {
		return "", err
	}
	tok, err := p.config.TokenSource(s.oauthCtx(ctx), &oauth2.Token{RefreshToken: refresh}).Token()
	if err != nil {
		return s.oauthRefreshFailed(ctx, read, err)
	}
	accessEnc, err := s.sealSecret(tok.AccessToken)
	if err != nil {
		return "", err
	}
	var refreshEnc string            // empty keeps the stored one
	if tok.RefreshToken != refresh { // Microsoft rotates; oauth2 echoes the old one when none comes back
		if refreshEnc, err = s.sealSecret(tok.RefreshToken); err != nil {
			return "", err
		}
	}
	n, err := s.q.UpdateEmailHubAccountOAuthTokens(ctx, db.UpdateEmailHubAccountOAuthTokensParams{
		ID: read.ID, OrganizationID: read.OrganizationID,
		CredentialVersion: read.CredentialVersion, PrevExpiresAt: read.OauthAccessExpiresAt,
		AccessEnc: accessEnc, ExpiresAt: pgtype.Timestamptz{Time: tok.Expiry, Valid: !tok.Expiry.IsZero()},
		RefreshEnc: refreshEnc,
	})
	if err != nil {
		return "", err
	}
	if n == 0 {
		// Another pod refreshed first, or a reconnect, disconnect or auth failure
		// replaced the row. The token just received is dropped, not revoked:
		// revoking a Google access token also revokes the grant the winner holds.
		return s.currentAccessToken(ctx, read)
	}
	return tok.AccessToken, nil
}

// oauthRefreshFailed sorts a failed refresh. A refused grant marks the account
// only when the row still holds what this refresh read. If another pod wrote
// a token since (Microsoft may have rotated the grant this one sent), or a
// reconnect replaced the credential, that token is used instead. Anything else
// is transient and changes nothing.
func (s *EmailHubService) oauthRefreshFailed(ctx context.Context, read db.EmailHubAccount, err error) (string, error) {
	var re *oauth2.RetrieveError
	if !errors.As(err, &re) || (re.ErrorCode != "invalid_grant" && re.ErrorCode != "unauthorized_client") {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return "", ctxErr
		}
		return "", errEmailHubOAuthRefreshFailed
	}
	current, err := s.rereadEmailHubAccount(ctx, read)
	if err != nil {
		return "", err
	}
	if current.CredentialVersion != read.CredentialVersion || current.OauthRefreshTokenEnc != read.OauthRefreshTokenEnc ||
		!sameEmailHubExpiry(current.OauthAccessExpiresAt, read.OauthAccessExpiresAt) {
		return s.accessTokenOf(current)
	}
	s.markAuthFailed(ctx, read, read.CredentialVersion, "oauth_invalid_grant")
	return "", ErrEmailHubReauthRequired
}

// currentAccessToken answers with the token the row holds now, written by
// another pod's refresh or by a reconnect.
func (s *EmailHubService) currentAccessToken(ctx context.Context, acc db.EmailHubAccount) (string, error) {
	row, err := s.rereadEmailHubAccount(ctx, acc)
	if err != nil {
		return "", err
	}
	return s.accessTokenOf(row)
}

// accessTokenOf is row's fresh access token. Without one, the credential the
// caller held is gone (for example, reconnected with a password).
func (s *EmailHubService) accessTokenOf(row db.EmailHubAccount) (string, error) {
	token, ok, err := s.freshAccessToken(row)
	if err != nil {
		return "", err
	}
	if !ok {
		return "", ErrEmailHubReauthRequired
	}
	return token, nil
}

// freshAccessToken opens acc's access token when it outlives the skew. ok is
// false when the token is missing or about to lapse.
func (s *EmailHubService) freshAccessToken(acc db.EmailHubAccount) (token string, ok bool, err error) {
	exp := acc.OauthAccessExpiresAt
	if acc.OauthAccessTokenEnc == "" || !exp.Valid || time.Until(exp.Time) <= emailHubAccessTokenSkew {
		return "", false, nil
	}
	token, err = s.openPassword(acc.OauthAccessTokenEnc)
	return token, err == nil, err
}

// rereadEmailHubAccount is the row as it is now. A disconnected or failed row
// answers ErrEmailHubReauthRequired.
func (s *EmailHubService) rereadEmailHubAccount(ctx context.Context, acc db.EmailHubAccount) (db.EmailHubAccount, error) {
	row, err := s.q.GetEmailHubAccount(ctx, db.GetEmailHubAccountParams{
		ID: acc.ID, UserID: acc.UserID, OrganizationID: acc.OrganizationID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return row, ErrEmailHubReauthRequired
	}
	if err != nil {
		return row, err
	}
	if row.AuthFailedAt.Valid {
		return row, ErrEmailHubReauthRequired
	}
	return row, nil
}

func sameEmailHubExpiry(a, b pgtype.Timestamptz) bool {
	return a.Valid == b.Valid && (!a.Valid || a.Time.Equal(b.Time))
}
