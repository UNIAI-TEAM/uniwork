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
// inside the one organization the grant names.
type McpPrincipal struct {
	UserID, OrganizationID, GrantID, ClientID string
}

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
	enabled, err := s.orgEnabled(ctx, grant.UserID, grant.OrganizationID)
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
	// Best effort: both statements are throttled to one write per five minutes.
	_ = s.q.TouchMcpGrant(ctx, grant.ID)
	_ = s.q.TouchMcpClient(ctx, grant.ClientID)
	return McpPrincipal{UserID: grant.UserID, OrganizationID: grant.OrganizationID, GrantID: grant.ID, ClientID: grant.ClientID}, nil
}
