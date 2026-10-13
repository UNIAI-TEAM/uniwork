package service

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

type McpTokenPair struct {
	AccessToken  string
	RefreshToken string
	Scope        string
	ExpiresIn    int32
}

type McpExchangeInput struct {
	ClientID, ClientSecret, Code, CodeVerifier, RedirectURI, Resource string
}

type McpRefreshInput struct {
	ClientID, ClientSecret, RefreshToken, Resource string
}

func (s *McpAuthService) checkResource(resource string) error {
	if resource != "" && resource != s.ResourceURL() {
		return oauthErr(http.StatusBadRequest, "invalid_target", "unknown resource")
	}
	return nil
}

// Exchange redeems an authorization code. The attempt id becomes the token
// family, so a replayed code closes exactly what it issued.
func (s *McpAuthService) Exchange(ctx context.Context, in McpExchangeInput) (McpTokenPair, error) {
	client, err := s.authenticateClient(ctx, in.ClientID, in.ClientSecret)
	if err != nil {
		return McpTokenPair{}, err
	}
	if err := s.checkResource(in.Resource); err != nil {
		return McpTokenPair{}, err
	}
	if in.Code == "" || !validPKCEVerifier(in.CodeVerifier) {
		return McpTokenPair{}, errInvalidGrant
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return McpTokenPair{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	row, err := q.RedeemMcpAuthAttempt(ctx, db.RedeemMcpAuthAttemptParams{
		CodeDigest: pgtype.Text{String: digest(in.Code), Valid: true}, ClientID: client.ClientID,
		RedirectUri: in.RedirectURI, CodeChallenge: pkceChallenge(in.CodeVerifier),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		_ = tx.Rollback(ctx)
		return McpTokenPair{}, s.codeReplay(ctx, in.Code)
	}
	if err != nil {
		return McpTokenPair{}, err
	}
	if row.Resource != s.ResourceURL() {
		// the attempt was bound to a resource this server does not serve
		// (RFC 8707); the deferred rollback leaves the code unused.
		return McpTokenPair{}, oauthErr(http.StatusBadRequest, "invalid_target", "unknown resource")
	}
	// Lock order everywhere: attempt, then grant, then token. This request holds
	// the attempt row (the redeem above); holding the grant row while the pair
	// is minted makes a concurrent revocation of this grant or family wait for
	// the new rows instead of missing them.
	grant, err := q.GetMcpGrantForUpdate(ctx, row.GrantID.String)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && grant.RevokedAt.Valid) {
		return McpTokenPair{}, errInvalidGrant
	}
	if err != nil {
		return McpTokenPair{}, err
	}
	pair, err := s.issuePair(ctx, q, grant, row.ID)
	if err != nil {
		return McpTokenPair{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return McpTokenPair{}, err
	}
	s.metrics.IncOAuth("token_issued")
	return pair, nil
}

// codeReplay answers a code that did not redeem. A code already used means
// someone else holds a copy: every token issued from it is revoked
// (RFC 6749 §4.1.2). Anything else is a plain invalid_grant.
func (s *McpAuthService) codeReplay(ctx context.Context, code string) error {
	row, err := s.q.GetMcpAuthAttemptByCodeDigest(ctx, pgtype.Text{String: digest(code), Valid: true})
	if errors.Is(err, pgx.ErrNoRows) {
		return errInvalidGrant
	}
	if err != nil {
		return err // a database fault is not the client's invalid_grant
	}
	if !row.UsedAt.Valid || !row.GrantID.Valid {
		return errInvalidGrant
	}
	if err := s.revokeFamily(ctx, row.GrantID.String, row.ID, "code_replay"); err != nil {
		return err
	}
	return errInvalidGrant
}

// Refresh rotates a refresh token. The grant row and then the token row are
// locked for the whole request, so two requests carrying the same token run
// one after the other: the first rotates, the second finds the token used. A second request inside
// mcpReuseGrace is a client racing itself (its first request already got the
// new pair): it is refused and the family stays. Later reuse means the token
// leaked, and the family is closed.
func (s *McpAuthService) Refresh(ctx context.Context, in McpRefreshInput) (McpTokenPair, error) {
	client, err := s.authenticateClient(ctx, in.ClientID, in.ClientSecret)
	if err != nil {
		return McpTokenPair{}, err
	}
	if err := s.checkResource(in.Resource); err != nil {
		return McpTokenPair{}, err
	}
	if !strings.HasPrefix(in.RefreshToken, mcpRefreshPrefix) {
		return McpTokenPair{}, errInvalidGrant
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return McpTokenPair{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	// Lock order everywhere: attempt, then grant, then token (a refresh touches
	// no attempt). The first read is unlocked and only names the grant; every
	// check below runs again under both locks.
	peek, err := q.GetMcpTokenByDigest(ctx, digest(in.RefreshToken))
	if errors.Is(err, pgx.ErrNoRows) {
		return McpTokenPair{}, errInvalidGrant
	}
	if err != nil {
		return McpTokenPair{}, err
	}
	grant, err := q.GetMcpGrantForUpdate(ctx, peek.GrantID)
	if errors.Is(err, pgx.ErrNoRows) {
		return McpTokenPair{}, errInvalidGrant
	}
	if err != nil {
		return McpTokenPair{}, err
	}
	tok, err := q.GetMcpTokenByDigestForUpdate(ctx, digest(in.RefreshToken))
	if errors.Is(err, pgx.ErrNoRows) {
		return McpTokenPair{}, errInvalidGrant
	}
	if err != nil {
		return McpTokenPair{}, err
	}
	if tok.Kind != "refresh" || tok.RevokedAt.Valid || !tok.ExpiresAt.Time.After(s.now()) {
		return McpTokenPair{}, errInvalidGrant
	}
	if grant.ClientID != client.ClientID || grant.RevokedAt.Valid {
		return McpTokenPair{}, errInvalidGrant
	}
	if tok.UsedAt.Valid {
		if s.now().Sub(tok.UsedAt.Time) < mcpReuseGrace {
			return McpTokenPair{}, errInvalidGrant // the client raced itself; its other request got the new pair
		}
		_ = tx.Rollback(ctx)
		if err := s.revokeFamily(ctx, grant.ID, tok.FamilyID, "refresh_reuse"); err != nil {
			return McpTokenPair{}, err
		}
		return McpTokenPair{}, errInvalidGrant
	}
	if n, err := q.MarkMcpTokenUsed(ctx, db.MarkMcpTokenUsedParams{ID: tok.ID, UsedAt: mcpTime(s.now())}); err != nil {
		return McpTokenPair{}, err
	} else if n == 0 {
		return McpTokenPair{}, errInvalidGrant // the row lock makes this unreachable; never rotate a token we did not claim
	}
	pair, err := s.issuePair(ctx, q, grant, tok.FamilyID)
	if err != nil {
		return McpTokenPair{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return McpTokenPair{}, err
	}
	s.metrics.IncOAuth("token_refreshed")
	return pair, nil
}

// RevokeToken is RFC 7009: an unknown token, or one another client holds,
// answers success and changes nothing. A refresh token closes its family.
// Only "no such row" is quiet; a database fault surfaces as an error.
func (s *McpAuthService) RevokeToken(ctx context.Context, clientID, clientSecret, raw string) error {
	client, err := s.authenticateClient(ctx, clientID, clientSecret)
	if err != nil {
		return err
	}
	// The first read is unlocked and only names the grant. Lock order
	// everywhere: attempt, then grant, then token, so the revocation waits for
	// a rotation in flight and then closes the pair it minted.
	tok, err := s.q.GetMcpTokenByDigest(ctx, digest(raw))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
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
	grant, err := q.GetMcpGrantForUpdate(ctx, tok.GrantID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if grant.ClientID != client.ClientID {
		return nil
	}
	if tok.Kind == "refresh" {
		_, err = q.RevokeMcpTokenFamily(ctx, tok.FamilyID)
	} else {
		_, err = q.RevokeMcpTokenByID(ctx, tok.ID)
	}
	if err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	s.metrics.IncOAuth("token_revoked")
	return nil
}

func (s *McpAuthService) issuePair(ctx context.Context, q *db.Queries, grant db.McpGrant, familyID string) (McpTokenPair, error) {
	access, err := randomToken(32)
	if err != nil {
		return McpTokenPair{}, err
	}
	refresh, err := randomToken(32)
	if err != nil {
		return McpTokenPair{}, err
	}
	access, refresh = mcpAccessPrefix+access, mcpRefreshPrefix+refresh
	now := s.now()
	for _, t := range []struct {
		kind, raw string
		ttl       time.Duration
	}{{"access", access, mcpAccessTTL}, {"refresh", refresh, mcpRefreshTTL}} {
		if _, err := q.CreateMcpToken(ctx, db.CreateMcpTokenParams{
			ID: util.NewID(), OrganizationID: grant.OrganizationID, GrantID: grant.ID, FamilyID: familyID,
			Kind: t.kind, Digest: digest(t.raw), ExpiresAt: mcpTime(now.Add(t.ttl)),
		}); err != nil {
			return McpTokenPair{}, err
		}
	}
	return McpTokenPair{AccessToken: access, RefreshToken: refresh, Scope: grant.Scope, ExpiresIn: int32(mcpAccessTTL / time.Second)}, nil
}

// revokeFamily closes every token of one family and records why, in its own
// transaction: it runs after the caller's transaction was rolled back. It
// locks the grant first (lock order everywhere: attempt, then grant, then
// token), so a rotation or mint in flight on the grant commits before the
// revocation reads the family, and its new rows are closed with the rest. It
// writes the audit row only when it closed something: a repeat has nothing
// left to record.
func (s *McpAuthService) revokeFamily(ctx context.Context, grantID, familyID, reason string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	grant, err := q.GetMcpGrantForUpdate(ctx, grantID)
	if err != nil {
		return err
	}
	n, err := q.RevokeMcpTokenFamily(ctx, familyID)
	if err != nil {
		return err
	}
	if n == 0 {
		return nil
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: grant.OrganizationID, Actor: audit.System("mcp-auth"), Action: audit.ActionMcpTokenFamilyRevoked,
		ResourceType: "mcp_grant", ResourceID: grant.ID,
		Metadata: map[string]any{"reason": reason, "family_id": familyID, "tokens": n, "user_id": grant.UserID},
	}); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	s.metrics.IncOAuth("family_revoked")
	return nil
}

// validPKCEVerifier is RFC 7636 §4.1: 43 to 128 characters from the unreserved
// set ALPHA / DIGIT / "-" / "." / "_" / "~". Clients such as Claude Code put "."
// and "~" in their verifiers, so the desktop flow's base64url-only check
// (validVerifier) would refuse most of their sign-ins with invalid_grant.
func validPKCEVerifier(v string) bool {
	if len(v) < 43 || len(v) > 128 {
		return false
	}
	for i := 0; i < len(v); i++ {
		c := v[i]
		if !(c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-' || c == '.' || c == '_' || c == '~') {
			return false
		}
	}
	return true
}
