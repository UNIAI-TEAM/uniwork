package service

import (
	"errors"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/unicomhub/uniwork/server/internal/audit"
)

func wantOAuth(t *testing.T, err error, code string) {
	t.Helper()
	var oe OAuthError
	if !errors.As(err, &oe) || oe.Code != code {
		t.Fatalf("err = %v, want OAuth %s", err, code)
	}
}

// familyRevokedRows counts the audit rows a reuse or replay left for the world.
func (w *mcpWorld) familyRevokedRows(t *testing.T) int {
	t.Helper()
	return w.countRows(t, `SELECT count(*) FROM audit_events WHERE organization_id = $1 AND action = $2`, w.org.ID, audit.ActionMcpTokenFamilyRevoked)
}

func TestMcpExchangeIssuesOpaquePair(t *testing.T) {
	w := newMcpWorld(t)
	_, pair := w.issue(t)
	if !strings.HasPrefix(pair.AccessToken, mcpAccessPrefix) || !strings.HasPrefix(pair.RefreshToken, mcpRefreshPrefix) || pair.ExpiresIn != 3600 || pair.Scope != "read" {
		t.Fatalf("pair = %+v", pair)
	}
	if n := w.liveTokens(t); n != 2 {
		t.Fatalf("live tokens = %d, want 2", n)
	}
}

// Only digests are stored: no column of any token or attempt row may hold the
// raw access token, refresh token or authorization code.
func TestMcpOnlyDigestsAreStored(t *testing.T) {
	w := newMcpWorld(t)
	w.enable(t)
	c := w.publicClient(t, "https://x.test/cb")
	code := w.approve(t, c, "https://x.test/cb")
	pair, err := w.svc.Exchange(w.ctx, McpExchangeInput{ClientID: c.ClientID, Code: code, CodeVerifier: mcpTestVerifier, RedirectURI: "https://x.test/cb"})
	if err != nil {
		t.Fatal(err)
	}
	for name, raw := range map[string]string{"access token": pair.AccessToken, "refresh token": pair.RefreshToken} {
		if n := w.countRows(t, `SELECT count(*) FROM mcp_tokens WHERE digest = $1`, raw); n != 0 {
			t.Fatalf("a raw %s is a digest column value", name)
		}
		if n := w.countRows(t, `SELECT count(*) FROM mcp_tokens t WHERE position($1 in t::text) > 0`, raw); n != 0 {
			t.Fatalf("a raw %s reached a column of mcp_tokens", name)
		}
		if n := w.countRows(t, `SELECT count(*) FROM mcp_tokens WHERE digest = $1`, digest(raw)); n != 1 {
			t.Fatalf("the digest of the %s is stored %d times, want 1", name, n)
		}
	}
	if n := w.countRows(t, `SELECT count(*) FROM mcp_auth_attempts a WHERE position($1 in a::text) > 0`, code); n != 0 {
		t.Fatal("a raw authorization code reached a column of mcp_auth_attempts")
	}
}

func TestMcpExchangeRefusesWrongVerifierRedirectAndResource(t *testing.T) {
	w := newMcpWorld(t)
	w.enable(t)
	c := w.publicClient(t, "https://x.test/cb")
	code := w.approve(t, c, "https://x.test/cb")
	_, err := w.svc.Exchange(w.ctx, McpExchangeInput{ClientID: c.ClientID, Code: code, CodeVerifier: strings.Repeat("z", 43), RedirectURI: "https://x.test/cb"})
	wantOAuth(t, err, "invalid_grant")
	_, err = w.svc.Exchange(w.ctx, McpExchangeInput{ClientID: c.ClientID, Code: code, CodeVerifier: mcpTestVerifier, RedirectURI: "https://x.test/other"})
	wantOAuth(t, err, "invalid_grant")
	_, err = w.svc.Exchange(w.ctx, McpExchangeInput{ClientID: c.ClientID, Code: code, CodeVerifier: mcpTestVerifier, RedirectURI: "https://x.test/cb", Resource: "https://elsewhere.test/mcp"})
	wantOAuth(t, err, "invalid_target")
	other := w.publicClient(t, "https://x.test/cb")
	_, err = w.svc.Exchange(w.ctx, McpExchangeInput{ClientID: other.ClientID, Code: code, CodeVerifier: mcpTestVerifier, RedirectURI: "https://x.test/cb"})
	wantOAuth(t, err, "invalid_grant")
	_, err = w.svc.Exchange(w.ctx, McpExchangeInput{ClientID: c.ClientID, Code: code, CodeVerifier: "short", RedirectURI: "https://x.test/cb"})
	wantOAuth(t, err, "invalid_grant")
	_, err = w.svc.Exchange(w.ctx, McpExchangeInput{ClientID: "mcpc_nope", Code: code, CodeVerifier: mcpTestVerifier, RedirectURI: "https://x.test/cb"})
	wantOAuth(t, err, "invalid_client")
	// every refusal above left the code unused: the right request still works.
	if _, err := w.svc.Exchange(w.ctx, McpExchangeInput{ClientID: c.ClientID, Code: code, CodeVerifier: mcpTestVerifier, RedirectURI: "https://x.test/cb", Resource: w.svc.ResourceURL()}); err != nil {
		t.Fatalf("a refused attempt must not burn the code: %v", err)
	}
	if n := w.familyRevokedRows(t); n != 0 {
		t.Fatalf("refused attempts on an unused code wrote %d family_revoked rows", n)
	}
}

// RFC 7636 §4.1 lets a code_verifier use every unreserved character, "." and
// "~" included. Claude Code's verifiers do, so refusing them made most of its
// sign-ins fail with invalid_grant after the person had already approved.
func TestMcpExchangeAcceptsEveryRFC7636VerifierCharacter(t *testing.T) {
	w := newMcpWorld(t)
	w.enable(t)
	c := w.publicClient(t, "https://x.test/cb")
	verifier := "Ab0-._~Cd1-._~Ef2-._~Gh3-._~Ij4-._~Kl5-._~Mn6-._~"
	consentURL, err := w.svc.Start(w.ctx, McpAuthorizeInput{ResponseType: "code", ClientID: c.ClientID, RedirectURI: "https://x.test/cb", CodeChallenge: pkceChallenge(verifier), CodeChallengeMethod: "S256", State: "st"})
	if err != nil {
		t.Fatal(err)
	}
	id := attemptID(t, consentURL)
	consent, err := w.svc.Consent(w.ctx, w.owner.ID, id)
	if err != nil {
		t.Fatal(err)
	}
	to, err := w.svc.Approve(w.ctx, w.owner.ID, id, consent.CSRFToken, w.org.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	parsed, _ := url.Parse(to)
	if _, err := w.svc.Exchange(w.ctx, McpExchangeInput{ClientID: c.ClientID, Code: parsed.Query().Get("code"), CodeVerifier: verifier, RedirectURI: "https://x.test/cb"}); err != nil {
		t.Fatalf("an RFC 7636 verifier with '.' and '~' was refused: %v", err)
	}
}

func TestMcpPKCEVerifierFollowsRFC7636(t *testing.T) {
	for _, tc := range []struct {
		name     string
		verifier string
		ok       bool
	}{
		{"base64url", mcpTestVerifier, true},
		{"dot and tilde", strings.Repeat("a.~", 15), true},
		{"shortest", strings.Repeat("a", 43), true},
		{"longest", strings.Repeat("a", 128), true},
		{"too short", strings.Repeat("a", 42), false},
		{"too long", strings.Repeat("a", 129), false},
		{"plus", strings.Repeat("a", 42) + "+", false},
		{"slash", strings.Repeat("a", 42) + "/", false},
		{"space", strings.Repeat("a", 42) + " ", false},
		{"percent", strings.Repeat("a", 42) + "%", false},
		{"non-ascii", strings.Repeat("a", 42) + "é", false},
	} {
		if got := validPKCEVerifier(tc.verifier); got != tc.ok {
			t.Errorf("%s: validPKCEVerifier = %v, want %v", tc.name, got, tc.ok)
		}
	}
}

func TestMcpExchangeRefusesExpiredCodeAndRevokedGrant(t *testing.T) {
	w := newMcpWorld(t)
	w.enable(t)
	c := w.publicClient(t, "https://x.test/cb")
	in := func(code string) McpExchangeInput {
		return McpExchangeInput{ClientID: c.ClientID, Code: code, CodeVerifier: mcpTestVerifier, RedirectURI: "https://x.test/cb"}
	}
	expired := w.approve(t, c, "https://x.test/cb")
	if _, err := w.pool.Exec(w.ctx, `UPDATE mcp_auth_attempts SET code_expires_at = now() - interval '1 second' WHERE code_digest = $1`, digest(expired)); err != nil {
		t.Fatal(err)
	}
	_, err := w.svc.Exchange(w.ctx, in(expired))
	wantOAuth(t, err, "invalid_grant")

	code := w.approve(t, c, "https://x.test/cb")
	if _, err := w.pool.Exec(w.ctx, `UPDATE mcp_grants SET revoked_at = now() WHERE organization_id = $1`, w.org.ID); err != nil {
		t.Fatal(err)
	}
	_, err = w.svc.Exchange(w.ctx, in(code))
	wantOAuth(t, err, "invalid_grant")
	if n := w.liveTokens(t); n != 0 {
		t.Fatalf("live tokens = %d, want 0", n)
	}
}

func TestMcpCodeReplayRevokesIssuedTokens(t *testing.T) {
	w := newMcpWorld(t)
	w.enable(t)
	c := w.publicClient(t, "https://x.test/cb")
	code := w.approve(t, c, "https://x.test/cb")
	in := McpExchangeInput{ClientID: c.ClientID, Code: code, CodeVerifier: mcpTestVerifier, RedirectURI: "https://x.test/cb"}
	if _, err := w.svc.Exchange(w.ctx, in); err != nil {
		t.Fatal(err)
	}
	_, err := w.svc.Exchange(w.ctx, in)
	wantOAuth(t, err, "invalid_grant")
	if n := w.liveTokens(t); n != 0 {
		t.Fatalf("live tokens after code replay = %d, want 0", n)
	}
	if rows := w.familyRevokedRows(t); rows != 1 {
		t.Fatalf("family_revoked audit rows = %d", rows)
	}
	var reason string
	if err := w.pool.QueryRow(w.ctx, `SELECT metadata::jsonb->>'reason' FROM audit_events WHERE organization_id = $1 AND action = $2`, w.org.ID, audit.ActionMcpTokenFamilyRevoked).Scan(&reason); err != nil || reason != "code_replay" {
		t.Fatalf("audit reason = %q, %v", reason, err)
	}
}

// A replay closes the family that code issued and nothing else: the same
// client's session from another consent stays alive.
func TestMcpCodeReplayRevokesOnlyItsOwnFamily(t *testing.T) {
	w := newMcpWorld(t)
	c, _ := w.issue(t)
	code := w.approve(t, c, "https://x.test/cb")
	in := McpExchangeInput{ClientID: c.ClientID, Code: code, CodeVerifier: mcpTestVerifier, RedirectURI: "https://x.test/cb"}
	if _, err := w.svc.Exchange(w.ctx, in); err != nil {
		t.Fatal(err)
	}
	if n := w.liveTokens(t); n != 4 {
		t.Fatalf("live tokens before replay = %d, want 4", n)
	}
	_, err := w.svc.Exchange(w.ctx, in)
	wantOAuth(t, err, "invalid_grant")
	if n := w.liveTokens(t); n != 2 {
		t.Fatalf("live tokens after replay = %d, want 2 (the first session)", n)
	}
}

// OAuth 2.1 §4.1.3: two requests redeeming one code at the same instant. One
// wins the single-use update; the other is a replay, and a replay revokes what
// that code issued, so the winner's tokens die too. That is the specified
// behaviour, not a race to hide: whoever else holds a copy of the code is
// locked out together with the first redeemer.
func TestMcpConcurrentExchangeOfOneCodeRevokesItsFamily(t *testing.T) {
	w := newMcpWorld(t)
	w.enable(t)
	c := w.publicClient(t, "https://x.test/cb")
	code := w.approve(t, c, "https://x.test/cb")
	in := McpExchangeInput{ClientID: c.ClientID, Code: code, CodeVerifier: mcpTestVerifier, RedirectURI: "https://x.test/cb"}

	const n = 2
	start := make(chan struct{})
	pairs := make([]McpTokenPair, n)
	errs := make([]error, n)
	var wg sync.WaitGroup
	for i := range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			pairs[i], errs[i] = w.svc.Exchange(w.ctx, in)
		}()
	}
	close(start)
	wg.Wait()

	wins, losses := 0, 0
	for i := range n {
		switch {
		case errs[i] == nil:
			wins++
			if !strings.HasPrefix(pairs[i].AccessToken, mcpAccessPrefix) {
				t.Fatalf("the winner's pair = %+v", pairs[i])
			}
		case errors.Is(errs[i], errInvalidGrant):
			losses++
		default:
			t.Fatalf("exchange %d: %v", i, errs[i])
		}
	}
	if wins != 1 || losses != n-1 {
		t.Fatalf("wins = %d, losses = %d; want exactly one redemption", wins, losses)
	}
	if got := w.countRows(t, `SELECT count(*) FROM mcp_tokens WHERE organization_id = $1`, w.org.ID); got != 2 {
		t.Fatalf("token rows = %d, want one pair", got)
	}
	if got := w.liveTokens(t); got != 0 {
		t.Fatalf("live tokens = %d: the replay must revoke the winner's pair too", got)
	}
	if rows := w.familyRevokedRows(t); rows != 1 {
		t.Fatalf("family_revoked audit rows = %d, want 1", rows)
	}
}

func TestMcpRefreshRotates(t *testing.T) {
	w := newMcpWorld(t)
	c, pair := w.issue(t)
	next, err := w.svc.Refresh(w.ctx, McpRefreshInput{ClientID: c.ClientID, RefreshToken: pair.RefreshToken})
	if err != nil || next.RefreshToken == pair.RefreshToken || next.AccessToken == pair.AccessToken {
		t.Fatalf("rotate = %+v, %v", next, err)
	}
	if next.ExpiresIn != 3600 || next.Scope != "read" {
		t.Fatalf("rotated pair = %+v", next)
	}
	_, err = w.svc.Refresh(w.ctx, McpRefreshInput{ClientID: c.ClientID, RefreshToken: pair.AccessToken})
	wantOAuth(t, err, "invalid_grant")
	// the rotated pair belongs to the family of the first one.
	var families int
	if err := w.pool.QueryRow(w.ctx, `SELECT count(DISTINCT family_id) FROM mcp_tokens WHERE organization_id = $1`, w.org.ID).Scan(&families); err != nil || families != 1 {
		t.Fatalf("families = %d, %v; rotation keeps one family", families, err)
	}
}

func TestMcpRefreshRefusesAnotherClientExpiredAndWrongResource(t *testing.T) {
	w := newMcpWorld(t)
	c, pair := w.issue(t)
	other := w.publicClient(t, "https://x.test/cb")
	_, err := w.svc.Refresh(w.ctx, McpRefreshInput{ClientID: other.ClientID, RefreshToken: pair.RefreshToken})
	wantOAuth(t, err, "invalid_grant")
	_, err = w.svc.Refresh(w.ctx, McpRefreshInput{ClientID: c.ClientID, RefreshToken: pair.RefreshToken, Resource: "https://elsewhere.test/mcp"})
	wantOAuth(t, err, "invalid_target")
	_, err = w.svc.Refresh(w.ctx, McpRefreshInput{ClientID: c.ClientID, RefreshToken: "uwm_rt_unknown"})
	wantOAuth(t, err, "invalid_grant")
	if n := w.liveTokens(t); n != 2 {
		t.Fatalf("a refused refresh changed the family: live = %d", n)
	}
	if _, err := w.svc.Refresh(w.ctx, McpRefreshInput{ClientID: c.ClientID, RefreshToken: pair.RefreshToken, Resource: w.svc.ResourceURL()}); err != nil {
		t.Fatalf("a refused refresh must not use the token up: %v", err)
	}

	c2, pair2 := w.issue(t)
	w.svc.now = func() time.Time { return time.Now().Add(mcpRefreshTTL + time.Hour) }
	_, err = w.svc.Refresh(w.ctx, McpRefreshInput{ClientID: c2.ClientID, RefreshToken: pair2.RefreshToken})
	wantOAuth(t, err, "invalid_grant")
}

// Review Focus 1: a client racing itself inside the grace window loses one
// request but keeps its session.
func TestMcpRefreshReuseInsideGraceKeepsFamily(t *testing.T) {
	w := newMcpWorld(t)
	c, pair := w.issue(t)
	next, err := w.svc.Refresh(w.ctx, McpRefreshInput{ClientID: c.ClientID, RefreshToken: pair.RefreshToken})
	if err != nil {
		t.Fatal(err)
	}
	_, err = w.svc.Refresh(w.ctx, McpRefreshInput{ClientID: c.ClientID, RefreshToken: pair.RefreshToken})
	wantOAuth(t, err, "invalid_grant")
	if n := w.familyRevokedRows(t); n != 0 {
		t.Fatalf("reuse inside the grace wrote %d family_revoked rows", n)
	}
	if _, err := w.svc.Refresh(w.ctx, McpRefreshInput{ClientID: c.ClientID, RefreshToken: next.RefreshToken}); err != nil {
		t.Fatalf("the newer refresh token must still work: %v", err)
	}
}

// Review Focus 1, for real: several refresh requests with the same token start
// at the same instant (a client retrying through a proxy). The row lock lets
// exactly one rotate; the others are inside the grace window, so they get
// invalid_grant without closing the family. The winner's pair must keep
// working. One race can pass by luck without the lock, so it runs in rounds,
// each racing the previous winner's token.
func TestMcpConcurrentRefreshKeepsFamily(t *testing.T) {
	w := newMcpWorld(t)
	c, pair := w.issue(t)

	const goroutines, rounds = 8, 15
	current := pair.RefreshToken
	for round := range rounds {
		start := make(chan struct{})
		next := make([]McpTokenPair, goroutines)
		errs := make([]error, goroutines)
		var wg sync.WaitGroup
		for i := range goroutines {
			wg.Add(1)
			go func() {
				defer wg.Done()
				<-start
				next[i], errs[i] = w.svc.Refresh(w.ctx, McpRefreshInput{ClientID: c.ClientID, RefreshToken: current})
			}()
		}
		close(start)
		wg.Wait()

		winner := -1
		for i := range goroutines {
			switch {
			case errs[i] == nil:
				if winner >= 0 {
					t.Fatalf("round %d: two refreshes of one token both succeeded (%d and %d)", round, winner, i)
				}
				winner = i
			case errors.Is(errs[i], errInvalidGrant):
			default:
				t.Fatalf("round %d: refresh %d: %v", round, i, errs[i])
			}
		}
		if winner < 0 {
			t.Fatalf("round %d: no refresh succeeded", round)
		}
		current = next[winner].RefreshToken
	}
	if rows := w.familyRevokedRows(t); rows != 0 {
		t.Fatalf("family_revoked audit rows = %d: a client racing itself must keep its session", rows)
	}
	// the first pair plus exactly one new pair per round, none of them revoked.
	want := 2 + 2*rounds
	if rows := w.countRows(t, `SELECT count(*) FROM mcp_tokens WHERE organization_id = $1`, w.org.ID); rows != want {
		t.Fatalf("token rows = %d, want %d: one rotation issues one pair", rows, want)
	}
	if live := w.liveTokens(t); live != want {
		t.Fatalf("live tokens = %d, want %d: nothing may be revoked", live, want)
	}
	again, err := w.svc.Refresh(w.ctx, McpRefreshInput{ClientID: c.ClientID, RefreshToken: current})
	if err != nil {
		t.Fatalf("the last winner's refresh token must work: %v", err)
	}
	if again.RefreshToken == current {
		t.Fatal("the winner's refresh token did not rotate")
	}
}

func TestMcpRefreshReuseAfterGraceRevokesFamily(t *testing.T) {
	w := newMcpWorld(t)
	c, pair := w.issue(t)
	if _, err := w.svc.Refresh(w.ctx, McpRefreshInput{ClientID: c.ClientID, RefreshToken: pair.RefreshToken}); err != nil {
		t.Fatal(err)
	}
	w.svc.now = func() time.Time { return time.Now().Add(mcpReuseGrace + time.Second) }
	_, err := w.svc.Refresh(w.ctx, McpRefreshInput{ClientID: c.ClientID, RefreshToken: pair.RefreshToken})
	wantOAuth(t, err, "invalid_grant")
	if n := w.liveTokens(t); n != 0 {
		t.Fatalf("live tokens after reuse = %d, want 0", n)
	}
	if rows := w.familyRevokedRows(t); rows != 1 {
		t.Fatalf("family_revoked audit rows = %d, want 1", rows)
	}
	var reason string
	if err := w.pool.QueryRow(w.ctx, `SELECT metadata::jsonb->>'reason' FROM audit_events WHERE organization_id = $1 AND action = $2`, w.org.ID, audit.ActionMcpTokenFamilyRevoked).Scan(&reason); err != nil || reason != "refresh_reuse" {
		t.Fatalf("audit reason = %q, %v", reason, err)
	}
}

func TestMcpRevokeTokenIsQuietAndScoped(t *testing.T) {
	w := newMcpWorld(t)
	c, pair := w.issue(t)
	other := w.publicClient(t, "https://x.test/cb")
	if err := w.svc.RevokeToken(w.ctx, other.ClientID, "", pair.RefreshToken); err != nil {
		t.Fatal(err)
	}
	if n := w.liveTokens(t); n != 2 {
		t.Fatalf("another client revoked this client's token: live = %d", n)
	}
	if err := w.svc.RevokeToken(w.ctx, c.ClientID, "", "uwm_rt_unknown"); err != nil {
		t.Fatalf("unknown token must answer quietly: %v", err)
	}
	if err := w.svc.RevokeToken(w.ctx, c.ClientID, "", pair.RefreshToken); err != nil {
		t.Fatal(err)
	}
	if n := w.liveTokens(t); n != 0 {
		t.Fatalf("revoking the refresh token closes its family: live = %d", n)
	}
	wantOAuth(t, w.svc.RevokeToken(w.ctx, "mcpc_nope", "", pair.RefreshToken), "invalid_client")
}

func TestMcpRevokeAccessTokenLeavesRefreshToken(t *testing.T) {
	w := newMcpWorld(t)
	c, pair := w.issue(t)
	if err := w.svc.RevokeToken(w.ctx, c.ClientID, "", pair.AccessToken); err != nil {
		t.Fatal(err)
	}
	if n := w.liveTokens(t); n != 1 {
		t.Fatalf("live tokens = %d, want only the refresh token", n)
	}
	if _, err := w.svc.Refresh(w.ctx, McpRefreshInput{ClientID: c.ClientID, RefreshToken: pair.RefreshToken}); err != nil {
		t.Fatalf("refresh after revoking the access token: %v", err)
	}
}

// Audit rows record a detection, not every repeat of it: once the family is
// closed there is nothing left to revoke, so a second or third replay of the
// same code adds nothing to the append-only log.
func TestMcpRepeatedCodeReplayAuditsOnce(t *testing.T) {
	w := newMcpWorld(t)
	w.enable(t)
	c := w.publicClient(t, "https://x.test/cb")
	code := w.approve(t, c, "https://x.test/cb")
	in := McpExchangeInput{ClientID: c.ClientID, Code: code, CodeVerifier: mcpTestVerifier, RedirectURI: "https://x.test/cb"}
	if _, err := w.svc.Exchange(w.ctx, in); err != nil {
		t.Fatal(err)
	}
	for i := range 3 {
		_, err := w.svc.Exchange(w.ctx, in)
		if !errors.Is(err, errInvalidGrant) {
			t.Fatalf("replay %d: %v", i, err)
		}
	}
	if rows := w.familyRevokedRows(t); rows != 1 {
		t.Fatalf("family_revoked audit rows = %d after three replays, want 1", rows)
	}
	var tokens string
	if err := w.pool.QueryRow(w.ctx, `SELECT metadata::jsonb->>'tokens' FROM audit_events WHERE organization_id = $1 AND action = $2`, w.org.ID, audit.ActionMcpTokenFamilyRevoked).Scan(&tokens); err != nil || tokens != "2" {
		t.Fatalf("audited tokens = %q, %v; the one row records the pair it closed", tokens, err)
	}
}

// The attempt keeps the resource it was bound to; a code whose binding is not
// this server's resource is refused with invalid_target and stays unused.
func TestMcpExchangeRefusesAttemptBoundToAnotherResource(t *testing.T) {
	w := newMcpWorld(t)
	w.enable(t)
	c := w.publicClient(t, "https://x.test/cb")
	code := w.approve(t, c, "https://x.test/cb")
	in := McpExchangeInput{ClientID: c.ClientID, Code: code, CodeVerifier: mcpTestVerifier, RedirectURI: "https://x.test/cb"}
	if _, err := w.pool.Exec(w.ctx, `UPDATE mcp_auth_attempts SET resource = 'https://old.example.test/mcp' WHERE code_digest = $1`, digest(code)); err != nil {
		t.Fatal(err)
	}
	_, err := w.svc.Exchange(w.ctx, in)
	wantOAuth(t, err, "invalid_target")
	if n := w.countRows(t, `SELECT count(*) FROM mcp_auth_attempts WHERE code_digest = $1 AND used_at IS NULL`, digest(code)); n != 1 {
		t.Fatal("a refused exchange consumed the code")
	}
	if n := w.liveTokens(t); n != 0 {
		t.Fatalf("live tokens = %d, want 0", n)
	}
	if _, err := w.pool.Exec(w.ctx, `UPDATE mcp_auth_attempts SET resource = $2 WHERE code_digest = $1`, digest(code), w.svc.ResourceURL()); err != nil {
		t.Fatal(err)
	}
	if _, err := w.svc.Exchange(w.ctx, in); err != nil {
		t.Fatalf("the same code with its own resource must redeem: %v", err)
	}
}

// used_at is compared with the service clock (the grace window), so it is
// stamped from the service clock, not from the database's.
func TestMcpRefreshStampsUsedAtFromTheServiceClock(t *testing.T) {
	w := newMcpWorld(t)
	c, pair := w.issue(t)
	at := time.Now().Add(-2 * time.Hour).Truncate(time.Millisecond)
	w.svc.now = func() time.Time { return at }
	if _, err := w.svc.Refresh(w.ctx, McpRefreshInput{ClientID: c.ClientID, RefreshToken: pair.RefreshToken}); err != nil {
		t.Fatal(err)
	}
	var usedAt time.Time
	if err := w.pool.QueryRow(w.ctx, `SELECT used_at FROM mcp_tokens WHERE digest = $1`, digest(pair.RefreshToken)).Scan(&usedAt); err != nil {
		t.Fatal(err)
	}
	if !usedAt.Equal(at) {
		t.Fatalf("used_at = %s, want the service clock %s", usedAt, at)
	}
}

func (w *mcpWorld) confidentialClient(t *testing.T, redirect string) (McpClient, string) {
	t.Helper()
	reg, err := w.svc.Register(w.ctx, McpRegistration{ClientName: "Secret Client", RedirectURIs: []string{redirect}, TokenEndpointAuthMethod: "client_secret_post"})
	if err != nil {
		t.Fatal(err)
	}
	if reg.ClientSecret == "" {
		t.Fatal("a confidential client gets a secret")
	}
	return reg.Client, reg.ClientSecret
}

func wantInvalidClient(t *testing.T, err error) {
	t.Helper()
	var oe OAuthError
	if !errors.As(err, &oe) || oe.Code != "invalid_client" || oe.Status != 401 {
		t.Fatalf("err = %v, want 401 invalid_client", err)
	}
}

// A confidential client must present its secret at every endpoint, and a
// refused attempt consumes neither the code nor the refresh token.
func TestMcpConfidentialClientSecretGatesTheTokenEndpoint(t *testing.T) {
	w := newMcpWorld(t)
	w.enable(t)
	c, secret := w.confidentialClient(t, "https://x.test/cb")
	code := w.approve(t, c, "https://x.test/cb")
	in := McpExchangeInput{ClientID: c.ClientID, Code: code, CodeVerifier: mcpTestVerifier, RedirectURI: "https://x.test/cb"}
	for _, bad := range []string{"", "not-the-secret"} {
		in.ClientSecret = bad
		_, err := w.svc.Exchange(w.ctx, in)
		wantInvalidClient(t, err)
	}
	if n := w.countRows(t, `SELECT count(*) FROM mcp_auth_attempts WHERE code_digest = $1 AND used_at IS NULL`, digest(code)); n != 1 {
		t.Fatal("a refused client consumed the code")
	}
	if n := w.liveTokens(t); n != 0 {
		t.Fatalf("live tokens = %d, want 0", n)
	}
	in.ClientSecret = secret
	pair, err := w.svc.Exchange(w.ctx, in)
	if err != nil {
		t.Fatal(err)
	}

	for _, bad := range []string{"", "not-the-secret"} {
		_, err := w.svc.Refresh(w.ctx, McpRefreshInput{ClientID: c.ClientID, ClientSecret: bad, RefreshToken: pair.RefreshToken})
		wantInvalidClient(t, err)
		wantInvalidClient(t, w.svc.RevokeToken(w.ctx, c.ClientID, bad, pair.RefreshToken))
	}
	if n := w.countRows(t, `SELECT count(*) FROM mcp_tokens WHERE digest = $1 AND used_at IS NULL AND revoked_at IS NULL`, digest(pair.RefreshToken)); n != 1 {
		t.Fatal("a refused client used up or revoked the refresh token")
	}
	if _, err := w.svc.Refresh(w.ctx, McpRefreshInput{ClientID: c.ClientID, ClientSecret: secret, RefreshToken: pair.RefreshToken}); err != nil {
		t.Fatalf("refresh with the right secret: %v", err)
	}
}

// No credential - code, verifier, client secret, either token - may reach the
// audit log, which is append-only and long lived.
func TestMcpAuditRowsCarryNoRawCredentials(t *testing.T) {
	w := newMcpWorld(t)
	w.enable(t)
	c, secret := w.confidentialClient(t, "https://x.test/cb")
	code := w.approve(t, c, "https://x.test/cb")
	pair0, err := w.svc.Exchange(w.ctx, McpExchangeInput{ClientID: c.ClientID, ClientSecret: secret, Code: code, CodeVerifier: mcpTestVerifier, RedirectURI: "https://x.test/cb"})
	if err != nil {
		t.Fatal(err)
	}
	pair1, err := w.svc.Refresh(w.ctx, McpRefreshInput{ClientID: c.ClientID, ClientSecret: secret, RefreshToken: pair0.RefreshToken})
	if err != nil {
		t.Fatal(err)
	}
	w.svc.now = func() time.Time { return time.Now().Add(mcpReuseGrace + time.Second) }
	_, err = w.svc.Refresh(w.ctx, McpRefreshInput{ClientID: c.ClientID, ClientSecret: secret, RefreshToken: pair0.RefreshToken})
	wantOAuth(t, err, "invalid_grant")

	// the log is not empty: the consent and the reuse detection both wrote rows.
	if rows := w.countRows(t, `SELECT count(*) FROM audit_events WHERE organization_id = $1 AND action = ANY($2)`, w.org.ID, []string{audit.ActionMcpGrantCreated, audit.ActionMcpTokenFamilyRevoked}); rows != 2 {
		t.Fatalf("mcp audit rows = %d, want grant.created and family_revoked", rows)
	}
	for name, raw := range map[string]string{
		"code": code, "verifier": mcpTestVerifier, "client secret": secret,
		"first access token": pair0.AccessToken, "first refresh token": pair0.RefreshToken,
		"second access token": pair1.AccessToken, "second refresh token": pair1.RefreshToken,
	} {
		if n := w.countRows(t, `SELECT count(*) FROM audit_events a WHERE a.organization_id = $1 AND position($2 in a::text) > 0`, w.org.ID, raw); n != 0 {
			t.Fatalf("the %s reached audit_events", name)
		}
	}
}
