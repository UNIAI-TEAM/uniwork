package service

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/outbox"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

const (
	// driveRevocationLeaseTTL is the per-row lease duration for an in-flight
	// revocation attempt in drive_grant_revocations (spec §5.3b step 1: 2m,
	// longer than the 15s HTTP client timeout + transaction 2).
	driveRevocationLeaseTTL = 2 * time.Minute
	// driveRevocationHTTPTimeout bounds the Google revoke HTTP call (spec §5.3b step 2).
	driveRevocationHTTPTimeout = 15 * time.Second
	// driveRevocationResolveTimeout bounds the detached resolution DB transaction
	// (pool acquisition, advisory lock and commit) so a held DB lock cannot keep
	// a worker alive past the 30s shutdown wait (R1-17).
	driveRevocationResolveTimeout = 15 * time.Second
	// driveRevocationPostCommitTimeout bounds the synchronous post-commit grant
	// cleanup (claim transaction, Google revoke, and resolve) per sub so a held
	// grant lock or exhausted pool never stalls an already-committed request (R2-3).
	driveRevocationPostCommitTimeout = 15 * time.Second
	// unresolved revocation is abandoned and alerted (spec §5.3b step 3).
	driveRevocationAbandonWindow = 24 * time.Hour
	// driveRevocationEvidenceRetention is the 1-day window after which resolved/empty
	// revocation rows whose evidence timestamps are older than 1 day are purged (spec §5.3b).
	driveRevocationEvidenceRetention = 24 * time.Hour

	driveRevocationPollInterval  = 2 * time.Second
	driveRevocationPurgeInterval = time.Hour
	driveRevocationBatchLimit    = int32(25)
)

var errDriveRevocationUnsealFailed = errors.New("drive revocation unseal failed")

// enqueueGrantRevocationInTx enqueues a refresh token into drive_grant_revocations
// inside an active transaction that already holds LockDriveGrantSub(googleSub)
// (spec §5.3b).
func (s *DriveConnectionService) enqueueGrantRevocationInTx(ctx context.Context, qtx *db.Queries, googleSub, refreshTokenEnc string) error {
	log := slog.Default()
	if s != nil && s.log != nil {
		log = s.log
	}
	return enqueueDriveGrantRevocationQ(ctx, qtx, googleSub, refreshTokenEnc, log)
}

func enqueueDriveGrantRevocationQ(ctx context.Context, qtx *db.Queries, googleSub, refreshTokenEnc string, log *slog.Logger) error {
	if googleSub == "" || refreshTokenEnc == "" {
		return nil
	}
	_, err := qtx.UpsertDriveGrantRevocation(ctx, db.UpsertDriveGrantRevocationParams{
		GoogleSub:       googleSub,
		RefreshTokenEnc: pgtype.Text{String: refreshTokenEnc, Valid: true},
	})
	if errors.Is(err, pgx.ErrNoRows) {
		// Spec §5.3b: an in-flight attempt (attempt_id IS NOT NULL AND resolved_at IS NULL)
		// is never overwritten; log and keep the existing in-flight row intact.
		log.Warn("drive grant revocation upsert skipped: attempt in flight", "code", "in_flight")
		return nil
	}
	return err
}

// RevocationConsumer returns the outbox.Consumer registered on outbox.LaneProvider
// to process Google Drive grant revocations when drive_connection.changed is
// emitted on disconnect or lifecycle transitions (spec §5.3b, R1-6).
func (s *DriveConnectionService) RevocationConsumer() outbox.Consumer {
	return driveRevocationConsumer{s: s}
}

type driveRevocationConsumer struct {
	s *DriveConnectionService
}

func (driveRevocationConsumer) Name() string {
	return "drive-grant-revocation"
}

func (driveRevocationConsumer) Topics() []string {
	return []string{"drive_connection.changed"}
}

func (c driveRevocationConsumer) Handle(ctx context.Context, ev outbox.Row) error {
	if c.s == nil || c.s.q == nil || c.s.pool == nil || !c.s.RevocationAvailable() {
		return nil
	}
	var payload struct {
		ConnectionID string `json:"connection_id"`
	}
	if err := json.Unmarshal([]byte(ev.Payload), &payload); err != nil || payload.ConnectionID == "" || !ev.OrganizationID.Valid {
		return nil
	}
	row, err := c.s.q.GetDriveConnectionSubByID(ctx, db.GetDriveConnectionSubByIDParams{
		ID:             payload.ConnectionID,
		OrganizationID: ev.OrganizationID.String,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if !row.DisconnectedAt.Valid || row.GoogleSub == "" {
		return nil
	}
	return c.s.processOneRevocationForConsumer(ctx, row.GoogleSub)
}

func (s *DriveConnectionService) processOneRevocationForConsumer(ctx context.Context, googleSub string) error {
	if s == nil || s.q == nil || s.pool == nil || !s.RevocationAvailable() || googleSub == "" {
		return nil
	}
	claimed, ok, err := s.claimRevocationAttempt(ctx, googleSub)
	if err != nil {
		return err
	}
	if !ok {
		return nil
	}
	if s.executeClaimedRevocation(ctx, googleSub, claimed) {
		return nil
	}
	return errors.New("drive grant revocation attempt failed; retry scheduled")
}

// cleanUpDriveGrantsAfterCommit triggers immediate post-commit revocation for
// the google_subs disconnected during an organization close, invitation switch
// or account deletion (spec §5.3a, R1-7).
func cleanUpDriveGrantsAfterCommit(ctx context.Context, drive *DriveConnectionService, subs []string) {
	if drive == nil || len(subs) == 0 {
		return
	}
	if drive.testBeforePostCommitClean != nil {
		drive.testBeforePostCommitClean(subs)
	}
	timeout := driveRevocationPostCommitTimeout
	if drive.postCommitTimeout > 0 {
		timeout = drive.postCommitTimeout
	}
	cleanCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), timeout)
	defer cancel()
	seen := make(map[string]bool, len(subs))
	for _, sub := range subs {
		if sub == "" || seen[sub] {
			continue
		}
		if cleanCtx.Err() != nil {
			break
		}
		seen[sub] = true
		drive.ProcessOneRevocation(cleanCtx, sub)
	}
}

// RunWorkers runs the background revocation worker and the hourly evidence
// purge until ctx is cancelled (spec §5.3b).
func (s *DriveConnectionService) RunWorkers(ctx context.Context) {
	if s == nil || s.q == nil || s.pool == nil {
		return
	}
	pollTick := time.NewTicker(driveRevocationPollInterval)
	purgeTick := time.NewTicker(driveRevocationPurgeInterval)
	defer pollTick.Stop()
	defer purgeTick.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-pollTick.C:
			s.ProcessDueRevocations(ctx)
		case <-purgeTick.C:
			_, _ = s.PurgeExpiredRevocations(ctx)
		}
	}
}

// ProcessDueRevocations claims and processes a batch of due revocation rows
// from drive_grant_revocations.
func (s *DriveConnectionService) ProcessDueRevocations(ctx context.Context) int {
	if s == nil || s.q == nil || s.pool == nil || !s.RevocationAvailable() {
		return 0
	}
	cutoff := pgtype.Timestamptz{Time: s.nowUTC().Add(-driveRevocationLeaseTTL), Valid: true}
	subs, err := s.q.ListDueDriveGrantRevocations(ctx, db.ListDueDriveGrantRevocationsParams{
		LeaseCutoff: cutoff,
		LimitN:      driveRevocationBatchLimit,
	})
	if err != nil {
		if ctx.Err() == nil {
			s.log.Warn("drive grant revocations list due", "err", err)
		}
		return 0
	}
	processed := 0
	for _, sub := range subs {
		if ctx.Err() != nil {
			break
		}
		if s.ProcessOneRevocation(ctx, sub) {
			processed++
		}
	}
	return processed
}

// ProcessOneRevocation runs the three-step §5.3b revocation state machine for
// googleSub:
//  1. Transaction 1 (under LockDriveGrantSub): inspect row; if pending, recount
//     live drive_connections for googleSub (delete/cancel if active owners exist);
//     if pending with 0 active owners or in-flight with expired lease, claim a
//     new attempt_id and stamp attempt_started_at = last_attempt_started_at = now().
//  2. Outside transaction: unseal refresh_token_enc ONLY to call provider.RevokeToken
//     with a 15s timeout.
//  3. Transaction 2 (under LockDriveGrantSub): resolve on (google_sub, generation,
//     attempt_id) when Google succeeded or returned 400 invalid_token, or when
//     the 24h retry window is exhausted (abandoning with metric + warn log).
func (s *DriveConnectionService) ProcessOneRevocation(ctx context.Context, googleSub string) bool {
	if s == nil || s.q == nil || s.pool == nil || !s.RevocationAvailable() || googleSub == "" {
		return false
	}
	claimed, ok, err := s.claimRevocationAttempt(ctx, googleSub)
	if err != nil {
		if ctx.Err() == nil {
			s.log.Warn("drive grant revocation claim", "code", "claim_failed", "err", err)
		}
		return false
	}
	if !ok {
		return false
	}
	return s.executeClaimedRevocation(ctx, googleSub, claimed)
}

func (s *DriveConnectionService) executeClaimedRevocation(ctx context.Context, googleSub string, claimed db.DriveGrantRevocation) bool {
	if s.testAfterRevocationClaimTx != nil {
		s.testAfterRevocationClaimTx(googleSub, claimed)
	}

	// Step 2: Outside any DB transaction, decrypt the token ONLY to call Google's
	// revoke endpoint (spec §5.3b step 2; held by TestDriveRevocationTokenOnlyRevokes).
	var revokeErr error
	token, err := s.openSecret(claimed.RefreshTokenEnc.String)
	if err != nil {
		revokeErr = errDriveRevocationUnsealFailed
	} else {
		revokeCtx, cancel := detachedStepContext(ctx, driveRevocationHTTPTimeout)
		revokeErr = s.tokenRevoker().RevokeToken(revokeCtx, token)
		cancel()
	}

	if s.testAfterRevokeGoogle != nil {
		revokeErr = s.testAfterRevokeGoogle(googleSub, claimed, revokeErr)
	}
	// Step 3: Transaction 2 under LockDriveGrantSub.
	if revokeErr == nil || errors.Is(revokeErr, ErrDriveRevokeAlreadyInvalid) {
		if err := s.resolveRevocationAttempt(ctx, claimed.GoogleSub, claimed.Generation, claimed.AttemptID.String, ""); err != nil {
			s.log.Warn("drive grant revocation resolve failed", "code", "resolve_tx_failed", "err", err)
			return false
		}
		return true
	}

	// Transient error (network, timeout, 5xx, non-invalid_token 4xx): check if
	// 24h retry budget since requested_at has elapsed (spec §5.3b step 3).
	if claimed.RequestedAt.Valid && s.nowUTC().Sub(claimed.RequestedAt.Time) >= driveRevocationAbandonWindow {
		lastErr := classifyRevokeErrorCode(revokeErr)
		if err := s.resolveRevocationAttempt(ctx, claimed.GoogleSub, claimed.Generation, claimed.AttemptID.String, lastErr); err != nil {
			s.log.Warn("drive grant revocation abandon tx failed", "code", "abandon_tx_failed", "err", err)
			return false
		}
		if s.metrics != nil {
			s.metrics.ObserveRevocationAbandoned()
		}
		s.log.Error("drive grant revocation abandoned after 24h",
			"code", "DriveRevocationAbandoned",
			"generation", claimed.Generation,
			"attempts", claimed.Attempts,
			"last_error", lastErr,
		)
		return true
	}

	// Keep the row in "revoking" state; once the 2-minute lease expires, the
	// next pass will re-claim it with a fresh attempt_id.
	s.log.Warn("drive grant revocation attempt failed; will retry after lease",
		"code", classifyRevokeErrorCode(revokeErr),
		"generation", claimed.Generation,
		"attempts", claimed.Attempts,
	)
	return false
}

func (s *DriveConnectionService) claimRevocationAttempt(ctx context.Context, googleSub string) (db.DriveGrantRevocation, bool, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return db.DriveGrantRevocation{}, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)

	if err := qtx.LockDriveGrantSub(ctx, googleSub); err != nil {
		return db.DriveGrantRevocation{}, false, err
	}

	row, err := qtx.GetDriveGrantRevocationForUpdate(ctx, googleSub)
	if errors.Is(err, pgx.ErrNoRows) {
		return db.DriveGrantRevocation{}, false, nil
	}
	if err != nil {
		return db.DriveGrantRevocation{}, false, err
	}

	// Nothing to claim if resolved or no token is stored.
	if row.ResolvedAt.Valid || !row.RefreshTokenEnc.Valid || row.RefreshTokenEnc.String == "" {
		return db.DriveGrantRevocation{}, false, nil
	}

	leaseCutoff := s.nowUTC().Add(-driveRevocationLeaseTTL)
	if !row.AttemptID.Valid {
		// Pending state: recount live owners across all organizations (spec §5.3b step 1).
		activeCount, err := qtx.CountActiveDriveConnectionsBySub(ctx, googleSub)
		if err != nil {
			return db.DriveGrantRevocation{}, false, err
		}
		if activeCount > 0 {
			if !row.LastAttemptStartedAt.Valid && !row.LastResolvedAt.Valid {
				if err := qtx.DeleteDriveGrantRevocationIfNoEvidence(ctx, googleSub); err != nil {
					return db.DriveGrantRevocation{}, false, err
				}
			} else {
				if err := qtx.CancelPendingDriveGrantRevocation(ctx, googleSub); err != nil {
					return db.DriveGrantRevocation{}, false, err
				}
			}
			if err := tx.Commit(ctx); err != nil {
				return db.DriveGrantRevocation{}, false, err
			}
			return db.DriveGrantRevocation{}, false, nil
		}
	} else {
		// In-flight ("revoking") state: only reclaim if lease expired; do NOT
		// recount active owners because an earlier attempt already started at Google.
		if !row.AttemptStartedAt.Valid || !row.AttemptStartedAt.Time.Before(leaseCutoff) {
			return db.DriveGrantRevocation{}, false, nil
		}
	}

	attemptID := util.NewID()
	claimed, err := qtx.ClaimDriveGrantRevocationAttempt(ctx, db.ClaimDriveGrantRevocationAttemptParams{
		AttemptID:   pgtype.Text{String: attemptID, Valid: true},
		GoogleSub:   googleSub,
		LeaseCutoff: pgtype.Timestamptz{Time: leaseCutoff, Valid: true},
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return db.DriveGrantRevocation{}, false, nil
	}
	if err != nil {
		return db.DriveGrantRevocation{}, false, err
	}

	if err := tx.Commit(ctx); err != nil {
		return db.DriveGrantRevocation{}, false, err
	}
	return claimed, true, nil
}

func (s *DriveConnectionService) resolveRevocationAttempt(ctx context.Context, googleSub string, generation int64, attemptID, lastError string) error {
	if s.testBeforeResolveTx != nil {
		if err := s.testBeforeResolveTx(googleSub, generation, attemptID); err != nil {
			return err
		}
	}
	timeout := driveRevocationResolveTimeout
	if s.resolveTimeout > 0 {
		timeout = s.resolveTimeout
	}
	resolveCtx, cancel := detachedStepContext(ctx, timeout)
	defer cancel()
	ctx = resolveCtx
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	qtx := s.q.WithTx(tx)

	if err := qtx.LockDriveGrantSub(ctx, googleSub); err != nil {
		return err
	}

	_, err = qtx.ResolveDriveGrantRevocationAttempt(ctx, db.ResolveDriveGrantRevocationAttemptParams{
		GoogleSub:  googleSub,
		Generation: generation,
		AttemptID:  pgtype.Text{String: attemptID, Valid: true},
		LastError:  lastError,
	})
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// detachedStepContext detaches ctx from caller cancellation while preserving
// any existing deadline on ctx that is sooner than stepTimeout (R3-6).
func detachedStepContext(ctx context.Context, stepTimeout time.Duration) (context.Context, context.CancelFunc) {
	if dl, ok := ctx.Deadline(); ok {
		if rem := time.Until(dl); rem < stepTimeout {
			stepTimeout = rem
		}
	}
	return context.WithTimeout(context.WithoutCancel(ctx), stepTimeout)
}

// PurgeExpiredRevocations deletes resolved or cancelled drive_grant_revocations
// rows that hold no token and whose requested_at, last_attempt_started_at and
// last_resolved_at are all older than 1 day (spec §5.3b).
func (s *DriveConnectionService) PurgeExpiredRevocations(ctx context.Context) (int64, error) {
	if s == nil || s.q == nil {
		return 0, nil
	}
	cutoff := pgtype.Timestamptz{
		Time:  s.nowUTC().Add(-driveRevocationEvidenceRetention),
		Valid: true,
	}
	return s.q.PurgeExpiredDriveGrantRevocations(ctx, cutoff)
}

func classifyRevokeErrorCode(err error) string {
	switch {
	case err == nil:
		return ""
	case errors.Is(err, errDriveRevocationUnsealFailed):
		return "unseal_failed"
	case errors.Is(err, context.DeadlineExceeded):
		return "timeout"
	default:
		return "provider_revoke_failed"
	}
}
