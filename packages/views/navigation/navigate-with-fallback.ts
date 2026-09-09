import type { LinkClickIntent } from "./click-intent";
import type { NavigationAdapter } from "./types";

/**
 * Routes in-app when a NavigationAdapter is wired; otherwise falls back to a
 * full navigation so the editor still works in tests and hosts without the
 * adapter (see onboarding-logout-button for the optional-nav pattern).
 */
export function navigateWithFallback(
  navigation: NavigationAdapter | null,
  path: string,
  disposition: LinkClickIntent = "push",
): void {
  if (!navigation) {
    if (disposition === "push") {
      // eslint-disable-next-line no-restricted-syntax -- host without NavigationAdapter
      window.location.assign(path);
    } else {
      window.open(path, "_blank", "noopener,noreferrer");
    }
    return;
  }
  if (disposition === "push") {
    navigation.push(path);
    return;
  }
  window.open(navigation.getShareableUrl(path), "_blank", "noopener,noreferrer");
}
