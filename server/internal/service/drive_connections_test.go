package service

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
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
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/oauth2"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/outbox"
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
			"access_token":  "tok-a",
			"refresh_token": "tok-r",
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
		GoogleDriveClientSecret: "sec-1",
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
	tok, err := p.Exchange(ctx, "code-1", "ver-1")
	if err != nil {
		t.Fatalf("Exchange: %v", err)
	}
	if tok.AccessToken != "tok-a" || tok.RefreshToken != "tok-r" || !driveScopesInclude(tok.Scopes, DriveGoogleScope) {
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
	tokUnverified, err := p.Exchange(ctx, "code-2", "ver-1")
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
	tokWrongAud, err := p.Exchange(ctx, "code-3", "ver-1")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := p.VerifyIDToken(ctx, tokWrongAud.IDToken, "expected-nonce"); err == nil {
		t.Fatal("expected wrong audience to fail VerifyIDToken")
	}

	// Wrong issuer must be rejected by real go-oidc verifier (R1-13).
	oidcSrv.mu.Lock()
	oidcSrv.claims["aud"] = "drive-client-id"
	oidcSrv.claims["iss"] = "https://wrong-issuer.example.com"
	oidcSrv.mu.Unlock()
	tokWrongIss, err := p.Exchange(ctx, "code-4", "ver-1")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := p.VerifyIDToken(ctx, tokWrongIss.IDToken, "expected-nonce"); err == nil {
		t.Fatal("expected wrong issuer to fail VerifyIDToken")
	}

	// Expired id_token must be rejected by real go-oidc verifier (R1-13).
	oidcSrv.mu.Lock()
	oidcSrv.claims["iss"] = oidcSrv.srv.URL
	oidcSrv.claims["exp"] = time.Now().Add(-time.Hour).Unix()
	oidcSrv.mu.Unlock()
	tokExpired, err := p.Exchange(ctx, "code-5", "ver-1")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := p.VerifyIDToken(ctx, tokExpired.IDToken, "expected-nonce"); err == nil {
		t.Fatal("expected expired id_token to fail VerifyIDToken")
	}

	// RevokeToken: 200 OK -> nil; 400 invalid_token -> ErrDriveRevokeAlreadyInvalid; 500 -> error.
	if err := p.RevokeToken(ctx, "tok-r1"); err != nil {
		t.Fatalf("RevokeToken 200: %v", err)
	}
	oidcSrv.mu.Lock()
	oidcSrv.revokeCode = http.StatusBadRequest
	oidcSrv.revokeBody = `{"error":"invalid_token"}`
	oidcSrv.mu.Unlock()
	if err := p.RevokeToken(ctx, "tok-r2"); !errors.Is(err, ErrDriveRevokeAlreadyInvalid) {
		t.Fatalf("RevokeToken 400 invalid_token = %v, want ErrDriveRevokeAlreadyInvalid", err)
	}
	oidcSrv.mu.Lock()
	oidcSrv.revokeCode = http.StatusBadRequest
	oidcSrv.revokeBody = `{"error":"invalid_request"}`
	oidcSrv.mu.Unlock()
	if err := p.RevokeToken(ctx, "tok-r3"); err == nil || errors.Is(err, ErrDriveRevokeAlreadyInvalid) {
		t.Fatalf("RevokeToken 400 invalid_request = %v, want non-invalid_token error", err)
	}
	oidcSrv.mu.Lock()
	oidcSrv.revokeCode = http.StatusInternalServerError
	oidcSrv.revokeBody = `{"error":"server_error"}`
	oidcSrv.mu.Unlock()
	if err := p.RevokeToken(ctx, "tok-r4"); err == nil {
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
		CookieNonce:    "cn-1",
		OIDCNonce:      "on-1",
		Verifier:       "ver-1",
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
		GoogleDriveClientSecret: "sec-1",
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
// - StartOAuth seals state with UserID, OrganizationID, WorkspaceID, CookieNonce, OIDCNonce, PKCE Verifier, and sets S256 challenge + prompt="consent select_account" on fresh connect
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
	if q.Get("prompt") != "consent select_account" || q.Get("login_hint") != "" || q.Get("code_challenge_method") != "S256" {
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
	if reconnQ.Get("prompt") != "consent" || reconnQ.Get("login_hint") != "drive-acct1@example.com" {
		t.Fatalf("reconnect query = %v, want prompt=consent login_hint=drive-acct1@example.com", reconnQ)
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
// - Disconnecting a connection sets disconnected_at, clears tokens, and enqueues the encrypted refresh token into drive_grant_revocations
// - Reconnecting the same (org, user, google_sub) revives the disconnected row in place (same connection ID)
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

	// B4 (UNI-2180) adds: seed drive_files + drive_file_access rows ('active' and 'revoked_by_owner'), assert Disconnect transitions 'active' -> 'disconnected', and assert Revive restores 'disconnected' -> 'active' while leaving 'revoked_by_owner' untouched.

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

	// B4 (UNI-2180) adds: assert drive_file_access status transitions ('disconnected' -> 'active', 'revoked_by_owner' unchanged) after revive.

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

	// Cross-pod refresh fence (R1-3 / R1-13): two independent DriveConnectionService
	// instances (separate in-process mutexes) race on the same expiring row.
	// Scenario A: Both pods get 200 OK from Google; Pod B writes first, Pod A's
	// UpdateDriveConnectionTokens affects 0 rows -> Pod A drops its token without
	// revoking it and returns Pod B's winning token.
	if _, err := fx.pool.Exec(ctx, `UPDATE drive_connections SET access_expires_at = $2 WHERE id = $1`, connID, soon); err != nil {
		t.Fatal(err)
	}
	crossPodRow, err := fx.q.GetDriveConnection(ctx, db.GetDriveConnectionParams{ID: connID, OrganizationID: fx.org.ID, UserID: fx.user.ID})
	if err != nil {
		t.Fatal(err)
	}
	podA := NewDriveConnectionService(fx.pool, fx.q, fx.ws, fx.box)
	podB := NewDriveConnectionService(fx.pool, fx.q, fx.ws, fx.box)
	podA.SetFlags(driveConnectorFlags(t, true))
	podB.SetFlags(driveConnectorFlags(t, true))

	fakeA := NewFakeDriveProvider(config.Config{APIPublicURL: "https://api.example.com", GoogleDriveClientID: "drive-client-id", GoogleDriveClientSecret: "sec-1"})
	fakeB := NewFakeDriveProvider(config.Config{APIPublicURL: "https://api.example.com", GoogleDriveClientID: "drive-client-id", GoogleDriveClientSecret: "sec-1"})
	podA.SetProvider(fakeA)
	podB.SetProvider(fakeB)

	podAInRefresh := make(chan struct{})
	releasePodA := make(chan struct{})
	fakeA.SetRefresh(func(_ context.Context, refreshToken string) (DriveTokenResponse, error) {
		close(podAInRefresh)
		<-releasePodA
		return DriveTokenResponse{
			AccessToken:  "tok-loser-a",
			RefreshToken: refreshToken,
			Expiry:       time.Now().UTC().Add(2 * time.Hour).Truncate(time.Microsecond),
		}, nil
	})
	fakeB.SetRefresh(func(_ context.Context, refreshToken string) (DriveTokenResponse, error) {
		return DriveTokenResponse{
			AccessToken:  "tok-winner-b",
			RefreshToken: refreshToken,
			Expiry:       time.Now().UTC().Add(time.Hour).Truncate(time.Microsecond),
		}, nil
	})

	var tokA string
	var errA error
	doneA := make(chan struct{})
	go func() {
		defer close(doneA)
		tokA, _, errA = podA.AccessToken(ctx, crossPodRow)
	}()
	<-podAInRefresh
	tokB, _, errB := podB.AccessToken(ctx, crossPodRow)
	if errB != nil || tokB != "tok-winner-b" {
		t.Fatalf("podB AccessToken = %q, err=%v, want tok-winner-b", tokB, errB)
	}
	close(releasePodA)
	<-doneA
	if errA != nil || tokA != "tok-winner-b" {
		t.Fatalf("podA (loser) AccessToken = %q, err=%v, want winner's tok-winner-b", tokA, errA)
	}
	if len(fakeA.RevokeCalls()) != 0 || len(fakeB.RevokeCalls()) != 0 {
		t.Fatalf("cross-pod refresh race must never revoke tokens: A=%v B=%v", fakeA.RevokeCalls(), fakeB.RevokeCalls())
	}

	// Scenario B (R1-3): Pod A gets a late invalid_grant on the old snapshot while
	// Pod B already refreshed at the same credential_version (updating access_expires_at
	// and access_token_enc). Pod A's markAuthFailed must NOT overwrite Pod B's winning
	// token or mark the connection failed, even if markAuthFailed runs directly against
	// the stale snapshot!
	if _, err := fx.pool.Exec(ctx, `UPDATE drive_connections SET access_expires_at = $2 WHERE id = $1`, connID, soon); err != nil {
		t.Fatal(err)
	}
	staleForInvalidGrant, err := fx.q.GetDriveConnection(ctx, db.GetDriveConnectionParams{ID: connID, OrganizationID: fx.org.ID, UserID: fx.user.ID})
	if err != nil {
		t.Fatal(err)
	}
	podAStartedInvalid := make(chan struct{})
	releasePodAInvalid := make(chan struct{})
	fakeA.SetRefresh(func(_ context.Context, _ string) (DriveTokenResponse, error) {
		close(podAStartedInvalid)
		<-releasePodAInvalid
		return DriveTokenResponse{}, &oauth2.RetrieveError{
			Response:  &http.Response{StatusCode: http.StatusBadRequest},
			ErrorCode: "invalid_grant",
		}
	})
	fakeB.SetRefresh(func(_ context.Context, refreshToken string) (DriveTokenResponse, error) {
		return DriveTokenResponse{
			AccessToken:  "tok-winner-b2",
			RefreshToken: refreshToken,
			Expiry:       time.Now().UTC().Add(time.Hour).Truncate(time.Microsecond),
		}, nil
	})
	loserBeforeMark := make(chan struct{})
	winnerCommitted := make(chan struct{})
	var onceBeforeMark atomic.Bool
	podA.testBeforeMarkAuthFailed = func(conn db.DriveConnection) {
		if conn.ID == connID && onceBeforeMark.CompareAndSwap(false, true) {
			close(loserBeforeMark)
			<-winnerCommitted
		}
	}
	doneAInvalid := make(chan struct{})
	var expA time.Time
	go func() {
		defer close(doneAInvalid)
		tokA, expA, errA = podA.AccessToken(ctx, staleForInvalidGrant)
	}()
	<-podAStartedInvalid
	// Release Pod A's invalid_grant error FIRST so Pod A passes its first reread
	// (lines 118-120) and pauses at testBeforeMarkAuthFailed right before markAuthFailed!
	close(releasePodAInvalid)
	<-loserBeforeMark
	tokB2, expB2, errB2 := podB.AccessToken(ctx, staleForInvalidGrant)
	if errB2 != nil || tokB2 != "tok-winner-b2" {
		t.Fatalf("podB2 AccessToken = %q, err=%v", tokB2, errB2)
	}
	close(winnerCommitted)
	<-doneAInvalid
	podA.testBeforeMarkAuthFailed = nil
	if errA != nil || tokA != "tok-winner-b2" || !expA.Equal(expB2) {
		t.Fatalf("podA late invalid_grant fallback after podB refresh = %q (exp %v), err=%v, want tok-winner-b2 (exp %v)", tokA, expA, errA, expB2)
	}
	var authFailedAuditCount int
	if err := fx.pool.QueryRow(ctx, `
		SELECT count(*) FROM audit_events
		WHERE organization_id = $1 AND action = 'drive_connection.auth_failed' AND resource_id = $2`,
		fx.org.ID, connID).Scan(&authFailedAuditCount); err != nil || authFailedAuditCount != 0 {
		t.Fatalf("auth_failed audit count after fenced loser fallback = %d, err=%v, want 0", authFailedAuditCount, err)
	}
	// Also call markAuthFailed directly with the stale snapshot (simulating Pod A
	// passing the reread check microseconds before Pod B committed its refresh)
	// to prove the SQL UPDATE predicate itself fences on PrevExpiresAt + RefreshTokenEnc.
	if podA.markAuthFailed(ctx, staleForInvalidGrant, staleForInvalidGrant.CredentialVersion, "invalid_grant") {
		t.Fatal("markAuthFailed with stale expiry snapshot must return false after winning refresh")
	}
	listAfterLateInvalid, err := fx.svc.List(ctx, Human(fx.user.ID), fx.work.ID)
	if err != nil || len(listAfterLateInvalid) != 1 || listAfterLateInvalid[0].NeedsReconnect || listAfterLateInvalid[0].Status != DriveConnectionStatusActive {
		t.Fatalf("connection after late invalid_grant = %+v, err=%v, want active", listAfterLateInvalid, err)
	}

	// Now expire again and return uncontested invalid_grant -> marks needs_reconnect.
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

	// Verify drive_connection.auth_failed audit row (R1-9): actor is the owning
	// UniWork human (kind="human", id=fx.user.ID) and metadata carries both
	// google_email and google_sub (spec §5.5, §11).
	var actorKind, actorID, rawMeta string
	if err := fx.pool.QueryRow(ctx, `
		SELECT actor_kind, actor_id, metadata::text
		FROM audit_events
		WHERE organization_id = $1 AND action = 'drive_connection.auth_failed' AND resource_id = $2
		ORDER BY occurred_at DESC LIMIT 1`, fx.org.ID, connID).Scan(&actorKind, &actorID, &rawMeta); err != nil {
		t.Fatalf("read drive_connection.auth_failed audit row: %v", err)
	}
	var meta map[string]any
	if err := json.Unmarshal([]byte(rawMeta), &meta); err != nil {
		t.Fatalf("unmarshal audit metadata %q: %v", rawMeta, err)
	}
	if actorKind != "human" || actorID != fx.user.ID ||
		meta["google_email"] != "drive-refresh1@example.com" || meta["google_sub"] != "fake-sub-refresh1" ||
		meta["reason"] != "invalid_grant" {
		t.Fatalf("auth_failed audit row: actor=%s:%s meta=%v", actorKind, actorID, meta)
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
	if n := restartedSvc.ProcessDueRevocations(ctx); n < 1 {
		t.Fatalf("ProcessDueRevocations after restart = %d, want >= 1", n)
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
	cOrg2 := connectSub(user2, ws2View.Workspace.ID, "sharedsub")

	// Assert dual identity in audit_events for two UniWork users sharing the same google_sub (R1-9, R1-13, spec §5.5, §11).
	for _, tc := range []struct {
		orgID  string
		userID string
		connID string
	}{
		{fx.org.ID, fx.user.ID, cOrg1},
		{org2.ID, user2.ID, cOrg2},
	} {
		var aKind, aID, mRaw string
		if err := fx.pool.QueryRow(ctx, `
			SELECT actor_kind, actor_id, metadata::text
			FROM audit_events
			WHERE organization_id = $1 AND action = 'drive_connection.connected' AND resource_id = $2
			ORDER BY occurred_at DESC LIMIT 1`, tc.orgID, tc.connID).Scan(&aKind, &aID, &mRaw); err != nil {
			t.Fatalf("read drive_connection.connected audit row for user %s: %v", tc.userID, err)
		}
		var m map[string]any
		if err := json.Unmarshal([]byte(mRaw), &m); err != nil {
			t.Fatal(err)
		}
		if aKind != "human" || aID != tc.userID || m["google_email"] != "drive-sharedsub@example.com" || m["google_sub"] != "fake-sub-sharedsub" {
			t.Fatalf("shared-sub audit row for %s: actor=%s:%s meta=%v", tc.userID, aKind, aID, m)
		}
	}
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

	// Case 9 (R1-13): Held real worker between count/claim (tx1) and Google call (step 2) ->
	// callback runs while worker is held -> callback refuses with retry_connect ->
	// worker is released -> calls Google revoke and resolves cleanly.
	now = now.Add(5 * time.Second)
	cHeldBetween := connectSub(fx.user, fx.work.ID, "heldbetween")
	if err := fx.svc.Disconnect(ctx, Human(fx.user.ID), fx.work.ID, cHeldBetween); err != nil {
		t.Fatal(err)
	}
	workerHeldAfterClaim := make(chan struct{})
	releaseWorkerToGoogle := make(chan struct{})
	fx.svc.testAfterRevocationClaimTx = func(sub string, _ db.DriveGrantRevocation) {
		if sub == "fake-sub-heldbetween" {
			close(workerHeldAfterClaim)
			<-releaseWorkerToGoogle
		}
	}
	workerDoneCh := make(chan bool, 1)
	go func() {
		workerDoneCh <- fx.svc.ProcessOneRevocation(ctx, "fake-sub-heldbetween")
	}()
	<-workerHeldAfterClaim

	uHB, nonceHB, err := fx.svc.StartOAuth(ctx, Human(fx.user.ID), fx.work.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	stHB, _ := extractStateFromAuthURL(t, uHB)
	if got := fx.svc.CompleteOAuth(ctx, stHB, "heldbetween", "", "", nonceHB); got != DriveOAuthRetryConnect {
		t.Fatalf("CompleteOAuth while worker is held between count/claim and Google call = %q, want %q", got, DriveOAuthRetryConnect)
	}
	close(releaseWorkerToGoogle)
	if !<-workerDoneCh {
		t.Fatal("held worker must finish revocation after release")
	}
	fx.svc.testAfterRevocationClaimTx = nil

	// Case 10 (R1-13, R2-2): Exact timeline t1 claim -> t2 callback exchange -> t3 Google revoke ->
	// t4 resolve -> t5 callback save rejection (retry_connect).
	// Use real wall-clock time (`time.Now`) aligned with PostgreSQL `now()` so the
	// callback's exchange_started_at and PostgreSQL's persisted last_attempt_started_at /
	// last_resolved_at share one monotonic clock, and assert the persisted DB timestamps
	// satisfy t1_claim <= exchange_started_at < t4_resolve!
	fx.svc.now = time.Now
	cExactT15 := connectSub(fx.user, fx.work.ID, "exactt15")
	if err := fx.svc.Disconnect(ctx, Human(fx.user.ID), fx.work.ID, cExactT15); err != nil {
		t.Fatal(err)
	}
	uT15, nonceT15, err := fx.svc.StartOAuth(ctx, Human(fx.user.ID), fx.work.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	stT15, _ := extractStateFromAuthURL(t, uT15)

	var seq []string
	var seqMu sync.Mutex
	recordStep := func(s string) {
		seqMu.Lock()
		seq = append(seq, s)
		seqMu.Unlock()
	}
	t1Claimed := make(chan struct{})
	t2Exchanged := make(chan struct{})
	t4Resolved := make(chan struct{})
	var exchangeTimeMu sync.Mutex
	var latestNowUTC time.Time
	var nowCallsSinceStart int
	var t2ExchangeAt time.Time
	var t2ExchangeNowCall int

	fx.svc.testAfterRevocationClaimTx = func(sub string, _ db.DriveGrantRevocation) {
		if sub == "fake-sub-exactt15" {
			recordStep("t1_claim")
			close(t1Claimed)
			<-t2Exchanged
		}
	}
	fx.fake.SetExchange(func(_ context.Context, code, _ string) (DriveTokenResponse, error) {
		if code == "exactt15" {
			exchangeTimeMu.Lock()
			t2ExchangeAt = latestNowUTC
			t2ExchangeNowCall = nowCallsSinceStart
			exchangeTimeMu.Unlock()
			recordStep("t2_exchange")
		}
		return DriveTokenResponse{
			AccessToken:  "fake-drive-access-" + code,
			RefreshToken: "fake-drive-refresh-" + code,
			Expiry:       time.Now().UTC().Add(time.Hour),
			IDToken:      "fake-id-token:" + code,
			Scopes:       "openid email " + DriveGoogleScope,
		}, nil
	})
	fx.fake.SetRevoke(func(_ context.Context, token string) error {
		if token == "fake-drive-refresh-exactt15" {
			recordStep("t3_revoke")
		}
		return nil
	})
	fx.svc.testBeforeCallbackTx = func(sub string) {
		if sub == "fake-sub-exactt15" {
			close(t2Exchanged)
			<-t4Resolved
			recordStep("t5_save_attempt")
		}
	}
	prevNow := fx.svc.now
	fx.svc.now = func() time.Time {
		tNow := prevNow()
		exchangeTimeMu.Lock()
		nowCallsSinceStart++
		latestNowUTC = tNow.UTC()
		exchangeTimeMu.Unlock()
		return tNow
	}
	// Capture the exact exchangeStartedAt timestamp read at CompleteOAuth :527
	// (the second s.nowUTC() call in CompleteOAuth, after openOAuthState at :462
	// and immediately before s.provider.Exchange at :531).

	t15WorkerDone := make(chan bool, 1)
	go func() {
		ok := fx.svc.ProcessOneRevocation(ctx, "fake-sub-exactt15")
		recordStep("t4_resolve")
		close(t4Resolved)
		t15WorkerDone <- ok
	}()
	<-t1Claimed
	exchangeTimeMu.Lock()
	nowCallsSinceStart = 0
	latestNowUTC = time.Time{}
	t2ExchangeAt = time.Time{}
	t2ExchangeNowCall = 0
	exchangeTimeMu.Unlock()
	gotT15 := fx.svc.CompleteOAuth(ctx, stT15, "exactt15", "", "", nonceT15)
	if !<-t15WorkerDone {
		t.Fatal("t1..t5 worker did not resolve")
	}
	fx.svc.now = prevNow
	fx.svc.testAfterRevocationClaimTx = nil
	fx.svc.testBeforeCallbackTx = nil
	fx.fake.SetExchange(nil)
	fx.fake.SetRevoke(nil)
	if gotT15 != DriveOAuthRetryConnect {
		t.Fatalf("exact t1..t5 CompleteOAuth = %q, want %q", gotT15, DriveOAuthRetryConnect)
	}
	wantSeq := "t1_claim,t2_exchange,t3_revoke,t4_resolve,t5_save_attempt"
	if gotSeq := strings.Join(seq, ","); gotSeq != wantSeq {
		t.Fatalf("t1..t5 sequence = %q, want %q", gotSeq, wantSeq)
	}
	revT15, err := fx.q.GetDriveGrantRevocationForUpdate(ctx, "fake-sub-exactt15")
	if err != nil || !revT15.LastAttemptStartedAt.Valid || !revT15.LastResolvedAt.Valid {
		t.Fatalf("read revT15 evidence timestamps: %+v, err=%v", revT15, err)
	}
	if t2ExchangeNowCall != 2 || t2ExchangeAt.IsZero() {
		t.Fatalf("captured exchangeStartedAt call index = %d (time=%v), want 2nd nowUTC call in CompleteOAuth (:527)", t2ExchangeNowCall, t2ExchangeAt)
	}
	if !revT15.LastAttemptStartedAt.Time.Before(t2ExchangeAt) || !t2ExchangeAt.Before(revT15.LastResolvedAt.Time) {
		t.Fatalf("persisted evidence timestamps out of order: t1_claim=%v t2_exchange=%v t4_resolve=%v",
			revT15.LastAttemptStartedAt.Time, t2ExchangeAt, revT15.LastResolvedAt.Time)
	}
	now = time.Now().UTC().Truncate(time.Microsecond)
	fx.svc.now = func() time.Time { return now }

	// Case 11 (R1-13): Two real concurrent worker goroutines race to claim the same
	// pending row -> exactly one claims and calls Google; the second sees it leased
	// and does nothing.
	now = now.Add(5 * time.Second)
	cTwoWorkers := connectSub(fx.user, fx.work.ID, "twoworkers")
	if err := fx.svc.Disconnect(ctx, Human(fx.user.ID), fx.work.ID, cTwoWorkers); err != nil {
		t.Fatal(err)
	}
	var wClaims atomic.Int32
	firstClaimedCh := make(chan struct{})
	releaseFirstWorker := make(chan struct{})
	fx.svc.testAfterRevocationClaimTx = func(sub string, _ db.DriveGrantRevocation) {
		if sub == "fake-sub-twoworkers" {
			if wClaims.Add(1) == 1 {
				close(firstClaimedCh)
				<-releaseFirstWorker
			}
		}
	}
	w1Done := make(chan bool, 1)
	w2Done := make(chan bool, 1)
	go func() {
		w1Done <- fx.svc.ProcessOneRevocation(ctx, "fake-sub-twoworkers")
	}()
	<-firstClaimedCh
	go func() {
		w2Done <- fx.svc.ProcessOneRevocation(ctx, "fake-sub-twoworkers")
	}()
	// Wait for w2 to finish its claim check (returns false because w1 holds the lease).
	res2 := <-w2Done
	close(releaseFirstWorker)
	res1 := <-w1Done
	fx.svc.testAfterRevocationClaimTx = nil
	if !res1 || res2 || wClaims.Load() != 1 {
		t.Fatalf("two competing workers: res1=%v res2=%v claims=%d, want res1=true res2=false claims=1", res1, res2, wClaims.Load())
	}

	// Case 12 (R1-13): Late worker 1 held with retained old (generation=1, attempt_id=a1) ->
	// lease expires -> worker 2 claims and resolves gen 1 -> user reconnects ->
	// user disconnects again (gen 2) -> worker 3 claims gen 2 (attempt_id=a3) and is held ->
	// worker 1 wakes up and runs its resolve transaction with its retained (gen 1, a1) pair ->
	// worker 1's late result cannot settle gen 2; worker 3 then resolves gen 2!
	now = now.Add(5 * time.Second)
	cThreeW := connectSub(fx.user, fx.work.ID, "threeworkers")
	if err := fx.svc.Disconnect(ctx, Human(fx.user.ID), fx.work.ID, cThreeW); err != nil {
		t.Fatal(err)
	}
	w1HeldBeforeResolve := make(chan db.DriveGrantRevocation, 1)
	releaseW1Resolve := make(chan struct{})
	w3HeldAfterClaim := make(chan db.DriveGrantRevocation, 1)
	releaseW3 := make(chan struct{})

	var w1AttemptID string
	var w1Designated atomic.Bool
	fx.svc.testAfterRevokeGoogle = func(sub string, attempt db.DriveGrantRevocation, revokeErr error) error {
		if sub == "fake-sub-threeworkers" && w1Designated.CompareAndSwap(false, true) {
			w1AttemptID = attempt.AttemptID.String
			w1HeldBeforeResolve <- attempt
			<-releaseW1Resolve
		}
		return revokeErr
	}
	w1LateDone := make(chan bool, 1)
	go func() {
		w1LateDone <- fx.svc.ProcessOneRevocation(ctx, "fake-sub-threeworkers")
	}()
	w1ClaimedRow := <-w1HeldBeforeResolve

	// Advance past 2m lease so worker 2 reclaims and resolves generation 1.
	now = now.Add(driveRevocationLeaseTTL + time.Second)
	if !fx.svc.ProcessOneRevocation(ctx, "fake-sub-threeworkers") {
		t.Fatal("worker 2 must reclaim and resolve generation 1")
	}
	// User reconnects and disconnects again -> advances row to generation 2!
	now = now.Add(2 * time.Second)
	_ = connectSub(fx.user, fx.work.ID, "threeworkers")
	if err := fx.svc.Disconnect(ctx, Human(fx.user.ID), fx.work.ID, cThreeW); err != nil {
		t.Fatal(err)
	}
	// Worker 3 claims generation 2 and is held before resolving.
	fx.svc.testAfterRevocationClaimTx = func(sub string, attempt db.DriveGrantRevocation) {
		if sub == "fake-sub-threeworkers" && attempt.Generation == w1ClaimedRow.Generation+1 {
			w3HeldAfterClaim <- attempt
			<-releaseW3
		}
	}
	w3Done := make(chan bool, 1)
	go func() {
		w3Done <- fx.svc.ProcessOneRevocation(ctx, "fake-sub-threeworkers")
	}()
	w3ClaimedRow := <-w3HeldAfterClaim
	if w3ClaimedRow.Generation != w1ClaimedRow.Generation+1 || w3ClaimedRow.AttemptID.String == w1AttemptID {
		t.Fatalf("worker 3 claimed %+v, want gen %d != attempt %s", w3ClaimedRow, w1ClaimedRow.Generation+1, w1AttemptID)
	}

	// Now release worker 1 so it executes resolveRevocationAttempt with its retained (gen 1, w1AttemptID) pair!
	close(releaseW1Resolve)
	<-w1LateDone

	// Verify generation 2 is STILL open and owned by worker 3's attempt!
	rowAfterLate, err := fx.q.GetDriveGrantRevocationForUpdate(ctx, "fake-sub-threeworkers")
	if err != nil || rowAfterLate.ResolvedAt.Valid || !rowAfterLate.RefreshTokenEnc.Valid ||
		rowAfterLate.Generation != w3ClaimedRow.Generation || rowAfterLate.AttemptID.String != w3ClaimedRow.AttemptID.String {
		t.Fatalf("late worker 1 with retained old (gen, attempt_id) must not settle gen 2: %+v, err=%v", rowAfterLate, err)
	}
	// Release worker 3 -> settles generation 2 cleanly.
	close(releaseW3)
	if !<-w3Done {
		t.Fatal("worker 3 must settle generation 2")
	}
	fx.svc.testAfterRevokeGoogle = nil
	fx.svc.testAfterRevocationClaimTx = nil

	// Case 13 (R1-13): Cross-organization callback/revocation interleaving:
	// User 1 in org 1 disconnects shared sub `xorg-race` (no other holder left) ->
	// User 2 in org 2 starts connecting the same Google sub `xorg-race` ->
	// while User 2's callback exchanges its code, the revocation worker revokes
	// `xorg-race` -> User 2's callback in org 2 is refused with retry_connect!
	// Reset the service clock to wall time aligned with PostgreSQL now() so Case 12's
	// synthetic +2m lease advance does not place Case 13's exchange_started_at in the
	// future relative to PostgreSQL's real claim/resolve timestamps (R3-2).
	fx.svc.now = time.Now
	cXOrg1 := connectSub(fx.user, fx.work.ID, "xorg-race")
	if err := fx.svc.Disconnect(ctx, Human(fx.user.ID), fx.work.ID, cXOrg1); err != nil {
		t.Fatal(err)
	}
	uXOrg2, nonceXOrg2, err := fx.svc.StartOAuth(ctx, Human(user2.ID), ws2View.Workspace.ID, "")
	if err != nil {
		t.Fatal(err)
	}
	stXOrg2, _ := extractStateFromAuthURL(t, uXOrg2)
	fx.svc.testBeforeCallbackTx = func(sub string) {
		if sub == "fake-sub-xorg-race" {
			if !fx.svc.ProcessOneRevocation(ctx, sub) {
				t.Errorf("expected worker to process revocation for %s", sub)
			}
		}
	}
	gotXOrg2 := fx.svc.CompleteOAuth(ctx, stXOrg2, "xorg-race", "", "", nonceXOrg2)
	fx.svc.testBeforeCallbackTx = nil
	if gotXOrg2 != DriveOAuthRetryConnect {
		t.Fatalf("cross-org CompleteOAuth in org2 when org1's revocation overlapped = %q, want %q", gotXOrg2, DriveOAuthRetryConnect)
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
	as.SetDrive(fx.svc)
	fx.ws.SetDrive(fx.svc)
	memberSvc := NewOrganizationMemberService(fx.pool, fx.q, fx.orgs)
	memberSvc.SetDrive(fx.svc)

	connectInWS := func(userID, wsID, code string) string {
		u, nonce, err := fx.svc.StartOAuth(ctx, Human(userID), wsID, "")
		if err != nil {
			t.Fatal(err)
		}
		st, _ := extractStateFromAuthURL(t, u)
		if got := fx.svc.CompleteOAuth(ctx, st, code, "", "", nonce); got != DriveOAuthConnected && got != DriveOAuthReconnected {
			t.Fatalf("CompleteOAuth(%s) = %q", code, got)
		}
		list, err := fx.svc.List(ctx, Human(userID), wsID)
		if err != nil {
			t.Fatal(err)
		}
		for _, c := range list {
			if c.GoogleEmail == "drive-"+code+"@example.com" {
				return c.ID
			}
		}
		t.Fatalf("connection %s not found", code)
		return ""
	}

	seenOutboxIDs := make(map[string]bool)
	snapshotOutboxForConn := func(orgID, connID string) {
		rows, err := fx.pool.Query(ctx, `
			SELECT id FROM outbox_events
			WHERE organization_id = $1 AND topic = 'drive_connection.changed'`, orgID)
		if err != nil {
			t.Fatalf("query outbox_events for %s: %v", connID, err)
		}
		defer rows.Close()
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				t.Fatal(err)
			}
			seenOutboxIDs[id] = true
		}
	}
	origConnectInWS := connectInWS
	connectInWS = func(userID, wsID, code string) string {
		connID := origConnectInWS(userID, wsID, code)
		var orgID string
		if err := fx.pool.QueryRow(ctx, `SELECT organization_id FROM workspaces WHERE id = $1`, wsID).Scan(&orgID); err != nil {
			t.Fatal(err)
		}
		snapshotOutboxForConn(orgID, connID)
		return connID
	}

	assertDisconnectedArtifacts := func(orgID, connID, googleSub, googleEmail, wantReason string, expectResolvedByPostCommit bool) {
		t.Helper()
		// 1. Token fencing: disconnected_at set, refresh_token_enc & access_token_enc cleared,
		// credential_version bumped past initial version 0 (>= 1 on first disconnect, >= 2 after reconnect+disconnect).
		var refreshEnc, accessEnc string
		var credVer int64
		var isDisc bool
		if err := fx.pool.QueryRow(ctx, `
			SELECT refresh_token_enc, access_token_enc, credential_version, (disconnected_at IS NOT NULL)
			FROM drive_connections WHERE id = $1 AND organization_id = $2`, connID, orgID).Scan(&refreshEnc, &accessEnc, &credVer, &isDisc); err != nil {
			t.Fatalf("read drive_connection %s: %v", connID, err)
		}
		if !isDisc || refreshEnc != "" || accessEnc != "" || credVer < 1 {
			t.Fatalf("connection %s not fenced on %s: isDisc=%v refresh=%q access=%q credVer=%d", connID, wantReason, isDisc, refreshEnc, accessEnc, credVer)
		}
		// 2. Audit row: drive_connection.disconnected with google_email, google_sub, reason.
		var rawMeta string
		if err := fx.pool.QueryRow(ctx, `
			SELECT metadata::text FROM audit_events
			WHERE organization_id = $1 AND action = 'drive_connection.disconnected' AND resource_id = $2
			ORDER BY occurred_at DESC LIMIT 1`, orgID, connID).Scan(&rawMeta); err != nil {
			t.Fatalf("missing drive_connection.disconnected audit row for %s (%s): %v", connID, wantReason, err)
		}
		var meta map[string]any
		_ = json.Unmarshal([]byte(rawMeta), &meta)
		if meta["google_sub"] != googleSub || meta["google_email"] != googleEmail || meta["reason"] != wantReason {
			t.Fatalf("audit metadata for %s = %v, want sub=%s email=%s reason=%s", connID, meta, googleSub, googleEmail, wantReason)
		}
		// 3. Outbox row (R2-5): assert a NEW drive_connection.changed event created by the lifecycle command
		// (not the pre-existing connect/reconnect event) with the right organization_id and connection_id.
		rows, err := fx.pool.Query(ctx, `
			SELECT id, payload::text FROM outbox_events
			WHERE organization_id = $1 AND topic = 'drive_connection.changed'`, orgID)
		if err != nil {
			t.Fatalf("query drive_connection.changed outbox rows for %s (%s): %v", connID, wantReason, err)
		}
		var matchedNewOutbox bool
		for rows.Next() {
			var evID, rawPayload string
			if err := rows.Scan(&evID, &rawPayload); err != nil {
				rows.Close()
				t.Fatal(err)
			}
			if seenOutboxIDs[evID] {
				continue
			}
			var p map[string]string
			_ = json.Unmarshal([]byte(rawPayload), &p)
			if p["connection_id"] == connID {
				seenOutboxIDs[evID] = true
				matchedNewOutbox = true
			}
		}
		rows.Close()
		if !matchedNewOutbox {
			t.Fatalf("missing NEW drive_connection.changed outbox row for %s (%s) in org %s", connID, wantReason, orgID)
		}
		// 4. Durable revoke queue row in drive_grant_revocations.
		rev, err := fx.q.GetDriveGrantRevocationForUpdate(ctx, googleSub)
		if err != nil {
			t.Fatalf("missing drive_grant_revocations row for %s (%s): %v", googleSub, wantReason, err)
		}
		if expectResolvedByPostCommit {
			if !rev.ResolvedAt.Valid || rev.RefreshTokenEnc.Valid {
				t.Fatalf("expected %s resolved by post-commit cleanup (%s), got %+v", googleSub, wantReason, rev)
			}
		} else {
			if !rev.RefreshTokenEnc.Valid || rev.ResolvedAt.Valid {
				t.Fatalf("expected %s pending with encrypted token in queue (%s), got %+v", googleSub, wantReason, rev)
			}
		}
	}

	// Scenario 1: Legacy two-org account (seeded by raw SQL exactly as TestIsolationMatrix.joinAsMember
	// does at server/internal/handler/isolation_matrix_test.go:486-492) + Deactivate in one org +
	// non-owner Account Deletion across both legacy memberships!
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

	legacyUser := registerVerified(t, fx.q, as, "drive-legacy-"+util.NewID()+"@example.com", "LegacyTwoOrg")
	for _, target := range []struct {
		orgID string
		wsID  string
	}{
		{fx.org.ID, fx.work.ID},
		{orgB.ID, wsB.ID},
	} {
		if _, err := fx.pool.Exec(ctx, `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'member')`,
			target.orgID, legacyUser.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := fx.pool.Exec(ctx, `INSERT INTO workspace_members (workspace_id, user_id, role, organization_id) VALUES ($1, $2, 'member', $3)`,
			target.wsID, legacyUser.ID, target.orgID); err != nil {
			t.Fatal(err)
		}
	}

	connLegacyA := connectInWS(legacyUser.ID, fx.work.ID, "orga-acct")
	connLegacyB := connectInWS(legacyUser.ID, wsB.ID, "orgb-acct")

	// Legacy two-org account sees only the path organization's connections.
	listA, err := fx.svc.List(ctx, Human(legacyUser.ID), fx.work.ID)
	if err != nil || len(listA) != 1 || listA[0].ID != connLegacyA || listA[0].GoogleEmail != "drive-orga-acct@example.com" {
		t.Fatalf("List(wsA) = %+v, err=%v", listA, err)
	}
	listB, err := fx.svc.List(ctx, Human(legacyUser.ID), wsB.ID)
	if err != nil || len(listB) != 1 || listB[0].ID != connLegacyB || listB[0].GoogleEmail != "drive-orgb-acct@example.com" {
		t.Fatalf("List(wsB) = %+v, err=%v", listB, err)
	}

	// Deactivate legacyUser in orgB -> fences connLegacyB, writes audit + outbox + durable revoke queue; orgA stays active!
	if _, err := memberSvc.Deactivate(ctx, ownerB.ID, orgB.ID, legacyUser.ID); err != nil {
		t.Fatalf("Deactivate: %v", err)
	}
	assertDisconnectedArtifacts(orgB.ID, connLegacyB, "fake-sub-orgb-acct", "drive-orgb-acct@example.com", "member_deactivated", false)
	listAAfterDeact, err := fx.svc.List(ctx, Human(legacyUser.ID), fx.work.ID)
	if err != nil || len(listAAfterDeact) != 1 || listAAfterDeact[0].ID != connLegacyA {
		t.Fatalf("List(wsA) after orgB deactivate = %+v, err=%v", listAAfterDeact, err)
	}

	// Re-add a third org membership (orgD) by raw SQL so legacyUser has two active non-owner
	// memberships (fx.org and orgD) when DeleteAccount runs -> disconnects across all organizations!
	ownerD := registerVerified(t, fx.q, as, "drive-ownerd-"+util.NewID()+"@example.com", "OwnerD")
	orgD, err := fx.orgs.Create(ctx, ownerD.ID, "Org D", "drive-orgd-"+strings.ToLower(util.NewID()[:8]))
	if err != nil {
		t.Fatal(err)
	}
	wsDView, err := fx.ws.CreateInOrg(ctx, ownerD.ID, orgD.ID, "WS D", "ws-d")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := fx.pool.Exec(ctx, `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'member')`,
		orgD.ID, legacyUser.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := fx.pool.Exec(ctx, `INSERT INTO workspace_members (workspace_id, user_id, role, organization_id) VALUES ($1, $2, 'member', $3)`,
		wsDView.Workspace.ID, legacyUser.ID, orgD.ID); err != nil {
		t.Fatal(err)
	}
	connLegacyD := connectInWS(legacyUser.ID, wsDView.Workspace.ID, "orgd-acct")

	if err := as.DeleteAccount(ctx, legacyUser.ID, DeleteAccountInput{Password: "password123"}); err != nil {
		t.Fatalf("DeleteAccount across legacy memberships: %v", err)
	}
	assertDisconnectedArtifacts(fx.org.ID, connLegacyA, "fake-sub-orga-acct", "drive-orga-acct@example.com", "account_deleted", true)
	assertDisconnectedArtifacts(orgD.ID, connLegacyD, "fake-sub-orgd-acct", "drive-orgd-acct@example.com", "account_deleted", true)

	// Scenario 2: Single-org member Leave + Deactivate -> Reactivate -> does not auto-reconnect -> reconnect -> Leave.
	leaver := registerVerified(t, fx.q, as, "drive-leaver-"+util.NewID()+"@example.com", "Leaver")
	if _, err := fx.pool.Exec(ctx, `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'member')`,
		orgB.ID, leaver.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := fx.pool.Exec(ctx, `INSERT INTO workspace_members (workspace_id, user_id, role, organization_id) VALUES ($1, $2, 'member', $3)`,
		wsB.ID, leaver.ID, orgB.ID); err != nil {
		t.Fatal(err)
	}
	connLeave1 := connectInWS(leaver.ID, wsB.ID, "leave-acct")
	if _, err := memberSvc.Deactivate(ctx, ownerB.ID, orgB.ID, leaver.ID); err != nil {
		t.Fatalf("Deactivate leaver: %v", err)
	}
	assertDisconnectedArtifacts(orgB.ID, connLeave1, "fake-sub-leave-acct", "drive-leave-acct@example.com", "member_deactivated", false)
	_ = fx.svc.ProcessOneRevocation(ctx, "fake-sub-leave-acct")
	// Reactivate in orgB (leaver belongs to no other active org under ADR 0032): does NOT auto-reconnect!
	if _, err := memberSvc.Reactivate(ctx, ownerB.ID, orgB.ID, leaver.ID); err != nil {
		t.Fatalf("Reactivate leaver: %v", err)
	}
	listAfterReact, err := fx.svc.List(ctx, Human(leaver.ID), wsB.ID)
	if err != nil || len(listAfterReact) != 0 {
		t.Fatalf("Reactivate must not auto-reconnect Drive: got %+v, err=%v", listAfterReact, err)
	}
	connLeave2 := connectInWS(leaver.ID, wsB.ID, "leave-acct")
	if connLeave2 != connLeave1 {
		t.Fatalf("reconnect after reactivation = %s, want revived ID %s", connLeave2, connLeave1)
	}
	if err := memberSvc.Leave(ctx, leaver.ID, orgB.ID); err != nil {
		t.Fatalf("Leave(orgB): %v", err)
	}
	assertDisconnectedArtifacts(orgB.ID, connLeave2, "fake-sub-leave-acct", "drive-leave-acct@example.com", "member_left", false)

	// Scenario 3: Sole-owner direct Close and invitation-switch Close (closeQ).
	soleOwner1 := registerVerified(t, fx.q, as, "drive-sole1-"+util.NewID()+"@example.com", "SoleOwner1")
	orgSole1, err := fx.orgs.Create(ctx, soleOwner1.ID, "Sole 1", "drive-sole1-"+strings.ToLower(util.NewID()[:8]))
	if err != nil {
		t.Fatal(err)
	}
	wsSole1View, err := fx.ws.CreateInOrg(ctx, soleOwner1.ID, orgSole1.ID, "WS Sole 1", "ws-sole-1")
	if err != nil {
		t.Fatal(err)
	}
	connSole1 := connectInWS(soleOwner1.ID, wsSole1View.Workspace.ID, "sole1-acct")
	if err := memberSvc.Close(ctx, soleOwner1.ID, orgSole1.ID, orgSole1.Slug); err != nil {
		t.Fatalf("direct Close: %v", err)
	}
	assertDisconnectedArtifacts(orgSole1.ID, connSole1, "fake-sub-sole1-acct", "drive-sole1-acct@example.com", "organization_closed", true)

	// Sole-owner invitation switch (SwitchActionClose via closeQ).
	orgSole2, err := fx.orgs.Create(ctx, soleOwner1.ID, "Sole 2", "drive-sole2-"+strings.ToLower(util.NewID()[:8]))
	if err != nil {
		t.Fatal(err)
	}
	wsSole2View, err := fx.ws.CreateInOrg(ctx, soleOwner1.ID, orgSole2.ID, "WS Sole 2", "ws-sole-2")
	if err != nil {
		t.Fatal(err)
	}
	connSole2 := connectInWS(soleOwner1.ID, wsSole2View.Workspace.ID, "sole2-acct")
	memberSvc.SetMail(mail.Renderer{AppURL: "http://localhost:3000"}, &fakeOutbox{})
	inv, _, err := memberSvc.InviteToOrg(ctx, ownerB.ID, orgB.ID, []string{soleOwner1.Email}, OrgRoleMember, nil)
	if err != nil || len(inv) != 1 {
		t.Fatalf("InviteToOrg: %v", err)
	}
	if _, err := fx.ws.AcceptInvite(ctx, soleOwner1.ID, inv[0].Token, []SwitchResolution{{OrganizationID: orgSole2.ID, Action: SwitchActionClose, ConfirmSlug: orgSole2.Slug}}); err != nil {
		t.Fatalf("AcceptInvite with SwitchActionClose: %v", err)
	}
	assertDisconnectedArtifacts(orgSole2.ID, connSole2, "fake-sub-sole2-acct", "drive-sole2-acct@example.com", "organization_closed", true)

	// Scenario 4: Sole-owner DeleteAccount with CloseOrganization.
	connOwnerA := connectInWS(fx.user.ID, fx.work.ID, "ownera-acct")
	if err := as.DeleteAccount(ctx, fx.user.ID, DeleteAccountInput{
		Password:          "password123",
		CloseOrganization: fx.org.Slug,
	}); err != nil {
		t.Fatalf("DeleteAccount sole owner with CloseOrganization: %v", err)
	}
	assertDisconnectedArtifacts(fx.org.ID, connOwnerA, "fake-sub-ownera-acct", "drive-ownera-acct@example.com", "organization_closed", true)
}

// TestDriveOAuthCallbackRefusedAfterLifecycle (R1-1) holds the callback right
// before saveDriveConnection, commits each lifecycle command (Leave, Deactivate,
// Close, DeleteAccount), and releases the callback. It asserts that the
// transaction-bound membership re-check refuses the save, creates/revives no
// live credential, and retains the pending revocation request.
func TestDriveOAuthCallbackRefusedAfterLifecycle(t *testing.T) {
	fx := newDriveTestFixture(t)
	ctx := context.Background()
	as := NewAuthService(fx.pool, fx.q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	memberSvc := NewOrganizationMemberService(fx.pool, fx.q, fx.orgs)
	t.Cleanup(func() { fx.svc.testBeforeCallbackTx = nil })

	runCase := func(name string, subCode string, seedExisting bool, setup func() (user db.User, org db.Organization, ws db.Workspace), triggerLifecycle func(user db.User, org db.Organization)) {
		t.Run(name, func(t *testing.T) {
			user, org, ws := setup()
			if seedExisting {
				u0, n0, err := fx.svc.StartOAuth(ctx, Human(user.ID), ws.ID, "")
				if err != nil {
					t.Fatalf("seed StartOAuth: %v", err)
				}
				st0, _ := extractStateFromAuthURL(t, u0)
				if got := fx.svc.CompleteOAuth(ctx, st0, subCode, "", "", n0); got != DriveOAuthConnected {
					t.Fatalf("seed CompleteOAuth = %q", got)
				}
			}

			authURL, nonce, err := fx.svc.StartOAuth(ctx, Human(user.ID), ws.ID, "")
			if err != nil {
				t.Fatalf("StartOAuth: %v", err)
			}
			st, _ := extractStateFromAuthURL(t, authURL)

			fx.svc.testBeforeCallbackTx = func(sub string) {
				if sub == "fake-sub-"+subCode {
					triggerLifecycle(user, org)
				}
			}
			got := fx.svc.CompleteOAuth(ctx, st, subCode, "", "", nonce)
			fx.svc.testBeforeCallbackTx = nil
			if got == DriveOAuthConnected || got == DriveOAuthReconnected {
				t.Fatalf("expected callback to be refused after lifecycle %s, got %q", name, got)
			}

			activeCount, err := fx.q.CountActiveDriveConnectionsBySub(ctx, "fake-sub-"+subCode)
			if err != nil || activeCount != 0 {
				t.Fatalf("active connections for %s = %d, err=%v, want 0", subCode, activeCount, err)
			}
			if seedExisting {
				rev, err := fx.q.GetDriveGrantRevocationForUpdate(ctx, "fake-sub-"+subCode)
				if err != nil || !rev.RefreshTokenEnc.Valid || rev.ResolvedAt.Valid {
					t.Fatalf("expected pending revocation retained after refused callback for %s, got %+v, err=%v", subCode, rev, err)
				}
			}
		})
	}

	setupMember := func(tag string) (db.User, db.Organization, db.Workspace) {
		owner := registerVerified(t, fx.q, as, "r1-owner-"+tag+"-"+util.NewID()+"@example.com", "Owner")
		org, err := fx.orgs.Create(ctx, owner.ID, "Org "+tag, "r1-org-"+tag+"-"+strings.ToLower(util.NewID()[:8]))
		if err != nil {
			t.Fatal(err)
		}
		wsView, err := fx.ws.CreateInOrg(ctx, owner.ID, org.ID, "WS "+tag, "ws-"+tag)
		if err != nil {
			t.Fatal(err)
		}
		mem := registerVerified(t, fx.q, as, "r1-mem-"+tag+"-"+util.NewID()+"@example.com", "Member")
		if err := fx.q.AddOrganizationMember(ctx, db.AddOrganizationMemberParams{
			OrganizationID: org.ID, UserID: mem.ID, Role: OrgRoleMember,
		}); err != nil {
			t.Fatal(err)
		}
		if err := fx.q.AddWorkspaceMember(ctx, db.AddWorkspaceMemberParams{
			WorkspaceID: wsView.Workspace.ID, OrganizationID: org.ID, UserID: mem.ID, Role: OrgRoleMember,
		}); err != nil {
			t.Fatal(err)
		}
		return mem, org, wsView.Workspace
	}

	runCase("leave_existing", "r1-leave", true, func() (db.User, db.Organization, db.Workspace) {
		return setupMember("leave")
	}, func(user db.User, org db.Organization) {
		if err := memberSvc.Leave(ctx, user.ID, org.ID); err != nil {
			t.Fatalf("Leave: %v", err)
		}
	})

	runCase("deactivate_existing", "r1-deact", true, func() (db.User, db.Organization, db.Workspace) {
		return setupMember("deact")
	}, func(user db.User, org db.Organization) {
		// Find owner of org to perform Deactivate.
		var ownerID string
		if err := fx.pool.QueryRow(ctx, `SELECT user_id FROM organization_members WHERE organization_id = $1 AND role = 'owner'`, org.ID).Scan(&ownerID); err != nil {
			t.Fatal(err)
		}
		if _, err := memberSvc.Deactivate(ctx, ownerID, org.ID, user.ID); err != nil {
			t.Fatalf("Deactivate: %v", err)
		}
	})

	runCase("deactivate_fresh_connect", "r1-deact-fresh", false, func() (db.User, db.Organization, db.Workspace) {
		return setupMember("deactfresh")
	}, func(user db.User, org db.Organization) {
		var ownerID string
		if err := fx.pool.QueryRow(ctx, `SELECT user_id FROM organization_members WHERE organization_id = $1 AND role = 'owner'`, org.ID).Scan(&ownerID); err != nil {
			t.Fatal(err)
		}
		if _, err := memberSvc.Deactivate(ctx, ownerID, org.ID, user.ID); err != nil {
			t.Fatalf("Deactivate: %v", err)
		}
	})

	runCase("close_sole_owner", "r1-close", true, func() (db.User, db.Organization, db.Workspace) {
		owner := registerVerified(t, fx.q, as, "r1-close-"+util.NewID()+"@example.com", "SoleOwner")
		org, err := fx.orgs.Create(ctx, owner.ID, "Close Org", "r1-close-"+strings.ToLower(util.NewID()[:8]))
		if err != nil {
			t.Fatal(err)
		}
		wsView, err := fx.ws.CreateInOrg(ctx, owner.ID, org.ID, "WS Close", "ws-close")
		if err != nil {
			t.Fatal(err)
		}
		return owner, org, wsView.Workspace
	}, func(user db.User, org db.Organization) {
		if err := memberSvc.Close(ctx, user.ID, org.ID, org.Slug); err != nil {
			t.Fatalf("Close: %v", err)
		}
	})

	runCase("delete_account", "r1-del", true, func() (db.User, db.Organization, db.Workspace) {
		return setupMember("del")
	}, func(user db.User, _ db.Organization) {
		if err := as.DeleteAccount(ctx, user.ID, DeleteAccountInput{Password: "password123"}); err != nil {
			t.Fatalf("DeleteAccount: %v", err)
		}
	})
}

// TestDriveGrantAndRowLockOrderNoDeadlock (R1-2) holds concurrent lifecycle
// disconnect and callback / manual disconnect at the boundary between
// acquiring the global drive_grant:<sub> advisory lock and locking the
// drive_connections rows, proving both settle without a 40P01 deadlock or
// partial state.
func TestDriveGrantAndRowLockOrderNoDeadlock(t *testing.T) {
	fx := newDriveTestFixture(t)
	ctx := context.Background()
	as := NewAuthService(fx.pool, fx.q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	memberSvc := NewOrganizationMemberService(fx.pool, fx.q, fx.orgs)
	resetPart1Hooks := func() {
		fx.svc.testBeforeDisconnectRow = nil
		testAfterHelperFirstDriveSub = nil
	}
	resetPart2Hooks := func() {
		testAfterCloseOrgRowLock = nil
	}
	resetPart3Hooks := func() {
		testAfterLifecycleGrantLocks = nil
	}
	joinWorker := func(done <-chan struct{}, label string) {
		t.Helper()
		select {
		case <-done:
		case <-time.After(15 * time.Second):
			t.Fatalf("timed out joining worker %s after context cancel and barrier release; leaving hooks untouched to avoid data race", label)
		}
	}

	waitCh := func(ch <-chan struct{}, label string, cleanups ...func()) {
		t.Helper()
		select {
		case <-ch:
		case <-time.After(5 * time.Second):
			for _, fn := range cleanups {
				if fn != nil {
					fn()
				}
			}
			t.Fatalf("timed out waiting for %s", label)
		}
	}
	waitErrCh := func(ch <-chan error, label string, cleanups ...func()) error {
		t.Helper()
		select {
		case err := <-ch:
			return err
		case <-time.After(5 * time.Second):
			for _, fn := range cleanups {
				if fn != nil {
					fn()
				}
			}
			t.Fatalf("timed out waiting for %s", label)
			return nil
		}
	}
	waitForBackendOnAdvisoryLock := func(holderSub, waiterSub string, cleanups ...func()) {
		t.Helper()
		deadline := time.Now().Add(3 * time.Second)
		var lastErr error
		for time.Now().Before(deadline) {
			var matched int
			lastErr = fx.pool.QueryRow(ctx, `
				SELECT count(*)
				FROM pg_locks w
				JOIN pg_locks h
				  ON h.locktype = 'advisory'
				 AND h.classid = w.classid
				 AND h.objid = w.objid
				 AND h.objsubid = w.objsubid
				 AND h.granted
				WHERE w.locktype = 'advisory'
				  AND NOT w.granted
				  AND w.objid = hashtext('drive_grant:' || $1)::oid
				  AND EXISTS (
				    SELECT 1 FROM pg_locks w_held
				    WHERE w_held.pid = w.pid
				      AND w_held.locktype = 'advisory'
				      AND w_held.granted
				      AND w_held.objid = hashtext('drive_grant:' || $2)::oid
				  )`, holderSub, waiterSub).Scan(&matched)
			if lastErr == nil && matched > 0 {
				return
			}
			time.Sleep(5 * time.Millisecond)
		}
		for _, fn := range cleanups {
			if fn != nil {
				fn()
			}
		}
		t.Fatalf("did not observe waiter holding drive_grant:%s blocked on drive_grant:%s within deadline (lastErr=%v)",
			waiterSub, holderSub, lastErr)
	}

	mem := registerVerified(t, fx.q, as, "r1-2-mem-"+util.NewID()+"@example.com", "Member")
	if err := fx.q.AddOrganizationMember(ctx, db.AddOrganizationMemberParams{
		OrganizationID: fx.org.ID, UserID: mem.ID, Role: OrgRoleMember,
	}); err != nil {
		t.Fatal(err)
	}
	if err := fx.q.AddWorkspaceMember(ctx, db.AddWorkspaceMemberParams{
		WorkspaceID: fx.work.ID, OrganizationID: fx.org.ID, UserID: mem.ID, Role: OrgRoleMember,
	}); err != nil {
		t.Fatal(err)
	}

	// Connect two subs for mem so lifecycle locks them in sorted order.
	var connIDB string
	for _, code := range []string{"lock-b", "lock-a"} {
		u, n, err := fx.svc.StartOAuth(ctx, Human(mem.ID), fx.work.ID, "")
		if err != nil {
			t.Fatal(err)
		}
		st, _ := extractStateFromAuthURL(t, u)
		if got := fx.svc.CompleteOAuth(ctx, st, code, "", "", n); got != DriveOAuthConnected {
			t.Fatalf("CompleteOAuth(%s) = %q", code, got)
		}
	}
	list, err := fx.svc.List(ctx, Human(mem.ID), fx.work.ID)
	if err != nil || len(list) != 2 {
		t.Fatalf("List = %+v, err=%v", list, err)
	}
	for _, c := range list {
		if c.GoogleEmail == "drive-lock-b@example.com" {
			connIDB = c.ID
		}
	}

	// Hold manual Disconnect right after it acquires drive_grant:fake-sub-lock-b
	// (before locking the drive_connections row), then launch Leave (which
	// discovers subs without row locks, takes drive_grant:fake-sub-lock-a and
	// waits on drive_grant:fake-sub-lock-b). Release manual Disconnect; both
	// complete cleanly without 40P01 deadlock.
	discHeld := make(chan struct{})
	releaseDisc := make(chan struct{})
	fx.svc.testBeforeDisconnectRow = func(sub string) {
		if sub == "fake-sub-lock-b" {
			close(discHeld)
			<-releaseDisc
		}
	}

	part1Ctx, cancelPart1 := context.WithCancel(ctx)
	discErrCh := make(chan error, 1)
	leaveErrCh := make(chan error, 1)
	discDone := make(chan struct{})
	leaveDone := make(chan struct{})
	var releaseDiscOnce sync.Once
	safeReleaseDisc := func() { releaseDiscOnce.Do(func() { close(releaseDisc) }) }
	var startedDisc, startedLeave bool
	var joinedPart1 bool
	t.Cleanup(func() {
		cancelPart1()
		safeReleaseDisc()
		if !joinedPart1 {
			if startedDisc {
				joinWorker(discDone, "Part 1 Disconnect")
			}
			if startedLeave {
				joinWorker(leaveDone, "Part 1 Leave")
			}
			joinedPart1 = true
		}
		resetPart1Hooks()
	})
	startedDisc = true
	go func() {
		defer close(discDone)
		discErrCh <- fx.svc.Disconnect(part1Ctx, Human(mem.ID), fx.work.ID, connIDB)
	}()
	waitCh(discHeld, "Disconnect to hold drive_grant:fake-sub-lock-b", safeReleaseDisc)

	// Use testAfterHelperFirstDriveSub to prove Leave has entered SQL and acquired
	// drive_grant:fake-sub-lock-a right before it contends on drive_grant:fake-sub-lock-b,
	// then verify via pg_locks that the exact backend holding drive_grant:fake-sub-lock-a
	// is actively waiting on drive_grant:fake-sub-lock-b held by Disconnect before
	// releasing Disconnect (R2-4, R3-5).
	leaveAcquiredSubA := make(chan struct{})
	var leaveSubAOnce atomic.Bool
	testAfterHelperFirstDriveSub = func(userID, _ string, sub string) {
		if userID == mem.ID && sub == "fake-sub-lock-a" && leaveSubAOnce.CompareAndSwap(false, true) {
			close(leaveAcquiredSubA)
		}
	}
	startedLeave = true
	go func() {
		defer close(leaveDone)
		leaveErrCh <- memberSvc.Leave(part1Ctx, mem.ID, fx.org.ID)
	}()
	waitCh(leaveAcquiredSubA, "Leave to acquire drive_grant:fake-sub-lock-a", safeReleaseDisc)
	waitForBackendOnAdvisoryLock("fake-sub-lock-b", "fake-sub-lock-a", safeReleaseDisc)
	// Release manual Disconnect, receive both results and join both workers before clearing hooks (R4-1).
	safeReleaseDisc()
	discErr := waitErrCh(discErrCh, "Disconnect completion")
	leaveErr := waitErrCh(leaveErrCh, "Leave completion")
	joinWorker(discDone, "Part 1 Disconnect")
	joinWorker(leaveDone, "Part 1 Leave")
	joinedPart1 = true
	cancelPart1()
	resetPart1Hooks()
	if discErr != nil && !errors.Is(discErr, ErrNotFound) {
		t.Fatalf("Disconnect error: %v", discErr)
	}
	if leaveErr != nil {
		t.Fatalf("Leave error (must not deadlock): %v", leaveErr)
	}

	for _, sub := range []string{"fake-sub-lock-a", "fake-sub-lock-b"} {
		cnt, err := fx.q.CountActiveDriveConnectionsBySub(ctx, sub)
		if err != nil || cnt != 0 {
			t.Fatalf("active count for %s = %d, err=%v, want 0", sub, cnt, err)
		}
		rev, err := fx.q.GetDriveGrantRevocationForUpdate(ctx, sub)
		if err != nil || !rev.RefreshTokenEnc.Valid {
			t.Fatalf("revocation row for %s = %+v, err=%v", sub, rev, err)
		}
	}

	// Part 2 (R1-2 residual, R2-4): Two legacy users executing DeleteAccount concurrently
	// with inverted sub assignments across their sole-owned organization and legacy member
	// organization:
	//   - User A owns Org A1 (sub "sub-z") and is a legacy member of Org A2 (sub "sub-a")
	//   - User B owns Org B1 (sub "sub-a") and is a legacy member of Org B2 (sub "sub-z")
	// Both transactions lock all Drive grant subs across all organizations in sorted order
	// ("fake-sub-cycle-a" then "fake-sub-cycle-z") before any helper locks Drive rows,
	// preventing the cross-helper 40P01 deadlock!
	setupCloseAndLegacyMember := func(tag, ownedCode, memberCode string) (db.User, db.Organization) {
		u := registerVerified(t, fx.q, as, "r1-2-cyc-"+tag+"-"+util.NewID()+"@example.com", "Cycle "+tag)
		ownedOrg, err := fx.orgs.Create(ctx, u.ID, "Owned "+tag, "cyc-own-"+tag+"-"+strings.ToLower(util.NewID()[:8]))
		if err != nil {
			t.Fatal(err)
		}
		ownedWS, err := fx.ws.CreateInOrg(ctx, u.ID, ownedOrg.ID, "WS Own "+tag, "ws-own-"+tag)
		if err != nil {
			t.Fatal(err)
		}
		otherOwner := registerVerified(t, fx.q, as, "r1-2-other-"+tag+"-"+util.NewID()+"@example.com", "Other "+tag)
		memberOrg, err := fx.orgs.Create(ctx, otherOwner.ID, "MemOrg "+tag, "cyc-mem-"+tag+"-"+strings.ToLower(util.NewID()[:8]))
		if err != nil {
			t.Fatal(err)
		}
		memberWS, err := fx.ws.CreateInOrg(ctx, otherOwner.ID, memberOrg.ID, "WS Mem "+tag, "ws-mem-"+tag)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := fx.pool.Exec(ctx, `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1, $2, 'member')`,
			memberOrg.ID, u.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := fx.pool.Exec(ctx, `INSERT INTO workspace_members (workspace_id, user_id, role, organization_id) VALUES ($1, $2, 'member', $3)`,
			memberWS.Workspace.ID, u.ID, memberOrg.ID); err != nil {
			t.Fatal(err)
		}
		for _, pair := range []struct {
			wsID string
			code string
		}{
			{ownedWS.Workspace.ID, ownedCode},
			{memberWS.Workspace.ID, memberCode},
		} {
			u0, n0, err := fx.svc.StartOAuth(ctx, Human(u.ID), pair.wsID, "")
			if err != nil {
				t.Fatal(err)
			}
			st0, _ := extractStateFromAuthURL(t, u0)
			if got := fx.svc.CompleteOAuth(ctx, st0, pair.code, "", "", n0); got != DriveOAuthConnected {
				t.Fatalf("CompleteOAuth(%s) = %q", pair.code, got)
			}
		}
		return u, ownedOrg
	}

	userCycleA, orgCycleA1 := setupCloseAndLegacyMember("ua", "cycle-z", "cycle-a")
	userCycleB, orgCycleB1 := setupCloseAndLegacyMember("ub", "cycle-a", "cycle-z")

	// Force the exact cross-helper boundary using testAfterCloseOrgRowLock (which fires
	// inside closeOrganizationQ whether or not lockAllDriveGrantSubsForUserInTx exists):
	// - With the fix: both users pre-acquire ("fake-sub-cycle-a", "fake-sub-cycle-z") in
	//   sorted order before closeSoleOrganization; User A holds both grants and pauses at
	//   testAfterCloseOrgRowLock while User B blocks on drive_grant:fake-sub-cycle-a.
	// - Without the fix: User A pauses at testAfterCloseOrgRowLock before taking any grant,
	//   User B also reaches testAfterCloseOrgRowLock, then User A locks owned sub "cycle-z"
	//   while User B locks owned sub "cycle-a", and their second helpers deadlock (40P01)!
	aAtCloseOrg := make(chan struct{})
	releaseACloseOrg := make(chan struct{})
	var releaseAOnce sync.Once
	safeReleaseA := func() { releaseAOnce.Do(func() { close(releaseACloseOrg) }) }
	var aCloseOnce atomic.Bool
	testAfterCloseOrgRowLock = func(userID, orgID string) {
		if userID == userCycleA.ID && orgID == orgCycleA1.ID && aCloseOnce.CompareAndSwap(false, true) {
			close(aAtCloseOrg)
			<-releaseACloseOrg
		}
	}

	part2Ctx, cancelPart2 := context.WithCancel(ctx)
	errCycleA := make(chan error, 1)
	errCycleB := make(chan error, 1)
	cycleADone := make(chan struct{})
	cycleBDone := make(chan struct{})
	var startedCycleA, startedCycleB bool
	var joinedPart2 bool
	t.Cleanup(func() {
		cancelPart2()
		safeReleaseA()
		if !joinedPart2 {
			if startedCycleA {
				joinWorker(cycleADone, "Part 2 userCycleA DeleteAccount")
			}
			if startedCycleB {
				joinWorker(cycleBDone, "Part 2 userCycleB DeleteAccount")
			}
			joinedPart2 = true
		}
		resetPart2Hooks()
	})
	startedCycleA = true
	go func() {
		defer close(cycleADone)
		errCycleA <- as.DeleteAccount(part2Ctx, userCycleA.ID, DeleteAccountInput{
			Password:          "password123",
			CloseOrganization: orgCycleA1.Slug,
		})
	}()
	waitCh(aAtCloseOrg, "userCycleA to reach closeOrganizationQ", safeReleaseA)
	startedCycleB = true
	go func() {
		defer close(cycleBDone)
		errCycleB <- as.DeleteAccount(part2Ctx, userCycleB.ID, DeleteAccountInput{
			Password:          "password123",
			CloseOrganization: orgCycleB1.Slug,
		})
	}()
	// Verify User B's backend is actively waiting on drive_grant:fake-sub-cycle-a held by User A's backend.
	cycleDeadline := time.Now().Add(3 * time.Second)
	var cycleWaitErr error
	var observedCycleWait bool
	for time.Now().Before(cycleDeadline) {
		var matched int
		cycleWaitErr = fx.pool.QueryRow(ctx, `
			SELECT count(*)
			FROM pg_locks w
			JOIN pg_locks h
			  ON h.locktype = 'advisory'
			 AND h.classid = w.classid
			 AND h.objid = w.objid
			 AND h.objsubid = w.objsubid
			 AND h.granted
			WHERE w.locktype = 'advisory'
			  AND NOT w.granted
			  AND w.objid = hashtext('drive_grant:fake-sub-cycle-a')::oid
			  AND EXISTS (
			    SELECT 1 FROM pg_locks h_z
			    WHERE h_z.pid = h.pid
			      AND h_z.locktype = 'advisory'
			      AND h_z.granted
			      AND h_z.objid = hashtext('drive_grant:fake-sub-cycle-z')::oid
			  )`).Scan(&matched)
		if cycleWaitErr == nil && matched > 0 {
			observedCycleWait = true
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	// Release User A, receive BOTH DeleteAccount results and join both workers before clearing the hook (R4-1).
	safeReleaseA()
	errA := waitErrCh(errCycleA, "userCycleA DeleteAccount")
	errB := waitErrCh(errCycleB, "userCycleB DeleteAccount")
	joinWorker(cycleADone, "Part 2 userCycleA DeleteAccount")
	joinWorker(cycleBDone, "Part 2 userCycleB DeleteAccount")
	joinedPart2 = true
	cancelPart2()
	resetPart2Hooks()
	if !observedCycleWait {
		t.Fatalf("did not observe userCycleB waiting on drive_grant:fake-sub-cycle-a held by userCycleA (lastErr=%v)", cycleWaitErr)
	}
	if errA != nil {
		t.Fatalf("DeleteAccount userCycleA error: %v", errA)
	}
	if errB != nil {
		t.Fatalf("DeleteAccount userCycleB error: %v", errB)
	}

	// Part 3 (R3-1): Shared Google sub between User A (sole owner of Org X executing
	// DeleteAccount with CloseOrganization=X) and User B (member of Org Y accepting an
	// invitation into Org X and giving up Org Y).
	// Global order: both paths lock organization rows BEFORE drive_grant:<sub> advisory
	// locks. Hold User B after it acquires Org X (FOR SHARE) and drive_grant:fake-sub-r31-shared,
	// start User A's DeleteAccount, verify User A's backend is waiting on Org X's relation
	// tuple lock (NOT holding drive_grant:fake-sub-r31-shared), release User B so it
	// commits joining Org X, and verify User A gets a clean business refusal (never 40P01).
	ownerX := registerVerified(t, fx.q, as, "r3-1-ox-"+util.NewID()+"@example.com", "OwnerX")
	orgX, err := fx.orgs.Create(ctx, ownerX.ID, "Org X", "r3-1-orgx-"+strings.ToLower(util.NewID()[:8]))
	if err != nil {
		t.Fatal(err)
	}
	wsX, err := fx.ws.CreateInOrg(ctx, ownerX.ID, orgX.ID, "WS X", "ws-x")
	if err != nil {
		t.Fatal(err)
	}
	ownerY := registerVerified(t, fx.q, as, "r3-1-oy-"+util.NewID()+"@example.com", "OwnerY")
	orgY, err := fx.orgs.Create(ctx, ownerY.ID, "Org Y", "r3-1-orgy-"+strings.ToLower(util.NewID()[:8]))
	if err != nil {
		t.Fatal(err)
	}
	wsY, err := fx.ws.CreateInOrg(ctx, ownerY.ID, orgY.ID, "WS Y", "ws-y")
	if err != nil {
		t.Fatal(err)
	}
	joinerB := registerVerified(t, fx.q, as, "r3-1-jb-"+util.NewID()+"@example.com", "JoinerB")
	if err := fx.q.AddOrganizationMember(ctx, db.AddOrganizationMemberParams{
		OrganizationID: orgY.ID, UserID: joinerB.ID, Role: OrgRoleMember,
	}); err != nil {
		t.Fatal(err)
	}
	if err := fx.q.AddWorkspaceMember(ctx, db.AddWorkspaceMemberParams{
		WorkspaceID: wsY.Workspace.ID, OrganizationID: orgY.ID, UserID: joinerB.ID, Role: OrgRoleMember,
	}); err != nil {
		t.Fatal(err)
	}
	// Both ownerX (in orgX) and joinerB (in orgY) connect the SAME Google sub "r31-shared".
	for _, pair := range []struct {
		uid  string
		wsID string
	}{
		{ownerX.ID, wsX.Workspace.ID},
		{joinerB.ID, wsY.Workspace.ID},
	} {
		u0, n0, err := fx.svc.StartOAuth(ctx, Human(pair.uid), pair.wsID, "")
		if err != nil {
			t.Fatal(err)
		}
		st0, _ := extractStateFromAuthURL(t, u0)
		if got := fx.svc.CompleteOAuth(ctx, st0, "r31-shared", "", "", n0); got != DriveOAuthConnected {
			t.Fatalf("CompleteOAuth(r31-shared) = %q", got)
		}
	}
	memberSvc.SetMail(mail.Renderer{AppURL: "http://localhost:3000"}, &fakeOutbox{})
	invX, _, err := memberSvc.InviteToOrg(ctx, ownerX.ID, orgX.ID, []string{joinerB.Email}, OrgRoleMember, nil)
	if err != nil || len(invX) != 1 {
		t.Fatalf("InviteToOrg orgX: %v", err)
	}

	bHeldGrant := make(chan struct{})
	releaseBGrant := make(chan struct{})
	var releaseBOnce sync.Once
	safeReleaseB := func() { releaseBOnce.Do(func() { close(releaseBGrant) }) }
	var bGrantOnce atomic.Bool
	testAfterLifecycleGrantLocks = func(subs []string) {
		if len(subs) == 1 && subs[0] == "fake-sub-r31-shared" && bGrantOnce.CompareAndSwap(false, true) {
			close(bHeldGrant)
			<-releaseBGrant
		}
	}
	part3Ctx, cancelPart3 := context.WithCancel(ctx)
	acceptErrCh := make(chan error, 1)
	delXErrCh := make(chan error, 1)
	acceptDone := make(chan struct{})
	delXDone := make(chan struct{})
	var startedAcceptB, startedDelX bool
	var joinedPart3 bool
	t.Cleanup(func() {
		cancelPart3()
		safeReleaseB()
		if !joinedPart3 {
			if startedAcceptB {
				joinWorker(acceptDone, "Part 3 joinerB AcceptInvite")
			}
			if startedDelX {
				joinWorker(delXDone, "Part 3 ownerX DeleteAccount")
			}
			joinedPart3 = true
		}
		resetPart3Hooks()
	})
	startedAcceptB = true
	go func() {
		defer close(acceptDone)
		_, err := fx.ws.AcceptInvite(part3Ctx, joinerB.ID, invX[0].Token, []SwitchResolution{
			{OrganizationID: orgY.ID, Action: SwitchActionLeave},
		})
		acceptErrCh <- err
	}()
	waitCh(bHeldGrant, "joinerB AcceptInvite to hold Org X FOR SHARE and drive_grant:fake-sub-r31-shared", safeReleaseB)

	startedDelX = true
	go func() {
		defer close(delXDone)
		delXErrCh <- as.DeleteAccount(part3Ctx, ownerX.ID, DeleteAccountInput{
			Password:          "password123",
			CloseOrganization: orgX.Slug,
		})
	}()
	// Wait until ownerX's DeleteAccount backend is actively blocked on the lock conflict
	// (waiting on Org X's row lock BEFORE touching drive_grant:fake-sub-r31-shared).
	r31Deadline := time.Now().Add(3 * time.Second)
	var r31WaitErr error
	var observedR31Wait bool
	for time.Now().Before(r31Deadline) {
		var waiting int
		r31WaitErr = fx.pool.QueryRow(ctx, `
			SELECT count(*)
			FROM pg_stat_activity a
			WHERE a.datname = current_database()
			  AND a.wait_event_type = 'Lock'
			  AND a.query LIKE '%FROM organizations WHERE id = $1 FOR UPDATE%'`).Scan(&waiting)
		if r31WaitErr == nil && waiting > 0 {
			observedR31Wait = true
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	// Release User B, receive BOTH results and join both workers before clearing the hook (R4-1).
	safeReleaseB()
	acceptErr := waitErrCh(acceptErrCh, "joinerB AcceptInvite completion")
	delXErr := waitErrCh(delXErrCh, "ownerX DeleteAccount completion")
	joinWorker(acceptDone, "Part 3 joinerB AcceptInvite")
	joinWorker(delXDone, "Part 3 ownerX DeleteAccount")
	joinedPart3 = true
	cancelPart3()
	resetPart3Hooks()
	if !observedR31Wait {
		t.Fatalf("did not observe ownerX DeleteAccount waiting on LockOrganizationForUpdate before grant prelock (lastErr=%v)", r31WaitErr)
	}
	if acceptErr != nil {
		t.Fatalf("joinerB AcceptInvite error: %v", acceptErr)
	}
	var pgErr *pgconn.PgError
	if errors.As(delXErr, &pgErr) && pgErr.Code == "40P01" {
		t.Fatalf("DeleteAccount vs AcceptInvite deadlocked with 40P01: %v", delXErr)
	}
	if !errors.Is(delXErr, ErrOrganizationHasMembers) {
		t.Fatalf("DeleteAccount after joinerB joined Org X = %v, want ErrOrganizationHasMembers", delXErr)
	}
}

// TestDriveRevocationUnsealRetryConfigAndBoundedResolve covers R1-5, R1-16, and R1-17:
//   - R1-5: an unseal failure (corrupt ciphertext or wrong key) keeps the row and
//     ciphertext in-flight for retry; restoring the key after the lease expires
//     revokes and resolves; persistent unseal failure past 24h abandons and
//     increments drive_revocation_abandoned_total.
//   - R1-16: unsetting GOOGLE_DRIVE_CLIENT_ID / GOOGLE_DRIVE_CLIENT_SECRET makes
//     Available() false (disabling StartOAuth), while RevocationAvailable() stays
//     true and queued revocations still run.
//   - R1-17: resolveRevocationAttempt bounds its detached context with an explicit
//     timeout; holding the drive_grant:<sub> advisory lock and cancelling the
//     worker exits within the timeout while keeping the row and ciphertext retryable.
func TestDriveRevocationUnsealRetryConfigAndBoundedResolve(t *testing.T) {
	fx := newDriveTestFixture(t)
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Microsecond)
	fx.svc.now = func() time.Time { return now }

	connectAndDisconnect := func(code string) {
		u, nonce, err := fx.svc.StartOAuth(ctx, Human(fx.user.ID), fx.work.ID, "")
		if err != nil {
			t.Fatal(err)
		}
		st, _ := extractStateFromAuthURL(t, u)
		if got := fx.svc.CompleteOAuth(ctx, st, code, "", "", nonce); got != DriveOAuthConnected {
			t.Fatalf("CompleteOAuth(%s) = %q", code, got)
		}
		list, err := fx.svc.List(ctx, Human(fx.user.ID), fx.work.ID)
		if err != nil {
			t.Fatal(err)
		}
		var connID string
		for _, c := range list {
			if c.GoogleEmail == "drive-"+code+"@example.com" {
				connID = c.ID
			}
		}
		if err := fx.svc.Disconnect(ctx, Human(fx.user.ID), fx.work.ID, connID); err != nil {
			t.Fatal(err)
		}
	}

	// 1. R1-5: Key mismatch / unseal failure keeps ciphertext in-flight -> key restored -> revokes;
	// corrupt ciphertext past 24h -> abandoned + metric incremented.
	connectAndDisconnect("unseal-rec")
	wrongBox := testDriveBox(t)
	wrongKeySvc := NewDriveConnectionService(fx.pool, fx.q, fx.ws, wrongBox)
	wrongKeySvc.SetProvider(fx.fake)
	wrongKeySvc.now = func() time.Time { return now }
	var abandonedCount atomic.Int32
	wrongKeySvc.SetMetrics(&testDriveMetrics{onAbandoned: func() { abandonedCount.Add(1) }})

	if wrongKeySvc.ProcessOneRevocation(ctx, "fake-sub-unseal-rec") {
		t.Fatal("first unseal failure must not resolve the revocation row before 24h")
	}
	if abandonedCount.Load() != 0 {
		t.Fatalf("abandonedCount after first unseal failure = %d, want 0", abandonedCount.Load())
	}
	rowAfterUnsealFail, err := fx.q.GetDriveGrantRevocationForUpdate(ctx, "fake-sub-unseal-rec")
	if err != nil || rowAfterUnsealFail.ResolvedAt.Valid || !rowAfterUnsealFail.RefreshTokenEnc.Valid || !rowAfterUnsealFail.AttemptID.Valid {
		t.Fatalf("row after unseal failure must keep ciphertext and stay in-flight: %+v, err=%v", rowAfterUnsealFail, err)
	}
	// Restore the right key after lease expires -> revokes and resolves!
	now = now.Add(driveRevocationLeaseTTL + time.Second)
	if !fx.svc.ProcessOneRevocation(ctx, "fake-sub-unseal-rec") {
		t.Fatal("expected revocation to succeed after key restoration")
	}
	rowAfterRestore, err := fx.q.GetDriveGrantRevocationForUpdate(ctx, "fake-sub-unseal-rec")
	if err != nil || !rowAfterRestore.ResolvedAt.Valid || rowAfterRestore.RefreshTokenEnc.Valid {
		t.Fatalf("row after key restoration = %+v, err=%v", rowAfterRestore, err)
	}

	// Corrupt ciphertext past 24h -> abandoned + metric incremented.
	connectAndDisconnect("unseal-24h")
	if _, err := fx.pool.Exec(ctx, `UPDATE drive_grant_revocations SET refresh_token_enc = 'corrupt-ciphertext' WHERE google_sub = 'fake-sub-unseal-24h'`); err != nil {
		t.Fatal(err)
	}
	fx.svc.SetMetrics(&testDriveMetrics{onAbandoned: func() { abandonedCount.Add(1) }})
	if fx.svc.ProcessOneRevocation(ctx, "fake-sub-unseal-24h") {
		t.Fatal("corrupt ciphertext before 24h must not resolve")
	}
	rowBefore24h, err := fx.q.GetDriveGrantRevocationForUpdate(ctx, "fake-sub-unseal-24h")
	if err != nil || rowBefore24h.ResolvedAt.Valid || rowBefore24h.RefreshTokenEnc.String != "corrupt-ciphertext" {
		t.Fatalf("corrupt ciphertext before 24h must be preserved: %+v, err=%v", rowBefore24h, err)
	}
	now = now.Add(driveRevocationAbandonWindow + time.Minute)
	if !fx.svc.ProcessOneRevocation(ctx, "fake-sub-unseal-24h") {
		t.Fatal("corrupt ciphertext past 24h must abandon")
	}
	if abandonedCount.Load() != 1 {
		t.Fatalf("abandonedCount = %d, want 1", abandonedCount.Load())
	}
	rowAfter24h, err := fx.q.GetDriveGrantRevocationForUpdate(ctx, "fake-sub-unseal-24h")
	if err != nil || !rowAfter24h.ResolvedAt.Valid || rowAfter24h.RefreshTokenEnc.Valid || rowAfter24h.LastError != "unseal_failed" {
		t.Fatalf("row after 24h unseal abandon = %+v, err=%v", rowAfter24h, err)
	}

	// 2. R1-16: Revoke without OAuth client id/secret configured.
	now = now.Add(5 * time.Second)
	connectAndDisconnect("no-oauth-cfg")
	oidcSrv := newFakeDriveOIDCServer(t)
	revokeOnlySvc := NewDriveConnectionService(fx.pool, fx.q, fx.ws, fx.box)
	revokeOnlySvc.SetFlags(driveConnectorFlags(t, true))
	revokeOnlySvc.now = func() time.Time { return now }
	// ConfigureOAuth with empty client ID and secret: Available() must be false,
	// but RevocationAvailable() is true!
	revokeOnlySvc.ConfigureOAuth(config.Config{
		GoogleDriveClientID:     "",
		GoogleDriveClientSecret: "",
	})
	if revokeOnlySvc.Available() {
		t.Fatal("Available() must be false when client id/secret are unset")
	}
	if !revokeOnlySvc.RevocationAvailable() {
		t.Fatal("RevocationAvailable() must be true when box is set even without client id/secret")
	}
	if _, _, err := revokeOnlySvc.StartOAuth(ctx, Human(fx.user.ID), fx.work.ID, ""); !errors.Is(err, ErrDriveNotConfigured) {
		t.Fatalf("StartOAuth without client id/secret = %v, want ErrDriveNotConfigured", err)
	}
	// Point the internal GoogleDriveProvider revoker at the local httptest revoke endpoint.
	gp := revokeOnlySvc.revoker.(*GoogleDriveProvider)
	gp.revokeURL = oidcSrv.srv.URL + "/revoke"
	gp.revokeHTTP = oidcSrv.srv.Client()
	if n := revokeOnlySvc.ProcessDueRevocations(ctx); n < 1 {
		t.Fatalf("ProcessDueRevocations without OAuth client id/secret = %d, want >= 1", n)
	}
	revNoOAuth, err := fx.q.GetDriveGrantRevocationForUpdate(ctx, "fake-sub-no-oauth-cfg")
	if err != nil || !revNoOAuth.ResolvedAt.Valid || revNoOAuth.RefreshTokenEnc.Valid {
		t.Fatalf("revNoOAuth = %+v, err=%v", revNoOAuth, err)
	}

	// 3. R1-17: Bounded resolve timeout when grant lock is held and worker context is cancelled.
	now = now.Add(5 * time.Second)
	connectAndDisconnect("bounded-res")
	boundedSvc := NewDriveConnectionService(fx.pool, fx.q, fx.ws, fx.box)
	boundedSvc.SetProvider(fx.fake)
	boundedSvc.now = func() time.Time { return now }
	boundedSvc.resolveTimeout = 100 * time.Millisecond

	// Hold drive_grant:fake-sub-bounded-res in another transaction while step 3 tries to resolve.
	lockReady := make(chan struct{})
	releaseLock := make(chan struct{})
	workerCtx, cancelWorker := context.WithCancel(ctx)
	defer cancelWorker()

	boundedSvc.testAfterRevokeGoogle = func(sub string, _ db.DriveGrantRevocation, revokeErr error) error {
		if sub == "fake-sub-bounded-res" {
			go func() {
				holdTx, err := fx.pool.Begin(ctx)
				if err == nil {
					_ = fx.q.WithTx(holdTx).LockDriveGrantSub(ctx, sub)
					close(lockReady)
					<-releaseLock
					_ = holdTx.Rollback(ctx)
				}
			}()
			<-lockReady
			cancelWorker()
		}
		return revokeErr
	}

	startResolve := time.Now()
	resolved := boundedSvc.ProcessOneRevocation(workerCtx, "fake-sub-bounded-res")
	elapsed := time.Since(startResolve)
	close(releaseLock)

	if resolved {
		t.Fatal("ProcessOneRevocation must return false when resolve transaction times out on held advisory lock")
	}
	if elapsed > 5*time.Second {
		t.Fatalf("resolve transaction took %v, expected bounded exit near 100ms", elapsed)
	}
	rowAfterTimeout, err := fx.q.GetDriveGrantRevocationForUpdate(ctx, "fake-sub-bounded-res")
	if err != nil || rowAfterTimeout.ResolvedAt.Valid || !rowAfterTimeout.RefreshTokenEnc.Valid || !rowAfterTimeout.AttemptID.Valid {
		t.Fatalf("row after resolve timeout must keep ciphertext and stay retryable: %+v, err=%v", rowAfterTimeout, err)
	}
}

// TestDriveProviderLaneAndOrganizationClosePostCommit covers R1-6 and R1-7:
//   - R1-6: RevocationConsumer is registered with dispatcher.RegisterLane(outbox.LaneProvider, ...)
//     and executes the revocation for the sub of the connection named by the
//     drive_connection.changed outbox event emitted on disconnect/lifecycle.
//   - R1-7: Close, invitation switch (SwitchActionClose), and sole-owner DeleteAccount
//     carry the disconnected Drive subs out of the membership transaction and
//     trigger their revocation in post-commit cleanup (never inside the membership
//     transaction); if the transaction fails / rolls back, no provider call is made.
func TestDriveProviderLaneAndOrganizationClosePostCommit(t *testing.T) {
	fx := newDriveTestFixture(t)
	ctx := context.Background()
	as := NewAuthService(fx.pool, fx.q, auth.TokenMinter{Secret: []byte("t"), TTL: time.Minute}, time.Hour, nil)
	as.SetDrive(fx.svc)
	fx.ws.SetDrive(fx.svc)
	memberSvc := NewOrganizationMemberService(fx.pool, fx.q, fx.orgs)
	memberSvc.SetDrive(fx.svc)

	connectInWS := func(userID, wsID, code string) string {
		u, nonce, err := fx.svc.StartOAuth(ctx, Human(userID), wsID, "")
		if err != nil {
			t.Fatal(err)
		}
		st, _ := extractStateFromAuthURL(t, u)
		if got := fx.svc.CompleteOAuth(ctx, st, code, "", "", nonce); got != DriveOAuthConnected {
			t.Fatalf("CompleteOAuth(%s) = %q", code, got)
		}
		list, err := fx.svc.List(ctx, Human(userID), wsID)
		if err != nil {
			t.Fatal(err)
		}
		for _, c := range list {
			if c.GoogleEmail == "drive-"+code+"@example.com" {
				return c.ID
			}
		}
		t.Fatalf("connection %s not found", code)
		return ""
	}

	// 1. R1-6 & R2-6: Provider lane consumer registration, failure-to-retry path, and resolution.
	dispatcher := outbox.New(fx.pool, fx.q, outbox.Options{Batch: 10, Tick: 15 * time.Millisecond})
	dispatcher.RegisterLane(outbox.LaneProvider, fx.svc.RevocationConsumer())

	connLane := connectInWS(fx.user.ID, fx.work.ID, "lane-sub")
	// Mark the setup connect event DONE so only the disconnect event is eligible
	// when the provider-lane dispatcher starts (R3-3).
	if _, err := fx.pool.Exec(ctx, `
		UPDATE outbox_events
		SET status = 'DONE', completed_at = now(), done_at = now()
		WHERE organization_id = $1 AND topic = 'drive_connection.changed'`, fx.org.ID); err != nil {
		t.Fatalf("drain setup connect outbox events: %v", err)
	}
	if err := fx.svc.Disconnect(ctx, Human(fx.user.ID), fx.work.ID, connLane); err != nil {
		t.Fatalf("Disconnect: %v", err)
	}
	var discOutboxID string
	if err := fx.pool.QueryRow(ctx, `
		SELECT id FROM outbox_events
		WHERE organization_id = $1 AND topic = 'drive_connection.changed' AND status = 'PENDING'
		ORDER BY created_at DESC, id DESC LIMIT 1`, fx.org.ID).Scan(&discOutboxID); err != nil {
		t.Fatalf("find disconnect outbox event: %v", err)
	}
	// Inject a failing revoke on the first provider-lane dispatch (R2-6): the consumer
	// must return an error so the dispatcher keeps the outbox event PENDING with
	// attempts >= 1, and the drive_grant_revocations row remains unresolved with its
	// encrypted token intact!
	firstFailDone := make(chan struct{})
	var failOnce atomic.Bool
	fx.fake.SetRevoke(func(_ context.Context, token string) error {
		if token == "fake-drive-refresh-lane-sub" && failOnce.CompareAndSwap(false, true) {
			return errors.New("simulated google 503 on provider lane")
		}
		return nil
	})
	fx.svc.testAfterRevokeGoogle = func(sub string, _ db.DriveGrantRevocation, revokeErr error) error {
		if sub == "fake-sub-lane-sub" && revokeErr != nil {
			select {
			case <-firstFailDone:
			default:
				close(firstFailDone)
			}
		}
		return revokeErr
	}

	dispCtx1, cancelDisp1 := context.WithCancel(ctx)
	dispDone1 := make(chan struct{})
	go func() {
		dispatcher.Run(dispCtx1)
		close(dispDone1)
	}()
	select {
	case <-firstFailDone:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for provider-lane consumer first failed attempt")
	}
	// Wait until dispatcher's fail() transaction commits attempts >= 1 on discOutboxID.
	retryWaitDeadline := time.Now().Add(3 * time.Second)
	var outboxStatus string
	var outboxAttempts int32
	var outboxLastErr string
	for time.Now().Before(retryWaitDeadline) {
		_ = fx.pool.QueryRow(ctx, `
			SELECT status, attempts, COALESCE(last_error, '')
			FROM outbox_events WHERE id = $1`, discOutboxID).Scan(&outboxStatus, &outboxAttempts, &outboxLastErr)
		if outboxAttempts >= 1 {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	cancelDisp1()
	<-dispDone1
	fx.svc.testAfterRevokeGoogle = nil

	if outboxStatus != "PENDING" || outboxAttempts < 1 || outboxLastErr == "" {
		t.Fatalf("outbox event after consumer failure: status=%q attempts=%d last_error=%q, want PENDING with attempts>=1",
			outboxStatus, outboxAttempts, outboxLastErr)
	}
	revAfterFail, err := fx.q.GetDriveGrantRevocationForUpdate(ctx, "fake-sub-lane-sub")
	if err != nil || revAfterFail.ResolvedAt.Valid || !revAfterFail.RefreshTokenEnc.Valid {
		t.Fatalf("queue row after consumer failure must stay unresolved with token: %+v, err=%v", revAfterFail, err)
	}

	// Make both the queue lease and outbox available_at immediately eligible so the
	// next provider-lane pass retries and resolves deterministically via a completion channel.
	if _, err := fx.pool.Exec(ctx, `
		UPDATE drive_grant_revocations
		SET attempt_started_at = now() - interval '3 minutes'
		WHERE google_sub = 'fake-sub-lane-sub'`); err != nil {
		t.Fatal(err)
	}
	if _, err := fx.pool.Exec(ctx, `
		UPDATE outbox_events
		SET available_at = now() - interval '1 second', locked_until = NULL, locked_by = NULL
		WHERE id = $1`, discOutboxID); err != nil {
		t.Fatal(err)
	}
	resolvedOnRetry := make(chan struct{})
	var resolvedOnce atomic.Bool
	fx.svc.testBeforeResolveTx = func(sub string, _ int64, _ string) error {
		if sub == "fake-sub-lane-sub" && resolvedOnce.CompareAndSwap(false, true) {
			defer close(resolvedOnRetry)
		}
		return nil
	}
	dispCtx2, cancelDisp2 := context.WithCancel(ctx)
	dispDone2 := make(chan struct{})
	go func() {
		dispatcher.Run(dispCtx2)
		close(dispDone2)
	}()
	select {
	case <-resolvedOnRetry:
	case <-time.After(5 * time.Second):
		t.Fatal("timed out waiting for provider-lane consumer retry resolution")
	}
	doneWaitDeadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(doneWaitDeadline) {
		_ = fx.pool.QueryRow(ctx, `SELECT status FROM outbox_events WHERE id = $1`, discOutboxID).Scan(&outboxStatus)
		if outboxStatus == "DONE" {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	cancelDisp2()
	<-dispDone2
	fx.svc.testBeforeResolveTx = nil
	fx.fake.SetRevoke(nil)

	if outboxStatus != "DONE" {
		t.Fatalf("outbox status after retry = %q, want DONE", outboxStatus)
	}
	revLane, err := fx.q.GetDriveGrantRevocationForUpdate(ctx, "fake-sub-lane-sub")
	if err != nil || !revLane.ResolvedAt.Valid || revLane.RefreshTokenEnc.Valid {
		t.Fatalf("provider lane consumer did not resolve fake-sub-lane-sub on retry: %+v, err=%v", revLane, err)
	}
	// 2. R1-7: Organization Close — rollback (wrong confirmSlug) makes NO provider
	// call and leaves connection active; commit disconnects inside the transaction
	// and invokes provider RevokeToken ONLY after the transaction has committed.
	ownerClose := registerVerified(t, fx.q, as, "r1-7-close-"+util.NewID()+"@example.com", "OwnerClose")
	orgClose, err := fx.orgs.Create(ctx, ownerClose.ID, "Close Org", "r1-7-close-"+strings.ToLower(util.NewID()[:8]))
	if err != nil {
		t.Fatal(err)
	}
	wsCloseView, err := fx.ws.CreateInOrg(ctx, ownerClose.ID, orgClose.ID, "WS Close", "ws-close")
	if err != nil {
		t.Fatal(err)
	}
	_ = connectInWS(ownerClose.ID, wsCloseView.Workspace.ID, "close-sub")
	beforeRevokeLen := len(fx.fake.RevokeCalls())

	// Rollback case: wrong confirmSlug -> fails and rolls back -> zero Google calls.
	if err := memberSvc.Close(ctx, ownerClose.ID, orgClose.ID, "wrong-slug"); err == nil {
		t.Fatal("Close with wrong slug must fail")
	}
	if got := len(fx.fake.RevokeCalls()); got != beforeRevokeLen {
		t.Fatalf("RevokeCalls after rolled-back Close = %d, want %d", got, beforeRevokeLen)
	}

	// Commit case: inside RevokeToken hook, readorganizations table on a separate
	// pool connection to prove the Close transaction has already committed ("archived")
	// before any Google call happens!
	var orgStatusDuringRevoke string
	fx.fake.SetRevoke(func(rctx context.Context, token string) error {
		if token == "fake-drive-refresh-close-sub" {
			_ = fx.pool.QueryRow(rctx, `SELECT status FROM organizations WHERE id = $1`, orgClose.ID).Scan(&orgStatusDuringRevoke)
		}
		return nil
	})
	if err := memberSvc.Close(ctx, ownerClose.ID, orgClose.ID, orgClose.Slug); err != nil {
		t.Fatalf("Close: %v", err)
	}
	fx.fake.SetRevoke(nil)
	if orgStatusDuringRevoke != "archived" {
		t.Fatalf("org status visible on independent connection during RevokeToken = %q, want archived (proving post-commit execution)", orgStatusDuringRevoke)
	}
	revClose, err := fx.q.GetDriveGrantRevocationForUpdate(ctx, "fake-sub-close-sub")
	if err != nil || !revClose.ResolvedAt.Valid || revClose.RefreshTokenEnc.Valid {
		t.Fatalf("revClose after Close post-commit cleanup = %+v, err=%v", revClose, err)
	}

	// 3. R2-3: Post-commit cleanup bounds its detached context (including the claim
	// transaction and LockDriveGrantSub); holding the grant lock during Close returns
	// within the bound while keeping the queue row pending for the background sweep.
	ownerBounded := registerVerified(t, fx.q, as, "r2-3-close-"+util.NewID()+"@example.com", "OwnerBounded")
	orgBounded, err := fx.orgs.Create(ctx, ownerBounded.ID, "Bounded Close Org", "r2-3-close-"+strings.ToLower(util.NewID()[:8]))
	if err != nil {
		t.Fatal(err)
	}
	wsBoundedView, err := fx.ws.CreateInOrg(ctx, ownerBounded.ID, orgBounded.ID, "WS Bounded", "ws-bounded")
	if err != nil {
		t.Fatal(err)
	}
	_ = connectInWS(ownerBounded.ID, wsBoundedView.Workspace.ID, "bounded-close")
	fx.svc.postCommitTimeout = 100 * time.Millisecond
	t.Cleanup(func() { fx.svc.postCommitTimeout = 0 })

	// Right after Close commits and before cleanUpDriveGrantsAfterCommit enters
	// ProcessOneRevocation, acquire drive_grant:fake-sub-bounded-close on another
	// transaction and hold it so the post-commit claim transaction blocks on
	// LockDriveGrantSub until its detached timeout expires!
	holdReady := make(chan struct{})
	releaseHold := make(chan struct{})
	holdDone := make(chan struct{})
	fx.svc.testBeforePostCommitClean = func(subs []string) {
		if len(subs) == 1 && subs[0] == "fake-sub-bounded-close" {
			go func() {
				defer close(holdDone)
				holdTx, err := fx.pool.Begin(ctx)
				if err != nil {
					close(holdReady)
					return
				}
				defer func() { _ = holdTx.Rollback(ctx) }()
				_ = fx.q.WithTx(holdTx).LockDriveGrantSub(ctx, "fake-sub-bounded-close")
				close(holdReady)
				<-releaseHold
			}()
			<-holdReady
		}
	}
	startClose := time.Now()
	if err := memberSvc.Close(ctx, ownerBounded.ID, orgBounded.ID, orgBounded.Slug); err != nil {
		t.Fatalf("Close with held grant lock: %v", err)
	}
	closeElapsed := time.Since(startClose)
	fx.svc.testBeforePostCommitClean = nil
	close(releaseHold)
	<-holdDone
	if closeElapsed > 5*time.Second {
		t.Fatalf("Close post-commit cleanup took %v, expected bounded return near 100ms", closeElapsed)
	}
	revBoundedClose, err := fx.q.GetDriveGrantRevocationForUpdate(ctx, "fake-sub-bounded-close")
	if err != nil || revBoundedClose.ResolvedAt.Valid || revBoundedClose.AttemptID.Valid || !revBoundedClose.RefreshTokenEnc.Valid {
		t.Fatalf("queue row after timed-out post-commit claim must stay pending for sweep: %+v, err=%v", revBoundedClose, err)
	}

	// 4. R3-6: Post-commit total cleanup deadline propagates through Google revoke HTTP call
	// and resolve transaction, and caps the entire multi-sub loop at one total budget; any
	// sub whose Google call or resolve times out (or any subsequent sub not reached before
	// the total budget expires) stays retryable in drive_grant_revocations for the sweep.
	ownerTotal := registerVerified(t, fx.q, as, "r3-6-total-"+util.NewID()+"@example.com", "OwnerTotal")
	orgTotal, err := fx.orgs.Create(ctx, ownerTotal.ID, "Total Budget Org", "r3-6-total-"+strings.ToLower(util.NewID()[:8]))
	if err != nil {
		t.Fatal(err)
	}
	wsTotalView, err := fx.ws.CreateInOrg(ctx, ownerTotal.ID, orgTotal.ID, "WS Total", "ws-total")
	if err != nil {
		t.Fatal(err)
	}
	_ = connectInWS(ownerTotal.ID, wsTotalView.Workspace.ID, "total-a")
	_ = connectInWS(ownerTotal.ID, wsTotalView.Workspace.ID, "total-b")
	fx.svc.postCommitTimeout = 120 * time.Millisecond

	var googleObservedCtxErr error
	fx.fake.SetRevoke(func(rctx context.Context, token string) error {
		if token == "fake-drive-refresh-total-a" {
			<-rctx.Done()
			googleObservedCtxErr = rctx.Err()
			return rctx.Err()
		}
		return nil
	})
	startTotal := time.Now()
	if err := memberSvc.Close(ctx, ownerTotal.ID, orgTotal.ID, orgTotal.Slug); err != nil {
		t.Fatalf("Close with slow Google revoke: %v", err)
	}
	totalElapsed := time.Since(startTotal)
	fx.fake.SetRevoke(nil)
	fx.svc.postCommitTimeout = 0

	if !errors.Is(googleObservedCtxErr, context.DeadlineExceeded) {
		t.Fatalf("Google RevokeToken context error = %v, want context.DeadlineExceeded from post-commit budget", googleObservedCtxErr)
	}
	if totalElapsed > 5*time.Second {
		t.Fatalf("multi-sub post-commit cleanup took %v, expected bounded return near 120ms total budget", totalElapsed)
	}
	// Sub A's claim succeeded before its Google call timed out -> in-flight with token intact, retryable after lease.
	revTotalA, err := fx.q.GetDriveGrantRevocationForUpdate(ctx, "fake-sub-total-a")
	if err != nil || revTotalA.ResolvedAt.Valid || !revTotalA.AttemptID.Valid || !revTotalA.RefreshTokenEnc.Valid {
		t.Fatalf("sub A after post-commit Google timeout must stay in-flight with token for retry: %+v, err=%v", revTotalA, err)
	}
	// Sub B was skipped once the total cleanup budget expired -> still pending with token intact for the sweep.
	revTotalB, err := fx.q.GetDriveGrantRevocationForUpdate(ctx, "fake-sub-total-b")
	if err != nil || revTotalB.ResolvedAt.Valid || revTotalB.AttemptID.Valid || !revTotalB.RefreshTokenEnc.Valid {
		t.Fatalf("sub B after total post-commit budget expired must stay pending with token for sweep: %+v, err=%v", revTotalB, err)
	}

	// 5. R4-3: Google revoke succeeds for sub 1, then the total cleanup budget expires
	// while resolveRevocationAttempt waits on a held drive_grant:<sub> advisory lock
	// (with default 15s resolveTimeout preserved, so only detachedStepContext's inherited
	// deadline bounds resolve): cleanup returns within the total budget, sub 1's token and
	// attempt stay retryable, and sub 2 stays untouched/pending.
	ownerResTotal := registerVerified(t, fx.q, as, "r4-3-res-"+util.NewID()+"@example.com", "OwnerResTotal")
	orgResTotal, err := fx.orgs.Create(ctx, ownerResTotal.ID, "Resolve Total Org", "r4-3-res-"+strings.ToLower(util.NewID()[:8]))
	if err != nil {
		t.Fatal(err)
	}
	wsResTotalView, err := fx.ws.CreateInOrg(ctx, ownerResTotal.ID, orgResTotal.ID, "WS Res Total", "ws-res-total")
	if err != nil {
		t.Fatal(err)
	}
	_ = connectInWS(ownerResTotal.ID, wsResTotalView.Workspace.ID, "res-bgt-a")
	_ = connectInWS(ownerResTotal.ID, wsResTotalView.Workspace.ID, "res-bgt-b")
	fx.svc.postCommitTimeout = 120 * time.Millisecond
	fx.svc.resolveTimeout = 0

	resHoldReady := make(chan struct{})
	releaseResHold := make(chan struct{})
	resHoldDone := make(chan struct{})
	var releaseResOnce sync.Once
	safeReleaseRes := func() { releaseResOnce.Do(func() { close(releaseResHold) }) }
	var resHoldStarted atomic.Bool
	var holderStartErr error
	var resHoldErr error
	var googleRevokeSucceeded bool
	var joinedResHold bool
	t.Cleanup(func() {
		safeReleaseRes()
		if resHoldStarted.Load() && !joinedResHold {
			select {
			case <-resHoldDone:
				joinedResHold = true
			case <-time.After(15 * time.Second):
				t.Fatalf("timed out waiting for resolve grant holder to exit in cleanup")
			}
		}
		fx.svc.testAfterRevokeGoogle = nil
		fx.svc.postCommitTimeout = 0
	})
	fx.svc.testAfterRevokeGoogle = func(sub string, _ db.DriveGrantRevocation, revokeErr error) error {
		if sub == "fake-sub-res-bgt-a" && revokeErr == nil && resHoldStarted.CompareAndSwap(false, true) {
			googleRevokeSucceeded = true
			go func() {
				defer close(resHoldDone)
				acqCtx, cancelAcq := context.WithTimeout(ctx, 5*time.Second)
				defer cancelAcq()
				holdTx, err := fx.pool.Begin(acqCtx)
				if err != nil {
					holderStartErr = fmt.Errorf("begin holder tx: %w", err)
					close(resHoldReady)
					return
				}
				defer func() { _ = holdTx.Rollback(ctx) }()
				if err := fx.q.WithTx(holdTx).LockDriveGrantSub(acqCtx, "fake-sub-res-bgt-a"); err != nil {
					holderStartErr = fmt.Errorf("lock holder grant: %w", err)
					close(resHoldReady)
					return
				}
				close(resHoldReady)
				select {
				case <-releaseResHold:
				case <-time.After(10 * time.Second):
				}
			}()
			select {
			case <-resHoldReady:
				resHoldErr = holderStartErr
			case <-time.After(5 * time.Second):
				resHoldErr = fmt.Errorf("timed out waiting for resolve grant holder readiness")
			}
		}
		return revokeErr
	}

	startResTotal := time.Now()
	if err := memberSvc.Close(ctx, ownerResTotal.ID, orgResTotal.ID, orgResTotal.Slug); err != nil {
		t.Fatalf("Close with held resolve grant lock: %v", err)
	}
	resTotalElapsed := time.Since(startResTotal)
	safeReleaseRes()
	if !googleRevokeSucceeded || !resHoldStarted.Load() {
		t.Fatal("post-commit cleanup never reached testAfterRevokeGoogle with successful Google revoke for fake-sub-res-bgt-a (budget expired before hook)")
	}
	select {
	case <-resHoldDone:
		joinedResHold = true
	case <-time.After(15 * time.Second):
		t.Fatal("timed out waiting for resolve grant holder to exit")
	}
	if resHoldErr == nil {
		resHoldErr = holderStartErr
	}
	if resHoldErr != nil {
		t.Fatalf("resolve grant holder setup error: %v", resHoldErr)
	}
	fx.svc.testAfterRevokeGoogle = nil
	fx.svc.postCommitTimeout = 0

	if resTotalElapsed > 5*time.Second {
		t.Fatalf("post-commit cleanup with blocked resolve took %v, expected bounded return near 120ms total budget (< 5s ceiling vs 10s holder watchdog)", resTotalElapsed)
	}
	revResA, err := fx.q.GetDriveGrantRevocationForUpdate(ctx, "fake-sub-res-bgt-a")
	if err != nil || revResA.ResolvedAt.Valid || !revResA.AttemptID.Valid || !revResA.RefreshTokenEnc.Valid {
		t.Fatalf("sub 1 after resolve budget expiry must keep token and attempt retryable: %+v, err=%v", revResA, err)
	}
	revResB, err := fx.q.GetDriveGrantRevocationForUpdate(ctx, "fake-sub-res-bgt-b")
	if err != nil || revResB.ResolvedAt.Valid || revResB.AttemptID.Valid || !revResB.RefreshTokenEnc.Valid {
		t.Fatalf("sub 2 after resolve budget expiry must stay untouched/pending: %+v, err=%v", revResB, err)
	}
}
