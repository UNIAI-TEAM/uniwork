import { z } from "zod";

/**
 * The answer a packaged app gives on the auth channels when no usable
 * deployment profile is installed (UNI-966). It is a typed value, not a missing
 * channel: the renderer tells "download again" apart from a transient failure.
 * Like ipc.ts it stays free of Electron and main imports.
 */
const NO_DEPLOYMENT_PROFILE_REASONS = ["missing", "invalid", "channel_mismatch"] as const;
export type NoDeploymentProfileReason = (typeof NO_DEPLOYMENT_PROFILE_REASONS)[number];

/** `desktop:auth-config` without a profile. The reason is a fixed word for
 * diagnostics; it never carries a path, a profile field or an error message.
 * `importable: false` means an installer-owned profile exists (unusable), so
 * choosing a file could never take effect and only a reinstall helps. */
export const desktopNoDeploymentProfileSchema = z.object({
  state: z.literal("no_deployment_profile"),
  reason: z.enum(NO_DEPLOYMENT_PROFILE_REASONS),
  importable: z.boolean().optional(),
}).strict();
export type DesktopNoDeploymentProfile = z.infer<typeof desktopNoDeploymentProfileSchema>;

/** `desktop:deployment-import`: main opens its own picker and confirmation;
 * the request carries no path and no file content. `restart_required` (here
 * and on reset): the change is saved but the leave dialog kept the app open. */
export const desktopDeploymentImportResponseSchema = z.object({
  status: z.enum(["imported", "restart_required", "cancelled", "already_configured", "invalid", "channel_mismatch", "unavailable"]),
}).strict();
export type DesktopDeploymentImportStatus = z.infer<typeof desktopDeploymentImportResponseSchema>["status"];

/** `desktop:deployment-reset`: removes an imported profile and that
 * deployment's stored sessions after a native confirmation. */
export const desktopDeploymentResetResponseSchema = z.object({
  status: z.enum(["reset", "restart_required", "cancelled", "not_imported", "unavailable"]),
}).strict();
export type DesktopDeploymentResetStatus = z.infer<typeof desktopDeploymentResetResponseSchema>["status"];
