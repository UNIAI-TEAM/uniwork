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
const OrganizationsResponse = z.object({
  organizations: z.array(AdminOrganizationSchema),
  total: z.number().optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
});
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

/** Server-side orders; the browser never re-sorts a page it only partly holds. */
export type AdminOrganizationSort = "created_desc" | "activity_desc" | "activity_asc";

export interface AdminOrganizationQuery {
  q?: string;
  status?: string;
  sort?: AdminOrganizationSort;
  limit?: number;
  offset?: number;
}

/** One page plus the size of the whole filtered set, so the console can page. */
export interface AdminOrganizationPage {
  organizations: AdminOrganization[];
  total: number;
  limit: number;
  offset: number;
}

export async function listAdminOrganizations(query: AdminOrganizationQuery = {}): Promise<AdminOrganizationPage> {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.status) params.set("status", query.status);
  if (query.sort) params.set("sort", query.sort);
  if (query.limit) params.set("limit", String(query.limit));
  if (query.offset) params.set("offset", String(query.offset));
  const qs = params.toString();
  const raw = await request(`/api/v1/admin/organizations${qs ? `?${qs}` : ""}`);
  const parsed = parseWithFallback<{
    organizations: AdminOrganization[];
    total?: number;
    limit?: number;
    offset?: number;
  }>(raw, OrganizationsResponse, { organizations: [] }, { endpoint: "GET /api/v1/admin/organizations" });
  return {
    organizations: parsed.organizations,
    // A server that dropped the field still gets a pager that can move: the
    // page it returned is at least that many rows.
    total: parsed.total ?? parsed.organizations.length + (query.offset ?? 0),
    limit: parsed.limit ?? query.limit ?? parsed.organizations.length,
    offset: parsed.offset ?? query.offset ?? 0,
  };
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

/** Every override in one request; the Flags screen renders N rows from it. */
export async function listAllFlagOverrides(): Promise<AdminFlagOverride[]> {
  const raw = await request("/api/v1/admin/flags/overrides");
  return parseOverrides(raw, "GET /api/v1/admin/flags/overrides");
}

export async function setFlagOverride(key: string, body: FlagOverrideInput): Promise<AdminFlagOverride[]> {
  const raw = await request(`/api/v1/admin/flags/${enc(key)}/overrides`, { method: "PUT", body });
  return parseOverrides(raw, "PUT /api/v1/admin/flags/{key}/overrides");
}

export async function deleteFlagOverride(key: string, body: FlagOverrideDeleteInput): Promise<AdminFlagOverride[]> {
  const raw = await request(`/api/v1/admin/flags/${enc(key)}/overrides`, { method: "DELETE", body });
  return parseOverrides(raw, "DELETE /api/v1/admin/flags/{key}/overrides");
}
