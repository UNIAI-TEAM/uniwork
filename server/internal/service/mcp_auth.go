package service

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/config"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// McpAuthService is UniWork's OAuth 2.1 authorization server for external MCP
// clients (spec 2026-10-12-mcp-connector, ADR 0031). It issues opaque tokens
// that only /mcp accepts; it never mints a session JWT.
type McpAuthService struct {
	pool    *pgxpool.Pool
	q       *db.Queries
	orgs    *OrganizationService
	cfg     config.Config
	fetch   ClientMetadataFetcher
	flags   McpFlags
	metrics McpMetrics
	now     func() time.Time
}

// McpFlags is the slice of the feature-flag service this service reads.
type McpFlags interface {
	IsEnabled(ctx context.Context, key string, defaultVal bool) bool
}

// McpMetrics is the port metrics.Mcp implements; labels never carry ids.
type McpMetrics interface {
	IncOAuth(event string)
	ObserveTool(tool, outcome string, d time.Duration)
}

type nopMcpMetrics struct{}

func (nopMcpMetrics) IncOAuth(string)                           {}
func (nopMcpMetrics) ObserveTool(string, string, time.Duration) {}

const (
	mcpScopeRead     = "read"
	mcpFlagKey       = "mcp_connector"
	mcpCodeTTL       = 120 * time.Second
	mcpAttemptTTL    = 10 * time.Minute
	mcpAccessTTL     = time.Hour
	mcpRefreshTTL    = 30 * 24 * time.Hour
	mcpReuseGrace    = 10 * time.Second
	mcpAccessPrefix  = "uwm_at_"
	mcpRefreshPrefix = "uwm_rt_"
)

func NewMcpAuthService(pool *pgxpool.Pool, q *db.Queries, orgs *OrganizationService, cfg config.Config) *McpAuthService {
	return &McpAuthService{pool: pool, q: q, orgs: orgs, cfg: cfg, metrics: nopMcpMetrics{}, now: time.Now}
}

func (s *McpAuthService) SetFlags(f McpFlags)                { s.flags = f }
func (s *McpAuthService) SetFetcher(f ClientMetadataFetcher) { s.fetch = f }

func (s *McpAuthService) SetMetrics(m McpMetrics) {
	if m == nil {
		m = nopMcpMetrics{}
	}
	s.metrics = m
}

// Metrics is the port the /mcp transport counts tool calls on.
func (s *McpAuthService) Metrics() McpMetrics { return s.metrics }

// Issuer is the OAuth issuer and the origin every MCP URL hangs off.
func (s *McpAuthService) Issuer() string { return strings.TrimRight(s.cfg.APIPublicURL, "/") }

// ResourceURL is the one protected resource (RFC 8707).
func (s *McpAuthService) ResourceURL() string { return s.Issuer() + "/mcp" }

// OAuthError is an RFC 6749 error; handlers write it as
// {"error": Code, "error_description": Description}.
type OAuthError struct {
	Code        string
	Description string
	Status      int
}

func (e OAuthError) Error() string { return e.Code + ": " + e.Description }

func oauthErr(status int, code, desc string) error {
	return OAuthError{Code: code, Description: desc, Status: status}
}

var errInvalidGrant = OAuthError{Code: "invalid_grant", Description: "the authorization grant is invalid, expired or revoked", Status: http.StatusBadRequest}

var (
	ErrMcpCSRF              = errors.New("csrf_invalid")
	ErrMcpAttemptExpired    = errors.New("attempt_expired")
	ErrMcpClientUnavailable = errors.New("client_unavailable")
	ErrMcpConnectorDisabled = errors.New("connector_disabled")
	ErrMcpTokenInvalid      = errors.New("invalid_token")
)

func mcpCSRFError() error {
	return CodedError{Code: "csrf_invalid", Status: http.StatusBadRequest, Msg: "consent confirmation is invalid", Err: ErrMcpCSRF}
}

func mcpAttemptExpired() error {
	return CodedError{Code: "attempt_expired", Status: http.StatusGone, Msg: "yêu cầu kết nối đã hết hạn; hãy bắt đầu lại từ ứng dụng AI", Err: ErrMcpAttemptExpired}
}

// mcpClientUnavailable is what the consent page hears when the client that
// opened the attempt is gone by the time the person reads it (its metadata
// document withdrawn, a registered client swept). Start refuses an unknown
// client before any attempt exists, so this only happens in between.
func mcpClientUnavailable() error {
	return CodedError{Code: "client_unavailable", Status: http.StatusGone, Msg: "ứng dụng AI này không còn khả dụng; hãy bắt đầu lại từ ứng dụng AI", Err: ErrMcpClientUnavailable}
}

func errMcpConnectorDisabled() error {
	return CodedError{Code: "connector_disabled", Status: http.StatusForbidden, Msg: "tổ chức chưa bật kết nối trợ lý AI bên ngoài", Err: ErrMcpConnectorDisabled}
}

func mcpTime(t time.Time) pgtype.Timestamptz { return pgtype.Timestamptz{Time: t, Valid: true} }
