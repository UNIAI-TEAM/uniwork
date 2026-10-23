package service

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"golang.org/x/oauth2"
)

// emailHubOAuthStateTTL bounds one sign-in: the sealed state and the nonce
// cookie both expire after it (spec §5.3, §7).
const emailHubOAuthStateTTL = 10 * time.Minute

// emailHubOAuthState is sealed with the Email Hub box into the OAuth state
// parameter. The callback trusts nothing else about who started the sign-in,
// and the PKCE verifier lives only here, never in a URL or a cookie.
type emailHubOAuthState struct {
	UserID         string `json:"user_id"`
	OrganizationID string `json:"organization_id"`
	WorkspaceID    string `json:"workspace_id"`
	Provider       string `json:"provider"`
	Nonce          string `json:"nonce"`
	Verifier       string `json:"verifier"`
	Exp            int64  `json:"exp"`
}

// StartOAuth begins a Google/Microsoft sign-in for the caller's mailbox (spec
// §5.3). Membership answers first. A provider without an Email Hub OAuth client
// is 404. It returns the provider URL, and the nonce the handler puts in the
// HttpOnly cookie that the callback compares with the sealed state.
func (s *EmailHubService) StartOAuth(ctx context.Context, actor Actor, workspaceID, provider, loginHint string) (authURL, nonce string, err error) {
	ws, err := s.workspace(ctx, actor, workspaceID)
	if err != nil {
		return "", "", err
	}
	p, ok := s.oauthProvider(provider)
	if !ok {
		return "", "", ErrNotFound
	}
	// The SDI's maxLength is documentation only; the hint ends up in a URL.
	loginHint = strings.TrimSpace(loginHint)
	if utf8.RuneCountInString(loginHint) > 320 || strings.IndexFunc(loginHint, unicode.IsControl) >= 0 {
		return "", "", Invalid("invalid login hint")
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", "", err
	}
	nonce = base64.RawURLEncoding.EncodeToString(raw)
	verifier := oauth2.GenerateVerifier()
	plain, err := json.Marshal(emailHubOAuthState{
		UserID: actor.ID, OrganizationID: ws.OrganizationID, WorkspaceID: workspaceID,
		Provider: p.name, Nonce: nonce, Verifier: verifier,
		Exp: time.Now().Add(emailHubOAuthStateTTL).Unix(),
	})
	if err != nil {
		return "", "", err
	}
	sealed, err := s.box.Seal(plain)
	if err != nil {
		return "", "", err
	}
	opts := []oauth2.AuthCodeOption{oauth2.AccessTypeOffline, oauth2.S256ChallengeOption(verifier)}
	if p.prompt != "" {
		opts = append(opts, oauth2.SetAuthURLParam("prompt", p.prompt))
	}
	if loginHint != "" {
		opts = append(opts, oauth2.SetAuthURLParam("login_hint", loginHint))
	}
	return p.config.AuthCodeURL(base64.RawURLEncoding.EncodeToString(sealed), opts...), nonce, nil
}

// openOAuthState opens a state StartOAuth sealed. It is false for anything
// this box did not seal, a state without a nonce (an empty cookie must never
// match it), and an expired state. The caller still checks the provider.
func (s *EmailHubService) openOAuthState(raw string) (emailHubOAuthState, bool) {
	if s.box == nil {
		return emailHubOAuthState{}, false
	}
	sealed, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return emailHubOAuthState{}, false
	}
	plain, err := s.box.Open(sealed)
	if err != nil {
		return emailHubOAuthState{}, false
	}
	var st emailHubOAuthState
	if json.Unmarshal(plain, &st) != nil || st.Nonce == "" || time.Now().Unix() > st.Exp {
		return emailHubOAuthState{}, false
	}
	return st, true
}
