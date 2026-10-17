// expo-router routes every OS URL itself; this maps the app's own shapes
// (`<scheme>://open?url=…`, the PKCE callback) onto routes before it does, so
// neither lands on an unmatched route and a foregrounded link is not pushed
// twice. The policy is lib/deep-link.ts › systemPathToRoute, tested without expo.
import Constants from "expo-constants";
import { authConfig } from "@/data/auth/flow";
import { systemPathToRoute } from "@/lib/deep-link";
import { runtimeFromExtra } from "@/lib/runtime-extra";

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  // Read here, not from runtimeConfig(): app/_layout may not have configured it yet.
  return systemPathToRoute(path, runtimeFromExtra(Constants.expoConfig?.extra).appUrl ?? "", authConfig.scheme);
}
