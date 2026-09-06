package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/unicomhub/uniwork/server/internal/audit"
	"github.com/unicomhub/uniwork/server/internal/util"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Feature keys are the vocabulary every gate speaks (features table, F-02).
// Plan codes never appear in code: a gate asks Can(feature) or
// CheckQuota(meter), and the plan decides (scripts/no-plan-literal.test.mjs).
const (
	FeatureMembersMax       = "members.max"
	FeatureWorkspacesMax    = "workspaces.max"
	FeatureMeetingMinutes   = "meeting.participant_minutes"
	FeatureMeetingRecording = "meeting.recording"
	FeatureMeetingAISummary = "meeting.ai_summary"
)

// wiredFeatures have a consumer in this codebase (a gate or a meter call).
// The rest are seeded for later specs; the client hides them so a "0 /
// unlimited" row never claims a number nobody writes. Add a key here in the
// same change that adds its first Consume/Can call.
var wiredFeatures = map[string]bool{
	FeatureMembersMax: true, FeatureWorkspacesMax: true, FeatureMeetingMinutes: true,
	FeatureMeetingRecording: true, FeatureMeetingAISummary: true,
}

// graceFeatures stay effective when the subscription is inactive, so an
// organization that stopped paying can still read what it has.
var graceFeatures = map[string]bool{FeatureMembersMax: true}

// pastDueGrace: OPEN_QUESTIONS B3 — past_due keeps working for seven days
// after the period ended, then behaves like suspended.
const pastDueGrace = 7 * 24 * time.Hour

// Entitlement is one feature as it applies to an organization right now.
type Entitlement struct {
	Key       string
	Name      string
	Kind      string // flag | quota
	Unit      string
	Category  string
	MeterMode string // accumulate | snapshot
	Enabled   bool
	Limit     *int64 // nil = unlimited; 0 = off
	Current   int64
	Metered   bool // something in this codebase reads or writes this feature
}

// EntitlementSnapshot is what GET /orgs/{org}/billing returns.
type EntitlementSnapshot struct {
	Subscription db.Subscription
	Plan         db.Plan
	Entitlements []Entitlement
}

// ConsumeInput describes one usage delta on a meter.
type ConsumeInput struct {
	OrganizationID string
	WorkspaceID    string
	Meter          string
	Delta          int64
	Actor          Actor
	RefType        string
	RefID          string
	IdempotencyKey string
}

// EntitlementService is the quota gate. Every consumer calls it inside its
// own transaction so a refused delta rolls the business write back with it.
type EntitlementService struct {
	pool *pgxpool.Pool
	q    *db.Queries
}

func NewEntitlementService(pool *pgxpool.Pool, q *db.Queries) *EntitlementService {
	return &EntitlementService{pool: pool, q: q}
}

func errEntitlementRequired(feature string) error {
	return CodedError{Code: "entitlement_required", Status: http.StatusForbidden, Err: ErrEntitlementRequired,
		Msg: "gói hiện tại không bao gồm tính năng này", Fields: map[string]any{"feature": feature}}
}

func errQuotaExceeded(meter string, limit, current, delta int64) error {
	return CodedError{Code: "quota_exceeded", Status: http.StatusForbidden, Err: ErrQuotaExceeded,
		Msg: "đã hết hạn mức của gói hiện tại", Fields: map[string]any{"meter": meter, "limit": limit, "current": current, "delta": delta}}
}

func errSubscriptionInactive(status string) error {
	return CodedError{Code: "subscription_inactive", Status: http.StatusForbidden, Err: ErrSubscriptionInactive,
		Msg: "thuê bao của tổ chức không còn hiệu lực", Fields: map[string]any{"status": status}}
}

// subscriptionActive says whether the plan's entitlements apply at `now`.
func subscriptionActive(sub db.Subscription, now time.Time) bool {
	switch sub.Status {
	case "active", "trialing":
		return true
	case "past_due":
		ended := sub.UpdatedAt.Time
		if sub.CurrentPeriodEnd.Valid {
			ended = sub.CurrentPeriodEnd.Time
		}
		return now.Before(ended.Add(pastDueGrace))
	}
	return false
}

// effective is the one place the formula lives (spec §4.2):
// override > plan row > fail-closed; an inactive subscription zeroes
// everything except graceFeatures.
func effective(sub db.Subscription, rows []db.ListPlanFeaturesRow, now time.Time) []Entitlement {
	var overrides map[string]any
	_ = json.Unmarshal(sub.Overrides, &overrides)
	active := subscriptionActive(sub, now)
	out := make([]Entitlement, 0, len(rows))
	for _, r := range rows {
		e := Entitlement{Key: r.FeatureKey, Name: r.Name, Kind: r.Kind, Unit: r.Unit.String,
			Category: r.Category, MeterMode: r.MeterMode, Enabled: r.Enabled, Metered: wiredFeatures[r.FeatureKey]}
		if r.QuotaLimit.Valid {
			v := r.QuotaLimit.Int64
			e.Limit = &v
		}
		if ov, ok := overrides[r.FeatureKey]; ok {
			switch v := ov.(type) {
			case bool:
				e.Enabled = v
			case float64:
				n := int64(v)
				e.Limit = &n
				e.Enabled = true
			case nil:
				e.Limit = nil
				e.Enabled = true
			}
		}
		if !active && !graceFeatures[r.FeatureKey] {
			e.Enabled = false
			zero := int64(0)
			e.Limit = &zero
		}
		out = append(out, e)
	}
	return out
}

// lookup is fail-closed: a feature the plan does not declare does not exist.
func lookup(ents []Entitlement, key string) (Entitlement, bool) {
	for _, e := range ents {
		if e.Key == key {
			return e, true
		}
	}
	return Entitlement{}, false
}

func (s *EntitlementService) entitlements(ctx context.Context, q *db.Queries, sub db.Subscription) ([]Entitlement, error) {
	rows, err := q.ListPlanFeatures(ctx, sub.PlanID)
	if err != nil {
		return nil, err
	}
	return effective(sub, rows, time.Now()), nil
}

// live loads the organization's subscription; none means no entitlement at all.
func (s *EntitlementService) live(ctx context.Context, q *db.Queries, orgID, feature string, lock bool) (db.Subscription, error) {
	var sub db.Subscription
	var err error
	if lock {
		sub, err = q.LockLiveSubscription(ctx, orgID)
	} else {
		sub, err = q.GetLiveSubscription(ctx, orgID)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return db.Subscription{}, errEntitlementRequired(feature)
	}
	return sub, err
}

func (s *EntitlementService) entitlement(ctx context.Context, q *db.Queries, orgID, feature string, lock bool) (db.Subscription, Entitlement, error) {
	sub, err := s.live(ctx, q, orgID, feature, lock)
	if err != nil {
		return db.Subscription{}, Entitlement{}, err
	}
	ents, err := s.entitlements(ctx, q, sub)
	if err != nil {
		return db.Subscription{}, Entitlement{}, err
	}
	e, ok := lookup(ents, feature)
	if !ok || !e.Enabled {
		if !subscriptionActive(sub, time.Now()) && !graceFeatures[feature] {
			return db.Subscription{}, Entitlement{}, errSubscriptionInactive(sub.Status)
		}
		return db.Subscription{}, Entitlement{}, errEntitlementRequired(feature)
	}
	return sub, e, nil
}

// Can: ErrEntitlementRequired when the flag is off or undeclared.
func (s *EntitlementService) Can(ctx context.Context, orgID, feature string) error {
	_, _, err := s.entitlement(ctx, s.q, orgID, feature, false)
	return err
}

// snapshotCount is the current value of a meter that counts a source table.
func snapshotCount(ctx context.Context, q *db.Queries, orgID, meter string) (int64, error) {
	switch meter {
	case FeatureMembersMax:
		return q.CountOrganizationMembers(ctx, orgID)
	case FeatureWorkspacesMax:
		return q.CountWorkspacesInOrganization(ctx, orgID)
	}
	return 0, nil
}

func (s *EntitlementService) current(ctx context.Context, q *db.Queries, sub db.Subscription, e Entitlement) (int64, error) {
	if e.MeterMode == "snapshot" {
		return snapshotCount(ctx, q, sub.OrganizationID, e.Key)
	}
	c, err := q.GetUsageCounter(ctx, db.GetUsageCounterParams{OrganizationID: sub.OrganizationID, MeterKey: e.Key, PeriodStart: sub.CurrentPeriodStart})
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, nil
	}
	return c.Total, err
}

// CheckQuota reads only: would `delta` more fit under the limit?
func (s *EntitlementService) CheckQuota(ctx context.Context, orgID, meter string, delta int64) error {
	sub, e, err := s.entitlement(ctx, s.q, orgID, meter, false)
	if err != nil {
		return err
	}
	if e.Limit == nil {
		return nil
	}
	cur, err := s.current(ctx, s.q, sub, e)
	if err != nil {
		return err
	}
	if cur+delta > *e.Limit {
		return errQuotaExceeded(meter, *e.Limit, cur, delta)
	}
	return nil
}

// Consume = check + record, on the caller's transaction (q must be WithTx).
// Snapshot meters lock the subscription row and count; accumulate meters
// write the event and bump the counter in one guarded statement.
func (s *EntitlementService) Consume(ctx context.Context, q *db.Queries, in ConsumeInput) error {
	return s.consume(ctx, q, in, true)
}

// RecordUsage meters something that already happened (minutes spent in a
// meeting) — it never refuses, but still moves the counter and fires the
// threshold events.
func (s *EntitlementService) RecordUsage(ctx context.Context, q *db.Queries, in ConsumeInput) error {
	return s.consume(ctx, q, in, false)
}

func (s *EntitlementService) consume(ctx context.Context, q *db.Queries, in ConsumeInput, enforce bool) error {
	sub, e, err := s.entitlement(ctx, q, in.OrganizationID, in.Meter, enforce)
	if err != nil {
		if !enforce && (errors.Is(err, ErrEntitlementRequired) || errors.Is(err, ErrSubscriptionInactive)) {
			return nil // nothing to meter against; the plan does not know this meter
		}
		return err
	}
	if e.MeterMode == "snapshot" {
		if !enforce || e.Limit == nil {
			return nil
		}
		cur, err := snapshotCount(ctx, q, in.OrganizationID, in.Meter)
		if err != nil {
			return err
		}
		if cur+in.Delta > *e.Limit {
			return errQuotaExceeded(in.Meter, *e.Limit, cur, in.Delta)
		}
		return nil
	}
	if in.IdempotencyKey != "" {
		n, err := q.InsertUsageEvent(ctx, usageEventParams(in))
		if err != nil {
			return err
		}
		if n == 0 {
			return nil // already metered
		}
	} else if _, err := q.InsertUsageEvent(ctx, usageEventParams(in)); err != nil {
		return err
	}
	var limit pgtype.Int8
	if enforce && e.Limit != nil {
		limit = pgtype.Int8{Int64: *e.Limit, Valid: true}
		if in.Delta > *e.Limit { // first row of the period would already exceed
			cur, err := s.current(ctx, q, sub, e)
			if err != nil {
				return err
			}
			return errQuotaExceeded(in.Meter, *e.Limit, cur, in.Delta)
		}
	}
	row, err := q.AddUsageWithinLimit(ctx, db.AddUsageWithinLimitParams{
		OrganizationID: in.OrganizationID, MeterKey: in.Meter, PeriodStart: sub.CurrentPeriodStart,
		Total: in.Delta, LimitTotal: limit,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		cur, cerr := s.current(ctx, q, sub, e)
		if cerr != nil {
			return cerr
		}
		return errQuotaExceeded(in.Meter, *e.Limit, cur, in.Delta)
	}
	if err != nil {
		return err
	}
	return s.notifyThreshold(ctx, q, in, e, row)
}

func usageEventParams(in ConsumeInput) db.InsertUsageEventParams {
	kind := string(in.Actor.Kind)
	if kind == "" {
		kind = string(audit.KindSystem)
	}
	return db.InsertUsageEventParams{
		ID: util.NewID(), OrganizationID: in.OrganizationID, WorkspaceID: strText(in.WorkspaceID),
		MeterKey: in.Meter, Delta: in.Delta, ActorID: strText(in.Actor.ID), ActorKind: kind,
		RefType: strText(in.RefType), RefID: strText(in.RefID), IdempotencyKey: strText(in.IdempotencyKey),
	}
}

// notifyThreshold fires quota.threshold once per level per period, to every
// owner/admin of the organization (spec §6). The client only invalidates;
// the warning UI is C-05.
func (s *EntitlementService) notifyThreshold(ctx context.Context, q *db.Queries, in ConsumeInput, e Entitlement, row db.UsageCounter) error {
	if e.Limit == nil || *e.Limit <= 0 {
		return nil
	}
	level := 0
	switch {
	case row.Total*100 >= *e.Limit*100 && !row.Notified100At.Valid:
		level = 100
	case row.Total*100 >= *e.Limit*80 && !row.Notified80At.Valid:
		level = 80
	default:
		return nil
	}
	if err := q.MarkUsageThresholdNotified(ctx, db.MarkUsageThresholdNotifiedParams{
		OrganizationID: in.OrganizationID, MeterKey: in.Meter, PeriodStart: row.PeriodStart, Level: int32(level),
	}); err != nil {
		return err
	}
	admins, err := q.ListOrgAdminUserIDs(ctx, in.OrganizationID)
	if err != nil {
		return err
	}
	evs := make([]audit.Event, 0, len(admins))
	for _, uid := range admins {
		// Payloads carry ids only; the meter and level are on the counter row
		// the consumer refetches through the billing snapshot.
		evs = append(evs, audit.Event{Topic: "quota.threshold", OrganizationID: in.OrganizationID, Payload: map[string]string{
			"organization_id": in.OrganizationID, "user_id": uid,
		}})
	}
	if len(evs) == 0 {
		return nil
	}
	return auditRecorder.Emit(ctx, q, audit.System("quota.threshold"), evs...)
}

// Snapshot: plan + effective entitlements + current usage of the organization.
func (s *EntitlementService) Snapshot(ctx context.Context, orgID string) (EntitlementSnapshot, error) {
	sub, err := s.live(ctx, s.q, orgID, "", false)
	if err != nil {
		return EntitlementSnapshot{}, err
	}
	plan, err := s.q.GetPlanByID(ctx, sub.PlanID)
	if err != nil {
		return EntitlementSnapshot{}, err
	}
	ents, err := s.entitlements(ctx, s.q, sub)
	if err != nil {
		return EntitlementSnapshot{}, err
	}
	counters, err := s.q.ListUsageCounters(ctx, db.ListUsageCountersParams{OrganizationID: orgID, PeriodStart: sub.CurrentPeriodStart})
	if err != nil {
		return EntitlementSnapshot{}, err
	}
	totals := map[string]int64{}
	for _, c := range counters {
		totals[c.MeterKey] = c.Total
	}
	for i := range ents {
		e := &ents[i]
		if e.Kind != "quota" {
			continue
		}
		if e.MeterMode == "snapshot" {
			n, err := snapshotCount(ctx, s.q, orgID, e.Key)
			if err != nil {
				return EntitlementSnapshot{}, err
			}
			e.Current = n
		} else {
			e.Current = totals[e.Key]
		}
	}
	return EntitlementSnapshot{Subscription: sub, Plan: plan, Entitlements: ents}, nil
}
