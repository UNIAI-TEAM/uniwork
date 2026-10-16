package service

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"

	"github.com/unicomhub/uniwork/server/internal/ai"
	"github.com/unicomhub/uniwork/server/internal/audit"
)

// McpPrincipal is who a /mcp request acts for: the person who consented,
// inside the one organization the grant names, through one AI app.
type McpPrincipal struct {
	UserID, OrganizationID, GrantID, ClientID string
	ClientName                                string
	Scope                                     string // the grant's scope at this call
	// WriteOpen is the write flag and the organization's write switch,
	// read on this request (ADR 0033).
	WriteOpen bool
}

// CanWrite is all three conditions for a write tool: both switches and a
// grant that holds write.
func (p McpPrincipal) CanWrite() bool { return p.WriteOpen && mcpScopeHasWrite(p.Scope) }

// ToolContext is the actor every MCP tool runs as: the human who consented,
// inside the grant's organization. The workspace comes from tool input.
func (p McpPrincipal) ToolContext() ai.ToolContext {
	return ai.ToolContext{ActorID: p.UserID, ActorKind: audit.KindHuman, OrganizationID: p.OrganizationID}
}

// Authenticate is the whole gate of spec §7.2 except rate limiting: token,
// grant, platform flag, the organization's switch, then RequireMember
// (suspended organization, deactivated member). Every token problem is
// ErrMcpTokenInvalid so the handler answers 401 and the client signs in again.
func (s *McpAuthService) Authenticate(ctx context.Context, raw string) (McpPrincipal, error) {
	if !strings.HasPrefix(raw, mcpAccessPrefix) {
		return McpPrincipal{}, ErrMcpTokenInvalid
	}
	tok, err := s.q.GetMcpTokenByDigest(ctx, digest(raw))
	if errors.Is(err, pgx.ErrNoRows) {
		return McpPrincipal{}, ErrMcpTokenInvalid
	}
	if err != nil {
		return McpPrincipal{}, err
	}
	if tok.Kind != "access" || tok.RevokedAt.Valid || !tok.ExpiresAt.Time.After(s.now()) {
		return McpPrincipal{}, ErrMcpTokenInvalid
	}
	grant, err := s.q.GetMcpGrantByID(ctx, tok.GrantID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && grant.RevokedAt.Valid) {
		return McpPrincipal{}, ErrMcpTokenInvalid
	}
	if err != nil {
		return McpPrincipal{}, err
	}
	enabled, writeOpen, err := s.orgAccess(ctx, grant.UserID, grant.OrganizationID)
	if err != nil {
		return McpPrincipal{}, err
	}
	if !enabled {
		return McpPrincipal{}, errMcpConnectorDisabled()
	}
	if _, err := s.orgs.RequireMember(ctx, grant.OrganizationID, grant.UserID); err != nil {
		if errors.Is(err, ErrForbidden) {
			// Not a member at all: Leave is the only path that deletes a
			// membership and it revokes the grants, so this grant outlived
			// its person's place in the organization. Signing in again is
			// the right answer, and the consent page will not offer it.
			return McpPrincipal{}, ErrMcpTokenInvalid
		}
		return McpPrincipal{}, err
	}
	client, err := s.q.GetMcpClientByClientID(ctx, grant.ClientID)
	if err != nil {
		// A grant keeps its client alive (DeleteAbandonedMcpClients needs no
		// grant), so a missing one is not a token problem.
		return McpPrincipal{}, err
	}
	// Best effort: both statements are throttled to one write per five minutes.
	_ = s.q.TouchMcpGrant(ctx, grant.ID)
	_ = s.q.TouchMcpClient(ctx, grant.ClientID)
	return McpPrincipal{
		UserID: grant.UserID, OrganizationID: grant.OrganizationID, GrantID: grant.ID, ClientID: grant.ClientID,
		ClientName: client.ClientName, Scope: grant.Scope, WriteOpen: writeOpen,
	}, nil
}
