package service

import (
	"context"
	"net/url"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/mail"
	"github.com/unicomhub/uniwork/server/internal/testutil"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type mcpWorld struct {
	ctx   context.Context
	pool  *pgxpool.Pool
	q     *db.Queries
	svc   *McpAuthService
	auth  *AuthService
	orgs  *OrganizationService
	ws    *WorkspaceService
	owner db.User
	org   db.Organization
	wsID  string
}

type mcpFlags bool

func (f mcpFlags) IsEnabled(context.Context, string, bool) bool { return bool(f) }

type fakeCIMD struct {
	body  []byte
	err   error
	calls int
}

func (f *fakeCIMD) Fetch(context.Context, string) ([]byte, error) { f.calls++; return f.body, f.err }

const mcpTestAPI = "https://api.example.test"

func newMcpWorld(t *testing.T) *mcpWorld {
	t.Helper()
	pool := testutil.DB(t)
	q := db.New(pool)
	ctx := context.Background()
	authSvc := NewAuthService(pool, q, auth.TokenMinter{Secret: []byte("mcp-test"), TTL: time.Minute}, time.Hour, nil)
	orgs := NewOrganizationService(pool, q)
	ws := NewWorkspaceService(pool, q, orgs, mail.Renderer{AppURL: "https://app.example.test"}, &fakeOutbox{})
	svc := NewMcpAuthService(pool, q, orgs, config.Config{APIPublicURL: mcpTestAPI + "/", FrontendOrigin: "https://app.example.test"})
	svc.SetFlags(mcpFlags(true))
	owner := registerVerified(t, q, authSvc, "mcp-owner@example.com", "MCP Owner")
	org, err := orgs.Create(ctx, owner.ID, "MCP Org", "mcp-org")
	if err != nil {
		t.Fatal(err)
	}
	v, err := ws.CreateInOrg(ctx, owner.ID, org.ID, "MCP WS", "mcp-ws")
	if err != nil {
		t.Fatal(err)
	}
	return &mcpWorld{ctx: ctx, pool: pool, q: q, svc: svc, auth: authSvc, orgs: orgs, ws: ws, owner: owner, org: org, wsID: v.Workspace.ID}
}

// publicClient registers a DCR public client with one https redirect.
func (w *mcpWorld) publicClient(t *testing.T, redirect string) McpClient {
	t.Helper()
	reg, err := w.svc.Register(w.ctx, McpRegistration{ClientName: "Test Client", RedirectURIs: []string{redirect}, TokenEndpointAuthMethod: "none"})
	if err != nil {
		t.Fatal(err)
	}
	return reg.Client
}

// enable turns the connector on for the world's organization.
func (w *mcpWorld) enable(t *testing.T) {
	t.Helper()
	if _, err := w.q.SetOrganizationMcpPolicy(w.ctx, db.SetOrganizationMcpPolicyParams{ID: w.org.ID, Enabled: true, ActorID: w.owner.ID}); err != nil {
		t.Fatal(err)
	}
}

const mcpTestVerifier = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"

func mcpTestChallenge() string { return pkceChallenge(mcpTestVerifier) }

func attemptID(t *testing.T, consentURL string) string {
	t.Helper()
	u, err := url.Parse(consentURL)
	if err != nil {
		t.Fatal(err)
	}
	return u.Query().Get("attempt")
}

// approve walks Start → Consent → Approve for the owner and returns the code.
func (w *mcpWorld) approve(t *testing.T, c McpClient, redirect string) string {
	t.Helper()
	return w.approveAs(t, w.owner, c, redirect)
}

// approveAs is approve for any member of the world's organization.
func (w *mcpWorld) approveAs(t *testing.T, u db.User, c McpClient, redirect string) string {
	t.Helper()
	consentURL, err := w.svc.Start(w.ctx, McpAuthorizeInput{ResponseType: "code", ClientID: c.ClientID, RedirectURI: redirect, CodeChallenge: mcpTestChallenge(), CodeChallengeMethod: "S256", State: "st"})
	if err != nil {
		t.Fatal(err)
	}
	id := attemptID(t, consentURL)
	consent, err := w.svc.Consent(w.ctx, u.ID, id)
	if err != nil {
		t.Fatal(err)
	}
	to, err := w.svc.Approve(w.ctx, u.ID, id, consent.CSRFToken, w.org.ID, false)
	if err != nil {
		t.Fatal(err)
	}
	parsed, _ := url.Parse(to)
	return parsed.Query().Get("code")
}

// issue runs the whole flow for the owner and returns a fresh token pair.
func (w *mcpWorld) issue(t *testing.T) (McpClient, McpTokenPair) {
	t.Helper()
	w.enable(t)
	c := w.publicClient(t, "https://x.test/cb")
	code := w.approve(t, c, "https://x.test/cb")
	pair, err := w.svc.Exchange(w.ctx, McpExchangeInput{ClientID: c.ClientID, Code: code, CodeVerifier: mcpTestVerifier, RedirectURI: "https://x.test/cb"})
	if err != nil {
		t.Fatal(err)
	}
	return c, pair
}

// issueAs gives u (already a member of w.org) a token pair for a new client.
func (w *mcpWorld) issueAs(t *testing.T, u db.User) (McpClient, McpTokenPair) {
	t.Helper()
	w.enable(t)
	c := w.publicClient(t, "https://x.test/cb")
	code := w.approveAs(t, u, c, "https://x.test/cb")
	pair, err := w.svc.Exchange(w.ctx, McpExchangeInput{ClientID: c.ClientID, Code: code, CodeVerifier: mcpTestVerifier, RedirectURI: "https://x.test/cb"})
	if err != nil {
		t.Fatal(err)
	}
	return c, pair
}

func (w *mcpWorld) liveTokens(t *testing.T) int {
	t.Helper()
	var n int
	if err := w.pool.QueryRow(w.ctx, `SELECT count(*) FROM mcp_tokens WHERE organization_id = $1 AND revoked_at IS NULL`, w.org.ID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// mcpFlagsExcept answers true for every flag but one.
type mcpFlagsExcept struct{ off string }

func (f mcpFlagsExcept) IsEnabled(_ context.Context, key string, _ bool) bool { return key != f.off }
