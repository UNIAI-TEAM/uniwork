import type { LinkClickIntent } from "./click-intent";
import type { NavigationAdapter } from "./types";
import { navigateInternal } from "./navigate-internal";

/**
 * Routes in-app when a NavigationAdapter is wired. Without a provider (tests /
 * isolated mounts) push is a no-op — same as OnboardingLogoutButton's optional
 * nav — and tab intents still `window.open`.
 *
 * Prefer this name at call sites that arrived with the task-detail editor
 * transplant; `navigateInternal` is the same helper.
 */
export function navigateWithFallback(
  navigation: NavigationAdapter | null,
  path: string,
  disposition: LinkClickIntent = "push",
): void {
  navigateInternal(navigation, path, disposition);
}
