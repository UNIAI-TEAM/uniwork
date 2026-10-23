// Ported from usf apps/mobile/data/schemas.ts (shape): lenient zod for the
// two responses the shell reads at boot. Only the identity field is required;
// everything else defaults, so a drifted server degrades to "stale defaults
// render" instead of a blank screen. parseWithFallback handles the rest.
import type { User } from "@uniwork/core/types/user";
import type { Workspace } from "@uniwork/core/types/workspace";
import { z } from "zod";

const UserSchema = z.object({
  id: z.string(),
  email: z.string().default(""),
  display_name: z.string().default(""),
  avatar_url: z.string().optional(),
  onboarded_at: z.string().nullable().default(null),
  email_verified_at: z.string().nullable().default(null),
  onboarding_questionnaire: z.record(z.string(), z.unknown()).default({}),
  locale: z.string().default("en"),
  timezone: z.string().optional(),
  mfa_enabled_at: z.string().nullable().optional(),
  has_password: z.boolean().optional(),
  platform_role: z.string().optional(),
  // A drifted value reads as "not agreed": the consent sheet asks again rather than sending unasked.
  ai_consent_version: z.string().nullable().optional().catch(null),
  ai_consent_at: z.string().nullable().optional().catch(null),
  // A drifted value reads as "not declined": what the server enforces does not depend on this copy.
  ai_opt_out_at: z.string().nullable().optional().catch(null),
  // Absent or drifted reads as shown, the server's default (PUT /me/push-previews).
  push_previews: z.boolean().optional().catch(undefined),
});

/** GET /api/v1/me */
export const MeResponseSchema: z.ZodType<{ user: User }> = z.object({ user: UserSchema });

const WorkspaceSchema = z.object({
  id: z.string(),
  slug: z.string().default(""),
  name: z.string().default(""),
  organization_id: z.string().default(""),
  organization_slug: z.string().default(""),
  organization_name: z.string().default(""),
  description: z.string().optional().catch(undefined),
  icon_emoji: z.string().optional().catch(undefined),
  icon_url: z.string().optional().catch(undefined),
  task_prefix: z.string().optional().catch(undefined),
});

/** GET /api/v1/workspaces */
export const WorkspacesResponseSchema: z.ZodType<{ workspaces: Workspace[] }> = z.object({
  workspaces: z.array(WorkspaceSchema),
});
