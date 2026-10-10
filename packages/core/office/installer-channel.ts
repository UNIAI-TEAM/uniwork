import type { OfficeChannel } from "./desktop-handoff";
import type { OfficeInstallerOption } from "./desktop-platform";

const PREFERENCE: readonly OfficeChannel[] = ["stable", "beta", "dev"];

/**
 * The channel the web should offer: the most stable one that actually
 * publishes an installer. `null` means nothing is published, so callers keep
 * the "no installer yet" state instead of guessing a channel the server will
 * answer with installer_unavailable.
 */
export function selectOfficeInstallerChannel(
  installers: Partial<Record<OfficeChannel, readonly OfficeInstallerOption[]>> | undefined,
): OfficeChannel | null {
  return PREFERENCE.find((channel) => (installers?.[channel]?.length ?? 0) > 0) ?? null;
}
