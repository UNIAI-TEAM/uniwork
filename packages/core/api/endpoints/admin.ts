import { z } from "zod";
import {
  AdminFlagOverrideSchema,
  AdminFlagSchema,
  AdminOrganizationDetailSchema,
  AdminOrganizationSchema,
  AdminSystemSchema,
  AdminTraceSchema,
  type AdminFlag,
  type AdminFlagOverride,
  type AdminOrganization,
  type AdminOrganizationDetail,
  type AdminSystem,
  type AdminTrace,
  type FlagOverrideDeleteInput,
  type FlagOverrideInput,
} from "../../types/admin";
import { SubscriptionSchema, type Subscription } from "../../types/billing";
import { request } from "../http";
import { parseWithFallback } from "../schema";

/**
 * Platform-admin console (F-11). Every route sits under /api/v1/admin and
 * answers 404 when the caller has no platform role, so the transport error
 * is what the layout guard reads; the shapes here only cover the happy path.
 */

const MeResponse = z.object({ platform_role: z.string() });
const OrganizationsResponse = z.object({ organizations: z.array(AdminOrganizationSchema) });
const OrganizationResponse = z.object({ organization: AdminOrganizationSchema });
const SubscriptionResponse = z.object({ subscription: SubscriptionSchema });
const FlagsResponse = z.object({ flags: z.array(AdminFlagSchema) });
const OverridesResponse = z.object({ overrides: z.array(AdminFlagOverrideSchema) });

const enc = encodeURIComponent;

/** "admin" | "support"; "" when the response drifted. Throws ApiError 404 when the caller has no role. */
export async function getAdminMe(): Promise<string> {
  const raw = await request("/api/v1/admin/me");
  return parseWithFallback<{ platform_role: string }>(raw, MeResponse, { platform_role: "" }, {
    endpoint: "GET /api/v1/admin/me",
  }).platform_role;
}

export interface AdminOrganizationQuery {
  q?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export async function listAdminOrganizations(query: AdminOrganizationQuery = {}): Promise<AdminOrganization[]> {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.status) params.set("status", query.status);
  if (query.limit) params.set("limit", String(query.limit));
  if (query.offset) params.set("offset", String(query.offset));
  const qs = params.toString();
  const raw = await request(`/api/v1/admin/organizations${qs ? `?${qs}` : ""}`);
  return parseWithFallback<{ organizations: AdminOrganization[] }>(raw, OrganizationsResponse, { organizations: [] }, {
    endpoint: "GET /api/v1/admin/organizations",
  }).organizations;
}

export async function getAdminOrganization(orgId: string): Promise<AdminOrganizationDetail | null> {
  const raw = await request(`/api/v1/admin/organizations/${enc(orgId)}`);
  return parseWithFallback<AdminOrganizationDetail | null>(raw, AdminOrganizationDetailSchema, null, {
    endpoint: "GET /api/v1/admin/organizations/{org}",
  });
}

async function postOrganization(orgId: string, verb: "suspend" | "unsuspend", reason: string) {
  const raw = await request(`/api/v1/admin/organizations/${enc(orgId)}/${verb}`, { method: "POST", body: { reason } });
  return (
    parseWithFallback<{ organization: AdminOrganization } | null>(raw, OrganizationResponse, null, {
      endpoint: `POST /api/v1/admin/organizations/{org}/${verb}`,
    })?.organization ?? null
  );
}

export function suspendOrganization(orgId: string, reason: string): Promise<AdminOrganization | null> {
  return postOrganization(orgId, "suspend", reason);
}

export function unsuspendOrganization(orgId: string, reason: string): Promise<AdminOrganization | null> {
  return postOrganization(orgId, "unsuspend", reason);
}

/** Manual plan change (pilot, partner); same response as the billing endpoint. */
export async function changeOrganizationPlan(
  orgId: string,
  body: { plan_code: string; reason: string },
): Promise<Subscription | null> {
  const raw = await request(`/api/v1/admin/organizations/${enc(orgId)}/plan`, { method: "POST", body });
  return (
    parseWithFallback<{ subscription: Subscription } | null>(raw, SubscriptionResponse, null, {
      endpoint: "POST /api/v1/admin/organizations/{org}/plan",
    })?.subscription ?? null
  );
}

export async function getAdminTrace(traceId: string): Promise<AdminTrace | null> {
  const raw = await request(`/api/v1/admin/trace/${enc(traceId)}`);
  return parseWithFallback<AdminTrace | null>(raw, AdminTraceSchema, null, {
    endpoint: "GET /api/v1/admin/trace/{trace}",
  });
}

export async function getAdminSystem(): Promise<AdminSystem | null> {
  const raw = await request("/api/v1/admin/system");
  return parseWithFallback<AdminSystem | null>(raw, AdminSystemSchema, null, {
    endpoint: "GET /api/v1/admin/system",
  });
}

export async function listAdminFlags(): Promise<AdminFlag[]> {
  const raw = await request("/api/v1/admin/flags");
  return parseWithFallback<{ flags: AdminFlag[] }>(raw, FlagsResponse, { flags: [] }, {
    endpoint: "GET /api/v1/admin/flags",
  }).flags;
}

function parseOverrides(raw: unknown, endpoint: string): AdminFlagOverride[] {
  return parseWithFallback<{ overrides: AdminFlagOverride[] }>(raw, OverridesResponse, { overrides: [] }, { endpoint })
    .overrides;
}

export async function listFlagOverrides(key: string): Promise<AdminFlagOverride[]> {
  const raw = await request(`/api/v1/admin/flags/${enc(key)}/overrides`);
  return parseOverrides(raw, "GET /api/v1/admin/flags/{key}/overrides");
}

export async function setFlagOverride(key: string, body: FlagOverrideInput): Promise<AdminFlagOverride[]> {
  const raw = await request(`/api/v1/admin/flags/${enc(key)}/overrides`, { method: "PUT", body });
  return parseOverrides(raw, "PUT /api/v1/admin/flags/{key}/overrides");
}

export async function deleteFlagOverride(key: string, body: FlagOverrideDeleteInput): Promise<AdminFlagOverride[]> {
  const raw = await request(`/api/v1/admin/flags/${enc(key)}/overrides`, { method: "DELETE", body });
  return parseOverrides(raw, "DELETE /api/v1/admin/flags/{key}/overrides");
}
