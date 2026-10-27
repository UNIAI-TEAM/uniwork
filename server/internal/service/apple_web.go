package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/auth"
)

// Sign in with Apple on the web (ADR 0047 §7, spec §3.4). The browser goes to
// Apple from GET /auth/apple/start; Apple posts the authorization code back
// to the return URL; WebIdentity redeems it with the Services ID's client
// secret and the return URL, and checks the identity token with the web's
// own verifier, whose only audience is the Services ID (never one of the
// app's bundle ids); WebSignIn then signs in through the provider sign-in
// every browser door shares (webProviderSignIn).

// AppleWebTokenClient redeems a web authorization code; auth.AppleClient in
// production.
type AppleWebTokenClient interface {
	ExchangeWebCode(ctx context.Context, clientID, code, redirectURI string) (auth.AppleWebTokens, error)
}

// AppleWeb is the web door: the Services ID (grouped with the app's primary
// App ID, so a person's subject is the one the app sees), the return URL
// registered on it, the verifier whose only audience is the Services ID,
// and the client that redeems its codes.
type AppleWeb struct {
	ServicesID  string
	RedirectURI string
	Verifier    AppleTokenVerifier
	Client      AppleWebTokenClient
}

// ErrAppleWebSignIn: Apple's answer proves no one (a code Apple would not
// redeem, an identity token that is not this sign-in's). The error wraps
// the reason, which never carries a token or a code.
var ErrAppleWebSignIn = errors.New("apple web sign-in failed")

// maxAppleUserField caps the unsigned user field read for the name.
const maxAppleUserField = 4 << 10

// SetWeb opens the web door; a answers its sign-ins with the browser's
// sessions, second-factor challenges and sign-in tickets.
func (s *AppleAuthService) SetWeb(a *AuthService, w AppleWeb) {
	s.auth, s.web = a, w
}

// NativeEnabled: the app's identity tokens can be checked
// (APPLE_SIWA_AUDIENCES), so POST /auth/apple/native takes them.
func (s *AppleAuthService) NativeEnabled() bool { return s != nil && s.verifier != nil }

// WebEnabled: the web door is configured (the Services ID and the key that
// signs its client secret).
func (s *AppleAuthService) WebEnabled() bool {
	return s != nil && s.auth != nil && s.web.ServicesID != "" && s.web.RedirectURI != "" &&
		s.web.Verifier != nil && s.web.Client != nil
}

// WebAuthorizeURL is Apple's authorization page for one browser sign-in:
// state comes back with the form post, and the identity token must carry
// the hash of rawNonce, which only the sealed state cookie holds.
func (s *AppleAuthService) WebAuthorizeURL(state, rawNonce string) string {
	return auth.AppleWebAuthorizeURL(auth.AppleIssuer, s.web.ServicesID, s.web.RedirectURI, state, auth.AppleNonceHash(rawNonce))
}

// WebIdentity is the person behind the authorization code Apple posted back:
// the code is redeemed for the Services ID with the return URL it was issued
// for, and the identity token in the answer must be the web's (audience the
// Services ID) and this sign-in's (nonce). The address comes only from the
// token; user, Apple's unsigned first-sign-in field, gives the name, a mere
// suggestion for a new profile. The refresh token rides in the identity,
// sealed, for whatever the sign-in opens to keep (or give back).
func (s *AppleAuthService) WebIdentity(ctx context.Context, code, rawNonce, user string) (ProviderIdentity, error) {
	if code == "" || rawNonce == "" {
		return ProviderIdentity{}, fmt.Errorf("%w: no code", ErrAppleWebSignIn)
	}
	callCtx, cancel := context.WithTimeout(ctx, appleCallTimeout)
	defer cancel()
	tokens, err := s.web.Client.ExchangeWebCode(callCtx, s.web.ServicesID, code, s.web.RedirectURI)
	if err != nil {
		return ProviderIdentity{}, fmt.Errorf("%w: code exchange: %s", ErrAppleWebSignIn, appleErrorCode(err))
	}
	claims, err := s.web.Verifier.Verify(ctx, tokens.IDToken, rawNonce)
	if err != nil {
		// Whose consent the refresh token is cannot be told from a token that
		// failed: it is dropped, never kept and never revoked on a guess.
		reason := "unknown"
		var te auth.AppleTokenError
		if errors.As(err, &te) {
			reason = te.Reason
		}
		return ProviderIdentity{}, fmt.Errorf("%w: identity token: %s", ErrAppleWebSignIn, reason)
	}
	sealed := ""
	if tokens.RefreshToken != "" {
		if sealed, err = s.sealer.Seal(tokens.RefreshToken); err != nil {
			s.log.Warn("apple refresh token not sealed", "code", "seal")
			s.revoke(ctx, "", claims.Audience, tokens.RefreshToken)
			sealed = ""
		}
	}
	given, family := appleWebName(user)
	return appleIdentity(claims, given, family, sealed), nil
}

// appleWebName reads the name from Apple's user field, which Apple posts
// only on the first authorization: {"name":{"firstName","lastName"},
// "email"}. Nothing signs it, so the address in it is never read, and a
// field that does not parse gives no name.
func appleWebName(user string) (given, family string) {
	if user == "" || len(user) > maxAppleUserField {
		return "", ""
	}
	var u struct {
		Name struct {
			FirstName string `json:"firstName"`
			LastName  string `json:"lastName"`
		} `json:"name"`
	}
	if err := json.Unmarshal([]byte(user), &u); err != nil {
		return "", ""
	}
	return u.Name.FirstName, u.Name.LastName
}

// WebSignIn is Sign in with Apple's finish on the web: the identity
// WebIdentity proved, through the provider sign-in every browser door shares
// (webProviderSignIn) — a session, a challenge, or a ticket; intent sign_up
// creates an unmatched identity's account at once. A refusal gives the
// consent the sign-in brought back to Apple unless the Apple ID opens an
// account.
func (s *AppleAuthService) WebSignIn(ctx context.Context, id ProviderIdentity, locale, intent string) (ProviderSignInResult, error) {
	if !s.WebEnabled() || id.Provider != ProviderApple {
		return ProviderSignInResult{}, fmt.Errorf("%w: not an Apple identity", ErrAppleWebSignIn)
	}
	res, err := s.auth.webProviderSignIn(ctx, id, locale, intent)
	if err != nil {
		s.giveBack(ctx, id)
	}
	return res, err
}

// giveBack returns to Apple the consent an Apple identity arrived with when
// the sign-in or link it came for kept it nowhere, as the legacy route does
// for a sign-in that did not happen: unless the Apple ID opens an account,
// which keeps a consent of its own, the token is revoked rather than
// orphaned. Best effort, after any transaction.
func (s *AppleAuthService) giveBack(ctx context.Context, id ProviderIdentity) {
	if s == nil || id.Provider != ProviderApple || id.AppleRefresh == "" {
		return
	}
	if _, err := userBySubject(ctx, s.q, id); !errors.Is(err, pgx.ErrNoRows) {
		return
	}
	s.revokeAfterCommit(ctx, "", id.AppleClientID, id.AppleRefresh)
}
