import type { LinkClickIntent } from "./click-intent";
import type { NavigationAdapter } from "./types";

/**
 * In-app path via NavigationAdapter.
 * No provider (isolated mounts): push is a no-op — same as
 * OnboardingLogoutButton's `nav?.replace(...)`. Tab intents still
 * window.open (adapter has no background-tab API).
 */
export function navigateInternal(
  navigation: NavigationAdapter | null | undefined,
  path: string,
  disposition: LinkClickIntent = "push",
): void {
  if (disposition === "push") {
    navigation?.push(path);
    return;
  }
  const url = navigation?.getShareableUrl(path) ?? path;
  window.open(url, "_blank", "noopener,noreferrer");
}
