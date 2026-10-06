package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/auth"
	"github.com/unicomhub/uniwork/server/internal/config"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	desktopPKCEChallengeMethod = "S256"
	maxDesktopLabelRunes       = 100
	maxDesktopMetadataBytes    = 64
)

var (
	ErrDesktopAuthCodeInvalid = errors.New("auth_code_invalid")
	ErrDesktopCSRF            = errors.New("csrf_invalid")
	ErrDesktopDeviceRevoked   = errors.New("device_revoked")
	ErrDesktopRefreshReused   = errors.New("refresh_reused")
)

func desktopAuthCodeInvalid() error {
	return CodedError{Code: "auth_code_invalid", Status: http.StatusUnauthorized, Msg: "authorization code is invalid or expired", Err: ErrDesktopAuthCodeInvalid}
}
func desktopCSRFError() error {
	return CodedError{Code: "csrf_invalid", Status: http.StatusBadRequest, Msg: "consent confirmation is invalid", Err: ErrDesktopCSRF}
}
func desktopDeviceRevoked() error {
	return CodedError{Code: "device_revoked", Status: http.StatusUnauthorized, Msg: "desktop device is no longer authorized", Err: ErrDesktopDeviceRevoked}
}
func desktopRefreshReused() error {
	return CodedError{Code: "refresh_reused", Status: http.StatusUnauthorized, Msg: "refresh token is no longer valid", Err: ErrDesktopRefreshReused}
}

type DesktopAuthService struct {
	pool   *pgxpool.Pool
	q      *db.Queries
	minter auth.TokenMinter
	cfg    config.Config
	now    func() time.Time
}

func NewDesktopAuthService(pool *pgxpool.Pool, q *db.Queries, minter auth.TokenMinter, cfg config.Config) *DesktopAuthService {
	if cfg.DesktopAuthClientID == "" {
		cfg.DesktopAuthClientID = "uniwork-office"
	}
	if len(cfg.DesktopAuthRedirectURIs) == 0 {
		cfg.DesktopAuthRedirectURIs = []string{"uniwork-office://auth/callback"}
	}
	if len(cfg.DesktopAuthDeploymentIDs) == 0 {
		cfg.DesktopAuthDeploymentIDs = []string{"default"}
	}
	if cfg.DesktopAuthCodeTTL <= 0 {
		cfg.DesktopAuthCodeTTL = 120 * time.Second
	}
	if cfg.DesktopAuthAttemptTTL <= 0 {
		cfg.DesktopAuthAttemptTTL = 10 * time.Minute
	}
	return &DesktopAuthService{pool: pool, q: q, minter: minter, cfg: cfg, now: time.Now}
}

type DesktopStartInput struct {
	ClientID            string
	CodeChallenge       string
	CodeChallengeMethod string
	State               string
	RedirectURI         string
	DeploymentID        string
	DeviceLabel         string
	Platform            string
	Build               string
}

type DesktopAttempt struct {
	ID               string
	AuthorizationURL string
	ExpiresAt        time.Time
}

type DesktopConsent struct {
	Status       string
	AttemptID    string
	AccountID    string
	AccountName  string
	AccountEmail string
	ClientID     string
	DeploymentID string
	RedirectURI  string
	DeviceLabel  string
	Platform     string
	Build        string
	CSRFToken    string
}

type DesktopSession struct {
	AccountID        string
	DeviceSessionID  string
	SessionID        string
	DeploymentID     string
	AccessToken      string
	ExpiresIn        int32
	RefreshToken     string
	RefreshExpiresIn int32
}

type DesktopDevice struct {
	ID           string
	ClientID     string
	DeploymentID string
	DeviceLabel  string
	Platform     string
	Build        string
	CreatedAt    time.Time
	LastUsedAt   time.Time
	ExpiresAt    time.Time
	RevokedAt    *time.Time
}

func (s *DesktopAuthService) Start(ctx context.Context, in DesktopStartInput) (DesktopAttempt, error) {
	if err := s.validateStart(in); err != nil {
		return DesktopAttempt{}, err
	}
	id := util.NewID()
	stateDigest := digest(in.State)
	expires := s.now().Add(s.cfg.DesktopAuthAttemptTTL)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return DesktopAttempt{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	if _, err := q.CreateDesktopAuthAttempt(ctx, db.CreateDesktopAuthAttemptParams{
		ID: id, ClientID: in.ClientID, DeploymentID: in.DeploymentID,
		CodeChallenge: in.CodeChallenge, CodeChallengeMethod: desktopPKCEChallengeMethod,
		RedirectUri: in.RedirectURI, State: in.State, StateDigest: stateDigest,
		DeviceLabel: sanitizeDesktopLabel(in.DeviceLabel), Platform: sanitizeMetadata(in.Platform),
		Build: sanitizeMetadata(in.Build), ExpiresAt: pgtype.Timestamptz{Time: expires, Valid: true},
	}); err != nil {
		return DesktopAttempt{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: audit.NoOrganization, Actor: audit.System("desktop-auth"),
		Action: audit.ActionAuthDesktopStarted, ResourceType: "desktop_attempt", ResourceID: id,
	}); err != nil {
		return DesktopAttempt{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return DesktopAttempt{}, err
	}
	// The attempt id is opaque and cannot approve or redeem anything. State and
	// verifier stay in the native host; neither is copied into this URL.
	return DesktopAttempt{ID: id, AuthorizationURL: strings.TrimRight(s.cfg.FrontendOrigin, "/") + "/auth/desktop/authorize?attempt_id=" + url.QueryEscape(id), ExpiresAt: expires}, nil
}

func (s *DesktopAuthService) Consent(ctx context.Context, userID, attemptID string) (DesktopConsent, error) {
	if strings.TrimSpace(userID) == "" || strings.TrimSpace(attemptID) == "" {
		return DesktopConsent{}, desktopAuthCodeInvalid()
	}
	row, err := s.q.GetDesktopAuthAttempt(ctx, attemptID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && row.UserID.Valid && row.UserID.String != userID) {
		return DesktopConsent{}, desktopAuthCodeInvalid()
	}
	if err != nil {
		return DesktopConsent{}, err
	}
	status, raw := "pending", ""
	if row.CancelledAt.Valid {
		status = "cancelled"
	} else if row.ApprovedAt.Valid || row.UsedAt.Valid {
		status = "approved"
	} else if !row.ExpiresAt.Time.After(s.now()) {
		status = "expired"
	} else {
		raw, err = randomToken(32)
		if err != nil {
			return DesktopConsent{}, err
		}
		row, err = s.q.SetDesktopAuthCSRF(ctx, db.SetDesktopAuthCSRFParams{ID: attemptID, UserID: pgtype.Text{String: userID, Valid: true}, CsrfDigest: pgtype.Text{String: digest(raw), Valid: true}})
		if errors.Is(err, pgx.ErrNoRows) {
			return DesktopConsent{}, desktopAuthCodeInvalid()
		}
		if err != nil {
			return DesktopConsent{}, err
		}
		// A concurrent approval is authoritative even if the initial read was pending.
		if row.ApprovedAt.Valid {
			status, raw = "approved", ""
		}
	}
	user, err := s.q.GetUserByID(ctx, userID)
	if err != nil {
		return DesktopConsent{}, err
	}
	return DesktopConsent{Status: status, AttemptID: row.ID, AccountID: userID, AccountName: user.DisplayName, AccountEmail: user.Email, ClientID: row.ClientID, DeploymentID: row.DeploymentID,
		RedirectURI: row.RedirectUri, DeviceLabel: row.DeviceLabel, Platform: row.Platform,
		Build: row.Build, CSRFToken: raw}, nil
}

func (s *DesktopAuthService) Approve(ctx context.Context, userID, attemptID, csrf string) (string, string, error) {
	if userID == "" || attemptID == "" || csrf == "" {
		return "", "", desktopCSRFError()
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", "", err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	row, err := q.GetDesktopAuthAttemptForUpdate(ctx, attemptID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", "", desktopCSRFError()
		}
		return "", "", err
	}
	if !row.UserID.Valid || row.UserID.String != userID || !row.CsrfDigest.Valid || !secureDigestEqual(row.CsrfDigest.String, digest(csrf)) {
		return "", "", desktopCSRFError()
	}
	code, err := randomToken(32)
	if err != nil {
		return "", "", err
	}
	approved, err := q.ApproveDesktopAuthAttempt(ctx, db.ApproveDesktopAuthAttemptParams{
		ID: attemptID, UserID: pgtype.Text{String: userID, Valid: true},
		CodeDigest:    pgtype.Text{String: digest(code), Valid: true},
		CodeExpiresAt: pgtype.Timestamptz{Time: s.now().Add(s.cfg.DesktopAuthCodeTTL), Valid: true},
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", desktopAuthCodeInvalid()
	}
	if err != nil {
		return "", "", err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: audit.NoOrganization, Actor: audit.User(userID),
		Action: audit.ActionAuthDesktopConsentApproved, ResourceType: "user", ResourceID: userID,
		Metadata: map[string]any{"attempt_id": approved.ID},
	}); err != nil {
		return "", "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", "", err
	}
	callback, err := url.Parse(row.RedirectUri)
	if err != nil {
		return "", "", desktopAuthCodeInvalid()
	}
	params := callback.Query()
	params.Set("code", code)
	params.Set("state", row.State)
	callback.RawQuery = params.Encode()
	return code, callback.String(), nil
}

func (s *DesktopAuthService) Cancel(ctx context.Context, userID, attemptID, csrf string) error {
	if userID == "" || attemptID == "" || csrf == "" {
		return desktopCSRFError()
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	row, err := q.GetDesktopAuthAttemptForUpdate(ctx, attemptID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return desktopCSRFError()
		}
		return err
	}
	if !row.UserID.Valid || row.UserID.String != userID || !row.CsrfDigest.Valid || !secureDigestEqual(row.CsrfDigest.String, digest(csrf)) {
		return desktopCSRFError()
	}
	if n, err := q.CancelDesktopAuthAttempt(ctx, db.CancelDesktopAuthAttemptParams{ID: attemptID, UserID: pgtype.Text{String: userID, Valid: true}}); err != nil {
		return err
	} else if n != 1 {
		return desktopAuthCodeInvalid()
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{OrganizationID: audit.NoOrganization, Actor: audit.User(userID), Action: audit.ActionAuthDesktopConsentCancelled, ResourceType: "user", ResourceID: userID, Metadata: map[string]any{"attempt_id": attemptID}}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *DesktopAuthService) Exchange(ctx context.Context, clientID, code, verifier, redirectURI, deploymentID string) (DesktopSession, error) {
	if !validVerifier(verifier) || !s.allowed(clientID, redirectURI, deploymentID) || code == "" {
		return DesktopSession{}, desktopAuthCodeInvalid()
	}
	challenge := pkceChallenge(verifier)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return DesktopSession{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	row, err := q.RedeemDesktopAuthAttempt(ctx, db.RedeemDesktopAuthAttemptParams{
		CodeDigest: pgtype.Text{String: digest(code), Valid: true}, ClientID: clientID,
		DeploymentID: deploymentID, RedirectUri: redirectURI, CodeChallenge: challenge,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return DesktopSession{}, desktopAuthCodeInvalid()
	}
	if err != nil {
		return DesktopSession{}, err
	}
	if !row.UserID.Valid {
		return DesktopSession{}, desktopAuthCodeInvalid()
	}
	user, err := q.GetUserByID(ctx, row.UserID.String)
	if err != nil {
		return DesktopSession{}, err
	}
	deviceID := util.NewID()
	access, err := s.minter.MintSession(user.ID, deviceID)
	if err != nil {
		return DesktopSession{}, err
	}
	refresh, err := randomToken(32)
	if err != nil {
		return DesktopSession{}, err
	}
	expires := s.now().Add(s.refreshTTL())
	if _, err := q.CreateRefreshToken(ctx, db.CreateRefreshTokenParams{
		ID: util.NewID(), UserID: user.ID, TokenHash: hashToken(refresh),
		ExpiresAt: pgtype.Timestamptz{Time: expires, Valid: true}, SessionID: deviceID,
		UserAgent: "uniwork-office/" + row.Platform, Ip: "",
	}); err != nil {
		return DesktopSession{}, err
	}
	if _, err := q.CreateDeviceSession(ctx, db.CreateDeviceSessionParams{
		ID: deviceID, UserID: user.ID, SessionFamilyID: deviceID, ClientID: row.ClientID,
		DeploymentID: row.DeploymentID, DeviceLabel: row.DeviceLabel, Platform: row.Platform,
		Build: row.Build, RefreshTokenDigest: hashToken(refresh), ExpiresAt: pgtype.Timestamptz{Time: expires, Valid: true},
		CreatedByKind: string(audit.KindHuman),
	}); err != nil {
		return DesktopSession{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: audit.NoOrganization, Actor: audit.User(user.ID), Action: audit.ActionAuthDesktopSessionCreated,
		ResourceType: "device_session", ResourceID: deviceID,
		Metadata: map[string]any{"client_id": row.ClientID, "deployment_id": row.DeploymentID},
	}); err != nil {
		return DesktopSession{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return DesktopSession{}, err
	}
	return DesktopSession{AccountID: user.ID, DeviceSessionID: deviceID, SessionID: deviceID,
		DeploymentID: row.DeploymentID,
		AccessToken:  access, ExpiresIn: int32(s.minter.TTL / time.Second), RefreshToken: refresh,
		RefreshExpiresIn: int32(s.refreshTTL() / time.Second)}, nil
}

func (s *DesktopAuthService) Refresh(ctx context.Context, deviceID, rawToken, deploymentID string) (DesktopSession, error) {
	if deviceID == "" || rawToken == "" || deploymentID == "" {
		return DesktopSession{}, desktopRefreshReused()
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return DesktopSession{}, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	device, err := q.GetDeviceSessionForUpdate(ctx, deviceID)
	if errors.Is(err, pgx.ErrNoRows) {
		return DesktopSession{}, desktopDeviceRevoked()
	}
	if err != nil {
		return DesktopSession{}, err
	}
	if device.DeploymentID != deploymentID || device.RevokedAt.Valid || !device.ExpiresAt.Valid || !device.ExpiresAt.Time.After(s.now()) {
		return DesktopSession{}, desktopDeviceRevoked()
	}
	oldDigest := hashToken(rawToken)
	if !secureDigestEqual(device.RefreshTokenDigest, oldDigest) {
		// Only a token this family really issued and later rotated out is a
		// replay worth revoking the family for. Anything else is a guess by
		// someone who knows the device id: refuse it with the same 401 and
		// change nothing, or a device id alone would log its owner out.
		// (UNI-954 lead decision, after the OAuth 2.0 Security BCP's refresh
		// token reuse detection: never issued to the family = 401 with no
		// revocation; a rotated-out token of the family = revoke the family.
		// refresh_tokens keeps rotated rows with revoked_at set, which is
		// what tells the two apart.)
		issued, err := q.RefreshTokenIssuedToFamily(ctx, db.RefreshTokenIssuedToFamilyParams{TokenHash: oldDigest, UserID: device.UserID, SessionID: device.SessionFamilyID})
		if err != nil {
			return DesktopSession{}, err
		}
		if !issued {
			return DesktopSession{}, desktopRefreshReused()
		}
		if _, _, revokeErr := revokeDesktopFamily(ctx, q, device.UserID, device.SessionFamilyID); revokeErr != nil {
			return DesktopSession{}, revokeErr
		}
		if err := auditRecorder.Record(ctx, q, audit.Entry{OrganizationID: audit.NoOrganization, Actor: audit.User(device.UserID), Action: audit.ActionAuthDesktopSessionRevoked, ResourceType: "device_session", ResourceID: device.ID, Metadata: map[string]any{"reason": "refresh_reuse"}}); err != nil {
			return DesktopSession{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return DesktopSession{}, err
		}
		return DesktopSession{}, desktopRefreshReused()
	}
	refresh, err := randomToken(32)
	if err != nil {
		return DesktopSession{}, err
	}
	if _, err := q.RotateDeviceSessionToken(ctx, db.RotateDeviceSessionTokenParams{ID: device.ID, RefreshTokenDigest: hashToken(refresh), RefreshTokenDigest_2: oldDigest}); err != nil {
		return DesktopSession{}, err
	}
	if err := q.RevokeRefreshToken(ctx, oldDigest); err != nil {
		return DesktopSession{}, err
	}
	if _, err := q.CreateRefreshToken(ctx, db.CreateRefreshTokenParams{ID: util.NewID(), UserID: device.UserID, TokenHash: hashToken(refresh), ExpiresAt: device.ExpiresAt, SessionID: device.SessionFamilyID, UserAgent: "uniwork-office/" + device.Platform, Ip: ""}); err != nil {
		return DesktopSession{}, err
	}
	access, err := s.minter.MintSession(device.UserID, device.ID)
	if err != nil {
		return DesktopSession{}, err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{OrganizationID: audit.NoOrganization, Actor: audit.User(device.UserID), Action: audit.ActionAuthDesktopTokenRotated, ResourceType: "device_session", ResourceID: device.ID}); err != nil {
		return DesktopSession{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return DesktopSession{}, err
	}
	refreshSeconds := int32(time.Until(device.ExpiresAt.Time) / time.Second)
	if refreshSeconds < 1 {
		refreshSeconds = 1
	}
	return DesktopSession{AccountID: device.UserID, DeviceSessionID: device.ID, SessionID: device.SessionFamilyID, DeploymentID: device.DeploymentID, AccessToken: access, ExpiresIn: int32(s.minter.TTL / time.Second), RefreshToken: refresh, RefreshExpiresIn: refreshSeconds}, nil
}

// revokeDesktopFamily closes every live device session of the family, then the
// family's refresh tokens, as two statements in the caller's transaction. It
// returns how many rows each statement changed, so a caller can tell a real
// revoke from a repeat.
func revokeDesktopFamily(ctx context.Context, q *db.Queries, userID, familyID string) (sessions, tokens int64, err error) {
	sessions, err = q.RevokeDeviceSessionFamily(ctx, db.RevokeDeviceSessionFamilyParams{UserID: userID, SessionFamilyID: familyID})
	if err != nil {
		return 0, 0, err
	}
	tokens, err = q.RevokeSessionForUser(ctx, db.RevokeSessionForUserParams{UserID: userID, SessionID: familyID})
	if err != nil {
		return 0, 0, err
	}
	return sessions, tokens, nil
}

// closeOrphanFamilyTokens closes the family's refresh tokens once no live
// device session is left in it. The family shares one refresh-token chain:
// once its last live device session is gone the chain must die with it, or
// AuthService would still mint a browser session from the leftover token.
// The caller holds LockDeviceSessionFamily. It returns the tokens closed.
func closeOrphanFamilyTokens(ctx context.Context, q *db.Queries, userID, familyID string) (int64, error) {
	live, err := q.CountLiveDeviceSessionsInFamily(ctx, db.CountLiveDeviceSessionsInFamilyParams{UserID: userID, SessionFamilyID: familyID})
	if err != nil || live > 0 {
		return 0, err
	}
	return q.RevokeSessionForUser(ctx, db.RevokeSessionForUserParams{UserID: userID, SessionID: familyID})
}

func (s *DesktopAuthService) Logout(ctx context.Context, userID, deviceID, deploymentID, scope string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	device, err := q.GetDeviceSessionForUpdate(ctx, deviceID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return desktopDeviceRevoked()
		}
		return err
	}
	if device.UserID != userID || device.DeploymentID != deploymentID {
		return desktopDeviceRevoked()
	}
	if device.RevokedAt.Valid {
		// A repeat logout/revoke stays an idempotent success, but it still
		// closes a family token left live by a device-scope logout that ran
		// before the last-session rule existed; otherwise only the operator
		// revoke or expiry would ever close it. A repeat with nothing left to
		// close writes nothing.
		if err := q.LockDeviceSessionFamily(ctx, device.SessionFamilyID); err != nil {
			return err
		}
		closed, err := closeOrphanFamilyTokens(ctx, q, userID, device.SessionFamilyID)
		if err != nil {
			return err
		}
		if closed > 0 {
			if err := auditRecorder.Record(ctx, q, audit.Entry{OrganizationID: audit.NoOrganization, Actor: audit.User(userID), Action: audit.ActionAuthDesktopSessionRevoked, ResourceType: "device_session", ResourceID: deviceID, Metadata: map[string]any{"reason": "leftover_refresh_token", "refresh_tokens": closed}}); err != nil {
				return err
			}
		}
		return tx.Commit(ctx)
	}
	if scope == "" {
		scope = "device"
	}
	if scope != "device" && scope != "family" {
		return Invalid("scope must be device or family")
	}
	if scope == "family" {
		if _, _, err := revokeDesktopFamily(ctx, q, userID, device.SessionFamilyID); err != nil {
			return err
		}
	} else {
		// Sibling device-scope logouts of one family serialize on the family
		// key before revoking, so the second one counts the first as gone
		// and closes the family token (each alone would see the other, still
		// uncommitted, as live and leave it behind).
		if err := q.LockDeviceSessionFamily(ctx, device.SessionFamilyID); err != nil {
			return err
		}
		if _, err := q.RevokeDeviceSession(ctx, db.RevokeDeviceSessionParams{ID: deviceID, UserID: userID}); err != nil {
			return err
		}
		if _, err := closeOrphanFamilyTokens(ctx, q, userID, device.SessionFamilyID); err != nil {
			return err
		}
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{OrganizationID: audit.NoOrganization, Actor: audit.User(userID), Action: audit.ActionAuthDesktopSessionRevoked, ResourceType: "device_session", ResourceID: deviceID, Metadata: map[string]any{"scope": scope}}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *DesktopAuthService) List(ctx context.Context, userID string) ([]DesktopDevice, error) {
	rows, err := s.q.ListDeviceSessions(ctx, userID)
	if err != nil {
		return nil, err
	}
	out := make([]DesktopDevice, 0, len(rows))
	for _, row := range rows {
		var revoked *time.Time
		if row.RevokedAt.Valid {
			t := row.RevokedAt.Time
			revoked = &t
		}
		out = append(out, DesktopDevice{ID: row.ID, ClientID: row.ClientID, DeploymentID: row.DeploymentID, DeviceLabel: row.DeviceLabel, Platform: row.Platform, Build: row.Build, CreatedAt: row.CreatedAt.Time, LastUsedAt: row.LastUsedAt.Time, ExpiresAt: row.ExpiresAt.Time, RevokedAt: revoked})
	}
	return out, nil
}

// Revoke revokes one of the caller's own devices. A device id that is missing
// or belongs to another account is ErrNotFound either way, so the answer never
// confirms that someone else's device exists. Revoking an already revoked own
// device stays an idempotent success.
func (s *DesktopAuthService) Revoke(ctx context.Context, userID, deviceID string) error {
	if userID == "" || deviceID == "" {
		return ErrNotFound
	}
	row, err := s.q.GetDeviceSession(ctx, deviceID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && row.UserID != userID) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	// Logout re-reads the row under lock and re-checks the owner.
	if err := s.Logout(ctx, userID, deviceID, row.DeploymentID, "device"); err != nil {
		if errors.Is(err, ErrDesktopDeviceRevoked) {
			return ErrNotFound
		}
		return err
	}
	return nil
}

func (s *DesktopAuthService) CheckDeviceSession(ctx context.Context, userID, sessionID string) error {
	if sessionID == "" {
		return nil
	}
	row, err := s.q.GetDeviceSession(ctx, sessionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil // Browser sessions use the same JWT sid namespace.
	}
	if err != nil {
		return err
	}
	if row.UserID != userID || !s.deploymentAllowed(row.DeploymentID) || row.RevokedAt.Valid || !row.ExpiresAt.Valid || !row.ExpiresAt.Time.After(s.now()) {
		return desktopDeviceRevoked()
	}
	return s.q.TouchDeviceSession(ctx, sessionID)
}

func (s *DesktopAuthService) RevokeAll(ctx context.Context, userID string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	if err := q.RevokeAllRefreshTokensForUser(ctx, userID); err != nil {
		return err
	}
	if err := auditRecorder.Record(ctx, q, audit.Entry{OrganizationID: audit.NoOrganization, Actor: audit.User(userID), Action: audit.ActionAuthDesktopSessionRevoked, ResourceType: "user", ResourceID: userID, Metadata: map[string]any{"scope": "all"}}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *DesktopAuthService) validateStart(in DesktopStartInput) error {
	if !s.allowed(in.ClientID, in.RedirectURI, in.DeploymentID) || in.State == "" || in.CodeChallengeMethod != desktopPKCEChallengeMethod || !validChallenge(in.CodeChallenge) {
		return Invalid("invalid desktop authorization request")
	}
	return nil
}

func (s *DesktopAuthService) allowed(clientID, redirectURI, deploymentID string) bool {
	if clientID != s.cfg.DesktopAuthClientID || !s.deploymentAllowed(deploymentID) {
		return false
	}
	redirectOK, deploymentOK := false, false
	for _, v := range s.cfg.DesktopAuthRedirectURIs {
		if v == redirectURI {
			redirectOK = true
			break
		}
	}
	for _, v := range s.cfg.DesktopAuthDeploymentIDs {
		if v == deploymentID {
			deploymentOK = true
			break
		}
	}
	return redirectOK && deploymentOK
}

func (s *DesktopAuthService) deploymentAllowed(deploymentID string) bool {
	if deploymentID == "" {
		return false
	}
	for _, v := range s.cfg.DesktopAuthDeploymentIDs {
		if v == deploymentID {
			return true
		}
	}
	return false
}

func (s *DesktopAuthService) refreshTTL() time.Duration {
	if s.cfg.RefreshTokenTTL > 0 {
		return s.cfg.RefreshTokenTTL
	}
	return 30 * 24 * time.Hour
}

func validChallenge(v string) bool { return len(v) == 43 && isBase64URL(v) }
func validVerifier(v string) bool  { return len(v) >= 43 && len(v) <= 128 && isBase64URL(v) }

func isBase64URL(v string) bool {
	if v == "" {
		return false
	}
	for _, r := range v {
		if !(r >= 'A' && r <= 'Z' || r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '-' || r == '_') {
			return false
		}
	}
	return true
}

func pkceChallenge(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func randomToken(bytesN int) (string, error) {
	b := make([]byte, bytesN)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func digest(raw string) string { return hashToken(raw) }

func secureDigestEqual(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

func sanitizeDesktopLabel(v string) string {
	v = strings.TrimSpace(v)
	if utf8.RuneCountInString(v) > maxDesktopLabelRunes {
		r := []rune(v)
		v = string(r[:maxDesktopLabelRunes])
	}
	return v
}

func sanitizeMetadata(v string) string {
	v = strings.ToValidUTF8(strings.TrimSpace(v), "")
	if len(v) <= maxDesktopMetadataBytes {
		return v
	}
	limit := 0
	for _, r := range v {
		runeBytes := utf8.RuneLen(r)
		if limit+runeBytes > maxDesktopMetadataBytes {
			break
		}
		limit += runeBytes
	}
	return v[:limit]
}
