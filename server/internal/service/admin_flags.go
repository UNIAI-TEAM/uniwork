package service

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/featureflags"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Flag overrides (F-11 §7): the console writes feature_flag_overrides, the
// DB provider on every node drops its cache on the flag.updated event.

const maxUserOverrideTTL = 30 * 24 * time.Hour

// FlagWithCount is a catalogue entry plus its live override count.
type FlagWithCount struct {
	featureflags.Flag
	OverrideCount int64
}

func (s *AdminService) ListFlags(ctx context.Context) ([]FlagWithCount, error) {
	counts, err := s.q.CountFlagOverridesByKey(ctx)
	if err != nil {
		return nil, err
	}
	byKey := make(map[string]int64, len(counts))
	for _, c := range counts {
		byKey[c.FlagKey] = c.N
	}
	cat := featureflags.Catalogue()
	out := make([]FlagWithCount, 0, len(cat))
	for _, f := range cat {
		out = append(out, FlagWithCount{Flag: f, OverrideCount: byKey[f.Key]})
	}
	return out, nil
}

// ListAllFlagOverrides is what the Flags screen reads: one round trip for the
// whole catalogue instead of one request per row.
func (s *AdminService) ListAllFlagOverrides(ctx context.Context) ([]db.FeatureFlagOverride, error) {
	return s.q.AdminListAllFlagOverrides(ctx)
}

func (s *AdminService) ListFlagOverrides(ctx context.Context, key string) ([]db.FeatureFlagOverride, error) {
	if _, ok := featureflags.Lookup(key); !ok {
		return nil, ErrNotFound
	}
	return s.q.ListFlagOverridesByKey(ctx, key)
}

// FlagOverrideInput is one override to write.
type FlagOverrideInput struct {
	ScopeType string
	ScopeID   string
	Enabled   bool
	ExpiresAt *time.Time
	Reason    string
}

func validateScope(scopeType, scopeID string, expires *time.Time, now time.Time) error {
	switch scopeType {
	case featureflags.ScopeGlobal:
		if scopeID != "" {
			return Invalid("scope_id phải rỗng với global")
		}
	case featureflags.ScopeOrganization:
		if scopeID == "" {
			return Invalid("scope_id bắt buộc với organization")
		}
	case featureflags.ScopeUser:
		if scopeID == "" {
			return Invalid("scope_id bắt buộc với user")
		}
		if expires == nil || expires.After(now.Add(maxUserOverrideTTL)) || !expires.After(now) {
			return Invalid("override theo user cần expires_at trong vòng 30 ngày")
		}
	default:
		return Invalid("scope_type phải là organization, user hoặc global")
	}
	return nil
}

// SetFlagOverride upserts one override and returns the key's overrides.
func (s *AdminService) SetFlagOverride(ctx context.Context, adminID, key string, in FlagOverrideInput) ([]db.FeatureFlagOverride, error) {
	if _, ok := featureflags.Lookup(key); !ok {
		return nil, ErrNotFound
	}
	if err := checkReason(in.Reason); err != nil {
		return nil, err
	}
	if err := validateScope(in.ScopeType, in.ScopeID, in.ExpiresAt, time.Now()); err != nil {
		return nil, err
	}
	ctx, traceID := ensureTrace(ctx)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	before := map[string]any{}
	if prev, err := q.GetFlagOverride(ctx, db.GetFlagOverrideParams{FlagKey: key, ScopeType: in.ScopeType, ScopeID: in.ScopeID}); err == nil {
		before["enabled"] = prev.Enabled
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	var expires pgtype.Timestamptz
	if in.ExpiresAt != nil {
		expires = pgtype.Timestamptz{Time: *in.ExpiresAt, Valid: true}
	}
	if _, err := q.UpsertFlagOverride(ctx, db.UpsertFlagOverrideParams{
		ID: util.NewID(), FlagKey: key, ScopeType: in.ScopeType, ScopeID: in.ScopeID,
		Enabled: in.Enabled, Note: strings.TrimSpace(in.Reason), CreatedBy: adminID, ExpiresAt: expires,
	}); err != nil {
		return nil, err
	}
	after := map[string]any{"enabled": in.Enabled, "scope_type": in.ScopeType, "scope_id": in.ScopeID}
	if err := s.recordAdmin(ctx, q, traceID, adminID, audit.ActionFlagOverrideSet, "flag", key, before, after, in.Reason); err != nil {
		return nil, err
	}
	if err := s.auditFlag(ctx, q, adminID, audit.ActionFlagOverrideSet, key, in.ScopeType, in.ScopeID, before, after, in.Reason); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.q.ListFlagOverridesByKey(ctx, key)
}

// DeleteFlagOverride removes one override; missing is ErrNotFound.
func (s *AdminService) DeleteFlagOverride(ctx context.Context, adminID, key, scopeType, scopeID, reason string) ([]db.FeatureFlagOverride, error) {
	if _, ok := featureflags.Lookup(key); !ok {
		return nil, ErrNotFound
	}
	if err := checkReason(reason); err != nil {
		return nil, err
	}
	ctx, traceID := ensureTrace(ctx)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	q := s.q.WithTx(tx)
	prev, err := q.GetFlagOverride(ctx, db.GetFlagOverrideParams{FlagKey: key, ScopeType: scopeType, ScopeID: scopeID})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	if _, err := q.DeleteFlagOverride(ctx, db.DeleteFlagOverrideParams{FlagKey: key, ScopeType: scopeType, ScopeID: scopeID}); err != nil {
		return nil, err
	}
	before := map[string]any{"enabled": prev.Enabled, "scope_type": scopeType, "scope_id": scopeID}
	if err := s.recordAdmin(ctx, q, traceID, adminID, audit.ActionFlagOverrideDeleted, "flag", key, before, map[string]any{}, reason); err != nil {
		return nil, err
	}
	if err := s.auditFlag(ctx, q, adminID, audit.ActionFlagOverrideDeleted, key, scopeType, scopeID, before, nil, reason); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.q.ListFlagOverridesByKey(ctx, key)
}

// auditFlag writes the audit row (scoped to the organization for an
// organization override, to the platform sentinel otherwise) and the
// flag.updated event every node's provider listens for.
func (s *AdminService) auditFlag(ctx context.Context, q *db.Queries, adminID, action, key, scopeType, scopeID string, before, after map[string]any, reason string) error {
	orgID := audit.NoOrganization
	if scopeType == featureflags.ScopeOrganization {
		orgID = scopeID
	}
	return auditRecorder.Record(ctx, q, audit.Entry{
		OrganizationID: orgID,
		Actor:          audit.User(adminID),
		Action:         action,
		ResourceType:   "flag", ResourceID: key,
		Changes:  audit.Diff(before, after),
		Metadata: map[string]any{"reason": reason, "scope_type": scopeType, "scope_id": scopeID},
	}, audit.Event{Topic: "flag.updated", Payload: map[string]string{"flag_key": key}, OrganizationID: orgID})
}
