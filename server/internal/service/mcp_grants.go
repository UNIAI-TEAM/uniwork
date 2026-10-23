package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type McpGrantView struct {
	ID, OrganizationID, OrganizationName, UserID, UserName, ClientID, ClientName string
	Verified                                                                     bool
	Scope                                                                        string
	CreatedAt                                                                    time.Time
	LastUsedAt                                                                   *time.Time
}

type McpPolicy struct {
	Enabled   bool
	Available bool // the platform flag; false means the switch cannot turn on yet
	EnabledAt *time.Time
	EnabledBy string
	// The write half (ADR 0033): WriteAvailable is the write flag.
	WriteEnabled   bool
	WriteAvailable bool
	WriteEnabledAt *time.Time
	WriteEnabledBy string
}

func mcpPolicyOf(enabledAt pgtype.Timestamptz, enabledBy pgtype.Text, writeAt pgtype.Timestamptz, writeBy pgtype.Text, available, writeAvailable bool) McpPolicy {
	return McpPolicy{
		Enabled: enabledAt.Valid, Available: available, EnabledAt: optTime(enabledAt), EnabledBy: enabledBy.String,
		WriteEnabled: writeAt.Valid, WriteAvailable: writeAvailable, WriteEnabledAt: optTime(writeAt), WriteEnabledBy: writeBy.String,
	}
}

func errMcpConnectorUnavailable() error {
	return CodedError{Code: "connector_unavailable", Status: http.StatusForbidden, Msg: "connector chưa mở cho tổ chức này", Err: ErrMcpConnectorDisabled}
}

func optTime(t pgtype.Timestamptz) *time.Time {
	if !t.Valid {
		return nil
	}
	v := t.Time
	return &v
}

func (s *McpAuthService) ListMyGrants(ctx context.Context, userID string) ([]McpGrantView, error) {
	rows, err := s.q.ListMcpGrantsForUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	out := make([]McpGrantView, 0, len(rows))
	for _, r := range rows {
		out = append(out, McpGrantView{
			ID: r.ID, OrganizationID: r.OrganizationID, OrganizationName: r.OrganizationName, UserID: userID,
			ClientID: r.ClientID, ClientName: r.ClientName, Verified: verifiedRedirectJSON(r.RedirectUris),
			Scope: r.Scope, CreatedAt: r.CreatedAt.Time, LastUsedAt: optTime(r.LastUsedAt),
		})
	}
	return out, nil
}

func (s *McpAuthService) ListOrgGrants(ctx context.Context, actorID, orgID string) ([]McpGrantView, error) {
	if err := s.requireOrgAdmin(ctx, orgID, actorID); err != nil {
		return nil, err
	}
	rows, err := s.q.ListMcpGrantsForOrganization(ctx, orgID)
	if err != nil {
		return nil, err
	}
	out := make([]McpGrantView, 0, len(rows))
	for _, r := range rows {
		out = append(out, McpGrantView{
			ID: r.ID, OrganizationID: r.OrganizationID, UserID: r.UserID, UserName: r.UserName,
			ClientID: r.ClientID, ClientName: r.ClientName, Verified: verifiedRedirectJSON(r.RedirectUris),
			Scope: r.Scope, CreatedAt: r.CreatedAt.Time, LastUsedAt: optTime(r.LastUsedAt),
		})
	}
	return out, nil
}

func (s *McpAuthService) RevokeMyGrant(ctx context.Context, userID, grantID string) error {
	return s.revokeGrant(ctx, audit.User(userID), grantID, func(g db.McpGrant) bool { return g.UserID == userID })
}

func (s *McpAuthService) RevokeOrgGrant(ctx context.Context, actorID, orgID, grantID string) error {
	if err := s.requireOrgAdmin(ctx, orgID, actorID); err != nil {
		return err
	}
	return s.revokeGrant(ctx, audit.User(actorID), grantID, func(g db.McpGrant) bool { return g.OrganizationID == orgID })
}

// revokeGrant closes one grant and its tokens in one transaction. A grant that
// is not the caller's reads as absent, and that is decided from an unlocked
// read (user_id and organization_id never change), so a stranger's request
// neither waits behind a rotation in flight nor tells by its timing that the id
// exists. Only then is the grant row locked (lock order: attempt, then grant, then
// token), so a rotation or mint in flight commits before the tokens are closed and its
// new pair is closed too.
func (s *McpAuthService) revokeGrant(ctx context.Context, actor audit.Actor, grantID string, mine func(db.McpGrant) bool) error {
	peek, err := s.q.GetMcpGrantByID(ctx, grantID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !mine(peek)) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	g, err := q.GetMcpGrantForUpdate(ctx, grantID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !mine(g)) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if g.RevokedAt.Valid {
		return nil
	}
	if _, err := q.RevokeMcpGrant(ctx, db.RevokeMcpGrantParams{
		ID: g.ID, RevokedBy: pgtype.Text{String: actor.ID, Valid: true}, RevokedByKind: pgtype.Text{String: string(actor.Kind), Valid: true},
	}); err != nil {
		return err
	}
	if _, err := q.RevokeMcpGrantTokens(ctx, g.ID); err != nil {
		return err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: g.OrganizationID, Actor: actor, Action: audit.ActionMcpGrantRevoked,
		ResourceType: "mcp_grant", ResourceID: g.ID, Metadata: map[string]any{"client_id": g.ClientID, "user_id": g.UserID},
	}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *McpAuthService) Policy(ctx context.Context, actorID, orgID string) (McpPolicy, error) {
	if err := s.requireOrgAdmin(ctx, orgID, actorID); err != nil {
		return McpPolicy{}, err
	}
	row, err := s.q.GetOrganizationMcpPolicy(ctx, orgID)
	if err != nil {
		return McpPolicy{}, err
	}
	return mcpPolicyOf(row.McpEnabledAt, row.McpEnabledBy, row.McpWriteEnabledAt, row.McpWriteEnabledBy, s.flagOn(ctx, actorID, orgID), s.flag(ctx, mcpWriteFlagKey, actorID, orgID)), nil
}

func (s *McpAuthService) SetPolicy(ctx context.Context, actorID, orgID string, enabled bool) (McpPolicy, error) {
	if err := s.requireOrgAdmin(ctx, orgID, actorID); err != nil {
		return McpPolicy{}, err
	}
	available := s.flagOn(ctx, actorID, orgID)
	writeAvailable := s.flag(ctx, mcpWriteFlagKey, actorID, orgID)
	if enabled && !available {
		return McpPolicy{}, errMcpConnectorUnavailable()
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return McpPolicy{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	before, err := q.GetOrganizationMcpPolicyForUpdate(ctx, orgID)
	if err != nil {
		return McpPolicy{}, err
	}
	if before.McpEnabledAt.Valid == enabled {
		// Nothing to change. Writing anyway would put this admin's id on a
		// switch another admin turned on and bump updated_at, with no audit row
		// to say so; the row keeps who and when the real change set.
		if err := tx.Commit(ctx); err != nil {
			return McpPolicy{}, err
		}
		return mcpPolicyOf(before.McpEnabledAt, before.McpEnabledBy, before.McpWriteEnabledAt, before.McpWriteEnabledBy, available, writeAvailable), nil
	}
	row, err := q.SetOrganizationMcpPolicy(ctx, db.SetOrganizationMcpPolicyParams{ID: orgID, Enabled: enabled, ActorID: actorID})
	if err != nil {
		return McpPolicy{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID, Actor: audit.User(actorID), Action: audit.ActionOrganizationMcpPolicyChanged,
		ResourceType: "organization", ResourceID: orgID,
		Changes: audit.Diff(
			map[string]any{"mcp_enabled": before.McpEnabledAt.Valid, "mcp_write_enabled": before.McpWriteEnabledAt.Valid},
			map[string]any{"mcp_enabled": enabled, "mcp_write_enabled": row.McpWriteEnabledAt.Valid},
		),
	}); err != nil {
		return McpPolicy{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return McpPolicy{}, err
	}
	return mcpPolicyOf(row.McpEnabledAt, row.McpEnabledBy, row.McpWriteEnabledAt, row.McpWriteEnabledBy, available, writeAvailable), nil
}

// SetWritePolicy turns write access for connected AI apps on or off (ADR
// 0033). It needs the connector on and the write flag open; turning it off
// is always allowed.
func (s *McpAuthService) SetWritePolicy(ctx context.Context, actorID, orgID string, enabled bool) (McpPolicy, error) {
	if err := s.requireOrgAdmin(ctx, orgID, actorID); err != nil {
		return McpPolicy{}, err
	}
	available := s.flagOn(ctx, actorID, orgID)
	writeAvailable := s.flag(ctx, mcpWriteFlagKey, actorID, orgID)
	if enabled && !writeAvailable {
		return McpPolicy{}, errMcpWriteUnavailable()
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return McpPolicy{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	before, err := q.GetOrganizationMcpPolicyForUpdate(ctx, orgID)
	if err != nil {
		return McpPolicy{}, err
	}
	if enabled && !before.McpEnabledAt.Valid {
		return McpPolicy{}, errMcpConnectorOff()
	}
	if before.McpWriteEnabledAt.Valid == enabled {
		if err := tx.Commit(ctx); err != nil {
			return McpPolicy{}, err
		}
		return mcpPolicyOf(before.McpEnabledAt, before.McpEnabledBy, before.McpWriteEnabledAt, before.McpWriteEnabledBy, available, writeAvailable), nil
	}
	row, err := q.SetOrganizationMcpWritePolicy(ctx, db.SetOrganizationMcpWritePolicyParams{ID: orgID, Enabled: enabled, ActorID: actorID})
	if err != nil {
		return McpPolicy{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID, Actor: audit.User(actorID), Action: audit.ActionOrganizationMcpWritePolicyChanged,
		ResourceType: "organization", ResourceID: orgID,
		Changes: audit.Diff(map[string]any{"mcp_write_enabled": before.McpWriteEnabledAt.Valid}, map[string]any{"mcp_write_enabled": enabled}),
	}); err != nil {
		return McpPolicy{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return McpPolicy{}, err
	}
	return mcpPolicyOf(row.McpEnabledAt, row.McpEnabledBy, row.McpWriteEnabledAt, row.McpWriteEnabledBy, available, writeAvailable), nil
}

func (s *McpAuthService) requireOrgAdmin(ctx context.Context, orgID, userID string) error {
	m, err := s.orgs.RequireMember(ctx, orgID, userID)
	if err != nil {
		return err
	}
	if m.Role != OrgRoleOwner && m.Role != OrgRoleAdmin {
		return ErrForbidden
	}
	return nil
}

// revokeMcpGrantsForUserInOrg runs inside Leave's transaction.
//
// Lock order everywhere is attempt, then grant, then token (mcp_tokens.go). The grants
// are therefore locked first, in id order, then marked revoked, and only then
// are their tokens closed. Closing tokens first would miss the pair a code
// exchange or rotation in flight inserts for a grant this call has not locked
// yet, and would deadlock with a Refresh that holds the grant and wants a token
// row this call already holds.
func revokeMcpGrantsForUserInOrg(ctx context.Context, q *db.Queries, orgID, userID string) error {
	if _, err := q.LockMcpGrantsForUserInOrganization(ctx, db.LockMcpGrantsForUserInOrganizationParams{OrganizationID: orgID, UserID: userID}); err != nil {
		return err
	}
	if _, err := q.RevokeMcpGrantsForUserInOrganization(ctx, db.RevokeMcpGrantsForUserInOrganizationParams{OrganizationID: orgID, UserID: userID}); err != nil {
		return err
	}
	_, err := q.RevokeMcpTokensForUserInOrganization(ctx, db.RevokeMcpTokensForUserInOrganizationParams{OrganizationID: orgID, UserID: userID})
	return err
}

// revokeAllMcpGrantsForUser runs inside DeleteAccount's and a password
// reset's transaction, in the same order as revokeMcpGrantsForUserInOrg and
// for the same reasons. It returns how many grants it revoked.
func revokeAllMcpGrantsForUser(ctx context.Context, q *db.Queries, userID string) (int64, error) {
	if _, err := q.LockAllMcpGrantsForUser(ctx, userID); err != nil {
		return 0, err
	}
	n, err := q.RevokeAllMcpGrantsForUser(ctx, userID)
	if err != nil {
		return 0, err
	}
	if _, err := q.RevokeAllMcpTokensForUser(ctx, userID); err != nil {
		return 0, err
	}
	return n, nil
}

func verifiedRedirectJSON(raw string) bool {
	var uris []string
	if json.Unmarshal([]byte(raw), &uris) != nil {
		return false
	}
	return verifiedRedirects(uris)
}
