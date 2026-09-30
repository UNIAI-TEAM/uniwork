import { z } from "zod";
import { DESKTOP_IDENTITY_MANIFEST } from "../../shared/identity";

const updateConfigSchema = z.object({
  enabled: z.boolean(),
  feed: z.string().url().nullable(),
  publisher: z.string().min(1).nullable(),
  channel: z.enum(["stable", "beta", "dev"]),
}).strict();

export type DesktopUpdateConfig = z.infer<typeof updateConfigSchema>;
export type UpdateConfigErrorCode = "missing" | "invalid" | "wrong-channel";

export class UpdateConfigError extends Error {
  readonly code: UpdateConfigErrorCode;

  constructor(code: UpdateConfigErrorCode, message: string) {
    super(message);
    this.name = "UpdateConfigError";
    this.code = code;
  }
}

/** Update configuration is deliberately disabled until G4-D3/G7 provide a
 * signed feed and publisher.  An absent or malformed override refuses rather
 * than silently enabling an upstream/default feed. */
export const DEFAULT_UPDATE_CONFIG: DesktopUpdateConfig = Object.freeze({
  enabled: DESKTOP_IDENTITY_MANIFEST.update.enabled,
  feed: DESKTOP_IDENTITY_MANIFEST.update.feed,
  publisher: DESKTOP_IDENTITY_MANIFEST.update.publisher,
  channel: DESKTOP_IDENTITY_MANIFEST.update.channel,
});

export function parseUpdateConfig(value: unknown): DesktopUpdateConfig {
  if (value === undefined || value === null) throw new UpdateConfigError("missing", "desktop update configuration is required");
  const parsed = updateConfigSchema.safeParse(value);
  if (!parsed.success) throw new UpdateConfigError("invalid", "desktop update configuration is invalid");
  if (parsed.data.channel !== DESKTOP_IDENTITY_MANIFEST.build.channel) throw new UpdateConfigError("wrong-channel", "desktop update channel does not match the identity manifest");
  if (parsed.data.enabled && (!parsed.data.feed || !parsed.data.publisher)) throw new UpdateConfigError("invalid", "enabled updates require a feed and publisher");
  if (!parsed.data.enabled && (parsed.data.feed !== null || parsed.data.publisher !== null)) throw new UpdateConfigError("invalid", "disabled updates cannot carry a feed or publisher");
  return parsed.data;
}
