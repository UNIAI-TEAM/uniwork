package service

import (
	"context"

	"github.com/unicomhub/uniwork/server/internal/auth"
)

// GoogleClaims is what the handler extracts from a verified Google ID token.
type GoogleClaims = auth.GoogleClaims

// GoogleAuthService turns verified Google identities into sessions. The
// OAuth exchange and token verification (PKCE, nonce) happen in the handler
// layer; this service only decides, through the provider sign-in every
// browser door shares (webProviderSignIn), which account the identity maps
// to. The owner alerts go through the AuthService's mail.
type GoogleAuthService struct {
	auth *AuthService
}

func NewGoogleAuthService(auth *AuthService) *GoogleAuthService {
	return &GoogleAuthService{auth: auth}
}

// GoogleIdentity is the person a verified Google ID token vouches for, as
// every provider sign-in and link reads it (ADR 0047): the address is
// Google's to vouch for only on Gmail or the Workspace's own domain (hd).
func GoogleIdentity(c GoogleClaims) ProviderIdentity { return googleIdentity(c) }

// SignIn is the Google callback's sign-in (webProviderSignIn): a session, an
// MFA challenge, or a ticket for the choice screen; intent sign_up creates
// an unmatched identity's account at once.
func (s *GoogleAuthService) SignIn(ctx context.Context, c GoogleClaims, locale, intent string) (ProviderSignInResult, error) {
	return s.auth.webProviderSignIn(ctx, googleIdentity(c), locale, intent)
}
