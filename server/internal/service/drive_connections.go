package service

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/oauth2"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/util"
	"github.com/unicomhub/uniwork/server/internal/util/secretbox"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
	"github.com/unicomhub/uniwork/server/pkg/featureflag"
)

const (
	// driveOAuthStateTTL bounds one Google Drive OAuth flow: both the sealed
	// state and the HttpOnly nonce cookie expire after 10 minutes (spec §5.2).
	driveOAuthStateTTL = 10 * time.Minute
	// driveOAuthExchangeTimeout bounds the token exchange and id_token check.
	driveOAuthExchangeTimeout = 10 * time.Second
)

// Google Drive OAuth callback result codes (spec §5.2).
const (
	DriveOAuthConnected               = "connected"
	DriveOAuthReconnected             = "reconnected"
	DriveOAuthConsentRequired         = "consent_required"
	DriveOAuthScopeNotGranted         = "scope_not_granted"
	DriveOAuthAccountMismatch         = "account_mismatch"
	DriveOAuthStateInvalid            = "state_invalid"
	DriveOAuthRetryConnect            = "retry_connect"
	DriveOAuthBlockedByWorkspaceAdmin = "blocked_by_workspace_admin"
	DriveOAuthAccessDenied            = "access_denied"
	DriveOAuthProviderError           = "provider_error"
)

// Google Drive connection status values (spec §5.3).
const (
	DriveConnectionStatusActive         = "active"
	DriveConnectionStatusNeedsReconnect = "needs_reconnect"
)

const driveErrFeatureDisabled = "feature_disabled"

var (
	// ErrDriveNotConfigured answers 503 when the Google Drive OAuth client or
	// DRIVE_CREDENTIAL_KEY is not configured on the server.
	ErrDriveNotConfigured = errors.New("drive connector not configured")
	// ErrDriveReauthRequired answers when a connection's refresh token was
	// refused (auth_failed_at set) or the connection was disconnected.
	ErrDriveReauthRequired = errors.New("drive connection requires reconnect")
	// errDriveRetryConnect indicates a concurrent or overlapping revocation for
	// the same google_sub prevents saving the callback's grant (spec §5.3b).
	errDriveRetryConnect = errors.New("drive connect retry required")
)

func errDriveFeatureDisabled() error {
	return coded(404, driveErrFeatureDisabled, "tính năng Google Drive đang tắt")
}

// DriveMetrics records Prometheus counters for the Google Drive connector.
type DriveMetrics interface {
	ObserveTokenRefreshFailure()
	ObserveRevocationAbandoned()
}

// DriveConnectionView is the service-layer representation of one connected
// Google Drive account in the caller's organization (spec §5.3, §6.1).
type DriveConnectionView struct {
	ID               string
	Provider         string
	GoogleEmail      string
	Status           string
	NeedsReconnect   bool
	AuthFailedAt     *time.Time
	AuthFailedReason string
	LinkedFileCount  int
	ConnectedAt      time.Time
	UpdatedAt        time.Time
}

// driveOAuthState is sealed with DRIVE_CREDENTIAL_KEY into the OAuth state
// query parameter. The PKCE verifier and OIDC nonce live only here, never in
// a URL or cookie (spec §5.2).
type driveOAuthState struct {
	UserID             string `json:"user_id"`
	OrganizationID     string `json:"organization_id"`
	WorkspaceID        string `json:"workspace_id"`
	Provider           string `json:"provider"`
	CookieNonce        string `json:"cookie_nonce"`
	OIDCNonce          string `json:"oidc_nonce"`
	Verifier           string `json:"verifier"`
	TargetConnectionID string `json:"target_connection_id,omitempty"`
	ExpectedSub        string `json:"expected_sub,omitempty"`
	Exp                int64  `json:"exp"`
}

// DriveConnectionService manages Google Drive OAuth connections, token refresh,
// disconnection, lifecycle cleanup, and the §5.3b global grant revocation queue.
type DriveConnectionService struct {
	pool         *pgxpool.Pool
	q            *db.Queries
	ws           *WorkspaceService
	box          *secretbox.Box
	flags        *featureflag.Service
	log          *slog.Logger
	provider     DriveProvider
	metrics      DriveMetrics
	refreshLocks sync.Map // connectionID -> *sync.Mutex
	now          func() time.Time

	// Test hooks for deterministic §5.3b race tests.
	testBeforeCallbackTx       func(sub string)
	testAfterCallbackGrantLock func(sub string)
	testBeforeDisconnectRow    func(sub string)
	testAfterRevocationClaimTx func(sub string, attempt db.DriveGrantRevocation)
	testAfterRevokeGoogle      func(sub string, attempt db.DriveGrantRevocation, revokeErr error) error
	testBeforeResolveTx        func(sub string, generation int64, attemptID string) error
}

// NewDriveConnectionService constructs a DriveConnectionService. box may be nil
// when DRIVE_CREDENTIAL_KEY is unset; ConfigureProvider then leaves the
// provider disabled.
func NewDriveConnectionService(pool *pgxpool.Pool, q *db.Queries, ws *WorkspaceService, box *secretbox.Box) *DriveConnectionService {
	var poolRef *pgxpool.Pool
	if pool != nil {
		poolRef = pool
	} else if ws != nil {
		poolRef = ws.pool
	}
	return &DriveConnectionService{
		pool: poolRef,
		q:    q,
		ws:   ws,
		box:  box,
		log:  slog.Default(),
		now:  time.Now,
	}
}

// SetLogger sets the structured logger (never logs email addresses or tokens).
func (s *DriveConnectionService) SetLogger(log *slog.Logger) {
	if log != nil {
		s.log = log
	}
}

// SetFlags wires the feature flag service used to evaluate drive_connector.
func (s *DriveConnectionService) SetFlags(flags *featureflag.Service) {
	s.flags = flags
}

// SetMetrics wires the Prometheus metrics collector.
func (s *DriveConnectionService) SetMetrics(m DriveMetrics) {
	s.metrics = m
}

// SetProvider overrides the DriveProvider (used by unit and integration tests).
func (s *DriveConnectionService) SetProvider(p DriveProvider) {
	s.provider = p
}

// Provider returns the active DriveProvider, or nil when not configured.
func (s *DriveConnectionService) Provider() DriveProvider {
	if s == nil {
		return nil
	}
	return s.provider
}

// ConfigureOAuth configures the Google Drive provider from cfg. As required by
// spec §5.1, the provider is available only when GOOGLE_DRIVE_CLIENT_ID,
// GOOGLE_DRIVE_CLIENT_SECRET and DRIVE_CREDENTIAL_KEY (s.box != nil) are all
// set — except in non-production when DRIVE_FAKE_PROVIDER=1 is explicitly set
// with a credential box.
func (s *DriveConnectionService) ConfigureOAuth(cfg config.Config) {
	if s == nil || s.box == nil {
		return
	}
	if !strings.EqualFold(cfg.AppEnv, "production") && cfg.DriveFakeProvider {
		if cfg.GoogleDriveClientID == "" && cfg.GoogleDriveClientSecret == "" {
			cfg.GoogleDriveClientID = "fake-cid"
			cfg.GoogleDriveClientSecret = "fake-sec"
		}
		if cfg.GoogleDriveClientID == "" || cfg.GoogleDriveClientSecret == "" {
			s.provider = nil
			return
		}
		s.provider = NewFakeDriveProvider(cfg)
		return
	}
	if cfg.GoogleDriveClientID == "" || cfg.GoogleDriveClientSecret == "" {
		s.provider = nil
		return
	}
	s.provider = NewGoogleDriveProvider(cfg)
}

// Available reports whether the server has both the credential secretbox and a
// configured Google Drive OAuth provider (spec §5.1, §10).
func (s *DriveConnectionService) Available() bool {
	return s != nil && s.box != nil && s.provider != nil
}

// AvailableForContext reports whether the Drive connector is available for the
// caller's feature-flag context: both Available() AND drive_connector flag on.
func (s *DriveConnectionService) AvailableForContext(ctx context.Context) bool {
	if !s.Available() {
		return false
	}
	return s.flagEnabled(ctx)
}

func (s *DriveConnectionService) flagEnabled(ctx context.Context) bool {
	if s == nil || s.flags == nil {
		// Default of drive_connector in featureflags.Catalogue() is false.
		return false
	}
	return s.flags.IsEnabled(ctx, "drive_connector", false)
}

func (s *DriveConnectionService) flagEnabledForMember(ctx context.Context, userID, orgID string) bool {
	if s == nil || s.flags == nil {
		return false
	}
	ec := featureflag.EvalContext{UserID: userID, OrganizationID: orgID}
	return s.flags.IsEnabled(featureflag.WithEvalContext(ctx, ec), "drive_connector", false)
}

func (s *DriveConnectionService) workspace(ctx context.Context, actor Actor, workspaceID string) (db.Workspace, error) {
	if err := s.ws.requireActorMember(ctx, workspaceID, actor); err != nil {
		return db.Workspace{}, err
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Workspace{}, ErrNotFound
	}
	return ws, err
}

// FlagOrganization resolves the organization of workspaceID when userID is a
// member of it, so mw.FlagOrganization + mw.RequireFeatureFlag("drive_connector")
// honours organization-scoped flag overrides without leaking another tenant's
// flag state to non-members.
func (s *DriveConnectionService) FlagOrganization(ctx context.Context, userID, workspaceID string) string {
	if s == nil || s.ws == nil || s.q == nil || userID == "" || workspaceID == "" {
		return ""
	}
	if err := s.ws.requireActorMember(ctx, workspaceID, Human(userID)); err != nil {
		return ""
	}
	ws, err := s.q.GetWorkspaceByID(ctx, workspaceID)
	if err != nil {
		return ""
	}
	return ws.OrganizationID
}

func (s *DriveConnectionService) nowUTC() time.Time {
	if s != nil && s.now != nil {
		return s.now().UTC()
	}
	return time.Now().UTC()
}

// sealSecret encrypts v with DRIVE_CREDENTIAL_KEY and returns base64 text.
func (s *DriveConnectionService) sealSecret(v string) (string, error) {
	if s == nil || s.box == nil {
		return "", ErrDriveNotConfigured
	}
	sealed, err := s.box.Seal([]byte(v))
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(sealed), nil
}

// openSecret decrypts a base64 secretbox value sealed with DRIVE_CREDENTIAL_KEY.
func (s *DriveConnectionService) openSecret(enc string) (string, error) {
	if s == nil || s.box == nil {
		return "", ErrDriveNotConfigured
	}
	raw, err := base64.StdEncoding.DecodeString(enc)
	if err != nil {
		return "", err
	}
	plain, err := s.box.Open(raw)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}

// StartOAuth begins a Google Drive OAuth flow for the caller in the workspace's
// organization (spec §5.2). Membership is checked first so an outsider learns
// nothing about feature flags or OAuth configuration. When reconnectConnectionID
// is non-empty, it must name an existing active/needs-reconnect connection of
// the caller in that organization; the sealed state binds target_connection_id
// and expected_sub and passes login_hint=<google_email>.
func (s *DriveConnectionService) StartOAuth(ctx context.Context, actor Actor, workspaceID, reconnectConnectionID string) (authURL, cookieNonce string, err error) {
	ws, err := s.workspace(ctx, actor, workspaceID)
	if err != nil {
		return "", "", err
	}
	if !s.flagEnabledForMember(ctx, actor.ID, ws.OrganizationID) {
		return "", "", errDriveFeatureDisabled()
	}
	if !s.Available() {
		return "", "", ErrDriveNotConfigured
	}

	reconnectConnectionID = strings.TrimSpace(reconnectConnectionID)
	var expectedSub, loginHint string
	prompt := "consent select_account"
	if reconnectConnectionID != "" {
		conn, err := s.q.GetDriveConnection(ctx, db.GetDriveConnectionParams{
			ID:             reconnectConnectionID,
			OrganizationID: ws.OrganizationID,
			UserID:         actor.ID,
		})
		if errors.Is(err, pgx.ErrNoRows) {
			return "", "", ErrNotFound
		}
		if err != nil {
			return "", "", err
		}
		expectedSub = conn.GoogleSub
		loginHint = conn.GoogleEmail
		prompt = "consent"
	}

	cookieRaw := make([]byte, 32)
	if _, err := rand.Read(cookieRaw); err != nil {
		return "", "", err
	}
	cookieNonce = base64.RawURLEncoding.EncodeToString(cookieRaw)

	oidcRaw := make([]byte, 32)
	if _, err := rand.Read(oidcRaw); err != nil {
		return "", "", err
	}
	oidcNonce := base64.RawURLEncoding.EncodeToString(oidcRaw)

	verifier := oauth2.GenerateVerifier()
	st := driveOAuthState{
		UserID:             actor.ID,
		OrganizationID:     ws.OrganizationID,
		WorkspaceID:        workspaceID,
		Provider:           "google",
		CookieNonce:        cookieNonce,
		OIDCNonce:          oidcNonce,
		Verifier:           verifier,
		TargetConnectionID: reconnectConnectionID,
		ExpectedSub:        expectedSub,
		Exp:                s.nowUTC().Add(driveOAuthStateTTL).Unix(),
	}
	sealedState, err := s.sealOAuthState(st)
	if err != nil {
		return "", "", err
	}
	challenge := oauth2.S256ChallengeFromVerifier(verifier)
	u := s.provider.AuthCodeURL(sealedState, challenge, prompt, loginHint)
	if u != "" && oidcNonce != "" && !strings.Contains(u, "nonce=") {
		sep := "?"
		if strings.Contains(u, "?") {
			sep = "&"
		}
		u += sep + "nonce=" + oidcNonce
	}
	return u, cookieNonce, nil
}

func (s *DriveConnectionService) sealOAuthState(st driveOAuthState) (string, error) {
	if s == nil || s.box == nil {
		return "", ErrDriveNotConfigured
	}
	plain, err := json.Marshal(st)
	if err != nil {
		return "", err
	}
	sealed, err := s.box.Seal(plain)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(sealed), nil
}

func (s *DriveConnectionService) openOAuthState(raw string) (driveOAuthState, bool) {
	if s == nil || s.box == nil || raw == "" {
		return driveOAuthState{}, false
	}
	sealed, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return driveOAuthState{}, false
	}
	plain, err := s.box.Open(sealed)
	if err != nil {
		return driveOAuthState{}, false
	}
	var st driveOAuthState
	if json.Unmarshal(plain, &st) != nil || st.CookieNonce == "" || st.OIDCNonce == "" || st.Verifier == "" || s.nowUTC().Unix() > st.Exp {
		return driveOAuthState{}, false
	}
	return st, true
}

// CompleteOAuth handles GET /api/v1/drive-connections/google/callback and
// returns one of the sdo.DriveOAuth* result codes for the popup HTML page
// (spec §5.2, §5.3, §5.3b, §5.7).
func (s *DriveConnectionService) CompleteOAuth(ctx context.Context, rawState, code, providerError, errorSubtype, cookieNonce string) string {
	ctx = context.WithoutCancel(ctx)
	userID := ""
	fail := func(result, reason string) string {
		s.log.Warn("drive oauth callback failed",
			"code", result, "reason", reason, "user_id", userID)
		return result
	}
	if !s.Available() {
		return fail(DriveOAuthProviderError, "not_configured")
	}
	st, ok := s.openOAuthState(rawState)
	if !ok || st.Provider != "google" {
		return fail(DriveOAuthStateInvalid, "state")
	}
	if cookieNonce == "" || subtle.ConstantTimeCompare([]byte(cookieNonce), []byte(st.CookieNonce)) != 1 {
		return fail(DriveOAuthStateInvalid, "nonce")
	}
	userID = st.UserID

	// Re-verify membership via the workspace in state before spending the code
	// or writing any audit row (spec §5.2 step 4).
	actor := Human(st.UserID)
	ws, err := s.workspace(ctx, actor, st.WorkspaceID)
	if err != nil || ws.OrganizationID != st.OrganizationID {
		return fail(DriveOAuthProviderError, "membership")
	}
	if !s.flagEnabledForMember(ctx, st.UserID, ws.OrganizationID) {
		return fail(DriveOAuthProviderError, "feature_disabled")
	}

	if providerError != "" {
		if isGoogleWorkspaceAdminBlock(providerError, errorSubtype) {
			s.recordCallbackRefused(ctx, ws.OrganizationID, ws.ID, actor, st.TargetConnectionID, DriveOAuthBlockedByWorkspaceAdmin, "", "")
			return fail(DriveOAuthBlockedByWorkspaceAdmin, "blocked_by_workspace_admin")
		}
		if providerError == "access_denied" {
			return fail(DriveOAuthAccessDenied, "access_denied")
		}
		return fail(DriveOAuthProviderError, "provider_error")
	}

	if st.TargetConnectionID != "" {
		target, err := s.q.GetDriveConnection(ctx, db.GetDriveConnectionParams{
			ID:             st.TargetConnectionID,
			OrganizationID: ws.OrganizationID,
			UserID:         st.UserID,
		})
		if err != nil || target.GoogleSub != st.ExpectedSub {
			return fail(DriveOAuthStateInvalid, "target_connection")
		}
	}

	// Record exchange_started_at BEFORE exchanging the authorization code so
	// §5.3b can detect any revoke attempt that started or finished after this
	// point (spec §5.3b Callback).
	exchangeStartedAt := s.nowUTC()

	exchangeCtx, cancel := context.WithTimeout(ctx, driveOAuthExchangeTimeout)
	defer cancel()
	tok, err := s.provider.Exchange(exchangeCtx, code, st.Verifier)
	if err != nil {
		reason := "exchange"
		var re *oauth2.RetrieveError
		if errors.As(err, &re) {
			if isGoogleWorkspaceAdminBlock(re.ErrorCode, "") {
				s.recordCallbackRefused(ctx, ws.OrganizationID, ws.ID, actor, st.TargetConnectionID, DriveOAuthBlockedByWorkspaceAdmin, "", "")
				return fail(DriveOAuthBlockedByWorkspaceAdmin, "blocked_by_workspace_admin")
			}
			switch re.ErrorCode {
			case "invalid_grant", "invalid_client", "invalid_request", "unauthorized_client", "unsupported_grant_type":
				reason = "exchange_" + re.ErrorCode
			}
		}
		return fail(DriveOAuthProviderError, reason)
	}

	claims, err := s.provider.VerifyIDToken(exchangeCtx, tok.IDToken, st.OIDCNonce)
	if err != nil {
		return fail(DriveOAuthProviderError, "id_token")
	}

	if !driveScopesInclude(tok.Scopes, DriveGoogleScope) {
		s.recordCallbackRefused(ctx, ws.OrganizationID, ws.ID, actor, st.TargetConnectionID, DriveOAuthScopeNotGranted, claims.Sub, claims.Email)
		return fail(DriveOAuthScopeNotGranted, "scope_not_granted")
	}

	if st.ExpectedSub != "" && claims.Sub != st.ExpectedSub {
		s.recordCallbackRefused(ctx, ws.OrganizationID, ws.ID, actor, st.TargetConnectionID, DriveOAuthAccountMismatch, claims.Sub, claims.Email)
		return fail(DriveOAuthAccountMismatch, "account_mismatch")
	}

	if tok.RefreshToken == "" || tok.AccessToken == "" {
		return fail(DriveOAuthConsentRequired, "no_refresh_token")
	}

	refreshEnc, err := s.sealSecret(tok.RefreshToken)
	if err != nil {
		return fail(DriveOAuthProviderError, "seal")
	}
	accessEnc, err := s.sealSecret(tok.AccessToken)
	if err != nil {
		return fail(DriveOAuthProviderError, "seal")
	}
	expiresAt := pgtype.Timestamptz{Time: tok.Expiry.UTC(), Valid: !tok.Expiry.IsZero()}

	if s.testBeforeCallbackTx != nil {
		s.testBeforeCallbackTx(claims.Sub)
	}

	reconnected, err := s.saveDriveConnection(ctx, ws.OrganizationID, ws.ID, actor, st, claims, refreshEnc, accessEnc, expiresAt, tok.Scopes, exchangeStartedAt)
	if errors.Is(err, errDriveRetryConnect) {
		return fail(DriveOAuthRetryConnect, "retry_connect")
	}
	if err != nil {
		return fail(DriveOAuthProviderError, "save")
	}
	if reconnected {
		return DriveOAuthReconnected
	}
	return DriveOAuthConnected
}

func isGoogleWorkspaceAdminBlock(errCode, errSubtype string) bool {
	if errCode == "admin_policy_enforced" || errCode == "org_internal" {
		return true
	}
	if errCode == "access_denied" && (errSubtype == "admin_policy_enforced" || errSubtype == "org_internal") {
		return true
	}
	return false
}

func (s *DriveConnectionService) recordCallbackRefused(ctx context.Context, orgID, wsID string, actor Actor, targetConnID, reason, googleSub, googleEmail string) {
	if s.pool == nil {
		return
	}
	resourceID := targetConnID
	if resourceID == "" {
		resourceID = actor.ID
	}
	meta := map[string]any{
		"reason":       reason,
		"google_sub":   googleSub,
		"google_email": googleEmail,
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)
	if err := auditRecorder.Record(ctx, qtx, audit.Entry{
		OrganizationID: orgID,
		WorkspaceID:    wsID,
		Actor:          actor,
		Action:         audit.ActionDriveConnectionRefused,
		ResourceType:   "drive_connection",
		ResourceID:     resourceID,
		Metadata:       meta,
	}); err != nil {
		return
	}
	_ = tx.Commit(ctx)
}

// saveDriveConnection executes the callback transaction under the global
// drive_grant:<google_sub> advisory lock (spec §5.3, §5.3b).
func (s *DriveConnectionService) saveDriveConnection(
	ctx context.Context,
	orgID, wsID string,
	actor Actor,
	st driveOAuthState,
	claims DriveIDTokenClaims,
	refreshEnc, accessEnc string,
	expiresAt pgtype.Timestamptz,
	scopes string,
	exchangeStartedAt time.Time,
) (reconnected bool, err error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)

	// 1. Serialize with lifecycle transitions (Leave / Deactivate / Close /
	// DeleteAccount) and re-check workspace membership inside this transaction
	// before acquiring grant/row locks or modifying any state (R1-1, ADR 0032).
	if err := lockMembership(ctx, qtx, actor.ID); err != nil {
		return false, err
	}
	wsMember, err := s.ws.RequireMemberQ(ctx, qtx, wsID, actor.ID)
	if err != nil {
		return false, err
	}
	if wsMember.OrganizationID != orgID {
		return false, ErrForbidden
	}

	// 2. Acquire global transaction-scoped advisory lock for google_sub (spec §5.3b).
	if err := qtx.LockDriveGrantSub(ctx, claims.Sub); err != nil {
		return false, err
	}
	if s.testAfterCallbackGrantLock != nil {
		s.testAfterCallbackGrantLock(claims.Sub)
	}
	// 2. Check drive_grant_revocations state for google_sub.
	rev, err := qtx.GetDriveGrantRevocationForUpdate(ctx, claims.Sub)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return false, err
	}
	if err == nil {
		// In-flight attempt (attempt_id IS NOT NULL AND resolved_at IS NULL) -> retry_connect.
		if rev.AttemptID.Valid && !rev.ResolvedAt.Valid {
			return false, errDriveRetryConnect
		}
		// Any state where last_attempt_started_at or last_resolved_at is after
		// exchange_started_at -> retry_connect (a Google revoke started or
		// completed after this callback began exchanging its code).
		if (rev.LastAttemptStartedAt.Valid && !rev.LastAttemptStartedAt.Time.Before(exchangeStartedAt)) ||
			(rev.LastResolvedAt.Valid && !rev.LastResolvedAt.Time.Before(exchangeStartedAt)) {
			return false, errDriveRetryConnect
		}
		// Pending row (attempt_id IS NULL and refresh_token_enc IS NOT NULL):
		// clear token while preserving evidence timestamps (spec §5.3b).
		if !rev.AttemptID.Valid && rev.RefreshTokenEnc.Valid {
			if err := qtx.CancelPendingDriveGrantRevocation(ctx, claims.Sub); err != nil {
				return false, err
			}
		}
	}

	// 3. Lock existing (organization_id, user_id, google_sub) row across all states.
	existing, err := qtx.GetDriveConnectionByOrgUserSubForUpdate(ctx, db.GetDriveConnectionByOrgUserSubForUpdateParams{
		OrganizationID: orgID,
		UserID:         actor.ID,
		GoogleSub:      claims.Sub,
	})
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return false, err
	}
	hasExisting := err == nil
	if st.TargetConnectionID != "" && (!hasExisting || existing.ID != st.TargetConnectionID) {
		return false, ErrNotFound
	}

	var row db.DriveConnection
	if hasExisting {
		reconnected = true
		row, err = qtx.ReviveDriveConnection(ctx, db.ReviveDriveConnectionParams{
			ID:              existing.ID,
			OrganizationID:  orgID,
			UserID:          actor.ID,
			GoogleEmail:     claims.Email,
			RefreshTokenEnc: refreshEnc,
			AccessTokenEnc:  accessEnc,
			AccessExpiresAt: expiresAt,
			Scopes:          scopes,
		})
		if err != nil {
			return false, err
		}
	} else {
		row, err = qtx.CreateDriveConnection(ctx, db.CreateDriveConnectionParams{
			ID:              util.NewID(),
			OrganizationID:  orgID,
			UserID:          actor.ID,
			Provider:        "google",
			GoogleSub:       claims.Sub,
			GoogleEmail:     claims.Email,
			RefreshTokenEnc: refreshEnc,
			AccessTokenEnc:  accessEnc,
			AccessExpiresAt: expiresAt,
			Scopes:          scopes,
		})
		if err != nil {
			return false, err
		}
	}

	action := audit.ActionDriveConnectionConnected
	if reconnected {
		action = audit.ActionDriveConnectionReconnected
	}
	if err := auditRecorder.Record(ctx, qtx, audit.Entry{
		OrganizationID: orgID,
		WorkspaceID:    wsID,
		Actor:          actor,
		Action:         action,
		ResourceType:   "drive_connection",
		ResourceID:     row.ID,
		Metadata: map[string]any{
			"google_email": row.GoogleEmail,
			"google_sub":   row.GoogleSub,
			"reconnected":  reconnected,
		},
	}, audit.Event{
		Topic:   "drive_connection.changed",
		Version: 1,
		Payload: map[string]string{
			"connection_id": row.ID,
			"user_id":       row.UserID,
		},
	}); err != nil {
		return false, err
	}

	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	return reconnected, nil
}

// List returns the caller's active and needs-reconnect Google Drive connections
// in the workspace's organization (spec §5.3).
func (s *DriveConnectionService) List(ctx context.Context, actor Actor, workspaceID string) ([]DriveConnectionView, error) {
	ws, err := s.workspace(ctx, actor, workspaceID)
	if err != nil {
		return nil, err
	}
	if !s.flagEnabledForMember(ctx, actor.ID, ws.OrganizationID) {
		return nil, errDriveFeatureDisabled()
	}
	rows, err := s.q.ListDriveConnectionsByUser(ctx, db.ListDriveConnectionsByUserParams{
		OrganizationID: ws.OrganizationID,
		UserID:         actor.ID,
	})
	if err != nil {
		return nil, err
	}
	out := make([]DriveConnectionView, 0, len(rows))
	for _, r := range rows {
		out = append(out, driveConnectionView(r))
	}
	return out, nil
}

func driveConnectionView(r db.DriveConnection) DriveConnectionView {
	status := DriveConnectionStatusActive
	needsReconnect := r.AuthFailedAt.Valid
	var authFailedAt *time.Time
	if needsReconnect {
		status = DriveConnectionStatusNeedsReconnect
		t := r.AuthFailedAt.Time.UTC()
		authFailedAt = &t
	}
	return DriveConnectionView{
		ID:               r.ID,
		Provider:         r.Provider,
		GoogleEmail:      r.GoogleEmail,
		Status:           status,
		NeedsReconnect:   needsReconnect,
		AuthFailedAt:     authFailedAt,
		AuthFailedReason: r.AuthFailedReason,
		LinkedFileCount:  0,
		ConnectedAt:      r.CreatedAt.Time.UTC(),
		UpdatedAt:        r.UpdatedAt.Time.UTC(),
	}
}

// Disconnect disconnects one Drive connection of the caller in the workspace's
// organization, moves its encrypted refresh token into drive_grant_revocations
// under the global drive_grant:<google_sub> lock, and records the audit + outbox
// event in the same transaction (spec §5.3, §5.3b).
func (s *DriveConnectionService) Disconnect(ctx context.Context, actor Actor, workspaceID, driveConnectionID string) error {
	ws, err := s.workspace(ctx, actor, workspaceID)
	if err != nil {
		return err
	}
	if !s.flagEnabledForMember(ctx, actor.ID, ws.OrganizationID) {
		return errDriveFeatureDisabled()
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)

	conn, err := qtx.GetDriveConnection(ctx, db.GetDriveConnectionParams{
		ID:             driveConnectionID,
		OrganizationID: ws.OrganizationID,
		UserID:         actor.ID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}

	if err := qtx.LockDriveGrantSub(ctx, conn.GoogleSub); err != nil {
		return err
	}
	if s.testBeforeDisconnectRow != nil {
		s.testBeforeDisconnectRow(conn.GoogleSub)
	}

	old, err := qtx.DisconnectDriveConnection(ctx, db.DisconnectDriveConnectionParams{
		ID:             driveConnectionID,
		OrganizationID: ws.OrganizationID,
		UserID:         actor.ID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}

	if err := s.enqueueGrantRevocationInTx(ctx, qtx, old.GoogleSub, old.RefreshTokenEnc); err != nil {
		return err
	}

	if err := auditRecorder.Record(ctx, qtx, audit.Entry{
		OrganizationID: ws.OrganizationID,
		WorkspaceID:    ws.ID,
		Actor:          actor,
		Action:         audit.ActionDriveConnectionDisconnected,
		ResourceType:   "drive_connection",
		ResourceID:     old.ID,
		Metadata: map[string]any{
			"google_email": old.GoogleEmail,
			"google_sub":   old.GoogleSub,
			"reason":       "manual",
		},
	}, audit.Event{
		Topic:   "drive_connection.changed",
		Version: 1,
		Payload: map[string]string{
			"connection_id": old.ID,
			"user_id":       old.UserID,
		},
	}); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

// disconnectDriveConnectionsForUserInTx disconnects all active Drive connections
// of userID in orgID (or across all organizations when orgID == ""), enqueues
// their refresh tokens in drive_grant_revocations under the global per-sub lock
// in deterministic google_sub order, and writes one drive_connection.disconnected
// audit + drive_connection.changed outbox event per disconnected row (spec §5.3a).
var testAfterLifecycleGrantLocks func(subs []string)

func disconnectDriveConnectionsForUserInTx(ctx context.Context, qtx *db.Queries, actor audit.Actor, userID, orgID, reason string) ([]string, error) {
	var orgParam pgtype.Text
	if orgID != "" {
		orgParam = pgtype.Text{String: orgID, Valid: true}
	}
	// 1. Discover relevant google_subs without taking row locks so we can acquire
	// the global drive_grant:<sub> advisory locks in sorted order BEFORE locking
	// drive_connections rows — matching the lock order of saveDriveConnection and
	// Disconnect and preventing 40P01 deadlocks (R1-2).
	discoveredSubs, err := qtx.ListActiveDriveSubsForUser(ctx, db.ListActiveDriveSubsForUserParams{
		UserID:         userID,
		OrganizationID: orgParam,
	})
	if err != nil {
		return nil, err
	}
	lockedSubs := make(map[string]bool, len(discoveredSubs))
	for _, sub := range discoveredSubs {
		if err := qtx.LockDriveGrantSub(ctx, sub); err != nil {
			return nil, err
		}
		lockedSubs[sub] = true
	}
	if testAfterLifecycleGrantLocks != nil && len(discoveredSubs) > 0 {
		testAfterLifecycleGrantLocks(discoveredSubs)
	}

	// 2. Now lock and disconnect the active drive_connections rows.
	rows, err := qtx.DisconnectDriveConnectionsForUser(ctx, db.DisconnectDriveConnectionsForUserParams{
		UserID:         userID,
		OrganizationID: orgParam,
	})
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, nil
	}
	bySub := make(map[string]string, len(rows))
	subs := make([]string, 0, len(rows))
	for _, r := range rows {
		if _, seen := bySub[r.GoogleSub]; !seen {
			subs = append(subs, r.GoogleSub)
		}
		if r.RefreshTokenEnc != "" || bySub[r.GoogleSub] == "" {
			bySub[r.GoogleSub] = r.RefreshTokenEnc
		}
	}
	sortStrings(subs)
	for _, sub := range subs {
		if !lockedSubs[sub] {
			if err := qtx.LockDriveGrantSub(ctx, sub); err != nil {
				return nil, err
			}
			lockedSubs[sub] = true
		}
		if err := enqueueDriveGrantRevocationQ(ctx, qtx, sub, bySub[sub], slog.Default()); err != nil {
			return nil, err
		}
	}
	for _, r := range rows {
		if err := auditRecorder.Record(ctx, qtx, audit.Entry{
			OrganizationID: r.OrganizationID,
			Actor:          actor,
			Action:         audit.ActionDriveConnectionDisconnected,
			ResourceType:   "drive_connection",
			ResourceID:     r.ID,
			Metadata: map[string]any{
				"google_email": r.GoogleEmail,
				"google_sub":   r.GoogleSub,
				"reason":       reason,
			},
		}, audit.Event{
			Topic:   "drive_connection.changed",
			Version: 1,
			Payload: map[string]string{
				"connection_id": r.ID,
				"user_id":       r.UserID,
			},
		}); err != nil {
			return nil, err
		}
	}
	return subs, nil
}

func sortStrings(a []string) {
	for i := 1; i < len(a); i++ {
		for j := i; j > 0 && a[j] < a[j-1]; j-- {
			a[j], a[j-1] = a[j-1], a[j]
		}
	}
}
