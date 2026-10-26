package service

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/oauth2"

	"github.com/unicomhub/uniwork/server/internal/audit"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// driveAccessTokenSkew: an access token closer than 2 minutes to its expiry is
// refreshed first (spec §4, §5.3).
const driveAccessTokenSkew = 2 * time.Minute

var (
	// errDriveOAuthRefreshFailed stands for every refresh failure except a
	// refused grant (invalid_grant / unauthorized_client). Provider error text
	// never leaves this file.
	errDriveOAuthRefreshFailed = errors.New("drive oauth refresh failed")
)

func (s *DriveConnectionService) refreshLock(connectionID string) *sync.Mutex {
	m, _ := s.refreshLocks.LoadOrStore(connectionID, &sync.Mutex{})
	return m.(*sync.Mutex)
}

// AccessToken returns a valid, non-expired OAuth access token for conn,
// refreshing it against the DriveProvider when within driveAccessTokenSkew of
// expiry. In-process callers share a per-connection mutex; cross-pod callers
// are fenced by credential_version and prev_expires_at on UpdateDriveConnectionTokens
// (spec §5.3; pattern: email_hub_oauth_refresh.go:19-128).
//
// A loser of a refresh race drops its token without revoking it: Google grants
// belong to (OAuth client, google_sub), so revoking an access/refresh token
// would revoke the winner's grant too.
func (s *DriveConnectionService) AccessToken(ctx context.Context, conn db.DriveConnection) (string, time.Time, error) {
	if token, exp, ok, err := s.freshAccessToken(conn); ok || err != nil {
		return token, exp, err
	}
	if !s.Available() {
		return "", time.Time{}, ErrDriveNotConfigured
	}
	mu := s.refreshLock(conn.ID)
	mu.Lock()
	defer mu.Unlock()

	read, err := s.rereadDriveConnection(ctx, conn)
	if err != nil {
		return "", time.Time{}, err
	}
	if token, exp, ok, err := s.freshAccessToken(read); ok || err != nil {
		return token, exp, err
	}
	if read.RefreshTokenEnc == "" {
		return "", time.Time{}, ErrDriveReauthRequired
	}
	refresh, err := s.openSecret(read.RefreshTokenEnc)
	if err != nil {
		return "", time.Time{}, err
	}
	tok, err := s.provider.RefreshToken(ctx, refresh)
	if err != nil {
		return s.oauthRefreshFailed(ctx, read, err)
	}
	accessEnc, err := s.sealSecret(tok.AccessToken)
	if err != nil {
		return "", time.Time{}, err
	}
	var refreshEnc string
	if tok.RefreshToken != "" && tok.RefreshToken != refresh {
		if refreshEnc, err = s.sealSecret(tok.RefreshToken); err != nil {
			return "", time.Time{}, err
		}
	}
	expiry := tok.Expiry.UTC()
	n, err := s.q.UpdateDriveConnectionTokens(ctx, db.UpdateDriveConnectionTokensParams{
		ID:                read.ID,
		OrganizationID:    read.OrganizationID,
		CredentialVersion: read.CredentialVersion,
		PrevExpiresAt:     read.AccessExpiresAt,
		AccessTokenEnc:    accessEnc,
		AccessExpiresAt:   pgtype.Timestamptz{Time: expiry, Valid: !expiry.IsZero()},
		RefreshTokenEnc:   refreshEnc,
	})
	if err != nil {
		return "", time.Time{}, err
	}
	if n == 0 {
		// Another pod refreshed first, or a reconnect, disconnect or auth
		// failure replaced the row. Drop the token just received without
		// revoking it (spec §5.3).
		return s.currentAccessToken(ctx, read)
	}
	return tok.AccessToken, expiry, nil
}

func (s *DriveConnectionService) oauthRefreshFailed(ctx context.Context, read db.DriveConnection, err error) (string, time.Time, error) {
	if s.metrics != nil {
		s.metrics.ObserveTokenRefreshFailure()
	}
	var re *oauth2.RetrieveError
	if !errors.As(err, &re) || (re.ErrorCode != "invalid_grant" && re.ErrorCode != "unauthorized_client") {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return "", time.Time{}, ctxErr
		}
		return "", time.Time{}, errDriveOAuthRefreshFailed
	}
	current, rerr := s.rereadDriveConnection(ctx, read)
	if rerr != nil {
		return "", time.Time{}, rerr
	}
	if current.CredentialVersion != read.CredentialVersion || current.RefreshTokenEnc != read.RefreshTokenEnc ||
		!sameDriveExpiry(current.AccessExpiresAt, read.AccessExpiresAt) {
		return s.accessTokenOf(current)
	}
	s.markAuthFailed(ctx, read, read.CredentialVersion, re.ErrorCode)
	return "", time.Time{}, ErrDriveReauthRequired
}

// markAuthFailed records that the credential at version was refused by Google
// (invalid_grant / unauthorized_client), keeping the connection row and linked
// files intact for reconnect onto the same id (spec §5.3, §11).
func (s *DriveConnectionService) markAuthFailed(ctx context.Context, conn db.DriveConnection, version int64, reason string) bool {
	ctx = context.WithoutCancel(ctx)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		s.log.Warn("drive mark auth failed begin", "connection_id", conn.ID, "err", err)
		return false
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)

	updated, err := qtx.MarkDriveConnectionAuthFailed(ctx, db.MarkDriveConnectionAuthFailedParams{
		ID:                conn.ID,
		OrganizationID:    conn.OrganizationID,
		CredentialVersion: version,
		Reason:            reason,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return false
	}
	if err != nil {
		s.log.Warn("drive mark auth failed", "connection_id", conn.ID, "err", err)
		return false
	}
	if err := auditRecorder.Record(ctx, qtx, audit.Entry{
		OrganizationID: updated.OrganizationID,
		Actor:          audit.System("drive"),
		Action:         audit.ActionDriveConnectionAuthFailed,
		ResourceType:   "drive_connection",
		ResourceID:     updated.ID,
		Metadata: map[string]any{
			"reason":       reason,
			"google_email": updated.GoogleEmail,
			"google_sub":   updated.GoogleSub,
		},
	}, audit.Event{
		Topic:   "drive_connection.changed",
		Version: 1,
		Payload: map[string]string{
			"connection_id": updated.ID,
			"user_id":       updated.UserID,
		},
	}); err != nil {
		s.log.Warn("drive mark auth failed audit", "connection_id", conn.ID, "err", err)
		return false
	}
	if err := tx.Commit(ctx); err != nil {
		s.log.Warn("drive mark auth failed commit", "connection_id", conn.ID, "err", err)
		return false
	}
	return true
}

func (s *DriveConnectionService) currentAccessToken(ctx context.Context, conn db.DriveConnection) (string, time.Time, error) {
	row, err := s.rereadDriveConnection(ctx, conn)
	if err != nil {
		return "", time.Time{}, err
	}
	return s.accessTokenOf(row)
}

func (s *DriveConnectionService) accessTokenOf(row db.DriveConnection) (string, time.Time, error) {
	token, exp, ok, err := s.freshAccessToken(row)
	if err != nil {
		return "", time.Time{}, err
	}
	if !ok {
		return "", time.Time{}, ErrDriveReauthRequired
	}
	return token, exp, nil
}

func (s *DriveConnectionService) freshAccessToken(conn db.DriveConnection) (token string, exp time.Time, ok bool, err error) {
	if conn.AuthFailedAt.Valid || conn.DisconnectedAt.Valid {
		return "", time.Time{}, false, ErrDriveReauthRequired
	}
	expiresAt := conn.AccessExpiresAt
	if conn.AccessTokenEnc == "" || !expiresAt.Valid || expiresAt.Time.Sub(s.nowUTC()) <= driveAccessTokenSkew {
		return "", time.Time{}, false, nil
	}
	token, err = s.openSecret(conn.AccessTokenEnc)
	if err != nil {
		return "", time.Time{}, false, err
	}
	return token, expiresAt.Time.UTC(), true, nil
}

func (s *DriveConnectionService) rereadDriveConnection(ctx context.Context, conn db.DriveConnection) (db.DriveConnection, error) {
	row, err := s.q.GetDriveConnection(ctx, db.GetDriveConnectionParams{
		ID:             conn.ID,
		OrganizationID: conn.OrganizationID,
		UserID:         conn.UserID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return row, ErrDriveReauthRequired
	}
	if err != nil {
		return row, err
	}
	if row.AuthFailedAt.Valid {
		return row, ErrDriveReauthRequired
	}
	return row, nil
}

func sameDriveExpiry(a, b pgtype.Timestamptz) bool {
	return a.Valid == b.Valid && (!a.Valid || a.Time.Equal(b.Time))
}
