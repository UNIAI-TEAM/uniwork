import { z } from "zod";
import { grantableOperationSchema } from "./operations";

// Job grant: the scoped, expiring permission Go issues per engine job
// (engine-contract.md §3). A caller's copy is only a handle - the registry row
// Go issued is the authority, bound field for field by GRANT_BINDING_FIELDS.

export const grantScopes = ["read", "write_branch"] as const;
export const grantScopeSchema = z.enum(grantScopes);
export type GrantScope = (typeof grantScopes)[number];

export const jobGrantSchema = z.object({
  grant_id: z.string().min(1),
  actor_id: z.string().min(1),
  organization_id: z.string().min(1),
  workspace_id: z.string().min(1),
  document_id: z.string().min(1),
  operation: grantableOperationSchema,
  // "read" may only read; "write_branch" may produce a new branch version.
  // A grant can never overwrite the committed source.
  scope: grantScopeSchema,
  base_revision: z.number().int().min(0),
  base_version_id: z.string().min(1),
  // Storage key the engine reads input bytes from directly. Authority field:
  // it lives inside the grant Go issues, never inside a caller envelope.
  input_object_key: z.string().min(1).optional(),
  // Epoch ms, matching the G0 model's now()-driven arithmetic.
  issued_at: z.number().int(),
  expires_at: z.number().int(),
  single_use: z.literal(true),
  consumed: z.boolean().default(false),
  max_output_bytes: z.number().int().positive(),
});
export type JobGrant = z.infer<typeof jobGrantSchema>;

/** Fields that bind a grant to one actor, document, operation and base. Every
 * one must still match the registry copy for a presented grant to be
 * authoritative (ported from GRANT_BINDING_FIELDS). */
export const GRANT_BINDING_FIELDS = [
  "actor_id",
  "organization_id",
  "workspace_id",
  "document_id",
  "operation",
  "scope",
  "base_revision",
  "base_version_id",
  "single_use",
  "max_output_bytes",
] as const;
export type GrantBindingField = (typeof GRANT_BINDING_FIELDS)[number];
