package service

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// retentionScanInterval is how often the marker counts expired rows. Daily:
// the number moves slowly, and the job exists to make a policy visible, not to
// react to anything.
const retentionScanInterval = 24 * time.Hour

// ExpiryCounter receives, per organization, how many audit rows are past the
// retention window. Declared here so this package does not import Prometheus.
type ExpiryCounter interface {
	SetAuditExpired(organizationID string, count float64)
}

// RunRetentionMarker counts rows past each organization's window and reports
// them. It deliberately deletes nothing.
//
// Deleting audit rows is not reversible and cannot be rehearsed by trying it,
// so the erasing half is an archive job with its own database role, written
// with a restore drill (ADR 0012). Until then the number is what tells an
// operator that a policy is doing something — a retention setting nobody can
// see the effect of is a checkbox, not a control.
func (s *AuditService) RunRetentionMarker(ctx context.Context, counter ExpiryCounter) {
	t := time.NewTicker(retentionScanInterval)
	defer t.Stop()
	s.markExpired(ctx, counter)
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			s.markExpired(ctx, counter)
		}
	}
}

func (s *AuditService) markExpired(ctx context.Context, counter ExpiryCounter) {
	orgs, err := s.q.ListAuditOrganizations(ctx)
	if err != nil {
		slog.Warn("audit retention: list organizations", "err", err)
		return
	}
	for _, orgID := range orgs {
		days := int32(retentionDefaultDays)
		if p, err := s.q.GetAuditRetentionPolicy(ctx, orgID); err == nil {
			days = p.RetainDays
		}
		cutoff := time.Now().UTC().AddDate(0, 0, -int(days))
		n, err := s.q.CountAuditEventsOlderThan(ctx, db.CountAuditEventsOlderThanParams{
			OrganizationID: orgID,
			OccurredAt:     pgtype.Timestamptz{Time: cutoff, Valid: true},
		})
		if err != nil {
			slog.Warn("audit retention: count expired", "organization", orgID, "err", err)
			continue
		}
		if counter != nil {
			counter.SetAuditExpired(orgID, float64(n))
		}
		if n > 0 {
			slog.Info("audit retention: rows past the window",
				"organization", orgID, "retain_days", days, "expired", n)
		}
	}
}
