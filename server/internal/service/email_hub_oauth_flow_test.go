package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/url"
	"strings"
	"testing"
	"time"

	"golang.org/x/oauth2"

	"github.com/unicomhub/uniwork/server/internal/util"
)

// Membership answers before the provider switch: an outsider hears 403 whether
// or not the provider is on, and only a member learns it is off (spec §5.3 step 1).
func TestEmailHubStartOAuthRequiresMemberFirst(t *testing.T) {
	svc, _, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()

	if _, _, err := svc.StartOAuth(ctx, Human(util.NewID()), ws.ID, "google", ""); !errors.Is(err, ErrForbidden) {
		t.Fatalf("non-member on a disabled provider: %v, want ErrForbidden", err)
	}
	if _, _, err := svc.StartOAuth(ctx, Human(user.ID), ws.ID, "google", ""); !errors.Is(err, ErrNotFound) {
		t.Fatalf("member on a disabled provider: %v, want ErrNotFound", err)
	}
	svc.ConfigureOAuth(emailHubOAuthTestConfig())
	if u, nonce, err := svc.StartOAuth(ctx, Human(util.NewID()), ws.ID, "google", ""); !errors.Is(err, ErrForbidden) || u != "" || nonce != "" {
		t.Fatalf("non-member on an enabled provider: url=%q nonce=%q err=%v", u, nonce, err)
	}
}

// Only Email Hub's own providers start; the calendar's "outlook" is not one,
// and without the credential box no provider is on (spec §5.6).
func TestEmailHubStartOAuthUnknownProvider404(t *testing.T) {
	svc, q, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	svc.ConfigureOAuth(emailHubOAuthTestConfig())
	for _, provider := range []string{"outlook", "yahoo", ""} {
		if _, _, err := svc.StartOAuth(ctx, Human(user.ID), ws.ID, provider, ""); !errors.Is(err, ErrNotFound) {
			t.Errorf("provider %q: %v, want ErrNotFound", provider, err)
		}
	}
	noBox := NewEmailHubService(q, svc.ws, nil)
	noBox.ConfigureOAuth(emailHubOAuthTestConfig())
	if _, _, err := noBox.StartOAuth(ctx, Human(user.ID), ws.ID, "google", ""); !errors.Is(err, ErrNotFound) {
		t.Fatalf("no credential box: %v, want ErrNotFound", err)
	}
}

// The URL asks for offline access with PKCE S256 and the provider's prompt. It
// carries the hint and Email Hub's own redirect. The state opens to who
// started the sign-in, where, and the nonce the cookie gets, and the verifier
// never leaves it (spec §5.3, §7).
func TestEmailHubStartOAuthURL(t *testing.T) {
	svc, _, user, ws, _ := emailHubFixture(t)
	ctx := context.Background()
	cfg := emailHubOAuthTestConfig()
	svc.ConfigureOAuth(cfg)

	cases := []struct{ provider, host, client, prompt, hint string }{
		{"google", "accounts.google.com", "hub-google-id", "consent", "me@gmail.com"},
		{"microsoft", "login.microsoftonline.com", "hub-ms-id", "select_account", ""},
	}
	seen := map[string]bool{}
	for _, tc := range cases {
		before := time.Now()
		raw, nonce, err := svc.StartOAuth(ctx, Human(user.ID), ws.ID, tc.provider, "  "+tc.hint+" ")
		if err != nil {
			t.Fatalf("%s: %v", tc.provider, err)
		}
		u, err := url.Parse(raw)
		if err != nil {
			t.Fatal(err)
		}
		q := u.Query()
		if u.Host != tc.host || q.Get("client_id") != tc.client || q.Get("response_type") != "code" ||
			q.Get("redirect_uri") != cfg.EmailHubRedirectURL(tc.provider) {
			t.Errorf("%s: url %s", tc.provider, raw)
		}
		if q.Get("access_type") != "offline" || q.Get("code_challenge_method") != "S256" ||
			q.Get("code_challenge") == "" || q.Get("prompt") != tc.prompt {
			t.Errorf("%s: offline/PKCE/prompt params: %v", tc.provider, q)
		}
		if q.Has("login_hint") != (tc.hint != "") || q.Get("login_hint") != tc.hint {
			t.Errorf("%s: login_hint=%q, want %q", tc.provider, q.Get("login_hint"), tc.hint)
		}
		st, ok := svc.openOAuthState(q.Get("state"))
		if !ok {
			t.Fatalf("%s: the state does not open", tc.provider)
		}
		want := emailHubOAuthState{
			UserID: user.ID, OrganizationID: ws.OrganizationID, WorkspaceID: ws.ID, Provider: tc.provider,
			Nonce: nonce, Verifier: st.Verifier, Exp: st.Exp,
		}
		if st != want || len(nonce) != 43 {
			t.Errorf("%s: state %+v, nonce %q", tc.provider, st, nonce)
		}
		if st.Exp < before.Add(emailHubOAuthStateTTL).Unix() || st.Exp > time.Now().Add(emailHubOAuthStateTTL).Unix() {
			t.Errorf("%s: exp %d is not now+10m", tc.provider, st.Exp)
		}
		if st.Verifier == "" || strings.Contains(raw, st.Verifier) || q.Get("code_challenge") != oauth2.S256ChallengeFromVerifier(st.Verifier) {
			t.Errorf("%s: the verifier must stay in the state and match the challenge", tc.provider)
		}
		if seen[nonce] || seen[st.Verifier] {
			t.Errorf("%s: a nonce or verifier was reused", tc.provider)
		}
		seen[nonce], seen[st.Verifier] = true, true
	}
	var ve ValidationError
	if _, _, err := svc.StartOAuth(ctx, Human(user.ID), ws.ID, "google", strings.Repeat("a", 321)); !errors.As(err, &ve) {
		t.Fatalf("a 321-rune hint: %v, want a validation error", err)
	}
}

// A state opens only when this box sealed it, it carries a nonce, and it has
// not expired (spec §5.4 step 1).
func TestEmailHubOAuthStateRejectsTamperedAndExpired(t *testing.T) {
	svc := NewEmailHubService(nil, nil, testEmailHubBox(t))
	other := NewEmailHubService(nil, nil, testEmailHubBox(t))
	seal := func(s *EmailHubService, st emailHubOAuthState) string {
		plain, err := json.Marshal(st)
		if err != nil {
			t.Fatal(err)
		}
		sealed, err := s.box.Seal(plain)
		if err != nil {
			t.Fatal(err)
		}
		return base64.RawURLEncoding.EncodeToString(sealed)
	}
	live := emailHubOAuthState{
		UserID: "u1", OrganizationID: "o1", WorkspaceID: "w1", Provider: "google",
		Nonce: "n1", Verifier: "v1", Exp: time.Now().Add(time.Minute).Unix(),
	}
	if got, ok := svc.openOAuthState(seal(svc, live)); !ok || got != live {
		t.Fatalf("a live state must open: %+v %v", got, ok)
	}
	expired, noNonce := live, live
	expired.Exp = time.Now().Add(-time.Second).Unix()
	noNonce.Nonce = ""
	good := seal(svc, live)
	flip := "A"
	if good[10:11] == "A" {
		flip = "B"
	}
	for name, raw := range map[string]string{
		"empty":         "",
		"not base64url": "not+base64/url!",
		"expired":       seal(svc, expired),
		"no nonce":      seal(svc, noNonce),
		"tampered":      good[:10] + flip + good[11:],
		"another box":   seal(other, live),
	} {
		if _, ok := svc.openOAuthState(raw); ok {
			t.Errorf("%s: state opened", name)
		}
	}
	if _, ok := NewEmailHubService(nil, nil, nil).openOAuthState(good); ok {
		t.Fatal("without a box nothing opens")
	}
}
