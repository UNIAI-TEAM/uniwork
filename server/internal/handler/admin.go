package handler

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdi"
	"github.com/unicomhub/uniwork/server/internal/handler/dto/sdo"
	"github.com/unicomhub/uniwork/server/internal/middleware"
	"github.com/unicomhub/uniwork/server/internal/service"
	db "github.com/unicomhub/uniwork/server/pkg/db/generated"
)

// Platform admin console (spec F-11 §5.2). Every route sits behind
// RequirePlatformRole; none of them goes through RequireMember and none
// returns content — metadata only.

func (h *handlers) adminMe(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, 200, sdo.AdminMeSDO{PlatformRole: middleware.PlatformRoleFromContext(r.Context())})
}

func (h *handlers) adminListOrganizations(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	offset, _ := strconv.Atoi(q.Get("offset"))
	page, err := h.Admin.ListOrganizations(r.Context(), service.ListOrganizationsInput{
		Query: q.Get("q"), Status: q.Get("status"), Sort: q.Get("sort"),
		Limit: int32(limit), Offset: int32(offset),
	})
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := make([]sdo.AdminOrganizationDTO, 0, len(page.Organizations))
	for _, o := range page.Organizations {
		out = append(out, sdo.AdminOrganizationDTO{
			ID: o.ID, Slug: o.Slug, Name: o.Name, Status: o.Status, PlanCode: o.PlanCode,
			MemberCount: o.MemberCount, WorkspaceCount: o.WorkspaceCount,
			CreatedAt: o.CreatedAt.Time.Format(time.RFC3339), LastActivityAt: optTimePtr(o.LastActivityAt),
		})
	}
	respondJSON(w, 200, sdo.AdminOrganizationListSDO{
		Organizations: out, Total: page.Total, Limit: page.Limit, Offset: page.Offset,
	})
}

func (h *handlers) adminGetOrganization(w http.ResponseWriter, r *http.Request) {
	d, err := h.Admin.GetOrganization(r.Context(), chi.URLParam(r, "orgID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	o := d.Organization
	out := sdo.AdminOrganizationDetailSDO{
		Organization: sdo.AdminOrganizationDTO{
			ID: o.ID, Slug: o.Slug, Name: o.Name, Status: o.Status, PlanCode: o.PlanCode,
			MemberCount: o.MemberCount, WorkspaceCount: o.WorkspaceCount,
			CreatedAt: o.CreatedAt.Time.Format(time.RFC3339), LastActivityAt: optTimePtr(o.LastActivityAt),
		},
		SuspendedAt:  optTimePtr(o.SuspendedAt),
		Entitlements: make([]sdo.AdminEntitlementDTO, 0, len(d.Entitlements)),
		Actions:      toAdminActions(d.Actions),
	}
	if o.SuspendedReason.Valid {
		out.SuspendedReason = &o.SuspendedReason.String
	}
	for _, e := range d.Entitlements {
		out.Entitlements = append(out.Entitlements, sdo.AdminEntitlementDTO{Key: e.Key, Kind: e.Kind, Enabled: e.Enabled, Limit: e.Limit, Current: e.Current})
	}
	respondJSON(w, 200, out)
}

func (h *handlers) adminSuspendOrganization(w http.ResponseWriter, r *http.Request) {
	h.adminSetStatus(w, r, service.OrganizationSuspended)
}

func (h *handlers) adminUnsuspendOrganization(w http.ResponseWriter, r *http.Request) {
	h.adminSetStatus(w, r, service.OrganizationActive)
}

func (h *handlers) adminSetStatus(w http.ResponseWriter, r *http.Request, status string) {
	var in sdi.ReasonSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	o, err := h.Admin.SetOrganizationStatus(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "orgID"), status, in.Reason)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, sdo.AdminOrganizationSDO{Organization: sdo.AdminOrganizationDTO{
		ID: o.ID, Slug: o.Slug, Name: o.Name, Status: o.Status, CreatedAt: o.CreatedAt.Time.Format(time.RFC3339),
	}})
}

func (h *handlers) adminChangePlan(w http.ResponseWriter, r *http.Request) {
	var in sdi.AdminChangePlanSDI
	if !decode(w, r, &in, maxJSONBody) {
		return
	}
	snap, err := h.Admin.ChangePlan(r.Context(), middleware.UserID(r.Context()), chi.URLParam(r, "orgID"), in.PlanCode, in.Reason)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	respondJSON(w, 200, toSubscriptionSDO(snap))
}

func (h *handlers) adminTrace(w http.ResponseWriter, r *http.Request) {
	t, err := h.Admin.Trace(r.Context(), chi.URLParam(r, "traceID"))
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.AdminTraceSDO{TraceID: t.TraceID, Audit: []sdo.AdminTraceAuditDTO{}, Outbox: []sdo.AdminTraceOutboxDTO{}, Actions: toAdminActions(t.Actions)}
	for _, a := range t.Audit {
		out.Audit = append(out.Audit, sdo.AdminTraceAuditDTO{
			ID: a.ID, OrganizationID: a.OrganizationID, WorkspaceID: a.WorkspaceID.String,
			ActorKind: a.ActorKind, ActorID: a.ActorID, Action: a.Action,
			ResourceType: a.ResourceType, ResourceID: a.ResourceID, OccurredAt: a.OccurredAt.Time.Format(time.RFC3339),
		})
	}
	for _, o := range t.Outbox {
		out.Outbox = append(out.Outbox, sdo.AdminTraceOutboxDTO{
			ID: o.ID, Topic: o.Topic, Status: o.Status, Attempts: o.Attempts, LastError: o.LastError.String,
			CreatedAt: o.CreatedAt.Time.Format(time.RFC3339), DoneAt: optTime(o.DoneAt), DeadAt: optTime(o.DeadAt),
		})
	}
	respondJSON(w, 200, out)
}

func (h *handlers) adminSystem(w http.ResponseWriter, r *http.Request) {
	s, err := h.Admin.System(r.Context(), h.Version, h.Commit)
	if err != nil {
		h.mapServiceError(w, err)
		return
	}
	out := sdo.AdminSystemSDO{
		Version: s.Version, Commit: s.Commit, MigrationEmbedded: s.MigrationEmbedded,
		Readiness:     sdo.ReadinessSDO{Ready: s.Readiness.Ready, Checks: make([]sdo.ReadinessCheckSDO, 0, len(s.Readiness.Checks))},
		OutboxPending: s.OutboxPending, OutboxDead: s.OutboxDead, OutboxOldestAge: s.OutboxOldestAge,
		RealtimeConns: s.RealtimeConns, FlagProviders: s.FlagProviders,
	}
	if out.FlagProviders == nil {
		out.FlagProviders = []string{}
	}
	for _, c := range s.Readiness.Checks {
		out.Readiness.Checks = append(out.Readiness.Checks, sdo.ReadinessCheckSDO{Name: c.Name, OK: c.OK, Detail: c.Detail})
	}
	respondJSON(w, 200, out)
}

func toAdminActions(rows []db.AdminAction) []sdo.AdminActionDTO {
	out := make([]sdo.AdminActionDTO, 0, len(rows))
	for _, a := range rows {
		var before, after map[string]any
		_ = json.Unmarshal(a.Before, &before)
		_ = json.Unmarshal(a.After, &after)
		out = append(out, sdo.AdminActionDTO{
			ID: a.ID, ActorID: a.ActorID, Action: a.Action, TargetType: a.TargetType, TargetID: a.TargetID,
			Before: before, After: after, Reason: a.Reason, TraceID: a.TraceID.String,
			CreatedAt: a.CreatedAt.Time.Format(time.RFC3339),
		})
	}
	return out
}

func optTimePtr(t pgtype.Timestamptz) *string {
	if !t.Valid {
		return nil
	}
	s := t.Time.Format(time.RFC3339)
	return &s
}
