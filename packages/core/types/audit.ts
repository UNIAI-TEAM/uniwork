import { z } from "zod";

/**
 * One row of the immutable log.
 *
 * Lenient on purpose (ADR 0003): `actor_kind` and `action` stay `z.string()`
 * so a row written by a newer server still renders. The UI narrows them with
 * `default`-bearing switches rather than refusing the whole page.
 */
export const AuditEventSchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  workspace_id: z.string().optional(),
  actor_kind: z.string(),
  actor_id: z.string(),
  action: z.string(),
  resource_type: z.string(),
  resource_id: z.string(),
  changes: z.record(z.string(), z.unknown()).default({}),
  metadata: z.record(z.string(), z.unknown()).default({}),
  correlation_id: z.string(),
  ip_address: z.string().optional(),
  user_agent: z.string().optional(),
  occurred_at: z.string(),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

/** A field that changed, as the server records it. */
export interface AuditChange {
  from?: unknown;
  to?: unknown;
}

export const AuditExportSchema = z.object({
  id: z.string(),
  format: z.string(),
  from_at: z.string(),
  to_at: z.string(),
  status: z.string(),
  row_count: z.number().default(0),
  download_url: z.string().optional(),
  error: z.string().optional(),
  created_at: z.string(),
  expires_at: z.string().optional(),
});
export type AuditExport = z.infer<typeof AuditExportSchema>;

/** Actor kinds the UI knows how to label; anything else renders as unknown. */
export type ActorKind = "human" | "agent" | "system";
