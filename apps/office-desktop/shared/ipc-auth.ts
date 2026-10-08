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
 * diagnostics; it never carries a path, a profile field or an error message. */
export const desktopNoDeploymentProfileSchema = z.object({
  state: z.literal("no_deployment_profile"),
  reason: z.enum(NO_DEPLOYMENT_PROFILE_REASONS),
}).strict();
export type DesktopNoDeploymentProfile = z.infer<typeof desktopNoDeploymentProfileSchema>;
