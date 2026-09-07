import { z } from "zod";

/**
 * Platform-admin console (F-11). Lenient on purpose: server enums stay
 * strings, optional fields default, so a drifted response degrades rather
 * than blanking the console. Mirrors server/internal/handler/dto/sdo/admin.go.
 */

export const ORGANIZATION_STATUSES = ["active", "suspended", "archived"] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

export const AdminOrganizationSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  status: z.string(),
  plan_code: z.string().optional().default(""),
  member_count: z.number().optional().default(0),
  workspace_count: z.number().optional().default(0),
  created_at: z.string().optional().default(""),
  last_activity_at: z.string().nullable().optional().default(null),
});
export type AdminOrganization = z.infer<typeof AdminOrganizationSchema>;

export const AdminEntitlementSchema = z.object({
  key: z.string(),
  kind: z.string(),
  enabled: z.boolean(),
  limit: z.number().nullable().optional().default(null),
  current: z.number().optional().default(0),
});
export type AdminEntitlement = z.infer<typeof AdminEntitlementSchema>;

export const AdminActionSchema = z.object({
  id: z.string(),
  actor_id: z.string().optional().default(""),
  action: z.string(),
  target_type: z.string().optional().default(""),
  target_id: z.string().optional().default(""),
  before: z.record(z.string(), z.unknown()).nullable().optional().default(null),
  after: z.record(z.string(), z.unknown()).nullable().optional().default(null),
  reason: z.string().optional().default(""),
  trace_id: z.string().optional().default(""),
  created_at: z.string(),
});
export type AdminAction = z.infer<typeof AdminActionSchema>;

export const AdminOrganizationDetailSchema = z.object({
  organization: AdminOrganizationSchema,
  suspended_at: z.string().nullable().optional().default(null),
  suspended_reason: z.string().nullable().optional().default(null),
  entitlements: z.array(AdminEntitlementSchema).optional().default([]),
  actions: z.array(AdminActionSchema).optional().default([]),
});
export type AdminOrganizationDetail = z.infer<typeof AdminOrganizationDetailSchema>;

export const AdminTraceAuditSchema = z.object({
  id: z.string(),
  organization_id: z.string().optional().default(""),
  workspace_id: z.string().optional().default(""),
  actor_kind: z.string().optional().default(""),
  actor_id: z.string().optional().default(""),
  action: z.string(),
  resource_type: z.string().optional().default(""),
  resource_id: z.string().optional().default(""),
  occurred_at: z.string(),
});
export type AdminTraceAudit = z.infer<typeof AdminTraceAuditSchema>;

export const AdminTraceOutboxSchema = z.object({
  id: z.string(),
  topic: z.string(),
  status: z.string().optional().default(""),
  attempts: z.number().optional().default(0),
  last_error: z.string().optional().default(""),
  created_at: z.string(),
  done_at: z.string().optional().default(""),
  dead_at: z.string().optional().default(""),
});
export type AdminTraceOutbox = z.infer<typeof AdminTraceOutboxSchema>;

export const AdminTraceSchema = z.object({
  trace_id: z.string(),
  audit: z.array(AdminTraceAuditSchema).optional().default([]),
  outbox: z.array(AdminTraceOutboxSchema).optional().default([]),
  actions: z.array(AdminActionSchema).optional().default([]),
});
export type AdminTrace = z.infer<typeof AdminTraceSchema>;

export const ReadinessCheckSchema = z.object({
  name: z.string(),
  ok: z.boolean(),
  detail: z.string().optional().default(""),
});
export type ReadinessCheck = z.infer<typeof ReadinessCheckSchema>;

export const AdminSystemSchema = z.object({
  version: z.string().optional().default(""),
  commit: z.string().optional().default(""),
  migration_embedded: z.string().optional().default(""),
  readiness: z
    .object({
      ready: z.boolean().optional().default(false),
      checks: z.array(ReadinessCheckSchema).optional().default([]),
    })
    .optional()
    .default({ ready: false, checks: [] }),
  outbox_pending: z.number().optional().default(0),
  outbox_dead: z.number().optional().default(0),
  outbox_oldest_pending_age_seconds: z.number().optional().default(0),
  realtime_connections: z.number().optional().default(0),
  flag_providers: z.array(z.string()).optional().default([]),
});
export type AdminSystem = z.infer<typeof AdminSystemSchema>;

export const AdminFlagSchema = z.object({
  key: z.string(),
  description: z.string().optional().default(""),
  default: z.boolean(),
  public: z.boolean().optional().default(false),
  owner: z.string().optional().default(""),
  review_at: z.string().optional().default(""),
  override_count: z.number().optional().default(0),
});
export type AdminFlag = z.infer<typeof AdminFlagSchema>;

export const AdminFlagOverrideSchema = z.object({
  id: z.string(),
  flag_key: z.string(),
  scope_type: z.string(),
  scope_id: z.string().optional().default(""),
  enabled: z.boolean(),
  note: z.string().optional().default(""),
  created_by: z.string().optional().default(""),
  created_at: z.string().optional().default(""),
  expires_at: z.string().optional().default(""),
});
export type AdminFlagOverride = z.infer<typeof AdminFlagOverrideSchema>;

export interface FlagOverrideInput {
  scope_type: "organization" | "user" | "global";
  scope_id: string;
  enabled: boolean;
  expires_at?: string;
  reason: string;
}

export interface FlagOverrideDeleteInput {
  scope_type: "organization" | "user" | "global";
  scope_id: string;
  reason: string;
}
