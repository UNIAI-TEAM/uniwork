package service

import (
	"context"
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
