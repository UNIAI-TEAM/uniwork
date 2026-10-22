// What a push that arrives while UniChat is open does (expo-notifications'
// setNotificationHandler, app/_layout.tsx). A push about the workspace on
// screen stays quiet: its socket already updated the list, and a call there
// already rings in the app's own call screen. A push about another workspace
// (a call or a message there: the socket of this one never hears it) shows a
// banner with its sound, and a tap opens it there.
import { parseDeepLink } from "./deep-link";
import { pathOf } from "./unknown-shape";

export interface OpenWorkspace {
  orgSlug: string;
  wsSlug: string;
}

export function showInForeground(data: unknown, open: OpenWorkspace | null, appUrl: string, scheme: string): boolean {
  const url = pathOf(data, "url");
  if (!open || typeof url !== "string") return true;
  const link = parseDeepLink(url, appUrl, scheme);
  return !link || link.orgSlug !== open.orgSlug || link.wsSlug !== open.wsSlug;
}
