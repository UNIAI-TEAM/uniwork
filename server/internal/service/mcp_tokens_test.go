package service

import (
	"errors"
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
