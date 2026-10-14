package service

import (
	"context"
	"errors"
	"net/url"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

type McpAuthorizeInput struct {
	ResponseType, ClientID, RedirectURI, CodeChallenge, CodeChallengeMethod, State, Scope, Resource string
}

// McpAuthorizeError tells the handler how to answer a bad authorization
// request. RedirectURI is empty when the request must not be sent back to the
// client (unknown client or unregistered redirect URI, RFC 6749 §4.1.2.1).
type McpAuthorizeError struct {
	Code, Description, RedirectURI, State string
}

func (e *McpAuthorizeError) Error() string { return e.Code }

// Start validates an authorization request and opens an attempt. The returned
// consent URL is the web page where the signed-in person decides.
func (s *McpAuthService) Start(ctx context.Context, in McpAuthorizeInput) (string, error) {
	client, err := s.ResolveClient(ctx, in.ClientID)
	if errors.Is(err, errMcpClientUnknown) {
		return "", &McpAuthorizeError{Code: "invalid_client", Description: "unknown client"}
	}
	if err != nil {
		return "", err
	}
	if !client.allowsRedirect(in.RedirectURI) {
		return "", &McpAuthorizeError{Code: "invalid_request", Description: "redirect_uri is not registered for this client"}
	}
	fail := func(code, desc string) (string, error) {
		return "", &McpAuthorizeError{Code: code, Description: desc, RedirectURI: in.RedirectURI, State: in.State}
	}
	if in.ResponseType != "code" {
		return fail("unsupported_response_type", "response_type must be code")
	}
	if in.CodeChallengeMethod != "S256" || !validChallenge(in.CodeChallenge) {
		return fail("invalid_request", "PKCE with code_challenge_method S256 is required")
	}
	scope, ok := parseMcpScope(in.Scope)
	if !ok {
		return fail("invalid_scope", "scope must be read, write or both")
	}
	resource := in.Resource
	if resource == "" {
		resource = s.ResourceURL() // one resource only (spec §5.2 #4)
	}
	if resource != s.ResourceURL() {
		return fail("invalid_target", "unknown resource")
	}
	if len(in.State) > 512 {
		return fail("invalid_request", "state is too long")
	}
	row, err := s.q.CreateMcpAuthAttempt(ctx, db.CreateMcpAuthAttemptParams{
		ID: util.NewID(), ClientID: client.ClientID, RedirectUri: in.RedirectURI, CodeChallenge: in.CodeChallenge,
		Scope: scope, Resource: resource, State: in.State, ExpiresAt: mcpTime(s.now().Add(mcpAttemptTTL)),
	})
	if err != nil {
		return "", err
	}
	s.metrics.IncOAuth("authorize_started")
	return strings.TrimRight(s.cfg.FrontendOrigin, "/") + "/auth/connect/authorize?attempt=" + url.QueryEscape(row.ID), nil
}

type McpConsent struct {
	AttemptID      string
	Status         string // pending | approved | cancelled | expired
	Client         McpClient
	RedirectHost   string
	Scope          string
	Organizations  []McpConsentOrg
	CSRFToken      string
	WriteRequested bool // the app asked for write
}

type McpConsentOrg struct {
	ID, Slug, Name string
	Enabled        bool
	WriteEnabled   bool   // the organization lets apps write (ADR 0033)
	Reason         string // "" | "connector_disabled"
}

// Consent claims the attempt for the reader and returns a fresh CSRF token.
// GET never approves (spec §5.2): only Approve, with that token, issues a code.
func (s *McpAuthService) Consent(ctx context.Context, userID, attemptID string) (McpConsent, error) {
	csrf, err := randomToken(32)
	if err != nil {
		return McpConsent{}, err
	}
	row, err := s.q.ClaimMcpAuthAttempt(ctx, db.ClaimMcpAuthAttemptParams{
		ID: attemptID, UserID: pgtype.Text{String: userID, Valid: true}, CsrfDigest: pgtype.Text{String: digest(csrf), Valid: true},
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return s.consentState(ctx, userID, attemptID)
	}
	if err != nil {
		return McpConsent{}, err
	}
	client, err := s.ResolveClient(ctx, row.ClientID)
	if errors.Is(err, errMcpClientUnknown) {
		return McpConsent{}, mcpClientUnavailable()
	}
	if err != nil {
		return McpConsent{}, err
	}
	orgs, err := s.consentOrganizations(ctx, userID)
	if err != nil {
		return McpConsent{}, err
	}
	redirect, _ := url.Parse(row.RedirectUri)
	return McpConsent{AttemptID: row.ID, Status: "pending", Client: client, RedirectHost: redirect.Host, Scope: row.Scope, Organizations: orgs, CSRFToken: csrf, WriteRequested: mcpScopeHasWrite(row.Scope)}, nil
}

// consentState answers a reload: the owner learns how the attempt ended;
// anyone else sees nothing.
func (s *McpAuthService) consentState(ctx context.Context, userID, attemptID string) (McpConsent, error) {
	row, err := s.q.GetMcpAuthAttempt(ctx, attemptID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && row.UserID.Valid && row.UserID.String != userID) {
		return McpConsent{}, ErrNotFound
	}
	if err != nil {
		return McpConsent{}, err
	}
	status := "expired"
	switch {
	case row.ApprovedAt.Valid:
		status = "approved"
	case row.CancelledAt.Valid:
		status = "cancelled"
	}
	return McpConsent{AttemptID: row.ID, Status: status}, nil
}

func (s *McpAuthService) consentOrganizations(ctx context.Context, userID string) ([]McpConsentOrg, error) {
	rows, err := s.q.ListOrganizationsForUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	out := []McpConsentOrg{}
	for _, o := range rows {
		if _, err := s.orgs.RequireMember(ctx, o.ID, userID); err != nil {
			continue // suspended organization or deactivated member: not offered
		}
		enabled, write, err := s.orgAccess(ctx, userID, o.ID)
		if err != nil {
			return nil, err
		}
		c := McpConsentOrg{ID: o.ID, Slug: o.Slug, Name: o.Name, Enabled: enabled, WriteEnabled: write}
		if !enabled {
			c.Reason = "connector_disabled"
		}
		out = append(out, c)
	}
	return out, nil
}

// orgAccess reads both switches of the organization once: enabled is the
// connector (flag and switch), write is enabled AND the write flag AND the
// organization's write switch (ADR 0033).
func (s *McpAuthService) orgAccess(ctx context.Context, userID, orgID string) (enabled, write bool, err error) {
	if !s.flag(ctx, mcpFlagKey, userID, orgID) {
		return false, false, nil
	}
	p, err := s.q.GetOrganizationMcpPolicy(ctx, orgID)
	if err != nil {
		return false, false, err
	}
	enabled = p.McpEnabledAt.Valid
	write = enabled && p.McpWriteEnabledAt.Valid && s.flag(ctx, mcpWriteFlagKey, userID, orgID)
	return enabled, write, nil
}

func (s *McpAuthService) flagOn(ctx context.Context, userID, orgID string) bool {
	return s.flag(ctx, mcpFlagKey, userID, orgID)
}

func (s *McpAuthService) flag(ctx context.Context, key, userID, orgID string) bool {
	if s.flags == nil {
		return false
	}
	def := false
	if f, ok := featureflags.Lookup(key); ok {
		def = f.Default
	}
	ctx = featureflag.WithEvalContext(ctx, featureflag.EvalContext{UserID: userID, OrganizationID: orgID})
	return s.flags.IsEnabled(ctx, key, def)
}

// Approve records the person's consent for one organization and issues the
// authorization code. The grant, the code and the audit row commit together.
// write is the person's tick; it only counts when the app asked for write and
// the organization allows it.
func (s *McpAuthService) Approve(ctx context.Context, userID, attemptID, csrf, organizationID string, write bool) (string, error) {
	if _, err := s.orgs.RequireMember(ctx, organizationID, userID); err != nil {
		return "", err
	}
	enabled, writeOpen, err := s.orgAccess(ctx, userID, organizationID)
	if err != nil {
		return "", err
	}
	if !enabled {
		return "", errMcpConnectorDisabled()
	}
	code, err := randomToken(32)
	if err != nil {
		return "", err
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	row, err := s.lockOwnAttempt(ctx, q, userID, attemptID, csrf)
	if err != nil {
		return "", err
	}
	// Write needs all three: the app asked, the person ticked, the
	// organization allows it. Anything less is a read grant (RFC 6749 §3.3
	// lets the server issue less than was asked).
	scope := mcpScopeRead
	if write && writeOpen && mcpScopeHasWrite(row.Scope) {
		scope = mcpScopeReadWrite
	}
	grant, err := q.GetActiveMcpGrant(ctx, db.GetActiveMcpGrantParams{OrganizationID: organizationID, UserID: userID, ClientID: row.ClientID})
	created := false
	if errors.Is(err, pgx.ErrNoRows) {
		grant, err = q.CreateMcpGrant(ctx, db.CreateMcpGrantParams{
			ID: util.NewID(), OrganizationID: organizationID, UserID: userID, ClientID: row.ClientID,
			Scope: scope, CreatedBy: userID, CreatedByKind: string(audit.KindHuman),
		})
		created = true
	}
	if err != nil {
		return "", err
	}
	if !created && grant.Scope != scope {
		// The person's latest answer is the grant's scope, up or down.
		before := grant.Scope
		if grant, err = q.SetMcpGrantScope(ctx, db.SetMcpGrantScopeParams{ID: grant.ID, Scope: scope}); err != nil {
			return "", err
		}
		if err := auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: organizationID, Actor: Human(userID), Action: audit.ActionMcpGrantScopeChanged,
			ResourceType: "mcp_grant", ResourceID: grant.ID, Metadata: map[string]any{"client_id": row.ClientID},
			Changes: audit.Diff(map[string]any{"scope": before}, map[string]any{"scope": scope}),
		}); err != nil {
			return "", err
		}
	}
	if _, err := q.ApproveMcpAuthAttempt(ctx, db.ApproveMcpAuthAttemptParams{
		ID: row.ID, GrantID: pgtype.Text{String: grant.ID, Valid: true},
		CodeDigest: pgtype.Text{String: digest(code), Valid: true}, CodeExpiresAt: mcpTime(s.now().Add(mcpCodeTTL)),
	}); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// The attempt lapsed between the row lock and this update (the
			// query checks expiry against the database clock).
			return "", mcpAttemptExpired()
		}
		return "", err
	}
	if created {
		if err := auditRecorder.Record(ctx, q, audit.Entry{
			OrganizationID: organizationID, Actor: Human(userID), Action: audit.ActionMcpGrantCreated,
			ResourceType: "mcp_grant", ResourceID: grant.ID, Metadata: map[string]any{"client_id": row.ClientID, "scope": scope},
		}); err != nil {
			return "", err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	s.metrics.IncOAuth("consent_approved")
	return mcpRedirect(row.RedirectUri, url.Values{"code": {code}, "state": {row.State}, "iss": {s.Issuer()}})
}

// Cancel ends the attempt with access_denied; it needs the same CSRF token as
// Approve, so a page the person never saw cannot cancel on their behalf.
func (s *McpAuthService) Cancel(ctx context.Context, userID, attemptID, csrf string) (string, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	row, err := s.lockOwnAttempt(ctx, q, userID, attemptID, csrf)
	if err != nil {
		return "", err
	}
	if err := q.CancelMcpAuthAttempt(ctx, row.ID); err != nil {
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	s.metrics.IncOAuth("consent_cancelled")
	return mcpRedirect(row.RedirectUri, url.Values{"error": {"access_denied"}, "state": {row.State}, "iss": {s.Issuer()}})
}

// lockOwnAttempt locks a pending attempt the caller claimed and whose CSRF
// token matches; every miss reads as the same CSRF error.
func (s *McpAuthService) lockOwnAttempt(ctx context.Context, q *db.Queries, userID, attemptID, csrf string) (db.McpAuthAttempt, error) {
	row, err := q.GetMcpAuthAttemptForUpdate(ctx, attemptID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.McpAuthAttempt{}, mcpCSRFError()
	}
	if err != nil {
		return db.McpAuthAttempt{}, err
	}
	if !row.UserID.Valid || row.UserID.String != userID || !row.CsrfDigest.Valid || !secureDigestEqual(row.CsrfDigest.String, digest(csrf)) {
		return db.McpAuthAttempt{}, mcpCSRFError()
	}
	if row.ApprovedAt.Valid || row.CancelledAt.Valid || !row.ExpiresAt.Time.After(s.now()) {
		return db.McpAuthAttempt{}, mcpAttemptExpired()
	}
	return row, nil
}

// mcpRedirect adds parameters to the client's redirect URI, keeping any query
// it was registered with (Review Focus 3). An empty state is left out.
func mcpRedirect(base string, add url.Values) (string, error) {
	u, err := url.Parse(base)
	if err != nil {
		return "", err
	}
	q := u.Query()
	for k, v := range add {
		if len(v) == 0 || v[0] == "" {
			continue
		}
		q[k] = v
	}
	u.RawQuery = q.Encode()
	return u.String(), nil
}
