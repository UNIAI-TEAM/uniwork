package service

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"go/ast"
	"go/parser"
	"go/token"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/oauth2"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	"github.com/unicomhub/uniwork/server/internal/util"
	"github.com/unicomhub/uniwork/server/internal/util/secretbox"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

// driveConnectorFlags returns a featureflag.Service with drive_connector
// globally set to on.
func driveConnectorFlags(t *testing.T, on bool) *featureflag.Service {
	t.Helper()
	flags, _, err := featureflags.NewService(graphFlagStore{rows: []db.FeatureFlagOverride{
		{FlagKey: "drive_connector", ScopeType: featureflags.ScopeGlobal, Enabled: on},
	}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	return flags
}

func testDriveBox(t *testing.T) *secretbox.Box {
	t.Helper()
	key := make([]byte, secretbox.KeySize)
	if _, err := rand.Read(key); err != nil {
		t.Fatal(err)
	}
	box, err := secretbox.New(key)
	if err != nil {
		t.Fatal(err)
	}
	return box
}

// fakeDriveOIDCServer stands in for Google's OIDC discovery, JWKS, OAuth token
// exchange, refresh, and revocation endpoints so GoogleDriveProvider can be
// verified end-to-end without network calls (spec §5.1, §5.2).
type fakeDriveOIDCServer struct {
	key        *rsa.PrivateKey
	srv        *httptest.Server
	mu         sync.Mutex
	claims     jwt.MapClaims
	tokenReply func(r *http.Request) (int, map[string]any)
	revokeCode int
	revokeBody string
	revoked    []string
}

func newFakeDriveOIDCServer(t *testing.T) *fakeDriveOIDCServer {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	f := &fakeDriveOIDCServer{
		key:        key,
		revokeCode: http.StatusOK,
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/openid-configuration", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"issuer":                                f.srv.URL,
			"authorization_endpoint":                f.srv.URL + "/auth",
			"token_endpoint":                        f.srv.URL + "/token",
			"revocation_endpoint":                   f.srv.URL + "/revoke",
			"jwks_uri":                              f.srv.URL + "/jwks",
			"id_token_signing_alg_values_supported": []string{"RS256"},
		})
	})
	mux.HandleFunc("/jwks", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"keys": []map[string]any{{
				"kty": "RSA", "alg": "RS256", "use": "sig", "kid": "drive-k1",
				"n": base64.RawURLEncoding.EncodeToString(f.key.PublicKey.N.Bytes()),
				"e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(f.key.PublicKey.E)).Bytes()),
			}},
		})
	})
	mux.HandleFunc("/token", func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		f.mu.Lock()
		reply := f.tokenReply
		claimsCopy := jwt.MapClaims{}
		for k, v := range f.claims {
			claimsCopy[k] = v
		}
		f.mu.Unlock()
		if reply != nil {
			status, body := reply(r)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(status)
			_ = json.NewEncoder(w).Encode(body)
			return
		}
		tok := jwt.NewWithClaims(jwt.SigningMethodRS256, claimsCopy)
		tok.Header["kid"] = "drive-k1"
		signed, err := tok.SignedString(f.key)
		if err != nil {
			t.Errorf("sign id_token: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"access_token":  "google-access-token",
			"refresh_token": "google-refresh-token",
			"token_type":    "Bearer",
			"expires_in":    3600,
			"scope":         "openid email " + DriveGoogleScope,
			"id_token":      signed,
		})
	})
	mux.HandleFunc("/revoke", func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		f.mu.Lock()
		f.revoked = append(f.revoked, r.FormValue("token"))
		code := f.revokeCode
		body := f.revokeBody
		f.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(code)
		if body != "" {
			_, _ = w.Write([]byte(body))
		}
	})
	f.srv = httptest.NewServer(mux)
	t.Cleanup(f.srv.Close)
	f.claims = jwt.MapClaims{
		"iss":            f.srv.URL,
		"aud":            "drive-client-id",
		"sub":            "google-sub-123",
		"email":          "Member@Example.com",
		"email_verified": true,
		"nonce":          "expected-nonce",
		"exp":            time.Now().Add(time.Hour).Unix(),
		"iat":            time.Now().Add(-time.Minute).Unix(),
	}
	return f
}

func (f *fakeDriveOIDCServer) provider() *GoogleDriveProvider {
	p := NewGoogleDriveProvider(config.Config{
		APIPublicURL:            "https://api.example.com",
		GoogleDriveClientID:     "drive-client-id",
		GoogleDriveClientSecret: "drive-client-secret",
	})
	p.issuerURL = f.srv.URL
	p.cfg.Endpoint = oauth2.Endpoint{
		AuthURL:  f.srv.URL + "/auth",
		TokenURL: f.srv.URL + "/token",
	}
	p.revokeURL = f.srv.URL + "/revoke"
	p.oauthHTTP = f.srv.Client()
	p.revokeHTTP = f.srv.Client()
	return p
}

// TestGoogleDriveProviderOIDCAndRevoke verifies the real GoogleDriveProvider
// implementation against an in-process OIDC/OAuth server (AuthCodeURL parameters,
// PKCE exchange, go-oidc signature/issuer/audience/expiry/nonce/email_verified
// checks, RefreshToken, and RevokeToken 200 / 400 invalid_token / 500).
func TestGoogleDriveProviderOIDCAndRevoke(t *testing.T) {
	t.Parallel()
	oidcSrv := newFakeDriveOIDCServer(t)
	p := oidcSrv.provider()

	u, err := url.Parse(p.AuthCodeURL("state-1", "challenge-1", "consent", "user@example.com"))
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	if q.Get("client_id") != "drive-client-id" ||
		q.Get("redirect_uri") != "https://api.example.com/api/v1/drive-connections/google/callback" ||
		q.Get("access_type") != "offline" ||
		q.Get("code_challenge") != "challenge-1" ||
		q.Get("code_challenge_method") != "S256" ||
		q.Get("prompt") != "consent" ||
		q.Get("login_hint") != "user@example.com" ||
		!strings.Contains(q.Get("scope"), DriveGoogleScope) {
		t.Fatalf("unexpected AuthCodeURL query: %v", q)
	}

	ctx := context.Background()
	tok, err := p.Exchange(ctx, "auth-code-1", "verifier-1234567890")
	if err != nil {
		t.Fatalf("Exchange: %v", err)
	}
	if tok.AccessToken != "google-access-token" || tok.RefreshToken != "google-refresh-token" || !driveScopesInclude(tok.Scopes, DriveGoogleScope) {
		t.Fatalf("unexpected token response: %+v", tok)
	}
	claims, err := p.VerifyIDToken(ctx, tok.IDToken, "expected-nonce")
	if err != nil {
		t.Fatalf("VerifyIDToken: %v", err)
	}
	if claims.Sub != "google-sub-123" || claims.Email != "member@example.com" || !claims.EmailVerified {
		t.Fatalf("unexpected claims: %+v", claims)
	}

	// Wrong nonce must be rejected.
	if _, err := p.VerifyIDToken(ctx, tok.IDToken, "wrong-nonce"); err == nil {
		t.Fatal("expected nonce mismatch to fail VerifyIDToken")
	}

	// Unverified email must be rejected.
	oidcSrv.mu.Lock()
	oidcSrv.claims["email_verified"] = false
	oidcSrv.mu.Unlock()
	tokUnverified, err := p.Exchange(ctx, "auth-code-2", "verifier-1234567890")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := p.VerifyIDToken(ctx, tokUnverified.IDToken, "expected-nonce"); err == nil {
		t.Fatal("expected email_verified=false to fail VerifyIDToken")
	}

	// Wrong audience must be rejected.
	oidcSrv.mu.Lock()
	oidcSrv.claims["email_verified"] = true
	oidcSrv.claims["aud"] = "other-client-id"
	oidcSrv.mu.Unlock()
	tokWrongAud, err := p.Exchange(ctx, "auth-code-3", "verifier-1234567890")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := p.VerifyIDToken(ctx, tokWrongAud.IDToken, "expected-nonce"); err == nil {
		t.Fatal("expected wrong audience to fail VerifyIDToken")
	}

	// RevokeToken: 200 OK -> nil; 400 invalid_token -> ErrDriveRevokeAlreadyInvalid; 500 -> error.
	if err := p.RevokeToken(ctx, "refresh-tok-1"); err != nil {
		t.Fatalf("RevokeToken 200: %v", err)
	}
	oidcSrv.mu.Lock()
	oidcSrv.revokeCode = http.StatusBadRequest
	oidcSrv.revokeBody = `{"error":"invalid_token"}`
	oidcSrv.mu.Unlock()
	if err := p.RevokeToken(ctx, "refresh-tok-2"); !errors.Is(err, ErrDriveRevokeAlreadyInvalid) {
		t.Fatalf("RevokeToken 400 invalid_token = %v, want ErrDriveRevokeAlreadyInvalid", err)
	}
	oidcSrv.mu.Lock()
	oidcSrv.revokeCode = http.StatusBadRequest
	oidcSrv.revokeBody = `{"error":"invalid_request"}`
	oidcSrv.mu.Unlock()
	if err := p.RevokeToken(ctx, "refresh-tok-3"); err == nil || errors.Is(err, ErrDriveRevokeAlreadyInvalid) {
		t.Fatalf("RevokeToken 400 invalid_request = %v, want non-invalid_token error", err)
	}
	oidcSrv.mu.Lock()
	oidcSrv.revokeCode = http.StatusInternalServerError
	oidcSrv.revokeBody = `{"error":"server_error"}`
	oidcSrv.mu.Unlock()
	if err := p.RevokeToken(ctx, "refresh-tok-4"); err == nil {
		t.Fatal("RevokeToken 500: expected error")
	}
}

// TestDriveOAuthStateRejectsTamperedAndExpired verifies that openOAuthState
// rejects empty, malformed, tampered, wrong-key, expired, or nonceless states
// without touching the database or provider (spec §5.2).
func TestDriveOAuthStateRejectsTamperedAndExpired(t *testing.T) {
	t.Parallel()
	box := testDriveBox(t)
	otherBox := testDriveBox(t)
	svc := NewDriveConnectionService(nil, nil, nil, box)
	otherSvc := NewDriveConnectionService(nil, nil, nil, otherBox)

	validState := driveOAuthState{
		UserID:         "01J8X4USER0000000000000001",
		OrganizationID: "01J8X4ORG00000000000000001",
		WorkspaceID:    "01J8X4WS000000000000000001",
		Provider:       "google",
		CookieNonce:    "cookie-nonce-1",
		OIDCNonce:      "oidc-nonce-1",
		Verifier:       "pkce-verifier-1",
		Exp:            time.Now().Add(driveOAuthStateTTL).Unix(),
	}
	good, err := svc.sealOAuthState(validState)
	if err != nil {
		t.Fatal(err)
	}
	if got, ok := svc.openOAuthState(good); !ok || got.UserID != validState.UserID || got.OIDCNonce != validState.OIDCNonce {
		t.Fatalf("openOAuthState(good) = %+v, %v", got, ok)
	}

	expired := validState
	expired.Exp = time.Now().Add(-time.Second).Unix()
	expiredRaw, _ := svc.sealOAuthState(expired)

	noCookieNonce := validState
	noCookieNonce.CookieNonce = ""
	noCookieNonceRaw, _ := svc.sealOAuthState(noCookieNonce)

	noOIDCNonce := validState
	noOIDCNonce.OIDCNonce = ""
	noOIDCNonceRaw, _ := svc.sealOAuthState(noOIDCNonce)

	otherRaw, _ := otherSvc.sealOAuthState(validState)

	flip := "A"
	if good[10:11] == "A" {
		flip = "B"
	}
	tampered := good[:10] + flip + good[11:]

	for name, raw := range map[string]string{
		"empty":            "",
		"not_base64":       "not!base64*url",
		"expired":          expiredRaw,
		"no_cookie_nonce":  noCookieNonceRaw,
		"no_oidc_nonce":    noOIDCNonceRaw,
		"tampered":         tampered,
		"different_secret": otherRaw,
	} {
		if _, ok := svc.openOAuthState(raw); ok {
			t.Errorf("%s: state unexpectedly accepted", name)
		}
	}
	if _, ok := NewDriveConnectionService(nil, nil, nil, nil).openOAuthState(good); ok {
		t.Fatal("service without secretbox must reject state")
	}
}

// TestDriveRevocationTokenOnlyRevokes is the AST / structural test required by
// spec §5.3b and §13: inside drive_oauth_revoke.go, the decrypted refresh token
// from openSecret(claimed.RefreshTokenEnc.String) may ONLY be passed to
// s.provider.RevokeToken and never to any Drive files/export/about/read call.
func TestDriveRevocationTokenOnlyRevokes(t *testing.T) {
	t.Parallel()
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, filepath.Join(".", "drive_oauth_revoke.go"), nil, 0)
	if err != nil {
		t.Fatalf("parse drive_oauth_revoke.go: %v", err)
	}

	var openSecretCount int
	var revokeTokenCount int
	ast.Inspect(file, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		sel, ok := call.Fun.(*ast.SelectorExpr)
		if !ok {
			return true
		}
		switch sel.Sel.Name {
		case "openSecret":
			openSecretCount++
		case "RevokeToken":
			revokeTokenCount++
		case "GetFile", "ExportFile", "DownloadFile", "ListFiles", "Exchange", "RefreshToken":
			t.Errorf("drive_oauth_revoke.go must never call %s", sel.Sel.Name)
		}
		return true
	})
	if openSecretCount != 1 {
		t.Fatalf("openSecret calls in drive_oauth_revoke.go = %d, want 1", openSecretCount)
	}
	if revokeTokenCount != 1 {
		t.Fatalf("RevokeToken calls in drive_oauth_revoke.go = %d, want 1", revokeTokenCount)
	}
}

type driveTestFixture struct {
	pool *pgxpool.Pool
	q    *db.Queries
	orgs *OrganizationService
	ws   *WorkspaceService
	box  *secretbox.Box
	svc  *DriveConnectionService
	fake *FakeDriveProvider
	user db.User
	org  db.Organization
	work db.Workspace
}

func newDriveTestFixture(t *testing.T) *driveTestFixture {
	t.Helper()
	pool := testutil.DB(t)
	q := db.New(pool)
	box := testDriveBox(t)
	as := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	orgs := NewOrganizationService(pool, q)
	ws := NewWorkspaceService(pool, q, orgs, mail.Renderer{AppURL: "http://localhost:3000"}, &fakeOutbox{})
	svc := NewDriveConnectionService(pool, q, ws, box)
	fake := NewFakeDriveProvider(config.Config{
		APIPublicURL:            "https://api.example.com",
		FrontendOrigin:          "http://localhost:3000",
		GoogleDriveClientID:     "drive-client-id",
		GoogleDriveClientSecret: "drive-client-secret",
	})
	svc.SetProvider(fake)
	svc.SetFlags(driveConnectorFlags(t, true))

	ctx := context.Background()
	user := registerVerified(t, q, as, "drive-owner-"+util.NewID()+"@example.com", "Owner")
	org, err := orgs.Create(ctx, user.ID, "Drive Org", "drive-org-"+strings.ToLower(util.NewID()[:8]))
	if err != nil {
		t.Fatal(err)
	}
	workView, err := ws.CreateInOrg(ctx, user.ID, org.ID, "General", "general")
	if err != nil {
		t.Fatal(err)
	}
	work := workView.Workspace
	return &driveTestFixture{
		pool: pool,
		q:    q,
		orgs: orgs,
		ws:   ws,
		box:  box,
		svc:  svc,
		fake: fake,
		user: user,
		org:  org,
		work: work,
	}
}

func extractStateFromAuthURL(t *testing.T, rawURL string) (string, url.Values) {
	t.Helper()
	u, err := url.Parse(rawURL)
	if err != nil {
		t.Fatalf("parse auth url %q: %v", rawURL, err)
	}
	state := u.Query().Get("state")
	if state == "" {
		t.Fatalf("missing state in %q", rawURL)
	}
	return state, u.Query()
}

// TestDriveOAuthStartAndCompleteFlow covers:
// - StartOAuth requires workspace membership before checking provider config or flags
// - StartOAuth seals state with UserID, OrganizationID, WorkspaceID, CookieNonce, OIDCNonce, PKCE Verifier, and sets S256 challenge + prompt=consent on fresh connect
// - CompleteOAuth verifies state, cookie nonce, workspace membership, PKCE verifier, OIDC nonce, email_verified, drive.file scope, and writes drive_connections + audit + outbox
// - Connecting a second Google account in the same organization creates a second row
// - Reconnecting with reconnect_connection_id sets login_hint, locks target_connection_id + expected_sub, refuses account_mismatch, and updates the existing row in place without revoking the replaced token (spec §5.2, §5.3).
func TestDriveOAuthStartAndCompleteFlow(t *testing.T) {
	fx := newDriveTestFixture(t)
	ctx := context.Background()

	as := NewAuthService(fx.pool, fx.q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	outsider := registerVerified(t, fx.q, as, "drive-outsider-"+util.NewID()+"@example.com", "Outsider")
	if _, _, err := fx.svc.StartOAuth(ctx, Human(outsider.ID), fx.work.ID, ""); !errors.Is(err, ErrForbidden) {
		t.Fatalf("non-member StartOAuth = %v, want ErrForbidden", err)
	}

	// Fresh connect of account 1.
	authURL, cookieNonce, err := fx.svc.StartOAuth(ctx, Human(fx.user.ID), fx.work.ID, "")
	if err != nil {
		t.Fatalf("StartOAuth: %v", err)
	}
	state, q := extractStateFromAuthURL(t, authURL)
	if q.Get("prompt") != "consent" || q.Get("login_hint") != "" || q.Get("code_challenge_method") != "S256" {
		t.Fatalf("fresh StartOAuth query = %v", q)
	}
	opened, ok := fx.svc.openOAuthState(state)
	if !ok {
		t.Fatal("expected sealed state to open")
	}
	sum := sha256.Sum256([]byte(opened.Verifier))
	if got := base64.RawURLEncoding.EncodeToString(sum[:]); got != q.Get("code_challenge") {
		t.Fatalf("PKCE challenge = %q, want %q", q.Get("code_challenge"), got)
	}

	code := fx.svc.CompleteOAuth(ctx, state, "acct1", "", "", cookieNonce)
	if code != DriveOAuthConnected {
		t.Fatalf("CompleteOAuth acct1 = %q, want %q", code, DriveOAuthConnected)
	}

	list, err := fx.svc.List(ctx, Human(fx.user.ID), fx.work.ID)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(list) != 1 || list[0].GoogleEmail != "drive-acct1@example.com" || list[0].Status != DriveConnectionStatusActive || list[0].NeedsReconnect {
		t.Fatalf("List after connect 1 = %+v", list)
	}
	conn1ID := list[0].ID

	// Connect a second Google account for the same user in the same organization.
	authURL2, cookieNonce2, err := fx.svc.StartOAuth(ctx, Human(fx.user.ID), fx.work.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	state2, _ := extractStateFromAuthURL(t, authURL2)
	if got := fx.svc.CompleteOAuth(ctx, state2, "acct2", "", "", cookieNonce2); got != DriveOAuthConnected {
		t.Fatalf("CompleteOAuth acct2 = %q, want %q", got, DriveOAuthConnected)
	}
	list, err = fx.svc.List(ctx, Human(fx.user.ID), fx.work.ID)
	if err != nil || len(list) != 2 {
		t.Fatalf("List after connect 2 = %+v, err=%v, want 2 connections", list, err)
	}

	// Reconnect targeting conn1ID: StartOAuth sets login_hint and expected_sub.
	reconnURL, reconnNonce, err := fx.svc.StartOAuth(ctx, Human(fx.user.ID), fx.work.ID, conn1ID)
	if err != nil {
		t.Fatalf("StartOAuth reconnect: %v", err)
	}
	reconnState, reconnQ := extractStateFromAuthURL(t, reconnURL)
	if reconnQ.Get("login_hint") != "drive-acct1@example.com" {
		t.Fatalf("reconnect login_hint = %q, want drive-acct1@example.com", reconnQ.Get("login_hint"))
	}

	// Signing in with a different Google account (acct2) during reconnect must fail with account_mismatch.
	if got := fx.svc.CompleteOAuth(ctx, reconnState, "acct2", "", "", reconnNonce); got != DriveOAuthAccountMismatch {
		t.Fatalf("CompleteOAuth wrong sub = %q, want %q", got, DriveOAuthAccountMismatch)
	}

	// Signing in with the expected Google account (acct1) succeeds with reconnected, keeping conn1ID and never revoking the old token.
	if got := fx.svc.CompleteOAuth(ctx, reconnState, "acct1", "", "", reconnNonce); got != DriveOAuthReconnected {
		t.Fatalf("CompleteOAuth matching sub = %q, want %q", got, DriveOAuthReconnected)
	}
	if revoked := fx.fake.RevokeCalls(); len(revoked) != 0 {
		t.Fatalf("reconnect must never revoke replaced token (spec §5.2 step 4), got %v", revoked)
	}
}

// TestDriveOAuthCallbackRefusals covers all refusal paths in CompleteOAuth:
// - state_invalid on bad state or mismatched/empty cookie nonce
// - access_denied when user cancels
// - blocked_by_workspace_admin on error=admin_policy_enforced, error=org_internal, or error_subtype=admin_policy_enforced/org_internal (records drive_connection.refused audit)
// - scope_not_granted when drive.file scope is missing (records drive_connection.refused audit)
// - consent_required when refresh_token is empty
// - provider_error when email_verified=false or OIDC verification fails.
func TestDriveOAuthCallbackRefusals(t *testing.T) {
	fx := newDriveTestFixture(t)
	ctx := context.Background()

	start := func() (string, string) {
		u, nonce, err := fx.svc.StartOAuth(ctx, Human(fx.user.ID), fx.work.ID, "")
		if err != nil {
			t.Fatal(err)
		}
		st, _ := extractStateFromAuthURL(t, u)
		return st, nonce
	}

	st, nonce := start()
	if got := fx.svc.CompleteOAuth(ctx, st, "code", "", "", "wrong-nonce"); got != DriveOAuthStateInvalid {
		t.Fatalf("wrong nonce = %q, want %q", got, DriveOAuthStateInvalid)
	}
	if got := fx.svc.CompleteOAuth(ctx, st, "code", "", "", ""); got != DriveOAuthStateInvalid {
		t.Fatalf("empty nonce = %q, want %q", got, DriveOAuthStateInvalid)
	}
	if got := fx.svc.CompleteOAuth(ctx, st, "", "access_denied", "", nonce); got != DriveOAuthAccessDenied {
		t.Fatalf("access_denied = %q, want %q", got, DriveOAuthAccessDenied)
	}

	for _, tc := range []struct {
		errParam string
		subtype  string
	}{
		{"admin_policy_enforced", ""},
		{"org_internal", ""},
		{"access_denied", "admin_policy_enforced"},
		{"access_denied", "org_internal"},
	} {
		st, nonce = start()
		if got := fx.svc.CompleteOAuth(ctx, st, "", tc.errParam, tc.subtype, nonce); got != DriveOAuthBlockedByWorkspaceAdmin {
			t.Fatalf("err=%q subtype=%q -> %q, want %q", tc.errParam, tc.subtype, got, DriveOAuthBlockedByWorkspaceAdmin)
		}
	}

	// Missing drive.file scope -> scope_not_granted.
	fx.fake.SetExchange(func(_ context.Context, code, _ string) (DriveTokenResponse, error) {
		return DriveTokenResponse{
			AccessToken:  "acc",
			RefreshToken: "ref",
			Expiry:       time.Now().Add(time.Hour),
			IDToken:      "fake-id-token:" + code,
			Scopes:       "openid email", // missing drive.file
		}, nil
	})
	st, nonce = start()
	if got := fx.svc.CompleteOAuth(ctx, st, "noscope", "", "", nonce); got != DriveOAuthScopeNotGranted {
		t.Fatalf("missing drive.file = %q, want %q", got, DriveOAuthScopeNotGranted)
	}

	// Empty refresh_token -> consent_required.
	fx.fake.SetExchange(func(_ context.Context, code, _ string) (DriveTokenResponse, error) {
		return DriveTokenResponse{
			AccessToken:  "acc",
			RefreshToken: "",
			Expiry:       time.Now().Add(time.Hour),
			IDToken:      "fake-id-token:" + code,
			Scopes:       "openid email " + DriveGoogleScope,
		}, nil
	})
	st, nonce = start()
	if got := fx.svc.CompleteOAuth(ctx, st, "norefresh", "", "", nonce); got != DriveOAuthConsentRequired {
		t.Fatalf("empty refresh_token = %q, want %q", got, DriveOAuthConsentRequired)
	}
	fx.fake.SetExchange(nil)

	// Unverified email -> provider_error.
	fx.fake.RegisterIDToken("fake-id-token:unverified", DriveIDTokenClaims{
		Sub:           "sub-unverified",
		Email:         "u@example.com",
		EmailVerified: false,
	})
	st, nonce = start()
	if got := fx.svc.CompleteOAuth(ctx, st, "unverified", "", "", nonce); got != DriveOAuthProviderError {
		t.Fatalf("unverified email = %q, want %q", got, DriveOAuthProviderError)
	}
}

// TestDriveOAuthDisconnectAndReviveSameID verifies:
// - Disconnecting a connection sets disconnected_at, clears tokens, marks any drive_file_access rows as disconnected, and enqueues the encrypted refresh token into drive_grant_revocations
// - Reconnecting the same (org, user, google_sub) revives the disconnected row in place (same connection ID) and restores drive_file_access rows with status='disconnected' back to 'active' (leaving 'revoked_by_owner' untouched)
// - While an active owner exists for google_sub, the pending revocation row is cancelled/deleted without calling Google revoke (spec §5.2 step 4, §5.3, §5.3b).
func TestDriveOAuthDisconnectAndReviveSameID(t *testing.T) {
	fx := newDriveTestFixture(t)
	ctx := context.Background()

	u, nonce, err := fx.svc.StartOAuth(ctx, Human(fx.user.ID), fx.work.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	st, _ := extractStateFromAuthURL(t, u)
	if got := fx.svc.CompleteOAuth(ctx, st, "revive1", "", "", nonce); got != DriveOAuthConnected {
		t.Fatalf("CompleteOAuth = %q", got)
	}
	conns, err := fx.svc.List(ctx, Human(fx.user.ID), fx.work.ID)
	if err != nil || len(conns) != 1 {
		t.Fatalf("List = %+v, err=%v", conns, err)
	}
	connID := conns[0].ID

	// Seed two drive_files and drive_file_access rows for this connection: one active, one revoked_by_owner.
	file1ID, file2ID := util.NewID(), util.NewID()
	for i, fid := range []string{file1ID, file2ID} {
		_, err := fx.pool.Exec(ctx, `INSERT INTO drive_files (id, organization_id, workspace_id, external_file_id, name, mime_type, icon_kind, web_view_link, created_by_id, created_by_name)
			VALUES ($1, $2, $3, $4, $5, 'application/pdf', 'pdf', 'https://drive.google.com/file/d/1', $6, 'Owner')`,
			fid, fx.org.ID, fx.work.ID, "ext-"+fid, "File "+string(rune('A'+i)), fx.user.ID)
		if err != nil {
			t.Fatalf("seed drive_file: %v", err)
		}
	}
	_, err = fx.pool.Exec(ctx, `INSERT INTO drive_file_access (id, organization_id, workspace_id, drive_file_id, user_id, connection_id, status)
		VALUES ($1, $2, $3, $4, $5, $6, 'active'), ($7, $2, $3, $8, $5, $6, 'revoked_by_owner')`,
		util.NewID(), fx.org.ID, fx.work.ID, file1ID, fx.user.ID, connID, util.NewID(), file2ID)
	if err != nil {
		t.Fatalf("seed drive_file_access: %v", err)
	}

	// Disconnect the connection.
	if err := fx.svc.Disconnect(ctx, Human(fx.user.ID), fx.work.ID, connID); err != nil {
		t.Fatalf("Disconnect: %v", err)
	}
	connsAfterDisc, err := fx.svc.List(ctx, Human(fx.user.ID), fx.work.ID)
	if err != nil || len(connsAfterDisc) != 0 {
		t.Fatalf("List after Disconnect = %+v, want empty", connsAfterDisc)
	}

	// Verify drive_grant_revocations has a pending row for fake-sub-revive1.
	revRow, err := fx.q.GetDriveGrantRevocationForUpdate(ctx, "fake-sub-revive1")
	if err != nil || !revRow.RefreshTokenEnc.Valid || revRow.ResolvedAt.Valid {
		t.Fatalf("revocation row after Disconnect = %+v, err=%v", revRow, err)
	}

	// Reconnect the same Google account before the worker runs -> revives connID in place!
	u2, nonce2, err := fx.svc.StartOAuth(ctx, Human(fx.user.ID), fx.work.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	st2, _ := extractStateFromAuthURL(t, u2)
	if got := fx.svc.CompleteOAuth(ctx, st2, "revive1", "", "", nonce2); got != DriveOAuthReconnected {
		t.Fatalf("CompleteOAuth revive = %q, want %q", got, DriveOAuthReconnected)
	}
	connsRevived, err := fx.svc.List(ctx, Human(fx.user.ID), fx.work.ID)
	if err != nil || len(connsRevived) != 1 || connsRevived[0].ID != connID {
		t.Fatalf("revived connection = %+v, want same ID %s", connsRevived, connID)
	}

	// Check drive_file_access statuses: file1 restored to 'active', file2 still 'revoked_by_owner'.
	var st1, st2Access string
	if err := fx.pool.QueryRow(ctx, `SELECT status FROM drive_file_access WHERE drive_file_id = $1`, file1ID).Scan(&st1); err != nil || st1 != "active" {
		t.Fatalf("file1 access status = %q (err=%v), want active", st1, err)
	}
	if err := fx.pool.QueryRow(ctx, `SELECT status FROM drive_file_access WHERE drive_file_id = $1`, file2ID).Scan(&st2Access); err != nil || st2Access != "revoked_by_owner" {
		t.Fatalf("file2 access status = %q (err=%v), want revoked_by_owner", st2Access, err)
	}

	// Pending revocation row with no prior attempt evidence was deleted on reconnect, and worker does not call Google.
	if fx.svc.ProcessOneRevocation(ctx, "fake-sub-revive1") {
		t.Fatal("expected no revocation to run after reconnect cancelled pending row")
	}
	if len(fx.fake.RevokeCalls()) != 0 {
		t.Fatalf("RevokeCalls = %v, want empty", fx.fake.RevokeCalls())
	}
}

// TestDriveOAuthRefreshFenceAndInvalidGrant verifies:
// - AccessToken returns cached token when more than 2 minutes from expiry
// - Two concurrent goroutines calling AccessToken on an expiring connection share the in-process mutex so RefreshToken is called only once
// - Cross-pod fencing: if another writer bumps credential_version first, the loser drops its token without revoking it and returns the winner's token
// - On invalid_grant, markAuthFailed sets auth_failed_at + auth_failed_reason='invalid_grant', clears tokens, keeps the connection row visible in List with status='needs_reconnect' and needs_reconnect=true, and records drive_connection.auth_failed + drive_connection.changed (spec §5.3, §11).
func TestDriveOAuthRefreshFenceAndInvalidGrant(t *testing.T) {
	fx := newDriveTestFixture(t)
	ctx := context.Background()

	u, nonce, err := fx.svc.StartOAuth(ctx, Human(fx.user.ID), fx.work.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	st, _ := extractStateFromAuthURL(t, u)
	if got := fx.svc.CompleteOAuth(ctx, st, "refresh1", "", "", nonce); got != DriveOAuthConnected {
		t.Fatalf("CompleteOAuth = %q", got)
	}
	conns, err := fx.svc.List(ctx, Human(fx.user.ID), fx.work.ID)
	if err != nil || len(conns) != 1 {
		t.Fatal(err)
	}
	connID := conns[0].ID

	// Force access_expires_at to 1 minute from now (within 2m skew).
	soon := time.Now().UTC().Add(time.Minute).Truncate(time.Microsecond)
	if _, err := fx.pool.Exec(ctx, `UPDATE drive_connections SET access_expires_at = $2 WHERE id = $1`, connID, soon); err != nil {
		t.Fatal(err)
	}
	staleRow, err := fx.q.GetDriveConnection(ctx, db.GetDriveConnectionParams{ID: connID, OrganizationID: fx.org.ID, UserID: fx.user.ID})
	if err != nil {
		t.Fatal(err)
	}

	var refreshHits atomic.Int32
	fx.fake.SetRefresh(func(_ context.Context, refreshToken string) (DriveTokenResponse, error) {
		n := refreshHits.Add(1)
		time.Sleep(20 * time.Millisecond)
		return DriveTokenResponse{
			AccessToken:  "refreshed-access-" + string(rune('0'+n)),
			RefreshToken: refreshToken,
			Expiry:       time.Now().UTC().Add(time.Hour),
		}, nil
	})

	// Two goroutines concurrently refreshing the same stale snapshot -> only 1 refresh call hits the provider.
	var wg sync.WaitGroup
	tokens := make([]string, 2)
	errs := make([]error, 2)
	for i := range 2 {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			tokens[idx], _, errs[idx] = fx.svc.AccessToken(ctx, staleRow)
		}(i)
	}
	wg.Wait()
	for i := range 2 {
		if errs[i] != nil || tokens[i] != "refreshed-access-1" {
			t.Fatalf("goroutine %d: token=%q err=%v", i, tokens[i], errs[i])
		}
	}
	if got := refreshHits.Load(); got != 1 {
		t.Fatalf("refresh hits = %d, want 1", got)
	}
	if len(fx.fake.RevokeCalls()) != 0 {
		t.Fatalf("refresh race must never revoke tokens, got %v", fx.fake.RevokeCalls())
	}

	// Now expire again and return invalid_grant -> marks needs_reconnect.
	if _, err := fx.pool.Exec(ctx, `UPDATE drive_connections SET access_expires_at = $2 WHERE id = $1`, connID, soon); err != nil {
		t.Fatal(err)
	}
	expiringRow, err := fx.q.GetDriveConnection(ctx, db.GetDriveConnectionParams{ID: connID, OrganizationID: fx.org.ID, UserID: fx.user.ID})
	if err != nil {
		t.Fatal(err)
	}
	fx.fake.SetRefresh(func(_ context.Context, _ string) (DriveTokenResponse, error) {
		return DriveTokenResponse{}, &oauth2.RetrieveError{
			Response:  &http.Response{StatusCode: http.StatusBadRequest},
			ErrorCode: "invalid_grant",
		}
	})
	if _, _, err := fx.svc.AccessToken(ctx, expiringRow); !errors.Is(err, ErrDriveReauthRequired) {
		t.Fatalf("AccessToken on invalid_grant = %v, want ErrDriveReauthRequired", err)
	}

	listAfterFail, err := fx.svc.List(ctx, Human(fx.user.ID), fx.work.ID)
	if err != nil || len(listAfterFail) != 1 {
		t.Fatalf("List after invalid_grant = %+v, err=%v", listAfterFail, err)
	}
	if listAfterFail[0].Status != DriveConnectionStatusNeedsReconnect || !listAfterFail[0].NeedsReconnect ||
		listAfterFail[0].AuthFailedAt == nil || listAfterFail[0].AuthFailedReason != "invalid_grant" {
		t.Fatalf("connection view after invalid_grant = %+v", listAfterFail[0])
	}
}

// TestDriveRevocationProtocol53bMatrix tests every required §5.3b edge case from
// the implementation plan:
// 1. Disconnect -> restart -> worker revokes using the stored refresh token and clears refresh_token_enc
// 2. Cancel pending revocation while another active owner exists for the same google_sub across organizations (clears token without calling Google)
// 3. Callback exchanges code first, then a revoke attempt runs and resolves before callback saves -> callback refuses with retry_connect
// 4. Timeline t1 attempt starts -> t2 callback exchanges code -> t3 Google revoke completes -> t4 worker writes last_resolved_at -> t5 callback save is refused with retry_connect
// 5. Google processes revoke then network drops (timeout/error); lease expires; worker retries and receives 400 invalid_token -> resolves cleanly
// 6. Google succeeds (200) then resolve transaction fails -> row stays in revoking, retries after lease, and resolves
// 7. Two workers racing on the same google_sub -> only one claims the lease; a late/stale worker with an old (generation, attempt_id) cannot overwrite a newer generation after reconnect -> disconnect again -> third worker claims new generation
// 8. 24-hour retry budget exhausted -> worker abandons the row, clears refresh_token_enc, sets last_error, and increments drive_revocation_abandoned_total.
func TestDriveRevocationProtocol53bMatrix(t *testing.T) {
	fx := newDriveTestFixture(t)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Microsecond)
	fx.svc.now = func() time.Time { return now }

	connectSub := func(user db.User, wsID, code string) string {
		u, nonce, err := fx.svc.StartOAuth(ctx, Human(user.ID), wsID, "")
		if err != nil {
			t.Fatal(err)
		}
		st, _ := extractStateFromAuthURL(t, u)
		if got := fx.svc.CompleteOAuth(ctx, st, code, "", "", nonce); got != DriveOAuthConnected && got != DriveOAuthReconnected {
			t.Fatalf("CompleteOAuth(%s) = %q", code, got)
		}
		list, err := fx.svc.List(ctx, Human(user.ID), wsID)
		if err != nil {
			t.Fatal(err)
		}
		for _, c := range list {
			if c.GoogleEmail == "drive-"+code+"@example.com" {
				return c.ID
			}
		}
		t.Fatalf("connection for %s not found", code)
		return ""
	}

	// Case 1: Disconnect -> simulated server restart (new service instance) -> worker revokes stored token.
	conn1 := connectSub(fx.user, fx.work.ID, "subcase1")
	if err := fx.svc.Disconnect(ctx, Human(fx.user.ID), fx.work.ID, conn1); err != nil {
		t.Fatal(err)
	}
	restartedSvc := NewDriveConnectionService(fx.pool, fx.q, fx.ws, fx.box)
	restartedSvc.SetProvider(fx.fake)
	restartedSvc.SetFlags(driveConnectorFlags(t, true))
	restartedSvc.now = func() time.Time { return now }
	if n := restartedSvc.ProcessDueRevocations(ctx); n != 1 {
		t.Fatalf("ProcessDueRevocations after restart = %d, want 1", n)
	}
	if calls := fx.fake.RevokeCalls(); len(calls) != 1 || calls[0] != "fake-drive-refresh-subcase1" {
		t.Fatalf("RevokeCalls = %v, want [fake-drive-refresh-subcase1]", calls)
	}
	rev1, err := fx.q.GetDriveGrantRevocationForUpdate(ctx, "fake-sub-subcase1")
	if err != nil || rev1.RefreshTokenEnc.Valid || !rev1.ResolvedAt.Valid || !rev1.LastResolvedAt.Valid {
		t.Fatalf("rev1 after resolve = %+v, err=%v", rev1, err)
	}

	// Case 2: Shared Google account connected in two organizations; disconnecting one while the other is still active clears the queued token without calling Google revoke.
	as := NewAuthService(fx.pool, fx.q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	user2 := registerVerified(t, fx.q, as, "drive-org2-"+util.NewID()+"@example.com", "User2")
	org2, err := fx.orgs.Create(ctx, user2.ID, "Org 2", "drive-org2-"+strings.ToLower(util.NewID()[:8]))
	if err != nil {
		t.Fatal(err)
	}
	ws2View, err := fx.ws.CreateInOrg(ctx, user2.ID, org2.ID, "WS2", "ws2")
	if err != nil {
		t.Fatal(err)
	}
	cOrg1 := connectSub(fx.user, fx.work.ID, "sharedsub")
	_ = connectSub(user2, ws2View.Workspace.ID, "sharedsub")
	beforeRevokeLen := len(fx.fake.RevokeCalls())
	if err := fx.svc.Disconnect(ctx, Human(fx.user.ID), fx.work.ID, cOrg1); err != nil {
		t.Fatal(err)
	}
	// Worker runs while user2 in org2 still holds an active connection for fake-sub-sharedsub.
	_ = fx.svc.ProcessOneRevocation(ctx, "fake-sub-sharedsub")
	if len(fx.fake.RevokeCalls()) != beforeRevokeLen {
		t.Fatalf("Google revoke must NOT be called while another active connection exists for the same google_sub")
	}
	_, err = fx.q.GetDriveGrantRevocationForUpdate(ctx, "fake-sub-sharedsub")
	if !errors.Is(err, pgx.ErrNoRows) {
		t.Fatalf("expected pending revocation with no prior evidence to be deleted when active owner remains, got err=%v", err)
	}

	// Case 3 & 4: Timeline t1 attempt starts -> t2 callback exchanges code -> t3 Google revoke finishes -> t4 worker writes last_resolved_at -> t5 callback save is refused with retry_connect.
	cRace := connectSub(fx.user, fx.work.ID, "racesub")
	if err := fx.svc.Disconnect(ctx, Human(fx.user.ID), fx.work.ID, cRace); err != nil {
		t.Fatal(err)
	}
	uRace, nonceRace, err := fx.svc.StartOAuth(ctx, Human(fx.user.ID), fx.work.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	stRace, _ := extractStateFromAuthURL(t, uRace)

	// Hook: right after CompleteOAuth exchanges the code (at t2), the worker claims and resolves the revocation (t3, t4) before CompleteOAuth enters saveDriveConnection (t5).
	fx.svc.testBeforeCallbackTx = func(sub string) {
		if sub == "fake-sub-racesub" {
			now = now.Add(time.Second)
			if !fx.svc.ProcessOneRevocation(ctx, sub) {
				t.Errorf("expected worker to process revocation for %s", sub)
			}
			now = now.Add(time.Second)
		}
	}
	gotRace := fx.svc.CompleteOAuth(ctx, stRace, "racesub", "", "", nonceRace)
	fx.svc.testBeforeCallbackTx = nil
	if gotRace != DriveOAuthRetryConnect {
		t.Fatalf("CompleteOAuth when revoke overlapped code exchange = %q, want %q", gotRace, DriveOAuthRetryConnect)
	}

	//Also verify: if a worker is currently in-flight ("revoking" with unexpired lease) when callback tries to save, callback also refuses with retry_connect.
	now = now.Add(5 * time.Second)
	cInFlight := connectSub(fx.user, fx.work.ID, "inflightsub")
	if err := fx.svc.Disconnect(ctx, Human(fx.user.ID), fx.work.ID, cInFlight); err != nil {
		t.Fatal(err)
	}
	claimedInFlight, ok, err := fx.svc.claimRevocationAttempt(ctx, "fake-sub-inflightsub")
	if err != nil || !ok {
		t.Fatalf("claimRevocationAttempt: ok=%v err=%v", ok, err)
	}
	uIF, nonceIF, err := fx.svc.StartOAuth(ctx, Human(fx.user.ID), fx.work.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	stIF, _ := extractStateFromAuthURL(t, uIF)
	if got := fx.svc.CompleteOAuth(ctx, stIF, "inflightsub", "", "", nonceIF); got != DriveOAuthRetryConnect {
		t.Fatalf("CompleteOAuth while revocation attempt is in-flight = %q, want %q", got, DriveOAuthRetryConnect)
	}
	// Resolve the in-flight attempt; now reconnect after last_resolved_at succeeds!
	if err := fx.svc.resolveRevocationAttempt(ctx, claimedInFlight.GoogleSub, claimedInFlight.Generation, claimedInFlight.AttemptID.String, ""); err != nil {
		t.Fatal(err)
	}
	now = now.Add(2 * time.Second)
	uAfter, nonceAfter, err := fx.svc.StartOAuth(ctx, Human(fx.user.ID), fx.work.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	stAfter, _ := extractStateFromAuthURL(t, uAfter)
	if got := fx.svc.CompleteOAuth(ctx, stAfter, "inflightsub", "", "", nonceAfter); got != DriveOAuthReconnected {
		t.Fatalf("CompleteOAuth after revocation resolved = %q, want %q", got, DriveOAuthReconnected)
	}

	// Case 5: Google processes revoke, then network drops (first call returns error); after lease expires, retry gets 400 invalid_token -> resolves cleanly.
	if err := fx.svc.Disconnect(ctx, Human(fx.user.ID), fx.work.ID, cInFlight); err != nil {
		t.Fatal(err)
	}
	var netCalls int
	fx.fake.SetRevoke(func(_ context.Context, _ string) error {
		netCalls++
		if netCalls == 1 {
			return context.DeadlineExceeded
		}
		return ErrDriveRevokeAlreadyInvalid
	})
	if fx.svc.ProcessOneRevocation(ctx, "fake-sub-inflightsub") {
		t.Fatal("first attempt with network drop should not resolve")
	}
	// While lease is still valid (< 2m), a second worker cannot claim it.
	now = now.Add(30 * time.Second)
	if _, ok, err := fx.svc.claimRevocationAttempt(ctx, "fake-sub-inflightsub"); err != nil || ok {
		t.Fatalf("second worker claimed before lease expiry: ok=%v err=%v", ok, err)
	}
	// Advance past 2m lease TTL -> retry runs, gets 400 invalid_token, and resolves.
	now = now.Add(driveRevocationLeaseTTL)
	if !fx.svc.ProcessOneRevocation(ctx, "fake-sub-inflightsub") {
		t.Fatal("retry after lease expiry with 400 invalid_token must resolve")
	}
	fx.fake.SetRevoke(nil)

	// Case 6: Google succeeds (200 OK), then Transaction 2 (resolveRevocationAttempt) fails -> row stays in revoking state with token intact, and after lease expires a retry resolves cleanly.
	now = now.Add(5 * time.Second)
	_ = connectSub(fx.user, fx.work.ID, "inflightsub")
	if err := fx.svc.Disconnect(ctx, Human(fx.user.ID), fx.work.ID, cInFlight); err != nil {
		t.Fatal(err)
	}
	var resolveFailures int
	fx.svc.testBeforeResolveTx = func(_ string, _ int64, _ string) error {
		resolveFailures++
		if resolveFailures == 1 {
			return errors.New("simulated db commit failure on resolve tx")
		}
		return nil
	}
	if fx.svc.ProcessOneRevocation(ctx, "fake-sub-inflightsub") {
		t.Fatal("expected ProcessOneRevocation to return false when resolve transaction fails")
	}
	rowAfterTxFail, err := fx.q.GetDriveGrantRevocationForUpdate(ctx, "fake-sub-inflightsub")
	if err != nil || rowAfterTxFail.ResolvedAt.Valid || !rowAfterTxFail.RefreshTokenEnc.Valid || !rowAfterTxFail.AttemptID.Valid {
		t.Fatalf("row after resolve tx failure = %+v, err=%v", rowAfterTxFail, err)
	}
	now = now.Add(driveRevocationLeaseTTL + time.Second)
	if !fx.svc.ProcessOneRevocation(ctx, "fake-sub-inflightsub") {
		t.Fatal("expected retry after resolve tx failure to succeed")
	}
	fx.svc.testBeforeResolveTx = nil

	// Case 7: Stale worker result with old (generation, attempt_id) cannot overwrite a newer generation; reconnect -> disconnect again while old attempt is in-flight holds the new disconnect's upsert and keeps the in-flight attempt until resolved.
	now = now.Add(5 * time.Second)
	cGen := connectSub(fx.user, fx.work.ID, "gensub")
	if err := fx.svc.Disconnect(ctx, Human(fx.user.ID), fx.work.ID, cGen); err != nil {
		t.Fatal(err)
	}
	attemptGen1, ok, err := fx.svc.claimRevocationAttempt(ctx, "fake-sub-gensub")
	if err != nil || !ok {
		t.Fatalf("claim gen1: ok=%v err=%v", ok, err)
	}
	// Advance past lease TTL so a second worker claims a new attempt_id on the same generation.
	now = now.Add(driveRevocationLeaseTTL + time.Second)
	attemptGen1B, ok, err := fx.svc.claimRevocationAttempt(ctx, "fake-sub-gensub")
	if err != nil || !ok || attemptGen1B.AttemptID.String == attemptGen1.AttemptID.String {
		t.Fatalf("claim gen1B: %+v ok=%v err=%v", attemptGen1B, ok, err)
	}
	// Now the stale first worker finishes and tries to resolve with attemptGen1.AttemptID -> 0 rows updated!
	if err := fx.svc.resolveRevocationAttempt(ctx, "fake-sub-gensub", attemptGen1.Generation, attemptGen1.AttemptID.String, ""); err != nil {
		t.Fatal(err)
	}
	rowStillOpen, err := fx.q.GetDriveGrantRevocationForUpdate(ctx, "fake-sub-gensub")
	if err != nil || rowStillOpen.ResolvedAt.Valid || rowStillOpen.AttemptID.String != attemptGen1B.AttemptID.String {
		t.Fatalf("stale worker must not resolve attemptGen1B: %+v", rowStillOpen)
	}
	// Worker 1B resolves properly.
	if err := fx.svc.resolveRevocationAttempt(ctx, "fake-sub-gensub", attemptGen1B.Generation, attemptGen1B.AttemptID.String, ""); err != nil {
		t.Fatal(err)
	}
	// Reconnect after gen1 resolved, then disconnect again -> generation increments to 2 and a third worker claims generation 2; an old generation 1 resolve call is a no-op.
	now = now.Add(2 * time.Second)
	_ = connectSub(fx.user, fx.work.ID, "gensub")
	if err := fx.svc.Disconnect(ctx, Human(fx.user.ID), fx.work.ID, cGen); err != nil {
		t.Fatal(err)
	}
	attemptGen2, ok, err := fx.svc.claimRevocationAttempt(ctx, "fake-sub-gensub")
	if err != nil || !ok || attemptGen2.Generation != attemptGen1.Generation+1 {
		t.Fatalf("claim gen2: %+v ok=%v err=%v, want generation %d", attemptGen2, ok, err, attemptGen1.Generation+1)
	}
	if err := fx.svc.resolveRevocationAttempt(ctx, "fake-sub-gensub", attemptGen1.Generation, attemptGen2.AttemptID.String, ""); err != nil {
		t.Fatal(err)
	}
	if afterStaleGen, err := fx.q.GetDriveGrantRevocationForUpdate(ctx, "fake-sub-gensub"); err != nil || afterStaleGen.ResolvedAt.Valid {
		t.Fatalf("old generation resolve must not resolve gen2: %+v", afterStaleGen)
	}
	if err := fx.svc.resolveRevocationAttempt(ctx, "fake-sub-gensub", attemptGen2.Generation, attemptGen2.AttemptID.String, ""); err != nil {
		t.Fatal(err)
	}

	// Case 8: 24h abandon window -> clears refresh_token_enc, sets last_error, increments metric.
	now = now.Add(5 * time.Second)
	cAbandon := connectSub(fx.user, fx.work.ID, "abandonsub")
	if err := fx.svc.Disconnect(ctx, Human(fx.user.ID), fx.work.ID, cAbandon); err != nil {
		t.Fatal(err)
	}
	var abandonedMetric atomic.Int32
	fx.svc.SetMetrics(&testDriveMetrics{onAbandoned: func() { abandonedMetric.Add(1) }})
	fx.fake.SetRevoke(func(_ context.Context, _ string) error {
		return errors.New("google 503")
	})
	now = now.Add(driveRevocationAbandonWindow + time.Minute)
	if !fx.svc.ProcessOneRevocation(ctx, "fake-sub-abandonsub") {
		t.Fatal("expected 24h expired revocation to resolve as abandoned")
	}
	if abandonedMetric.Load() != 1 {
		t.Fatalf("abandonedMetric = %d, want 1", abandonedMetric.Load())
	}
	abandonedRow, err := fx.q.GetDriveGrantRevocationForUpdate(ctx, "fake-sub-abandonsub")
	if err != nil || abandonedRow.RefreshTokenEnc.Valid || !abandonedRow.ResolvedAt.Valid || abandonedRow.LastError == "" {
		t.Fatalf("abandonedRow = %+v, err=%v", abandonedRow, err)
	}
	fx.fake.SetRevoke(nil)

	// PurgeExpiredRevocations removes resolved rows whose timestamps are > 24h old.
	now = now.Add(driveRevocationEvidenceRetention + time.Minute)
	purged, err := fx.svc.PurgeExpiredRevocations(ctx)
	if err != nil || purged == 0 {
		t.Fatalf("PurgeExpiredRevocations = %d, err=%v, want > 0", purged, err)
	}
}

type testDriveMetrics struct {
	onRefreshFail func()
	onAbandoned   func()
}

func (m *testDriveMetrics) ObserveTokenRefreshFailure() {
	if m.onRefreshFail != nil {
		m.onRefreshFail()
	}
}

func (m *testDriveMetrics) ObserveRevocationAbandoned() {
	if m.onAbandoned != nil {
		m.onAbandoned()
	}
}

// TestDriveConnectionLifecycleAndMultiOrgIsolation verifies spec §5.3a and ADR 0032:
// - A legacy account belonging to two organizations only sees the Drive connections of the organization of the workspace in the request path
// - Deactivating a member disconnects their Drive connections in that organization only
// - Leaving an organization disconnects their Drive connections in that organization
// - Switching organizations on invitation accept (sole owner closes old org) disconnects their Drive connections in the old organization
// - Deleting the user account disconnects their Drive connections across all organizations and enqueues revocations.
func TestDriveConnectionLifecycleAndMultiOrgIsolation(t *testing.T) {
	fx := newDriveTestFixture(t)
	ctx := context.Background()

	// Create a second organization and add fx.user to it directly (legacy multi-org account, ADR 0032).
	as := NewAuthService(fx.pool, fx.q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	ownerB := registerVerified(t, fx.q, as, "drive-ownerb-"+util.NewID()+"@example.com", "OwnerB")
	orgB, err := fx.orgs.Create(ctx, ownerB.ID, "Org B", "drive-orgb-"+strings.ToLower(util.NewID()[:8]))
	if err != nil {
		t.Fatal(err)
	}
	wsBView, err := fx.ws.CreateInOrg(ctx, ownerB.ID, orgB.ID, "WS B", "ws-b")
	if err != nil {
		t.Fatal(err)
	}
	wsB := wsBView.Workspace
	if _, err := fx.pool.Exec(ctx, `INSERT INTO organization_members (organization_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`, orgB.ID, fx.user.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := fx.pool.Exec(ctx, `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'member')`, wsB.ID, fx.user.ID); err != nil {
		t.Fatal(err)
	}

	connectInWS := func(userID, wsID, code string) {
		u, nonce, err := fx.svc.StartOAuth(ctx, Human(userID), wsID, "")
		if err != nil {
			t.Fatal(err)
		}
		st, _ := extractStateFromAuthURL(t, u)
		if got := fx.svc.CompleteOAuth(ctx, st, code, "", "", nonce); got != DriveOAuthConnected {
			t.Fatalf("CompleteOAuth(%s) = %q", code, got)
		}
	}

	connectInWS(fx.user.ID, fx.work.ID, "orga-acct")
	connectInWS(fx.user.ID, wsB.ID, "orgb-acct")

	// Listing in fx.work only shows orga-acct; listing in wsB only shows orgb-acct.
	listA, err := fx.svc.List(ctx, Human(fx.user.ID), fx.work.ID)
	if err != nil || len(listA) != 1 || listA[0].GoogleEmail != "drive-orga-acct@example.com" {
		t.Fatalf("List(wsA) = %+v, err=%v", listA, err)
	}
	listB, err := fx.svc.List(ctx, Human(fx.user.ID), wsB.ID)
	if err != nil || len(listB) != 1 || listB[0].GoogleEmail != "drive-orgb-acct@example.com" {
		t.Fatalf("List(wsB) = %+v, err=%v", listB, err)
	}

	// OwnerB deactivates fx.user in orgB -> orgB connection is disconnected and queued for revocation; orgA connection stays active!
	memberSvc := NewOrganizationMemberService(fx.pool, fx.q, fx.orgs)
	if _, err := memberSvc.Deactivate(ctx, ownerB.ID, orgB.ID, fx.user.ID); err != nil {
		t.Fatalf("Deactivate: %v", err)
	}
	listAAfterDeact, err := fx.svc.List(ctx, Human(fx.user.ID), fx.work.ID)
	if err != nil || len(listAAfterDeact) != 1 {
		t.Fatalf("List(wsA) after orgB deactivate = %+v, err=%v", listAAfterDeact, err)
	}
	revOrgB, err := fx.q.GetDriveGrantRevocationForUpdate(ctx, "fake-sub-orgb-acct")
	if err != nil || !revOrgB.RefreshTokenEnc.Valid {
		t.Fatalf("expected revocation queued for orgb-acct on deactivate: %+v, err=%v", revOrgB, err)
	}

	// Reactivate fx.user in orgB, reconnect orgb-acct, and have fx.user Leave orgB -> disconnects orgB connection.
	if _, err := memberSvc.Reactivate(ctx, ownerB.ID, orgB.ID, fx.user.ID); err != nil {
		t.Fatalf("Reactivate: %v", err)
	}
	if _, err := fx.pool.Exec(ctx, `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING`, wsB.ID, fx.user.ID); err != nil {
		t.Fatal(err)
	}
	_ = fx.svc.ProcessOneRevocation(ctx, "fake-sub-orgb-acct")
	uRe, nonceRe, err := fx.svc.StartOAuth(ctx, Human(fx.user.ID), wsB.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	stRe, _ := extractStateFromAuthURL(t, uRe)
	if got := fx.svc.CompleteOAuth(ctx, stRe, "orgb-acct", "", "", nonceRe); got != DriveOAuthReconnected {
		t.Fatalf("CompleteOAuth reconnect orgb = %q", got)
	}
	if err := memberSvc.Leave(ctx, fx.user.ID, orgB.ID); err != nil {
		t.Fatalf("Leave: %v", err)
	}
	revOrgBAfterLeave, err := fx.q.GetDriveGrantRevocationForUpdate(ctx, "fake-sub-orgb-acct")
	if err != nil || !revOrgBAfterLeave.RefreshTokenEnc.Valid {
		t.Fatalf("expected revocation queued on Leave: %+v, err=%v", revOrgBAfterLeave, err)
	}

	// Invitation switch (Close sole-owner orgA when accepting invitation into orgB).
	outbox := &fakeOutbox{}
	memberSvc.SetMail(mail.Renderer{AppURL: "http://localhost:3000"}, outbox)
	inv, _, err := memberSvc.InviteToOrg(ctx, ownerB.ID, orgB.ID, []string{fx.user.Email}, OrgRoleMember, nil)
	if err != nil || len(inv) != 1 {
		t.Fatalf("InviteToOrg: %v", err)
	}
	if _, err := fx.ws.AcceptInvite(ctx, fx.user.ID, inv[0].Token, []SwitchResolution{{OrganizationID: fx.org.ID, Action: SwitchActionClose, ConfirmSlug: fx.org.Slug}}); err != nil {
		t.Fatalf("AcceptInvite with SwitchActionClose: %v", err)
	}
	revOrgA, err := fx.q.GetDriveGrantRevocationForUpdate(ctx, "fake-sub-orga-acct")
	if err != nil || !revOrgA.RefreshTokenEnc.Valid {
		t.Fatalf("expected revocation queued on sole-owner org close: %+v, err=%v", revOrgA, err)
	}

	// Account deletion: ownerB connects a Drive account in orgB, then deletes their UniWork account -> disconnects and queues revocation.
	connectInWS(ownerB.ID, wsB.ID, "ownerb-acct")
	if err := as.DeleteAccount(ctx, ownerB.ID, DeleteAccountInput{
		Password:          "password123",
		EmailConfirmation: ownerB.Email,
		CloseOrganization: orgB.Slug,
	}); err != nil {
		t.Fatalf("DeleteAccount: %v", err)
	}
	revOwnerB, err := fx.q.GetDriveGrantRevocationForUpdate(ctx, "fake-sub-ownerb-acct")
	if err != nil || !revOwnerB.RefreshTokenEnc.Valid {
		t.Fatalf("expected revocation queued on DeleteAccount: %+v, err=%v", revOwnerB, err)
	}
}
